# 0001 — Stable field ids and a non-destructive bulk save

**Status:** done
**Priority:** P0 (was in [`docs/BACKLOG.md`](../docs/BACKLOG.md); rows removed on completion)
**Branch:** `feature/0001-stable-field-ids-and-safe-bulk-save`
**Related:** [`03-domain-model`](../docs/sot/03-domain-model.md) · [`06-api-reference`](../docs/sot/06-api-reference.md) · [`09-quality-and-testing`](../docs/sot/09-quality-and-testing.md) · [`10-saas-roadmap`](../docs/sot/10-saas-roadmap.md)

## Context

`POST /api/forms/:formId/fields/bulk` in `backend/src/routes/form-fields.ts` is the editor's ordinary save action. It currently does:

```ts
await prisma.field.deleteMany({ where: { formId } })
await prisma.field.createMany({ data: fieldsData.map(field => ({ formId, ...field })) })
```

Every save deletes every field and recreates it with a fresh `id`. `Answer.field` is declared `onDelete: Cascade` in `backend/prisma/schema.prisma`. So when the owner of a form that has already collected responses opens the editor and saves — nudging one field a pixel is enough — **every answer in every past response is deleted**. The `Response` rows survive, empty. No warning, no confirmation, no backup, no test covering it.

There is a second consequence that matters as much for where the product is going: a field id that changes on every save is a reference nothing outside the database can hold. Webhooks, a public API, per-question analytics and any customer integration all need to point at a field and still be pointing at it next week. Unstable ids make all of that impossible, which is why this sits at the top of the build order in [10-saas-roadmap](../docs/sot/10-saas-roadmap.md).

## Why the obvious approach is wrong

This has been attempted twice — commits `fb8acd8` and a later re-application, both reverted. Both took the same shape: keep `deleteMany` + `createMany` when the form has no responses, and add a second, safer code path when `prisma.response.count()` is greater than zero. Do not do this again. It fails for three separate reasons:

1. **The frontend never sends field ids.** `saveAllFields` in `frontend/src/stores/formFields.store.ts` builds its payload as `CreateFieldData`, which has no `id` property at all — the server ids that `loadFieldsFromForm` just stored are dropped on the way out. So a backend that matches payload entries to existing rows by `id` matches nothing. On a form with responses, the "safe" path would have created a complete duplicate set of fields on every save while preserving all the originals, because the originals have answers. A backend-only fix cannot work; the client is half of this contract.

2. **Two code paths means the dangerous one is the one that runs in development.** Every form starts with zero responses. The destructive branch would be the one exercised constantly by hand and by tests, and the safe branch would be the rarely-run path — exactly backwards.

3. **It treats the cascade as the problem.** The cascade is fine. The problem is that a routine edit issues a delete at all. Fix the write path and the cascade stops mattering.

The correct fix is that **field ids are stable across saves, unconditionally**, and a save is a diff, not a replacement.

There is also a real question the previous attempts answered badly: what should happen when the user deletes a field that already has answers? The reverted version silently kept the field and returned its id in a `preserved` array that no frontend code read — so the field reappeared in the editor after every save, with no explanation. Deleting the answers is data loss; keeping the field visible is a broken editor. The answer is a **soft delete**: the field is hidden from the editor but its row and its answers survive, so historical exports keep their column and their label.

## Goal

1. Saving fields from the editor never deletes an `Answer`, on any form, in any state — no conditional path.
2. A `Field.id` assigned by the server survives every subsequent save, for the life of the field.
3. Deleting a field that has no answers removes it from the database.
4. Deleting a field that has answers soft-deletes it: gone from the editor, still present in the responses table and the CSV export with its original label.
5. The whole save is one transaction — a failure part-way leaves the previous field set intact.
6. A test that fails on the current code and passes after the change, exercising a **real PostgreSQL database**, proves the answers survive. A mocked Prisma client cannot express a cascade and would have passed against the broken code.
7. `docs/sot/03-domain-model.md`, `06-api-reference.md` and the backlog reflect the new behaviour.

## Out of scope

- `DELETE /api/forms/:formId/fields/:fieldId`, the individual delete. Its cascade is an explicit, deliberate act by the user rather than a side effect of saving. Revisit separately once soft delete exists.
- `DELETE /api/forms/:id`. Form deletion cascading to responses is intended. The soft-delete/export-prompt question for it is a separate backlog item.
- Any change to `embedFieldsInPDF` or to `pdf-processor.ts`. It is called with the final field set, exactly as it is now.
- Rate limiting, entitlements, organizations. Different items.
- Rewriting the whole editor save flow in the frontend. The change there is to stop discarding ids, nothing more.

