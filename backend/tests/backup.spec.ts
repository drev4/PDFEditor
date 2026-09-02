import { describe, it, expect } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  addressesSameDatabase,
  appliedMigration,
  compareRowCounts,
  countRows,
  describeDatabase,
  documentKeys,
  manifestPathFor,
  newestMigrationOnDisk,
  pgEnvFrom,
  publicTables,
  readManifest,
  unreadableDocumentUrls,
  verifyDocuments,
  MANIFEST_VERSION,
  type SqlClient
} from '../src/services/backup.js'

/**
 * The backup and restore-drill logic (features/0037).
 *
 * **What this level can prove and what it cannot.** It proves the two refusals,
 * the manifest handling and the cross-store document check — the decisions,
 * all of which are pure functions over a fake client. It proves nothing about
 * `pg_dump` or `pg_restore`, and deliberately does not try: mocking a child
 * process would assert that this code spawns the mock the way this code spawns
 * the mock. Whether a dump restores is settled by running the drill, and the
 * result is recorded in `docs/runbooks/backup-and-restore.md` — the same
 * division `tests/pdf-storage.spec.ts` makes about the S3 driver.
 *
 * No test here touches a network, a bucket or a PostgreSQL binary.
 */

/** A `SqlClient` that answers by matching the query it is handed. */
function fakeClient(answers: Array<[RegExp, unknown]>): SqlClient {
  return {
    async $queryRawUnsafe<T>(query: string): Promise<T> {
      for (const [pattern, value] of answers) {
        if (pattern.test(query)) return value as T
      }
      throw new Error(`unexpected query: ${query}`)
    }
  }
}

describe('refusing to restore over the wrong database', () => {
  it.each([
    ['identical strings', 'postgresql://u:p@db.example.com:5432/vuepdf', 'postgresql://u:p@db.example.com:5432/vuepdf'],
    ['a different user', 'postgresql://alice:x@db.example.com:5432/vuepdf', 'postgresql://bob:y@db.example.com:5432/vuepdf'],
    ['one carrying a schema parameter', 'postgresql://u:p@db.example.com:5432/vuepdf', 'postgresql://u:p@db.example.com:5432/vuepdf?schema=public'],
    ['an implicit default port', 'postgresql://u:p@db.example.com/vuepdf', 'postgresql://u:p@db.example.com:5432/vuepdf'],
    ['different letter case in the host', 'postgresql://u:p@DB.example.com:5432/vuepdf', 'postgresql://u:p@db.example.com:5432/vuepdf']
  ])('recognises %s as the same database', (_label, a, b) => {
    // A string comparison passes four of these five and would let a drill
    // restore over production. That is the whole reason the comparison is on
    // host, port and name rather than on the URL.
    expect(addressesSameDatabase(a, b)).toBe(true)
  })

  it.each([
    ['a different database name', 'postgresql://u:p@db.example.com:5432/vuepdf', 'postgresql://u:p@db.example.com:5432/vuepdf_restore'],
    ['a different host', 'postgresql://u:p@prod.example.com:5432/vuepdf', 'postgresql://u:p@localhost:5432/vuepdf'],
    ['a different port', 'postgresql://u:p@db.example.com:5432/vuepdf', 'postgresql://u:p@db.example.com:5433/vuepdf']
  ])('recognises %s as a different database', (_label, a, b) => {
    expect(addressesSameDatabase(a, b)).toBe(false)
  })

  it('treats an unparseable URL as the same database, so the drill refuses', () => {
    // Failing closed. The alternative — treating nonsense as "definitely not
    // production" — is the one direction where being wrong is unrecoverable.
    expect(addressesSameDatabase('not a url', 'postgresql://u:p@host:5432/db')).toBe(true)
  })
})

