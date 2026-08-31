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
    expect(api.post).toHaveBeenCalledWith('/billing/checkout', {})
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
