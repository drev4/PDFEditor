/**
 * The plan catalogue.
 *
 * A **constant in code, not a table** — the roadmap is explicit about this
 * (docs/sot/10-saas-roadmap.md): a table only earns its place when a customer
 * needs limits nobody else has, and until then a table is a second source of
 * truth that can drift from the code enforcing it.
 *
 * Every name, price tier and number here is taken from the `Plans` and
 * `LimitReached` artboards of the design canvas (docs/sot/05-frontend-patterns.md
 * §8). Nothing here was invented, and nothing here should be changed without
 * changing the canvas — a limit the product enforces and a limit the design
 * promises must be the same limit.
 *
 * **Prices are deliberately absent.** The canvas draws €0 / €12 / €39, and
 * docs/BACKLOG.md records that nobody has actually decided them. There is no
 * billing in this product, so a price here would be a number the code states
 * and the business has not agreed to.
 */

export type PlanKey = 'free' | 'pro' | 'team'

/**
 * `null` means unlimited.
 *
 * Not `Infinity`: it does not survive `JSON.stringify` (it becomes `null`
 * anyway, silently), and a numeric sentinel like `-1` invites a comparison that
 * accidentally works. `null` forces every call site to handle "no limit" as its
 * own case, which is what `isWithin` below does once for all of them.
 */
export interface Plan {
  key: PlanKey
  /** As drawn on the canvas. Shown to the user; never parsed. */
  name: string
  /**
   * How many forms may be **published** at once — not how many may exist.
   *
   * The canvas is unambiguous on this and it is the humane reading: the
   * `LimitReached` artboard says "The Free plan keeps one form published at a
   * time … stays a draft until you free up a slot or upgrade". Drafting is
   * always free; publishing is the moment the product delivers value, and so it
   * is the moment that is metered.
   */
  maxPublishedForms: number | null
  maxResponsesPerMonth: number | null
  /**
   * Members plus outstanding invitations.
   *
   * **Written but not enforced yet.** See `assertCanInvite` in
   * `entitlements.ts` for why, and docs/BACKLOG.md for the row that closes it.
   */
  seats: number | null
  /**
   * `true` when the organization may remove the "Made with VuePDF" mark from
   * its public forms. Named as the roadmap names it; read it as *has its own
   * branding*, not *has our branding*.
   *
   * Not enforced here — `PublicFormView.vue` still always shows the mark. With
   * no way to be on a paid plan there is nothing to turn it off for, so wiring
   * it would be unobservable and untestable. Step 8.
   */
  hasBranding: boolean
  /** Not enforced: there is no public API. Step 10 of the build order. */
  hasApiAccess: boolean
}

export const PLANS: Readonly<Record<PlanKey, Readonly<Plan>>> = Object.freeze({
  free: Object.freeze({
    key: 'free',
    name: 'Free',
    maxPublishedForms: 1,
    maxResponsesPerMonth: 50,
    seats: 1,
    hasBranding: false,
    hasApiAccess: false
  }),
  pro: Object.freeze({
    key: 'pro',
    name: 'Pro',
    maxPublishedForms: null,
    maxResponsesPerMonth: 2000,
    // "Single member" on the canvas. Team is the plan that adds people.
    seats: 1,
    hasBranding: true,
    hasApiAccess: false
  }),
  team: Object.freeze({
    key: 'team',
    name: 'Team',
    maxPublishedForms: null,
    maxResponsesPerMonth: 25000,
    // The canvas prices Team as "€39 / month + €6 per seat", so the seat count
    // is bought rather than fixed — there is no number to put here until a
    // `Subscription` says how many were paid for. `null` until step 8.
    seats: null,
    hasBranding: true,
    hasApiAccess: true
  })
})

export const DEFAULT_PLAN_KEY: PlanKey = 'free'

/**
 * The plan for a stored `Organization.planKey`.
 *
 * Never throws and never resolves upward. A column holding a plan that no
 * longer exists — a renamed tier, a hand-edited row, a rollback — must degrade
 * to the least generous plan, not the most: the failure mode of guessing high
 * is giving away the product silently. Same safe-default discipline as
 * `envInt`/`envBool` in `config/env.ts`, and the warning is there so the bad
 * value is visible rather than absorbed.
 */
export function resolvePlan(planKey: string): Readonly<Plan> {
  const plan = (PLANS as Record<string, Readonly<Plan>>)[planKey]

  if (!plan) {
    console.warn(
      `Unknown planKey="${planKey}"; falling back to "${DEFAULT_PLAN_KEY}"`
    )
    return PLANS[DEFAULT_PLAN_KEY]
  }

  return plan
}

/** `true` when `used` is inside `limit`. A `null` limit is always within. */
export function isWithin(used: number, limit: number | null): boolean {
  return limit === null || used < limit
}
