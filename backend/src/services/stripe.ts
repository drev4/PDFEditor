import Stripe from 'stripe'
import { prisma } from './db.js'
import { AppError } from '../middleware/errorHandler.js'
import { DEFAULT_PLAN_KEY, type PlanKey } from './plans.js'

/**
 * Everything that knows Stripe exists (features/0013).
 *
 * **This is the only module in the backend that imports the Stripe SDK**, and
 * that boundary is the point. `routes/forms.ts`, `routes/responses.ts` and
 * `services/entitlements.ts` ask questions about *plans*; none of them may
 * learn that a billing provider is involved, or the plan catalogue starts
 * having opinions about payment processors. `grep -rn "from 'stripe'" src` must
 * only ever find this file.
 *
 * The direction of data is one way and it matters:
 *
 *   Stripe → webhook → `reconcileSubscription` → `Organization.planKey`
 *                                              → `Subscription`
 *
 * `planKey` is derived and this file is its **only writer**. Reads all still go
 * through `effectivePlan(organization.planKey)` in `services/entitlements.ts`,
 * untouched by this feature, so there is exactly one answer to "which plan is
 * this?" and no limit check has to join a billing table.
 */

/**
 * The API version this code was written against, pinned deliberately.
 *
 * Stripe changes object shapes between versions and an unpinned client silently
 * follows the account's default, so an account upgraded in the dashboard would
 * start sending this code a shape it has never seen. `current_period_end` is
 * the live example: it used to sit on the subscription and in this version it
 * is on the subscription *item* — see `subscriptionStateFrom`.
 *
 * **This pins only the requests this application sends.** Events Stripe sends
 * *us* are serialised in the version of the webhook endpoint's own
 * configuration, or the account default when the endpoint pins none — and
 * `stripe listen` uses the account default unless given `--api-version`.
 * Verified on 2026-08-31: the test account sends `2026-08-26.dahlia` while this
 * constant says `basil`, and it worked only because the one field that had
 * moved is read from the right place. `assertKnownApiVersion` below is what
 * makes the next such drift visible instead of silent; pinning the endpoint is
 * the other half, and it is configuration (docs/sot/08-operations.md).
 */
const STRIPE_API_VERSION = '2025-08-27.basil' as const

let client: Stripe | null = null
let clientKey: string | null = null

/** So a permanent condition does not print on every webhook. */
const announced = new Set<string>()

function announceOnce(message: string): void {
  if (announced.has(message)) return
  announced.add(message)
  console.error(message)
}

/** Only for tests, which assert the first occurrence of a message. */
export function resetAnnouncements(): void {
  announced.clear()
}

/**
 * Says something when an event arrives in a version this code was not written
 * against — and then lets it through.
 *
 * `constructEvent` verifies the **signature**, never the shape. A payload
 * serialised by a different API version verifies perfectly and reconciles
 * wrong, which is how `current_period_end` moving onto the subscription item
 * would have stored `null` for every customer while failing nothing.
 *
 * **A mismatch is deliberately not fatal.** Refusing the event would answer
 * non-`200`, Stripe would retry it forever and eventually disable the endpoint
 * — turning a cosmetic version drift into a total billing outage, and breaking
 * the rule that anything verified gets a `200`
 * (docs/sot/04-backend-patterns.md §10a). The failure this guards against is
 * silence, so the fix is noise, not refusal.
 *
 * Once per distinct version, not once per event: a permanent misconfiguration
 * printing on every webhook is a log nobody reads.
 */
export function assertKnownApiVersion(eventApiVersion: string | null | undefined): boolean {
  if (!eventApiVersion || eventApiVersion === STRIPE_API_VERSION) return true

  announceOnce(
    `Stripe sent an event serialised with API version "${eventApiVersion}", but this ` +
    `code is written against "${STRIPE_API_VERSION}". The event is being processed ` +
    `anyway — refusing it would make Stripe retry until it disabled the endpoint — ` +
    `but any field Stripe has moved between those versions is now being read from ` +
    `the wrong place, silently. Pin the API version on the webhook endpoint ` +
    `(docs/sot/08-operations.md) or update STRIPE_API_VERSION and re-check ` +
    `subscriptionStateFrom.`
  )

  return false
}

/** `true` when this deployment has been given a Stripe secret key. */
export function billingConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim())
}

/**
 * The Stripe client, or a `503`.
 *
 * Built on first use rather than at import time so that the whole application
 * — and the entire test suite — still boots without Stripe credentials. A
 * deployment with no `STRIPE_SECRET_KEY` is a deployment where billing is off,
 * not a deployment that fails to start.
 *
 * `503` rather than `500`: nothing is broken, this instance simply cannot sell
 * anything, and that is a deployment fact the caller can be told honestly.
 */
