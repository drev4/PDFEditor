# 0015 — The Team plan, and seats the customer buys rather than seats we bill them for

**Status:** done
**Priority:** P2 (see [`docs/BACKLOG.md`](../docs/BACKLOG.md) — *The Team plan, and per-seat billing*, and *The seat limit is written and not enforced*)
**Branch:** `feature/0015-team-plan-and-purchased-seats`
**Related:** [03-domain-model](../docs/sot/03-domain-model.md) · [04-backend-patterns §10a](../docs/sot/04-backend-patterns.md) · [06-api-reference](../docs/sot/06-api-reference.md) · [07-security-and-privacy](../docs/sot/07-security-and-privacy.md) · [08-operations](../docs/sot/08-operations.md) · [10-saas-roadmap](../docs/sot/10-saas-roadmap.md) · [`features/0012`](0012-plan-catalogue-and-entitlements.md) · [`features/0013`](0013-stripe-subscriptions.md) · [`features/0014`](0014-close-the-subscription-surface.md)

## Context

Three plans — Free, Pro, Team — and **Team bills per seat** is a decision the repository owner took on 2026-08-31, recorded in [`docs/BACKLOG.md`](../docs/BACKLOG.md). The amounts are still undecided; the model no longer is. [`features/0013`](0013-stripe-subscriptions.md) shipped Free ↔ Pro and stopped there deliberately, and [`features/0014`](0014-close-the-subscription-surface.md) finished the surface around it. This is the last piece of subscriptions.

It is not "another price id", and the reason is one line of existing code. `assertCanInvite` in `backend/src/services/entitlements.ts` reads `plan.seats` from the frozen catalogue, and `services/plans.ts` has Team at `seats: null` — unlimited — with a comment saying it stays that way "until a `Subscription` says how many were paid for". Wiring the limit as it stands would give every Team organization infinite seats. **The seat count is the first plan limit that is bought rather than declared**, and that is a real weakening of the [`features/0012`](0012-plan-catalogue-and-entitlements.md) property that the catalogue is the single source of every limit. It has to be argued, scoped and contained rather than absorbed.

There is also no way to change plan at all today. `POST /api/billing/checkout` refuses with `400` when a live subscription exists, pointing at the portal, and the portal's `subscription_update` is off — verified against the live test-mode configuration. With two plans that was fine, because Free→Pro is checkout and Pro→Free is cancellation. With three it is the missing operation, and [`features/0014`](0014-close-the-subscription-surface.md) deliberately left it here, where it can be tested.

No prior attempt: `git log --oneline --all` has no seat-quantity commit and no revert. `grep -rn "quantity" backend/src` finds only the hardcoded `quantity: 1` in the checkout line item and three comments saying this feature has not happened yet.

## Why the obvious approach is wrong

### 1. Syncing the Stripe quantity to the membership count cannot be implemented correctly, and the blocker is in `countSeatsInUse`

The intuitive design is: a member joins, push `quantity + 1` to Stripe; a member leaves, push `quantity - 1`. Every invitation and removal becomes a billing event. It is what "per-seat billing" sounds like, and it is a trap for three separate reasons.

**It is unimplementable as specified, because seats include pending invitations.** `countSeatsInUse` (`services/entitlements.ts`) is `memberships + invitations that could still be redeemed` — and it is right to be, because otherwise an organization on its limit could issue any number of outstanding invitations, each a working key. But an invitation **expires on a clock**, and nothing in this product runs on a clock. There is no scheduler, no job queue (step 9 of the build order), and no cron. So a seat held by a pending invitation would free itself at `expiresAt` with **no code executing and no billing event**, and the Stripe quantity would drift from the truth on its own, silently, for every organization that ever let an invitation lapse.

**It charges the customer money without them agreeing to it.** An admin inviting three colleagues would raise the bill by three seats, immediately and with proration, from a screen that says nothing about money. That is a decision the person clicking *Invite* did not know they were taking.

