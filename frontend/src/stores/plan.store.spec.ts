import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePlanStore } from './plan.store'
import { planService, type Entitlements } from '../services/plan'

vi.mock('../services/plan')

const freePlan: Entitlements = {
  plan: {
    key: 'free',
    name: 'Free',
    maxPublishedForms: 1,
    maxResponsesPerMonth: 50,
    seats: 1
  },
  usage: { publishedForms: 0, responsesThisPeriod: 10, seats: 1 }
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
      usage: { publishedForms: 9, responsesThisPeriod: 10, seats: 1 }
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
      usage: { publishedForms: 0, responsesThisPeriod: 80, seats: 1 }
    })
    const store = usePlanStore()

    await store.load()

    expect(store.responsesFraction).toBe(1)
  })

  describe('atPublishedFormLimit', () => {
    it('is true once the slots are used', async () => {
      vi.mocked(planService.entitlements).mockResolvedValue({
        plan: freePlan.plan,
        usage: { publishedForms: 1, responsesThisPeriod: 0, seats: 1 }
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
        usage: { publishedForms: 500, responsesThisPeriod: 0, seats: 1 }
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
        usage: { publishedForms: 1, responsesThisPeriod: 11, seats: 1 }
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
})
