# 0022 — The webhooks screen, and the two endpoints it turns out to need

**Status:** done
**Priority:** P2 (see [`docs/BACKLOG.md`](../docs/BACKLOG.md) — *The `webhooks` tab in the SPA*)
**Branch:** `feature/0022-webhooks-screen`
**Related:** [10-saas-roadmap §what comes next](../docs/sot/10-saas-roadmap.md#what-comes-next) · [05-frontend-patterns §8](../docs/sot/05-frontend-patterns.md) · [06-api-reference](../docs/sot/06-api-reference.md) · [04-backend-patterns](../docs/sot/04-backend-patterns.md) · [`features/0020`](0020-outbound-webhooks.md) · [`features/0021`](0021-api-keys-screen.md) · [`features/0019`](0019-api-keys-and-read-only-public-api.md)

## Context

The other half of A1. [`features/0021`](0021-api-keys-screen.md) made API keys reachable and left this: [`features/0020`](0020-outbound-webhooks.md) built signed delivery, retries with backoff and a delivery log, and no screen reaches any of it, so **a customer cannot point a webhook anywhere from the product** — only by calling the management endpoints with a session by hand.

Much of the shape is settled by 0021 and must simply be copied rather than re-decided: the tab strip on `SettingsView.vue` (this adds the third tab), the secret shown exactly once and held in the store, `403` and `402` kept apart, and a plan flag on entitlements that decides only what is drawn. `plan.hasApiAccess` is the same entitlement — webhooks and the read API are one capability, and `POST /api/organizations/webhooks` already calls `assertHasApiAccess`.

**What is not settled, and is why this is a spec rather than a copy of the last one, is that the webhooks screen needs two endpoints that do not exist.** Reading the routes is what surfaced them:

- **The delivery log cannot be read with a session.** The only reader is `GET /api/v1/webhooks/deliveries` (`backend/src/routes/v1/webhooks.ts:27`), authenticated by an **API key**. 0020's reasoning for putting it there is sound and stands — it answers a question an integration asks — but it means the screen would have to make a customer mint an API key in order to see whether their webhook is working, which is absurd.
- **Nothing can re-enable a disabled endpoint.** `webhook-queue.ts` stamps `disabledAt` after `DISABLE_AFTER = 10` consecutive failures, and there is no `PATCH` on this router and no other writer that clears it. Grep it: `disabledAt` is set in two places and cleared in none. So today an endpoint that fails ten times is permanently dead, and the customer's only recovery is delete-and-recreate — **which mints a new secret** and means editing the receiver they already deployed.

The endpoints that do exist are complete and are not changed by this: `GET` (`backend/src/routes/organizations.ts:581`), `POST` (`:600`) and `DELETE` (`:642`), with `webhookSelect` (`:570`) defining exactly what a customer may see — id, url, events, disabledAt, lastError, consecutiveFailures, createdAt, and **never the secret, encrypted or otherwise**.

**No prior attempt.** `git log --all` has no branch, no revert and no abandoned component for this screen.

**One dependency to respect when starting.** This branch must come from a `develop` that already has [`features/0021`](0021-api-keys-screen.md), because the tab strip it adds a tab to is 0021's. If 0021 is not merged, branch from it and rebase — do not rebuild the tab strip.

## Why the obvious approach is wrong

### 1. The screen's hardest state is not an error, and treating it as one hides it

Three different things make this feature unavailable, they are not interchangeable, and only one of them is the customer's fault:

| What is true | What the API does | What the screen must say |
|---|---|---|
| No `REDIS_URL` or no `WEBHOOK_SIGNING_KEY` | `GET` returns `deliverable: false`; `POST` answers **`503`** | This deployment cannot deliver webhooks. Nothing the customer can fix |
| Plan without `hasApiAccess` | `POST` answers **`402`** | Webhooks are part of Team |
| Not an owner or admin | Every route answers **`403`** | Ask an owner or admin |

`GET /organizations/webhooks` **deliberately works in all three** — for the first one especially, because *seeing what is configured is how somebody diagnoses why nothing is arriving*. So the list is never hidden behind a guard; only the create form is. And the `deliverable: false` state must be visible **even when there are no endpoints yet**, because that is exactly when a customer is about to configure one that would never fire.

The tempting simplification is to fold `503` in with the plan state, since both end in "you cannot create one". Do not: one of them is a bug report and the other is a purchase, and the copy has to be able to say which.

### 2. `deliverable: false` is not a reason to stop drawing the delivery log

The queue being off does not make history untrue. An endpoint disabled last week, with its `lastError` and its failed deliveries, is *more* interesting on a deployment that has stopped delivering, not less.

### 3. A disabled endpoint with only a Delete button is a trap, and this is where the scope grows on purpose

This screen makes visible a state nothing can currently leave. The rejected options, and why:

- **Show it disabled with no action.** The screen then reports a dead end, which is worse than the API-only status quo: at least today nobody is looking at it.
- **Tell the customer to delete and recreate.** It works and it silently rotates the secret, so the receiver they deployed starts rejecting signatures. That is a support ticket manufactured by the UI.
- **Re-enable automatically when the customer next visits.** A screen load is not a statement that the endpoint was fixed, and the queue would resume hammering a broken URL.

So this spec adds **`PATCH /api/organizations/webhooks/:id`**, and it does exactly one thing: clear `disabledAt`, reset `consecutiveFailures` to `0`, clear `lastError`. Deliberately **not** a general update endpoint — it does not accept a `url` or an `events` array, because changing the URL under an existing secret is a different feature with its own decision (a moved endpoint versus a new one) and because the narrow version cannot become an SSRF vector by accident. It must still:

- **re-run `assertDeliverableUrl` on the stored URL** before re-enabling. DNS changes: a hostname that was public when it was saved may now resolve inside the deployment's network, and 0020's whole argument is that this check belongs at every point where delivery becomes possible, not only at configuration;
- **require the plan** (`assertHasApiAccess`) and the queue (`assertWebhooksConfigured`), because re-enabling is turning delivery *on*, unlike `DELETE`, which must keep working on a downgraded or unconfigured deployment.

### 4. The delivery log endpoint must not become a second contract

Add `GET /api/organizations/webhooks/:id/deliveries` on the session router, scoped per endpoint. Three things about it:

- **It selects the same columns as the v1 reader and no more.** `webhook_deliveries` holds **no payload body** — deliberately, because `response.created` carries the answers a member of the public typed, and a log holding them would be a second copy of respondent personal data that outlives the form. Nothing on this screen may reintroduce one.
- **Scope in the `where`, through the endpoint's organization**, never checked afterwards — another tenant's endpoint id is a `404` ([04-backend-patterns §9](../docs/sot/04-backend-patterns.md)).
- **It is internal, not a contract.** `/api/v1` is the published surface; this lives under `/api/organizations` and may change shape whenever the screen needs it to.

### 5. `consecutiveFailures` is not a failure count

It is the count *since the last success* — `webhook-queue.ts` resets it to `0` on any successful delivery. A screen that labels it "failures" invites a customer to read `0` as "this has never failed", which the delivery log right below it may flatly contradict. Say what it is, or say nothing and let the log speak.

## Goal

Checkable when the work is done:

1. `PATCH /api/organizations/webhooks/:id` exists, is `owner`-or-`admin`, and clears `disabledAt`, `consecutiveFailures` and `lastError` and nothing else. It answers `503` without the queue or signing key, `402` without the plan, `404` for another organization's endpoint, and `400` when the stored URL no longer passes `assertDeliverableUrl`. It accepts no `url` and no `events`.
2. `GET /api/organizations/webhooks/:id/deliveries` exists, is `owner`-or-`admin`, returns the same fields as the v1 reader and **no payload body**, is scoped in the `where`, and works when `deliverable` is false.
3. Settings has a **Webhooks** tab beside General and API keys, reachable at `?tab=webhooks`.
4. An owner or admin on a plan with API access, on a deployment that can deliver, can add an endpoint, see it listed, open its delivery history, re-enable it when disabled, and delete it.
5. Creating an endpoint shows its `whsec_…` secret exactly once, in the store, with the copy control and fallback 0021 established, and the panel states it is the only time it is shown.
6. With `deliverable: false` the list and history still render, the create form does not, and the screen says the deployment cannot deliver — distinct copy from the plan state. This holds with zero endpoints configured.
7. A `402` opens `LimitReachedDialog` in its `api` mode; a member sees the ask-an-owner-or-admin copy; the three refusals are never collapsed.
8. A disabled endpoint is visibly disabled, shows its `lastError`, and offers **Re-enable** as well as Delete.
9. No screen renders a webhook secret after its creation panel is dismissed, and no delivery row renders a payload body — there is none to render.
10. `npm run test:frontend`, `npm run test:backend`, `npm run test:integration`, `npm run test:e2e`, `npm run build --workspace=frontend` and `cd backend && npx tsc --noEmit` all pass.

## Out of scope

- **Telling the customer their endpoint was disabled.** That needs email, which does not exist anywhere in this repository; it stays its own backlog row. This screen makes the state *visible to someone who looks*, which is strictly less than being told, and saying so in the row is part of the work.
- **Replaying a delivery.** Filed. Note what makes it more than a button: the log holds no payload body, so a replay has to rebuild the event from the response — and the response may have been deleted.
- **More event types.** Only `response.created` exists; the `events` array is already a list so that adding one is not a migration. The create form does not need an event picker for a single value, and must not draw one for values the backend would reject.
- **Editing an endpoint's URL.** Deliberately excluded from the new `PATCH` — see trap 3.
- **Rotating an endpoint secret.** A real gap, adjacent to this, and a separate decision: it needs a window where both secrets verify, or it breaks the receiver at the moment it is pressed. Filed in [`docs/BACKLOG.md`](../docs/BACKLOG.md) while this spec was written.
- **Any change to `services/webhook-egress.ts`, `services/webhooks.ts` or `services/webhook-queue.ts`**, and to the existing `GET`/`POST`/`DELETE` handlers. The delivery machinery is not what is missing.
- **`GET /api/v1/webhooks/deliveries`.** It stays exactly as it is, for the audience it was built for.

## Execution prompt

> Build the **Webhooks** tab on Settings, and the two endpoints it needs. Apply `backend-endpoint-pattern` for the routes, `frontend-state-pattern` for the service and store, and `api-contract-guard` before documenting anything.
>
> **Read first.** `backend/src/routes/organizations.ts` from the `--- Webhook endpoints (features/0020) ---` banner to the end — `webhookSchema`, `assertWebhooksConfigured`, `webhookSelect` and the three handlers, whose comments carry most of the reasoning. `backend/src/services/webhook-queue.ts` around `DISABLE_AFTER` (`:168`) and the failure bookkeeping (`:243`–`:275`) — that is what your `PATCH` undoes. `backend/src/routes/v1/webhooks.ts` — the delivery reader you are mirroring onto the session router, and the comment on why the payload is absent. `backend/src/services/webhook-egress.ts` for `assertDeliverableUrl`'s contract. Then the whole of [`features/0021`](0021-api-keys-screen.md) and the three files it produced (`services/apiKeys.ts`, `stores/apiKeys.store.ts`, `components/settings/ApiKeysPanel.vue`) — this screen is its sibling and must not invent a second way to do the same things.
>
> **Backend.** Two handlers in `backend/src/routes/organizations.ts`, beside the existing webhook ones. `PATCH /webhooks/:id`: `requireRole(['owner','admin'])`, then `assertWebhooksConfigured()`, then `assertHasApiAccess`, then find the endpoint scoped by `organizationId` in the `where` (404 otherwise), then `assertDeliverableUrl(endpoint.url)` — the stored URL, re-checked because DNS moves — then update `disabledAt: null, consecutiveFailures: 0, lastError: null` and return the row through `webhookSelect`. Accept no body fields at all. `GET /webhooks/:id/deliveries`: `requireRole(['owner','admin'])`, no plan check and no queue check (history is readable on a deployment that cannot deliver), `where: { endpoint: { id, organizationId } }`, ordered `createdAt` desc, the same `select` as `routes/v1/webhooks.ts` and a `limit` capped the same way.
>
> **Frontend.** `frontend/src/services/webhooks.ts` (`list`, `create`, `remove`, `reenable`, `deliveries`) with its types beside it; `frontend/src/stores/webhooks.store.ts` holding the endpoints, `deliverable`, `lastCreatedEndpoint` and the deliveries of whichever endpoint is open, `persist: false`; `frontend/src/components/settings/WebhooksPanel.vue`. Add the third tab to `frontend/src/views/SettingsView.vue`'s `tabs` array — the strip is built and needs no generalising.
>
> **What the panel renders.** Always the list and, per endpoint, its URL, its events, its status (active / disabled with `lastError`), and a way to open its delivery history. The create form only when `deliverable` is true **and** `plan.hasApiAccess` **and** the caller is owner or admin; each of the three absences has its own copy (trap 1), and the `deliverable: false` message must render with an empty list too. A disabled endpoint offers **Re-enable** beside Delete. Delete is destructive and takes the delivery history with it (`onDelete: Cascade`) — say so before doing it.
>
> **Tests.** Backend: extend `backend/tests/integration/webhooks.spec.ts` — re-enabling clears all three columns and nothing else; it answers `404` across tenants, `503` without the queue, `402` without the plan, and `400` when the stored URL no longer resolves publicly; the deliveries endpoint is scoped per organization and returns no body field. Frontend: `services/webhooks.spec.ts`, `stores/webhooks.store.spec.ts`, and `components/settings/WebhooksPanel.spec.ts` in the shape of `ApiKeysPanel.spec.ts` — the secret shown once and gone after dismissal, the three refusals producing three different messages, a disabled endpoint offering Re-enable, and no payload body anywhere in a delivery row. E2E: the suite runs with `REDIS_URL: ''` pinned in `playwright.config.ts`, so **the honest E2E here is the `deliverable: false` state** — the tab renders, says the deployment cannot deliver, and offers no create form. Do not change that pin to make a happier test pass; 0021's E2E lesson was to test the state the environment actually has.
>
> **Verify.** `npm run test:frontend`, `npm run test:backend`, `npm run test:integration`, `npm run test:e2e`, `npm run build --workspace=frontend`, `cd backend && npx tsc --noEmit`. Then by hand, because no suite has a real Redis: with `REDIS_URL` and `WEBHOOK_SIGNING_KEY` set and `npm run worker` running, create an endpoint pointing at a request bin, submit a response, and confirm a delivery row appears with a `2xx` status and that the `X-VuePDF-Signature` verifies against the secret the screen showed you.
>
> **On the way out.** Run `sot-sync`. [06-api-reference](../docs/sot/06-api-reference.md) gains the two endpoints, re-read from the route file; [05-frontend-patterns §8](../docs/sot/05-frontend-patterns.md) gains the Webhooks screen beside the API keys section and loses the webhooks bullet from what the canvas has and the app does not; [10-saas-roadmap §what comes next](../docs/sot/10-saas-roadmap.md#what-comes-next) closes A1 entirely; `docs/sot/README.md`'s status block stops calling webhook endpoints unreachable. Remove the backlog row this closes, and check that the rows it does **not** close still say so accurately — the auto-disable notification, delivery replay and secret rotation all remain open. Set this file to `**Status:** done` with an Outcome. Then `ship-checklist` before opening the PR.

## Outcome

Built as specified. Both endpoints the spec predicted were needed turned out to be needed, and nothing else was.

**The `PATCH` is as narrow as it was drawn.** It clears `disabledAt`, `consecutiveFailures` and `lastError`, ignores a body entirely, and re-runs `assertDeliverableUrl` on the **stored** URL first — a test sends `{ url: 'https://attacker.example.com/hook', events: [...] }` and asserts the row is unchanged, and another moves the stored URL to `https://localhost/hook` and asserts a `400` with the endpoint still disabled. The guard asymmetry with `DELETE` is deliberate and tested both ways: re-enabling turns delivery *on*, so it needs the queue (`503`) and the plan (`402`); deleting turns it off and must keep working on a deployment that has neither.

**One deviation from the spec, and it is the store's loading rule.** The spec said to copy the API keys tab, whose panel does not fetch when the plan lacks the entitlement. Doing that here would have hidden **live endpoints from a downgraded organization** — `DELETE` deliberately works without the plan precisely so they can be turned off, and a screen that does not list them makes that impossible. So the webhooks panel gates its load on the *role* only. `WebhooksPanel.spec.ts` asserts it: on a Free plan the list is still fetched and Delete is still offered.

**The three refusals are the whole design of the panel** and six of its fourteen tests. The one worth naming: `deliverable: false` renders **with an empty list too**, because that is exactly the moment somebody is about to configure an endpoint that would never fire. Collapsing it into the plan state would have been the easy mistake — both end in "you cannot create one", but one is a bug report and the other is a purchase.

**Verified:** frontend 44 specs / 373 tests, backend 18 / 231, integration 206 (196 passed, 10 skipped — the Redis-dependent ones), E2E 52, `npm run build --workspace=frontend` (vue-tsc), `tsc --noEmit` and `typecheck:tests` on the backend. The E2E asserts the `deliverable: false` state, which is the one the suite's pinned `REDIS_URL: ''` actually produces — the spec said not to change that pin to get a happier test, and it was not changed.

**Not verified by hand:** the delivering path. It needs a real Redis, a running `npm run worker` and a receiving server, and none of that exists in this environment; the spec's manual check — create an endpoint, submit a response, watch a `2xx` row appear and verify the signature — has not been run. `tests/integration/webhook-delivery.spec.ts` covers delivery itself against a real Redis when `TEST_REDIS_URL` is set, and it is one of the ten skipped here.
