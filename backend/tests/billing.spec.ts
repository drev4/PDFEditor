import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import Stripe from 'stripe'
import { PrismaClient } from '@prisma/client'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import { app } from '../src/app'
import { prisma } from '../src/services/db'
import {
  assertKnownApiVersion,
  isPaidStatus,
  planKeyForPrice,
  planKeyForStatus,
  resetAnnouncements,
  subscriptionStateFrom
} from '../src/services/stripe'
import {
  subscription,
  checkoutCompletedEvent,
  subscriptionEvent,
  TEST_PRICE_PRO,
  TEST_CUSTOMER,
  TEST_SUBSCRIPTION
} from './fixtures/stripe-events'

vi.mock('../src/services/db', async () => {
  const { mockDeep } = await import('vitest-mock-extended')
  return { prisma: mockDeep<PrismaClient>() }
})

vi.mock('../src/middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = 'user-1'
    next()
  }
}))

/**
 * The Stripe SDK, mocked at the module boundary.
 *
 * Only `stripe.customers.create`, `checkout.sessions.create` and
 * `billingPortal.sessions.create` are faked — the three calls that would
 * otherwise reach the network. **`webhooks.constructEvent` is deliberately
 * left real**: it is local HMAC, it is the entire authentication of the webhook
 * route, and a fake one would turn every signature assertion in this file into
 * a test of the fake.
 */
const stripeCalls = {
  createCustomer: vi.fn(),
  createCheckoutSession: vi.fn(),
  createPortalSession: vi.fn(),
  retrieveSubscription: vi.fn(),
  listCheckoutSessions: vi.fn()
}

vi.mock('stripe', async () => {
  const actual = await vi.importActual<typeof import('stripe')>('stripe')
  const Real = actual.default

  class MockStripe extends Real {
    customers = { create: stripeCalls.createCustomer } as any
    checkout = {
      sessions: {
        create: stripeCalls.createCheckoutSession,
        list: stripeCalls.listCheckoutSessions
      }
    } as any
    billingPortal = { sessions: { create: stripeCalls.createPortalSession } } as any
    subscriptions = { retrieve: stripeCalls.retrieveSubscription } as any
  }

  return { default: MockStripe }
})

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>

/**
 * Stripe billing at the route level, over a mocked Prisma
 * ([`features/0013`](../../features/0013-stripe-subscriptions.md)).
 *
 * What this level proves: who may call each route, that an unverifiable request
 * is refused before any work, and the status→plan map. What it **cannot**
 * prove is anything that makes the integration correct — idempotency is a
 * primary-key collision, reconciliation is a transaction, and downgrade safety
 * is a statement about rows that still exist. Those are in
 * `tests/integration/billing.spec.ts`, and a green run here says nothing about
 * them.
 */
