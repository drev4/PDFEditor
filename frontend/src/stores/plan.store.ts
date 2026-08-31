import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  planService,
  type Entitlements,
  type Plan,
  type PlanUsage,
  type Subscription
} from '../services/plan'
import { billingService, type BuyablePlan } from '../services/billing'
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
  const subscription = ref<Subscription | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  /**
   * Set while a Checkout or Portal URL is being fetched.
   *
   * Separate from `loading`, which the sidebar card watches: turning the whole
   * plan card into a spinner because someone pressed "Change plan" would move
   * the eye to the wrong place. It also stops a second click opening a second
   * Checkout Session.
   */
  const billingRedirecting = ref(false)
  const billingError = ref<string | null>(null)

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
        subscription.value = entitlements.subscription
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
          subscription.value = entitlements.subscription
        },
        { skipLoading: true }
      )
    } catch {
      // Deliberately ignored; see above.
    }
  }

  /**
   * Whether there is a Stripe subscription to *manage* — which is what gates
   * the "Manage billing" button, and is not the same question as "are they on
   * Pro".
   *
   * That second question is `plan.key`, and it is answered by the server: the
   * status→plan decision lives in one tested function (`planKeyForStatus`) and
   * re-deriving it here from `subscription.status` would be a second map that
   * can disagree with the one actually enforcing the limits. A cancelled
   * subscription is `plan.key === 'free'` and still has a portal worth opening.
   */
  const hasSubscription = computed(() => subscription.value !== null)

  /**
   * Sends the browser to a Stripe-hosted page.
   *
   * A full navigation, not a popup or an iframe: Stripe's pages set their own
   * frame-ancestors, and the whole point of hosted Checkout is that the card is
   * typed on Stripe's origin.
   *
   * **This grants nothing.** Coming back from Checkout is not proof of payment
   * — the redirect is a URL anyone can visit, the payment may still be
   * processing, and a customer who closes the tab never returns at all
   * (`features/0013`, trap 2). The plan moves when Stripe's webhook says so,
   * and this client only ever learns about it by re-reading entitlements.
   */
  async function goToStripe(getUrl: () => Promise<string>) {
    if (billingRedirecting.value) return

    billingRedirecting.value = true
    billingError.value = null

    try {
      window.location.assign(await getUrl())
    } catch (e) {
      billingError.value =
        e instanceof Error ? e.message : 'Could not reach the billing service.'
      // Only reset on failure. On success the page is navigating away, and
      // clearing the flag would let a second click open a second Checkout
      // Session in the moment before it does.
      billingRedirecting.value = false
    }
  }

  /**
   * Opens Stripe Checkout for a plan. Owner only; the API enforces it.
   *
   * `pro` by default, which is what every call site meant before Team could be
   * bought (features/0015). The plan is a *purchase* choice, not a plan switch:
   * changing an existing subscription is the portal's job, and the API refuses a
   * second checkout while one is live.
   */
  function startCheckout(plan: BuyablePlan = 'pro') {
    return goToStripe(() => billingService.checkoutUrl(plan))
  }

  /** Opens the Stripe Customer Portal — cancel, resume, change card, invoices. */
  function openBillingPortal() {
    return goToStripe(billingService.portalUrl)
  }

  return {
    plan,
    usage,
    subscription,
    loading,
    error,
    billingRedirecting,
    billingError,
    responsesFraction,
    publishedFormsFraction,
    atPublishedFormLimit,
    hasSubscription,
    load,
    refresh,
    startCheckout,
    openBillingPortal
  }
})