export function stripeClient(): Stripe {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim()

  if (!secretKey) {
    throw new AppError(503, 'Billing is not configured on this server.')
  }

  // Rebuilt when the key changes, so a test can swap credentials the way the
  // rate limiters and `DEV_PLAN_KEY` allow theirs to be swapped.
  if (!client || clientKey !== secretKey) {
    client = new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION })
    clientKey = secretKey
  }

  return client
}

/** Only for tests, which construct clients with throwaway keys. */
export function resetStripeClient(): void {
  client = null
  clientKey = null
}

/**
 * The statuses that keep a customer on the plan they bought.
 *
 * An **allowlist**, for the same reason `OVERRIDE_ENVIRONMENTS` in `plans.ts`
 * is one: Stripe adds statuses, and a status this code has never heard of must
 * fall to free rather than be assumed to be paid. The failure direction of a
 * mistake here is a support ticket, not the product being given away.
 *
 * `past_due` is in the list on purpose. Stripe retries a failed payment for
 * days, and cutting a customer off the moment a card expires is hostile and
 * premature — they have not decided to leave, their bank had an opinion. The
 * only route to free mid-period is a payment that finally failed after every
 * retry (`unpaid`, `canceled`), which is the one case where it is defensible.
 *
 * Deliberately **not** in the list: `incomplete` and `incomplete_expired` (the
 * first payment never went through, so nothing was bought) and `paused` (Stripe
 * is not billing them).
 */
const PAID_STATUSES: ReadonlySet<string> = new Set(['active', 'trialing', 'past_due'])

/** `true` when Stripe considers this subscription one the customer is paying for. */
export function isPaidStatus(status: string): boolean {
  return PAID_STATUSES.has(status)
}

/**
 * The plan a Stripe price maps to, or `null` if this deployment does not
 * recognise it.
 *
 * The price **id** is configuration; the price **amount** is Stripe's and is
 * never stored or rendered from a constant here (features/0013, trap 7). Read
 * from the environment on every call rather than captured at import, so a test
 * can point it somewhere else.
 *
 * Free ↔ Pro only for now. Team is per-seat quantity billing and is out of
 * scope — adding it means keeping the quantity in step with `Membership`.
 */
export function planKeyForPrice(priceId: string | null | undefined): PlanKey | null {
  if (!priceId) return null

  const pro = process.env.STRIPE_PRICE_PRO?.trim()
  if (pro && priceId === pro) return 'pro'

  return null
}

/**
 * The plan key an organization should be on, given what Stripe says.
 *
 * The whole status→plan decision, in one function, so there is one place to
 * test and one place to change. Both inputs matter: a paid status on a price
 * this deployment does not recognise is a **misconfiguration**, not a purchase,
 * and it resolves to free with a loud error rather than guessing which tier was
 * bought. The only price a customer can reach is the one `POST /api/billing/checkout`
 * offers, so the realistic way to get here is a wrong `STRIPE_PRICE_PRO`.
 */
export function planKeyForStatus(status: string, priceId: string | null | undefined): PlanKey {
  if (!isPaidStatus(status)) return DEFAULT_PLAN_KEY

  const planKey = planKeyForPrice(priceId)

  if (!planKey) {
    console.error(
      `Stripe subscription is "${status}" on price "${priceId}", which this ` +
      `deployment does not recognise (check STRIPE_PRICE_PRO). Falling back to ` +
      `"${DEFAULT_PLAN_KEY}".`
    )
    return DEFAULT_PLAN_KEY
  }

  return planKey
}

/** What the reconciler writes. Everything it needs, and nothing about Stripe's SDK. */
export interface SubscriptionState {
  organizationId: string
  stripeCustomerId: string
  stripeSubscriptionId: string | null
  status: string
  priceId: string | null
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean
}

/**
 * A `SubscriptionState` read off a Stripe subscription object.
 *
 * **`current_period_end` is on the subscription item, not the subscription**, in
 * API version `2025-08-27.basil`. Older integrations (and most tutorials) read
 * `subscription.current_period_end`, which is `undefined` here and would store
 * `null` for every customer without failing anything — a display bug that looks
 * like a Stripe outage. The earliest item period end is used, because with one
 * price there is exactly one item and with several the customer's period is the
 * first one to end.
 *
 * The price is likewise read off the item. A subscription with no items is not
 * something Stripe produces, but it is typed as possible, so it degrades to
 * `null` — which `planKeyForStatus` resolves to free.
 */
