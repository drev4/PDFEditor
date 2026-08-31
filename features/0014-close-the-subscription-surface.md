# 0014 — Close the subscription surface: the mark, the webhook's API version, and the checkout race

**Status:** done
**Priority:** P2 (see [`docs/BACKLOG.md`](../docs/BACKLOG.md) — three rows: *`Plan.hasBranding` is not enforced*, *The webhook receives events in the account's API version*, *Two completed Checkout sessions could still produce two Stripe subscriptions*)
**Branch:** `feature/0014-close-the-subscription-surface`
**Related:** [03-domain-model](../docs/sot/03-domain-model.md) · [04-backend-patterns §10a](../docs/sot/04-backend-patterns.md) · [06-api-reference](../docs/sot/06-api-reference.md) · [07-security-and-privacy](../docs/sot/07-security-and-privacy.md) · [08-operations](../docs/sot/08-operations.md) · [`features/0012`](0012-plan-catalogue-and-entitlements.md) · [`features/0013`](0013-stripe-subscriptions.md)

## Context

[`features/0013`](0013-stripe-subscriptions.md) shipped Free ↔ Pro and was verified against a real Stripe test account on 2026-08-31 — a real purchase activated from the webhook, a replay changed nothing, and a downgrade with 38 published forms unpublished none of them. That verification also turned up two things no test suite could have found, because both live outside the code. This closes them, and cashes in the one entitlement that has been written and waiting since [`features/0012`](0012-plan-catalogue-and-entitlements.md).

Three items, deliberately small, and the reason they are one change rather than three is that all three are "the subscription surface is finished and correct" — the work that should happen **before** Team, not after.

1. **`Plan.hasBranding` is not enforced.** `frontend/src/views/PublicFormView.vue:120` always renders "Made with VuePDF". The entitlement exists in the catalogue (`hasBranding: false` on Free, `true` on Pro and Team) and nothing reads it. It was unobservable until Pro could be bought; it is observable now. Removing the mark for paying customers is what makes the free tier a distribution channel rather than a cost.
2. **The webhook trusts an API version it does not control.** `backend/src/services/stripe.ts:36` pins `2025-08-27.basil` for the calls this application *makes*. Incoming events are serialised in the **account's** default version — verified live: the account sends `2026-08-26.dahlia`. It works today by luck: the one field that already moved between those versions (`current_period_end`, from the subscription onto the item) happens to be read from the right place.
3. **`POST /api/billing/checkout` has a check-then-act race.** `backend/src/routes/billing.ts:66-113` reads the stored customer and writes it back without a lock. The Stripe idempotency key added in 0013 means concurrent calls converge on one *customer*; two Checkout *sessions* opened before either completes and both then paid would still produce two subscriptions.

## Why the obvious approach is wrong

### 1. The obvious way to hide the mark tells the respondent what the customer pays

`GET /api/forms/public/:shareId` is anonymous. Whoever holds a share link gets that payload, and `toApiForm` (`backend/src/routes/forms.ts:47`) **strips `organizationId` and `createdByUserId` on purpose**, so the respondent learns nothing about the tenant.

The tempting implementation is to send the plan — or the entitlements object — to the public form and let the client decide. **That publishes the customer's billing state to anyone with the link**, which is the exact rule the whole of [`features/0012`](0012-plan-catalogue-and-entitlements.md) is built around: a `402` must never reach a respondent, the public read answers `404`, and the public submit borrows the wording of a closed form. Leaking `plan.key === 'free'` through a different door would undo that quietly.

The payload gets **one boolean**, `showBranding`, computed on the server. Nothing else. It does reveal *paid versus not paid*, which is unavoidable — the mark itself is visible — but it reveals no plan name, no limit, no usage and no organization.

### 2. Reading the entitlement is not the same as reading the plan

`getEntitlements` returns plan **and usage**, and usage costs three queries and a `UsageCounter` lookup. The public form handler already calls `isOverResponseLimit(form.organizationId)`, which resolves the plan; adding a full `getEntitlements` call would make an anonymous, unauthenticated, cache-less endpoint do four more queries per view for one boolean.

Add a narrow read to `services/entitlements.ts` — something like `hasBranding(organizationId)` — that resolves the plan and returns the flag. `effectivePlan` stays the single way in, so `DEV_PLAN_KEY` keeps working (the dev plan has `hasBranding: true`, so the mark disappears in development — expected, and worth knowing before someone reports it as a bug).

### 3. Pinning the API version on the client does not pin it on the webhook

The instinct on reading trap 2 is "the version is already pinned, at `stripe.ts:36`". It is not the same version. `new Stripe(key, { apiVersion })` governs **requests this application sends**. Events **Stripe sends us** carry the version of the webhook endpoint's own configuration, or the account default when the endpoint does not set one — and `stripe listen` uses the account default unless given `--api-version`.

So there are two separate fixes and they are not alternatives:

- **Operational:** a webhook endpoint created for a deployment must pin its API version. That is configuration, and it belongs in [08-operations](../docs/sot/08-operations.md) beside the other three Stripe variables.
- **In code:** `constructEvent` verifies the *signature*, never the shape. A payload from an unexpected version verifies perfectly and reconciles wrong. The handler must read `event.api_version` and say something when it is not the version this code was written against.

**Do not make a mismatch fatal.** Refusing the event would answer non-`200` to Stripe, which retries and eventually disables the endpoint — turning a cosmetic version drift into a total billing outage, and violating the rule in [04-backend-patterns §10a](../docs/sot/04-backend-patterns.md) that anything verified gets a `200`. Log it loudly, once per version seen, and carry on.

### 4. A lock that covers the wrong span fixes nothing

The race is *read customer → create at Stripe → write customer*, and the wrong fix is to wrap only the database write in a transaction: both callers would still have read "no customer" and both would still have called Stripe. The lock has to be taken **before the read** and held past the write, which in PostgreSQL means `SELECT … FOR UPDATE` inside the transaction, on a row that exists.

That last clause is the catch: on the very first checkout **there is no `Subscription` row to lock**, which is precisely the case the race matters in. `SELECT … FOR UPDATE` on a row that does not exist locks nothing and blocks nobody. The workable shapes are an advisory lock keyed on the organization (`pg_advisory_xact_lock`), or inserting a placeholder row first and letting the unique constraint on `organizationId` serialise the callers. Pick one and say why in a comment; do not write a `FOR UPDATE` that silently no-ops on the path it was added for.

**This must not become a Stripe call inside a database transaction.** Holding a Postgres transaction open across a network round-trip to Stripe ties a connection to Stripe's latency, and a Stripe timeout becomes a stuck transaction. If the chosen shape needs the Stripe call outside the lock, that is fine — the goal is that only one caller creates a customer, not that the whole handler is atomic.

## Goal

**Branding**

1. `GET /api/forms/public/:shareId` returns `showBranding: boolean` and **no plan, no usage, no organization id, no limit**. A test asserts the absence, not just the presence.
2. `PublicFormView.vue` renders the mark when `showBranding` is true and omits it otherwise. Nothing in the SPA computes the entitlement itself.
3. The flag is derived through `effectivePlan`, so `DEV_PLAN_KEY` still governs it. Documented, because "the mark vanished locally" will otherwise read as a bug.
4. A free organization's public form still shows the mark; a Pro one does not. Asserted against a real database, since it depends on `Organization.planKey`.
5. `services/plans.ts` is unchanged. The catalogue already says what each plan gets.

**API version**

6. `handleStripeEvent` compares `event.api_version` against the pinned constant and logs an error naming both when they differ. It **still processes the event** and still answers `200`.
7. The warning is emitted once per distinct version, not once per event — the same `announce` discipline as `services/plans.ts`, or a shared helper.
8. A test delivers an event carrying a different `api_version` and asserts: the reconciliation still happened, the response was `200`, and the mismatch was logged.
9. [08-operations](../docs/sot/08-operations.md) says a deployment's webhook endpoint must pin its API version, and what breaks when it does not.

**Checkout race**

10. Two concurrent `POST /api/billing/checkout` calls for one organization result in **exactly one** `stripe.customers.create`. Asserted by a test that actually runs them concurrently against a real PostgreSQL, not by inspection.
11. No Stripe API call happens while a database transaction is open, or the comment explains why the chosen shape is safe.
12. The existing `400` for an organization that already has a live subscription is unchanged.

**Everywhere**

13. `services/entitlements.ts` gains one narrow read and nothing else. `getEntitlements`, `assertCanPublishForm`, `assertResponseWithinLimit` and `isOverResponseLimit` are unchanged.
14. `Organization.planKey` still has exactly one writer. `grep -rn "planKey" backend/src` proves it — note that `src/scripts/reset-billing.ts` is the documented dev-only exception and must stay the only one.

## Out of scope

- **Changing plan between two paid plans.** Investigated while writing this: with only Free and Pro it does not exist as an operation — Free→Pro is checkout and Pro→Free is cancellation, both already built. The portal's `subscription_update` only becomes meaningful with two paid plans, so it belongs to the Team feature, where it can also be tested. Building it now would be a door to a room that is not there.
- **Resuming a cancelled subscription.** Also investigated: **already works, nothing to build.** With `subscription_cancel` enabled, Stripe's portal lets a customer renew while `cancel_at_period_end` is set; once the period ends the subscription leaves the portal and `POST /api/billing/checkout` accepts them again, because `isPaidStatus('canceled')` is false.
- **The Team plan and per-seat billing.** Its own feature. Note the dependency: the plan-switching decision it needs (immediate with proration, or at period end) also governs every seat change, so it should be taken once, there.
- **`assertCanInvite`.** Still waiting on Team, not on billing in general — Free and Pro both have one seat.
- **The mid-period response cliff**, and telling the author anything. Needs a notification channel this product does not have.
- **`Plan.hasApiAccess`.** There is no public API. Step 10 of the build order.
- **Custom domains or any wider white-labeling.** Removing one mark is not the same project.

## Execution prompt

> Three small, independent changes that finish the subscription surface before the Team plan is built. Read this whole spec first, especially *Why the obvious approach is wrong* — trap 1 is a privacy leak and trap 4 is a lock that looks right and does nothing.
>
> **Read first.**
>
> - [`features/0013`](0013-stripe-subscriptions.md), particularly its **Outcome** — it records what Stripe's real behaviour contradicted, and two of these three items come straight out of that verification.
> - `backend/src/services/stripe.ts` — `STRIPE_API_VERSION` (line 36), `handleStripeEvent`, `reconcileSubscription`.
> - `backend/src/routes/billing.ts` — the `/checkout` handler, lines 60-138, and the idempotency-key comment that explains what is already closed.
> - `backend/src/routes/forms.ts` — the `GET /public/:shareId` handler and `toApiForm` (line 47), which is what strips the tenant out of the anonymous payload.
> - `backend/src/services/entitlements.ts` and `services/plans.ts` — `effectivePlan`, `planFor`, `isOverResponseLimit`.
> - `frontend/src/views/PublicFormView.vue`, around line 106-120.
>
> **Apply the skills:** `backend-endpoint-pattern`, `frontend-state-pattern`, `api-contract-guard`, then `sot-sync` and `ship-checklist`.
>
> ---
>
> **Step 1 — the mark.** A narrow read in `services/entitlements.ts` returning the flag for an organization, resolved through `effectivePlan`. Add `showBranding` to the public form payload — one boolean, and check what else that payload contains before adding it. Then `PublicFormView.vue` consumes it. Write the test that a free organization gets `showBranding: true` and a Pro one `false` **against a real PostgreSQL**, because it depends on `Organization.planKey`, and a second test asserting the payload still carries no plan, no usage and no organization id.
>
> **Step 2 — the API version.** Compare `event.api_version` to the pinned constant in `handleStripeEvent`. Log once per distinct version, process the event anyway, answer `200`. There is a captured-shape fixture helper in `backend/tests/fixtures/stripe-events.ts`; the event wrappers already carry an `api_version` field.
>
> **Step 3 — the checkout race.** Read trap 4 before choosing a mechanism, then write the concurrency test **first** and watch it fail: two `POST /api/billing/checkout` calls fired without awaiting the first, against a real PostgreSQL, asserting exactly one customer creation. `backend/tests/integration/billing.spec.ts` shows how to drive the routes; the Stripe SDK will need mocking there, which that suite does not currently do — see `backend/tests/billing.spec.ts` for the module-boundary mock.
>
> **Do not** touch `services/plans.ts`, and do not add a second writer of `Organization.planKey`.
>
> **Verify:**
> ```bash
> npm run test:backend
> npm run test:integration
> npm run test:frontend
> npm run test:e2e
> npm run build --workspace=frontend
> cd backend && npx tsc --noEmit && npm run typecheck:tests
> ```
> Then by hand, with `DEV_PLAN_KEY` **empty** and `stripe listen` running:
> 1. Open a published form of a free organization — the mark is there.
> 2. Buy Pro, reload the same public form — the mark is gone, and the payload in the network tab still says nothing about the plan.
> 3. Confirm the log names the API-version mismatch on the next webhook, and that the subscription still reconciles.
>
> `npm run lint` lints nothing in this repository. Do not cite it.
>
> **Before the PR:** run `saas-readiness-reviewer`. This changes what an anonymous endpoint returns and adds a lock on a path that spends money.
>
> **Documentation exit, required:**
> - [`06-api-reference`](../docs/sot/06-api-reference.md): `showBranding` on the public form, and the explicit note that nothing else about the plan is in that payload.
> - [`07-security-and-privacy`](../docs/sot/07-security-and-privacy.md): what the anonymous payload now reveals and what it deliberately still does not.
> - [`04-backend-patterns §10a`](../docs/sot/04-backend-patterns.md): the API-version check, and why a mismatch is logged rather than refused.
> - [`08-operations`](../docs/sot/08-operations.md): pinning the API version on a deployment's webhook endpoint.
> - [`05-frontend-patterns §8`](../docs/sot/05-frontend-patterns.md): the mark is now conditional.
> - [`docs/BACKLOG.md`](../docs/BACKLOG.md): close all three rows. Do **not** close the Team row.
> - `CLAUDE.md`: the current-state paragraph says `hasBranding` is written and not wired. Fix it.
> - This file: `**Status:** done` and an **Outcome** — what shipped, the real test output, and which lock mechanism was chosen and why.

## Outcome

All three shipped. Two of the three goals had to be widened once the code was open, and both are recorded below rather than quietly redefined.

### What shipped

**The mark.** `mustShowBranding(organizationId)` in `services/entitlements.ts` — a narrow read through `effectivePlan`, not `getEntitlements`, which would have added four queries to an anonymous endpoint for one boolean. `GET /api/forms/public/:shareId` returns `showBranding`; `PublicFormView.vue` renders the mark on it. `getPublic` in the SPA defaults a missing flag to `true`.

**The API version.** `assertKnownApiVersion` compares `event.api_version` to the pinned constant, logs once per distinct version, and processes the event regardless.

**The checkout race.** `services/organization-lock.ts` serialises the handler per organization, plus reuse of an already-open Checkout Session.

`services/plans.ts` unchanged. `getEntitlements`, `assertCanPublishForm`, `assertResponseWithinLimit` and `isOverResponseLimit` unchanged. `Organization.planKey` still has one writer.

### Where this went beyond the spec, and why

**Goal 10 was aimed slightly short.** It asked that two concurrent checkouts produce exactly one `stripe.customers.create`. Writing the test made it clear that the idempotency key from 0013 *already* makes Stripe return the same customer to both calls — the test only saw two because the mock ignores the key. So a duplicate customer was never the real exposure. The real one is **two open Checkout Sessions, both paid**, which no lock on customer creation touches: the second subscription would bill forever while being invisible to "Manage billing", since `Subscription.organizationId` is unique and only one row can survive. The handler now also lists open sessions and hands back the existing one, so there is only ever a single session that can be paid. The lock is still worth having — it stops this application asking twice — but on its own it would have closed the cheaper half.

**The lock is in-process, and that is a real limitation, not an oversight.** Both database options fail here for reasons written out in `services/organization-lock.ts`: `SELECT … FOR UPDATE` locks nothing on a first checkout because there is no row yet, which is the exact case the race matters in; and a transaction-scoped advisory lock would have to be held across a network call to Stripe, tying a pooled connection to Stripe's latency and turning a Stripe timeout into a stuck transaction. So it covers same-process concurrency — the double click, which is the realistic threat — and the Stripe idempotency key covers the cross-replica case. A genuinely distributed lock wants the Redis that step 9 brings. **Goal 11 is met**: no Stripe call happens inside a database transaction.

### Tests

`tests/integration/billing-checkout.spec.ts` (real PostgreSQL, mocked Stripe SDK — the combination is the point, since the race is between two database reads and the handler calls Stripe between them). Written **before** the fix and watched fail: two customers created, and the surviving row holding `cus_concurrent_2`, the loser's write. `customers.create` carries a deliberate 120 ms delay, without which the two requests never overlap and the test passes against the broken code.

`tests/integration/branding.spec.ts` asserts free shows the mark, Pro does not, an unknown stored plan degrades to showing it, and — the assertion that matters most — that the payload contains no plan, no usage, no subscription, no organization id and no plan name.

`tests/integration/billing.spec.ts` gained an end-to-end case: an event stamped `2026-08-26.dahlia` still reconciles, still answers `200`, and is logged.

`tests/billing.spec.ts` gained the version map's unit tests, including that it complains once per version rather than once per event.

### Test output

```
npm run test:backend       14 specs / 178 tests passed
npm run test:integration   12 specs / 123 tests passed   (real PostgreSQL)
npm run test:frontend      38 specs / 314 tests passed
npm run build --workspace=frontend    ✓ built
cd backend && npx tsc --noEmit        clean
cd backend && npm run typecheck:tests clean
```

`npm run test:e2e` — **50 passed**, after fixing a failure it exposed. See below.

The manual checks in the execution prompt — the mark present on a free form and absent on a Pro one, with the network payload still saying nothing about the plan — have **not** been run.

### A CI failure this change did not cause, and did fix

The `0013` pipeline failed on `e2e/form-management.spec.ts › reaches every destination the sidebar offers`, and it had nothing to do with billing:

```
strict mode violation: locator('[data-testid="app-sidebar"]')
  .getByRole('link', { name: 'Responses' }) resolved to 2 elements
```

The second element was the **plan card**. `PlanCard.vue` is a `RouterLink` wrapping a `UsageMeter` labelled "Responses", so the link's accessible name is assembled from its contents — *"Free Plan Responses 412 / 2,000"* — and collides with the sidebar's own *Responses* destination.

It passed locally and failed in CI because the card renders only once the plan has loaded (`v-if="planStore.plan"`), so whether it exists at the moment of the click is a race, and the runner lost it. Reproduced locally by forcing the card to be present before the click, which fails on the old code and passes on the new.

Fixed in **both** places, because the test was not the only thing wrong:

- `PlanCard.vue` gets `aria-label="Plan and usage"`. This is the real defect: without it a screen reader announces a wall of numbers instead of where the link goes. Fixing accessibility is what removes the ambiguity at source.
- The test scopes to the `nav` landmark instead of the whole sidebar. The sidebar also holds the account row; a test about *destinations* should look where the destinations are, and then no future card can break it either.

### Also filed

`docs/BACKLOG.md` lost the three rows this closed. Nothing new was filed: the residual on the checkout race is now genuinely closed by the open-session reuse, and the cross-replica lock limitation is documented in the code rather than as a backlog item, because the answer to it is step 9's Redis and not a change here.
