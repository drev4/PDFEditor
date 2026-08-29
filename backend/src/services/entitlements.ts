import { Prisma } from '@prisma/client'
import { prisma } from './db.js'
import { AppError } from '../middleware/errorHandler.js'
import { PLANS, isWithin, resolvePlan, type Plan } from './plans.js'

/**
 * Where plan limits get checked.
 *
 * Every export here is an **explicit call made inside a handler**, in the same
 * shape as `requireOrganizationId` and `requireRole` in `middleware/membership.ts`.
 * Deliberately not middleware: each resource has a different limit and a blanket
 * layer cannot know which one applies without re-deriving the route
 * (docs/sot/04-backend-patterns.md §2).
 *
 * Two rejections that must never be collapsed:
 *
 *   - **`402 Payment Required` — a plan limit.** Only ever toward an
 *     authenticated author, who can act on the answer.
 *   - **`403 Forbidden` — a permission failure.** What `requireRole` throws.
 *
 * And one absolute rule, which is why `assertResponseWithinLimit` throws a
 * `403` with borrowed wording rather than a `402`: **a `402` must never reach a
 * respondent.** The person filling in a public form is not the customer. Telling
 * them the plan is exhausted is meaningless to them and publishes the customer's
 * billing state to anyone holding a share link.
 *
 * Nothing here knows that a billing provider exists, and nothing here may ever
 * import one. Domain routes ask this service a question about limits;
 * `SubscriptionService` will be the only thing that knows about Stripe.
 */

/**
 * The billing period a moment falls in, `YYYY-MM`, **UTC**.
 *
 * The only place a period is computed. Two implementations of "which month is
 * it" is two answers on the last day of one, and the second answer would be a
 * customer either billed twice or not at all.
 *
 * UTC rather than the customer's timezone, because the counter is shared by an
 * organization whose members are not necessarily in one place, and because the
 * invoice this will one day feed has to be reproducible from the stored row
 * alone.
 */
export function currentPeriod(now: Date = new Date()): string {
  const year = now.getUTCFullYear()
  const month = String(now.getUTCMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

export interface Usage {
  publishedForms: number
  responsesThisPeriod: number
  seats: number
}

export interface Entitlements {
  plan: Readonly<Plan>
  usage: Usage
}

/** The organization's plan, or the free plan if the row has vanished. */
async function planFor(organizationId: string): Promise<Readonly<Plan>> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { planKey: true }
  })

  return organization ? resolvePlan(organization.planKey) : PLANS.free
}

/**
 * Published forms are **counted, not metered**, and that is not an
 * inconsistency with `responsesThisPeriod`.
 *
 * "How many forms are published right now" is a question about current state:
 * unpublishing one genuinely frees the slot, which is exactly what the
 * `LimitReached` screen offers as the alternative to upgrading. Responses are
 * different — they are events, and an event cannot be un-happened.
 */
function countPublishedForms(organizationId: string, excludeFormId?: string) {
  return prisma.form.count({
    where: {
      organizationId,
      status: 'published',
      ...(excludeFormId ? { id: { not: excludeFormId } } : {})
    }
  })
}

/**
 * Seats in use: members plus every invitation that could still be redeemed.
 *
 * Counting memberships alone would let an organization sitting on its seat
 * limit issue any number of outstanding invitations, each of them a working
 * key. The predicate for "still redeemable" is the same one
 * `GET /api/organizations/invitations` uses.
 */
async function countSeatsInUse(organizationId: string): Promise<number> {
  const [members, pendingInvitations] = await Promise.all([
    prisma.membership.count({ where: { organizationId } }),
    prisma.invitation.count({
      where: {
        organizationId,
        revokedAt: null,
        acceptedAt: null,
        expiresAt: { gt: new Date() }
      }
    })
  ])

  return members + pendingInvitations
}

/** Reads the meter for the current period. An absent row means nothing yet. */
async function readResponseUsage(organizationId: string): Promise<number> {
  const counter = await prisma.usageCounter.findUnique({
    where: {
      organizationId_period: { organizationId, period: currentPeriod() }
    },
    select: { responses: true }
  })

  return counter?.responses ?? 0
}

/**
 * Everything the plan screen and the sidebar card need, in one call.
 *
 * The single place that turns a stored `planKey` into a plan. When step 8
 * derives the plan from a `Subscription` instead, this function changes and
 * nothing else does.
 */
