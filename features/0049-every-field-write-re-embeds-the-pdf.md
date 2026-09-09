# 0049 — Every field write re-embeds the PDF

**Status:** done
**Priority:** P3 (row *An individual field change never re-embeds the PDF*, `docs/BACKLOG.md`; task 11 of the *Editor PDF* track in the product plan)
**Branch:** feature/0049-every-field-write-re-embeds-the-pdf
**Related:** [04-backend-patterns §5](../docs/sot/04-backend-patterns.md) · [06-api-reference](../docs/sot/06-api-reference.md) · [03-domain-model](../docs/sot/03-domain-model.md) · [`features/0017`](0017-job-queue-for-pdf-embedding.md) · [`features/0044`](0044-field-delete-archives-its-answers.md) · [`features/0045`](0045-archived-fields-are-visible-and-restorable.md) · [`features/0046`](0046-editor-save-collects-the-replaced-document.md)

## Context

The stored PDF carries an AcroForm that is supposed to describe the form's live fields.
Exactly **one** handler keeps that promise: `formFieldsRouter.post('/:formId/fields/bulk', …)`
in `backend/src/routes/form-fields.ts:287`, whose last act before responding is
`await requestEmbed(formId)` (line 396). `grep -rn "requestEmbed" backend/src` returns that
call, the import, and a comment saying no other write makes it — which is accurate and is
the defect.

Five write paths change what the AcroForm should say and none of them ask for an embed:

| Path | File | What it changes |
|---|---|---|
| `POST /api/forms/:formId/fields` | `routes/form-fields.ts:100` | Adds a field |
| `PUT /api/forms/:formId/fields/:fieldId` | `routes/form-fields.ts:203` | Renames, retypes, repositions, changes `required`/`validation` |
| `DELETE /api/forms/:formId/fields/:fieldId` | `routes/form-fields.ts:239` | Deletes or archives a field ([`0044`](0044-field-delete-archives-its-answers.md)) |
| `POST /api/forms/:formId/fields/:fieldId/restore` | `routes/form-fields.ts:178` | Un-archives a field ([`0045`](0045-archived-fields-are-visible-and-restorable.md)) |
| `PUT /api/forms/:id` | `routes/forms.ts:213` | Repoints `Form.pdfUrl` at a **different document** — the editor's own save ([`0046`](0046-editor-save-collects-the-replaced-document.md)) |

The last one is the worst of the five and the least obvious. `FormSavePanel.vue` /
`useFormManagement.ts` upload the edited bytes and then `PUT /api/forms/:id` to repoint the
form at them. Those bytes are whatever the author's editing produced from the file they
uploaded — so the document the product stores carries **the AcroForm the customer's original
PDF happened to have**, not this form's fields, until somebody happens to run a bulk save.

The symptom is identical in all five cases and invisible until somebody downloads the
document: the stored PDF describes a form that no longer exists. Nothing errors, nothing
logs, and the database is right the whole time.

