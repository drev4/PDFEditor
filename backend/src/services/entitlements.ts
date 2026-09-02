import { Prisma } from '@prisma/client'
import { prisma } from './db.js'
import { AppError } from '../middleware/errorHandler.js'
import { PLANS, effectivePlan, isPerSeat, isWithin, type Plan } from './plans.js'

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
 * `services/stripe.ts` is the only thing that knows about Stripe, and a grep
 * for `from 'stripe'` finds it and nothing else (features/0013).
 *
 * **features/0013 changed nothing in this file**, which was the point of it: the
 * plan still comes from `Organization.planKey` through `effectivePlan`, and all
 * billing did was become the one thing allowed to write that column. That is
 * still true of *which* plan an organization is on.
 *
 * features/0015 made one contained exception, and it is worth knowing exactly
 * how far it goes. `seatLimitFor` reads `Subscription.quantity`, because Team's
 * seats are **bought rather than declared** and no constant can know how many
 * somebody paid for. It reads one column of one table for one plan family, it
 * still does not import Stripe or know what a webhook is, and every other limit
 * — published forms, responses, branding — answers from `PLANS` alone.
 *
 * features/0027 gave every limit *check* one shape, and the signature is where
 * to read it. **A function that refuses something takes a
 * `Prisma.TransactionClient` first**, runs inside the same transaction as the
 * write it guards, and locks the organization row before it counts anything —
 * `assertCanPublishForm`, `assertCanInvite`, `assertResponseWithinLimit`. A
 * function that only reports (`getEntitlements`, `isOverResponseLimit`,
 * `mustShowBranding`, `assertHasApiAccess`) passes `prisma` and does not,
 * because it writes nothing and there is no window to close. Before 0027 the
 * meter was the only one of the three with a `tx`, and the other two were
 * read-then-write across two transactions: two requests at `limit - 1` both
 * passed. See `lockOrganization`.
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
  /**
   * The seat limit actually in force — `plan.seats` for every plan whose seats
   * are declared, and what was bought for the one whose seats are not.
   *
   * Separate from `plan` because `PLANS` is frozen and must stay the catalogue:
   * copying a per-organization number into a shared plan object would make the
   * catalogue mean something different depending on who asked. The API sends
   * this as the plan's `seats`, so a screen renders one number and never has to
   * know which of the two it got (features/0015).
   */
  seatLimit: number | null
}

/**
 * Takes the organization's row lock, and must be the **first** statement of any
 * transaction that checks a limit (features/0027).
 *
 * Every non-metered limit here is a count followed by a write, and a
 * transaction alone does not make those two atomic against each other. Under
 * Postgres's default `READ COMMITTED`, two concurrent transactions both run the
 * count before either commits its insert, neither sees the other's uncommitted
 * row, and both pass at `limit - 1`. A transaction makes the pair atomic; it
 * does not serialise them.
 *
 * This does. The second transaction blocks here until the first commits, then
 * counts and sees `n + 1`. **The order is the whole mechanism** — taking the
 * lock after the count restores the race exactly, which is why it is a named
 * function called on the first line rather than an option somewhere.
 *
 * Locking `organizations` rather than anything narrower is deliberate twice
 * over. The row always exists — it is the tenant — so unlike the subscription
 * row in `organization-lock.ts` there is never nothing to lock. And it is the
 * scope the limits are actually about: two organizations publishing at the same
 * moment take different rows and never wait on each other.
 *
 * Note what this is that `services/organization-lock.ts` is not: it is in
 * Postgres, which every replica shares. The in-process checkout lock covers one
 * process; this covers the deployment. The two answer different problems and
 * the reasoning in that file, which refuses a database lock, is about a
 * transaction that would have to stay open across a call to Stripe. Nothing
 * here calls anything over a network.
 *
 * Tagged `$queryRaw`, so the id is a bound parameter. Never `$queryRawUnsafe`.
 */
