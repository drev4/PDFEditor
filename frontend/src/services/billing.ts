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
export const billingService = {
  /** A Stripe Checkout URL for the Pro plan. Owner only, server-side. */
  async checkoutUrl(): Promise<string> {
    const { url } = await api.post<{ url: string }>('/billing/checkout', {})
    return url
  },

  /** A Stripe Customer Portal URL. Owner only, server-side. */
  async portalUrl(): Promise<string> {
    const { url } = await api.post<{ url: string }>('/billing/portal', {})
    return url
  }
}
