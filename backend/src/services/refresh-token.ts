import crypto from 'crypto'
import { prisma } from './db.js'
import { envInt } from '../config/env.js'

/**
 * Refresh tokens: the part of a session that can be taken away.
 *
 * Access tokens are stateless JWTs and stay that way — verifying one must not
 * cost a database round trip on every authenticated request. The consequence is
 * that an access token cannot be revoked, which is only acceptable because it is
 * short-lived. Everything that ends a session early acts here instead: logout,
 * rotation, and reuse detection.
 *
 * The raw token never leaves this module except as a return value, and is never
 * stored. What is stored is a SHA-256 of it. See the note on `RefreshToken` in
 * schema.prisma for why a fast hash is the right choice here and nowhere else in
 * this codebase.
 */

/** Bytes of CSPRNG output behind each token. 32 is 256 bits. */
const TOKEN_BYTES = 32

export function refreshTokenTtlMs(): number {
  // Default 7 days, matching the session length users had before this existed —
  // the change is that it is now revocable, not that it is shorter. The access
  // token is the thing that got short.
  return envInt('REFRESH_TOKEN_TTL_DAYS', 7, 1) * 24 * 60 * 60 * 1000
}

function hash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function newToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url')
}

export interface IssuedRefreshToken {
  token: string
  expiresAt: Date
}

/**
 * Starts a new session family. Called on login and registration — never on
 * refresh, which continues an existing family.
 */
export async function issueRefreshToken(userId: string): Promise<IssuedRefreshToken> {
  return createInFamily(userId, crypto.randomUUID())
}

async function createInFamily(
  userId: string,
  family: string,
  tx: { refreshToken: { create: Function } } = prisma
): Promise<IssuedRefreshToken> {
  const token = newToken()
  const expiresAt = new Date(Date.now() + refreshTokenTtlMs())

  await tx.refreshToken.create({
    data: { userId, family, tokenHash: hash(token), expiresAt }
  })

  return { token, expiresAt }
}

export type RotateResult =
  | { ok: true; userId: string; token: string; expiresAt: Date }
  /**
   * Every failure is one reason to the caller. The route must not tell the
   * client which of these happened: "unknown", "expired" and "replayed" would
   * otherwise let someone probe whether a captured token was ever valid.
   */
  | { ok: false; reason: 'invalid' | 'expired' | 'reused' }

/**
 * Exchanges a refresh token for the next one in its family, and reports replay.
 *
 * The revoke-and-create pair runs in a transaction: a crash between them would
 * otherwise leave a session whose only refresh token is revoked, which logs the
 * user out with no way to tell why.
 */
export async function rotateRefreshToken(rawToken: string): Promise<RotateResult> {
  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash: hash(rawToken) }
  })

  if (!existing) return { ok: false, reason: 'invalid' }

  if (existing.revokedAt) {
    // This token was already exchanged. Either it was captured and replayed, or
    // the legitimate client retried after its replacement was already issued.
    // The two are indistinguishable from here, so treat it as compromise and
    // end the whole family — the legitimate user logs in again, the attacker
    // gets nothing. Silently allowing it is what makes rotation pointless.
    await revokeFamily(existing.family)
    return { ok: false, reason: 'reused' }
  }

  if (existing.expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: 'expired' }
  }

  const issued = await prisma.$transaction(async tx => {
    await tx.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() }
    })
    return createInFamily(existing.userId, existing.family, tx as never)
  })

  return { ok: true, userId: existing.userId, token: issued.token, expiresAt: issued.expiresAt }
}

/** Ends every session descended from one login. */
export async function revokeFamily(family: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { family, revokedAt: null },
    data: { revokedAt: new Date() }
  })
}

/**
 * Logout. Revokes the whole family rather than the single row, so a refresh
 * token captured earlier in the same session stops working too — which is the
 * only thing that makes "log me out" mean anything to someone who suspects
 * their session was stolen.
 *
 * Returns quietly for a token that does not resolve: logging out is not a place
 * to tell the caller whether a token was real.
 */
export async function revokeSession(rawToken: string): Promise<void> {
  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash: hash(rawToken) },
    select: { family: true }
  })

  if (existing) await revokeFamily(existing.family)
}

/** Ends every session for a user, across all families. */
export async function revokeAllForUser(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() }
  })
}