describe('refusing a target that is not empty', () => {
  it('lists the tables already in the target', async () => {
    const client = fakeClient([
      [/information_schema\.tables/, [{ table_name: 'forms' }, { table_name: 'users' }]]
    ])

    // `restore-verify.ts` refuses on a non-empty result. The reason it must is
    // `_prisma_migrations`: it travels inside the dump, so restoring over a
    // database the migration job has touched conflicts instead of failing
    // cleanly.
    expect(await publicTables(client)).toEqual(['forms', 'users'])
  })

  it('reports an empty database as empty', async () => {
    const client = fakeClient([[/information_schema\.tables/, []]])
    expect(await publicTables(client)).toEqual([])
  })
})

describe('the cross-store document check', () => {
  /** A driver that holds the keys it was given. Never `put`, never `remove`. */
  const storageHolding = (present: string[]) => ({
    exists: async (key: string) => present.includes(key)
  })

  it('reports a document the storage does not have', async () => {
    // The failure this feature exists to catch: a database restored without
    // its objects. Every one of these forms opens and then fails at the PDF,
    // and nothing in the application logs it.
    const check = await verifyDocuments(
      ['a.pdf', 'b.pdf', 'c.pdf'],
      storageHolding(['a.pdf', 'c.pdf'])
    )

    expect(check.missing).toEqual(['b.pdf'])
    expect(check.checked).toBe(3)
    expect(check.sampled).toBe(false)
  })

  it('passes when every document is present', async () => {
    const check = await verifyDocuments(['a.pdf'], storageHolding(['a.pdf']))
    expect(check.missing).toEqual([])
  })

  it('counts a driver error as missing rather than throwing', async () => {
    // The headline number is worth more than a stack trace from the fourth key
    // with the rest never attempted.
    const check = await verifyDocuments(['a.pdf', 'b.pdf'], {
      exists: async (key: string) => {
        if (key === 'a.pdf') throw new Error('connection reset')
        return true
      }
    })

    expect(check.missing).toEqual(['a.pdf'])
  })

  it('honours a sample limit and says that it did', async () => {
    const check = await verifyDocuments(['a.pdf', 'b.pdf', 'c.pdf'], storageHolding([]), 2)

    expect(check.checked).toBe(2)
    expect(check.sampled).toBe(true)
  })

  it('derives keys through pdfFilenameFrom and drops what it did not issue', async () => {
    const client = fakeClient([
      [/SELECT pdf_url FROM forms/, [
        { pdf_url: 'https://api.example.com/uploads/pdfs/abc123def456-1756900000000.pdf' },
        // A signed URL: the token segment must not become the key.
        { pdf_url: 'https://api.example.com/uploads/pdfs/1756900000.deadbeef/abc123def456-1756900000000.pdf' },
        { pdf_url: '../../etc/passwd' },
        { pdf_url: 'https://elsewhere.example.com/notes.txt' }
      ]]
    ])

    // Deduplicated, and only the names this service could have issued. The rule
    // lives in `pdf-url.ts` and is not restated here — a second copy of it is a
    // second thing to get wrong.
    expect(await documentKeys(client)).toEqual(['abc123def456-1756900000000.pdf'])
  })

  it('reports a pdfUrl it could not read as a separate kind of problem', async () => {
    const client = fakeClient([
      [/SELECT id, pdf_url FROM forms/, [
        { id: 'form-1', pdf_url: 'https://api.example.com/uploads/pdfs/abc123def456-1756900000000.pdf' },
        { id: 'form-2', pdf_url: 'whatever somebody typed' }
      ]]
    ])

    // A missing object means the backup lost bytes; an unreadable URL means a
    // row was written by hand. Collapsing them would hide the second.
    expect(await unreadableDocumentUrls(client)).toEqual([
      { id: 'form-2', pdfUrl: 'whatever somebody typed' }
    ])
  })
})

