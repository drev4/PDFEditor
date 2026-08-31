import { Router, type Request, type Response } from 'express'
import express from 'express'
import { prisma } from '../services/db.js'
import { AppError } from '../middleware/errorHandler.js'
import { authenticate, type AuthRequest } from '../middleware/auth.js'
import { requireRole } from '../middleware/membership.js'
import {
  constructWebhookEvent,
  handleStripeEvent,
  isPaidStatus,
  rememberCustomer,
  stripeClient,
  subscriptionFor
} from '../services/stripe.js'

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

/** The price this deployment sells, or a `503` saying it sells nothing. */
function proPriceId(): string {
  const priceId = process.env.STRIPE_PRICE_PRO?.trim()

  if (!priceId) {
    throw new AppError(503, 'Billing is not configured on this server.')
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
billingRouter.post('/checkout', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const { organizationId } = await requireRole(req, ['owner'])
    const price = proPriceId()
    const stripe = stripeClient()

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

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price, quantity: 1 }],
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

    res.json({ url: session.url })
  } catch (error) {
    next(error)
  }
})

// POST /api/billing/portal — owner only.
//
// Cancelling, resuming, changing the card and reading invoices all happen in
// Stripe's hosted portal. This product deliberately builds none of those
// screens: each one is a place to get billing wrong, and Stripe's already
// exists and is already correct.
billingRouter.post('/portal', authenticate, async (req: AuthRequest, res, next) => {
  try {
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
  } catch (error) {
    next(error)
  }
})

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
  async (req: Request, res: Response, next) => {
    try {
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
    } catch (error) {
      next(error)
    }
  }
)
