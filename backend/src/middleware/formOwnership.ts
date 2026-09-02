import { prisma } from '../services/db.js'
import { AppError } from './errorHandler.js'
import { requireMembership } from './membership.js'
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
 *
 * **Which** organization, when the caller belongs to more than one, is decided
 * by `requireMembership` and nowhere else (features/0023). The same argument
 * applies to that choice for the same reason: it is re-read per request, so it
 * cannot outlive the membership it names.
 */

/**
 * A Prisma `where` fragment restricting a form query to the **one organization
 * the caller is acting in** (features/0023).
 *
 * It used to be `{ organization: { memberships: { some: { userId } } } }` —
 * *any* membership — which meant a person in two organizations saw both tenants'
 * forms merged into one list while their writes went somewhere else entirely.
 * One organization at a time is the point: every count, meter and limit in this
 * product is per organization, and a merged list is what made that disagreement
 * invisible.
 *
 * `requireMembership` is the only thing that decides which one, so this is
 * `async` — the cost of one query, and the reason it is worth it is that there
 * is exactly one answer to the question anywhere in the codebase.
 */
export async function callerCanReachForm(req: AuthRequest) {
  const { organizationId } = await requireMembership(req)
  return { organizationId }
}

export async function verifyFormOwnership(req: AuthRequest, formId: string) {
  const form = await prisma.form.findFirst({
    where: { id: formId, ...(await callerCanReachForm(req)) }
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
