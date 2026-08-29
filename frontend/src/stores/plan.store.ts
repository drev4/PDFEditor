import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { planService, type Entitlements, type Plan, type PlanUsage } from '../services/plan'
import { useAsyncAction } from '../composables/useAsyncAction'

/**
 * The organization's plan and what it has used
 * ([`features/0012`](../../../features/0012-plan-catalogue-and-entitlements.md)).
 *
 * Read in two places that are on screen constantly — the sidebar card and the
 * plan section of Settings — so it is a store rather than a composable: the
 * state outlives any one component and must not be fetched once per mount.
 *
 * It is refreshed after anything that moves a number (publishing, unpublishing)
 * rather than polled. A card showing yesterday's usage is worse than no card,
 * because it is the number someone checks before deciding whether they can
 * publish.
 */
export const usePlanStore = defineStore('plan', () => {
  const plan = ref<Plan | null>(null)
  const usage = ref<PlanUsage | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  /** `null` while unknown or unlimited — never a made-up percentage. */
  function fraction(used: number | undefined, limit: number | null | undefined): number | null {
    if (used === undefined || limit === null || limit === undefined || limit <= 0) return null
    return Math.min(used / limit, 1)
  }

  const responsesFraction = computed(() =>
    fraction(usage.value?.responsesThisPeriod, plan.value?.maxResponsesPerMonth)
  )

  const publishedFormsFraction = computed(() =>
    fraction(usage.value?.publishedForms, plan.value?.maxPublishedForms)
  )

  /** True once publishing another form would be refused. */
  const atPublishedFormLimit = computed(() => {
    const limit = plan.value?.maxPublishedForms
    if (limit === null || limit === undefined) return false
    return (usage.value?.publishedForms ?? 0) >= limit
  })

  async function load() {
    return useAsyncAction(
      { loading, error },
      async () => {
        const entitlements: Entitlements = await planService.entitlements()
        plan.value = entitlements.plan
        usage.value = entitlements.usage
        return entitlements
      },
      { fallbackMessage: 'Failed to load plan' }
    )
  }

  /**
   * Refresh without the loading flag.
   *
   * Called after publishing or unpublishing, where the numbers have moved but
   * the user is not waiting on them — flipping the sidebar card into a spinner
   * for that would draw the eye to the wrong thing. Failures are swallowed for
   * the same reason: a stale card is not worth an error toast on an action that
   * succeeded.
   */
  async function refresh() {
    try {
      await useAsyncAction(
        { loading, error },
        async () => {
          const entitlements = await planService.entitlements()
          plan.value = entitlements.plan
          usage.value = entitlements.usage
        },
        { skipLoading: true }
      )
    } catch {
      // Deliberately ignored; see above.
    }
  }

  return {
    plan,
    usage,
    loading,
    error,
    responsesFraction,
    publishedFormsFraction,
    atPublishedFormLimit,
    load,
    refresh
  }
})
