import { api } from './api'

/**
 * What the organization's plan allows, and what it has used.
 *
 * `null` means unlimited, everywhere. It is the same representation the backend
 * catalogue uses (`backend/src/services/plans.ts`), on purpose: a sentinel like
 * `-1` or `Infinity` invites a comparison that accidentally works, and
 * `Infinity` does not survive JSON at all.
 *
 * **There is no price here and no Stripe identifier, and there must never be.**
 * The amount lives in Stripe and nowhere else (`features/0013`, trap 7): nobody
 * has decided the real numbers (`docs/BACKLOG.md`), so no screen may render one
 * from a constant as if they had. The Stripe customer and subscription ids are
 * credentials for a third-party API and nothing on screen needs them — every
 * billing action goes through `services/billing.ts`, which asks the server for a
 * URL and lets the server resolve the organization from the session.
 */
export interface Plan {
  /**
   * `dev` is the backend's development-only override (`DEV_PLAN_KEY`), which
   * really does reach this client while it is on — it is in the type so that
   * nothing here assumes the key is always a sellable plan. It is never stored
   * and can never appear from a production API.
   */
  key: 'free' | 'pro' | 'team' | 'dev'
  name: string
  /** How many forms may be **published at once** — not how many may exist. */
  maxPublishedForms: number | null
  maxResponsesPerMonth: number | null
  /**
   * The seat limit **in force**, which is not always the catalogue's number
   * (`features/0015`).
   *
   * Team's seats are bought rather than declared, so for a Team organization
   * this is the quantity the customer actually paid for; for every other plan it
   * is the catalogue value unchanged. The server resolves it and sends one
   * number — the client is deliberately not told which of the two it got, and
   * must not try to work it out, because that would be a second copy of a rule
   * only the backend enforces.
   *
   * A member and a pending invitation each take a seat.
   */
  seats: number | null
  /**
   * Whether this organization may mint an API key (`features/0021`).
   *
   * **It decides what is drawn and never what is allowed.** `assertHasApiAccess`
   * inside `POST /api/organizations/api-keys` is the enforcer, and every screen
   * that acts on this flag must still handle the `402` — the plan can change
   * between a page loading and a button being pressed.
   *
   * It is sent because the alternative is a create button whose only possible
   * answer is `402`, which reads as a broken product rather than an enforced
   * rule ([05-frontend-patterns §8](../../../docs/sot/05-frontend-patterns.md)).
   */
  hasApiAccess: boolean
}

export interface PlanUsage {
  publishedForms: number
  responsesThisPeriod: number
  seats: number
}

/**
 * What the customer has bought, or `null` if nothing.
 *
 * `null` covers both "never opened checkout" and "opened checkout and did not
 * finish": the server reports a subscription only once one actually exists at
 * Stripe, so a "Manage billing" button is never offered to somebody who has
 * never paid.
 *
 * `status` is Stripe's own string, passed through. It is **not** what decides
 * the plan — the server did that, and `plan` above is the answer. It is here so
 * a screen can say "we are retrying your card" rather than silently showing Pro.
 */
export interface Subscription {
  status: string
  /** ISO 8601, or `null`. When the current paid period ends. */
  currentPeriodEnd: string | null
  /** `true` when the customer has cancelled and keeps the plan until then. */
  cancelAtPeriodEnd: boolean
}

export interface Entitlements {
  plan: Plan
  usage: PlanUsage
  subscription: Subscription | null
}

export const planService = {
  async entitlements(): Promise<Entitlements> {
    return api.get<Entitlements>('/organizations/entitlements')
  }
}
