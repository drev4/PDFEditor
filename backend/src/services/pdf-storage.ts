import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import { Readable } from 'stream'
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand
} from '@aws-sdk/client-s3'
import { envBool } from '../config/env.js'

/**
 * The one audited place where uploaded PDF **bytes** are read, written or
 * deleted (features/0016).
 *
 * The same rule `services/pdf-url.ts` follows for PDF *URLs* and
 * `services/pattern-validator.ts` follows for regex
 * (docs/sot/04-backend-patterns.md §8), and it exists for the same reason:
 * before this module, six call sites each built
 * `path.join(process.cwd(), 'uploads', 'pdfs', filename)` by hand — four routes,
 * `app.ts`, and a maintenance script that no test covers. Leaving any one of
 * them on the local filesystem after a move to object storage gives a
 * deployment where uploads work, most reads work, and one path silently 404s
 * depending on which replica answered. **Nothing outside this file may join an
 * `uploads` path or open a PDF by name.**
 *
 * The division of labour with `pdf-url.ts` is worth stating, because the two
 * are easy to confuse:
 *
 *   - `pdf-url.ts` owns the **URL**: what a `Form.pdfUrl` may contain, how a
 *     filename is safely extracted from one, and the signature that makes a
 *     capability out of it.
 *   - this file owns the **bytes**: where they live and how they are moved.
 *
 * It takes a filename, never a URL or a path. Callers get the filename from
 * `pdfFilenameFrom`, which is what validates it — so a name that never came out
 * of `middleware/upload.ts` is refused before it reaches any driver. `assertKey`
 * below re-checks that rather than trusting the caller, because this module is
 * the last thing between a string and a filesystem.
 */

/**
 * Filenames are `nanoid(12)-<timestamp>.pdf`, and an embedded copy adds one
 * more segment (see `routes/form-fields.ts`). Deliberately the same shape as
 * `SAFE_FILENAME` in `pdf-url.ts` — the two must agree, or a file this module
 * accepts is one no URL can be built for.
 */
const SAFE_KEY = /^[A-Za-z0-9_-]+\.pdf$/

/**
 * Re-validated here even though every caller is supposed to have done it.
 *
 * Defence in depth on the one boundary where getting it wrong is a path
 * traversal: `..%2f..%2fetc%2fpasswd` reaching `path.join` is the whole class of
 * bug this closes, and a driver that concatenates strings into a filesystem
 * path or an object key must never be handed an unchecked one. It throws rather
 * than returning null because a caller that got here with a bad name has
 * already skipped a check it was told to make.
 */
function assertKey(key: string): string {
  if (!SAFE_KEY.test(key)) {
    throw new Error(`Refusing to touch storage with an unsafe PDF key: "${key}"`)
  }
  return key
}

/**
 * What every driver must do.
 *
 * `get` returns a Buffer rather than a stream, and that is a deliberate
 * limitation with a number behind it: uploads are capped at 10 MB
 * (`middleware/upload.ts`), every existing consumer — `validatePDF`,
 * `extractFieldsFromPDF`, `embedFieldsInPDF` — needs the whole document in
 * memory anyway because `pdf-lib` parses a complete buffer, and a streaming API
 * that every caller immediately drains is a more complicated interface bought
 * for nothing. `getStream` exists separately for the one caller that genuinely
 * streams: the signed download route, which should not hold a document in
 * memory just to write it to a socket.
 */
export interface PdfStorageDriver {
  /** Stores `body` under `key`, overwriting any object already there. */
  put(key: string, body: Buffer): Promise<void>
  /** The whole document. Throws if it is not there — callers check `exists` first. */
  get(key: string): Promise<Buffer>
  /** For serving. Returns `null` when the object does not exist. */
  getStream(key: string): Promise<Readable | null>
  exists(key: string): Promise<boolean>
  /** Removes the object. Succeeds when it was already gone. */
  remove(key: string): Promise<void>
}

/**
 * The local-filesystem driver — what this application has always done, now
 * behind an interface.
 *
 * It stays the **default**, and that is what makes this feature deployable in
 * stages and revertible by an environment variable rather than a git revert. It
 * is also what keeps the test suites offline: `tests/security-headers.spec.ts`
 * writes a real fixture into `uploads/pdfs` and reads it back through the signed
 * route, and the E2E suite uploads real PDFs. Requiring credentials and a
 * network for that would take `npm test` away from anyone without a bucket.
 */
export class LocalPdfStorage implements PdfStorageDriver {
  private readonly directory: string

  constructor(directory = path.join(process.cwd(), 'uploads', 'pdfs')) {
    this.directory = directory
    // Created eagerly, as `middleware/upload.ts` used to: multer's disk storage
    // does not create its own destination, and the first upload on a fresh
    // checkout would otherwise fail.
    fs.mkdirSync(this.directory, { recursive: true })
  }

