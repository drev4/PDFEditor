import crypto from 'crypto'
import { MembershipRole, Prisma } from '@prisma/client'
import { prisma } from './db.js'
import { envInt } from '../config/env.js'

/**
 * Invitation tokens.
 *
 * The same shape as `refresh-token.ts`, for the same reasons: a random token,
 * stored only as a SHA-256, revocable through a database column. A JWT would
 * have been the cheap answer and would have been wrong — it cannot be
 * cancelled, and an invitation that cannot be cancelled before it is accepted
 * is a permanent key handed to an address someone may have mistyped.
 *
 * The token reaches its recipient in a link the inviter copies and sends
 * themselves; this service has no way to send email. That makes the link a
 * bearer capability, so it expires and is single-use.
 */

const TOKEN_BYTES = 32

export function invitationTtlMs(): number {
  // Three days by default. Long enough for someone to get round to it, short
  // enough that a link forwarded into a group chat stops working before anyone
  // has forgotten it is there.
  return envInt('INVITATION_TTL_HOURS', 72, 1) * 60 * 60 * 1000
}

function hash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

/** Addresses are compared case-insensitively; `A@x.com` and `a@x.com` are one person. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export interface IssuedInvitation {
  id: string
  token: string
  expiresAt: Date
}

/**
 * `tx` is the client the row is inserted with, and defaults to `prisma`.
 *
 * `POST /api/organizations/invitations` passes the transaction it opened around
 * `assertCanInvite`, so the seat count and the insert are one unit: counting in
 * a different transaction from the write is what let two invitations share the
 * last seat (features/0027).
 */
export async function createInvitation(
  params: {
    organizationId: string
    email: string
    role: MembershipRole
    invitedByUserId: string
  },
  tx: Prisma.TransactionClient = prisma
): Promise<IssuedInvitation> {
  const token = crypto.randomBytes(TOKEN_BYTES).toString('base64url')
  const expiresAt = new Date(Date.now() + invitationTtlMs())

  const invitation = await tx.invitation.create({
    data: {
      organizationId: params.organizationId,
      email: normalizeEmail(params.email),
      role: params.role,
      tokenHash: hash(token),
      expiresAt,
      invitedByUserId: params.invitedByUserId
    }
  })

  // The only moment the raw token exists. It is never stored and cannot be
  // recovered — a lost link has to be revoked and reissued.
  return { id: invitation.id, token, expiresAt }
}

export type RedeemableInvitation = {
  id: string
  organizationId: string
  email: string
  role: MembershipRole
}

/**
 * The invitation a token refers to, if it can still be spent.
 *
 * Returns `null` for unknown, expired, revoked and already-accepted alike. The
 * caller must not distinguish them in its response, for the same reason
 * `POST /api/auth/refresh` does not: telling the difference turns this into an
 * oracle for probing tokens someone is holding.
 */
export async function findRedeemable(token: string): Promise<RedeemableInvitation | null> {
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hash(token) },
    select: {
      id: true,
      organizationId: true,
      email: true,
      role: true,
      expiresAt: true,
      revokedAt: true,
      acceptedAt: true
    }
  })

  if (!invitation) return null
  if (invitation.revokedAt || invitation.acceptedAt) return null
  if (invitation.expiresAt.getTime() <= Date.now()) return null

  return {
    id: invitation.id,
    organizationId: invitation.organizationId,
    email: invitation.email,
    role: invitation.role
  }
}

/** Builds the link the inviter copies. There is nothing to send it with. */
export function invitationLink(token: string): string {
  const base = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '')
  return `${base}/invitations/${token}`
}
