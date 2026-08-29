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
 * The caller's membership, or `404`.
 *
 * Every account belongs to exactly one organization today, so there is nothing
 * to choose between. When a user can belong to several, this is the single
 * place that has to learn how the active one is selected, and the oldest
 * membership stops being the right answer.
 */
export async function requireMembership(req: AuthRequest): Promise<CallerMembership> {
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