## Execution prompt

> **Step 0 — baseline the migrations.** `backend/prisma/migrations/` does not exist; the project has only ever used `prisma db push`. This change alters the schema, so before anything else: from `backend/`, run `npx prisma migrate dev --name baseline` against a local database matching the current schema, verify the generated SQL matches what is already deployed, and commit the migration directory. Every later step assumes `migrate` works. Do not proceed on `db push`.
>
> **Step 1 — read before writing.** `backend/src/routes/form-fields.ts` (the whole file, especially the `formFieldsRouter.post('/:formId/fields/bulk', …)` handler and `embedFieldsInPDF`), `backend/prisma/schema.prisma` (`Field`, `Answer`), `frontend/src/stores/formFields.store.ts` (`saveAllFields`, `loadFieldsFromForm`, `addField`, and the `LOCAL_ID_PREFIX = 'field-'` convention), `frontend/src/services/fields.ts` (`CreateFieldData`, `bulkSave`), and `backend/tests/fields.spec.ts` for the existing test style.
>
> **Step 2 — schema.** Add `deletedAt DateTime? @map("deleted_at")` to `Field`, and an index on `Answer.fieldId` (the new logic counts answers per field on every save). Generate a migration with a descriptive name. State the `onDelete` behaviour of anything you touch in the PR description, per [`03-domain-model`](../docs/sot/03-domain-model.md).
>
> **Step 3 — backend, one path only.** In the bulk handler, replace the `deleteMany` + `createMany` entirely. Do not branch on `prisma.response.count()`; there is a single algorithm for every form:
> - Validate the body with a schema that extends `createFieldSchema` with `id: z.string().uuid().optional()`. Name it `bulkFieldSchema` and use it **only** here — `createFieldSchema`, used by the individual `POST`, must keep rejecting a client-supplied `id`.
> - Load the form's live fields (`deletedAt: null`). Partition the payload: entries whose `id` exists on this form are updates; everything else is a create. Live fields whose id is absent from the payload are removals.
> - A payload entry carrying an `id` that does not belong to this form is an error, not a silent create — return `400`. It means the client is confused, and creating a field instead would hide the bug.
> - For removals, query which of those ids appear in `answers`. Ones that do not: `delete`. Ones that do: `update` with `deletedAt: new Date()`.
> - Run updates, creates, deletes and soft deletes inside a single `prisma.$transaction`.
> - Return the live fields ordered by `order`, in the existing `{ fields }` shape, plus `archived: string[]` listing the ids that were soft-deleted so the editor can tell the user their responses were kept. Call `embedFieldsInPDF` with the final live set, after the transaction commits, unchanged.
>
> **Step 4 — everything that reads fields must respect `deletedAt`.** Search the backend for every `prisma.field.find*` and every `include: { fields: … }`: `routes/forms.ts` (`GET /:id`, `GET /public/:shareId`, `syncFieldsFromPDF`) and `routes/responses.ts` must all see live fields only — a soft-deleted field must never render in the editor or the public form, and must never be required for a submission. The exceptions are deliberate: `services/csv-exporter.ts` and the responses listing **must include** soft-deleted fields, so a historical answer keeps its column and its label. Verify each call site by reading it; do not assume.
>
> **Step 5 — frontend, send the ids.** In `saveAllFields` (`frontend/src/stores/formFields.store.ts`), include `id` in the payload for fields whose id is a server id, and omit it for locally-created ones — the store already distinguishes them with `isLocalFieldId` / `LOCAL_ID_PREFIX`. Extend `CreateFieldData` (or add a `BulkFieldData` type) in `frontend/src/services/fields.ts` accordingly, and widen `bulkSave`'s response type to carry `archived`. Surface `archived` to the user as a non-blocking notice — a field they deleted was kept because it holds responses — rather than dropping it silently, which is what made the previous attempt confusing.
>
> **Step 6 — tests, the failing one first.**
> - Add a database-backed integration test. There is no harness for this yet, so create one: `backend/tests/integration/` with its own Vitest setup that connects to a real PostgreSQL via `DATABASE_URL` (CI already runs a `postgres:16` service for the E2E job — reuse that pattern in `.github/workflows/test.yml`, and add an `npm run test:integration` script to `backend/package.json`). The first test creates a form, fields, a response with answers, POSTs a bulk save with the same field ids and a changed position, and asserts every answer still exists and every field id is unchanged. **Run it against the unmodified handler first and watch it fail** — if it passes, it is not testing the bug.
> - Then the rest, at the same level: deleting a field with no answers removes the row; deleting a field with answers sets `deletedAt`, keeps the answers, and returns the id in `archived`; a soft-deleted field is absent from `GET /forms/:id` but still present in the CSV export; an unknown `id` in the payload returns 400; a failure mid-transaction leaves the original field set intact.
> - Keep the existing mocked specs in `backend/tests/fields.spec.ts` passing, and add mocked cases there for validation and status codes only. Do not try to express cascade behaviour with a mock.
> - Add a frontend test in `frontend/src/stores/formFields.store.spec.ts` asserting that `saveAllFields` sends server ids and omits local ones.
>
> **Step 7 — verify.** `npm run test:backend`, `npm run test:integration --workspace=backend`, `npm run test:frontend`, `npx tsc --noEmit` in `backend/`, and `npm run build --workspace=frontend`. Then run the real flow by hand: publish a form, submit a response, edit a field, save, and confirm in the responses dashboard and the CSV that the answer is still there.
>
> **Step 8 — document.** Update `docs/sot/03-domain-model.md` (the cascade map, the `deletedAt` lifecycle, and remove the "active defect" section), `docs/sot/06-api-reference.md` (the bulk endpoint's real semantics and the `archived` field — read the route file again before writing it, per the `api-contract-guard` skill), and `docs/sot/09-quality-and-testing.md` (the database-backed test level now exists). Remove the corresponding rows from `docs/BACKLOG.md`, including the migration baseline and the integration-test gap. Set this file to `**Status:** done`.

## Outcome

Delivered as specified. What landed:

- **Migrations baselined.** `backend/prisma/migrations/0_baseline` (generated with `migrate diff --from-empty`, marked applied with `migrate resolve`) plus `20260827232747_field_soft_delete_and_answer_field_index`. CI and E2E now run `prisma migrate deploy` instead of `db push`.
- **`Field.deletedAt`** and an index on `Answer.fieldId`. Both additive; no relation's `onDelete` changed. `Answer.field` stays `Cascade` — the fix is that the save no longer issues a delete.
- **One bulk algorithm, no branch on response count.** `bulkFieldSchema` = `createFieldSchema` + optional `id`; unknown or duplicate ids are `400`; removals with answers are archived, removals without are deleted; everything in one `$transaction`; response is `{ fields, archived }`.
- **Every field reader audited.** `GET /forms/:id`, `GET /forms/public/:shareId`, the `_count.fields` on `GET /forms`, `verifyFieldOwnership` and `POST /responses` see live fields only. The CSV export and the responses listing include archived fields by design.
- **Frontend sends its ids back**, distinguishing them with the existing `isLocalFieldId`. `archived` surfaces as a toast in `FormSavePanel.vue`.
- **A database-backed test level now exists**: `backend/tests/integration/`, `npm run test:integration`, with its own Vitest config and a CI job on a `postgres:16` service.

Verification: the first integration test was written against the unmodified handler and failed with `expected [] to have a length of 2` — every answer destroyed — then passed after the fix. Final state: 14 database-backed, 63 mocked backend, 237 frontend, both type checks and the frontend build clean. The end-to-end flow was also run by hand against a real server: publish, submit, edit a field and delete another, then confirm the surviving field kept its id, the archived field left the editor and the public form, and both answers were still in the dashboard and the CSV.

One addition beyond the spec text: the transaction locks the fields it is about to remove with `SELECT … FOR UPDATE` before counting their answers. Without it a response submitted between the count and the delete has its answer cascaded away — the same defect through a narrower window, and goal 1 says "in any state". The guard itself has no test (it needs two connections and deliberate interleaving) and is filed as such.

Two deliberate carve-outs and one observation were also filed in [`docs/BACKLOG.md`](../docs/BACKLOG.md): `DELETE /forms/:formId/fields/:fieldId` still hard-deletes answers, there is no UI for archived fields, and `tests/forms.spec.ts > DELETE /api/forms/:id > should delete form` failed once in a full-suite run and has not reproduced since.
