import { api } from './api'

/**
 * What the organization's plan allows, and what it has used.
 *
 * `null` means unlimited, everywhere. It is the same representation the backend
 * catalogue uses (`backend/src/services/plans.ts`), on purpose: a sentinel like
 * `-1` or `Infinity` invites a comparison that accidentally works, and
 * `Infinity` does not survive JSON at all.
 *
 * There is no price here and no billing identifier. There is no billing in this
 * product yet — the prices drawn on the design canvas are not a decision anyone
 * has taken (`docs/BACKLOG.md`), so no screen may render one as if they were.
 */
export interface Plan {
  key: 'free' | 'pro' | 'team'
  name: string
  /** How many forms may be **published at once** — not how many may exist. */
  maxPublishedForms: number | null
  maxResponsesPerMonth: number | null
  seats: number | null
}

export interface PlanUsage {
  publishedForms: number
  responsesThisPeriod: number
  seats: number
}

export interface Entitlements {
  plan: Plan
  usage: PlanUsage
}

export const planService = {
  async entitlements(): Promise<Entitlements> {
    return api.get<Entitlements>('/organizations/entitlements')
  }
}
