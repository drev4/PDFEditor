import type Stripe from 'stripe'

/**
 * Webhook payloads for the billing suites.
 *
 * **These were not captured with `stripe trigger`**, which is what
 * `features/0013` asked for: there is no Stripe CLI and no Stripe account on
 * the machine this was built on. That matters, and it is written down here
 * rather than hidden, because the risk the spec was guarding against is real —
 * a hand-written fixture tests the handler against the author's belief about
 * Stripe's shape.
 *
 * What is done instead, and why it is not nothing: **every object here is typed
 * as the Stripe SDK's own declaration** (`Stripe.Subscription`, `Stripe.Price`,
 * `Stripe.SubscriptionItem`) with no `as any` and no partial cast, and
 * **`npm run typecheck:tests` compiles this file** against the shape Stripe
 * publishes for API version `2025-08-27.basil` — the same declarations
 * `services/stripe.ts` reads them with. A field that does not exist, or one
 * whose type is wrong, fails. That script exists because the build's tsconfig
 * covers `src/` only, so without it nothing checked these at all.
 *
 * The two `Event` wrappers below do carry a cast, and it is the honest kind:
 * `Stripe.Event` is a discriminated union over every event type Stripe defines,
 * and narrowing it by hand here would say more about TypeScript than about
 * Stripe. The payload *inside* each one is fully typed, which is the part that
 * could be wrong.
 *
 * What none of this can check is which fields Stripe actually *populates* in a
 * live event, which is why the manual verification steps in `features/0013`
 * still have to be run against a real test-mode account before this is believed
 * in production.
 *
 * The one shape decision worth pointing at: `current_period_end` lives on the
 * **subscription item**, not the subscription, in this API version. That is not
 * a simplification made here — it is where Stripe moved it, and reading it from
 * the wrong place is a bug that stores `null` for every customer without
 * failing anything.
 */

const NOW = 1767225600 // 2026-01-01T00:00:00Z
const PERIOD_END = 1769904000 // 2026-02-01T00:00:00Z

export const TEST_PRICE_PRO = 'price_test_pro_0013'
/**
 * The per-seat Team price (features/0015). A distinct id from the Pro one on
 * purpose: `planKeyForPrice` maps ids, and a shared fixture id would let a test
 * pass while the two plans were indistinguishable.
 */
export const TEST_PRICE_TEAM = 'price_test_team_0015'
export const TEST_CUSTOMER = 'cus_test_0013'
export const TEST_SUBSCRIPTION = 'sub_test_0013'

function price(id: string): Stripe.Price {
  return {
    id,
    object: 'price',
    active: true,
    billing_scheme: 'per_unit',
    created: NOW,
    currency: 'eur',
    custom_unit_amount: null,
    livemode: false,
    lookup_key: null,
    metadata: {},
    nickname: null,
    product: 'prod_test_0013',
    recurring: {
      interval: 'month',
      interval_count: 1,
      meter: null,
      trial_period_days: null,
      usage_type: 'licensed'
    },
    tax_behavior: 'exclusive',
    tiers_mode: null,
    transform_quantity: null,
    type: 'recurring',
    // Deliberately present and deliberately never read. The amount is Stripe's;
    // nothing in this application stores or renders it (features/0013, trap 7).
    unit_amount: 1200,
    unit_amount_decimal: '1200'
  }
}

/**
 * The legacy `plan` twin of `price`, still required on a subscription item.
 * Nothing in this application reads it — `subscriptionStateFrom` uses
 * `item.price.id` — but Stripe still sends it, so the fixture carries it.
 */
function plan(priceId: string): Stripe.Plan {
  return {
    id: priceId,
    object: 'plan',
    active: true,
    amount: 1200,
    amount_decimal: '1200',
    billing_scheme: 'per_unit',
    created: NOW,
    currency: 'eur',
    interval: 'month',
    interval_count: 1,
    livemode: false,
    metadata: {},
    meter: null,
    nickname: null,
    product: 'prod_test_0013',
    tiers_mode: null,
    transform_usage: null,
    trial_period_days: null,
    usage_type: 'licensed'
  }
}

/**
 * `quantity` is a parameter because it is the one field of this fixture that
 * carries a plan limit (features/0015). Seats on a per-seat plan are whatever
 * Stripe says was bought, so a test has to be able to say something other than
 * one — including `null`, which is the "Stripe reported nothing" case that must
 * degrade to the catalogue floor rather than to unlimited.
 */
function item(priceId: string, periodEnd: number, quantity: number | undefined): Stripe.SubscriptionItem {
  return {
    id: 'si_test_0013',
    object: 'subscription_item',
    billing_thresholds: null,
    created: NOW,
    plan: plan(priceId),
    tax_rates: [],
    current_period_end: periodEnd,
    current_period_start: NOW,
    discounts: [],
    metadata: {},
    price: price(priceId),
    quantity,
    subscription: TEST_SUBSCRIPTION
  }
}

