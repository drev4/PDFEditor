import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { pdfFilenameFrom } from './pdf-url.js'
import type { PdfStorageDriver } from './pdf-storage.js'

/**
 * Everything a backup and a restore drill need to decide, with none of the
 * shelling out (features/0037).
 *
 * The two scripts in `src/scripts/` are thin: they parse arguments, run
 * `pg_dump`/`pg_restore`, and print. All the judgement lives here so it can be
 * tested without a PostgreSQL binary, a network or a bucket — the constraint
 * `docs/sot/09-quality-and-testing.md` puts on every suite in this repository.
 *
 * The thing this module exists to make possible is the check nothing else in
 * the codebase performs: **a restored database is not proof of a restored
 * product.** `Form.pdfUrl` points out of PostgreSQL and into object storage,
 * and since features/0029 deleting a form deletes its document too, so the two
 * stores drift apart on their own. A dump restored against a bucket from a
 * different moment produces forms that open and then fail at the document, with
 * nothing logged anywhere. `verifyDocuments` below is what turns that into a
 * number an operator can read before they route traffic at it.
 */

/**
 * The minimum of a Prisma client this module uses.
 *
 * Declared structurally rather than imported as `PrismaClient` because a
 * restore drill runs against a *second* database — the scratch target — and the
 * application's singleton in `services/db.ts` is bound to `DATABASE_URL`. A
 * narrow interface is also what lets the tests hand in a plain object instead
 * of mocking a client with four hundred methods.
 */
export interface SqlClient {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>
}

export const MANIFEST_VERSION = 1

export interface BackupManifest {
  version: typeof MANIFEST_VERSION
  /** UTC, ISO 8601. The RPO is measured from this. */
  createdAt: string
  /** `host:port/database` — deliberately never the credentials. */
  database: string
  /** Newest row in `_prisma_migrations`, or null on a database with none. */
  migration: string | null
  dumpFile: string
  dumpSha256: string
  /** Every table in the `public` schema, counted. Includes `_prisma_migrations`. */
  rowCounts: Record<string, number>
  /**
   * The storage keys the dumped rows point at.
   *
   * This is what makes the pair of artifacts coherent. The object backup reads
   * its work list from here rather than from the live database, so the bytes it
   * captures are the bytes *this dump* refers to — not the ones the product
   * happens to reference by the time the object copy starts, which is a
   * different and slightly later set every time.
   */
  documentKeys: string[]
}

/**
 * Credentials must not reach a manifest that is written beside a dump and
 * copied around by operators, so the URL is reduced to what identifies the
 * database and nothing that opens it.
 */
export function describeDatabase(url: string): string {
  try {
    const parsed = new URL(url)
    const database = parsed.pathname.replace(/^\//, '') || '(none)'
    return `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}/${database}`
  } catch {
    return '(unparseable)'
  }
}

/**
 * Two connection strings that address the same database.
 *
 * Compared on host, port and database name only. A plain string comparison is
 * not enough and the difference is the whole point of the check: the same
 * database is routinely named by two different URLs — a different user, a
 * `?schema=public` that one of them carries, a trailing slash — and a drill
 * that restores over production because the strings did not match character for
 * character is the accident this guard exists to prevent.
 *
 * Unparseable input answers `true` (treat it as the same database) so the
 * failure is a refusal to run rather than permission to overwrite.
 */
export function addressesSameDatabase(a: string, b: string): boolean {
  let left: URL
  let right: URL
  try {
    left = new URL(a)
    right = new URL(b)
  } catch {
    return true
  }

  const key = (u: URL) =>
    `${u.hostname.toLowerCase()}:${u.port || '5432'}${u.pathname.replace(/\/$/, '')}`

  return key(left) === key(right)
}

/**
 * A connection string as libpq environment variables, for handing to `pg_dump`
 * and `pg_restore`.
 *
 * The alternative is `--dbname=<uri>`, and it is the reason this function
 * exists: an argument vector is world-readable through `ps` for as long as the
 * process runs, so the database password would be on the process list of every
 * host that ever takes a backup. Environment is not a secret store either, but
 * it is not readable by another user's `ps`.
 *
 * `sslmode` is carried across because a managed provider puts it in the query
 * string and dropping it turns a working connection into a refused one.
 */
export function pgEnvFrom(url: string): Record<string, string> {
  const parsed = new URL(url)
  const env: Record<string, string> = {
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || '5432',
    PGDATABASE: decodeURIComponent(parsed.pathname.replace(/^\//, ''))
  }

  if (parsed.username) env.PGUSER = decodeURIComponent(parsed.username)
  if (parsed.password) env.PGPASSWORD = decodeURIComponent(parsed.password)

  const sslmode = parsed.searchParams.get('sslmode')
  if (sslmode) env.PGSSLMODE = sslmode

  return env
}

/** Every table in the `public` schema of whatever database this client is on. */
export async function publicTables(client: SqlClient): Promise<string[]> {
  const rows = await client.$queryRawUnsafe<{ table_name: string }[]>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`
  )
  return rows.map((row) => row.table_name)
}

/**
 * `count(*)` per table.
 *
 * The table list comes from `information_schema`, never from a constant in this
 * file. A hand-written list of tables is a second source of truth about the
 * schema and would be wrong at the next migration — the same argument
 * `tests/config-coverage.spec.ts` makes about the environment. Identifiers are
 * quoted because they are interpolated, even though they came from the database
 * itself a moment ago.
 */
export async function countRows(client: SqlClient, tables: string[]): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}

  for (const table of tables) {
    const quoted = `"${table.replace(/"/g, '""')}"`
    const rows = await client.$queryRawUnsafe<{ count: bigint | number }[]>(
      `SELECT count(*)::bigint AS count FROM ${quoted}`
    )
    counts[table] = Number(rows[0]?.count ?? 0)
  }

  return counts
}