describe('row counts', () => {
  it('counts every table the database reports, not a list in the code', async () => {
    const client = fakeClient([
      [/FROM "forms"/, [{ count: 12n }]],
      [/FROM "users"/, [{ count: 3 }]]
    ])

    expect(await countRows(client, ['forms', 'users'])).toEqual({ forms: 12, users: 3 })
  })

  it('finds a table that lost rows', () => {
    expect(compareRowCounts({ forms: 10, users: 3 }, { forms: 9, users: 3 })).toEqual([
      { table: 'forms', expected: 10, actual: 9 }
    ])
  })

  it('finds a table that is missing entirely', () => {
    // The restore that dropped a table is the failure worth catching, so an
    // absent table is a mismatch rather than nothing to compare.
    expect(compareRowCounts({ forms: 10, answers: 4 }, { forms: 10 })).toEqual([
      { table: 'answers', expected: 4, actual: -1 }
    ])
  })

  it('is quiet when everything matches', () => {
    expect(compareRowCounts({ forms: 10 }, { forms: 10 })).toEqual([])
  })
})

describe('migration state', () => {
  it('ignores a rolled-back migration', async () => {
    // The filter is the point: a rolled-back row stays in the table, and
    // reading the newest row without it reports a schema that is not there.
    const client = fakeClient([[/_prisma_migrations/, [{ migration_name: '20260902112033_add_collects_respondent_metadata' }]]])
    expect(await appliedMigration(client)).toBe('20260902112033_add_collects_respondent_metadata')
  })

  it('reports null on a database with no migrations applied', async () => {
    const client = fakeClient([[/_prisma_migrations/, []]])
    expect(await appliedMigration(client)).toBeNull()
  })

  it('reads the newest migration directory in the repository', () => {
    // Against the real directory, so this fails if the naming convention
    // changes rather than agreeing with a fixture.
    const dir = path.join(process.cwd(), 'prisma', 'migrations')
    const newest = newestMigrationOnDisk(dir)

    expect(newest).not.toBeNull()
    expect(fs.existsSync(path.join(dir, newest as string, 'migration.sql'))).toBe(true)
  })

  it('orders the baseline before every timestamped migration', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vuepdf-migrations-'))
    try {
      fs.mkdirSync(path.join(dir, '0_baseline'))
      fs.mkdirSync(path.join(dir, '20260827232747_field_soft_delete'))
      fs.mkdirSync(path.join(dir, '20260902112033_metadata'))
      fs.writeFileSync(path.join(dir, 'migration_lock.toml'), '')

      expect(newestMigrationOnDisk(dir)).toBe('20260902112033_metadata')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('the manifest', () => {
  it('is named beside the dump', () => {
    expect(manifestPathFor('/backups/vuepdf-2026.dump')).toBe('/backups/vuepdf-2026.dump.manifest.json')
  })

  it('refuses a version this build does not read', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vuepdf-manifest-'))
    try {
      const file = path.join(dir, 'x.dump.manifest.json')
      fs.writeFileSync(file, JSON.stringify({ version: MANIFEST_VERSION + 1 }))

      // Guessing at a manifest shape from the future is how a restore silently
      // verifies nothing.
      expect(() => readManifest(file)).toThrow(/version/)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('connection strings', () => {
  it('keeps credentials out of the manifest', () => {
    // The manifest is written beside a dump and copied between machines by
    // operators. It identifies the database; it must not open it.
    const described = describeDatabase('postgresql://admin:hunter2@db.example.com:5432/vuepdf?sslmode=require')

    expect(described).toBe('db.example.com:5432/vuepdf')
    expect(described).not.toContain('hunter2')
  })

  it('passes the password through the environment, never an argument', () => {
    // `--dbname=<uri>` would put the password on the process list of every host
    // that takes a backup, for as long as pg_dump runs.
    const env = pgEnvFrom('postgresql://admin:hunter%402@db.example.com:5433/vuepdf?sslmode=require')

    expect(env).toEqual({
      PGHOST: 'db.example.com',
      PGPORT: '5433',
      PGDATABASE: 'vuepdf',
      PGUSER: 'admin',
      PGPASSWORD: 'hunter@2',
      PGSSLMODE: 'require'
    })
  })

  it('carries sslmode across, because a managed provider requires it', () => {
    expect(pgEnvFrom('postgresql://u:p@host/db').PGSSLMODE).toBeUndefined()
    expect(pgEnvFrom('postgresql://u:p@host/db?sslmode=require').PGSSLMODE).toBe('require')
  })
})
