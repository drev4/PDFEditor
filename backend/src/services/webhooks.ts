import crypto from 'crypto'
import { AppError } from '../middleware/errorHandler.js'

/**
 * Webhook endpoints: their secrets, and the signature a customer verifies
 * (features/0020).
 *
 * ## Why the secret is encrypted rather than hashed
 *
 * `services/api-key.ts` stores a SHA-256 and can, because an API key is only
 * ever *verified*. **A signing secret has to be used to sign**, so it has to be
 * recoverable, and hashing is simply not available. That makes
 * `webhook_endpoints.secret` the first live secret this application stores in a
 * row rather than in the environment, and pretending otherwise would be the
 * wrong way to handle it.
 *
 * It is encrypted with AES-256-GCM under `WEBHOOK_SIGNING_KEY`. The honest
 * scope of that, so nobody claims more later:
 *
 *   - it does **nothing** against a compromised application process, which has
 *     the key by definition;
 *   - it does **everything** against the far more common incident - a leaked
 *     backup, a snapshot handed to a contractor, a read-only SQL injection -
 *     where the database is obtained without the environment.
 *
 * And it is why webhooks refuse to be configured when the key is missing rather
 * than quietly storing plaintext: a security property that silently switches
 * itself off is worse than one that was never claimed.
 *
 * ## The signature
 *
 * `t=<unix seconds>,v1=<hex hmac-sha256>` over `<timestamp>.<raw body>` - the
 * same scheme this product already *verifies* from Stripe
 * (`services/stripe.ts`), because a customer implementing a receiver has
 * probably written that code once already.
 *
 * The timestamp is inside the signed material, which is what makes a captured
 * payload un-replayable: a receiver rejects an old `t` and the attacker cannot
 * move it without invalidating `v1`. And the reverse of features/0013's hardest
 * lesson applies - Stripe signs raw bytes and mounting the route under
 * `express.json()` broke every verification silently, so the documentation for
 * *our* signature has to tell customers to verify the **raw body**, not their
 * re-serialised JSON.
 */

const SECRET_BYTES = 32
const KEY_MARKER = 'whsec'

/** Bytes of the AES key. `WEBHOOK_SIGNING_KEY` must decode to exactly this. */
const KEY_BYTES = 32

/**
 * The key that encrypts stored secrets, or `null` when this deployment has
 * none.
 *
 * Read per call rather than memoised, like every other configuration in this
 * codebase that a test may want to set (`keyPrefix`, `DEV_PLAN_KEY`).
 */
export function signingKey(): Buffer | null {
  const raw = process.env.WEBHOOK_SIGNING_KEY?.trim()
  if (!raw) return null

  const key = Buffer.from(raw, 'base64')
  if (key.length !== KEY_BYTES) {
    // Logged rather than thrown, and treated as absent: a typo in an
    // environment variable must not take the API down, and the caller turns
    // this into a 503 that names the variable.
    console.error(
      `WEBHOOK_SIGNING_KEY must be ${KEY_BYTES} bytes of base64 (got ${key.length}); webhooks are disabled`
    )
    return null
  }

  return key
}

export function isWebhookSigningConfigured(): boolean {
  return signingKey() !== null
}

/** `iv.tag.ciphertext`, all base64url. */
export function encryptSecret(plaintext: string): string {
  const key = signingKey()
  if (!key) throw new AppError(503, 'Webhooks are not configured on this deployment')

  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])

  return [iv, cipher.getAuthTag(), ciphertext].map(part => part.toString('base64url')).join('.')
}

export function decryptSecret(stored: string): string {
  const key = signingKey()
  if (!key) throw new AppError(503, 'Webhooks are not configured on this deployment')

  const [iv, tag, ciphertext] = stored.split('.').map(part => Buffer.from(part, 'base64url'))
  if (!iv || !tag || !ciphertext) throw new Error('Stored webhook secret is malformed')

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

/**
 * A new secret, in the customer's hands once and encrypted for ours.
 *
 * The `whsec_` marker is the same idea as the API key's `vpk_`: a secret that
 * leaks into a log or a repository should be recognisable as *this product's*,
 * so it can be reported and rotated rather than sitting unnoticed.
 */
export function mintWebhookSecret(): { secret: string; stored: string } {
  const secret = `${KEY_MARKER}_${crypto.randomBytes(SECRET_BYTES).toString('base64url')}`
  return { secret, stored: encryptSecret(secret) }
}

export interface SignedPayload {
  body: string
  headers: Record<string, string>
}

/**
 * Renders the request a customer receives.
 *
 * The body is serialised **once**, here, and the same string is both signed and
 * sent — serialising twice is how a signature comes to cover bytes that were
 * never transmitted.
 */
export function signPayload(options: {
  secret: string
  eventId: string
  eventType: string
  payload: unknown
  timestamp?: number
}): SignedPayload {
  const body = JSON.stringify(options.payload)
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000)

  const signature = crypto
    .createHmac('sha256', options.secret)
    .update(`${timestamp}.${body}`)
    .digest('hex')

  return {
    body,
    headers: {
      'X-VuePDF-Signature': `t=${timestamp},v1=${signature}`,
      // Stable across retries, and documented as the deduplication key: delivery
      // is at-least-once, exactly as Stripe's is to us.
      'X-VuePDF-Event-Id': options.eventId,
      'X-VuePDF-Event-Type': options.eventType
    }
  }
}
