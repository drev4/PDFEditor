import { Router, type Request, type Response } from 'express'
import express from 'express'
import { z } from 'zod'
import { prisma } from '../services/db.js'
import { AppError } from '../middleware/errorHandler.js'
import { authenticate, type AuthRequest } from '../middleware/auth.js'
import { requireRole } from '../middleware/membership.js'
import { withOrganizationLock } from '../services/organization-lock.js'
import { isPerSeat, PLANS, type PlanKey } from '../services/plans.js'
import {
  constructWebhookEvent,
  handleStripeEvent,
  isPaidStatus,
  priceIdForPlan,
  rememberCustomer,
  stripeClient,
  subscriptionFor
} from '../services/stripe.js'
import { asyncHandler } from '../middleware/asyncHandler.js'

/**
 * Buying and managing a subscription (features/0013).
 *
 * Three routes with three different authentication models, which is unusual in
 * this codebase and is the thing to understand before changing any of them:
 *
 *   - `POST /checkout` and `POST /portal` — Bearer token, **owner only**. Both
 *     spend or expose money, and `requireRole` is what says who may.
 *   - `POST /webhook` — no session at all. The caller is Stripe, and the proof
 *     is a signature over the raw request body. See `webhookRouter` at the
 *     bottom, and the mounting order in `app.ts`.
 *
 * Neither `checkout` nor `portal` takes an organization from the request. The
 * organization is whatever the caller's membership says it is; a body parameter
 * would be an authorization decision made by the client.
 */
export const billingRouter = Router()

/** Where Checkout and the Portal send the browser back to. */
function frontendUrl(path: string): string {
  const base = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '')
  return `${base}${path}`
}

/**
 * Which plan is being bought.
 *
 * `pro` by default, so the client that features/0013 shipped — which sends an
 * empty body — keeps working unchanged. `free` is not in the enum: it is what an
 * organization falls back to, never something Checkout sells, and offering it
 * here would be a second way to change a plan outside the webhook.
 */
const checkoutSchema = z.object({
  plan: z.enum(['pro', 'team']).default('pro')
})

/** The price this deployment sells for a plan, or a `503` saying it sells none. */
function priceFor(planKey: PlanKey): string {
  const priceId = priceIdForPlan(planKey)

  if (!priceId) {
    // `503`, not `400`: the request is fine and this plan is real. This
    // deployment simply has no price configured for it (`STRIPE_PRICE_TEAM` is
    // optional, and unset means Team is not for sale here — Free and Pro are
    // unaffected).
    throw new AppError(503, `The ${PLANS[planKey].name} plan is not for sale on this server.`)
  }

  return priceId
}

