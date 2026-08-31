import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import { app } from '../../src/app.js'
import { prisma } from '../../src/services/db.js'
import { createUser } from './helpers.js'

/**
 * The Stripe SDK, mocked at the module boundary — **and Prisma left real**.
 *
 * That combination is the whole point of this file and is why it is separate
 * from `billing.spec.ts`. The race being tested is between two database reads,
 * so Prisma cannot be mocked; but the handler calls Stripe in the middle of it,
 * and no test may create customers in a real account.
 *
 * `customers.create` is given a deliberate delay. Without it the first request
 * finishes its whole read-create-write sequence before the second one starts,
 * the two never overlap, and the test passes against the very code it is meant
 * to fail against — a green test that proves nothing.
 */
const stripeCalls = {
  createCustomer: vi.fn(),
  createCheckoutSession: vi.fn(),
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
  }

  return { default: MockStripe }
})

/**
 * The checkout customer race, against a real PostgreSQL
 * ([`features/0014`](../../../features/0014-close-the-subscription-surface.md)).
 *
 * `POST /api/billing/checkout` reads the stored Stripe customer and writes it
 * back, and those two steps are not atomic. Two concurrent calls for one
 * organization — a double click, two tabs, a direct API caller — can both read
 * "no customer" and both create one.
 *
 * [`features/0013`](../../../features/0013-stripe-subscriptions.md) closed the
 * half that Stripe can close, with an idempotency key scoped to the
 * organization: Stripe replays the first response rather than minting a second
 * customer. That is a real mitigation and it is not the same as this
 * application only asking once — the key expires after 24 hours, and nothing
 * stops two Checkout *sessions* existing. This asserts the application side.
 */
describe('concurrent checkout', () => {
  let authHeader: string
  let organizationId: string

  beforeEach(async () => {
    stripeCalls.createCustomer.mockReset()
    stripeCalls.createCheckoutSession.mockReset()
    stripeCalls.listCheckoutSessions.mockReset()

    const account = await createUser()
    authHeader = account.authHeader
    organizationId = account.organization.id

    let created = 0
    stripeCalls.createCustomer.mockImplementation(async () => {
      created += 1
      // A network round trip to Stripe. The window this test exists to close.
      await new Promise(resolve => setTimeout(resolve, 120))
      return { id: `cus_concurrent_${created}` }
    })

    stripeCalls.createCheckoutSession.mockResolvedValue({
      url: 'https://checkout.stripe.test/session'
    })

    // No session open yet. The reuse path has its own test below.
    stripeCalls.listCheckoutSessions.mockResolvedValue({ data: [] })
  })

  function checkout() {
    return request(app).post('/api/billing/checkout').set('Authorization', authHeader)
  }

  it('creates exactly one Stripe customer for two simultaneous calls', async () => {
    // Fired without awaiting the first, which is what a double click does.
    const [first, second] = await Promise.all([checkout(), checkout()])

    expect([first.status, second.status]).toEqual([200, 200])

    // The assertion. Two customers means two Stripe records for one
    // organization, and the second one is invisible to "Manage billing"
    // forever after — while still able to carry a subscription that bills.
    expect(stripeCalls.createCustomer).toHaveBeenCalledTimes(1)
  })

  it('leaves exactly one subscription row, holding the customer that was created', async () => {
    await Promise.all([checkout(), checkout()])

    const rows = await prisma.subscription.findMany({ where: { organizationId } })

    // `organizationId` is unique, so a second row is impossible by construction
    // — this asserts the row that survived names the customer Stripe actually
    // has, rather than one from a call whose write lost the race.
    expect(rows).toHaveLength(1)
    expect(rows[0]?.stripeCustomerId).toBe('cus_concurrent_1')
    expect(rows[0]?.stripeSubscriptionId).toBeNull()
    expect(rows[0]?.status).toBe('incomplete')
  })

  it('still reuses the stored customer on a later, sequential call', async () => {
    await checkout()
    expect(stripeCalls.createCustomer).toHaveBeenCalledTimes(1)

    // The behaviour features/0013 already had must survive whatever lock this
    // change introduces: a second checkout much later reuses the customer.
    await checkout()
    expect(stripeCalls.createCustomer).toHaveBeenCalledTimes(1)
    expect(stripeCalls.createCheckoutSession).toHaveBeenCalledTimes(2)
  })

  it('hands back the session already open instead of opening a second one', async () => {
    // Serialising concurrent requests does not help two checkouts a minute
    // apart, and Stripe keeps a session open for 24 hours. Two open sessions
    // that each get paid is the actual way to end up billed twice.
    stripeCalls.listCheckoutSessions.mockResolvedValue({
      data: [{ id: 'cs_open', url: 'https://checkout.stripe.test/already-open', status: 'open' }]
    })

    const response = await checkout()

    expect(response.status).toBe(200)
    expect(response.body.url).toBe('https://checkout.stripe.test/already-open')
    expect(stripeCalls.createCheckoutSession).not.toHaveBeenCalled()
  })

  it('opens a new session once the old one is no longer open', async () => {
    // `status: 'open'` is part of the query, so an expired or completed session
    // simply does not come back and the customer is not stranded on a dead URL.
    stripeCalls.listCheckoutSessions.mockResolvedValue({ data: [] })

    const response = await checkout()

    expect(response.body.url).toBe('https://checkout.stripe.test/session')
    expect(stripeCalls.createCheckoutSession).toHaveBeenCalledTimes(1)
    expect(stripeCalls.listCheckoutSessions.mock.calls[0]?.[0]).toMatchObject({ status: 'open' })
  })

  it('does not serialise checkouts of different organizations behind each other', async () => {
    const other = await createUser()

    const started = Date.now()
    await Promise.all([
      checkout(),
      request(app).post('/api/billing/checkout').set('Authorization', other.authHeader)
    ])
    const elapsed = Date.now() - started

    // Two customers: these are different tenants and must not block each other.
    expect(stripeCalls.createCustomer).toHaveBeenCalledTimes(2)

    // And they ran concurrently. A lock taken on something global rather than
    // on the organization would make every customer in the product queue behind
    // one slow Stripe call, which is a worse problem than the one being fixed.
    expect(elapsed).toBeLessThan(240)
  })
})
