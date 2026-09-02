import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import { prisma } from '../src/services/db'
import { cancelSubscriptionsForOrganizations } from '../src/services/stripe'

vi.mock('../src/services/db', async () => {
  const { mockDeep } = await import('vitest-mock-extended')
  return { prisma: mockDeep<PrismaClient>() }
})

const cancel = vi.fn()

vi.mock('stripe', async () => {
  const actual = await vi.importActual<typeof import('stripe')>('stripe')
  const Real = actual.default

  class MockStripe extends Real {
    subscriptions = { cancel } as any
  }

  return { default: MockStripe }
})

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>

/**
 * Cancelling at Stripe before an organization is deleted (features/0029).
 *
 * This is at the mocked level on purpose, and it is the one part of the feature
 * that has to be: the integration suite runs against a real database with a fake
 * Stripe key, so a test that exercised this there would either make a network
 * call or prove nothing. What matters here is which SDK call is made and with
 * what — a question about a boundary, not about a cascade.
 *
 * The behaviour being pinned: **a cascade cannot reach Stripe.**
 * `Subscription.organization` is `onDelete: Cascade`, so deleting an
 * organization removes the row recording the relationship and leaves the
 * subscription itself renewing. A customer would go on paying for an account
 * that no longer exists.
 */
describe('cancelSubscriptionsForOrganizations', () => {
  beforeEach(() => {
    mockReset(prismaMock)
    cancel.mockReset()
    cancel.mockResolvedValue({})
  })

  it('cancels each organization subscription immediately', async () => {
    prismaMock.subscription.findMany.mockResolvedValue([
      { organizationId: 'org-1', stripeSubscriptionId: 'sub_1' },
      { organizationId: 'org-2', stripeSubscriptionId: 'sub_2' }
    ] as any)

    await cancelSubscriptionsForOrganizations(['org-1', 'org-2'])

    expect(cancel).toHaveBeenCalledTimes(2)
    expect(cancel).toHaveBeenCalledWith('sub_1')
    expect(cancel).toHaveBeenCalledWith('sub_2')
  })

  it('asks Stripe nothing when there are no organizations', async () => {
    await cancelSubscriptionsForOrganizations([])

    expect(prismaMock.subscription.findMany).not.toHaveBeenCalled()
    expect(cancel).not.toHaveBeenCalled()
  })

  it('skips an organization that never had a Stripe subscription', async () => {
    prismaMock.subscription.findMany.mockResolvedValue([
      { organizationId: 'org-1', stripeSubscriptionId: null }
    ] as any)

    await cancelSubscriptionsForOrganizations(['org-1'])

    expect(cancel).not.toHaveBeenCalled()
  })

  /**
   * It must throw rather than swallow. The caller turns this into a `502` and
   * abandons the deletion, leaving the account and the subscription both intact
   * — recoverable by trying again. Swallowing it would delete the rows naming
   * the subscription and leave nothing able to say what to cancel.
   */
  it('propagates a Stripe failure so the deletion can be abandoned', async () => {
    prismaMock.subscription.findMany.mockResolvedValue([
      { organizationId: 'org-1', stripeSubscriptionId: 'sub_1' }
    ] as any)
    cancel.mockRejectedValue(new Error('Stripe is down'))

    await expect(cancelSubscriptionsForOrganizations(['org-1'])).rejects.toThrow('Stripe is down')
  })
})
