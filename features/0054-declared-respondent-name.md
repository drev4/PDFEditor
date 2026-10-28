# 0054 — A respondent can declare their name, and it travels with the response

**Status:** done
**Priority:** P0 for declared attribution (business backlog `PRD-006`, `PDFSaaS/docs/planning/BACKLOG.md`; cross-repository review of 2026-10-20)
**Branch:** `feature/0054-declared-respondent-name`
**Related:** [03-domain-model](../docs/sot/03-domain-model.md) · [06-api-reference](../docs/sot/06-api-reference.md) · [07-security-and-privacy → Data inventory](../docs/sot/07-security-and-privacy.md#data-inventory) · precedent: [`features/0032`](0032-respondent-notice-and-ip-collection.md)

## Context

A response today says *when* it arrived and *what* was answered, and nothing about *who* sent it. The business needs that for every workflow where the document is an attestation — an inspection sheet, a delivery note, a sign-off — and the global backlog files it as `PRD-006`: *"a field with limits and consent/context, visible in the dashboard, the CSV and the future PDF; update the personal-data inventory"*. It is also the input that `PRD-018` (name, signature and timestamp stamped onto the completed PDF) depends on, so it comes before the PDF work rather than inside it.

The word that matters is **declared**. A share link is anonymous ([07-security](../docs/sot/07-security-and-privacy.md)); nothing in this product knows who is holding it. The name is what the respondent typed, and every surface that shows it must say so rather than imply an identity the product never checked.

[`features/0032`](0032-respondent-notice-and-ip-collection.md) already built the exact shape this needs — a per-form column governing what a submission stores, one derived boolean on the anonymous payload, a switch in `ShareFormModal.vue`, a notice generated from what is true — and this feature follows it deliberately.

## Why the obvious approach is wrong

### 1. "Just add a text field called *Name*" is what authors can already do, and it is not attribution

Any author can draw a text field and label it *Name*. That answer is an `Answer` row keyed by a field id: nothing downstream can tell it from any other text, it has no fixed CSV column, it can be archived by an edit to the PDF, and `PRD-018` would have to guess which field to stamp. Attribution needs to be **a property of the response**, not of the document's layout.

### 2. Not a key in `answers`, and not a key in `Form.settings`

`answers` is `z.record(z.string(), z.any())` keyed by field id, and unknown keys are dropped with a warning (`backend/src/routes/responses.ts`). `Form.settings` is an untyped blob — 0032 §2 argues why a flag deciding what personal data is stored cannot live there. So: a real column on `Form` for the setting, a real column on `Response` for the value, and an explicit field in each Zod schema.

### 3. The value is a snapshot string, never a link to an account

`Response.respondentName String?` holds the text as submitted. It is not a foreign key, it is not matched against `User`, and no screen may render it as *"Signed by"* or with any verified marker. Labels say **Declared name** everywhere. Turning it into an identity is a separate feature (it needs authentication of respondents, which a share link does not have).

### 4. The server decides what is stored; the client only collects

- When the form does **not** ask, a `respondentName` in the body is **ignored and `null` is written** — the same rule 0032 applies to IP addresses: the column governs what a submission stores, not what a client may send.
- When the form **does** ask, the name is **required**: missing or blank after normalisation is a `400`. An optional attribution is not attribution; an optional mode can be added if a pilot asks for it.
- Normalisation and limits are server-side and authoritative: trim, collapse internal whitespace runs to one space, reject control characters, length **1–120** after normalisation. The client mirrors these for feedback, never as the gate.

### 5. Default `false`, and existing rows are untouched

A new column `Form.asksRespondentName Boolean @default(false)`. Existing forms keep behaving exactly as today; existing responses get `respondentName = null` and render as *—*. The migration is additive only — no backfill, no destructive step.

### 6. The organization-wide listing stays free of respondent data

`GET /api/organizations/responses` deliberately carries no respondent data ([07-security](../docs/sot/07-security-and-privacy.md), [`features/0024`](0024-organization-responses.md)) and its integration test asserts the absences by name. A name is respondent data. It does **not** go there; the per-form screen, the CSV, the v1 API, the webhook and the organization export are where it belongs.

### 7. The anonymous payload gains one boolean about the respondent, not about the owner

`GET /api/forms/public/:shareId` returns `asksRespondentName` beside `collectsMetadata`, for the same reason and in the same shape: it says what will happen to the person reading it and nothing about the owner's plan, limits, usage or identity.

## Goal

1. Migration `add_respondent_name`: `forms.asks_respondent_name BOOLEAN NOT NULL DEFAULT false` and `responses.respondent_name TEXT NULL`. Additive only; generated SQL read before committing.
2. `PUT /api/forms/:id` accepts `asksRespondentName` as an explicit `z.boolean().optional()`; authenticated form reads return it (through `toApiForm`'s spread).
3. `GET /api/forms/public/:shareId` returns `asksRespondentName: boolean`.
4. `POST /api/responses` accepts optional `respondentName`. Normalised and validated by one function (`normalizeRespondentName`, in its own service module so the tests can reach it). Stored only when the form asks; `400` with `details.respondentName` when the form asks and the value is missing/blank/too long/contains control characters.
5. The name is carried by every way a response leaves the building, except the org-wide listing (§6):
   - `GET /api/forms/:id/responses` (whole rows — automatic);
   - CSV export (SPA and `/api/v1/.../responses.csv`, one exporter): a **Declared name** column after *Date Submitted*;
   - `/api/v1/forms/:id/responses`: `respondentName` (string or `null`) on each response — an **additive** contract change, documented;
   - webhook `response.created`: `respondentName` on `response`;
   - organization export: `respondentName` on each response.
6. Public form: when `asksRespondentName`, `SubmitPreviewModal.vue` shows a required *Your name* input above the confirm button; confirm is disabled until it is valid; a server `400` on the name shows under it. The name is held in component state only — **not** written to the localStorage draft.
7. The respondent notice (`data-testid="respondent-notice"`), when asking, adds that the name is stored as typed and is not verified.
8. `ShareFormModal.vue`: a second switch, *Ask for the respondent's name*, beside the metadata one, same direct-service pattern and the same revert-on-failure.
9. `ResponsesView.vue`: a *Declared name* column and a line in the detail panel; `—` for `null`.
10. Tests:
    - **Integration** (`backend/tests/integration/respondent-name.spec.ts`): flag off → body name ignored, `null` stored; flag on → normalised name stored; flag on and missing/blank/121 chars/control char → `400` and **no response row and no usage increment**; public payload carries the boolean; the flag survives an update; v1 response, CSV and org export carry the name; **the org-wide listing does not**.
    - **Unit**: `normalizeRespondentName` cases; CSV column.
    - **Frontend**: the modal requires the name only when asked; the notice mentions the name only when asked; the switch reflects and changes the flag.
11. All suites green: backend, integration, frontend, e2e, both type checks, frontend build.

## Out of scope

- **Stamping the name on a PDF** — `PRD-005/018/021`.
- **Verified identity / respondent accounts** — §3.
- **An optional (not required) mode** — §4; add when a pilot asks.
- **CSV formula injection** (`=`, `+`, `-`, `@` at the start of a cell). It already applies to every free-text answer, so it is fixed in the exporter for all columns or not at all — filed in `docs/BACKLOG.md`, not done here.
- **The org-wide listing** — §6.

## Execution prompt

> Apply `prisma-schema-migration`, `backend-endpoint-pattern`, `frontend-state-pattern`, `api-contract-guard` and `sot-sync`. Read first: `backend/src/routes/responses.ts`, `backend/src/routes/forms.ts` (schemas, `toApiForm`, public payload), `backend/src/services/csv-exporter.ts`, `backend/src/routes/v1/forms.ts` (`publicResponse`), `backend/src/services/webhook-queue.ts` (`renderEvent`), `backend/src/services/organization-export.ts` (`writeResponses`), `frontend/src/views/PublicFormView.vue`, `frontend/src/components/forms/SubmitPreviewModal.vue`, `frontend/src/components/forms/ShareFormModal.vue`, `frontend/src/views/ResponsesView.vue`.
>
> **Do not touch:** the org-wide listing body, `Form.settings`, `middleware/rateLimit.ts`, the localStorage draft shape, any existing response row.
>
> **On the way out:** 03-domain-model (both columns, default, snapshot semantics); 06-api-reference (public payload, form update, submit body and `400`, v1 and webhook additions); 07-security data inventory (new row: declared name — source, purpose, where it leaves, erased with the response); `docs/BACKLOG.md` (CSV formula injection; optional mode only if wanted); this file `**Status:** done` with an `## Outcome`.

## Outcome

Done on `feature/0054-declared-respondent-name`. Backend 33 files / 419 tests, integration 32 passed + 3 skipped (the Redis-gated ones, unchanged) / 314 passed + 10 skipped, frontend 69 / 617, both backend type checks and the frontend build clean. **E2E 53 passed, 4 failed** — the four old-brand assertions already filed in `docs/BACKLOG.md` as red on `develop`; the new end-to-end test for this feature is among the 53.

The migration is two additive statements and touched no existing row:

```sql
ALTER TABLE "forms" ADD COLUMN "asks_respondent_name" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "responses" ADD COLUMN "respondent_name" TEXT;
```

It was written from `prisma migrate diff` rather than `migrate dev`, because the local development database reports `20260903075909_uploads_owned_by_organization` as modified after it was applied (a checksum difference, most likely line endings) and `migrate dev` would only proceed by resetting it. The generated SQL was read before committing; it was applied with `migrate deploy` to both `vuepdf` and `vuepdf_test`.

### The test catches the bug

With the condition in `routes/responses.ts` replaced by `if (true)` — always validate and store the name — `respondent-name.spec.ts` fails two tests (*ignores a name sent to a form that does not ask*, and the v1 `null` case). Restored, all 15 pass.

### Decisions made while implementing

- **The input lives in `SubmitPreviewModal.vue`**, the review dialog every submission already passes through, not on the PDF canvas: the name is a property of the response, not of the document's layout. Confirm is disabled until the local check passes; a server refusal keeps the dialog open and shows under the input, and is cleared as soon as the name is edited.
- **The name is not in the localStorage draft.** It is personal data, and a shared computer should not offer it to the next person who opens the link.
- **The CSV column is always present**, empty where no name was collected, so column positions do not depend on a setting that can change between exports.
- **A field named `respondentName`** would share a key with the name's error in the `400` `details` object, which is keyed by field name. Accepted: it is a cosmetic collision in an error message, not a data path.

### Left open, on purpose

Stamping the name on a completed PDF (`PRD-005/018/021`); an optional (not required) mode; verified identity; and CSV formula injection, which predates this feature and is now filed for all cells.