export async function lockOrganization(
  tx: Prisma.TransactionClient,
  organizationId: string
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId} FOR UPDATE`
}

/** The organization's plan, or the free plan if the row has vanished. */
async function planFor(
  tx: Prisma.TransactionClient,
  organizationId: string
): Promise<Readonly<Plan>> {
  const organization = await tx.organization.findUnique({
    where: { id: organizationId },
    select: { planKey: true }
  })

  // `effectivePlan`, never `resolvePlan`: the development override has to have
  // exactly one way in, and this and `assertResponseWithinLimit` are it.
  return organization ? effectivePlan(organization.planKey) : PLANS.free
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
function countPublishedForms(
  tx: Prisma.TransactionClient,
  organizationId: string,
  excludeFormId?: string
) {
  return tx.form.count({
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
async function countSeatsInUse(
  tx: Prisma.TransactionClient,
  organizationId: string
): Promise<number> {
  // Sequential, not `Promise.all`. An interactive transaction runs on one
  // connection, so two queries fired at it are queued rather than parallel and
  // there is nothing to win — while awaiting them in order keeps the statements
  // inside the transaction in a defined sequence.
  const members = await tx.membership.count({ where: { organizationId } })
  const pendingInvitations = await tx.invitation.count({
    where: {
      organizationId,
      revokedAt: null,
      acceptedAt: null,
      expiresAt: { gt: new Date() }
    }
  })

  return members + pendingInvitations
}

/**
 * The seat limit in force for an organization.
 *
 * **The only limit in this application that is not wholly owned by the
 * catalogue** (features/0015, trap 2), and the only reason `entitlements.ts`
 * reads a billing table at all. It is contained on purpose: one function, one
 * plan family (`PER_SEAT_PLANS`), one column. `assertCanPublishForm`,
 * `assertResponseWithinLimit` and `isOverResponseLimit` were not touched and
 * still answer from `PLANS` alone.
 *
 * Note what it reads and what it does not. `Subscription.quantity` is what
 * Stripe *reported*, reconciled by the webhook like `status` and `priceId`; it
 * is never a number this application chose, because the customer can change the
 * quantity in the portal without this code being in the request. The plan itself
 * still comes from `Organization.planKey` through `effectivePlan` — no billing
 * table decides *which* plan anyone is on, only how many seats one particular
 * plan bought.
 *
 * Every unreadable case degrades **downward**, to the catalogue floor:
 *
 *   - not a per-seat plan → the catalogue value, unchanged (and `null` for the
 *     `dev` override still means unlimited)
 *   - no subscription row, `quantity` null, `0`, or negative → the floor
 *   - a quantity below the floor → the floor, because the floor is the seats
 *     included in the base price and Stripe lets a customer set a quantity under
 *     what they already have
 *   - a quantity above the floor → the quantity
 */
export async function seatLimitFor(
  tx: Prisma.TransactionClient,
  organizationId: string
): Promise<number | null> {
  const plan = await planFor(tx, organizationId)

  if (!isPerSeat(plan.key)) return plan.seats

  const subscription = await tx.subscription.findUnique({
    where: { organizationId },
    select: { quantity: true }
  })

  const purchased = subscription?.quantity ?? 0
  const floor = plan.seats ?? 0

  return Math.max(floor, purchased)
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
 * The single place that turns a stored `planKey` into a plan — and it stayed
 * that way when billing arrived. features/0013 made `planKey` *derived* rather
 * than replacing it: `services/stripe.ts` writes it from what Stripe says, and
 * this still reads it. The alternative, joining `Subscription` here, would put
 * a billing table in the path of every limit check and leave `planKey` sitting
 * there being wrong.
 *
 * The subscription's own status and period end are added to the API response by
 * `routes/organizations.ts`, not here: they are something a screen displays,
 * not something a limit is computed from.
 */
export async function getEntitlements(organizationId: string): Promise<Entitlements> {
  // `prisma` as the client, not a transaction: this is a read for a screen, and
  // a slightly stale meter on Settings is not a limit being bypassed. Only the
  // checks that refuse something need to be serialised (features/0027).
  const [plan, publishedForms, responsesThisPeriod, seats, seatLimit] = await Promise.all([
    planFor(prisma, organizationId),
    countPublishedForms(prisma, organizationId),
    readResponseUsage(organizationId),
    countSeatsInUse(prisma, organizationId),
    seatLimitFor(prisma, organizationId)
  ])

  return { plan, usage: { publishedForms, responsesThisPeriod, seats }, seatLimit }
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
 *
 * Must be called with a transaction client, inside the same transaction that
 * writes `status`, and the caller must **not** catch what it throws — the same
 * contract `assertResponseWithinLimit` has had since features/0012, for the
 * same reason. Counting outside the write's transaction lets two publishes both
 * see the last slot free (features/0027).
 */
export async function assertCanPublishForm(
  tx: Prisma.TransactionClient,
  organizationId: string,
  formId?: string
): Promise<void> {
  // First, before either count. See `lockOrganization`: after the count it
  // would serialise nothing.
  await lockOrganization(tx, organizationId)

  const plan = await planFor(tx, organizationId)
  const published = await countPublishedForms(tx, organizationId, formId)

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
 * Refuses to hand out a seat that was not bought.
 *
 * **Wired into `POST /api/organizations/invitations` since features/0015.** It
 * sat unenforced from features/0012 until there was a plan that could actually
 * have more than one seat, because turning it on before that would have answered
 * `402` to every invitation from every account and made the whole of
 * features/0010 unreachable.
 *
 * Two things it deliberately does not do:
 *
 *   - **It does not buy anything.** Seats are bought by the customer in Stripe's
 *     portal and this only refuses the seat that was not (trap 1). Adding the
 *     fourth person to a three-seat plan is therefore two steps, not one, and
 *     that is the trade: the alternative pushes a quantity to Stripe from an
 *     Invite button, charging money from a screen that mentions none, and drifts
 *     silently the first time an invitation expires with no code running.
 *   - **It never removes anyone.** A plan that shrinks below the number of people
 *     already in the organization refuses the *next* invitation and touches no
 *     existing membership (trap 3), exactly as a downgrade leaves published
 *     forms published.
 *
 * `402`, never `403`. `403` is what `requireRole` throws for a permission
 * failure, and the invitations route can answer both: an admin inviting an owner
 * gets `403`, an owner out of seats gets `402`. Collapsing them would leave the
 * client unable to tell "you may not" from "you have not paid for this".
 *
 * Must be called with a transaction client, inside the same transaction that
 * inserts the `Invitation`, and the caller must **not** catch what it throws
 * (features/0027).
 */
export async function assertCanInvite(
  tx: Prisma.TransactionClient,
  organizationId: string
): Promise<void> {
  // First, before the count. See `lockOrganization`: two invitations sent at
  // the same instant on the last seat both counted `n` and both inserted.
  await lockOrganization(tx, organizationId)

  const plan = await planFor(tx, organizationId)
  const inUse = await countSeatsInUse(tx, organizationId)
  const seatLimit = await seatLimitFor(tx, organizationId)

  if (isWithin(inUse, seatLimit)) return

  // Seats count total people, so the limit is the size of the organization, not
  // the number of colleagues that can be added to it.
  const isTeam = isPerSeat(plan.key)

  throw new AppError(
    402,
    `The ${plan.name} plan covers ${seatLimit} ${seatLimit === 1 ? 'person' : 'people'}, ` +
    `and this organization already has ${inUse} ` +
    `${inUse === 1 ? 'member or pending invitation' : 'members and pending invitations'}. ` +
    (isTeam
      ? 'Add seats in the billing portal, then send the invitation again.'
      : 'Upgrade to invite more people.')
  )
}

/**
 * Whether this organization may use the public API at all (features/0019).
 *
 * `Plan.hasApiAccess` had sat in the catalogue since features/0012 with nothing
 * reading it; this is the reader. Note what wiring it makes true: it is `true`
 * only on Team, so **a Free or Pro customer creating an API key gets a `402`**.
 * That is the catalogue working rather than a bug, and it is the first place a
 * paid plan is visibly less *capable* rather than smaller.
 *
 * `402` and never `403`, like every other plan limit (features/0012): a `403`
 * here would tell an owner they lack permission for something no permission can
 * grant. The distinction is asserted in `tests/integration/api-keys.spec.ts`.
 *
 * Through `effectivePlan` like every other check, so `DEV_PLAN_KEY` governs it -
 * and `DEV_PLAN` grants it, so local development never sees the `402` unless
 * `DEV_PLAN_KEY=free|pro` is set on purpose.
 */
export async function assertHasApiAccess(organizationId: string): Promise<void> {
  const plan = await planFor(prisma, organizationId)
  if (plan.hasApiAccess) return

  throw new AppError(
    402,
    `The ${plan.name} plan does not include API access. Upgrade to use the API.`
  )
}

/**
 * Whether this organization's public forms must carry the "Made with VuePDF"
 * mark (features/0014).
 *
 * Deliberately **not** `getEntitlements`. That returns plan *and* usage, which
 * costs three more queries and a `UsageCounter` lookup, and the caller here is
 * `GET /api/forms/public/:shareId` — anonymous, uncached, and hit once per
 * respondent per view. One boolean does not justify four queries.
 *
 * Returns the negation of `Plan.hasBranding`, which reads as *has its own
 * branding*: a plan with the entitlement gets to remove our mark. The double
 * negative is why this function is named for what the caller renders rather
 * than for what the plan grants.
 *
 * Through `effectivePlan` like every other limit check, so `DEV_PLAN_KEY` still
 * governs it — and note the consequence, because it will otherwise be reported
 * as a bug: `DEV_PLAN` has `hasBranding: true`, so with the override on the
 * mark disappears from every local form.
 */
export async function mustShowBranding(organizationId: string): Promise<boolean> {
  const plan = await planFor(prisma, organizationId)
  return !plan.hasBranding
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
  const plan = await planFor(prisma, organizationId)
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

  const plan = organization ? effectivePlan(organization.planKey) : PLANS.free
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
