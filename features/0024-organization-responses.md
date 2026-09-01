# 0024 — Responses across the organization, and what a row may say

**Status:** backlog
**Priority:** P2 (see [`docs/BACKLOG.md`](../docs/BACKLOG.md) — *No endpoint lists responses across the organization*)
**Branch:** *(filled in when it moves to "in progress")*
**Related:** [05-frontend-patterns §8](../docs/sot/05-frontend-patterns.md) · [06-api-reference](../docs/sot/06-api-reference.md) · [07-security-and-privacy](../docs/sot/07-security-and-privacy.md) · [03-domain-model](../docs/sot/03-domain-model.md) · [10-saas-roadmap §what comes next](../docs/sot/10-saas-roadmap.md#what-comes-next) · [`features/0023`](0023-active-organization.md) · [`features/0012`](0012-plan-catalogue-and-entitlements.md)

## Context

**Responses** is a top-level destination in the navigation and the only one that still leads nowhere: `frontend/src/views/ResponsesIndexView.vue` renders `NotBuiltYet` because the API has no way to answer *what has come in lately*. The two listings that exist are per form — `GET /api/forms/:id/responses` and `GET /api/forms/:id/responses/export` (`backend/src/routes/forms.ts:338` and `:374`) — so a combined view today means one request per form merged in a browser, with no paging and no ordering the server agreed to.

This is the last row of the A track: the two before it ([`features/0021`](0021-api-keys-screen.md), [`features/0022`](0022-webhooks-screen.md), [`features/0023`](0023-active-organization.md)) closed the distance between built work and what a customer can reach, and this closes the hole in the navigation.

Two things settled elsewhere shape it before any code is written:

- **Scope comes from [`features/0023`](0023-active-organization.md).** `requireMembership` decides which organization a request acts in, and this endpoint must go through it like every other. A cross-form listing is precisely the sort of query that would quietly span two tenants if it resolved membership its own way.
- **There is no artboard for this screen.** [05-frontend-patterns §8](../docs/sot/05-frontend-patterns.md) lists the canvas's Product artboards — `Main`, `Editor`, `Responses`, `PublicForm`, `PublicFormMobile` — and the `Responses` one is the **per-form** screen, which `ResponsesView.vue` was already built from in [`features/0011`](0011-adopt-the-design-system.md). So this screen is designed by extension of what exists rather than read off the canvas, and it should look like the Members list — a table of rows in the same type and rules — rather than invent a third table style.

**No prior attempt.** `git log --all` has no branch and no revert for a cross-form listing.

## Why the obvious approach is wrong

### 1. The row must not carry answers, and this is the decision the whole feature turns on

The obvious body for a cross-form list is what the per-form endpoint returns: `include: { answers: true }`. Do not.

`GET /api/forms/:id/responses` returns whole `Response` rows, which means the answers **and `ipAddress` and `userAgent`** reach the browser; the per-form screen renders an IP column deliberately. That is a known, filed position — **S7** in [07-security-and-privacy](../docs/sot/07-security-and-privacy.md): respondent personal data collected with no notice, no retention limit and no erasure path. It is the state of one screen that a customer opens for one form they own.

This screen is different in kind: it is a browsing surface over **everything the organization has ever collected**, opened casually and left open. Widening that surface to every answer, every IP and every user agent in the organization — before S7 is resolved — makes the privacy problem larger while adding nothing the screen needs. So:

> **The cross-form listing returns no answer values, no IP address and no user agent.** A row says which form, when, and how many answers it holds. The detail lives one click away, in the per-form screen that already exists.

Build the body explicitly, field by field, exactly as `/api/v1` bodies are built — never `include: { answers: true }` and never a serialised Prisma row, because the next column added to `Response` would then reach this screen without anybody deciding it should.

### 2. There is no such thing as a combined CSV export, and offering one would be a lie

The per-form export works because a form has one set of fields, which become the columns. Across forms there is no such set: two forms share no fields, so a combined CSV is either one column per field in the organization — mostly empty, unreadable, and growing with every form ever created — or a generic `form, submitted, answers` file that answers no question anybody has.

**No export on this screen.** The per-form export is reachable from each form, which is where the columns exist. If a customer wants everything, that is what `/api/v1` and the API key are for.

### 3. The total on this screen is not the number on the plan meter, and they will disagree honestly

`UsageCounter` counts submissions **accepted in a period** ([`features/0012`](0012-plan-catalogue-and-entitlements.md)); this endpoint counts rows that exist now. Deleting a form cascades its responses (`Response.form → Form`, `Cascade` — see the cascade map) and **does not refund the month**, so a customer who deletes a form sees this total fall while the meter does not move.

That is correct in both places and it is going to be asked about. So: this screen shows a total of what is listed and **must not present it as usage**, must not put it beside a plan meter, and must not be used to compute one. The meter belongs to Settings, where it is explained.

### 4. Paging must be the server's, and offset paging is the right wrong answer here

Offset paging has a known flaw: rows inserted while somebody pages shift the window, so a response submitted between page 1 and page 2 can push a row across the boundary and be seen twice or not at all. A public form collects submissions continuously, so this is a real effect and not a theoretical one.

Cursor paging on `(submittedAt, id)` fixes it and is the better answer for an API somebody builds against. It is **not** what this should do, for one reason: `GET /api/forms/:id/responses` and `/api/v1` both already page by `limit`/`offset`, and a third convention inside the same product is worse than a known imperfection in a browsing screen where a duplicated row costs nothing. Match the existing shape, cap the limit like `/api/v1` does, and file cursor paging if anybody ever pages this from a program.

### 5. A per-form filter is worth having and a full-text search is not

Filtering by `formId` is one indexed `where` and turns the screen into *"what came into this form lately"* without leaving it. Searching **inside answers** is a different feature with a real cost — it means reading answer values, which trap 1 exists to avoid, and it wants an index this schema does not have. Do not start it here.

### 6. The screen is one screen's state, so it is a composable and not a store

`frontend-state-pattern` decides this: a store is for state shared between unrelated components or surviving unmount, and this is neither. `useOrganizationResponses` in `composables/`, over one service function.

Note what **not** to copy while you are there: `ResponsesView.vue` calls `responsesService` and `formsService` directly from the view, which predates the pattern and is not the example to follow. Leave it alone — it works and rewriting it is not this feature — but do not use it as the model.

## Goal

Checkable when the work is done:

1. `GET /api/organizations/responses` exists, is authenticated, scoped through `requireMembership` to the caller's active organization, and returns `{ responses: [{ id, formId, formTitle, submittedAt, answerCount }], pagination: { total, limit, offset } }`.
2. It carries **no answer values, no `ipAddress` and no `userAgent`**, and an integration test asserts their absence by name rather than only the presence of what is there.
3. Ordering is `submittedAt` descending, server-side. `limit` defaults to 20 and is capped; a `limit` of 5000 returns the cap, not 5000 rows.
4. `?formId=` filters to one form, and a `formId` belonging to another organization returns an **empty list**, never a `404` that confirms it exists, and never that form's responses.
5. A caller in two organizations sees only the active one's responses. An integration test asserts it, in the shape [`features/0023`](0023-active-organization.md) established.
6. `/dashboard/responses` lists them: form title, when, answer count, a link into that form's responses, a form filter, and paging. `NotBuiltYet` is gone from `ResponsesIndexView.vue`.
7. The screen renders no CSV control and no plan meter.
8. An organization with no responses gets an empty state that says so — not an empty table, which claims the data is missing rather than absent ([05-frontend-patterns §8](../docs/sot/05-frontend-patterns.md)).
9. `npm run test:frontend`, `npm run test:backend`, `npm run test:integration`, `npm run test:e2e`, `npm run build --workspace=frontend` and `cd backend && npx tsc --noEmit` all pass.

## Out of scope

- **A combined CSV export.** Trap 2. Per-form export stays where it is.
- **Searching or filtering by answer content.** Trap 5, and it needs the answer values trap 1 keeps out.
- **Deleting a response**, individually or in bulk. There is no such endpoint today and adding one on a browsing screen is how customer data gets destroyed by a mis-click; it is its own feature with its own confirmation design. Check the cascade map before ever writing it.
- **Anything about `ipAddress` / `userAgent` on the existing per-form screen.** That is **S7**, filed, and this feature neither fixes nor worsens it — it simply does not extend it.
- **Rewriting `ResponsesView.vue`** to use a composable. Pre-existing, works, not this.
- **Cursor paging.** Trap 4; file it if this is ever paged by a program.
- **A response detail view on this screen.** The per-form screen has one, and reaching it is the link in each row.

## Execution prompt

> Add the organization-wide responses listing and the screen that shows it. Apply `backend-endpoint-pattern` for the route, `frontend-state-pattern` for the composable and service, and `api-contract-guard` before documenting.
>
> **Read first.** `backend/src/routes/forms.ts:338` — the per-form listing, whose paging shape you are matching and whose body shape you are deliberately **not** copying. `backend/src/routes/v1/forms.ts:164` — how a body is built explicitly, field by field, and how `limit` is parsed and capped; do the same. `backend/src/middleware/membership.ts` — `requireMembership` is how the organization is resolved, and the only way ([`features/0023`](0023-active-organization.md)). `frontend/src/views/MembersView.vue` for the table language this screen should share, and `frontend/src/views/ResponsesIndexView.vue`, which you are replacing — note its comment cites `GET /api/responses/form/:formId`, a path that does not exist, and goes with it.
>
> **Backend.** One handler in `backend/src/routes/organizations.ts`, beside the others: `GET /responses`. `requireMembership` for the organization, a `formId` query parameter validated as optional, `where: { form: { organizationId } }` plus `formId` when given — **scoped in the `where`, never filtered afterwards**, so another tenant's `formId` simply matches nothing. `orderBy: { submittedAt: 'desc' }`, `take`/`skip` from `limit`/`offset` with the same cap `/api/v1` uses (`MAX_LIMIT = 100`, `DEFAULT_LIMIT = 20`). Select explicitly: the response id, `submittedAt`, `formId`, the form's `title` through a `select` on the relation, and the answer count through `_count`. No `include: { answers: true }` anywhere in this handler.
>
> **Frontend.** `listForOrganization` in `frontend/src/services/responses.ts` beside the existing `listByForm`, with its own result type — do not widen `FormResponse`, which carries `ipAddress` and `userAgent` and is the per-form shape. A composable `frontend/src/composables/useOrganizationResponses.ts` holding the rows, the total, the page and the form filter, over `useAsyncAction`. Then rebuild `ResponsesIndexView.vue`: a table like the Members one, each row linking to `/dashboard/forms/:formId/responses`, a form filter fed by the forms store, paging controls, and an empty state that says nothing has been collected yet rather than drawing an empty table.
>
> **Tests.** Integration (`backend/tests/integration/`, a new `organization-responses.spec.ts`): the listing is scoped to the active organization for a caller in two, and a stranger's `formId` returns an empty list rather than a `404` or somebody else's rows; the body has no `ipAddress`, no `userAgent` and no answer values — assert `not.toHaveProperty` on each, because this is the property most likely to be lost by a later "just add the answers" change; the cap holds; ordering is newest first. Frontend: the service and the composable, and a component test for the empty state and for a row linking to the right form. E2E: extend `e2e/form-management.spec.ts`'s navigation test, which currently asserts `/dashboard/responses` says *Not built yet* — that assertion must change, and it is the one that proves the screen is reachable from the sidebar.
>
> **Verify.** `npm run test:frontend`, `npm run test:backend`, `npm run test:integration`, `npm run test:e2e`, `npm run build --workspace=frontend`, `cd backend && npx tsc --noEmit`. Then by hand: submit two responses to two different published forms and confirm both appear newest first, that the filter narrows to one, and that the row link opens that form's own responses screen.
>
> **On the way out.** Run `sot-sync`. [06-api-reference](../docs/sot/06-api-reference.md) gains the endpoint, re-read from the route file, and should state what it deliberately does not return and why; [05-frontend-patterns §8](../docs/sot/05-frontend-patterns.md) loses the organization-wide responses list from what the canvas has and the app does not, and its route table stops calling `/dashboard/responses` a `NotBuiltYet` screen; [07-security-and-privacy](../docs/sot/07-security-and-privacy.md) records that this listing deliberately carries no respondent personal data, which is a decision worth having written down next to S7 rather than rediscovered; [10-saas-roadmap §what comes next](../docs/sot/10-saas-roadmap.md#what-comes-next) closes A3 and with it the A track. Remove the backlog row, and set this file to `**Status:** done` with an Outcome. Then `ship-checklist`.

## Outcome

*(filled in when the work is done)*
