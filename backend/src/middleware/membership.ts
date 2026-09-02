import { MembershipRole } from '@prisma/client'
import { prisma } from '../services/db.js'
import { AppError } from './errorHandler.js'
import type { AuthRequest } from './auth.js'

/**
 * Membership and role checks.
 *
 * Separate from `formOwnership.ts`, which is about reaching a *form*. This is
 * about what a person may do inside an *organization*, and the two rejections
 * are different in a way that matters:
 *
 *   - **Not a member → 404.** Unchanged from features/0009. A `403` would
 *     confirm the resource exists and turn the endpoint into an existence
 *     oracle.
 *   - **A member without the role → 403.** They already know it exists — they
 *     are inside the organization. Hiding it would tell them nothing and only
 *     make the product feel broken. The message names what is required.
 *
 * Both are called explicitly inside handlers, like `verifyFormOwnership`, never
 * mounted as a blanket layer. See docs/sot/04-backend-patterns.md §9.
 */

export interface CallerMembership {
  organizationId: string
  role: MembershipRole
}

/**
 * The caller's membership in the organization they are **acting in**, or `404`.
 *
 * This is the single place that decides which organization a request acts in,
 * and it is the only thing in the codebase that may read
 * `User.activeOrganizationId` (features/0023). Everything else — routes,
 * services, the form scope in `formOwnership.ts` — asks here.
 *
 * It used to take the oldest membership, on the premise that every account
 * belonged to exactly one organization. Invitations broke that premise: a person
 * who already had an account keeps their personal organization and gains a
 * second membership, and the two rules that then answered "which organization?"
 * disagreed — reads spanned both, writes took the oldest.
 *
 * **`activeOrganizationId` is a cache of a choice, never a grant.** It is used
 * only to *select* among memberships that already exist:
 *
 *   - if the caller still has a live `Membership` there, that is the active one;
 *   - otherwise it is ignored and the oldest membership is used, exactly as
 *     before.
 *
 * Both halves are load-bearing. The first makes removal effective on the very
 * next request, with no session to expire and no cleanup job to run. The second
 * is why a stale or hand-edited column cannot become access: it can never widen
 * what the caller may reach, only choose among it.
 */
export async function requireMembership(req: AuthRequest): Promise<CallerMembership> {
  const active = await activeMembership(req.userId)
  if (active) return active

  const membership = await prisma.membership.findFirst({
    where: { userId: req.userId },
    orderBy: { createdAt: 'asc' },
    select: { organizationId: true, role: true }
  })

  if (!membership) {
    throw new AppError(404, 'Not found')
  }

  return membership
}

/**
 * The membership named by the caller's chosen organization, if it is still real.
 *
 * `null` covers all three of "never chose", "the organization is gone" and "they
 * are no longer a member", and every one of them falls through to the oldest
 * membership rather than failing — a choice that has stopped being valid is not
 * an error, it is simply not a choice any more.
 */
async function activeMembership(userId: string | undefined): Promise<CallerMembership | null> {
  if (!userId) return null

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { activeOrganizationId: true }
  })

  if (!user?.activeOrganizationId) return null

  // Scoped by both ids: this asks whether the membership exists, and never
  // trusts the column on its own.
  return prisma.membership.findFirst({
    where: { userId, organizationId: user.activeOrganizationId },
    select: { organizationId: true, role: true }
  })
}

/** The organization a newly created resource belongs to. */
export async function requireOrganizationId(req: AuthRequest): Promise<string> {
  const { organizationId } = await requireMembership(req)
  return organizationId
}

const ROLE_LABEL: Record<MembershipRole, string> = {
  owner: 'owner',
  admin: 'administrator',
  member: 'member'
}

/**
 * The caller's membership, provided their role is one of `allowed`.
 *
 * Throws `404` when they are not in an organization at all, and `403` when they
 * are but may not do this.
 */
export async function requireRole(
  req: AuthRequest,
  allowed: MembershipRole[]
): Promise<CallerMembership> {
  const membership = await requireMembership(req)

  if (!allowed.includes(membership.role)) {
    const required = allowed.map(r => ROLE_LABEL[r]).join(' or ')
    throw new AppError(403, `This action requires the ${required} role`)
  }

  return membership
}

/**
 * Refuses to leave an organization with no owner.
 *
 * An organization with zero owners cannot be administered, billed or deleted,
 * and nothing in this product can repair one — there is no support tooling and
 * no way for a member to promote themselves. It is reachable by the last owner
 * demoting themselves, removing themselves, or having their account deleted;
 * this guards the first two. The third depends on account deletion (S8) and is
 * tracked in docs/BACKLOG.md.
 *
 * Call before any change that could remove an owner.
 */
export async function assertNotLastOwner(
  organizationId: string,
  userId: string,
  action: 'remove' | 'demote'
): Promise<void> {
  const owners = await prisma.membership.count({
    where: { organizationId, role: 'owner' }
  })

  if (owners > 1) return

  const isTheOwner = await prisma.membership.findFirst({
    where: { organizationId, userId, role: 'owner' },
    select: { id: true }
  })

  if (isTheOwner) {
    throw new AppError(
      400,
      action === 'demote'
        ? 'This is the only owner. Make someone else an owner before changing this role.'
        : 'This is the only owner. Make someone else an owner before removing them.'
    )
  }
}