export async function getEntitlements(organizationId: string): Promise<Entitlements> {
  const [plan, publishedForms, responsesThisPeriod, seats] = await Promise.all([
    planFor(organizationId),
    countPublishedForms(organizationId),
    readResponseUsage(organizationId),
    countSeatsInUse(organizationId)
  ])

  return { plan, usage: { publishedForms, responsesThisPeriod, seats } }
}

/**
 * Refuses to publish a form beyond the plan's limit.
 *
 * `formId` is the form being published and is excluded from the count — it is
 * either still a draft (so it is not in the count anyway) or already published
 * (so counting it would refuse a no-op, and re-saving a published form would
 * start failing at the limit).
 *
 * Creating a form is never refused. Only publishing is, which is what the
 * `LimitReached` artboard describes: the form "stays a draft until you free up
 * a slot or upgrade".
 */
export async function assertCanPublishForm(
  organizationId: string,
  formId?: string
): Promise<void> {
  const plan = await planFor(organizationId)
  const published = await countPublishedForms(organizationId, formId)

  if (!isWithin(published, plan.maxPublishedForms)) {
    throw new AppError(
      402,
      `The ${plan.name} plan keeps ${plan.maxPublishedForms} ` +
      `${plan.maxPublishedForms === 1 ? 'form' : 'forms'} published at a time. ` +
      `Unpublish another form, or upgrade, to publish this one.`
    )
  }
}

/**
 * Refuses to hand out a seat the plan does not have.
 *
 * **Written, tested, and deliberately not wired into
 * `POST /api/organizations/invitations` yet.**
 *
 * The canvas gives Free and Pro one seat each; only Team has several, and Team
 * cannot be bought because there is no billing (step 8). Enforcing this today
 * would therefore answer `402` to *every* invitation from *every* account,
 * making the whole of features/0010 unreachable — that is not validating the
 * limit UX, it is deleting a shipped feature. The alternative, inventing a seat
 * count for Free that the design does not state, would put a product decision
 * nobody has taken into the code.
 *
 * So it waits for the plan that makes it meaningful. Step 8 wires it in one
 * line; the row in docs/BACKLOG.md is what remembers to.
 */
export async function assertCanInvite(organizationId: string): Promise<void> {
  const plan = await planFor(organizationId)
  const inUse = await countSeatsInUse(organizationId)

  if (!isWithin(inUse, plan.seats)) {
    throw new AppError(
      402,
      `The ${plan.name} plan includes ${plan.seats} ` +
      `${plan.seats === 1 ? 'seat' : 'seats'}. Upgrade to invite more people.`
    )
  }
}

/**
 * Whether this organization has spent the month's responses.
 *
 * The read-only twin of `assertResponseWithinLimit`, for
 * `GET /api/forms/public/:shareId`. It exists so a form that cannot accept a
 * submission is unavailable *before* somebody fills it in: enforcing the limit
 * only at submit time means the respondent types everything and then loses it.
 */
export async function isOverResponseLimit(organizationId: string): Promise<boolean> {
  const plan = await planFor(organizationId)
  if (plan.maxResponsesPerMonth === null) return false

  const used = await readResponseUsage(organizationId)
  return used >= plan.maxResponsesPerMonth
}

/**
 * Claims one response against the month's allowance, atomically.
 *
 * Must be called with a transaction client, inside the same transaction that
 * writes the `Response`, and the caller must **not** catch what it throws.
 *
 * Read-compare-increment would let two concurrent submissions both pass at
 * `limit - 1`. This upserts first and compares the result: the upsert takes the
 * row lock, so a second transaction blocks and then reads `limit + 1`. When it
 * throws, the transaction rolls back the increment *and* the response together
 * — there is no compensating decrement to get wrong, and no window in which the
 * meter is ahead of reality.
 *
 * It throws `403` with the wording `POST /api/responses` already uses for a
 * form that is not published, so a respondent cannot tell an exhausted plan
 * from a closed form. See the note at the top of this file.
 */
export async function assertResponseWithinLimit(
  tx: Prisma.TransactionClient,
  organizationId: string
): Promise<void> {
  const organization = await tx.organization.findUnique({
    where: { id: organizationId },
    select: { planKey: true }
  })

  const plan = organization ? resolvePlan(organization.planKey) : PLANS.free
  const period = currentPeriod()

  const counter = await tx.usageCounter.upsert({
    where: { organizationId_period: { organizationId, period } },
    create: { organizationId, period, responses: 1 },
    update: { responses: { increment: 1 } },
    select: { responses: true }
  })

  if (plan.maxResponsesPerMonth === null) return

  if (counter.responses > plan.maxResponsesPerMonth) {
    throw new AppError(403, 'Form is not accepting responses')
  }
}
