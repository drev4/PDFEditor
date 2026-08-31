import { describe, it, expect, vi, beforeEach } from 'vitest'
import { billingService } from './billing'
import { api } from './api'

vi.mock('./api')

/**
 * The billing service ([`features/0013`](../../../features/0013-stripe-subscriptions.md)).
 *
 * Small, and the assertions are about what it does **not** do as much as what
 * it does: it sends no organization, receives no plan, and grants nothing.
 */
describe('billingService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('asks the server for a Checkout URL and sends no organization', async () => {
    vi.mocked(api.post).mockResolvedValue({ url: 'https://checkout.stripe.test/s' } as never)

    const url = await billingService.checkoutUrl()

    expect(url).toBe('https://checkout.stripe.test/s')
    // The organization comes from the caller's membership, server-side. A
    // client-supplied one would be an authorization decision made in a browser.
    // The plan is not that: it is which product to buy, and the server still
    // resolves who is buying it (features/0015).
    expect(api.post).toHaveBeenCalledWith('/billing/checkout', { plan: 'pro' })
  })

  it('names the plan being bought, and sends no quantity with it', async () => {
    vi.mocked(api.post).mockResolvedValue({ url: 'https://checkout.stripe.test/team' } as never)

    await billingService.checkoutUrl('team')

    // Seats are bought on Stripe's own page and changed in the portal. This
    // client has no seat picker and never asks Stripe for a number
    // (features/0015, trap 1).
    expect(api.post).toHaveBeenCalledWith('/billing/checkout', { plan: 'team' })
  })

  it('asks the server for a Portal URL', async () => {
    vi.mocked(api.post).mockResolvedValue({ url: 'https://portal.stripe.test/s' } as never)

    expect(await billingService.portalUrl()).toBe('https://portal.stripe.test/s')
    expect(api.post).toHaveBeenCalledWith('/billing/portal', {})
  })

  it('exposes no way to grant a plan', () => {
    // The plan moves when Stripe's webhook says so and never because this
    // client asked (features/0013, trap 2). If a `subscribe()` or `setPlan()`
    // ever appears here, that guarantee is gone.
    expect(Object.keys(billingService).sort()).toEqual(['checkoutUrl', 'portalUrl'])
  })
})