describe('stripe billing', () => {
  beforeEach(() => {
    mockReset(prismaMock)
    stripeCalls.createCustomer.mockReset()
    stripeCalls.createCheckoutSession.mockReset()
    stripeCalls.createPortalSession.mockReset()
    stripeCalls.retrieveSubscription.mockReset()
    stripeCalls.listCheckoutSessions.mockReset()
    // No session already open, unless a test says otherwise. `/checkout` now
    // hands back an open session rather than opening a second one
    // (features/0014).
    stripeCalls.listCheckoutSessions.mockResolvedValue({ data: [] })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /** The membership `requireRole` reads. */
  function asRole(role: 'owner' | 'admin' | 'member') {
    prismaMock.membership.findFirst.mockResolvedValue({
      organizationId: 'org-1',
      role
    } as any)
  }

  describe('the status → plan map', () => {
    // The one decision in this feature that a customer feels directly, so it
    // lives in one function and is asserted exhaustively rather than by
    // sampling.
    it('keeps the paid plan while Stripe is still trying', () => {
      expect(planKeyForStatus('active', TEST_PRICE_PRO)).toBe('pro')
      expect(planKeyForStatus('trialing', TEST_PRICE_PRO)).toBe('pro')
      // Not a decision to leave — a bank had an opinion, and Stripe retries for
      // days. Cutting them off here takes their published forms offline.
      expect(planKeyForStatus('past_due', TEST_PRICE_PRO)).toBe('pro')
    })

    it('falls to free once the payment has finally failed or the plan has ended', () => {
      expect(planKeyForStatus('canceled', TEST_PRICE_PRO)).toBe('free')
      expect(planKeyForStatus('unpaid', TEST_PRICE_PRO)).toBe('free')
      expect(planKeyForStatus('incomplete_expired', TEST_PRICE_PRO)).toBe('free')
      // Nothing was ever bought.
      expect(planKeyForStatus('incomplete', TEST_PRICE_PRO)).toBe('free')
      // Stripe is not billing them.
      expect(planKeyForStatus('paused', TEST_PRICE_PRO)).toBe('free')
    })

    it('treats a status it has never heard of as free', () => {
      // The allowlist is the safety property: Stripe adds statuses, and the
      // failure direction of a new one must be a support ticket, not the
      // product being given away silently.
      expect(isPaidStatus('some_future_status')).toBe(false)
      expect(planKeyForStatus('some_future_status', TEST_PRICE_PRO)).toBe('free')
    })

    it('refuses to guess a plan from a price this deployment does not know', () => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

      // Reachable only through a wrong `STRIPE_PRICE_PRO` — checkout offers no
      // other price. Guessing "they paid for something, give them Pro" would
      // make a configuration mistake invisible.
      expect(planKeyForStatus('active', 'price_someone_elses')).toBe('free')
      expect(planKeyForStatus('active', null)).toBe('free')
      expect(logged).toHaveBeenCalled()
      expect(String(logged.mock.calls[0]?.[0])).toContain('STRIPE_PRICE_PRO')
    })

    it('maps only the configured price', () => {
      expect(planKeyForPrice(TEST_PRICE_PRO)).toBe('pro')
      expect(planKeyForPrice('price_other')).toBeNull()
      expect(planKeyForPrice(null)).toBeNull()
    })
  })

  describe('reading a subscription object', () => {
    it('takes the period end from the subscription item, not the subscription', () => {
      // In API version 2025-08-27.basil `current_period_end` moved onto the
      // item. Reading it off the subscription yields `undefined` and stores
      // `null` for every customer, failing nothing.
      const state = subscriptionStateFrom('org-1', subscription({ currentPeriodEnd: 1769904000 }))

      expect(state.currentPeriodEnd).toEqual(new Date(1769904000 * 1000))
      expect(state.priceId).toBe(TEST_PRICE_PRO)
      expect(state.stripeCustomerId).toBe(TEST_CUSTOMER)
      expect(state.status).toBe('active')
    })
  })

  describe('POST /api/billing/checkout', () => {
    it('is refused to a member', async () => {
      asRole('member')

      const response = await request(app).post('/api/billing/checkout')

      // 403, not 402: this is a permission failure, not a plan limit. The two
      // are never collapsed (features/0012).
      expect(response.status).toBe(403)
      expect(stripeCalls.createCheckoutSession).not.toHaveBeenCalled()
    })

    it('is refused to an admin', async () => {
      asRole('admin')

      const response = await request(app).post('/api/billing/checkout')

      // An admin manages forms and members. Spending the organization's money
      // is an owner's decision.
      expect(response.status).toBe(403)
      expect(stripeCalls.createCheckoutSession).not.toHaveBeenCalled()
    })

    it('is 404 for someone in no organization at all', async () => {
      prismaMock.membership.findFirst.mockResolvedValue(null)

      const response = await request(app).post('/api/billing/checkout')

      // Not 403: a non-member must not be told the organization exists.
      expect(response.status).toBe(404)
    })

    it('creates a customer for an owner who has never bought anything', async () => {
      asRole('owner')
      prismaMock.subscription.findUnique.mockResolvedValue(null)
      prismaMock.user.findUnique.mockResolvedValue({
        email: 'owner@example.com',
        name: 'Owner'
      } as any)
      stripeCalls.createCustomer.mockResolvedValue({ id: 'cus_new' })
      stripeCalls.createCheckoutSession.mockResolvedValue({ url: 'https://checkout.stripe.test/s' })

      const response = await request(app).post('/api/billing/checkout')

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ url: 'https://checkout.stripe.test/s' })

      const session = stripeCalls.createCheckoutSession.mock.calls[0]?.[0]
      expect(session.mode).toBe('subscription')
      expect(session.customer).toBe('cus_new')
      expect(session.line_items).toEqual([{ price: TEST_PRICE_PRO, quantity: 1 }])
      // Both, so the webhook can attribute the event whether it arrives as a
      // session or as a subscription.
      expect(session.client_reference_id).toBe('org-1')
      expect(session.metadata).toEqual({ organizationId: 'org-1' })
      expect(session.subscription_data.metadata).toEqual({ organizationId: 'org-1' })

      // The customer is remembered immediately. Minting a fresh one on the next
      // attempt is how somebody ends up with two subscriptions and two invoices.
      expect(prismaMock.subscription.upsert).toHaveBeenCalled()
    })

    it('creates the customer under an idempotency key scoped to the organization', async () => {
      asRole('owner')
      prismaMock.subscription.findUnique.mockResolvedValue(null)
      prismaMock.user.findUnique.mockResolvedValue({ email: 'o@example.com', name: null } as any)
      stripeCalls.createCustomer.mockResolvedValue({ id: 'cus_new' })
      stripeCalls.createCheckoutSession.mockResolvedValue({ url: 'https://checkout.stripe.test/s' })

      await request(app).post('/api/billing/checkout')

      // Reading the stored customer and writing it back is not atomic, so two
      // concurrent calls can both find none. The key makes Stripe replay the
      // first response instead of minting a second customer — which is the
      // difference between one subscription and two.
      const options = stripeCalls.createCustomer.mock.calls[0]?.[1]
      expect(options?.idempotencyKey).toBe('vuepdf-customer-org-1')
    })

    it('takes the organization from the membership and never from the body', async () => {
      asRole('owner')
      prismaMock.subscription.findUnique.mockResolvedValue(null)
      prismaMock.user.findUnique.mockResolvedValue({ email: 'o@example.com', name: null } as any)
      stripeCalls.createCustomer.mockResolvedValue({ id: 'cus_new' })
      stripeCalls.createCheckoutSession.mockResolvedValue({ url: 'https://checkout.stripe.test/s' })

      await request(app)
        .post('/api/billing/checkout')
        .send({ organizationId: 'org-someone-else' })

      const session = stripeCalls.createCheckoutSession.mock.calls[0]?.[0]
      expect(session.client_reference_id).toBe('org-1')
      expect(session.metadata.organizationId).toBe('org-1')
    })

    it('reuses the stored Stripe customer instead of creating a second one', async () => {
      asRole('owner')
      prismaMock.subscription.findUnique.mockResolvedValue({
        organizationId: 'org-1',
        stripeCustomerId: 'cus_existing',
        stripeSubscriptionId: null,
        status: 'incomplete'
      } as any)
      stripeCalls.createCheckoutSession.mockResolvedValue({ url: 'https://checkout.stripe.test/s' })

      const response = await request(app).post('/api/billing/checkout')

      expect(response.status).toBe(200)
      expect(stripeCalls.createCustomer).not.toHaveBeenCalled()
      expect(stripeCalls.createCheckoutSession.mock.calls[0]?.[0].customer).toBe('cus_existing')
    })

    it('refuses to sell a second subscription to an organization that already pays', async () => {
      asRole('owner')
      prismaMock.subscription.findUnique.mockResolvedValue({
        organizationId: 'org-1',
        stripeCustomerId: 'cus_existing',
        stripeSubscriptionId: 'sub_existing',
        status: 'active'
      } as any)

      const response = await request(app).post('/api/billing/checkout')

      expect(response.status).toBe(400)
      expect(response.body.error).toContain('billing portal')
      expect(stripeCalls.createCheckoutSession).not.toHaveBeenCalled()
    })

    it('answers 503 when this deployment has no price configured', async () => {
      asRole('owner')
      const price = process.env.STRIPE_PRICE_PRO
      delete process.env.STRIPE_PRICE_PRO

      try {
        const response = await request(app).post('/api/billing/checkout')

        // Nothing is broken; this instance cannot sell anything. That is a
        // deployment fact, not a 500.
        expect(response.status).toBe(503)
      } finally {
        process.env.STRIPE_PRICE_PRO = price
      }
    })
  })

  describe('POST /api/billing/portal', () => {
    it('is refused to a member', async () => {
      asRole('member')

      const response = await request(app).post('/api/billing/portal')

      expect(response.status).toBe(403)
      expect(stripeCalls.createPortalSession).not.toHaveBeenCalled()
    })

    it('is 404 for an organization with no billing account', async () => {
      asRole('owner')
      prismaMock.subscription.findUnique.mockResolvedValue(null)

      const response = await request(app).post('/api/billing/portal')

      expect(response.status).toBe(404)
    })

    it('returns a portal URL for the owner', async () => {
      asRole('owner')
      prismaMock.subscription.findUnique.mockResolvedValue({
        organizationId: 'org-1',
        stripeCustomerId: 'cus_existing'
      } as any)
      stripeCalls.createPortalSession.mockResolvedValue({ url: 'https://portal.stripe.test/s' })

      const response = await request(app).post('/api/billing/portal')

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ url: 'https://portal.stripe.test/s' })
      expect(stripeCalls.createPortalSession.mock.calls[0]?.[0].customer).toBe('cus_existing')
    })
  })

  /**
   * The purchase event itself, and the one handler branch the database-backed
   * suite cannot reach.
   *
   * `checkout.session.completed` carries only the subscription **id**, so the
   * handler has to read the subscription back from Stripe — a real network call
   * mid-webhook. `tests/integration/billing.spec.ts` has no Stripe API to call,
   * so it uses `customer.subscription.*` events throughout and this branch would
   * otherwise never run in CI at all. It happens to be redundant in production
   * (Stripe fires `customer.subscription.created` alongside it, and that would
   * activate the plan anyway) but that redundancy is incidental, not a design.
   */
  describe('checkout.session.completed', () => {
    /**
     * Signs an event the way Stripe does, over the raw bytes.
     *
     * `generateTestHeaderString` is the SDK's own signer and is local HMAC, so
     * this exercises the real verification path — the mock above replaces only
     * the calls that would reach the network.
     */
    function deliver(event: unknown) {
      const payload = JSON.stringify(event)
      const signature = new Stripe(process.env.STRIPE_SECRET_KEY!).webhooks.generateTestHeaderString({
        payload,
        secret: process.env.STRIPE_WEBHOOK_SECRET!
      })

      return request(app)
        .post('/api/billing/webhook')
        .set('stripe-signature', signature)
        .set('Content-Type', 'application/json')
        .send(payload)
    }

    beforeEach(() => {
      // Not a duplicate, and the organization resolves.
      prismaMock.stripeEvent.create.mockResolvedValue({} as any)
      prismaMock.organization.findUnique.mockResolvedValue({ id: 'org-1' } as any)
      prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock))
    })

    it('reads the subscription back from Stripe and reconciles it', async () => {
      stripeCalls.retrieveSubscription.mockResolvedValue(
        subscription({ organizationId: 'org-1' })
      )

      const response = await deliver(checkoutCompletedEvent('org-1'))

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ received: true, processed: true })
      expect(stripeCalls.retrieveSubscription).toHaveBeenCalledWith(TEST_SUBSCRIPTION)

      // The plan is written from what the retrieved subscription says, not from
      // the fact that a checkout completed. State-setting, never incremental.
      expect(prismaMock.organization.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'org-1' }, data: { planKey: 'pro' } })
      )
      expect(prismaMock.subscription.upsert).toHaveBeenCalled()
    })

    it('ignores a completed checkout that bought no subscription', async () => {
      const event: any = checkoutCompletedEvent('org-1')
      // A one-off payment. This application sells none, so there is nothing to
      // do — and it must not be an error, or Stripe retries it forever.
      event.data.object.subscription = null
      event.data.object.mode = 'payment'

      const response = await deliver(event)

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ received: true, processed: false })
      expect(stripeCalls.retrieveSubscription).not.toHaveBeenCalled()
      expect(prismaMock.organization.update).not.toHaveBeenCalled()
    })

    it('falls back to client_reference_id when the metadata is gone', async () => {
      const event: any = checkoutCompletedEvent('org-1')
      // Stripe echoes `client_reference_id` on the session; metadata is what
      // survives onto objects the session creates. Checkout sets both, and this
      // is the path that uses the other one.
      event.data.object.metadata = {}
      stripeCalls.retrieveSubscription.mockResolvedValue(
        subscription({ organizationId: null })
      )

      const response = await deliver(event)

      expect(response.body).toEqual({ received: true, processed: true })
      expect(prismaMock.organization.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { planKey: 'pro' } })
      )
    })

    it('answers 200 without writing when the organization cannot be resolved', async () => {
      prismaMock.organization.findUnique.mockResolvedValue(null)
      prismaMock.subscription.findFirst.mockResolvedValue(null)
      stripeCalls.retrieveSubscription.mockResolvedValue(
        subscription({ organizationId: 'org-gone' })
      )
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

      const response = await deliver(checkoutCompletedEvent('org-gone'))

      // A 5xx would make Stripe retry forever an event that will never resolve.
      expect(response.status).toBe(200)
      expect(response.body).toEqual({ received: true, processed: false })
      expect(prismaMock.organization.update).not.toHaveBeenCalled()
      expect(logged).toHaveBeenCalled()
    })

    it('does not re-enter the handler for an event id already seen', async () => {
      // `claimEvent` treats any insert failure as "already processed" — the
      // realistic one being the primary-key collision on Stripe's event id.
      prismaMock.stripeEvent.create.mockRejectedValue(new Error('unique violation'))

      const response = await deliver(
        subscriptionEvent('customer.subscription.updated', subscription({ organizationId: 'org-1' }))
      )

      expect(response.body).toEqual({ received: true, processed: false })
      expect(stripeCalls.retrieveSubscription).not.toHaveBeenCalled()
      expect(prismaMock.organization.update).not.toHaveBeenCalled()
    })
  })

  /**
   * The API version an event arrives in, which this application does not
   * control (features/0014).
   *
   * `constructEvent` verifies the signature, never the shape. A payload
   * serialised by a version this code was not written against verifies
   * perfectly and reconciles wrong — which is exactly how `current_period_end`
   * moving onto the subscription item would have stored `null` for every
   * customer while failing nothing.
   */
  describe('the event API version', () => {
    beforeEach(() => {
      resetAnnouncements()
    })

    it('says nothing when the version matches', () => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

      expect(assertKnownApiVersion('2025-08-27.basil')).toBe(true)
      expect(logged).not.toHaveBeenCalled()
    })

    it('complains, names both versions, and still lets the event through', () => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

      expect(assertKnownApiVersion('2026-08-26.dahlia')).toBe(false)

      const message = String(logged.mock.calls[0]?.[0])
      expect(message).toContain('2026-08-26.dahlia')
      expect(message).toContain('2025-08-27.basil')
    })

    it('complains once per version, not once per event', () => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

      // A permanent misconfiguration printing on every webhook is a log nobody
      // reads — the same reason `services/plans.ts` announces once.
      assertKnownApiVersion('2026-08-26.dahlia')
      assertKnownApiVersion('2026-08-26.dahlia')
      assertKnownApiVersion('2026-08-26.dahlia')

      expect(logged).toHaveBeenCalledTimes(1)
    })

    it('treats a missing version as nothing to say', () => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

      expect(assertKnownApiVersion(null)).toBe(true)
      expect(assertKnownApiVersion(undefined)).toBe(true)
      expect(logged).not.toHaveBeenCalled()
    })
  })

  describe('POST /api/billing/webhook', () => {
    // The signature is the whole authentication of this route: there is no
    // session, no Bearer token and no CSRF guard, because the caller is Stripe.
    it('refuses a request with no signature header', async () => {
      const response = await request(app)
        .post('/api/billing/webhook')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ id: 'evt_1', type: 'customer.subscription.updated' }))

      expect(response.status).toBe(400)
      expect(response.body.error).toBe('Invalid signature')
      expect(prismaMock.stripeEvent.create).not.toHaveBeenCalled()
    })

    it('refuses a forged signature', async () => {
      const response = await request(app)
        .post('/api/billing/webhook')
        .set('stripe-signature', 't=1,v1=deadbeef')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ id: 'evt_1', type: 'customer.subscription.updated' }))

      expect(response.status).toBe(400)
      // The message says nothing about *why*. Which of the timestamp, the
      // scheme and the digest failed is useful to an attacker and useless to
      // Stripe, which retries either way.
      expect(response.body.error).toBe('Invalid signature')
      expect(prismaMock.stripeEvent.create).not.toHaveBeenCalled()
    })

    it('carries no rate limiter, and that is deliberate', async () => {
      // 40 unsigned requests, well past every limit in `middleware/rateLimit.ts`
      // (the tightest default is 20). Every one is a 400, none is a 429.
      //
      // The argument for the absence is in `routes/billing.ts`: the signature
      // is a strictly stronger gate than a limiter, and a limiter would throttle
      // *Stripe's retries* — each dropped retry being a subscription state this
      // application never learns about.
      const statuses: number[] = []

      for (let i = 0; i < 40; i++) {
        const response = await request(app)
          .post('/api/billing/webhook')
          .set('stripe-signature', 't=1,v1=deadbeef')
          .set('Content-Type', 'application/json')
          .send(JSON.stringify({ id: `evt_${i}` }))
        statuses.push(response.status)
      }

      expect(statuses.every(status => status === 400)).toBe(true)
      expect(statuses).not.toContain(429)
    })
  })
})
