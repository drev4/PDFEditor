import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import { Readable } from 'stream'

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
      await fsp.rename(temporary, target)
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
    try {
      await fsp.access(this.pathFor(key))
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

  driver = new LocalPdfStorage()
  return driver
}

/** Only for tests, and for the driver selection added in step 3. */
export function setPdfStorage(next: PdfStorageDriver | null): void {
  driver = next
}
