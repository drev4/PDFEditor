# 0013 — Stripe subscriptions: Free ↔ Pro, and a plan that comes from a payment

**Status:** done
**Priority:** P2 (see [`docs/BACKLOG.md`](../docs/BACKLOG.md) — *Stripe integration + `Subscription`*)
**Branch:** `feature/0013-stripe-subscriptions`
**Related:** [10-saas-roadmap](../docs/sot/10-saas-roadmap.md#build-order) (step 8) · [03-domain-model](../docs/sot/03-domain-model.md) · [04-backend-patterns §10](../docs/sot/04-backend-patterns.md) · [06-api-reference](../docs/sot/06-api-reference.md) · [07-security-and-privacy](../docs/sot/07-security-and-privacy.md) · [`features/0012`](0012-plan-catalogue-and-entitlements.md)

## Context

Step 8 of the [build order](../docs/sot/10-saas-roadmap.md#build-order), and the first one that produces revenue. Step 7 built everything except the payment: the catalogue is a frozen constant in `backend/src/services/plans.ts`, limits are enforced from `backend/src/services/entitlements.ts`, the `402` path and the `LimitReached` screen exist and have been used. What does not exist is any way for an organization to *be* on a paid plan — `Organization.planKey` is `"free"` for everybody and nothing in the product can change it.

Scope is deliberately **Free ↔ Pro only**. Team is priced on the canvas as "€39 / month + €6 per seat", which is per-seat quantity billing that has to stay in step with `Membership` — a different problem with its own failure modes, and one that also wants `assertCanInvite` wired, which is its own decision ([`docs/BACKLOG.md`](../docs/BACKLOG.md)). Free ↔ Pro is the whole billing machine end to end and is enough to prove it.

Two things gate **launching** this and neither is engineering, so neither blocks building it: **nobody has decided the prices**, and there is no legal entity ([`docs/BACKLOG.md`](../docs/BACKLOG.md), *Facts the landing cannot ship without*). Both are avoided rather than waited on — see the price rule below. All of this is buildable and testable in Stripe **test mode**, which needs no company and no real card.

No prior attempt: `git log --oneline` has no Stripe commit, and `grep -rn "stripe" backend/src frontend/src` is empty. `backend/package.json` has no Stripe dependency.

## Why the obvious approach is wrong

Seven traps. The first three are how this integration is usually shipped broken.

### 1. `express.json()` destroys the webhook body before Stripe can verify it

`backend/src/app.ts` mounts `app.use(express.json())` **globally**, above every router. Stripe's signature is computed over the exact bytes it sent, and `stripe.webhooks.constructEvent` needs those bytes — a parsed-and-restringified object is not byte-identical and **every** signature check fails. The usual symptom is a webhook that works in `stripe listen` and fails in deployment, or one that "mysteriously" rejects everything.

The webhook route must receive `express.raw({ type: 'application/json' })` and must be mounted **before** `app.use(express.json())` in `app.ts`, or scoped to its exact path. This is a line-ordering constraint in a file where nothing else has one, so it needs a comment saying why, or the next person tidying the middleware stack will move it.

### 2. The redirect back from Checkout is not proof of payment

`success_url` is a URL the browser visits. Anyone can visit it. The payment may still be processing, the card may fail after the redirect, and a customer who closes the tab never visits it at all.

**Nothing may grant a plan on the strength of the return trip.** The subscription becomes real when the webhook says so, and the success page's job is to say "we are activating this" and poll or refresh — not to write anything. This is the single most common way a Stripe integration gives the product away.

### 3. Webhooks are retried, reordered, and duplicated

Stripe delivers at least once, not exactly once, and event order is not guaranteed — `customer.subscription.updated` can arrive before the `checkout.session.completed` that created it. Two consequences:

- **Idempotency is required.** Record every processed `event.id` and ignore a repeat. Without it a retried event re-runs whatever the handler does.
- **Handlers must be state-setting, never incremental.** Read the subscription object *on the event* and write what it says — status, price, `current_period_end`. Never "upgrade the org" as an action. A state-setting handler is naturally safe under reordering and replay; an incremental one is not.

### 4. Two sources of truth for "which plan is this?"

The tempting shape is: `Subscription` is authoritative, and `getEntitlements` joins it. The problem is that every limit check then does a join, and `Organization.planKey` is still sitting there being wrong.

**Keep `planKey` as the derived value every read uses, and make the webhook its only writer.** `effectivePlan` and `getEntitlements` do not change at all — which was the point of building them that way in [`features/0012`](0012-plan-catalogue-and-entitlements.md). `Subscription` records the Stripe relationship (ids, status, period end) for display and for the portal. One function reconciles the two, and an integration test asserts they agree.

`grep -rn "planKey" backend/src` must only ever find that one writer, plus reads.

### 5. A lapsed subscription must not unpublish anybody's forms

An organization on Pro with five published forms that downgrades to Free is over the limit of one. The obvious cleanup — unpublish four of them — **breaks live URLs that the customer has already given out to respondents**, as a side effect of a billing event they may not even know about. That is the failure class this repository has a hard rule about ([`CLAUDE.md`](../CLAUDE.md), rule 5).

The rule is: **downgrading never changes existing state. It only refuses new state.** Five forms stay published; publishing a sixth is refused. `assertCanPublishForm` already behaves exactly this way and needs no change — the point is to *not* add cleanup.

### 6. The response limit has a cliff, and it points at the respondent

The same is not true of `isOverResponseLimit`. An organization that downgrades mid-month having taken 800 responses is instantly over Free's 50, and **every one of its public forms starts answering `404` to respondents** — with no warning to the author, who finds out when somebody tells them their form is broken.

Two decisions follow, and they must be deliberate:

- **Status drives the plan, and `past_due` keeps the paid plan.** Stripe retries a failed payment for days. Cutting a customer off the moment a card expires is hostile and premature. `active` and `trialing` → the paid plan; `past_due` → the paid plan (Stripe is still trying); `canceled`, `unpaid` and `incomplete_expired` → free.
- **A cancellation lands at the period end, not immediately.** Stripe's `cancel_at_period_end` is the normal path and it means the customer keeps what they paid for. Combined with the point above, the only way to fall to Free mid-period is a payment that finally failed after retries — which is the one case where it is defensible.

The remaining cliff is real and is **not** solved here; it is filed, because solving it needs the author to be told, and nothing in this product can tell anyone anything ([`docs/BACKLOG.md`](../docs/BACKLOG.md), the row about the author getting no signal).

### 7. A price in the code is a price somebody has to decide

The canvas draws €12 and €39, and the backlog records that **no one has agreed those numbers**. A code constant would make an undecided figure into a fact, and it would also be wrong the first time anyone runs a promotion or a second currency.

**Amounts live in Stripe and nowhere else.** The application stores a *price id* per plan in configuration (`STRIPE_PRICE_PRO`), and renders what the API returns for the customer's own subscription. `backend/src/services/plans.ts` gains no price field, and no screen renders a hardcoded figure. This is also what makes the undecided-prices blocker not block: the id can point at a €1 test price today and a real one later, with no code change.

## Goal

**Data model**

1. `Subscription` exists — one per organization, `organizationId @unique` — holding `stripeCustomerId`, `stripeSubscriptionId`, `status`, `priceId`, `currentPeriodEnd`, `cancelAtPeriodEnd`. `onDelete: Cascade` from `Organization`, stated in words in the PR.
2. `StripeEvent` exists, keyed on Stripe's own `event.id`, and is what makes webhook handling idempotent.
3. **No card data, no PAN, no last-4 written by us.** Only Stripe identifiers. The data inventory in [07-security](../docs/sot/07-security-and-privacy.md) gains a row and states this.
4. `Organization.planKey` is unchanged in shape and is now **derived**: written only by the subscription reconciler.

**Backend**

5. `backend/src/services/stripe.ts` is the **only** module that imports the Stripe SDK. `routes/forms.ts`, `routes/responses.ts` and `services/entitlements.ts` do not, and a grep proves it — the boundary the roadmap states.
6. `POST /api/billing/checkout` (Bearer, **owner only**) returns a Checkout Session URL for Pro. The organization comes from the caller's membership, never from the request body.
7. `POST /api/billing/portal` (Bearer, **owner only**) returns a Stripe Customer Portal URL. Cancelling, resuming and changing the card all happen there — this product builds none of those screens.
8. `POST /api/billing/webhook` verifies the signature against the **raw body**, rejects an unverified request with `400` before any work, ignores an `event.id` it has already processed, and is mounted above `express.json()`.
9. The handler is state-setting: it reads the subscription on the event and writes `Subscription` **and** `Organization.planKey` in one transaction. It handles `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`. An event type it does not know is recorded and ignored, never an error.
10. Status maps to plan exactly as trap 6 states, in one function with its own unit test.
11. `GET /api/organizations/entitlements` additionally returns `{ subscription: { status, currentPeriodEnd, cancelAtPeriodEnd } | null }`. No Stripe id reaches the client.
12. `getEntitlements`, `effectivePlan`, `assertCanPublishForm`, `assertResponseWithinLimit` and `isOverResponseLimit` are **unchanged**. If this feature needs to edit them, something is wrong with the shape.
13. Downgrading unpublishes nothing and deletes nothing. Asserted by test, not by inspection.

**Frontend**

14. Settings' **Plan & usage** section gains *Change plan* (→ checkout) and, when a subscription exists, *Manage billing* (→ portal), matching the `Plans` artboard. `NotBuiltYet` on that screen stops saying billing does not exist.
15. `LimitReachedDialog.vue` offers the upgrade the canvas draws, replacing the "paid plans are not available yet" line.
16. Both are **owner-only** in the UI, agreeing with the API. A member sees the plan and the usage and no purchase control.
17. The return-from-checkout screen states that activation is in progress and refreshes the plan; it never asserts success on its own. Trap 2.
18. **No price is rendered anywhere from a constant.** Only what the API reports for this customer.

**Tests**

19. `backend/tests/billing.spec.ts` (mocked Prisma, mocked Stripe SDK): authorization on all three routes, signature rejection, unknown event types, and the status→plan map.
20. `backend/tests/integration/billing.spec.ts` (**real PostgreSQL**): a replayed `event.id` changes nothing the second time; out-of-order events converge on the state of the latest; `planKey` and `Subscription.status` never disagree after any sequence; **a downgrade leaves every published form published and every response row present**.
21. A webhook fixture is a **captured Stripe payload**, not a hand-written object. A hand-made fixture tests the handler against the author's belief about Stripe's shape.
22. Frontend specs for the billing service, the store additions, and that a non-owner sees no purchase control.

## Out of scope

- **The Team plan and per-seat billing.** Needs quantity kept in step with `Membership`, and it wants `assertCanInvite` wired, which is a separate decision. File it.
- **Wiring `assertCanInvite`.** Still deferred; Free and Pro both have one seat, so nothing changes for them.
- **Stripe Elements or any in-app card form.** Hosted Checkout and hosted Portal, so no card data reaches this origin and the PCI surface is Stripe's. Deciding otherwise is a security decision, not a UI one.
- **Tax, VAT and invoicing.** The canvas says "VAT excluded"; that is a decision for a person and a Stripe Tax configuration, not code here.
- **Deciding the prices.** Configuration, not code — that is the point of trap 7. The backlog row stays open.
- **Telling the author their allowance ran out.** The cliff in trap 6. Needs a notification channel this product does not have.
- **`Plan.hasBranding` and `hasApiAccess`.** Once Pro is buyable, `hasBranding` becomes enforceable for the first time — but it is a public-form change with its own tests, and folding it in here makes this diff unreviewable. Its backlog row survives this change; re-point it, do not close it.
- **Removing `DEV_PLAN_KEY`.** Note the interaction instead: in development the override still wins over a real subscription, so it must be empty when testing billing. Say so in the spec's own verification steps.

## Execution prompt

> Add Stripe subscriptions to VuePDF Forms: an organization can buy Pro, manage it in Stripe's portal, and its plan follows the payment. Free ↔ Pro only.
>
> **Read first.** All of it, before writing code.
>
> - This spec, especially *Why the obvious approach is wrong* — traps 1, 2 and 3 are how this integration ships broken, and traps 5 and 6 are where it destroys or hides customer data.
> - [`features/0012`](0012-plan-catalogue-and-entitlements.md) — what already exists. This change adds a writer for `planKey`; it must not add a second reader.
> - `backend/src/services/plans.ts` and `backend/src/services/entitlements.ts` — in particular `effectivePlan`, `planFor` and `getEntitlements`. **Goal 12 says these do not change.**
> - `backend/src/app.ts` — the middleware order, and `app.use(express.json())` at the top of the stack. Trap 1 lives here.
> - `backend/src/middleware/membership.ts` (`requireRole`), `backend/src/middleware/errorHandler.ts`, `backend/src/middleware/rateLimit.ts`, `backend/src/config/env.ts`.
> - `backend/src/routes/organizations.ts` — the `entitlements` handler you are extending.
> - `frontend/src/views/SettingsView.vue`, `frontend/src/components/plan/*`, `frontend/src/stores/plan.store.ts`, `frontend/src/services/plan.ts`.
> - The **`Plans` artboard** on the design canvas for the billing block — *Change plan*, *Billed monthly · VAT excluded*, the card row, *Billing history*, *Update card*. The reading procedure and the canvas URL are in [05-frontend-patterns §8](../docs/sot/05-frontend-patterns.md). Take the layout from it; **take no price from it**.
> - Stripe's own docs for Checkout, the Customer Portal and webhook signature verification. Pin the SDK and the API version explicitly.
>
> **Apply the skills:** `prisma-schema-migration`, `backend-endpoint-pattern`, `frontend-state-pattern`, `api-contract-guard`, then `sot-sync` and `ship-checklist`.
>
> ---
>
> **Step 1 — schema.** `Subscription` (`organizationId @unique`, `stripeCustomerId`, `stripeSubscriptionId`, `status`, `priceId`, `currentPeriodEnd`, `cancelAtPeriodEnd`, `onDelete: Cascade`) and `StripeEvent` (`id` = Stripe's event id as the primary key, `type`, `processedAt`). Doc-comment both the way the existing models are: `Subscription` says it is the only entity that knows Stripe exists, and that `Organization.planKey` is derived from it and written only by the reconciler; `StripeEvent` says it exists because delivery is at-least-once. `npx prisma migrate dev --name subscriptions`.
>
> **Step 2 — `backend/src/services/stripe.ts`.** The only importer of the SDK. Client construction from `STRIPE_SECRET_KEY` with a pinned `apiVersion`, `planKeyForStatus(status, priceId)` implementing trap 6's map, and `reconcileSubscription(...)` which writes `Subscription` and `Organization.planKey` **in one transaction**. Everything else calls this.
>
> **Step 3 — `backend/src/routes/billing.ts`.** Three handlers, `AppError` + `next(error)` throughout.
> - `POST /checkout` — `requireRole(req, ['owner'])`, organization from the membership and never from the body, `client_reference_id` and `metadata.organizationId` set so the webhook can find it. Reuse the stored `stripeCustomerId` when there is one; a second customer for the same organization is how a customer ends up billed twice.
> - `POST /portal` — `requireRole(req, ['owner'])`, `404` when there is no subscription.
> - `POST /webhook` — `express.raw`, signature verified before anything else, `400` on failure, then the idempotency check on `event.id`, then the state-setting handler. Return `200` for an event type you do not handle. **Do not** add a rate limiter; state in a comment that the signature is a stronger gate than a limiter and that throttling Stripe's retries would drop events — the repo requires a public endpoint's lack of a limiter to be argued in writing ([09-quality](../docs/sot/09-quality-and-testing.md), [07-security](../docs/sot/07-security-and-privacy.md)).
>
> **Step 4 — mount it.** In `app.ts`, the webhook goes **above** `app.use(express.json())`, with a comment saying that moving it breaks signature verification and that the breakage is silent and total. Everything else mounts with the other routers.
>
> **Step 5 — extend entitlements.** `GET /api/organizations/entitlements` also returns the subscription's `status`, `currentPeriodEnd` and `cancelAtPeriodEnd`, and **no Stripe id**. Do not touch the plan or usage logic.
>
> **Step 6 — frontend.** `services/billing.ts`, additions to `plan.store.ts`, the buttons on `SettingsView.vue` and in `LimitReachedDialog.vue`, and the return-from-checkout state. Owner-only in the UI, agreeing with the API. Read the role the way `MembersView.vue` already does rather than inventing a second way. No rendered price that did not come from the API.
>
> **Step 7 — tests.** Use the `test-author` agent. **Write the integration tests before the reconciler and watch them fail** — replay, reordering and downgrade-safety are the three properties worth having, and a test written afterwards proves nothing about whether it catches a regression. Capture real webhook payloads with `stripe trigger` and commit them as fixtures; do not hand-write them.
>
> **Verify:**
> ```bash
> npm run test:backend
> npm run test:integration
> npm run test:frontend
> npm run test:e2e
> npm run build --workspace=frontend
> cd backend && npx tsc --noEmit
> ```
> Then by hand, in Stripe **test mode**, with `DEV_PLAN_KEY` **empty** — the development override wins over a real subscription and will make billing look like it works when it does not:
> 1. `stripe listen --forward-to localhost:3000/api/billing/webhook`
> 2. Buy Pro with `4242 4242 4242 4242`. The plan becomes Pro **from the webhook**, and stays Pro if you never return from Checkout — close the tab before the redirect and confirm it still activates.
> 3. Replay the same event with `stripe events resend`. Nothing changes the second time.
> 4. Publish two forms on Pro. Cancel in the portal, force the subscription to `canceled`, and confirm both forms are **still published** and every response row is still there.
>
> `npm run lint` lints nothing in this repository. Do not cite it.
>
> **Before the PR:** run the `saas-readiness-reviewer` agent. This change adds a public unauthenticated endpoint, a new authorization boundary, money, and a new class of personal data.
>
> **Documentation exit, required:**
> - [`docs/sot/03-domain-model.md`](../docs/sot/03-domain-model.md): both models, both cascade rows, and the invariant that `planKey` is derived and has exactly one writer.
> - [`docs/sot/04-backend-patterns.md`](../docs/sot/04-backend-patterns.md) §10: how a webhook differs from every other route here — raw body, signature instead of a session, idempotency, state-setting handlers.
> - [`docs/sot/06-api-reference.md`](../docs/sot/06-api-reference.md): the three routes and the extended entitlements payload, written after re-reading the handlers (`api-contract-guard`).
> - [`docs/sot/07-security-and-privacy.md`](../docs/sot/07-security-and-privacy.md): the new public endpoint and why it has no limiter; the data inventory row for `Subscription`; and the statement that no card data is stored.
> - [`docs/sot/08-operations.md`](../docs/sot/08-operations.md): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO`, and what breaks when each is wrong — a wrong webhook secret rejects every event silently, which is the one to spell out.
> - [`docs/sot/05-frontend-patterns.md`](../docs/sot/05-frontend-patterns.md) §8: what of the `Plans` artboard is now built, and what still is not.
> - [`docs/sot/10-saas-roadmap.md`](../docs/sot/10-saas-roadmap.md): strike step 8, note that Team is not in it, make the intro say step 9 is next.
> - [`docs/BACKLOG.md`](../docs/BACKLOG.md): close the Stripe row; add rows for the Team plan and per-seat billing, for the mid-period response cliff, and for tax/VAT. Re-point the `hasBranding` row — do not close it.
> - `CLAUDE.md`: the current-state paragraph says there is no billing. Fix it.
> - This file: `**Status:** done` and an **Outcome** — what shipped, what did not, the real test output, and every decision Stripe's actual behaviour forced you to change.

## Outcome

Shipped on `feature/0013-stripe-subscriptions`. Free ↔ Pro, end to end, with the plan derived from what Stripe says.

### What shipped

All 22 goals. `Subscription` and `StripeEvent` exist; `backend/src/services/stripe.ts` is the only module importing the Stripe SDK and the only writer of `Organization.planKey`; `routes/billing.ts` has the three handlers; the webhook is mounted above `express.json()`; `GET /api/organizations/entitlements` carries a `subscription` block with no Stripe identifier; Settings and `LimitReachedDialog.vue` have owner-only purchase controls and no rendered price.

**Goal 12 held literally.** `getEntitlements`, `effectivePlan`, `planFor`, `assertCanPublishForm`, `assertResponseWithinLimit` and `isOverResponseLimit` have no behavioural change — only comments that were describing a future that has now happened. That was the point of step 7's shape, and it is checkable: `grep -rn "planKey" backend/src` finds exactly one write (`services/stripe.ts`) and the rest reads.

### What did not ship, and why

- **The manual Stripe test-mode verification (steps 1–4 of the prompt) has not been run.** There is no Stripe CLI and no Stripe account on this machine. Buying with `4242 4242 4242 4242`, closing the tab before the redirect, `stripe events resend`, and the cancel-with-forms-published check all still need doing against a real test-mode account. **Nothing here has been proven against live Stripe** — only against Stripe's own SDK, its own signature implementation, and a real PostgreSQL.
- **Goal 21 is not met as written.** The fixtures in `backend/tests/fixtures/stripe-events.ts` are hand-built, not captured with `stripe trigger`, for the same reason. The mitigation is real but is not the same thing: every payload is typed as the SDK's own declarations with no casts, and a new `npm run typecheck:tests` compiles them — which immediately caught three missing required fields on `SubscriptionItem`. What it cannot catch is a field Stripe *populates* differently from what its types allow. This is disclosed at the top of the fixture file rather than hidden.
- **`assertCanInvite` and `Plan.hasBranding` are still not wired**, as scoped. The reason for the first *moved*: it was waiting for "a plan that can be bought", and what it actually needs is **Team**, because Pro has one seat too. Its backlog row was re-pointed accordingly.

### Decisions Stripe's actual behaviour forced

1. **`current_period_end` is on the subscription *item*, not the subscription**, in API version `2025-08-27.basil`. This spec assumed otherwise. Reading it where the spec said would have stored `null` for every customer while failing nothing — a display bug that looks like a Stripe outage. `subscriptionStateFrom` reads it off the item, and both suites assert the real value.
2. **The status map needed two statuses this spec did not list.** `incomplete` (the first payment never went through) and `paused` (Stripe is not billing them) both resolve to free. Rather than extend a denylist, `PAID_STATUSES` is an **allowlist** — `active`, `trialing`, `past_due` — so a status Stripe adds later falls to free rather than being assumed paid. Same discipline as `OVERRIDE_ENVIRONMENTS` in `plans.ts`.
3. **`Subscription` needed nullable subscription columns.** Goal 1 listed them as present, but "reuse the stored `stripeCustomerId`" requires storing the customer at the *first Checkout attempt* — before any subscription exists. So `stripeSubscriptionId`, `priceId` and `currentPeriodEnd` are nullable, and the entitlements payload reports `subscription: null` until a real one exists, so an abandoned checkout does not put "Manage billing" in front of somebody who never paid.
4. **An unrecognised price resolves to free, loudly.** The spec did not say what `planKeyForStatus` should do with a paid status on a price this deployment does not know. It refuses to guess which tier was bought and logs an error naming `STRIPE_PRICE_PRO` — the only realistic way to reach it is that variable being wrong, and guessing "they paid for something" would make the misconfiguration invisible.
5. **A Stripe idempotency key on `customers.create`**, added after review. The read-then-write in `/checkout` is not atomic, so two concurrent calls could both mint a customer. The key is scoped to the organization, so Stripe replays the first response instead. The residual — two Checkout *sessions* opened and both completed — is narrower and is filed in `docs/BACKLOG.md` rather than left unsaid.

### On the test order

**The integration tests were not written before the reconciler**, contrary to the prompt. Since a test written afterwards proves nothing on its own, the property was established a different way: the implementation was deliberately broken three times and the suite re-run.

| Deliberate break | Integration failures |
|---|---|
| Idempotency check removed from `handleStripeEvent` | 1 |
| Webhook mounted **below** `express.json()` | **9 of 12** |
| `current_period_end` read off the subscription, not the item | 2 |

Dropping `checkout.session.completed` from `HANDLED_EVENTS` fails 3 of the mocked suite's 26. Every break was reverted and the suites confirmed green.

The integration suite posts **genuinely signed events over HTTP** using the SDK's `generateTestHeaderString`, rather than calling `handleStripeEvent` directly — which is the only reason the mount-ordering break is detectable at all.

### Review

`saas-readiness-reviewer` found two Medium issues and both were fixed in this branch: the checkout customer race (idempotency key + backlog row) and the entirely untested `checkout.session.completed` path (five tests added, verified to fail against a broken handler). It confirmed no data-loss path, no authorization gap, no card data, and no Stripe identifier reaching the client.

### Test output

```
npm run test:backend       14 specs / 174 tests passed
npm run test:integration    10 specs / 111 tests passed   (real PostgreSQL)
npm run test:frontend       38 specs / 313 tests passed
npm run test:e2e            50 passed
npm run build --workspace=frontend    ✓ built
cd backend && npx tsc --noEmit        clean
cd backend && npm run typecheck:tests clean
```

`npm run lint` was not run: it lints nothing in this repository.
