# 0021 — The API keys screen, so a customer can reach what step 10 built

**Status:** backlog
**Priority:** P2 (see [`docs/BACKLOG.md`](../docs/BACKLOG.md) — *The `webhooks` and `API keys` tabs in the SPA*)
**Branch:** *(filled in when it moves to "in progress")*
**Related:** [10-saas-roadmap §what comes next](../docs/sot/10-saas-roadmap.md#what-comes-next) · [05-frontend-patterns §8](../docs/sot/05-frontend-patterns.md) · [06-api-reference](../docs/sot/06-api-reference.md) · [04-backend-patterns §10](../docs/sot/04-backend-patterns.md) · [`features/0019`](0019-api-keys-and-read-only-public-api.md) · [`features/0015`](0015-team-plan-and-purchased-seats.md) · [`features/0012`](0012-plan-catalogue-and-entitlements.md)

## Context

[`features/0019`](0019-api-keys-and-read-only-public-api.md) built API keys and a read-only `/api/v1`, and deliberately built no screen. The result is the largest distance in this product between work that is finished and value a customer can reach: `hasApiAccess` is **Team-only**, so the customer who is paying most is the one who cannot get at what they paid for. Minting a key today means calling `POST /api/organizations/api-keys` with a session cookie by hand, which is not something a customer will do and not something support can talk somebody through.

The backend half is complete and this spec does not change it. Three handlers exist in `backend/src/routes/organizations.ts`, all `owner`-or-`admin`: `GET /api-keys` (`:421`), `POST /api-keys` (`:448`) and `DELETE /api-keys/:id` (`:478`), over `backend/src/services/api-key.ts`. They are covered by `backend/tests/integration/api-keys.spec.ts`. **One backend change is in scope and only one** — the entitlements payload does not currently say whether the organization has API access, and trap 1 is why that has to change.

The canvas has drawn this screen since before step 10 existed: [05-frontend-patterns §8](../docs/sot/05-frontend-patterns.md) lists *"The `API keys` tab on the Settings artboard"* under **What the canvas has that the app does not**. So the destination is settled — Settings, not a new sidebar entry — and this spec is the one that removes that line.

**No prior attempt.** `git log --all` has no branch, no revert and no abandoned component for this screen.

## Why the obvious approach is wrong

### 1. Gating the button on a client-side plan check is wrong, and so is not gating it

Two rules in this repository point in opposite directions here, and the resolution is not to pick one.

The first: **the server is the only enforcer.** `assertHasApiAccess` runs inside `POST /api-keys`, after `requireRole` and before anything is written ([`features/0012`](0012-plan-catalogue-and-entitlements.md)), and the client must never contain a second copy of a limit rule. `MembersView.vue` is the precedent — it branches on `ApiError.status === 402`, **never on the message**, and lets `LimitReachedDialog` explain.

The second: [05-frontend-patterns §8](../docs/sot/05-frontend-patterns.md), on why billing controls are owner-only — *"A button guaranteed to fail tells someone the product is broken when it is enforcing a rule."* A **Create key** button that a Free organization can press only to be told no is exactly that button.

The resolution: **add `hasApiAccess` to `GET /api/organizations/entitlements` and use it to decide what to draw, never what is allowed.** That endpoint already carries plan capability — every limit in it is one — and it is member-authenticated, so this is not the anonymous public payload that [`features/0014`](0014-close-the-subscription-surface.md) deliberately kept free of plan state. Concretely:

- with `hasApiAccess: false`, the tab renders the upgrade state and no create form;
- with `true`, it renders the create form;
- and **the `402` handler stays and is tested anyway**, because the plan can change between the page loading and the button being pressed, and because a client-side boolean that is the only thing standing between a Free organization and a key is not a limit — it is a decoration.

### 2. `403` and `402` are different answers and the screen must not collapse them

The handlers reject twice, in this order: `requireRole(['owner','admin'])` answers **`403`** to a plain member, and `assertHasApiAccess` answers **`402`** to an admin on Free or Pro. [`features/0012`](0012-plan-catalogue-and-entitlements.md) made never collapsing these a rule, and it has a plain user-facing consequence: *"ask an owner"* and *"upgrade the plan"* are different instructions, and giving the wrong one sends the customer to the wrong place. The role is already available client-side through `organizationStore.currentRole` — the same source `SettingsView.vue` and `MembersView.vue` use, and not a second one.

Note that the two endpoints disagree about who may call them, and that is not a bug to fix here: `/entitlements` is `requireMembership` (any member) while `/api-keys` is `owner`-or-`admin`. So a member sees the tab exists and sees no keys, which is correct.

### 3. The secret is shown once, and a component is the wrong place to hold it

`POST /api-keys` returns `secret` in its `201` and **nowhere else, ever**: `GET /api-keys` selects no `hash`, and `backend/src/services/api-key.ts` stores only `sha256(secret)`. There is no reveal endpoint and adding one is out of scope forever — the route comment says it, and it is the reason the column is a hash.

The precedent for the UI is exact and must be followed rather than reinvented: `lastCreatedInvitation` in `frontend/src/stores/organization.store.ts` holds a value the server cannot reproduce, and its comment says why it lives in the **store** and not in the component — *"deliberately kept in the store rather than in a component that might unmount."* A key shown in local component state is lost by any re-render that tears the component down, and the customer is left with a credential row they can never use and can only revoke.

Two smaller things `MembersView.copyLink` already got right and this must copy: `navigator.clipboard.writeText` is wrapped, because it rejects outright on a non-secure context, and the value is **also** rendered in a selectable input so a failed copy still leaves the customer able to select it by hand. The secret must never reach a URL, a query parameter, a `console.log`, or a toast that outlives the dismissal.

### 4. Hiding revoked keys destroys the only record of when access stopped

`DELETE` is a revocation, not a delete: it stamps `revokedAt` once and **deliberately does not re-stamp** a key that is already revoked, because that would rewrite when access actually ended. The row stays. A list that filters revoked keys out therefore throws away the answer to *"when did that key stop working?"* — which is the question asked after an integration breaks, and the reason the column exists at all. Render them, visibly dead, with the date.

### 5. `lastUsedAt` is stale by design, and a screen must not present it as live

`touchApiKey` writes at most once a minute per key (`LAST_USED_INTERVAL_MS = 60_000`) and **swallows its own failures**, because bookkeeping must not fail an API request. So the column answers exactly one question — *is this credential still in use, or has it been forgotten?* — and nothing finer. A dot that says "Active now", or anything that invites the customer to watch it tick, is a claim the data does not support. `relativeTime` from `frontend/src/utils/formatDate.ts` is the right shape, and `null` is *"never used"*, which is a genuinely useful thing to say about a key somebody is about to revoke.

### 6. Do not build the webhooks tab here, and do not build a chrome for it either

The webhooks screen is the sibling of this one and is **its own spec — `0022`, next in sequence and deliberately not written yet**. It is separated because it is a separate unit of undo: it needs a new session-authenticated endpoint of its own (the delivery log is currently readable only through `GET /api/v1/webhooks/deliveries`, which needs an API key — a customer cannot be asked to mint a key in order to see whether their webhook works), and it carries a `503` state this screen does not have.

The trap is the tempting one: building the Settings tab strip as a general mechanism *for the tabs that are coming*. Build it for the tabs that exist. Two of them is not a framework.

## Goal

Checkable when the work is done:

1. `GET /api/organizations/entitlements` returns `plan.hasApiAccess`, a boolean derived on the server from the plan catalogue. No other field changes.
2. Settings has an **API keys** tab. Existing Settings content stays reachable and unchanged in behaviour.
3. An owner or admin of an organization **with** API access can: see the organization's keys, create one with a name, and revoke one.
4. Creating a key shows the secret exactly once, in a panel that survives a re-render, with a copy control that degrades to selectable text; the panel states that it is the only time the value is shown.
5. Nothing in the SPA can display a secret again after that panel is dismissed. There is no reveal control and no client-side persistence of the value — `grep` for `localStorage` in the new code finds nothing.
6. An owner or admin **without** API access sees the tab and an upgrade state, not a create form; a `402` from `POST` still opens `LimitReachedDialog` and is covered by a test.
7. A plain member sees a `403`-derived message that says to ask an owner or admin — never the upgrade copy.
8. Revoked keys remain listed, marked as revoked, with the date they were revoked, and cannot be revoked twice from the UI.
9. `lastUsedAt` renders as relative time, and as *never used* when `null`.
10. `frontend/src/services/apiKeys.ts` and its store have specs; `backend/tests/integration/entitlements.spec.ts` asserts the new field for a plan that has API access and one that does not.
11. `npm run test:frontend`, `npm run test:backend`, `npm run test:integration` and `npm run build --workspace=frontend` all pass.

## Out of scope

- **The webhooks tab** — `features/0022`, to be specified when it is picked up (specs written ahead go stale, see [`features/README.md`](README.md)). Includes the session-authenticated delivery log that screen needs.
- **Per-key scopes and key expiry.** Filed in [`docs/BACKLOG.md`](../docs/BACKLOG.md). The create form takes a name and nothing else; adding a scope picker for scopes the backend does not enforce would draw a promise the API does not keep.
- **Write endpoints on `/api/v1`.** Filed. This screen mints credentials for the read-only API that exists.
- **Any change to `backend/src/services/api-key.ts`**, to the three route handlers, or to `middleware/apiKeyAuth.ts`. The one backend change permitted by this spec is the `hasApiAccess` field on the entitlements response.
- **A reveal endpoint, or storing the secret anywhere server-side.** Not a scope boundary so much as a prohibition: it would turn a hash back into a password.
- **The organization switcher and renaming**, which also want a Settings-adjacent endpoint. Separate backlog rows, separate endpoint, and neither blocks this.
- **Restyling `SettingsView.vue`.** Introducing a tab strip touches its top-level structure; the sections inside it keep their markup.

## Execution prompt

> Build the **API keys** screen in the SPA, on the Settings artboard's tab, over the endpoints [`features/0019`](0019-api-keys-and-read-only-public-api.md) already shipped. Apply the `frontend-state-pattern` skill for the service and the store, and `api-contract-guard` before you document anything.
>
> **Read first, in this order.** `backend/src/routes/organizations.ts` lines 409–508 — the three API key handlers and their comments, which contain the reasons for half of what follows. `backend/src/services/api-key.ts` — the key shape (`vpk_<12 hex>_<secret>`), what is stored (a SHA-256 hash, never the secret) and `touchApiKey`'s one-minute throttle. `frontend/src/stores/organization.store.ts` and `frontend/src/views/MembersView.vue` — the *shown once* pattern you are copying, including `copyLink`'s clipboard fallback and the `ApiError.status === 402` branch. `frontend/src/views/SettingsView.vue` — the screen you are adding a tab to, and how it reads `organizationStore.currentRole` for owner-only controls. `frontend/src/services/plan.ts` and `frontend/src/stores/plan.store.ts` — where the new `hasApiAccess` lands on the client. [05-frontend-patterns §8](../docs/sot/05-frontend-patterns.md) for the design rules; note that an undefined Tailwind utility is dropped **silently**, so a passing build proves nothing about a class name.
>
> **Backend, and this is the only backend change.** Add `hasApiAccess` to the `plan` object returned by `GET /api/organizations/entitlements` in `backend/src/routes/organizations.ts` (the handler at `:51`), reading it from the resolved plan the way the other fields do. Do not touch `getEntitlements`, `effectivePlan` or `seatLimitFor`. Do not add it to `GET /api/forms/public/:shareId`, which is anonymous and must stay free of plan state ([`features/0014`](0014-close-the-subscription-surface.md)).
>
> **Frontend.** One service, `frontend/src/services/apiKeys.ts`, with `list`, `create` and `revoke` over `/organizations/api-keys` — one HTTP service per resource, per [05-frontend-patterns §3](../docs/sot/05-frontend-patterns.md), and no calls from components. One store, `frontend/src/stores/apiKeys.store.ts`, holding the list, `loading`/`error` through `useAsyncAction`, and `lastCreatedKey` — the secret, held **in the store** for the reason `lastCreatedInvitation` is, with a comment saying so. Add `hasApiAccess` to the `Plan` interface in `frontend/src/services/plan.ts`. The tab itself goes in `frontend/src/views/SettingsView.vue`; put the panel in `frontend/src/components/settings/ApiKeysPanel.vue` so the view does not grow a second job.
>
> **What the panel renders.** With `plan.hasApiAccess` false: the upgrade state, no create form, and — for an owner — the existing route to buying a plan that `SettingsView.vue` already owns; do not add a second purchase path. With it true and the caller an owner or admin: a name field and a create action, then the list. Each row shows the name, the `prefix` (never a secret), `lastUsedAt` as `relativeTime` or *never used*, and either a revoke action or, for a revoked key, the revocation date and no action. For a plain member: the tab, no create form, and a message that says to ask an owner or admin — distinct copy from the upgrade state, because `403` and `402` are different answers (trap 2).
>
> **The secret panel.** After a successful create, show the value once, with the sentence that it is the only time it will be shown, a copy control wrapped exactly like `MembersView.copyLink` (a rejected `navigator.clipboard` must leave selectable text behind, not a dead button), and an explicit dismiss. Never log it, never put it in a route, never persist it.
>
> **Tests.** `frontend/src/services/apiKeys.spec.ts` beside the service and `frontend/src/stores/apiKeys.store.spec.ts` beside the store, following `billing.spec.ts` and `organization.store.spec.ts`. A component test `frontend/src/components/settings/ApiKeysPanel.spec.ts` in the shape of `LimitReachedDialog.spec.ts`, asserting behaviour and not markup: the secret appears once and is gone after dismissal; a `402` from create opens the limit dialog; a `403` produces the ask-an-owner copy and not the upgrade copy; a revoked key is still listed and offers no revoke action. Backend: extend `backend/tests/integration/entitlements.spec.ts` for the new field on a plan with API access and one without — the integration suite rather than the mocked one, because the plan resolution it exercises is a real read. Do not add an E2E test: `e2e/team.spec.ts` is the model if one is ever wanted, but this flow ends in a credential and Playwright is not where that belongs.
>
> **Verify.** `npm run test:frontend`, `npm run test:backend`, `npm run test:integration`, `npm run build --workspace=frontend` (which type-checks), and `cd backend && npx tsc --noEmit`. Then check by hand what no test asserts: with `DEV_PLAN_KEY=free` the tab must show the upgrade state, and with `DEV_PLAN_KEY=team` it must let you mint a key — and that key must then work against `GET /api/v1/forms`, which is the only proof the screen produced a real credential.
>
> **On the way out.** Run `sot-sync`. [05-frontend-patterns §8](../docs/sot/05-frontend-patterns.md) loses *"The `API keys` tab on the Settings artboard"* from **What the canvas has that the app does not** and gains the screen in the shape-of-the-app table; [06-api-reference](../docs/sot/06-api-reference.md) records the new `hasApiAccess` field on the entitlements response, re-read from the route rather than from this spec; [10-saas-roadmap §what comes next](../docs/sot/10-saas-roadmap.md#what-comes-next) has A1 marked as the keys half done, with webhooks left. Narrow the `docs/BACKLOG.md` row *The `webhooks` and `API keys` tabs in the SPA* to webhooks alone rather than deleting it — the webhooks spec closes it. Set this file to `**Status:** done` and record in an Outcome section what the review found, if anything. Then run `ship-checklist` before opening the PR.

## Outcome

*(filled in when the work is done)*