/**
 * The newest migration this database has actually applied.
 *
 * `rolled_back_at IS NULL` matters: a rolled-back row stays in the table, and
 * reading the newest row without that filter reports a migration whose effects
 * are not there.
 */
export async function appliedMigration(client: SqlClient): Promise<string | null> {
  const rows = await client.$queryRawUnsafe<{ migration_name: string }[]>(
    `SELECT migration_name FROM _prisma_migrations
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
      ORDER BY finished_at DESC
      LIMIT 1`
  )
  return rows[0]?.migration_name ?? null
}

/**
 * The newest migration directory in the repository.
 *
 * Prisma names directories `<timestamp>_<slug>` and the baseline is `0_baseline`,
 * so a lexicographic sort puts them in the order they are applied.
 */
export function newestMigrationOnDisk(migrationsDir: string): string | null {
  const entries = fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()

  return entries.length > 0 ? (entries[entries.length - 1] ?? null) : null
}

/**
 * The distinct storage keys the `forms` table points at.
 *
 * Read with raw SQL rather than through the generated Prisma client because
 * this also runs against the restored scratch database, where the client's
 * datasource is not `DATABASE_URL`. `pdfFilenameFrom` is what turns a stored
 * URL into a key — never `split('/')` here, because that function is the one
 * place that decides what shape a filename this service issued can have, and a
 * second copy of that rule is a second thing to get wrong (features/0016).
 */
export async function documentKeys(client: SqlClient): Promise<string[]> {
  const rows = await client.$queryRawUnsafe<{ pdf_url: string | null }[]>(
    `SELECT pdf_url FROM forms WHERE pdf_url IS NOT NULL`
  )

  const keys = new Set<string>()
  for (const row of rows) {
    const key = pdfFilenameFrom(row.pdf_url)
    if (key) keys.add(key)
  }

  return [...keys].sort()
}

/**
 * Forms whose `pdfUrl` is set but does not resolve to a key this service could
 * have issued.
 *
 * Reported separately from a missing object, because the two mean different
 * things: a missing object is a backup that lost bytes, and an unrecognised URL
 * is a row somebody wrote by hand. `scripts/migrate-pdfs-to-storage.ts` makes
 * the same distinction for the same reason.
 */
export async function unreadableDocumentUrls(client: SqlClient): Promise<{ id: string; pdfUrl: string }[]> {
  const rows = await client.$queryRawUnsafe<{ id: string; pdf_url: string }[]>(
    `SELECT id, pdf_url FROM forms WHERE pdf_url IS NOT NULL`
  )

  return rows
    .filter((row) => pdfFilenameFrom(row.pdf_url) === null)
    .map((row) => ({ id: row.id, pdfUrl: row.pdf_url }))
}

export interface DocumentCheck {
  checked: number
  missing: string[]
  /** True when a sample limit stopped this short of every key. */
  sampled: boolean
}

/**
 * **The cross-store check.** For each key, does the configured storage actually
 * hold the bytes?
 *
 * Read-only by construction: the driver interface's `exists` is a `HeadObject`
 * under `S3PdfStorage` and a `stat` under `LocalPdfStorage`. Nothing here may
 * call `put` or `remove` — a verification tool that writes to the store it is
 * verifying can turn a drill into the incident it was rehearsing for.
 *
 * A driver error counts as missing rather than propagating. The number this
 * produces is the drill's headline, and an operator reading "3 of 412 documents
 * are not in the bucket" is better served than one reading a stack trace from
 * key 4 with the other 408 never attempted.
 */
export async function verifyDocuments(
  keys: string[],
  storage: Pick<PdfStorageDriver, 'exists'>,
  limit = Number.POSITIVE_INFINITY
): Promise<DocumentCheck> {
  const sample = Number.isFinite(limit) ? keys.slice(0, limit) : keys
  const missing: string[] = []

  for (const key of sample) {
    let present = false
    try {
      present = await storage.exists(key)
    } catch {
      present = false
    }
    if (!present) missing.push(key)
  }

  return { checked: sample.length, missing, sampled: sample.length < keys.length }
}

export interface CountComparison {
  table: string
  expected: number
  actual: number
}

/**
 * Tables whose restored count does not match the manifest.
 *
 * A table present in one side and absent from the other is a mismatch, not a
 * skip: a restore that dropped a table entirely is exactly the failure worth
 * catching, and treating its absence as "nothing to compare" would pass it.
 */
export function compareRowCounts(
  expected: Record<string, number>,
  actual: Record<string, number>
): CountComparison[] {
  const tables = new Set([...Object.keys(expected), ...Object.keys(actual)])

  return [...tables]
    .sort()
    .map((table) => ({ table, expected: expected[table] ?? -1, actual: actual[table] ?? -1 }))
    .filter((row) => row.expected !== row.actual)
}

/** SHA-256 of a file, streamed — a dump does not fit comfortably in memory. */
export function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(file)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

export function manifestPathFor(dumpFile: string): string {
  return `${dumpFile}.manifest.json`
}

export function readManifest(file: string): BackupManifest {
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8')) as BackupManifest

  if (manifest.version !== MANIFEST_VERSION) {
    throw new Error(
      `manifest ${path.basename(file)} is version ${manifest.version}; this build reads version ${MANIFEST_VERSION}`
    )
  }

  return manifest
}