  /** The only place a PDF path is built. */
  pathFor(key: string): string {
    return path.join(this.directory, assertKey(key))
  }

  /**
   * Written to a temporary name and renamed into place.
   *
   * `writeFile` truncates and then fills, so a concurrent reader — the signed
   * download route, or another request's embed — can observe a half-written
   * document and treat a truncated PDF as a real one. `rename` within one
   * directory is atomic on POSIX and on NTFS, so a reader sees either the whole
   * old document or the whole new one and never something in between.
   *
   * This matters more after features/0016 than before it: the same interface is
   * about to be backed by an object store, where a `PUT` is atomic per object,
   * and the local driver should not be the one with weaker guarantees.
   */
  async put(key: string, body: Buffer): Promise<void> {
    const target = this.pathFor(key)
    // Same directory, so the rename cannot cross a filesystem boundary — which
    // is the one case where it would stop being atomic.
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`

    await fsp.writeFile(temporary, body)

    try {
      await renameWithRetry(temporary, target)
    } catch (error) {
      await fsp.unlink(temporary).catch(() => undefined)
      throw error
    }
  }

  async get(key: string): Promise<Buffer> {
    return fsp.readFile(this.pathFor(key))
  }


  async getStream(key: string): Promise<Readable | null> {
    const file = this.pathFor(key)
    if (!(await this.exists(key))) return null
    return fs.createReadStream(file)
  }

  async exists(key: string): Promise<boolean> {
    // Resolved **outside** the try, so an unsafe key throws instead of being
    // reported as "not there". The catch below is for one question — is the
    // file present — and swallowing a key-validation failure into `false` would
    // send a caller down the silent "no PDF, skip the work" path with a name
    // that should have stopped the request. The S3 driver rethrows non-404s for
    // the same reason.
    const file = this.pathFor(key)

    try {
      await fsp.access(file)
      return true
    } catch {
      return false
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await fsp.unlink(this.pathFor(key))
    } catch (error) {
      // Already gone is success: `remove` is called on cleanup paths where the
      // file may never have been written, and turning that into an error would
      // make a failed upload report a second, more confusing failure.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}

/**
 * The S3-compatible driver — AWS S3, Cloudflare R2, MinIO, anything speaking the
 * same API.
 *
 * One driver for all of them rather than one per provider, because the
 * difference between them is an endpoint and a credential, not a protocol.
 * `forcePathStyle` is what makes MinIO work: AWS addresses buckets as
 * `<bucket>.s3.amazonaws.com`, and a local MinIO has no wildcard DNS, so the
 * bucket has to go in the path instead.
 *
 * **The client is not constructed until this driver is selected**, so a
 * deployment on the `local` driver — which includes every test run — never
 * builds an AWS client or looks for credentials. Same reasoning as the lazy
 * Stripe client in `services/stripe.ts`: optional infrastructure must not be a
 * boot requirement.
 */
export class S3PdfStorage implements PdfStorageDriver {
  private readonly client: S3Client
  private readonly bucket: string
  private readonly prefix: string

  constructor(config: {
    bucket: string
    region: string
    endpoint?: string
    accessKeyId?: string
    secretAccessKey?: string
    forcePathStyle?: boolean
    prefix?: string
  }) {
    this.bucket = config.bucket
    // Keys are namespaced so a bucket shared with anything else stays legible,
    // and so a lifecycle rule can target this prefix alone.
    this.prefix = config.prefix ?? 'pdfs/'

    this.client = new S3Client({
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      ...(config.forcePathStyle ? { forcePathStyle: true } : {}),
      // Omitted entirely when not configured, so the SDK falls back to its own
      // chain — instance roles, IRSA, `~/.aws/credentials`. A deployment on IAM
      // should not have to invent an access key to satisfy this constructor.
      ...(config.accessKeyId && config.secretAccessKey
        ? {
            credentials: {
              accessKeyId: config.accessKeyId,
              secretAccessKey: config.secretAccessKey
            }
          }
        : {})
    })
  }

  private objectKey(key: string): string {
    return `${this.prefix}${assertKey(key)}`
  }

  async put(key: string, body: Buffer): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.objectKey(key),
        Body: body,
        // Recorded on the object, but **not** what the browser is told: the
        // signed route sets its own headers on the way out (`app.ts`), because
        // the bytes are attacker-supplied and the CSP, `nosniff` and
        // `X-Frame-Options` that neutralise them must not depend on whoever
        // uploaded the object having asked for them (features/0016, trap 3).
        ContentType: 'application/pdf'
      })
    )
  }

  async get(key: string): Promise<Buffer> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) })
    )

    if (!result.Body) throw new Error(`Empty body for PDF "${key}"`)
    return Buffer.from(await result.Body.transformToByteArray())
  }

  async getStream(key: string): Promise<Readable | null> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) })
      )
      return (result.Body as Readable) ?? null
    } catch (error) {
      if (isNotFound(error)) return null
      throw error
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) })
      )
      return true
    } catch (error) {
      if (isNotFound(error)) return false
      // A credentials or network failure must not be reported as "the file is
      // not there": the callers of `exists` skip their work silently when it
      // answers false, so a misconfigured bucket would look like every form
      // having lost its PDF.
      throw error
    }
  }

  async remove(key: string): Promise<void> {
    // S3 delete is idempotent; a missing key is not an error, which matches the
    // local driver's contract.
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) })
    )
  }
}

/** S3 reports a missing object as 404/NoSuchKey/NotFound depending on the call. */
function isNotFound(error: unknown): boolean {
  const err = error as { name?: string; $metadata?: { httpStatusCode?: number } }
  return (
    err?.$metadata?.httpStatusCode === 404 ||
    err?.name === 'NoSuchKey' ||
    err?.name === 'NotFound'
  )
}

/**
 * `rename`, retried briefly — because Windows refuses it while the destination
 * is open.
 *
 * POSIX replaces an open file happily: readers keep the old inode and see a
 * consistent document to the end. Windows returns `EPERM`/`EBUSY` instead, so
 * on a developer machine an embed that lands while somebody is downloading the
 * same PDF fails outright — which is not hypothetical, it is what the atomicity
 * test in `tests/pdf-storage.spec.ts` reproduces on the first run.
 *
 * The reads it collides with are milliseconds long, so a short bounded retry
 * clears it. This is a portability accommodation and not a lock: if the retries
 * are exhausted the error propagates, and the caller (`embedFieldsInPDF`, which
 * is best-effort by design) logs it and leaves the stored PDF as it was. The
 * fields are already in the database either way, which is the copy that
 * matters.
 */
async function renameWithRetry(from: string, to: string, attempts = 10): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await fsp.rename(from, to)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      const transient = code === 'EPERM' || code === 'EBUSY' || code === 'EACCES'

      if (!transient || attempt >= attempts) throw error

      await new Promise(resolve => setTimeout(resolve, 10 * attempt))
    }
  }
}

let driver: PdfStorageDriver | null = null

/**
 * The driver this deployment uses.
 *
 * Read once and memoised, unlike `DEV_PLAN_KEY` and the rate limits, which are
 * read per call so a test can swap them. Storage is different: a driver holds a
 * client and a connection, and rebuilding it per request would be wasteful.
 * `resetPdfStorage` is the escape hatch the suites use instead.
 */
export function pdfStorage(): PdfStorageDriver {
  if (driver) return driver

  driver = buildDriver()
  return driver
}

/**
 * Builds the driver `PDF_STORAGE_DRIVER` names.
 *
 * **An unrecognised value refuses to boot**, and that is the opposite of how
 * `resolvePlan` and `envInt` treat bad configuration. The difference is what
 * the failure costs. A bad plan key degrades to the free plan: somebody is
 * briefly on the wrong tier and a log line says so. A bad storage driver that
 * silently fell back to `local` would accept uploads onto the container's disk
 * and lose them at the next deploy — a data-loss default, not a conservative
 * one. There is no safe direction to guess in, so it does not guess.
 */
function buildDriver(): PdfStorageDriver {
  const requested = process.env.PDF_STORAGE_DRIVER?.trim() || 'local'

  if (requested === 'local') return new LocalPdfStorage()

  if (requested === 's3') {
    const bucket = process.env.PDF_STORAGE_BUCKET?.trim()

    if (!bucket) {
      throw new Error(
        'PDF_STORAGE_DRIVER=s3 requires PDF_STORAGE_BUCKET. Refusing to start ' +
        'rather than fall back to local disk, which would accept uploads and ' +
        'lose them on the next deploy.'
      )
    }

    return new S3PdfStorage({
      bucket,
      region: process.env.PDF_STORAGE_REGION?.trim() || 'auto',
      endpoint: process.env.PDF_STORAGE_ENDPOINT?.trim() || undefined,
      accessKeyId: process.env.PDF_STORAGE_ACCESS_KEY_ID?.trim() || undefined,
      secretAccessKey: process.env.PDF_STORAGE_SECRET_ACCESS_KEY?.trim() || undefined,
      forcePathStyle: envBool('PDF_STORAGE_FORCE_PATH_STYLE', false),
      prefix: process.env.PDF_STORAGE_PREFIX?.trim() || undefined
    })
  }

  throw new Error(
    `Unknown PDF_STORAGE_DRIVER="${requested}". Expected "local" or "s3".`
  )
}

/** Only for tests, and for the driver selection added in step 3. */
export function setPdfStorage(next: PdfStorageDriver | null): void {
  driver = next
}