// POST /api/billing/checkout — owner only.
//
// Returns a Stripe-hosted Checkout URL. No card ever touches this origin, which
// is what keeps the PCI surface entirely Stripe's; building an in-app card form
// would be a security decision, not a UI one.
//
// **Nothing here grants a plan.** The plan moves only when the webhook says
// Stripe took the money (features/0013, trap 2). `success_url` is a URL anybody
// can visit, and a customer who closes the tab never visits it at all.
billingRouter.post('/checkout', authenticate, asyncHandler(async (req: AuthRequest, res, next) => {
  const { organizationId } = await requireRole(req, ['owner'])

  const validation = checkoutSchema.safeParse(req.body ?? {})
  if (!validation.success) {
    return res.status(400).json({ error: 'Validation error', details: validation.error.errors })
  }

  const planKey = validation.data.plan
  const price = priceFor(planKey)
  const stripe = stripeClient()

  // Everything from here is serialised per organization (features/0014).
  //
  // Reading the stored customer and writing it back are two steps, and a
  // double click puts a second request between them: both read "no customer",
  // both create one, and both open a Checkout Session. Two sessions that are
  // each paid is one organization with two live subscriptions, of which this
  // application can only ever see one — `Subscription.organizationId` is
  // unique — while the other keeps billing, invisible to "Manage billing".
  //
  // See `services/organization-lock.ts` for why this is not `SELECT … FOR
  // UPDATE` (there is no row to lock on a first checkout) and for what this
  // lock does not cover.
  const url = await withOrganizationLock(organizationId, async () => {
    const existing = await subscriptionFor(organizationId)

    // A second subscription for an organization that already has a live one is
    // a customer paying twice for one product. The portal is where an existing
    // subscription is changed.
    if (existing?.stripeSubscriptionId && isPaidStatus(existing.status)) {
      throw new AppError(
        400,
        'This organization already has an active subscription. Manage it in the billing portal.'
      )
    }

    // Reuse the customer if there is one. A fresh customer per attempt is how
    // one organization ends up with two Stripe customers and two invoices.
    let customerId = existing?.stripeCustomerId

    if (!customerId) {
      const user = await prisma.user.findUnique({
        where: { id: req.userId! },
        select: { email: true, name: true }
      })

      const customer = await stripe.customers.create(
        {
          email: user?.email,
          name: user?.name ?? undefined,
          // So an event that lost its session metadata can still be attributed.
          metadata: { organizationId }
        },
        // The read above and the write below are not atomic, so two concurrent
        // calls — a double click, two tabs, a direct API caller — can both find
        // no customer and both create one. The idempotency key closes that
        // window at Stripe's end rather than ours: Stripe replays the first
        // response for the same key, so both requests get the *same* customer
        // and `rememberCustomer` stores the same id twice.
        //
        // It is scoped to the organization, not to the request, because the
        // whole point is that two different requests for one organization must
        // not produce two customers. Stripe honours a key for 24 hours; past
        // that the stored row is what prevents a second customer, and the only
        // way to get one is for the row to be missing 24 hours later, which
        // means no checkout was ever completed.
        { idempotencyKey: `vuepdf-customer-${organizationId}` }
      )

      customerId = customer.id
      await rememberCustomer(organizationId, customerId)
    }

    // An open session this organization already has. Serialising concurrent
    // requests is not enough on its own: two checkouts a minute apart also
    // produce two sessions, and Stripe keeps one open for 24 hours. Handing
    // back the existing one means there is only ever a single session that can
    // be paid, which is the actual protection against being billed twice.
    //
    // **Only when it is for the plan being asked for** (features/0015). With
    // two buyable plans, reusing blindly sends somebody who pressed "Team" to
    // a page that charges them for Pro — the customer would be reading a
    // correct-looking Stripe page for the wrong product. A session for another
    // plan is expired rather than left open, which keeps the property that
    // matters: there is never more than one session that can be paid.
    const open = await stripe.checkout.sessions.list({
      customer: customerId,
      status: 'open',
      limit: 1,
      expand: ['data.line_items']
    })

    const reusable = open.data[0]

    if (reusable) {
      const sessionPrice = reusable.line_items?.data[0]?.price?.id ?? null

      if (sessionPrice === price && reusable.url) {
        return reusable.url
      }

      await stripe.checkout.sessions.expire(reusable.id)
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      // **The only place this application sends Stripe a quantity, and it is
      // an opening position rather than a decision** (features/0015, trap 1).
      // Nothing here ever pushes a quantity again: seats are changed by the
      // customer in the portal, and `Subscription.quantity` is only ever read
      // back off the webhook. A per-seat plan starts at the seats included in
      // the base price and `adjustable_quantity` lets the buyer set the real
      // number on Stripe's own page — which is where the per-seat amount is
      // shown, and the only place it is true. This application renders no
      // figure and has no seat picker of its own.
      line_items: [
        isPerSeat(planKey)
          ? {
              price,
              quantity: PLANS[planKey].seats ?? 1,
              adjustable_quantity: { enabled: true, minimum: PLANS[planKey].seats ?? 1 }
            }
          : { price, quantity: 1 }
      ],
      // Both, deliberately. `client_reference_id` is what Stripe echoes on the
      // session; `metadata` is what survives onto objects the session creates.
      client_reference_id: organizationId,
      metadata: { organizationId },
      // Copied onto the subscription, so every later
      // `customer.subscription.*` event names the organization without a lookup.
      subscription_data: { metadata: { organizationId } },
      success_url: frontendUrl('/dashboard/settings?checkout=complete'),
      cancel_url: frontendUrl('/dashboard/settings?checkout=cancelled')
    })

    if (!session.url) {
      throw new AppError(502, 'Stripe did not return a checkout URL.')
    }

    return session.url
  })

  res.json({ url })
}))

// POST /api/billing/portal — owner only.
//
// Cancelling, resuming, changing the card and reading invoices all happen in
// Stripe's hosted portal. This product deliberately builds none of those
// screens: each one is a place to get billing wrong, and Stripe's already
// exists and is already correct.
billingRouter.post('/portal', authenticate, asyncHandler(async (req: AuthRequest, res, next) => {
  const { organizationId } = await requireRole(req, ['owner'])
  const subscription = await subscriptionFor(organizationId)

  if (!subscription) {
    throw new AppError(404, 'This organization has no billing account yet.')
  }

  const session = await stripeClient().billingPortal.sessions.create({
    customer: subscription.stripeCustomerId,
    return_url: frontendUrl('/dashboard/settings')
  })

  res.json({ url: session.url })
}))

/**
 * The webhook, on its own router because it needs a different body parser.
 *
 * **`express.raw`, and it must run before the global `express.json()`.** Stripe
 * signs the exact bytes it sent; a parsed-and-restringified object is not
 * byte-identical, so under `express.json()` every signature check fails — for
 * every event, silently, with the endpoint still answering. See the mounting
 * comment in `app.ts`, which is where the ordering is actually enforced.
 *
 * **No rate limiter, deliberately.** Every other unauthenticated write path in
 * this application has one (`middleware/rateLimit.ts`), and the repository
 * requires the absence of one to be argued in writing (docs/sot/07-security-and-privacy.md).
 * The argument: the signature is a strictly stronger gate than a limiter — an
 * unsigned request is rejected before any work, at the cost of one HMAC, so
 * there is no expensive path to protect. A limiter would instead throttle
 * *Stripe's own retries*, and a dropped retry is a subscription state this
 * application never learns about: a customer who paid and did not get the plan,
 * or one who cancelled and kept it. The failure mode of the limiter is worse
 * than the failure mode it prevents.
 */
export const webhookRouter = Router()

webhookRouter.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  asyncHandler(async (req: Request, res: Response, next) => {
    // Verified first, before anything reads the body as data. Anything that
    // does not verify is a `400` and no work at all.
    const event = constructWebhookEvent(
      req.body as Buffer,
      req.header('stripe-signature')
    )

    const result = await handleStripeEvent(event)

    // `200` to everything that verified — including duplicates, event types
    // this application does not handle, and events it cannot attribute to an
    // organization. Any other status makes Stripe retry, and retrying an
    // event that will never resolve is an endless loop that ends with Stripe
    // disabling the endpoint.
    res.json({ received: true, processed: result.processed })
  })
)
