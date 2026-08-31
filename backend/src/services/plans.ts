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
 * **Prices are deliberately absent, and stayed absent when billing arrived.**
 * The canvas draws €0 / €12 / €39 and docs/BACKLOG.md records that nobody has
 * decided them. features/0013 did not add a price field here: the amount lives
 * in Stripe and nowhere else, the application stores only a *price id* in
 * configuration (`STRIPE_PRICE_PRO`), and the customer sees the real figure on
 * Stripe's own Checkout page. A constant here would turn an undecided number
 * into a fact, and would be wrong the first time there is a promotion or a
 * second currency.
 */

export type PlanKey = 'free' | 'pro' | 'team'

/**
 * What a plan's `key` can actually be at runtime.
 *
 * `dev` is the development-only pseudo-plan below. It is **never stored** in
 * `Organization.planKey` and nothing can put it there — it exists only as
 * something `effectivePlan` can return — but it does reach the API and the UI
 * while the override is on, which is why it is in the type.
 */
export type EffectivePlanKey = PlanKey | 'dev'

/**
 * `null` means unlimited.
 *
 * Not `Infinity`: it does not survive `JSON.stringify` (it becomes `null`
 * anyway, silently), and a numeric sentinel like `-1` invites a comparison that
 * accidentally works. `null` forces every call site to handle "no limit" as its
 * own case, which is what `isWithin` below does once for all of them.
 */
export interface Plan {
  key: EffectivePlanKey
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
   * Not enforced here — `PublicFormView.vue` still always shows the mark.
   * features/0013 made Pro buyable, so for the first time there *is* somebody
   * to turn it off for, but removing the mark is a change to the public form
   * with its own tests and folding it into the billing diff would have made
   * that diff unreviewable. Its row in docs/BACKLOG.md is still open.
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
    // `Subscription` says how many were paid for. features/0013 shipped Free ↔
    // Pro only and deliberately left Team out, precisely because per-seat
    // quantity billing has to stay in step with `Membership`; this stays `null`
    // until that change.
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

// ─────────────────────────────────────────────────────────────────────────────
// Development override — TEMPORARY
//
// Everything from here to the end of this file exists so that the product can
// be used without plan limits while it is being built, and it is meant to be
// deleted. Removing it is: delete this block, point `effectivePlan` at
// `resolvePlan` (or replace the two call sites in `entitlements.ts`), and drop
// `DEV_PLAN_KEY` from `.env.example`. Nothing else reads any of it.
//
// The successor is per-environment configuration — a staging deployment that
// simply runs on a real plan — not a flag that has to be remembered.
//
// **It interacts with billing, and the direction matters.** `effectivePlan`
// returns the override *before* it looks at the stored `planKey`, so the
// override wins over a real Stripe subscription. Testing billing with
// `DEV_PLAN_KEY` set therefore shows the plan working whether or not the
// webhook did anything — which is exactly the false positive this whole feature
// is written to avoid. Leave it empty when verifying billing (features/0013).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A plan with nothing switched off. Development only.
 *
 * **Not a member of `PLANS`**, deliberately. `PLANS` is the product catalogue,
 * taken from the design canvas, and a fake tier inside it would eventually be
 * offered to somebody. This is reachable only through `DEV_PLAN_KEY`.
 *
 * It is called "Developer" rather than something invisible because the name is
 * rendered — in the sidebar card and on the Settings screen. Seeing `Developer`
 * where a customer would see `Free` is the signal that limits are off, and it
 * is the reason not to make this look like a real plan.
 */
export const DEV_PLAN: Readonly<Plan> = Object.freeze({
  key: 'dev',
  name: 'Developer',
  maxPublishedForms: null,
  maxResponsesPerMonth: null,
  seats: null,
  hasBranding: true,
  hasApiAccess: true
})

/**
 * Environments in which `DEV_PLAN_KEY` is honoured.
 *
 * An **allowlist, not a denylist**, and that is the whole safety property. The
 * obvious version of this check is `NODE_ENV !== 'production'`, which honours
 * the override whenever `NODE_ENV` is unset, misspelled, or lost by a process
 * manager — every one of which is a way a real deployment ends up giving the
 * product away with no error anywhere. Here the failure mode of a missing or
 * unexpected `NODE_ENV` is that limits are *enforced*, which is the direction a
 * mistake should fail in (`config/env.ts` states the same rule).
 */
const OVERRIDE_ENVIRONMENTS = ['development', 'test']

/** So a permanent condition does not print on every request. */
const announced = new Set<string>()

function announce(message: string, level: 'warn' | 'error' = 'warn'): void {
  if (announced.has(message)) return
  announced.add(message)
  console[level](message)
}

/**
 * The plan `DEV_PLAN_KEY` forces, or `null` when there is no override.
 *
 * Read from the environment on every call rather than captured at import time,
 * so that a test can turn it on and off — the same reason the rate limiters
 * read their limits lazily.
 *
 * Two values are useful and they do opposite things:
 *
 *   - `DEV_PLAN_KEY=dev` — no limits at all. Build without hitting them.
 *   - `DEV_PLAN_KEY=free` — pins *every* organization to the free plan, which
 *     is how the limit screens get exercised on purpose instead of by waiting
 *     to trip over them.
 */
function devPlanOverride(): Readonly<Plan> | null {
  const requested = process.env.DEV_PLAN_KEY?.trim()
  if (!requested) return null

  const environment = process.env.NODE_ENV?.trim() ?? ''

  if (!OVERRIDE_ENVIRONMENTS.includes(environment)) {
    announce(
      `DEV_PLAN_KEY="${requested}" is set and is being IGNORED: it applies only ` +
      `when NODE_ENV is one of ${OVERRIDE_ENVIRONMENTS.join(', ')} ` +
      `(NODE_ENV is currently ${environment ? `"${environment}"` : 'unset'}). ` +
      `Plan limits are being enforced normally.`,
      'error'
    )
    return null
  }

  if (requested === 'dev') {
    announce('DEV_PLAN_KEY=dev — plan limits are OFF for every organization.')
    return DEV_PLAN
  }

  const plan = (PLANS as Record<string, Readonly<Plan>>)[requested]

  if (!plan) {
    announce(
      `DEV_PLAN_KEY="${requested}" is not a plan. Expected "dev" or one of ` +
      `${Object.keys(PLANS).join(', ')}. Ignoring it.`,
      'error'
    )
    return null
  }

  announce(`DEV_PLAN_KEY=${requested} — every organization is on the ${plan.name} plan.`)
  return plan
}

/**
 * The plan actually in force for a stored `planKey`.
 *
 * **This, not `resolvePlan`, is what every limit check must call**, so that the
 * override has exactly one way in and one way out. `resolvePlan` stays pure and
 * is what tests assert the catalogue with.
 */
export function effectivePlan(storedKey: string): Readonly<Plan> {
  return devPlanOverride() ?? resolvePlan(storedKey)
}
