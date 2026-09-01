import crypto from 'crypto'
import { prisma } from './db.js'

/**
 * API keys: the one credential in this product that authenticates an
 * organization rather than a person (features/0019).
 *
 * The raw secret exists in exactly two places and never in a third: the
 * response that created it, and the customer's own storage. What this database
 * holds is a SHA-256 of it, so a database leak is not a set of live
 * credentials.
 *
 * ## Why not bcrypt, when passwords use it
 *
 * `routes/auth.ts` hashes passwords with bcrypt because a human-chosen password
 * has little entropy and a slow hash is what buys the margin. Neither applies
 * here, and one thing actively argues the other way: **a key is verified on
 * every single API request**, so a deliberately slow hash is a CPU sink an
 * attacker feeds with invalid keys, from behind whatever rate limit the API
 * publishes. `services/refresh-token.ts` reached the same conclusion for the
 * same reason and this is the second place it holds - see the note on
 * `RefreshToken` in `schema.prisma`. There is nothing to brute force in 256
 * bits of CSPRNG output.
 *
 * ## The shape of the secret
 *
 * `vpk_<prefix>_<secret>` — the prefix is stored and indexed, the secret is
 * hashed. Verification is one lookup by prefix plus one constant-time
 * comparison, rather than hashing the presented value against every key in the
 * table, which would get slower with every customer.
 *
 * **The prefix is hex and the secret is base64url**, and that asymmetry is
 * load-bearing rather than aesthetic: base64url's alphabet includes `_`, so a
 * parser that splits the credential on underscores cuts a random fraction of
 * secrets in half. It is a bug that fails on *some* keys and not others - the
 * first draft of this file had it, and it showed up as a handful of tests
 * rejecting a perfectly good key while the rest passed. The prefix stays out of
 * that alphabet and the secret is taken as everything after the second
 * separator, so its own underscores are simply part of it.
 *
 * The `vpk_` marker is not decoration: it is what makes a leaked key
 * recognisable in a log, a paste or a repository scan as *this product's*
 * credential, so it can be reported and revoked rather than sitting unnoticed.
 */

/** Bytes behind the secret half. 32 is 256 bits, matching refresh tokens. */
const SECRET_BYTES = 32

/** Bytes behind the public prefix, rendered as hex. Long enough not to collide. */
const PREFIX_BYTES = 6

const KEY_MARKER = 'vpk'

export interface MintedApiKey {
  id: string
  name: string
  prefix: string
  /**
   * **The only time this value exists.** It is not stored, and there is no
   * endpoint that can return it again.
   */
  secret: string
  createdAt: Date
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

/**
 * Splits a presented credential into its parts.
 *
 * Returns `null` for anything that is not shaped like one of ours, which is the
 * cheap rejection: a malformed header never reaches the database.
 */
const KEY_SHAPE = new RegExp(`^${KEY_MARKER}_([0-9a-f]+)_(.+)$`)

export function parseApiKey(presented: string): { prefix: string; secret: string } | null {
  const match = KEY_SHAPE.exec(presented.trim())
  if (!match) return null

  // The secret is *the rest of the string*, underscores included.
  return { prefix: match[1] as string, secret: match[2] as string }
}

/** Creates a key for an organization and returns the secret **once**. */
export async function mintApiKey(input: {
  organizationId: string
  name: string
  createdByUserId?: string | null
}): Promise<MintedApiKey> {
  const prefix = crypto.randomBytes(PREFIX_BYTES).toString('hex')
  const secret = crypto.randomBytes(SECRET_BYTES).toString('base64url')

  const record = await prisma.apiKey.create({
    data: {
      organizationId: input.organizationId,
      name: input.name,
      prefix,
      hash: sha256(secret),
      createdByUserId: input.createdByUserId ?? null
    },
    select: { id: true, name: true, prefix: true, createdAt: true }
  })

  return { ...record, secret: `${KEY_MARKER}_${prefix}_${secret}` }
}

export interface VerifiedApiKey {
  id: string
  organizationId: string
  /** Carried out so the caller can decide whether it is worth writing. */
  lastUsedAt: Date | null
}

/**
 * Checks a presented credential and returns what it authenticates.
 *
 * `null` for every kind of failure - malformed, unknown, wrong secret, revoked
 * - and deliberately without saying which. The caller answers `401` either way;
 * distinguishing them would tell someone probing whether a prefix they found
 * belongs to a real key.
 *
 * **Every call reads the row**, which is what makes revocation immediate. There
 * is no cache here on purpose: a cached key is a key that keeps working after a
 * customer has revoked it, which is the one thing this credential must never
 * do.
 */
export async function verifyApiKey(presented: string): Promise<VerifiedApiKey | null> {
  const parsed = parseApiKey(presented)
  if (!parsed) return null

  const record = await prisma.apiKey.findUnique({
    where: { prefix: parsed.prefix },
    select: {
      id: true,
      organizationId: true,
      hash: true,
      revokedAt: true,
      lastUsedAt: true
    }
  })

  if (!record || record.revokedAt) return null
  if (!timingSafeEquals(record.hash, sha256(parsed.secret))) return null

  return {
    id: record.id,
    organizationId: record.organizationId,
    lastUsedAt: record.lastUsedAt
  }
}

/**
 * Constant-time comparison of two hex digests.
 *
 * `timingSafeEqual` throws on a length mismatch, which would itself leak - so
 * the lengths are compared first and both sides are hashes, which are always
 * the same length anyway.
 */
function timingSafeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) return false

  return crypto.timingSafeEqual(left, right)
}

/** How stale `lastUsedAt` is allowed to get. */
const LAST_USED_INTERVAL_MS = 60_000

/**
 * Notes that a key was used, at most once a minute per key.
 *
 * `lastUsedAt` is what lets a customer tell a live integration from a forgotten
 * credential before revoking it, so it has to be written - but a public API is
 * mostly reads, and writing this row on every one of them would turn every read
 * into a write on a row every request already contends for. A minute of
 * staleness costs nothing to the only question this column answers.
 *
 * Failures are swallowed: this is bookkeeping, and an API request must not fail
 * because bookkeeping did. Deliberately **not** awaited by the caller.
 */
export async function touchApiKey(id: string, lastUsedAt: Date | null): Promise<void> {
  if (lastUsedAt && Date.now() - lastUsedAt.getTime() < LAST_USED_INTERVAL_MS) return

  try {
    await prisma.apiKey.update({ where: { id }, data: { lastUsedAt: new Date() } })
  } catch (error) {
    console.error('Could not record API key usage:', error)
  }
}
