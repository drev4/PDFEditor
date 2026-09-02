# 0032 — The respondent's side: a notice, and a choice about what is collected

**Status:** done
**Priority:** P1 (see [`docs/BACKLOG.md`](../docs/BACKLOG.md) — *Response retention policy and a respondent privacy notice*, S7)
**Branch:** `feature/0032-respondent-notice-and-ip-collection`
**Related:** [07-security-and-privacy](../docs/sot/07-security-and-privacy.md) · [03-domain-model](../docs/sot/03-domain-model.md) · [10-saas-roadmap → D6](../docs/sot/10-saas-roadmap.md#what-comes-next)

> **Note on parallel work.** `feature/0031-production-deployment` is open in another worktree and covers D1 — Dockerfiles, a production Compose definition, `/health/live` and `/health/ready`, and a release runbook. This feature shares no file with it. If both are in flight, expect a merge conflict only in `docs/BACKLOG.md` and `docs/sot/10-saas-roadmap.md`, and resolve by keeping both sets of rows.

## Context

Every submission stores the respondent's IP address and user agent. `backend/src/routes/responses.ts:137` reads them and the transaction below writes them, on every published form, with **no notice to the person filling it in, no way for the author to turn it off, and no retention limit**. That is finding **S7**, *Medium* severity and *legal: high*, and it is the last open privacy finding now that [`features/0029`](0029-account-deletion-and-real-erasure.md) and [`features/0030`](0030-account-data-export.md) closed S8.

The data inventory in [07-security](../docs/sot/07-security-and-privacy.md) is unusually blunt about this row, and the sentence is the brief for this feature:

> The last row is the weakest position in this table. Data collected for a stated purpose that the system does not actually implement is hard to defend. **Either use it for abuse prevention and say so, or stop collecting it.**

Nothing uses it. `ipAddress` is read in exactly three places and all three are ways *out* of the building — the per-form responses screen, the CSV exporter, and the organization export. No anti-abuse code reads it. The rate limiters use `req.ip` on the request in flight and never touch the stored column, which is the distinction the whole design turns on.

This is **D6** in the roadmap, and its timing is the argument: the private beta is the first time this product collects anything from people who are not its customer. Not starting is cheaper than stopping.

## Why the obvious approach is wrong

### 1. "Add a retention limit" cannot be built here, and promising it is worse than not having it

The backlog row asks for a *retention policy*, which sounds like a column and a job that deletes rows older than N days. **Nothing in this codebase runs on a clock.** [`features/0029`](0029-account-deletion-and-real-erasure.md) hit this exact wall with the thirty-day deletion grace period the business SSOT had decided, and rejected the marker-without-a-reaper for the reason that applies again here: a product that says it deletes data after ninety days and does not is making a claim, which is a worse position than an acknowledged gap.

So **this feature does not implement retention.** It implements the control that makes retention mostly unnecessary — not collecting the data in the first place — and the notice that makes what *is* collected honest. Retention stays filed, with the scheduler it needs.

### 2. Do not put the toggle in `Form.settings`

`Form.settings` is `z.record(z.unknown()).optional()` (`backend/src/routes/forms.ts:31`): an untyped JSON blob accepted from the client and validated in no way. Putting a privacy control there means the flag governing whether personal data is stored is a client-supplied key nobody checks, silently absent on every existing row, and impossible to query.

It needs a real column with a real default, and therefore a migration (`prisma-schema-migration`).

### 3. The default is `false`, and that is the decision in this feature

The tempting default is `true` — preserve today's behaviour, let authors opt out. It is wrong here, and the argument is the inventory's own: the collection has **no implemented purpose**. A default that keeps collecting personal data for a use that does not exist is exactly the position the SoT calls indefensible, and every form created during the beta would inherit it.

So new forms default to **not collecting**, and an author who wants it turns it on. Two consequences the executor must not soften:

- **Existing rows keep their data.** The migration sets the column and touches no `responses` row. Hard rule 5: nobody asked for those IPs to be destroyed, and an author who has been relying on them for a fraud investigation should not lose them to a schema change. Erasing them is a separate, deliberate act — file it.
- **The existing forms' toggle defaults to `false` too.** They stop collecting *from now on*. That is a behaviour change on live forms and it is the right direction, because it is the direction that collects less.

### 4. Turning collection off must not weaken rate limiting

`middleware/rateLimit.ts` counts against `req.ip` on the request in flight. That is transient, it is the only actual anti-abuse use of an address in this product, and it has nothing to do with the `responses.ip_address` column. A change that routed the limiter through the toggle would hand every form a switch that disables its own abuse protection.

Say this in the code where the toggle is read, because the next person to touch it will not know the two are unrelated.

### 5. The notice is the product's, not the author's

It is tempting to make the notice a free-text field the author fills in. Do not, in this feature. The product knows what the *product* collects; an author does not, and would either guess or leave it blank — producing a privacy notice that is wrong in the confident direction.

So the notice is generated from what is actually true for that form: whether an address is stored, that the answers go to the form's owner, and that the owner is the one to contact. An author-supplied purpose statement on top of that is a real feature and belongs in its own spec.

### 6. The public payload must not gain anything about the owner

`GET /api/forms/public/:shareId` is anonymous, and `backend/src/routes/forms.ts:315` spells out the rule at length: `showBranding` is the **only** thing about the owner's plan that may appear in it, because sending the plan and letting the client decide would publish the customer's billing state to anyone with a share link.

The new field is safe under that rule — whether *this respondent's* address is about to be stored is the respondent's business, not the owner's billing state — but it must be added as one derived boolean in the same shape, not by widening the payload with the form's settings.

## Goal

1. A migration adds `Form.collectsRespondentMetadata Boolean @default(false)` (`collects_respondent_metadata`), applied with `prisma migrate dev`, committed, and reflected in [03-domain-model](../docs/sot/03-domain-model.md).
2. `POST /api/responses` stores `ipAddress` and `userAgent` **only** when the form's column is `true`; otherwise both are written as `null`. The values are still read from the request — the limiter is untouched — and simply not persisted.
3. `GET /api/forms/public/:shareId` returns one new derived boolean, `collectsMetadata`, beside `showBranding`. Nothing else about the form's configuration or the owner's plan enters that payload.
4. `PATCH`/`PUT /api/forms/:id` accepts the flag through an explicit Zod field — never through `settings` — and it is owner-or-admin or any member, matching whatever `updateFormSchema` already requires. It is returned by the authenticated form reads so the editor can render its state.
5. The public form renders a **notice** near the submit control, stating in plain language: that the answers go to the organization that published the form; that the organization, not VuePDF, is who to contact about them; and — **only when `collectsMetadata` is true** — that the respondent's IP address and browser are recorded with the submission. When it is false the notice must not mention an address at all.
6. A control in `frontend/src/components/forms/ShareFormModal.vue`, beside the existing publish `InputSwitch`, that turns collection on and off and says what it does. Default off, matching the column.
7. Tests:
   - **Integration**: a submission to a form with the flag off stores `null` in both columns and one with it on stores both; the public payload carries `collectsMetadata` and carries no plan, limit, usage or organization id; the flag survives a form update; and — the assertion that matters — **the rate limiter still rejects a flood from one address against a form with collection off** (`backend/tests/integration/` alongside the existing rate-limit specs).
   - **Frontend**: the notice mentions the address only when the flag is true; the toggle reflects and changes the value.
8. `docs/sot/07-security-and-privacy.md`: S7 is **partly closed** — say exactly which part. The notice and the control exist; retention does not, and a respondent still cannot reach or erase their own answers.
9. All suites pass: `npm run test:backend`, `npm run test:integration`, `npm run test:frontend`, `npm run test:e2e`, both type checks and the frontend build.

## Out of scope

- **Retention, and the scheduler it needs.** Argued in §1. File it with [`features/0029`](0029-account-deletion-and-real-erasure.md)'s grace-period row, which needs the same machinery.
- **Erasing the IP addresses already stored.** A deliberate, separate act with its own confirmation. File it.
- **A respondent-facing way to reach or erase their own answers.** The other half of S7's sentence in the S8 row; its own spec, and it needs an identity story a share link does not have.
- **An author-supplied purpose statement or custom notice text.** §5. Its own spec.
- **Removing the IP column from `ResponsesView.vue`.** It renders `unknown` for a null, which is already the correct behaviour; changing the screen's shape is not this feature's job.
- **Anything in `feature/0031-production-deployment`** — Dockerfiles, Compose, health probes, the runbook.
- **Truncating or hashing addresses** as a middle state. Considered and rejected: it is a third behaviour to explain in the notice, and the anti-abuse value that would justify it is exactly the unimplemented purpose this feature exists to stop claiming.

## Execution prompt

> Add a respondent privacy notice and a per-form control over respondent metadata. Apply `prisma-schema-migration` for the column, `backend-endpoint-pattern` for the route changes, `frontend-state-pattern` for the SPA, `api-contract-guard` before documenting, and `sot-sync` on the way out.
>
> **Read first, and do not write code until you have:**
> 1. `backend/src/routes/responses.ts:135-170` — where `ipAddress` and `userAgent` are read and written.
> 2. `backend/src/routes/forms.ts:305-330` — the anonymous public payload and the long comment governing what may enter it.
> 3. `backend/src/routes/forms.ts:20-40` — `createFormSchema`/`updateFormSchema`, and `settings` as `z.record(z.unknown())`, which is why the flag is not going there.
> 4. `backend/src/middleware/rateLimit.ts` — that it counts `req.ip` on the request in flight and never reads the stored column.
> 5. `docs/sot/07-security-and-privacy.md` — S7 and the data inventory row for IP and user agent, including the sentence that is this feature's brief.
> 6. `frontend/src/views/PublicFormView.vue:105-131` — the footer, and how `showBranding` reaches it.
> 7. `frontend/src/components/forms/ShareFormModal.vue` — the existing publish `InputSwitch`, which the new control sits beside.
>
> **Build**, in this order: the migration, the write path in `routes/responses.ts`, the public payload, the update schema, then the two pieces of UI.
>
> **The three things to get right**, restated because the happy path hides them: the default is `false` and existing rows are not touched; the rate limiter is not routed through the flag and a comment at the read site says why; and the notice never mentions an address when the flag is off.
>
> **Do not touch:** `middleware/rateLimit.ts`, `Form.settings`, the stored values of any existing response, `ResponsesView.vue`'s IP column, or anything under `feature/0031-production-deployment`.
>
> **Verify, and paste the real output:**
> ```
> npm run test:backend
> npm run test:integration        # docker-compose up -d first
> npm run test:frontend
> npm run test:e2e
> cd backend && npx tsc --noEmit
> npm run typecheck:tests --workspace=backend
> npm run build --workspace=frontend
> ```
> Then submit to a real form both ways and report what the `responses` row holds each time.
>
> **On the way out:**
> - `docs/sot/03-domain-model.md`: the new column, its default, and that it governs what a submission stores rather than who may read it.
> - `docs/sot/06-api-reference.md`: `collectsMetadata` on the public payload and the flag on the form endpoints, verified against the route files.
> - `docs/sot/07-security-and-privacy.md`: S7 partly closed, stating precisely which part; update the IP/user-agent inventory row to say collection is now off by default and per form.
> - `docs/BACKLOG.md`: remove the notice half of the S7 row; add retention (with the scheduler), erasing existing addresses, a respondent-facing erasure path, and an author-supplied purpose statement.
> - `docs/sot/10-saas-roadmap.md`: D6 done, or precisely which part is not.
> - Set this file to `**Status:** done` with an `## Outcome` recording what the real rows held before and after.
>
> If any part cannot be completed, say which and why. Do not describe partial work as finished.

## Outcome

Done on `feature/0032-respondent-notice-and-ip-collection`. Backend 24 files / 290 tests, integration 25 / 248, frontend 51 / 415, E2E 53, both type checks and the frontend build clean. **S7 is partly closed** — precisely which part is written into [07-security](../docs/sot/07-security-and-privacy.md).

### Verified in the real row, both ways

```
flag=false | submit=201 | ip=null                | ua=null              | answers=1:"hola" | publico.collectsMetadata=false
flag=true  | submit=201 | ip="::ffff:127.0.0.1"  | ua="ManualCheck/1.0" | answers=1:"hola" | publico.collectsMetadata=true
```

The third column of each line is the feature. The fourth-to-last is the thing that must not have changed: the submission itself is stored identically either way.

The migration is one additive statement and touches no existing row, as specified:

```sql
ALTER TABLE "forms" ADD COLUMN "collects_respondent_metadata" BOOLEAN NOT NULL DEFAULT false;
```

### The design held. Two decisions made while implementing

**`collectsMetadata` is sent as its own top-level boolean even though `toApiForm`'s spread already carries the column.** The redundancy is deliberate and is noted in the code: the notice on the public form is a contract of its own, so a single named boolean means the column can be renamed or replaced without silently changing what a stranger is told. It also matches `showBranding`, which the composable already destructures.

**The toggle in `ShareFormModal.vue` calls the service directly instead of emitting to its parent, unlike publishing.** Publishing is emitted because three screens each keep their own copy of the form and all three render its status; this flag is rendered nowhere but that dialog, so threading an event through `FormSavePanel`, `FormsList` and `FormsManagementView` would add three call sites to keep a value in sync that none of them displays. The honest cost — the parent's copy stays stale until the next list refresh — is written next to the code rather than left to be discovered.

### The two flags fail in opposite directions, and that is tested

`showBranding` absent means **show** the mark: under-claiming a paid entitlement gives it away. `collectsMetadata` absent means **not collecting**: over-claiming in a privacy notice is the worse failure. Getting them the same way round is the natural mistake, so both directions are asserted in `services/forms.spec.ts` and `composables/usePublicForm.metadata.spec.ts`.

### The assertion that matters most

`backend/tests/integration/respondent-metadata.spec.ts` drives five submissions at a form with collection **off** against a limit of three, and asserts three `201`s, two `429`s, and `ipAddress === null` on all three stored rows. The limiter reads `req.ip` in flight; the flag governs only what is written. Without that test the tempting "consistent" refactor — routing the limiter through the flag — would look correct and would hand every author a switch that disables their own abuse protection.

### Corrections while implementing

An apostrophe inside a single-quoted toast string broke the SFC parser (`Unexpected token, expected ":"`), reported at a line 130 lines away from the actual one. And PrimeVue's `Dialog` teleports to `document.body` and renders an empty comment on the first tick, so the modal's spec queries the document after two `nextTick`s rather than through the wrapper — the first version of that spec failed with *Cannot call setValue on an empty DOMWrapper* and was rewritten rather than papered over.

### Left open, on purpose

Retention and its scheduler; the addresses collected before this change, which the migration deliberately did not touch; a respondent-facing way to reach or erase their own answers, which needs an identity a share link does not have; and an author-supplied purpose statement. All four are filed.