Three of the five were noticed while doing something else and each was deliberately left
alone, for one reason stated three times: fixing one route in isolation deepens the
asymmetry rather than closing it. That reason expires here — this spec is the "do all of
them" it was waiting for. The product currently ships a **toast that apologises for the
bug** (`frontend/src/components/editor/EditorRail.vue:244`, "Save the form to put it back in
the PDF"), which is honest and is also the marker for what has to change when this lands.

## Why the obvious approach is wrong

**Adding `requestEmbed` inside the transaction.** `DELETE` runs its decision inside
`prisma.$transaction` (`form-fields.ts:245`), and dropping the call in there is the shortest
diff. It is wrong twice. `embedFormFields` re-reads the fields through the **global** `prisma`
client (`services/pdf-embed.ts:56`), which cannot see the uncommitted transaction — so it
embeds the pre-delete field set and the document ends up describing exactly the state the
request removed. And it holds a database transaction open across a storage read, a PDF
rewrite and a storage write. The bulk save's placement is the pattern and the comment above
line 396 says why: **after the transaction commits, awaited, best-effort.**

**Embedding on every `PUT /api/forms/:id`.** That route is not "the document route" — it also
takes `title`, `description` and `status` (`updateFormSchema`, `forms.ts:31`), and publishing
goes through it. An unconditional call rewrites the whole PDF when somebody fixes a typo in a
title, and on the queued path enqueues a job for it. The condition is *the stored key
changed*.

**Reusing `replaced` for that condition.** `forms.ts:254` already computes
`data.pdfUrl !== undefined && pdfFilenameFrom(data.pdfUrl) !== pdfFilenameFrom(existing.pdfUrl)`
and it is tempting to write `if (replaced.length > 0) await requestEmbed(id)`. That is subtly
wrong: `replaced` is `keysReferencedBy([existing])`, so it is **empty when the form had no PDF
before** — a form that gains its first document is precisely a case that needs the embed and
would silently not get one. Compute the boolean once, use the boolean for the embed, and keep
`replaced` for the garbage collection it was written for.

**Passing the field list to save a query.** `embedFormFields` takes nothing but `formId` and
re-reads everything itself, and `services/pdf-embed.ts:24-33` explains that this is
load-bearing rather than tidiness: a caller-supplied list is stale by the time the work is
serialised. Do not add a parameter.

**Letting a failed embed change the response.** `requestEmbed` is best-effort by contract —
`embedInline` swallows its errors, and the queued path returns as soon as the job is added.
None of the five handlers may gain a `try`/`catch` that alters a status code, and none may
move their `res.json(...)` behind new failure modes. The fields are committed; that is the
record that matters.

**Assuming this is free.** With `REDIS_URL` unset — the default, and what every suite runs —
`requestEmbed` runs the full read-modify-write **inline**, under the per-form lock. So
deleting one field goes from a short transaction to a transaction plus a PDF rewrite. That is
the "change to what an individual field write costs" the backlog row names, and it is
accepted here rather than worked around: a correct document is worth more than a fast
`DELETE`, and the queue already exists for deployments that care. Do not add a debounce, a
"skip if nothing visible changed" heuristic, or a second embed path to soften it.

**Touching `verifyFieldOwnership` or the restore route's shape.** Restore deliberately has no
transaction and no `SELECT … FOR UPDATE` (`form-fields.ts:168-174`), because it counts nothing
and destroys nothing. Adding an embed does not change that and must not be used as an excuse
to add either.

## Goal

1. All five paths in the table call `requestEmbed(formId)` **after** their write has
   committed, awaited, and outside any `prisma.$transaction` callback.
2. `PUT /api/forms/:id` requests an embed **if and only if the stored PDF key changes**,
   including the `null → key` case, and does not request one for a title-, description- or
   status-only update.
3. No handler's status code or response body changes because of an embed, on success or
   failure. `POST /:formId/fields` still answers `201` with `{ field }`; `DELETE` still
   answers `{ message, archived, answerCount }`; `PUT /api/forms/:id` still answers
   `{ form }`.
4. An integration test against a real PostgreSQL proves, for each of the five paths, that
   the AcroForm in the stored PDF matches the form's live fields after the request returns.
   **It is written first, run against the unfixed code, and seen to fail** — with the failure
   output recorded in the PR description.
5. The editor no longer tells the author their change is not in the PDF yet:
   `EditorRail.vue:106` (restore confirmation) and `EditorRail.vue:244` (restore toast) are
   updated, and the frontend specs that assert those strings with them.
6. The stale comments are gone, not just outdated: `form-fields.ts:175-177`,
   `docs/sot/03-domain-model.md:176`, `docs/sot/06-api-reference.md:209`, and the
   `docs/sot/04-backend-patterns.md:91` bullet that describes the embed as the bulk save's
   alone.
7. The backlog row *An individual field change never re-embeds the PDF* is removed, and this
   file is `**Status:** done`.

## Out of scope

- **Moving PDF extraction off the request path.** `extractFieldsFromPDF` in
  `POST /api/upload` and `syncFieldsFromPDF` in `GET /api/forms/:id` stay inline; that is its
  own backlog row and needs an async UX designed with it.
- **`PATCH /api/forms/:id/status`.** Publishing changes no field and no bytes, so it needs no
  embed. Do not add one there for symmetry.
- **Anything inside `services/pdf-embed.ts`, `services/embed-queue.ts` or
  `services/pdf-processor.ts`.** This feature only adds callers. If the embed itself is
  wrong for a case here, file it rather than fixing it in this branch.
- **The queue's optionality.** Both code paths keep working exactly as they do
  ([`0017`](0017-job-queue-for-pdf-embedding.md), trap 3).
- **The `/api/v1` router.** It is read-only; it has no field writes to fix.
- **Snap to grid for fields, marquee selection, redo.** Separate rows, separate specs.

## Execution prompt

> **Read first, before writing anything:** `backend/src/routes/form-fields.ts` in full,
> `backend/src/routes/forms.ts:213-292` (the `PUT /:id` handler),
> `backend/src/services/embed-queue.ts` (`requestEmbed` and its contract),
> `backend/src/services/pdf-embed.ts` (`embedFormFields`, `embedInline`),
> `backend/tests/integration/pdf-embed-concurrency.spec.ts` (it already has the
> `embeddedFieldCount()` helper that reads the AcroForm back out of stored bytes — the
> assertion this feature needs), and `docs/sot/04-backend-patterns.md` §5.
>
> **Write the failing test first.** New file
> `backend/tests/integration/field-writes-embed.spec.ts`, following the arrangement in
> `backend/tests/integration/field-delete-archives.spec.ts` for setup and
> `pdf-embed-concurrency.spec.ts` for reading the embedded AcroForm back. One case per path:
> create a field, update a field, delete a field that has no answers, delete a field that has
> answers (archived — the AcroForm must lose it), restore an archived field, and
> `PUT /api/forms/:id` repointing at a freshly uploaded document. Each asserts the embedded
> field count and names after the request returns. Add the negative case too: a
> title-only `PUT /api/forms/:id` does **not** rewrite the document — assert on the stored
> bytes being byte-identical, not on a spy. Run it against `develop` and record the failure
> output; a test that passes before the fix is testing the wrong thing.
>
> **Then the change.** In `backend/src/routes/form-fields.ts`, add `await requestEmbed(formId)`
> after the write in the individual `POST`, `PUT`, `DELETE` and `restore` handlers — after the
> `$transaction` in `DELETE`, never inside it — and delete the comment at lines 175-177 that
> says no individual write does this. In `backend/src/routes/forms.ts`, import `requestEmbed`
> from `../services/embed-queue.js`, extract the "the stored key changed" decision into a named
> boolean computed where `replaced` is computed today (line 254), use it for both the existing
> `collectOrphanDocuments` guard and a new `await requestEmbed(id)` after the update commits —
> and make sure the boolean is true for `null → key`, which `replaced` is not. Follow the
> `backend-endpoint-pattern` skill.
>
> **Do not** add a parameter to `embedFormFields`, do not wrap `requestEmbed` in a
> `try`/`catch` that changes a response, do not give the restore route a transaction, and do
> not touch `PATCH /:id/status`.
>
> **Then the frontend.** `frontend/src/components/editor/EditorRail.vue` lines 106 and 244
> both tell the author to save the form to get the field back into the PDF. That stops being
> true, so both strings change and so does the comment above the toast at lines 236-238.
> Update whichever specs assert on them (`grep -rn "put it back in the PDF" frontend/src`).
> No other frontend change: no new call, no new state.
>
> **Verify:**
> ```bash
> npm run test:integration        # the new spec, plus the embed specs it sits beside
> npm run test:backend
> npm run test:frontend
> cd backend && npx tsc --noEmit
> npm run build --workspace=frontend
> ```
> If a Redis is available, also run the queued path once with `TEST_REDIS_URL` set, so both
> code paths are exercised at least once.
>
> **On the way out:** run the `api-contract-guard` skill over the five endpoints, then the
> `sot-sync` skill. The specific statements that are now false and must be rewritten rather
> than left: `docs/sot/03-domain-model.md:176` ("Restoring does not re-embed the PDF"),
> `docs/sot/06-api-reference.md:209` (the same claim for `restore`), and
> `docs/sot/04-backend-patterns.md:91` (which describes the embed as belonging to the bulk
> save alone — it is now what *every* write that changes the field set or the document does).
> Remove the *An individual field change never re-embeds the PDF* row from
> `docs/BACKLOG.md`. File, rather than fix: anything you find about the cost of the inline
> path on a large PDF. Set this file to `**Status:** done` and run `ship-checklist` before
> the PR.


## Outcome

Done. Six handlers embed now — the individual `POST`, `PUT`, `DELETE` and `restore` on
`/api/forms/:formId/fields`, the bulk save that already did, and `PUT /api/forms/:id` when
the stored key changes. `backend/tests/integration/field-writes-embed.spec.ts` (11 tests)
was written first and run against the unfixed code, where **7 of its 9 positive assertions
failed**, each for its own reason:

```
× embeds a field created through the individual POST     expected [] to deeply equal [ 'full_name' ]
× re-embeds under the new name when renamed through PUT  expected [] to deeply equal [ 'surname' ]
× removes a deleted field from the document              expected [ 'full_name' ] to deeply equal []
× removes an archived field from the document            expected [ 'full_name' ] to deeply equal []
× puts a restored field back into the document           expected [ 'full_name' ] to deeply equal []
× embeds the fields into a document repointed at         expected [] to deeply equal [ 'full_name' ]
× embeds when a form with no document gains one          expected [] to deeply equal [ 'full_name' ]
```

The first two runs of that suite are the whole story of this feature, and both are the
reason to keep it here.

**The spec was wrong to put `services/pdf-processor.ts` out of scope, and the test said so.**
`embedFieldsInPDF` removed only an existing field of the **same name** before recreating it,
so it *added* to the AcroForm and never subtracted: a deleted field stayed in the document
for ever, and a renamed one appeared **twice**, once under each name. That was survivable
while the bulk save was the only embedder — a rename never reached the PDF at all. It stops
being survivable the moment every write embeds, and shipping the spec as written would have
turned a stale document into a **duplicated question in the customer's downloadable PDF**:
a new user-visible defect, not a smaller one. So the embedder now removes every existing
AcroForm field before adding the list it was given, which also fixes the same latent bug in
the bulk save.

**That removal then needed a guard nobody had written down.** With the embedder replacing
the AcroForm, an embed on a form with zero live fields flattens the document — and zero
live fields means two different things the database cannot distinguish: the author deleted
them, or nobody has read the document yet. Extraction runs on upload and on the first
`GET /api/forms/:id` (`syncFieldsFromPDF`), so a form that has never had a field row still
keeps its truth in the PDF. Repointing such a form would have stripped the AcroForm the
author uploaded, and the sync about to read it would have found nothing — every question
gone, with a `200`. A row count cannot decide it either: deleting the last field of a form
leaves zero rows too. So the *caller* says, through `EmbedOptions.allowEmpty`: the field
routes pass `true` because they are writes about the field set, and `PUT /api/forms/:id`
does not, because repointing a document says nothing about fields. It travels through the
queue as intent rather than data, which is why it does not break the rule that
`embedFormFields` re-reads everything else itself. Two tests hold that line — a repoint that
must not flatten, and a delete of the last field that must.

Verified: `field-writes-embed.spec.ts` 11/11, the full integration suite 291 passed / 10
skipped, backend 403, frontend 564, `tsc --noEmit` and the frontend build clean. The queued
path was not exercised (no local Redis on 6379 — the port was taken); the inline path is
what all four suites run, as always.

Filed rather than fixed: nothing new. The `Snap to Grid` and marquee rows from
[`features/0048`](0048-multi-select-duplicate-and-keyboard-nudge.md) are untouched.