export function subscriptionStateFrom(
  organizationId: string,
  subscription: Stripe.Subscription
): SubscriptionState {
  const items = subscription.items?.data ?? []

  const periodEnds = items
    .map(item => item.current_period_end)
    .filter((value): value is number => typeof value === 'number')

  const customer = subscription.customer

  return {
    organizationId,
    // Expanded or not, Stripe gives either the id or the object.
    stripeCustomerId: typeof customer === 'string' ? customer : customer.id,
    stripeSubscriptionId: subscription.id,
    status: subscription.status,
    priceId: items[0]?.price?.id ?? null,
    currentPeriodEnd: periodEnds.length ? new Date(Math.min(...periodEnds) * 1000) : null,
    cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false
  }
}

/**
 * Writes what Stripe says, and the plan that follows from it, in one
 * transaction.
 *
 * **State-setting, never incremental** (features/0013, trap 3). It never
 * "upgrades" or "downgrades" anything — it takes the state on the event and
 * makes the database equal to it. That is what makes it safe under Stripe's
 * actual delivery guarantees, which are at-least-once and unordered: replaying
 * an event writes the same values a second time, and an event arriving out of
 * order writes the state that event carried. The idempotency record in
 * `markEventProcessed` stops the replay before it gets here; this shape is why
 * it would be harmless even if it did not.
 *
 * The `Subscription` row and `Organization.planKey` move together or not at
 * all. Two separate writes would leave a window — and, on a failure, a permanent
 * state — in which the plan and the billing record disagree, which is exactly
 * the drift `planKey` being derived is supposed to make impossible.
 *
 * **It unpublishes nothing and deletes nothing** (trap 5). An organization
 * dropping to free with five published forms keeps all five: those URLs are
 * live and were given to respondents, and a billing event is not consent to
 * break them. The limit refuses the *sixth*, which `assertCanPublishForm`
 * already does without any change.
 */
export async function reconcileSubscription(state: SubscriptionState): Promise<PlanKey> {
  const planKey = planKeyForStatus(state.status, state.priceId)

  await prisma.$transaction(async tx => {
    await tx.subscription.upsert({
      where: { organizationId: state.organizationId },
      create: {
        organizationId: state.organizationId,
        stripeCustomerId: state.stripeCustomerId,
        stripeSubscriptionId: state.stripeSubscriptionId,
        status: state.status,
        priceId: state.priceId,
        currentPeriodEnd: state.currentPeriodEnd,
        cancelAtPeriodEnd: state.cancelAtPeriodEnd
      },
      update: {
        stripeCustomerId: state.stripeCustomerId,
        stripeSubscriptionId: state.stripeSubscriptionId,
        status: state.status,
        priceId: state.priceId,
        currentPeriodEnd: state.currentPeriodEnd,
        cancelAtPeriodEnd: state.cancelAtPeriodEnd
      }
    })

    // The one and only write of `plan_key` in this codebase.
    await tx.organization.update({
      where: { id: state.organizationId },
      data: { planKey }
    })
  })

  return planKey
}

/**
 * Remembers the Stripe customer for an organization, before any subscription
 * exists.
 *
 * Called from `POST /api/billing/checkout`. Without it, every abandoned
 * checkout mints a fresh Stripe customer for the same organization, and a
 * customer who tries twice can end up with two subscriptions and two invoices
 * for one product. It writes **no plan** — nothing has been bought yet, and the
 * plan only ever moves on a webhook (trap 2).
 */
export async function rememberCustomer(
  organizationId: string,
  stripeCustomerId: string
): Promise<void> {
  await prisma.subscription.upsert({
    where: { organizationId },
    create: { organizationId, stripeCustomerId },
    update: { stripeCustomerId }
  })
}

/** The organization's billing record, or `null`. */
export async function subscriptionFor(organizationId: string) {
  return prisma.subscription.findUnique({ where: { organizationId } })
}

/**
 * Claims a Stripe event id, returning `false` if it has already been processed.
 *
 * Insert-and-catch rather than read-then-insert: two concurrent deliveries of
 * the same event — which is exactly what Stripe's retry does when the first
 * attempt is merely slow — both pass a read check and both do the work. The
 * primary key is Stripe's own `event.id`, so the second insert collides and
 * this returns `false`.
 */
export async function claimEvent(eventId: string, type: string): Promise<boolean> {
  try {
    await prisma.stripeEvent.create({ data: { id: eventId, type } })
    return true
  } catch {
    // The only realistic failure is the unique violation this exists to catch.
    // Treating any failure as "already processed" is the safe direction: the
    // alternative is running a handler twice.
    return false
  }
}

/**
 * Which organization an event is about.
 *
 * Checkout sets both `client_reference_id` and `metadata.organizationId` on the
 * session, and copies the metadata onto the subscription, so most events carry
 * it. When they do not — an event created in the Stripe dashboard, a
 * subscription made by hand — the customer id is the fallback, resolved against
 * the row `rememberCustomer` wrote.
 *
 * Returns `null` when the event cannot be attributed. The caller records the
 * event and answers `200`: a `500` would make Stripe retry forever an event
 * that will never resolve.
 */