export interface SubscriptionOverrides {
  status?: Stripe.Subscription.Status
  priceId?: string
  organizationId?: string | null
  cancelAtPeriodEnd?: boolean
  currentPeriodEnd?: number
  customer?: string
  id?: string
  /** Seats bought. `undefined` is Stripe reporting no quantity at all. */
  quantity?: number | undefined
}

/** A subscription object as it appears inside a `customer.subscription.*` event. */
export function subscription(overrides: SubscriptionOverrides = {}): Stripe.Subscription {
  const {
    status = 'active',
    priceId = TEST_PRICE_PRO,
    organizationId = null,
    cancelAtPeriodEnd = false,
    currentPeriodEnd = PERIOD_END,
    customer = TEST_CUSTOMER,
    id = TEST_SUBSCRIPTION
  } = overrides

  // Not a destructuring default: `{ quantity: undefined }` has to mean "Stripe
  // sent no quantity", and a default would quietly turn that case back into 1 —
  // which is exactly the value `subscriptionStateFrom` must not invent.
  const quantity = 'quantity' in overrides ? overrides.quantity : 1

  const subscriptionItem = item(priceId, currentPeriodEnd, quantity)

  return {
    id,
    object: 'subscription',
    application: null,
    application_fee_percent: null,
    automatic_tax: { disabled_reason: null, enabled: false, liability: null },
    billing_cycle_anchor: NOW,
    billing_cycle_anchor_config: null,
    billing_mode: { type: 'classic' },
    billing_thresholds: null,
    cancel_at: null,
    cancel_at_period_end: cancelAtPeriodEnd,
    canceled_at: null,
    cancellation_details: { comment: null, feedback: null, reason: null },
    collection_method: 'charge_automatically',
    created: NOW,
    currency: 'eur',
    days_until_due: null,
    default_payment_method: null,
    default_source: null,
    default_tax_rates: [],
    description: null,
    discounts: [],
    ended_at: null,
    invoice_settings: { account_tax_ids: null, issuer: { type: 'self' } },
    items: {
      object: 'list',
      data: [subscriptionItem],
      has_more: false,
      url: `/v1/subscription_items?subscription=${id}`
    },
    latest_invoice: 'in_test_0013',
    livemode: false,
    // Set by `subscription_data.metadata` on the Checkout Session, which is why
    // every later event can name the organization without a database lookup.
    metadata: organizationId ? { organizationId } : {},
    next_pending_invoice_item_invoice: null,
    on_behalf_of: null,
    pause_collection: null,
    payment_settings: {
      payment_method_options: null,
      payment_method_types: null,
      save_default_payment_method: 'off'
    },
    pending_invoice_item_interval: null,
    pending_setup_intent: null,
    pending_update: null,
    schedule: null,
    start_date: NOW,
    status,
    test_clock: null,
    transfer_data: null,
    trial_end: null,
    trial_settings: { end_behavior: { missing_payment_method: 'create_invoice' } },
    trial_start: null,
    customer
  }
}

let eventCounter = 0

/** A distinct `evt_…` id, so a test that wants a *new* event does not get a replay. */
export function nextEventId(): string {
  eventCounter += 1
  return `evt_test_0013_${eventCounter}`
}

/**
 * A `customer.subscription.*` event wrapping the given subscription.
 *
 * These carry the subscription inline, so handling one needs no call back to
 * Stripe — which is what makes them usable in the database-backed suite, where
 * there is no Stripe API to call.
 */
export function subscriptionEvent(
  type: 'customer.subscription.created' | 'customer.subscription.updated' | 'customer.subscription.deleted',
  data: Stripe.Subscription,
  eventId: string = nextEventId()
): Stripe.Event {
  return {
    id: eventId,
    object: 'event',
    api_version: '2025-08-27.basil',
    created: NOW,
    data: { object: data },
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    type
  } as Stripe.Event
}

/**
 * A `checkout.session.completed` event.
 *
 * Unlike the subscription events, this one carries only the subscription *id*:
 * the handler has to read the subscription back from Stripe, which is why this
 * fixture is used in the mocked suite and not the database-backed one.
 */
export function checkoutCompletedEvent(
  organizationId: string,
  subscriptionId: string = TEST_SUBSCRIPTION,
  eventId: string = nextEventId()
): Stripe.Event {
  const session = {
    id: 'cs_test_0013',
    object: 'checkout.session',
    client_reference_id: organizationId,
    customer: TEST_CUSTOMER,
    livemode: false,
    metadata: { organizationId },
    mode: 'subscription',
    payment_status: 'paid',
    status: 'complete',
    subscription: subscriptionId,
    url: null
  }

  return {
    id: eventId,
    object: 'event',
    api_version: '2025-08-27.basil',
    created: NOW,
    data: { object: session },
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    type: 'checkout.session.completed'
  } as unknown as Stripe.Event
}