**Every membership change becomes a network call that can fail.** There are five membership write sites (`routes/auth.ts:101`, `routes/organizations.ts:137`, `:163`, `:315`, `:377`) and three invitation ones. Each would need an answer to: the member is in the database and Stripe rejected the quantity — do they keep access unbilled, or get thrown out of an organization they just joined? Both answers are bad, and the good answer is not to create the question.

**So: seats are bought, not billed after the fact.** The customer sets the quantity in Stripe's portal, which has *Update quantities* for exactly this pricing model. `assertCanInvite` then refuses the seat that was not paid for — a `402`, the code that already means "a plan limit", toward an authenticated author who can act on it. The Stripe quantity is the input and the product enforces it; nothing in this application ever writes a quantity, so nothing can drift, fail mid-way, or bill anybody by surprise.

The cost of this choice, stated plainly so nobody re-litigates it by accident: **adding the fourth member to a three-seat plan is two steps, not one.** The customer buys a seat, then sends the invitation. That is worse UX than seats appearing on demand, and it is the trade being made deliberately — the alternative is silent drift and surprise charges.

### 2. The seat limit must come from what was paid for, not from what we asked for

Once seats are bought, there is a tempting shortcut: remember the quantity this application last requested. Do not. **The only trustworthy quantity is the one on the subscription object Stripe sent**, reconciled by the webhook like every other field, because a customer can change it in the portal without this application being in the request at all. `subscriptionStateFrom` reads `items.data[0]`; the quantity is on the same object as `current_period_end` and `price`.

That also means the failure mode of a missing quantity has to be chosen. **Absent or zero resolves to the catalogue's value**, which for Team is currently `null`. Do not leave it there: give Team a floor in `services/plans.ts` (the seats included in the base price, whatever the business decides) so that a subscription with no readable quantity degrades to the minimum bought, never to unlimited. Same discipline as `resolvePlan` degrading downward.

### 3. A downgrade must not remove anybody, and this is the sharpest version of that rule yet

An organization on Team with eight members that drops to Pro — one seat — is seven members over. The obvious cleanup is to remove seven memberships. **It destroys the customer's access records as a side effect of a billing event**, and it is the same failure class as [`features/0013`](0013-stripe-subscriptions.md) trap 5, except worse: unpublishing a form is reversible in one click, and a removed membership loses the record of who was in the organization and when they joined.

The rule is unchanged and is the one this repository already follows: **downgrading never changes existing state, it only refuses new state.** Eight members stay. The ninth invitation is refused. The same goes for reducing the quantity in the portal below the number of people already in the organization — Stripe will let them, and the product's answer is to stop issuing seats, not to reclaim them.

**`assertNotLastOwner` is not a substitute.** It guards an organization keeping an owner; it says nothing about seats.

### 4. Wiring `assertCanInvite` breaks Free and Pro unless the counting is right

The reason this check has sat unwired since [`features/0012`](0012-plan-catalogue-and-entitlements.md) is that Free and Pro both have `seats: 1`, and the organization's own owner is a membership — so `countSeatsInUse` is already `1` for a brand-new account and every invitation is refused. Turning the check on without addressing that makes [`features/0010`](0010-member-invitations-and-role-enforcement.md) unreachable for every non-Team customer, which is exactly what the backlog row warned about.

