# 0029 — Account deletion, and erasure that reaches the documents

**Status:** done
**Priority:** P1 (see [`docs/BACKLOG.md`](../docs/BACKLOG.md) — *Account deletion and per-account data export*, S8; and *Deleting a form deletes no PDF*)
**Branch:** `feature/0029-account-deletion-and-real-erasure`
**Related:** [03-domain-model → cascade map](../docs/sot/03-domain-model.md#cascade-map) · [07-security-and-privacy](../docs/sot/07-security-and-privacy.md) · [10-saas-roadmap → D5](../docs/sot/10-saas-roadmap.md#what-comes-next)

## Context

There is no way to delete an account. `backend/src/routes/` has no handler for it — the only `delete` routes are for a form, a field, a member, an invitation, an API key and a webhook endpoint. [07-security](../docs/sot/07-security-and-privacy.md) files it as **S8**, *Medium* severity and *legal: high*.

Underneath that, a second gap that makes the first one worse: **nothing in this product ever deletes a stored PDF.** Not on form deletion, not anywhere. `PdfStorageDriver.remove()` exists in `backend/src/services/pdf-storage.ts:91` and, verified by grep across `backend/src`, **has no call sites at all**. So today `DELETE /api/forms/:id` removes the form, its fields and every response, and leaves the document sitting in storage for ever.

This is **D5** in the roadmap, and its timing is the argument for doing it now rather than after the beta: the backlog of undeleted documents is created *by* the beta. A private beta collecting real PDFs from real companies, with no way to erase them, is the state this feature exists to avoid arriving in — not one to clean up afterwards.

The change is a data-destroying one, so [hard rule 5](../CLAUDE.md) governs it throughout: every new `delete` must answer *what customer data does this destroy, and did the user ask for that?* Three of the four traps below are cases where the obvious code answers that question wrong.

## Why the obvious approach is wrong

### 1. The backlog row understates it, and the correction matters

`docs/BACKLOG.md` says *"Nothing in this codebase removes a stored PDF except the invalid-upload path in `routes/upload.ts`."* **That exception no longer exists.** [`features/0016`](0016-object-storage-for-uploaded-pdfs.md) inverted the upload to validate-then-store — the file arrives in memory and nothing is written until the bytes are known to be a PDF (`backend/src/routes/upload.ts:14-42`) — so there is no longer a bad upload to clean up.

The accurate statement is stronger: `remove()` is **dead code**, and no path in this application has ever deleted a customer document. Fix the row as part of this work rather than repeating it.

### 2. `remove(pdfFilenameFrom(form.pdfUrl))` can destroy a different tenant's document

This is the one that would ship a data-loss defect, and it is one line of obvious-looking code.

`Form.pdfUrl` is an **unconstrained client-supplied string** — `createFormSchema` and `updateFormSchema` accept any `z.string()`, which is its own P1 backlog row. Two forms can therefore point at the same storage key, and nothing prevents them belonging to different organizations. Separately, the editor's save path (`persistEditedDocument`) uploads a new file and repoints the form without deleting the previous one, so keys are reused and abandoned in ordinary use.

So a key is not owned by the form that references it. Removing bytes must be conditional: **delete the object only when no other `Form` row references that key**, checked as part of the same operation. Anything less answers hard rule 5's question with *"another customer's document, and no, they did not ask for that."*

### 3. Deleting the `User` row is not deleting the account — it strands the tenant

The cascade map is explicit and the two relations point in different directions:

- `Membership.user → User` is **`Cascade`** — deleting a user removes their memberships.
- `Form.createdBy → User` is **`SetNull`**, deliberately, since [`features/0009`](0009-organizations-own-resources.md): forms are owned by the organization and survive their creator.

So `prisma.user.delete(...)` leaves the organization, every form and every response alive with **nobody able to reach them** — the backlog's own row, *"An organization can outlive its last member — via account deletion only"*, which says the rule *"needs a rule decided alongside account deletion, which is the only thing that can trigger it."* This feature is that moment; the rule has to be written, not inherited.

And the opposite reflex is worse. Deleting the organization instead is, in the cascade map's words, **"the largest blast radius in this schema"**: it takes every form, field, response, answer, usage counter, API key, webhook endpoint and subscription row with it. For an account holder who is one of five members of a company organization, that would delete their employer's data because they closed their own account.

The rule this spec adopts, and the executor must not quietly change: **an organization is deleted with the account only when the account holder is its sole member.** An account holder who is the last *owner* of an organization that still has other members is **refused**, with an error telling them to transfer ownership or remove the others first. Refusing is the safe direction: the alternative silently promotes somebody or silently destroys a company's data.

### 4. Deleting the organization does not stop the money

The cascade map says it in as many words about `Subscription.organization`: *"This does not cancel anything at Stripe — Stripe is a separate system and no cascade here can reach it, so an organization deleted while subscribed keeps being billed until someone cancels it in the Stripe dashboard."*

`backend/src/services/stripe.ts` has **no cancel function today** — its exported surface is reconcile, lookup and webhook handling — and it is the **only** module permitted to import the Stripe SDK. So this feature adds one there, and the ordering is part of the design: **cancel at Stripe first, delete rows second.** The reverse order, on a Stripe outage, leaves a customer with no account and a live subscription, and no row left that says which subscription to cancel.

### 5. There is no scheduler, so a 30-day grace period cannot execute itself

The business SSOT decided 30 days of grace before permanent deletion (D-021). **Nothing in this codebase runs on a clock.** The only `setInterval` in `backend/src` is BullMQ's lock renewal inside `services/embed-queue.ts:297`; there is no cron, no scheduled job, no reaper. [`features/0015`](0015-team-plan-and-purchased-seats.md) already rejected a design for precisely this reason — *"there is no scheduler, so the quantity would drift from the truth with no code running."*

A `closedAt` column plus a promise to delete in thirty days therefore means **the deletion never happens**, while the product tells the customer their data is going away. That is a worse position than having no deletion at all, because it is a claim rather than a gap.

Two options were considered and both rejected for now: a BullMQ delayed job (Redis is optional in this deployment, and a job with a thirty-day delay is a promise held by a cache), and building a scheduler (a real feature, with its own operational surface, that this does not need to wait for).

**So this feature implements immediate, complete deletion**, gated behind password re-entry and a typed confirmation, and the grace period stays unbuilt and filed. If the owner wants D-021 honoured, the thing to build first is the scheduler — say so rather than shipping a marker nothing acts on.

## Goal

1. `DELETE /api/account`, session-authenticated, in a new `backend/src/routes/account.ts` mounted at `/api/account`. The body carries the caller's current password and it is verified with bcrypt before anything is deleted; a wrong password is `401` and destroys nothing.
2. It **refuses with `409`** when the caller is the last owner of any organization that still has another member or a pending invitation. The message names the organizations and says what to do.
3. For every organization where the caller is the **sole member**, the organization is deleted — taking its forms, fields, responses, answers, counters, keys, endpoints and subscription row through the existing cascades.
4. **Before any row is deleted**, every active Stripe subscription belonging to those organizations is cancelled through a new function in `backend/src/services/stripe.ts` (no other module may import the SDK). When billing is not configured this is a no-op; when Stripe returns an error the deletion **aborts** and answers `502`, having changed nothing.
5. The `User` row is deleted, which cascades its memberships and refresh tokens. The caller's session cookie is cleared in the same response.
6. **Stored documents are removed** for every deleted form, in both this flow and `DELETE /api/forms/:id`, through a single new service — `backend/src/services/pdf-gc.ts` or equivalent — that is the only caller of `pdfStorage().remove()`. It removes a key only when **no surviving `Form` row references it**, and it also removes the `<key>-backup.pdf` sibling written by `scripts/migrate-existing-forms.ts:162` when one exists, under the same condition.
7. **Rows first, bytes second.** Storage removal happens *after* the database transaction commits, never inside it. A storage failure is logged with the key and leaves an orphan; a database rollback must never be able to follow a deletion of bytes. State this ordering in a comment where it is implemented — it is the whole reason the two halves are not one transaction.
8. `DELETE /api/forms/:id` keeps its current behaviour and response, plus the document removal. No change to its authorization or its status codes.
9. A minimal SPA entry point: a **Danger zone** in the existing Settings screen with a confirmation dialog requiring the password and the typed word `DELETE`, wired to the endpoint, following `frontend-state-pattern`.
10. **Integration tests against a real PostgreSQL** in `backend/tests/integration/`, because a mocked Prisma cannot demonstrate a cascade ([09-quality](../docs/sot/09-quality-and-testing.md), hard rule 6). At minimum:
    - deleting a sole-member account removes the organization, its forms, responses and answers, and the stored PDF is gone from the driver;
    - **two forms sharing one `pdfUrl` key: deleting one leaves the file, deleting both removes it** — the trap in §2, and the test that must be seen to fail against an unconditional `remove`;
    - a form whose PDF was already missing from storage deletes cleanly (`remove` is idempotent by contract);
    - the last owner of a two-member organization is refused with `409` and **nothing is deleted** — asserted by re-reading the rows, not by the status code alone;
    - a wrong password is `401` and deletes nothing;
    - a member who is not the last owner deletes their own account and the organization survives with its forms intact.
11. All suites pass: `npm run test:backend`, `npm run test:integration`, `npm run test:frontend`, `npm run test:e2e`, plus both type checks and the frontend build.

## Out of scope

- **Per-account data export.** The other half of S8, and its own spec — it is a read path with no destructive behaviour and would be reverted separately. **But note the sequencing**: shipping a delete button to customers before an export exists means the only way out of the product is to lose everything. The endpoint may ship; whether the button does before export exists is the owner's call, and the PR description must raise it rather than assume.
- **The 30-day grace period (D-021).** Argued in §5. File it, with the scheduler it needs, in `docs/BACKLOG.md`.
- **Deleting an organization while it still has members**, and any transfer-of-ownership flow. Refused, not implemented.
- **Respondent-initiated erasure**, retention limits, and the respondent privacy notice — that is D6 and a separate spec (S7).
- **`persistEditedDocument` orphaning the PDF it replaces** (P3). This feature's collector makes it *collectable*; wiring it into the save path is a separate change with its own risk.
- **Constraining `Form.pdfUrl` at write time** (its own P1 row). This feature must be correct *given* that the column is unconstrained — that is exactly why §2's condition exists — and must not attempt the fix.
- **Cancelling a subscription for any other reason**, and any change to the webhook handler or `planKeyForStatus`.
- **Soft delete or an export prompt on `DELETE /api/forms/:id`** (P3 backlog row). Unchanged.

## Execution prompt

> Implement account deletion and stored-document erasure in the VuePDF backend and a Danger zone in the SPA. Apply the `backend-endpoint-pattern` skill for the route, `frontend-state-pattern` for the screen, `test-author` for the integration tests and `sot-sync` on the way out.
>
> **Read first, and do not write code until you have. This change destroys customer data; hard rule 5 applies to every `delete` you add:**
> 1. [`docs/sot/03-domain-model.md`](../docs/sot/03-domain-model.md), the **whole cascade map** — in particular `Form.organization`, `Form.createdBy`, `Membership.user`, `Subscription.organization`.
> 2. `backend/prisma/schema.prisma` — every `onDelete` (there are 18) and both `pdf_url` columns, on `Form` (line 371) and on `Response` (line 411). **Nothing writes `Response.pdfUrl`**; do not build anything on it.
> 3. `backend/src/routes/forms.ts:262` — the current `DELETE /api/forms/:id`.
> 4. `backend/src/services/pdf-storage.ts:82-92` — the driver interface and the `remove` contract ("succeeds when it was already gone").
> 5. `backend/src/services/pdf-url.ts` — `pdfFilenameFrom` and `canonicalPdfUrl`; the key is derived from the URL, never assembled by a caller.
> 6. `backend/src/services/stripe.ts` — the exported surface, and that it is the only module importing the SDK.
> 7. `backend/src/routes/organizations.ts:315` — `DELETE /members/:userId` and the last-owner guard from [`features/0010`](0010-member-invitations-and-role-enforcement.md), which is the rule this endpoint must agree with.
> 8. `backend/src/scripts/migrate-existing-forms.ts:155-165` — where `<key>-backup.pdf` comes from.
> 9. `backend/tests/integration/setup.ts` and one existing integration spec, for the harness conventions.
>
> **Write the tests before the implementation.** Goal 10's second case — two forms sharing one key — must be written first, pointed at an unconditional `remove()`, and **seen to fail**. Paste that failure into the Outcome. A test written after the fix proves nothing about whether it catches the bug, and this is the bug that would destroy another tenant's document.
>
> **Build**, in this order: the collector service (the only caller of `pdfStorage().remove()`), then its use in `DELETE /api/forms/:id`, then the Stripe cancel function, then `routes/account.ts`, then the SPA Danger zone.
>
> **Do not touch:** `Form.pdfUrl`'s Zod schemas, the webhook handler, `planKeyForStatus`, the field-level delete in `form-fields.ts`, or `persistEditedDocument`.
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
>
> **On the way out:**
> - `docs/sot/03-domain-model.md`: the cascade map gains what now fires from the application rather than only from the database, and the note that deleting an organization no longer leaves its documents behind.
> - `docs/sot/06-api-reference.md`: `DELETE /api/account`, verified against the route file (`api-contract-guard`).
> - `docs/sot/07-security-and-privacy.md`: S8 is half closed — say which half — and the data inventory reflects that a deletion path now exists.
> - `docs/sot/08-operations.md`: what an operator does when storage removal fails and leaves an orphan.
> - `docs/BACKLOG.md`: **correct** the *"except the invalid-upload path"* claim in the stored-PDF row before removing it (§1); remove the account-deletion row's erasure half and leave export; add the grace period and the scheduler it needs.
> - `docs/sot/10-saas-roadmap.md`: mark D5 done, or say precisely which part of it is not.
> - Set this file to `**Status:** done` with an `## Outcome` section recording the failing test you saw first, and anything the cascade map turned out to get wrong.
>
> In the PR description, state **in words** what each new delete destroys and the sequencing question about export. If any part cannot be completed, say which and why. Do not describe partial work as finished.

## Outcome

Done on `feature/0029-account-deletion-and-real-erasure`. Backend 24 files / 290 tests, integration 23 / 226, frontend 48 / 399, E2E 53, both type checks and the frontend build clean.

### The failing test came first, and was made to fail twice

`tests/integration/account-deletion.spec.ts` was written before any implementation and run against the unfixed code: **9 of its 11 tests failed**, the account endpoint answering `404` because it did not exist.

Two of them passed vacuously, which is the interesting part — *never reaches across a tenant boundary* and *deletes cleanly when the document is already gone* both pass while nothing deletes anything at all. So a second check was run deliberately: with `stillReferenced` stubbed to `return false` — the unconditional `remove(pdfFilenameFrom(form.pdfUrl))` the spec warned about — both fired:

```
× leaves a document another form still references
× never reaches across a tenant boundary
AssertionError: expected false to be true
```

That is the data-loss defect being caught, and it is the only evidence that these two tests protect anything.

### What the design got right, and one thing it did not anticipate

The four traps held as written. The one thing the spec did not foresee was in the frontend: `api.delete` took no body, so `DELETE /api/account` had nowhere to put the password. It was extended to accept an optional one rather than moving the endpoint to `POST`, because a password belongs in a body and not in a URL. It is the only caller that passes one.

Two smaller decisions made while implementing, both stated in the code:

**The confirmation is inline, not a modal.** It has two inputs and a consequence to read, and a dialog dismissible by clicking beside it is the wrong container for the one screen in this product with no undo.

**`DangerZone` calls `authStore.logout()` after a successful deletion** rather than a new `clearSession`. `authService.logout` clears local state synchronously and never rejects, so the `401` it now receives from a revoked session changes nothing — and no new store surface had to be invented.

### Verification note worth recording

One full `npm run test:integration` produced **96 failures** across files this change does not touch — foreign-key violations creating a membership immediately after its user, `No record was found for an update`, and `deadlock detected` on the suite's own `TRUNCATE`. That is the signature of two processes truncating one database concurrently, not of a defect: the same suite excluding this feature's spec passed 215, and the full suite including it then passed 226 twice in a row. The likely cause is a stray vitest process from the development loop still holding connections. **It is not explained with certainty**, and it is recorded here rather than dismissed, because the same symptom appearing without a stray process would mean something real about `fileParallelism`.

### Left open, on purpose

**Per-account export.** The other half of S8, split into its own row. Erasure shipping first means the only way out of the product is currently to lose everything, and that sequencing is a product decision rather than an engineering one — raised in the PR rather than assumed.

**The thirty-day grace period (D-021).** Filed with the scheduler it needs. Nothing here runs on a clock, so the marker would have been a claim.

**Documents orphaned before this existed**, and the ones the editor's save path still creates. `services/pdf-gc.ts` can now remove one; what is missing is something that finds them. Filed, with the warning that a sweep must be conservative in the same direction the collector is.
