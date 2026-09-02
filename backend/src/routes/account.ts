import { Router } from 'express'
import { z } from 'zod'
import bcrypt from 'bcrypt'
import { prisma } from '../services/db.js'
import { AppError } from '../middleware/errorHandler.js'
import { authenticate, AuthRequest } from '../middleware/auth.js'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { clearRefreshCookie } from '../services/session-cookie.js'
import { cancelSubscriptionsForOrganizations } from '../services/stripe.js'
import { collectOrphanDocuments, keysReferencedBy } from '../services/pdf-gc.js'
import { logger } from '../services/logger.js'

export const accountRouter = Router()

const deleteAccountSchema = z.object({
  password: z.string().min(1)
})

/**
 * DELETE /api/account — erasure (features/0029, finding S8).
 *
 * ## What this destroys, in words
 *
 * The `User` row, which cascades its memberships and refresh tokens; every
 * organization where the caller is the **only** member, which cascades that
 * organization's forms, fields, responses, answers, usage counters, API keys,
 * webhook endpoints and subscription row; and the stored PDF of every deleted
 * form that no surviving form still references.
 *
 * ## And what it deliberately does not
 *
 * **An organization with other people in it is not the account holder's to
 * destroy.** Deleting one is, in the cascade map's words, "the largest blast
 * radius in this schema": for somebody who is one of five members of a company
 * organization, taking it with their account would delete their employer's data
 * because they closed a personal account.
 *
 * The reflex in the other direction is just as wrong. `Membership.user` cascades
 * and `Form.createdBy` is `SetNull`, so simply deleting the `User` row leaves the
 * organization, its forms and every response alive with **nobody able to reach
 * them** — a tenant with no members, which `docs/BACKLOG.md` has tracked as
 * reachable "via account deletion only" since features/0009.
 *
 * So the last owner of an organization that still has members or outstanding
 * invitations is **refused**, and told what to do about it. Refusing is the only
 * safe direction available: the alternatives are silently promoting somebody who
 * did not ask to be an owner, or silently destroying a company's data.
 *
 * ## Ordering, which is the whole design
 *
 * 1. Verify the password. A wrong one destroys nothing.
 * 2. Classify memberships; refuse if anything is blocked.
 * 3. Collect the storage keys **while the rows still exist**.
 * 4. Cancel at Stripe. A cascade cannot reach it, and doing this after the delete
 *    would leave a live subscription nothing in this database can name.
 * 5. Delete the rows, in one transaction.
 * 6. Remove the bytes, **after** the commit — a rollback following a removal
 *    would destroy a living form's document, and that is not recoverable.
 *
 * There is no grace period, deliberately. The business SSOT decided thirty days
 * (D-021) and **nothing in this codebase runs on a clock**: a `closedAt` marker
 * plus a promise to delete later would mean the deletion never happens while the
 * product tells the customer it has. That is a claim rather than a gap, which is
 * worse. The scheduler that would make D-021 real is filed in `docs/BACKLOG.md`.
 */
accountRouter.delete('/', authenticate, asyncHandler(async (req: AuthRequest, res, next) => {
  const validation = deleteAccountSchema.safeParse(req.body)
  if (!validation.success) {
    throw new AppError(400, 'A password is required to delete an account')
  }

  const userId = req.userId!

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, passwordHash: true }
  })

  if (!user) throw new AppError(404, 'User not found')

  // Re-authentication, not authorization. The access token proves the session;
  // this proves the person at the keyboard, for an action with no undo.
  const correct = await bcrypt.compare(validation.data.password, user.passwordHash)
  if (!correct) {
    throw new AppError(401, 'Incorrect password')
  }

  const memberships = await prisma.membership.findMany({
    where: { userId },
    select: {
      role: true,
      organizationId: true,
      organization: {
        select: {
          id: true,
          name: true,
          _count: {
            select: {
              memberships: true,
              // Pending only. An expired or already-accepted invitation is not
              // somebody waiting to be let into an organization that is about
              // to disappear.
              invitations: { where: { revokedAt: null, acceptedAt: null, expiresAt: { gt: new Date() } } }
            }
          }
        }
      }
    }
  })

  const soleMember = memberships.filter(m => m.organization._count.memberships === 1)

  // Blocked: the caller is an owner, and somebody else is either in the
  // organization already or on their way in.
  const blocked = memberships.filter(m =>
    m.role === 'owner' &&
    (m.organization._count.memberships > 1 || m.organization._count.invitations > 0)
  )

  if (blocked.length > 0) {
    throw new AppError(
      409,
      `You are the last owner of ${blocked.map(m => `"${m.organization.name}"`).join(', ')}. ` +
      'Make somebody else an owner, or remove the remaining members and pending invitations, ' +
      'before deleting your account.'
    )
  }

  const organizationIds = soleMember.map(m => m.organizationId)

  // Read the keys before anything is deleted; afterwards the rows that name
  // them are gone (services/pdf-gc.ts).
  const forms = organizationIds.length
    ? await prisma.form.findMany({
        where: { organizationId: { in: organizationIds } },
        select: { pdfUrl: true }
      })
    : []
  const keys = keysReferencedBy(forms)

  // Before the rows, never after. A failure here abandons the deletion with the
  // account intact, which is recoverable; the reverse is not.
  try {
    await cancelSubscriptionsForOrganizations(organizationIds)
  } catch (error) {
    logger.error({ err: error, userId }, 'Could not cancel subscriptions; account deletion abandoned')
    throw new AppError(502, 'Could not cancel the subscription with the payment provider. Nothing was deleted; please try again.')
  }

  await prisma.$transaction(async tx => {
    // The organizations first: each cascades its forms, fields, responses,
    // answers, counters, keys, endpoints and subscription row. Then the user,
    // which cascades the remaining memberships and every refresh token.
    if (organizationIds.length > 0) {
      await tx.organization.deleteMany({ where: { id: { in: organizationIds } } })
    }

    await tx.user.delete({ where: { id: userId } })
  })

  await collectOrphanDocuments(keys)

  clearRefreshCookie(res)

  logger.info(
    { userId, organizationsDeleted: organizationIds.length, documentsConsidered: keys.length },
    'Account deleted'
  )

  res.json({ message: 'Account deleted' })
}))
