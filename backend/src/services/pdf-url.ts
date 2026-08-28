import crypto from 'crypto'
import { envInt } from '../config/env.js'

/**
 * The one audited place where an uploaded PDF's URL is produced, parsed or
 * verified — the same rule `services/pattern-validator.ts` follows for regex
 * (docs/sot/04-backend-patterns.md §8). Nothing else may split a `pdfUrl` on
 * `/` or build an `/uploads` path by hand.
 *
 * Why a signed URL rather than authentication: the PDF has to be fetchable by
 * an anonymous respondent on the public form, and the editor's own download
 * paths (`FormsList.vue`, `FormsManagementView.vue`) use a bare `fetch` with no
 * Authorization header. A capability carried in the URL is the only shape that
 * serves both.
 *
 * Why the signature is a path segment and not `?token=`: three places in the
 * frontend derive a display filename with `url.split('/').pop()`. A query string
 * makes all three return `<file>.pdf?token=…`, which silently breaks the
 * document-to-form matching in `FormSavePanel.vue`. Keeping the signature in
 * its own segment *before* the filename leaves `.pop()` returning exactly what
 * it returns today.
 */

/**
 * Uploaded filenames are `nanoid(12)-<timestamp>.pdf`, and nanoid's default
 * alphabet is exactly `A-Za-z0-9_-`. Anything else never came from
 * `middleware/upload.ts` and is refused before it can reach the filesystem.
 */
const SAFE_FILENAME = /^[A-Za-z0-9_-]+\.pdf$/

/**
 * Domain separation. Without it this would be the JWT signing key used for a
 * second purpose, and a token minted for one system could be replayed at the
 * other if their message formats ever collided.
 */
const KEY_INFO = 'vuepdf:pdf-url:v1'

/**
 * Derived per call, never at module load and never memoised.
 *
 * At module load `process.env.JWT_SECRET` is not reliable: ES imports are
 * hoisted above the guard in `app.ts` that refuses to boot without it, so the
 * read would happen first and get `undefined`. Memoising would also freeze the
 * key against `vi.stubEnv`, which is how the suites configure the environment
 * (docs/sot/09-quality-and-testing.md). `middleware/auth.ts` reads the secret at
 * call time for the same reason. An HMAC over a 17-byte string costs nothing.
 */
function signingKey(): Buffer {
  return crypto
    .createHmac('sha256', process.env.JWT_SECRET!)
    .update(KEY_INFO)
    .digest()
}

function baseUrl(): string {
  return process.env.BASE_URL || 'http://localhost:3000'
}

function ttlSeconds(): number {
  return envInt('UPLOAD_URL_TTL_SECONDS', 900, 60)
}

function hmac(filename: string, exp: number): string {
  return crypto
    .createHmac('sha256', signingKey())
    .update(`${filename}:${exp}`)
    .digest('hex')
}

/**
 * The filename inside any of the shapes a `pdfUrl` can take: a canonical URL, a
 * signed URL, or a bare filename. Returns `null` — never a string to be joined
 * onto a path — when the last segment is not a filename this service could have
 * issued.
 */
export function pdfFilenameFrom(url: string | null | undefined): string | null {
  if (!url) return null

  const lastSegment = url.split('/').pop() ?? ''
  const withoutQuery = lastSegment.split(/[?#]/)[0] ?? ''

  return SAFE_FILENAME.test(withoutQuery) ? withoutQuery : null
}

/**
 * The unsigned form, and the only form that may be written to `Form.pdfUrl`.
 *
 * A signed URL must never be persisted: the column is written once at upload and
 * read forever after, so a signature stored there stops verifying one TTL later
 * and the form is permanently broken. Every write path runs its input through
 * this.
 */
export function canonicalPdfUrl(url: string | null | undefined): string | null {
  const filename = pdfFilenameFrom(url)
  if (!filename) return null

  return `${baseUrl()}/uploads/pdfs/${filename}`
}

/**
 * A capability URL valid for `UPLOAD_URL_TTL_SECONDS`. Minted fresh on every
 * read of a form; never stored.
 */
export function signPdfUrl(url: string | null | undefined): string | null {
  const filename = pdfFilenameFrom(url)
  if (!filename) return null

  const exp = Math.floor(Date.now() / 1000) + ttlSeconds()

  return `${baseUrl()}/uploads/pdfs/${exp}.${hmac(filename, exp)}/${filename}`
}

export type TokenVerdict = 'ok' | 'invalid' | 'expired'

/**
 * `expired` is reported separately from `invalid` so the route can log the
 * difference, but both must reach the client as the same 403: telling an
 * attacker that their forged signature was correct and only stale is a hint
 * they have no other way to get, and a legitimate client's remedy — reload the
 * form to get a fresh link — is identical either way.
 */
export function verifyPdfToken(token: string, filename: string): TokenVerdict {
  const separator = token.indexOf('.')
  if (separator < 1) return 'invalid'

  const expPart = token.slice(0, separator)
  const signature = token.slice(separator + 1)

  if (!/^\d+$/.test(expPart)) return 'invalid'
  const exp = Number(expPart)
  if (!Number.isSafeInteger(exp)) return 'invalid'

  const expected = hmac(filename, exp)

  // timingSafeEqual throws on a length mismatch, so the length is checked
  // first — and a wrong length is already a wrong signature.
  const given = Buffer.from(signature, 'utf8')
  const want = Buffer.from(expected, 'utf8')
  if (given.length !== want.length) return 'invalid'
  if (!crypto.timingSafeEqual(given, want)) return 'invalid'

  return exp * 1000 > Date.now() ? 'ok' : 'expired'
}
