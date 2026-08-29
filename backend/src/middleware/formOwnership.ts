import { prisma } from '../services/db.js'
import { AppError } from './errorHandler.js'
import type { AuthRequest } from './auth.js'

/**
 * Authorization is tenancy: a caller may act on a form when a `Membership`
 * links them to the organization that owns it. `Form.createdByUserId` records
 * who made it and is never an input to this decision — a colleague who did not
 * create a form still gets to work on it, and a user deleted from the system
 * does not take the organization's forms with them.
 *
 * Membership is resolved from the database on every request rather than carried
 * in the JWT. That is deliberate: access tokens live 15 minutes and cannot be
 * revoked (see docs/sot/07-security-and-privacy.md), so a membership claim
 * baked into one would keep working for 15 minutes after someone was removed
 * from an organization. It costs a join, not a round trip.
 */
const memberOfCallerOrganization = (userId: string | undefined) => ({
  organization: { memberships: { some: { userId } } }
})

/** A Prisma `where` fragment restricting a form query to the caller's organizations. */
export function callerCanReachForm(req: AuthRequest) {
  return memberOfCallerOrganization(req.userId)
}

export async function verifyFormOwnership(req: AuthRequest, formId: string) {
  const form = await prisma.form.findFirst({
    where: { id: formId, ...callerCanReachForm(req) }
  })

  // 404 and not 403, for a form that exists but belongs to another
  // organization. A 403 confirms the row exists and turns every one of these
  // endpoints into an existence oracle for form ids.
  if (!form) {
    throw new AppError(404, 'Form not found')
  }

  return form
}

export async function verifyFieldOwnership(req: AuthRequest, formId: string, fieldId: string) {
  await verifyFormOwnership(req, formId)

  // An archived field is not visible in the editor, so it cannot be the target
  // of an individual update or delete.
  const field = await prisma.field.findFirst({
    where: { id: fieldId, formId, deletedAt: null }
  })

  if (!field) {
    throw new AppError(404, 'Field not found')
  }

  return field
}

/**
 * The organization a newly created resource belongs to.
 *
 * Every account has exactly one organization today — registration creates it —
 * so there is nothing to choose between. When a user can belong to several,
 * this is the single place that has to learn how the active one is selected,
 * and the oldest membership stops being the right answer.
 */
export async function requireOrganizationId(req: AuthRequest): Promise<string> {
  const membership = await prisma.membership.findFirst({
    where: { userId: req.userId },
    orderBy: { createdAt: 'asc' },
    select: { organizationId: true }
  })

  // Registration creates the user, the organization and the membership in one
  // transaction, so an authenticated user without one means a row was made
  // outside the application. Refusing is safer than inventing an organization.
  if (!membership) {
    throw new AppError(403, 'This account does not belong to an organization')
  }

  return membership.organizationId
}