Decide it deliberately and write the decision down: either the catalogue numbers mean *additional* seats beyond the owner (then Free's `1` is wrong and must become `0`, or the count must exclude the owner), or they mean *total people* (then Free at `1` correctly means "you, alone" and the check is already right — and the `402` an inviting Free user gets is the intended product behaviour, not a bug). **Whichever is chosen, `PLANS` and `assertCanInvite` must agree**, and an integration test must assert a fresh Free account's first invitation gets the intended answer.

### 5. Plan switching belongs in the portal, and the portal needs telling about it

Do not build a plan picker. Cancelling, resuming, changing the card and reading invoices are already Stripe's ([04-backend-patterns §10a](../docs/sot/04-backend-patterns.md)), and switching plans is the same kind of thing: it needs proration previews, confirmation and 3-D Secure, all of which Stripe's portal already does correctly.

It needs **configuration, not code**: the portal configuration must enable *Switch plan* with both products listed, and *Update quantities*. That configuration is per account and per mode, it does not live in this repository, and the last time that was forgotten `POST /api/billing/portal` answered `500` in production-shaped conditions ([08-operations](../docs/sot/08-operations.md)). It also carries a product decision that must match the code: **Stripe's *Manage downgrades* can schedule a downgrade at the period end**, which is the same philosophy as `cancel_at_period_end` — the customer keeps what they paid for. Set it that way, or the dashboard will quietly contradict `planKeyForStatus`.

The webhook already handles the result. A plan switch arrives as `customer.subscription.updated` with a different price, and `planKeyForStatus` resolves it — **provided `STRIPE_PRICE_TEAM` is configured**, or an organization that just bought Team lands on free with an error in the log, which is `planKeyForPrice` refusing to guess and is the correct behaviour ([`features/0013`](0013-stripe-subscriptions.md)).

## Goal

**Data model**

1. `Subscription` gains `quantity Int?`, written only by `reconcileSubscription`, doc-commented as *the number of seats paid for, read from the subscription item and never computed here*.
2. `subscriptionStateFrom` reads `items.data[0].quantity`. A missing value is `null`, not `1`.

**Catalogue**

3. `services/plans.ts` gives Team a **seat floor** instead of `null`, and its comment says the effective limit is the greater of the floor and the purchased quantity.
4. `PLANS` is otherwise unchanged, and remains the only place any other limit comes from.

**Entitlements**

5. One function resolves the seat limit for an organization: the catalogue value, overridden by `Subscription.quantity` when the organization is on a per-seat plan and the quantity is readable. It has its own unit tests, including quantity `null`, `0`, below the floor, and above it.
6. `assertCanInvite` uses it and is **wired into `POST /api/organizations/invitations`**, answering `402` — never `403`, which is the permission failure `requireRole` throws.
7. The owner-counting decision from trap 4 is implemented, documented in the function, and asserted: a fresh Free account inviting its first colleague gets the intended answer, and that answer is stated in the SoT.
8. `getEntitlements` reports the effective seat limit, so the *Members* meter on Settings stops showing the catalogue number for a Team customer.

**Billing**

9. `STRIPE_PRICE_TEAM` is configuration, alongside `STRIPE_PRICE_PRO`. Unset means Team cannot be bought; it must not break Free or Pro.
10. `planKeyForPrice` maps it. An unrecognised price still resolves to free with an error naming the variable.
11. `POST /api/billing/checkout` can open a session for Team, and the seat quantity for a first purchase comes from the request or a documented default — decide which, and say why in a comment.
12. **Nothing in this application ever writes a Stripe quantity.** A grep for `quantity` in `backend/src` finds the checkout line item, the reconciler's read, and nothing else.

**Behaviour that must not change**

13. A downgrade removes no membership and revokes no invitation. Asserted against a real PostgreSQL, with an organization holding more members than the new plan allows.
14. `Organization.planKey` still has exactly one writer.
15. `assertCanPublishForm`, `assertResponseWithinLimit` and `isOverResponseLimit` are untouched.
16. The `402` / `403` split holds, and no `402` reaches a respondent.

**Frontend**

17. Settings shows seats used against the effective limit, and — for an owner — says that seats are bought in the billing portal. No price rendered from a constant.
18. A `402` from inviting is presented the way `LimitReachedDialog` presents a publish limit, not as a red toast saying the request failed.

## Out of scope

- **Automatically syncing the Stripe quantity to the membership count.** Trap 1. If it is ever revisited it needs the scheduler that step 9 brings, and a product decision about charging people without an explicit action.
- **Telling anyone their seats ran out before they hit it.** Needs a notification channel this product does not have; same row as the response cliff.
- **Proration arithmetic.** Stripe's, in the portal. This application never computes or displays an amount.
- **Deciding the prices**, including the per-seat amount and the seats included in the base. Configuration and a business decision; the code must work with any of them.
- **Tax and VAT.** Its own backlog row.
- **`Plan.hasApiAccess`.** No public API exists. Step 10.
- **Live-mode Stripe configuration.** Its own backlog row, and it stays open.

## Execution prompt

> Add the Team plan, billed per seat, where **the customer buys seats in Stripe's portal and this product refuses the seat that was not bought**. Read this whole spec first. Trap 1 is the design decision the rest depends on, and trap 3 is the one that destroys customer data if it is got wrong.
>
> **Read first.**
>
> - [`features/0013`](0013-stripe-subscriptions.md) and its **Outcome** — the machine this builds on, and the four places Stripe's real behaviour contradicted the spec.
> - [`features/0014`](0014-close-the-subscription-surface.md) — its *Out of scope* explains why plan switching was left for this feature.
> - `backend/src/services/entitlements.ts` — `assertCanInvite`, `countSeatsInUse`, `planFor`. Note that seats include pending invitations, and understand trap 1 before touching it.
> - `backend/src/services/plans.ts` — the Team entry, `seats: null`, and the comment on it.
> - `backend/src/services/stripe.ts` — `subscriptionStateFrom`, `planKeyForPrice`, `reconcileSubscription`.
> - `backend/src/routes/organizations.ts` — `POST /invitations` (~line 189) and every membership write: `:137`, `:163`, `:315`, `:377`, plus `routes/auth.ts:101`.
> - `backend/prisma/schema.prisma` — the `Subscription` model.
>
> **Apply the skills:** `prisma-schema-migration`, `backend-endpoint-pattern`, `frontend-state-pattern`, `api-contract-guard`, then `sot-sync` and `ship-checklist`.
>
> ---
>
> **Step 1 — the decision in trap 4, first and in writing.** Whether catalogue seat numbers mean total people or additional people changes `PLANS`, `countSeatsInUse` and every test below. Settle it, write it in the function's doc comment, and only then write code.
>
> **Step 2 — schema.** `Subscription.quantity Int?`. `npx prisma migrate dev --name subscription_quantity`, then apply to the test database too (`prisma-schema-migration` has the command). Read the generated SQL before committing it.
>
> **Step 3 — the seat limit.** `subscriptionStateFrom` reads the quantity; one function in `entitlements.ts` resolves the effective limit; `assertCanInvite` uses it and gets wired into the invitations route.
>
> **Step 4 — Team as a buyable price.** `STRIPE_PRICE_TEAM`, `planKeyForPrice`, and checkout able to open a Team session.
>
> **Step 5 — tests. Write the downgrade test before the code and watch it fail** if any part of your implementation could remove a membership. Against a real PostgreSQL: an organization on Team with more members than Pro allows, downgraded, keeps **every membership and every pending invitation**; the next invitation is refused with `402`; and `planKey` and `Subscription.quantity` agree after any sequence of events.
>
> **Step 6 — frontend.** The seats meter against the effective limit, and the `402` from inviting presented the way a publish limit is.
>
> **Do not** write a Stripe quantity from anywhere, do not add a second writer of `Organization.planKey`, and do not build a plan picker.
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
> Then by hand, in Stripe **test mode**, with `DEV_PLAN_KEY` **empty** and `stripe listen` running. Configure the portal first — *Switch plan* with both products, *Update quantities*, and downgrades scheduled at the period end — because none of this is reachable otherwise:
> 1. Buy Team with three seats. Invite two colleagues; the third invitation is refused with `402`.
> 2. Raise the quantity to four in the portal. The refusal lifts without any deploy.
> 3. Lower it to one. Everybody keeps their membership; the next invitation is refused.
> 4. Switch Team → Pro. Confirm **no membership was removed and no invitation revoked**, and that `planKey` followed the webhook.
>
> `npm run billing:reset -- --email=<you>` returns the account to free between runs. `npm run lint` lints nothing here.
>
> **Before the PR:** run `saas-readiness-reviewer`. This changes an authorization-adjacent limit, adds money to a path that grants access to a tenant, and touches membership.
>
> **Documentation exit, required:**
> - [`03-domain-model`](../docs/sot/03-domain-model.md): `Subscription.quantity`, and the invariant that it is read from Stripe and never written here.
> - [`04-backend-patterns`](../docs/sot/04-backend-patterns.md) §10: the seat limit is the first limit not wholly owned by the catalogue, and why that is contained rather than general.
> - [`06-api-reference`](../docs/sot/06-api-reference.md): `POST /organizations/invitations` can now answer `402`; the entitlements payload's seat limit.
> - [`07-security-and-privacy`](../docs/sot/07-security-and-privacy.md): a plan limit now gates access to a tenant, and the `402`/`403` split that keeps it distinguishable from a permission failure.
> - [`08-operations`](../docs/sot/08-operations.md): `STRIPE_PRICE_TEAM`, and the portal configuration this feature requires — including that downgrades must be scheduled at the period end to match the code.
> - [`10-saas-roadmap`](../docs/sot/10-saas-roadmap.md): step 8 is fully closed; note what per-seat cost in design terms.
> - [`docs/BACKLOG.md`](../docs/BACKLOG.md): close the Team row and the seat-limit row. Do **not** close live-mode configuration or tax.
> - `CLAUDE.md`: the current-state paragraph says there is no Team plan and that `assertCanInvite` is unwired. Both change.
> - This file: `**Status:** done` and an **Outcome** — what shipped, the real test output, the trap-4 decision and why, and everything Stripe's actual behaviour forced you to change.

## Outcome

Shipped as specified. The design decision in trap 1 held all the way through: **nothing in this application writes a Stripe quantity**, and a grep for `quantity` in `backend/src` finds the Checkout line item, the reconciler's read, and comments.

### The trap-4 decision, and why

**Seat numbers in the catalogue mean total people, not people beyond the owner.** The organization's own owner is a `Membership`, so a brand-new account already uses one seat: Free's `1` means *you, alone*, and the `402` a Free user gets when inviting a colleague is the intended product behaviour. Team is the plan that adds people.

Chosen over the *additional seats* reading (Free at `0`) because that makes every number in `PLANS` one less than the number the customer counts on the Members screen, and because it was already what `countSeatsInUse` computed — the alternative would have meant changing the counter, the catalogue and every existing test to arrive at the same enforcement. `PLANS` and `assertCanInvite` needed no reconciliation: they already agreed, which is a decent sign the reading is the natural one. It is written in the doc comment on `Plan.seats` and asserted in `backend/tests/integration/seats.spec.ts`.

### What shipped

- `Subscription.quantity Int?` (migration `20260831154031_subscription_quantity` — one additive nullable column, no destructive step), read by `subscriptionStateFrom` off `items.data[0].quantity` and written only by `reconcileSubscription`. A missing **or zero** quantity becomes `null`, not `1`, so "Stripe told us nothing" stays distinguishable from "Stripe told us one".
- Team's catalogue seats went from `null` to a floor of **3**. The number is not a decided one — it is the seats included in the base price and that is a business decision, now recorded in `docs/BACKLOG.md` alongside the amounts. The *shape* is what matters: a floor rather than `null`, so a subscription whose quantity cannot be read degrades to the minimum anyone can have bought instead of to unlimited.
- `seatLimitFor` in `entitlements.ts` resolves `max(floor, quantity)` for `PER_SEAT_PLANS` and returns the catalogue value untouched for everything else. It is the only place in that module that reads a billing table, and `assertCanPublishForm`, `assertResponseWithinLimit` and `isOverResponseLimit` were not modified at all.
- `assertCanInvite` wired into `POST /api/organizations/invitations`, **last** — after `requireRole` and after "already a member", so a permission failure and a re-invitation never come back as `402`.
- `getEntitlements` reports `seatLimit` and the route sends it as `plan.seats`, so the Members meter shows a Team customer the seats they bought rather than the floor.
- `STRIPE_PRICE_TEAM`, `priceIdForPlan`, `planKeyForPrice` mapping both prices, and `POST /api/billing/checkout` taking `{plan?}` (`pro` by default, so the shipped client is unchanged).
- Frontend: two first-purchase buttons on Settings, seats copy that says where seats are bought and that lowering the number removes nobody, and `LimitReachedDialog` gained a `limit="seats"` mode that `MembersView.vue` opens on a `402` — the same "a limit is not a failure" treatment a publish limit gets, with *Add seats* opening the portal instead of an *Upgrade* that would sell a second subscription.

### Decisions the spec left open

**The first-purchase quantity (goal 11) comes from the catalogue floor, with `adjustable_quantity` enabled** — not from the request. A quantity in the request body would be this application choosing a number, and the buyer would be picking seats on a screen that shows no per-seat price. `adjustable_quantity` puts the choice on Stripe's own page, where the amount is, and keeps the request body free of anything that costs money.

**One thing the spec did not anticipate.** `POST /api/billing/checkout` hands back an already-open Checkout Session (features/0014). With two buyable plans that is a defect: somebody who pressed *Upgrade to Team* would be handed the Pro session and charged for Pro on a page that looks entirely correct. The session's price is now compared against the plan asked for, and a session for another plan is **expired** rather than left open — which preserves the property features/0014 actually wanted, that there is never more than one session that can be paid. Covered by a new test in `billing-checkout.spec.ts`.

### The test that had to fail first

`seats.spec.ts` asserts that a downgrade removes nobody, and no version of this implementation ever removed a membership — so the test could not fail on its own history. It was verified by temporary sabotage instead: adding a `membership.deleteMany` to `reconcileSubscription` (the exact "obvious cleanup" trap 3 forbids) failed **3 of the 14** tests, including the one that compares the membership rows themselves — same ids, same `createdAt` — rather than a count. The sabotage was reverted and the suite is green.

A second discriminating check found a real gap: the `quantity` parameter in `tests/fixtures/stripe-events.ts` had a default of `1`, so the "Stripe reported no quantity" case was silently exercising `1` and passing for the wrong reason. Removing that default made the mocked test fail as it should, which is what surfaced it.

### Test output

```
npm run test:backend        14 passed (14 files) / 187 passed (187)
npm run test:integration    13 passed (13 files) / 139 passed (139)
npm run test:frontend       38 passed (38 files) / 321 passed (321)
npm run test:e2e            50 passed (23.3s)
npm run build --workspace=frontend      built in 11.85s
cd backend && npx tsc --noEmit          clean
cd backend && npm run typecheck:tests   clean
```

Integration went from 123 to 139 tests and backend from 178 to 187. Three existing suites needed changing, and each change is the limit being real rather than a test being bent:

- `invitations.spec.ts` and `organization-roles.spec.ts` invited from bare organizations, which now answer `402`. Their fixtures buy seats through a new `grantSeats` helper that goes through `reconcileSubscription` — **not** by writing `planKey` directly, which would make the fixture a second writer of that column. Seats are a precondition there, not the subject; `organization-roles.spec.ts` also gained a test that a seatless organization still answers `403` to a member, so the check order is asserted rather than assumed.
- `entitlements.spec.ts` had a test named *is still not enforced by the invitation endpoint*. It now asserts the opposite.
- `playwright.config.ts` pins `DEV_PLAN_KEY=team` instead of empty. Billing is deliberately off in that suite, so seats cannot be bought there and `e2e/team.spec.ts` would otherwise be unreachable. `team` and not `dev`: the suite runs with limits **on**, as a paying customer with three seats.

### Not done, and why

**The manual Stripe verification has not been run** — the four numbered steps at the end of the execution prompt, in test mode with `stripe listen`. It needs the portal reconfigured first (*Update quantities*, *Switch plan* with both products, downgrades at the period end), a Team price created in the Stripe account, and `STRIPE_PRICE_TEAM` set locally. Everything above is automated-test evidence, and features/0013's own Outcome records that Stripe's real behaviour contradicted its spec in four places — so this is the step that would find the fifth. The portal configuration requirement is documented in [08-operations](../docs/sot/08-operations.md); the live-mode row in `docs/BACKLOG.md` stays open, as does tax.

**`saas-readiness-reviewer` has not been run** either; it is called for before the PR.
