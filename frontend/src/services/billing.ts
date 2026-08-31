import { api } from './api'

/**
 * Buying and managing the subscription
 * ([`features/0013`](../../../features/0013-stripe-subscriptions.md)).
 *
 * Two calls, and both of them do the same thing: ask the API for a
 * Stripe-hosted URL and go there. **No card field, no price field and no
 * cancellation form exists in this application** — Checkout and the Customer
 * Portal are Stripe's own pages, which is what keeps every card number off this
 * origin and the whole PCI surface Stripe's.
 *
 * Neither call takes an organization. The server resolves it from the caller's
 * membership; a client-supplied organization would be an authorization decision
 * made in the browser.
 *
 * There is no `subscribe()` here that returns a plan, and there deliberately
 * cannot be: **nothing in this client may grant a plan.** The subscription
 * becomes real when Stripe's webhook says so, and the only way this application
 * learns about it is by re-reading `GET /api/organizations/entitlements`.
 */

/**
 * The plans Checkout can sell.
 *
 * `free` is absent on purpose: it is what an organization falls back to, never
 * something bought, and the API's own enum refuses it.
 */
export type BuyablePlan = 'pro' | 'team'

export const billingService = {
  /**
   * A Stripe Checkout URL for a plan. Owner only, server-side.
   *
   * **No quantity is sent**, for Team either (features/0015). Seats are bought
   * on Stripe's own page, where the per-seat amount is shown, and changed later
   * in the portal; this client has no seat picker and never asks Stripe for a
   * number.
   */
  async checkoutUrl(plan: BuyablePlan = 'pro'): Promise<string> {
    const { url } = await api.post<{ url: string }>('/billing/checkout', { plan })
    return url
  },

  /** A Stripe Customer Portal URL. Owner only, server-side. */
  async portalUrl(): Promise<string> {
    const { url } = await api.post<{ url: string }>('/billing/portal', {})
    return url
  }
}
