import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePlanStore } from './plan.store'
import { planService, type Entitlements } from '../services/plan'
import { billingService } from '../services/billing'

vi.mock('../services/plan')
vi.mock('../services/billing')

const freePlan: Entitlements = {
  plan: {
    key: 'free',
    name: 'Free',
    maxPublishedForms: 1,
    maxResponsesPerMonth: 50,
    seats: 1,
    hasApiAccess: false
  },
  usage: { publishedForms: 0, responsesThisPeriod: 10, seats: 1 },
  // features/0013 added this. `null` is what the API reports for an
  // organization that has never bought anything, which is every organization
  // until a Stripe webhook says otherwise.
  subscription: null
}

describe('Plan Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(planService.entitlements).mockResolvedValue(freePlan)
  })

  it('holds nothing until it has loaded', () => {
    const store = usePlanStore()

    // The sidebar card renders only when `plan` is set. Anything else here
    // would be an invented number on the screen someone checks before deciding
    // whether they can publish.
    expect(store.plan).toBeNull()
    expect(store.usage).toBeNull()
    expect(store.responsesFraction).toBeNull()
  })

  it('loads the plan and the usage', async () => {
    const store = usePlanStore()

    await store.load()

    expect(store.plan?.name).toBe('Free')
    expect(store.usage?.responsesThisPeriod).toBe(10)
    expect(store.loading).toBe(false)
  })

  it('reports a fraction of a real limit', async () => {
    const store = usePlanStore()

    await store.load()

    expect(store.responsesFraction).toBeCloseTo(0.2)
  })

  it('reports no fraction for an unlimited allowance', async () => {
    vi.mocked(planService.entitlements).mockResolvedValue({
      plan: { ...freePlan.plan, key: 'pro', name: 'Pro', maxPublishedForms: null },
      usage: { publishedForms: 9, responsesThisPeriod: 10, seats: 1 },
      subscription: null
    })
    const store = usePlanStore()

    await store.load()

    // `null`, not 0 and not 1. A fraction of infinity is not a measure of
    // anything, and either number would be drawn as a bar that means something.
    expect(store.publishedFormsFraction).toBeNull()
  })

  it('never reports a fraction above 1', async () => {
    vi.mocked(planService.entitlements).mockResolvedValue({
      plan: freePlan.plan,
      usage: { publishedForms: 0, responsesThisPeriod: 80, seats: 1 },
      subscription: null
    })
    const store = usePlanStore()

    await store.load()

    expect(store.responsesFraction).toBe(1)
  })

  describe('atPublishedFormLimit', () => {
    it('is true once the slots are used', async () => {
      vi.mocked(planService.entitlements).mockResolvedValue({
        plan: freePlan.plan,
        usage: { publishedForms: 1, responsesThisPeriod: 0, seats: 1 },
        subscription: null
      })
      const store = usePlanStore()

      await store.load()

      expect(store.atPublishedFormLimit).toBe(true)
    })

    it('is false while a slot is free', async () => {
      const store = usePlanStore()

      await store.load()

      expect(store.atPublishedFormLimit).toBe(false)
    })

    it('is false on a plan with no limit', async () => {
      vi.mocked(planService.entitlements).mockResolvedValue({
        plan: { ...freePlan.plan, maxPublishedForms: null },
        usage: { publishedForms: 500, responsesThisPeriod: 0, seats: 1 },
        subscription: null
      })
      const store = usePlanStore()

      await store.load()

      expect(store.atPublishedFormLimit).toBe(false)
    })
  })

  describe('refresh', () => {
    it('updates the numbers without raising the loading flag', async () => {
      const store = usePlanStore()
      await store.load()

      vi.mocked(planService.entitlements).mockResolvedValue({
        plan: freePlan.plan,
        usage: { publishedForms: 1, responsesThisPeriod: 11, seats: 1 },
        subscription: null
      })
      await store.refresh()

      expect(store.usage?.responsesThisPeriod).toBe(11)
      expect(store.loading).toBe(false)
    })

    it('swallows a failure and keeps the numbers it had', async () => {
      const store = usePlanStore()
      await store.load()

      vi.mocked(planService.entitlements).mockRejectedValue(new Error('offline'))

      // It runs after an action that already succeeded, so a rejection here
      // must not surface as a failure of that action.
      await expect(store.refresh()).resolves.toBeUndefined()
      expect(store.usage?.responsesThisPeriod).toBe(10)
    })
  })

  it('records the error when the first load fails', async () => {
    vi.mocked(planService.entitlements).mockRejectedValue(new Error('nope'))
    const store = usePlanStore()

    await expect(store.load()).rejects.toThrow()
    expect(store.error).toBe('nope')
    expect(store.plan).toBeNull()
  })

  /**
   * Billing (features/0013).
   *
   * Everything here is about the store handing the browser to Stripe and
   * nothing else. The store must never decide a plan: it reports whatever the
   * server last said, and the server only changes its mind on a webhook.
   */
  describe('billing', () => {
    /** `window.location.assign`, replaced so the test does not navigate. */
    let assign: ReturnType<typeof vi.fn>

    beforeEach(() => {
      assign = vi.fn()
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: { ...window.location, assign }
      })
    })

    const subscribed: Entitlements = {
      plan: { ...freePlan.plan, key: 'pro', name: 'Pro', maxPublishedForms: null },
      usage: { publishedForms: 4, responsesThisPeriod: 10, seats: 1 },
      subscription: {
        status: 'active',
        currentPeriodEnd: '2026-02-01T00:00:00.000Z',
        cancelAtPeriodEnd: false
      }
    }

    it('holds no subscription for an organization that has never bought anything', async () => {
      const store = usePlanStore()

      await store.load()

      expect(store.subscription).toBeNull()
      // So "Manage billing" is never offered to somebody with no billing
      // account at Stripe to manage.
      expect(store.hasSubscription).toBe(false)
    })

    it('loads the subscription the server reported', async () => {
      vi.mocked(planService.entitlements).mockResolvedValue(subscribed)
      const store = usePlanStore()

      await store.load()

      expect(store.hasSubscription).toBe(true)
      expect(store.subscription?.status).toBe('active')
      expect(store.subscription?.cancelAtPeriodEnd).toBe(false)
    })

    it('picks up a subscription on a refresh, which is how activation arrives', async () => {
      const store = usePlanStore()
      await store.load()
      expect(store.hasSubscription).toBe(false)

      // The webhook landed while the customer was being redirected back. This
      // is the only way this client ever learns that a payment succeeded.
      vi.mocked(planService.entitlements).mockResolvedValue(subscribed)
      await store.refresh()

      expect(store.hasSubscription).toBe(true)
      expect(store.plan?.key).toBe('pro')
    })

    it('sends the browser to Stripe Checkout', async () => {
      vi.mocked(billingService.checkoutUrl).mockResolvedValue('https://checkout.stripe.test/s')
      const store = usePlanStore()

      await store.startCheckout()

      expect(assign).toHaveBeenCalledWith('https://checkout.stripe.test/s')
      // And it granted nothing on the way.
      expect(store.plan).toBeNull()
      expect(store.subscription).toBeNull()
    })

    it('sends the browser to the Stripe portal', async () => {
      vi.mocked(billingService.portalUrl).mockResolvedValue('https://portal.stripe.test/s')
      const store = usePlanStore()

      await store.openBillingPortal()

      expect(assign).toHaveBeenCalledWith('https://portal.stripe.test/s')
    })

    it('ignores a second click while the first is still in flight', async () => {
      let release: (url: string) => void = () => {}
      vi.mocked(billingService.checkoutUrl).mockReturnValue(
        new Promise(resolve => {
          release = resolve
        })
      )
      const store = usePlanStore()

      const first = store.startCheckout()
      await store.startCheckout()

      // A second Checkout Session for one intention is a customer who can end
      // up looking at two of them.
      expect(billingService.checkoutUrl).toHaveBeenCalledTimes(1)

      release('https://checkout.stripe.test/s')
      await first
    })

    it('reports a failure instead of navigating', async () => {
      vi.mocked(billingService.checkoutUrl).mockRejectedValue(new Error('Stripe is down'))
      const store = usePlanStore()

      await store.startCheckout()

      expect(assign).not.toHaveBeenCalled()
      expect(store.billingError).toBe('Stripe is down')
      // Reset only on failure, so the button can be pressed again.
      expect(store.billingRedirecting).toBe(false)
    })
  })
})