export async function organizationIdFor(
  metadataOrganizationId: string | null | undefined,
  stripeCustomerId: string | null | undefined
): Promise<string | null> {
  if (metadataOrganizationId) {
    const organization = await prisma.organization.findUnique({
      where: { id: metadataOrganizationId },
      select: { id: true }
    })
    if (organization) return organization.id
  }

  if (stripeCustomerId) {
    const existing = await prisma.subscription.findFirst({
      where: { stripeCustomerId },
      select: { organizationId: true }
    })
    if (existing) return existing.organizationId
  }

  return null
}

/**
 * The event types this application acts on.
 *
 * `checkout.session.completed` is the purchase; the two `customer.subscription.*`
 * events carry every later change — renewal, card failure, cancellation,
 * resumption — and because the handler is state-setting, all of them are the
 * same code path.
 */
const HANDLED_EVENTS = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted'
])

export interface HandledEvent {
  /** `false` when the event id had already been processed. */
  processed: boolean
  /** Why nothing was written, when nothing was. */
  reason?: 'duplicate' | 'unhandled-type' | 'unknown-organization'
  planKey?: PlanKey
}

/**
 * Applies a verified Stripe event.
 *
 * Verification of the signature has already happened in the route — this
 * function trusts its argument, and must never be called with anything that did
 * not come out of `stripe.webhooks.constructEvent`.
 *
 * Every path here that does not write returns rather than throwing, because the
 * route answers `200` to anything it verified. An error would make Stripe retry,
 * and retrying an event that this application will never understand is an
 * infinite loop that eventually disables the endpoint.
 */
export async function handleStripeEvent(event: Stripe.Event): Promise<HandledEvent> {
  // Before anything else, and never a reason to stop: see the function's own
  // comment for why a version mismatch is logged rather than refused.
  assertKnownApiVersion(event.api_version)

  if (!(await claimEvent(event.id, event.type))) {
    return { processed: false, reason: 'duplicate' }
  }

  if (!HANDLED_EVENTS.has(event.type)) {
    return { processed: false, reason: 'unhandled-type' }
  }

  const stripe = stripeClient()

  // The subscription **as it is on the event**, plus one read-back for
  // `checkout.session.completed`, whose session carries only the subscription
  // id. Nothing is inferred from the event type: the object says what the state
  // is, and the state is what gets written.
  let subscription: Stripe.Subscription
  let metadataOrganizationId: string | null | undefined

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    metadataOrganizationId = session.metadata?.organizationId ?? session.client_reference_id

    const subscriptionId =
      typeof session.subscription === 'string' ? session.subscription : session.subscription?.id

    if (!subscriptionId) {
      // A completed Checkout with no subscription is a one-off payment. This
      // application does not sell any, so there is nothing to do.
      return { processed: false, reason: 'unhandled-type' }
    }

    subscription = await stripe.subscriptions.retrieve(subscriptionId)
  } else {
    subscription = event.data.object as Stripe.Subscription
    metadataOrganizationId = subscription.metadata?.organizationId
  }

  const customer = subscription.customer
  const stripeCustomerId = typeof customer === 'string' ? customer : customer?.id

  const organizationId = await organizationIdFor(metadataOrganizationId, stripeCustomerId)

  if (!organizationId) {
    console.error(
      `Stripe event ${event.id} (${event.type}) names no organization this ` +
      `application knows: metadata="${metadataOrganizationId ?? ''}", ` +
      `customer="${stripeCustomerId ?? ''}".`
    )
    return { processed: false, reason: 'unknown-organization' }
  }

  const planKey = await reconcileSubscription(subscriptionStateFrom(organizationId, subscription))

  return { processed: true, planKey }
}

/**
 * Verifies a webhook request against the **raw** body.
 *
 * Throws `400` on anything that does not verify, and says nothing about why:
 * the distinction between a forged signature, a stale timestamp and a wrong
 * secret is useful to an attacker and useless to Stripe, which retries either
 * way.
 */
export function constructWebhookEvent(rawBody: Buffer | string, signature: string | undefined): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim()

  if (!secret) {
    // Not a `400`: nothing is wrong with the request. This deployment cannot
    // verify anything, and answering `200` would silently accept forgeries.
    throw new AppError(503, 'Billing is not configured on this server.')
  }

  if (!signature) {
    throw new AppError(400, 'Invalid signature')
  }

  try {
    return stripeClient().webhooks.constructEvent(rawBody, signature, secret)
  } catch {
    throw new AppError(400, 'Invalid signature')
  }
}
