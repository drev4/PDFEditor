# 0012 — Plan catalogue and entitlements, with `402` on a limit reached

**Status:** in progress
**Priority:** P2 (see [`docs/BACKLOG.md`](../docs/BACKLOG.md) — *`Plan` catalogue + entitlements service, `402` on limit reached*)
**Branch:** `feature/0012-plan-catalogue-and-entitlements`
**Related:** [10-saas-roadmap](../docs/sot/10-saas-roadmap.md#entitlements-where-plan-limits-get-checked) (step 7 of the build order) · [03-domain-model](../docs/sot/03-domain-model.md) · [04-backend-patterns §9](../docs/sot/04-backend-patterns.md) · [06-api-reference](../docs/sot/06-api-reference.md) · [05-frontend-patterns §8](../docs/sot/05-frontend-patterns.md)

## Context

Step 7 of the [build order](../docs/sot/10-saas-roadmap.md#build-order). Steps 0–6 are closed: tenancy is real (`Organization` owns every `Form`, [`features/0009`](0009-organizations-own-resources.md)), roles are enforced ([`features/0010`](0010-member-invitations-and-role-enforcement.md)), and the design system is built ([`features/0011`](0011-adopt-the-design-system.md)). Nothing limits what an organization may do. One account can create unbounded forms, collect unbounded responses and invite unbounded members, and there is no number anywhere in the product that says otherwise.

The reason this comes **before** Stripe is stated in the roadmap and is the whole point of the step: *validate the "limit reached" UX before money is involved.* The two screens it needs — `Plans` and `LimitReached` — are already drawn on the design canvas, in a token system the app now speaks. Building the enforcement now means that when billing arrives in step 8, the only new thing is the payment: the limits, the `402`, the usage numbers and the screens already exist and have been used.

There is a second reason, less obvious and more important. A usage number that is invented for a dashboard and a usage number that an invoice is computed from must be **the same number**, produced by the same code. Building the meter first, while nobody is charged for being wrong, is the only cheap time to get it right.

No prior attempt exists: `grep -rn 'entitlement\|planKey\|402' backend/src frontend/src` finds only two comments saying this does not exist yet — `frontend/src/views/PublicFormView.vue:106` and `frontend/src/views/SettingsView.vue:36` — plus the comment in `frontend/src/layouts/AppShell.vue` where the plan card belongs.

## Why the obvious approach is wrong

Six traps, in the order you will meet them.

### 1. `402` must never reach a respondent

The forms limit and the seats limit are hit by a **customer**, who is signed in and can act on the answer. The monthly response limit is hit by a **respondent**, who is an anonymous member of the public filling in someone else's form. Answering them with `402 Payment Required` — or with any message mentioning a plan, a limit or an upgrade — does two wrong things at once: it is meaningless to the person reading it, and it publishes the customer's billing state to anyone holding a share link.

The public surface must refuse with the wording it **already** uses for a form that is not accepting responses, indistinguishable from a closed form. `402` is for the authenticated author, and only there.

### 2. Rendering the public form and *then* refusing the submit destroys the respondent's work

If only `POST /api/responses` enforces the limit, someone fills in a long form and loses all of it at submit. The check has to live at `GET /api/forms/public/:shareId` **as well**, so an unavailable form is unavailable before anybody types into it. Two call sites, one helper, and the second is the one that is easy to forget.

### 3. Counting rows is not metering

The temptation is `prisma.response.count({ where: { form: { organizationId }, submittedAt: { gte: startOfMonth } } })` on every submission. It is a join over an unindexed path on the hottest write in the product, and — worse — it is **wrong as a meter**: deleting a form cascades its responses away (see the cascade map in [03-domain-model](../docs/sot/03-domain-model.md#cascade-map)), so a customer could delete a form and get the month's quota back, and the dashboard number would disagree with any invoice computed later.

The counter measures **submissions accepted during the period**, not rows that still exist. That is a deliberate semantic and it must be written down next to the model, because the first person to see the counter disagree with `SELECT count(*)` will assume it is a bug.

*Forms are different and must not be over-engineered.* `prisma.form.count({ where: { organizationId } })` is a single indexed count (`@@index([organizationId])`) on a rare write, and a forms limit genuinely is "how many exist right now" — a deleted form **does** free a slot. Count rows for forms; use the counter for responses. The roadmap's "monthly aggregate" advice applies to responses only.

### 4. Check-then-write races past the limit

Reading the counter, comparing, then incrementing lets two concurrent submissions both pass at `limit - 1`. Do not add a lock and do not accept the overshoot. Do it in one atomic step inside the same transaction as the response, and let the throw roll the increment back:

```ts
// shape, not final code — inside prisma.$transaction
const counter = await tx.usageCounter.upsert({
  where: { organizationId_period: { organizationId, period } },
  create: { organizationId, period, responses: 1 },
  update: { responses: { increment: 1 } }
})
if (counter.responses > plan.maxResponsesPerMonth) {
  // Rolls back the increment *and* the response. Nothing to compensate.
  throw new AppError(403, 'Form is not accepting responses')
}
```

The upsert takes the row lock, so the second transaction reads `limit + 1` and rejects. There is nothing to undo by hand.

### 5. Seats are members **plus** pending invitations

Checking `membership.count()` alone lets an organization at its seat limit issue any number of outstanding invitations, every one of which is redeemable. The seat check counts memberships plus invitations that are still redeemable — the same predicate `GET /api/organizations/invitations` already uses (`revokedAt: null, acceptedAt: null, expiresAt: { gt: new Date() }`) in `backend/src/routes/organizations.ts`.

### 6. This is not middleware

The roadmap says it and [04-backend-patterns §2](../docs/sot/04-backend-patterns.md) says it: each resource has a different limit, and a blanket layer cannot know which one applies without re-deriving the route. Entitlement checks are **explicit calls inside the handler**, next to `requireOrganizationId(req)` and `requireRole(req, [...])`, in exactly the same shape.

And the boundary from the roadmap that survives into step 8: **nothing in `routes/forms.ts` imports anything from a billing provider.** Domain routes ask the entitlements service a question about limits. Only `SubscriptionService` will ever know Stripe exists.

## Goal

Checkable when the work is done.

**Data model**

1. `Organization.planKey` exists, `String @default("free")`, with a migration created through `prisma migrate dev`. It is a plain string, not a Prisma enum: adding a plan must not require a migration, and step 8 will move the source of truth to `Subscription` without another schema change here.
2. An unknown `planKey` resolves to the free plan and logs a warning. It never throws, and it never resolves to the most generous plan.
3. `UsageCounter` exists — `{ id, organizationId, period, responses, createdAt, updatedAt }` — with `@@unique([organizationId, period])` and `onDelete: Cascade` from `Organization`. `period` is `YYYY-MM` in **UTC**.
4. The cascade map in [03-domain-model](../docs/sot/03-domain-model.md#cascade-map) has a row for it, and states that deleting a form does **not** decrement it.

**Backend**

5. `backend/src/services/plans.ts` exports the catalogue as a frozen constant — no table — with a `PlanKey` union and, per plan, `maxForms`, `maxResponsesPerMonth`, `seats`, `hasBranding`, `hasApiAccess`. Field names match the roadmap's entity table exactly.
6. `backend/src/services/entitlements.ts` exports `getEntitlements(organizationId)` → `{ plan, usage: { forms, responsesThisPeriod, seats } }`, plus `assertCanCreateForm`, `assertCanInvite` and `currentPeriod()`.
7. `POST /api/forms` returns **`402`** with a message naming the limit when the organization is at `maxForms`. No form row is created.
8. `POST /api/organizations/invitations` returns **`402`** when members + redeemable invitations are already at `seats`. No invitation row is created, and no token is minted.
9. `POST /api/responses` refuses at `maxResponsesPerMonth` with **`403`** and the message `Form is not accepting responses` — byte-identical to the existing unpublished-form rejection in `backend/src/routes/responses.ts`. The response and its answers are not persisted, and the counter is not left incremented.
10. `GET /api/forms/public/:shareId` returns **`404 Form not found`** for a form whose organization is over the monthly limit — the same answer it already gives for a form that is not published.
11. Every accepted submission increments the counter for the organization owning the form, in the same transaction as the `Response`.
12. `GET /api/organizations/entitlements` (authenticated, any member) returns the plan and the usage. It exposes no organization id and no Stripe-shaped field.
13. `402` is used for a plan limit and `403` for a permission failure, everywhere, and the two are never collapsed.

**Frontend**

14. The sidebar plan card in `frontend/src/layouts/AppShell.vue` renders the plan name and the usage, per the canvas — replacing the comment that currently says there are no plans.
15. `/dashboard/settings` has a real **Plan & usage** section built against the canvas's `Plans` artboard. `NotBuiltYet` on that screen no longer claims plan and billing are missing; it still names the organization rename and session listing, which still are.
16. A `402` from creating a form surfaces the `LimitReached` state from the canvas, naming which limit was hit — not a generic red toast.
17. **No purchase action anywhere.** There is no billing in this product. Any upgrade affordance says so plainly, in the manner of `NotBuiltYet.vue`, and does not render a price. The prices on the canvas are not a decision anyone has taken (see [`docs/BACKLOG.md`](../docs/BACKLOG.md)).
18. Numbers are mono (`.num`), and every colour and size comes from the existing tokens. No new utility that Tailwind would drop silently.

**Tests** — all four suites green.

19. `backend/tests/entitlements.spec.ts` (mocked Prisma) covers the `402` on forms, the `402` on seats, and the exact status and wording of the public rejections.
20. `backend/tests/integration/entitlements.spec.ts` (**real PostgreSQL**) covers what a mock cannot: the counter incrementing on a real submission, the rollback leaving neither a `Response` nor an inflated counter, the counter surviving a form deletion that cascades its responses away, and the seat check counting a pending invitation.
21. Frontend specs for the entitlements store and the plan card, beside the source, following the patterns in [05-frontend-patterns](../docs/sot/05-frontend-patterns.md).

## Out of scope

- **Stripe, `Subscription`, and any charging.** Step 8. This change must leave a clean seam for it: `getEntitlements` is the only thing that resolves a plan, so step 8 changes one function.
- **`Plan` as a database table.** The roadmap is explicit — a constant in code until a customer needs custom limits.
- **Wiring `hasBranding` into `PublicFormView.vue`.** It belongs in the catalogue (the shape is fixed by the roadmap) but not in a route: with no paid plan, nobody can be on a plan that turns the mark off, so it would be untestable and unobservable. File it as a row under step 8 in [`docs/BACKLOG.md`](../docs/BACKLOG.md).
- **`hasApiAccess` enforcement.** There is no public API. Step 10.
- **Usage metering that agrees with an invoice.** `UsageCounter` is the foundation for it, and the backlog row *Usage metering for responses per month* stays open until there is an invoice to agree with. Update that row to point here.
- **A global fallback rate limiter, and Redis.** Different concern, separate rows.
- **Per-creator form scoping.** The canvas's `Members` artboard promises it and the API does not do it; that is its own open decision in [`docs/BACKLOG.md`](../docs/BACKLOG.md) and must not be quietly resolved here.
- **The organization switcher and the organization's name.** Still no endpoint returns one. If the plan card needs a heading, use the plan name, not an invented organization name.
- **Account deletion, data export, structured logging.** Unrelated rows.

## Execution prompt

> Implement plan limits for VuePDF Forms: a plan catalogue as a code constant, an entitlements service, `402` where an authenticated author hits a limit, a silent public refusal where a respondent would hit one, and the two screens the design canvas already draws for it.
>
> **Read first, in this order.** Do not write code before finishing this list.
>
> - This spec, including *Why the obvious approach is wrong* — six traps, all six are reachable.
> - [`docs/sot/10-saas-roadmap.md`](../docs/sot/10-saas-roadmap.md) — the entitlements section and the build order.
> - [`docs/sot/04-backend-patterns.md`](../docs/sot/04-backend-patterns.md) §1, §2, §6, §9 — Zod at the edge, checks as explicit calls, transactions, tenancy as a `where` fragment.
> - [`docs/sot/03-domain-model.md`](../docs/sot/03-domain-model.md) — the cascade map, before adding any model.
> - `backend/src/middleware/membership.ts` — `requireMembership`, `requireOrganizationId`, `requireRole`. The new asserts copy this shape exactly.
> - `backend/src/routes/forms.ts` (`formsRouter.post('/')` and `formsRouter.get('/public/:shareId')`), `backend/src/routes/responses.ts` (`responsesRouter.post('/')`), `backend/src/routes/organizations.ts` (`organizationsRouter.post('/invitations')`).
> - `backend/src/config/env.ts`, `backend/src/middleware/errorHandler.ts`.
> - `frontend/src/layouts/AppShell.vue` (the plan-card comment above the account row), `frontend/src/views/SettingsView.vue`, `frontend/src/components/ui/NotBuiltYet.vue`, `frontend/src/services/api.ts` (`ApiError` carries `status`), `frontend/src/composables/useAsyncAction.ts`, `frontend/src/stores/forms.store.ts`.
> - **The design canvas**, for the `Plans` and `LimitReached` artboards. It is not in this repository; the reading procedure — the artboards are lazily offloaded and have to be sliced out as JSON values keyed by `<Name>.dc.html` — is in [`docs/sot/05-frontend-patterns.md` §8](../docs/sot/05-frontend-patterns.md), which also holds the canvas URL. **Take the plan names and the limit numbers from the artboards; do not invent them.** Take no prices from it: prices are not a decision anyone has taken, and this change renders none.
>
> **Apply the skills.** `prisma-schema-migration` for the schema, `backend-endpoint-pattern` for the new endpoint and every touched handler, `frontend-state-pattern` for the store and service, `api-contract-guard` before documenting anything, `sot-sync` and `ship-checklist` on the way out.
>
> ---
>
> **Step 1 — schema.** `backend/prisma/schema.prisma`: add `Organization.planKey String @default("free") @map("plan_key")` and the `UsageCounter` model (`@@unique([organizationId, period])`, `@@map("usage_counters")`, `onDelete: Cascade` from `Organization`). Run `npx prisma migrate dev --name plan_key_and_usage_counters`. Doc-comment both the way the existing models are commented: `planKey` says why it is a string and not an enum, and that step 8 moves the source of truth to `Subscription`; `UsageCounter` says it counts **submissions accepted in the period**, that a deleted form does not decrement it, and that it is the number an invoice will one day be computed from.
>
> **Step 2 — `backend/src/services/plans.ts`.** A frozen `PLANS` record keyed by `PlanKey`, one entry per plan on the `Plans` artboard, each with `name`, `maxForms`, `maxResponsesPerMonth`, `seats`, `hasBranding`, `hasApiAccess`. Export `resolvePlan(planKey: string)`, which falls back to the free plan and `console.warn`s on an unknown key — the same safe-default discipline as `envInt`/`envBool` in `config/env.ts`.
>
> **Step 3 — `backend/src/services/entitlements.ts`.**
> - `currentPeriod(now = new Date()): string` → `YYYY-MM`, **UTC**. One function, used by every reader and writer of the counter; a period boundary computed twice is a period boundary computed two ways.
> - `getEntitlements(organizationId)` → `{ plan, usage: { forms, responsesThisPeriod, seats } }`. `forms` is a `prisma.form.count`; `responsesThisPeriod` reads the counter (absent row means `0`); `seats` is memberships plus redeemable invitations.
> - `assertCanCreateForm(organizationId)` and `assertCanInvite(organizationId)` — throw `new AppError(402, …)` with a message naming the limit and the number.
> - `assertResponseWithinLimit(tx, organizationId)` — the atomic upsert-then-compare from trap 4, taking a transaction client. It throws `AppError(403, 'Form is not accepting responses')`, and the caller must let it roll the transaction back rather than catching it.
> - `isOverResponseLimit(organizationId)` — the read-only check for the public `GET`.
>
> **Step 4 — the routes.**
> - `backend/src/routes/forms.ts`, `POST /`: `await assertCanCreateForm(organizationId)` after resolving the organization and before `prisma.form.create`. Resolve the organization once into a local rather than calling `requireOrganizationId(req)` twice.
> - `backend/src/routes/forms.ts`, `GET /public/:shareId`: after the existing published check, refuse with the **same** `AppError(404, 'Form not found')` when `isOverResponseLimit` is true. Comment says why it is a `404` and not a `402` — trap 1.
> - `backend/src/routes/responses.ts`, `POST /`: wrap the existing `prisma.response.create` in `prisma.$transaction`, calling `assertResponseWithinLimit(tx, organizationId)` inside it. The form is already loaded in that handler; select `organizationId` on it rather than issuing another query. Do not touch the validation above it.
> - `backend/src/routes/organizations.ts`, `POST /invitations`: `await assertCanInvite(caller.organizationId)` after the `alreadyIn` check and before `createInvitation`. Ordering matters — re-inviting an existing member is a `400`, not a seat problem.
> - New `GET /api/organizations/entitlements`, `authenticate` + `requireMembership`, returning `getEntitlements`. Any member may read it.
>
> **Step 5 — frontend.** `frontend/src/services/plan.ts` (one service per resource, typed to the endpoint) and `frontend/src/stores/plan.store.ts` (`useAsyncAction` for loading and error, per [05-frontend-patterns](../docs/sot/05-frontend-patterns.md)). Then:
> - the plan card in `AppShell.vue`, where the comment currently is;
> - the **Plan & usage** section on `SettingsView.vue`, against the `Plans` artboard, with the `NotBuiltYet` copy narrowed to what is genuinely still missing;
> - the `LimitReached` state, reached when `formsStore.createForm` rejects with an `ApiError` whose `status === 402`. `useAsyncAction` rethrows, so the caller can branch on the status — do not parse the message string, and do not change `useAsyncAction`.
> - No price, no purchase button. Where the canvas draws one, say that billing is not available yet, in the manner of `NotBuiltYet.vue`.
>
> **Step 6 — tests.** Use the `test-author` agent. Write them **before** the enforcement is wired in and watch them fail — a test that only ever ran against the finished code proves nothing about whether it can catch the regression.
> - `backend/tests/entitlements.spec.ts`, mocked Prisma, supertest against the real routers.
> - `backend/tests/integration/entitlements.spec.ts`, real PostgreSQL via `backend/tests/integration/helpers.ts`. This is the suite that matters: **the counter, the rollback and the cascade cannot be tested against a mock**, and a green mocked test over broken code is how this project's data-loss defect shipped (hard rule 6 in `CLAUDE.md`).
> - Frontend specs beside the source. Assert on what the store caused, not on the shape of its refs.
> - If the free plan's real limits make the integration test slow to reach, say so in the Outcome and pick the smallest honest fixture — do not add an environment override for limits, and do not loosen a limit to make a test convenient.
>
> **Verify — every one of these, and paste the real output into the Outcome:**
> ```bash
> npm run test:backend
> npm run test:integration      # needs vuepdf_test to exist and be migrated; see docs/sot/09-quality-and-testing.md
> npm run test:frontend
> npm run test:e2e
> npm run build --workspace=frontend
> cd backend && npx tsc --noEmit
> ```
> `npm run lint` lints nothing in this repository. A passing `lint` is not a signal — do not cite it.
>
> **Before the PR.** Run the `saas-readiness-reviewer` agent over the branch: this change adds a write on the hottest public path, a new authorization-adjacent rejection, and a counter that decides whether customer data is accepted. Then run `ship-checklist`.
>
> **On the way out — the documentation exit, required:**
> - [`docs/sot/03-domain-model.md`](../docs/sot/03-domain-model.md): `Organization.planKey` and `UsageCounter` in the entity list, a cascade-map row, and the invariant that a deleted form does not decrement the counter.
> - [`docs/sot/04-backend-patterns.md`](../docs/sot/04-backend-patterns.md): a new section for entitlements as explicit calls, stating the `402`-versus-`403` rule and why the public path never returns `402`.
> - [`docs/sot/06-api-reference.md`](../docs/sot/06-api-reference.md): `GET /organizations/entitlements`, and the new rejections on the four touched routes. Read each route back before writing the entry (`api-contract-guard`).
> - [`docs/sot/05-frontend-patterns.md` §8](../docs/sot/05-frontend-patterns.md): the plan card and the `Plans` / `LimitReached` artboards move out of *What the canvas has that the app does not*. Say plainly what was **not** built — the prices and any purchase action.
> - [`docs/sot/10-saas-roadmap.md`](../docs/sot/10-saas-roadmap.md): strike step 7, link this spec, and make the intro say step 8 is next.
> - [`docs/sot/07-security-and-privacy.md`](../docs/sot/07-security-and-privacy.md): `UsageCounter` is not personal data — record that judgement rather than leaving the next reader to make it again.
> - [`docs/BACKLOG.md`](../docs/BACKLOG.md): remove the *`Plan` catalogue + entitlements service, `402` on limit reached* row; re-point the *Usage metering* row at `UsageCounter`; add rows for `hasBranding` and `hasApiAccess` enforcement under step 8 and step 10. File anything else you find (hard rule 7).
> - This file: `**Status:** done`, plus an **Outcome** section — what shipped, what did not, the real test output, and every number you took from the canvas.

## Outcome

*(filled in when the work is finished)*
