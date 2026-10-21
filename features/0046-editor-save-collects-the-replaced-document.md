# 0046 — Saving the document collects the PDF it replaced

**Status:** done
**Priority:** P3 (see docs/BACKLOG.md — *Saving the document orphans the PDF it replaces*)
**Branch:** feature/0046-editor-save-collects-the-replaced-document
**Related:** [03-domain-model](../docs/sot/03-domain-model.md) · [04-backend-patterns](../docs/sot/04-backend-patterns.md) · [07-security-and-privacy](../docs/sot/07-security-and-privacy.md) · [08-operations](../docs/sot/08-operations.md) · [`features/0029`](0029-account-deletion-and-real-erasure.md) · [`features/0039`](0039-uploads-belong-to-an-organization.md)

## Context

The editor's tools (text, image) rewrite the PDF in the browser with pdf-lib. Saving
uploads those bytes and repoints the form at them: `persistEditedDocument` in
`frontend/src/composables/useFormManagement.ts:272` calls `POST /api/upload`, then
`PUT /api/forms/:id` with the new `pdfUrl`. **Nothing removes the document the form
pointed at a moment earlier.** Every save leaves one more object in storage that no row
will ever reference again — unmeasured waste on local disk, a bill that only grows on
`s3`, and a customer document retained after the customer replaced it.

Three call sites do the same repoint and all three go through the same endpoint:
`useFormManagement.ts:287` (`persistEditedDocument`), `useFormManagement.ts:236`
(`uploadPDFForCurrentForm`, when the author picks a different PDF) and
`FormSavePanel.vue:384` (attaching a PDF to a form that has none). That is the argument
for where the fix belongs: **one place on the server, not three on the client.**

The hard half is already built. [`features/0029`](0029-account-deletion-and-real-erasure.md)
wrote `backend/src/services/pdf-gc.ts`, which is **the only module allowed to call
`pdfStorage().remove()`** and which already answers the one question that matters —
*is any surviving form still using this key?* — removes the `-backup.pdf` sibling with
it, deletes the `Upload` row after the object, logs an orphan it could not remove, and
never throws. `formsRouter.delete('/:id')` in `backend/src/routes/forms.ts:289` already
uses it in exactly the shape this change needs: read the keys before the write, call
`collectOrphanDocuments` after it. This feature is that same three-line pattern applied
to `formsRouter.put('/:id')`.

`docs/sot/08-operations.md:344` names this gap in writing, and so does the module comment
at the top of `pdf-gc.ts`. Both stop being true when this ships.

## Why the obvious approach is wrong

**Do not `remove(previousKey)`.** It is one line and it destroys a living form's
document. Two forms in one organization can point at one key: the editor repoints
without deleting, so keys are abandoned and reused in ordinary use, and
`services/uploads.ts` says in as many words that *an upload is not consumed by being
used*. The question is never "which key did this form have" but "is any surviving form
still using this key", and only `collectOrphanDocuments` may answer it.

**Do not collect before the update commits.** This is the failure that would ship green.
Run `collectOrphanDocuments([oldKey])` before `prisma.form.update` and `stillReferenced`
finds the form itself still pointing at the old key, returns `true`, and the call removes
nothing — a silent no-op that a carelessly written test (upload, save, assert no crash)
passes. Run it *after* and the answer is the real one. The same ordering is also what
protects the reversible failure: rows first, bytes second, exactly as the cascade map
argues for deletion. Bytes removed before a write that then fails would leave a live form
with no document, which is unrecoverable; a committed write followed by a failed removal
is an orphan, which is waste and is logged.

**Do not do it in the frontend, and do not add an endpoint.** A `DELETE /api/uploads/:key`
would let a client name which bytes to destroy, and the client cannot answer the aliasing
question — it has never seen the other forms. It also would not run when the tab is closed
between the upload and the repoint.

**Compare keys, not URLs.** A client may send back a signed URL it read from the API, and
`assertUploadBelongsTo` canonicalises it, so the string before and the string after can
differ while naming the same object. Use `pdfFilenameFrom` on both sides — the one parser
— and skip the collection entirely when the key is unchanged, which is the common case for
a save that only changes the title.

**The collection must not be able to fail the save.** `collectOrphanDocuments` already
swallows and logs; nothing in the handler may add a `throw` around it.

## The decision this takes, stated out loud

After this change **the previous version of the document is gone**, including the pristine
file the author originally uploaded once they have saved an edit over it. That is
deliberate: the form points at one document, the author has their own copy of what they
uploaded, and the alternative — keeping every version — is a version-history feature with a
UI, a retention rule and a storage bill, not a side effect of a garbage collector. It only
ever removes a key **no surviving form references**, so a document shared by two forms is
untouched.

## Goal

1. `PUT /api/forms/:id` with a `pdfUrl` naming a different document removes the previously
   referenced object from storage, plus its `-backup.pdf` sibling and its `Upload` row,
   once the update has committed.
2. It removes nothing when another surviving form still points at the old key.
3. It removes nothing when the request does not change the key (same document, or no
   `pdfUrl` in the body at all), and issues no storage call in that case.
4. A storage failure during collection leaves the save a `200`, with the orphaned key
   logged through the existing `Could not remove stored PDF; it is now orphaned` line.
5. The bytes are removed only after the row is written, never before.
6. `POST /api/forms`, `PATCH /api/forms/:id/status` and `DELETE /api/forms/:id` behave
   exactly as they do today.
7. `pdf-gc.ts`'s module comment and `08-operations.md:344` no longer claim the editor's
   save path leaks documents.

## Out of scope

- **The sweep for documents orphaned before this existed.** Every save made before this
  ships left a key no row names, and nothing here finds them. Two backlog rows already
  cover it (*Documents orphaned before erasure existed, and a sweep to find them*, and the
  `Upload`-row half above it); they stay, with their wording corrected so they no longer
  describe the editor trail as ongoing.
- **Per-file revocation of signed URLs**, its own backlog row.
- **Extraction and embedding.** Do not touch `pdf-processor.ts`, `pdf-embed.ts` or
  `requestEmbed`. The four-routes re-embed asymmetry is its own backlog row.
- **Any new endpoint, and any frontend behaviour change.** The only frontend edit permitted
  is the stale comment in `persistEditedDocument` that says the previous file is not
  deleted.
- **Document version history.** Named in the section above; file a backlog row for it and
  do not build it.

## Execution prompt

> Read first: `backend/src/services/pdf-gc.ts` in full (its module comment is the design),
> `formsRouter.delete('/:id')` and `formsRouter.put('/:id')` in
> `backend/src/routes/forms.ts`, `backend/src/services/uploads.ts`, `pdfFilenameFrom` in
> `backend/src/services/pdf-url.ts`, and `backend/tests/integration/upload-ownership.spec.ts`
> for the `MemoryPdfStorage` + `setPdfStorage` pattern this test needs.
>
> **Write the failing test first**, before touching the handler, and run it against the
> unfixed code to see it fail — a test written after the fix proves only that the code
> agrees with itself. New file `backend/tests/integration/editor-save-collects.spec.ts`,
> database-backed with the in-memory storage driver (a mocked Prisma cannot express "which
> keys still exist" against real rows — hard rule 6). Four tests:
> 1. upload A, create a form on A, upload B, `PUT` the form to B → A's object, its `Upload`
>    row and `A-backup.pdf` are gone and B's are present. **This one must fail before the
>    fix.**
> 2. two forms on A, repoint only the first to B → A survives, both objects present.
> 3. `PUT` with the same `pdfUrl`, and a `PUT` with no `pdfUrl` at all → A survives and the
>    driver recorded no `remove` call.
> 4. a driver whose `remove` rejects → the response is still `200` and the form points at B.
>
> Then the change, in `formsRouter.put('/:id')` only. Capture the candidate from the row
> `verifyFormOwnership` already returned (`existing.pdfUrl`) using `keysReferencedBy`,
> before the update; compare it with `pdfFilenameFrom(data.pdfUrl)` after
> `assertUploadBelongsTo` has canonicalised it, and keep the candidate only when the two
> keys differ. After the `prisma.form.update` — outside every transaction, awaited, before
> `res.json` — call `collectOrphanDocuments` with it. Mirror the comment style of the
> `DELETE` handler: say why the collection is after the write and not before, and why it is
> not `remove(oldKey)`. Do not change `collectOrphanDocuments` itself.
>
> Fix the comment in `frontend/src/composables/useFormManagement.ts:272`, which currently
> states as a design decision that the previous file is not deleted; it now is, by the
> server, on the repoint. Nothing else in the frontend changes.
>
> Verify: `npm run test:backend`, `npm run test:integration`, `cd backend && npx tsc
> --noEmit`, `npm run build --workspace=frontend`. Then run `ship-checklist`.
>
> On the way out: run `sot-sync`. `docs/sot/08-operations.md:344` must stop listing the
> editor's save path as a source of orphans and keep the pre-existing-objects one;
> `docs/sot/03-domain-model.md` gains the repoint as the second place the rows-first
> ordering applies; `docs/sot/07-security-and-privacy.md:296` — the retention cell for
> uploaded PDFs — must say that a replaced document goes when it is replaced, not only when
> the last form referencing it is deleted; the `pdf-gc.ts` module comment must stop using
> the editor's save path as its example of live aliasing (two forms on one upload still is
> one, and stays). Remove the *Saving the document orphans the PDF it replaces* row from
> `docs/BACKLOG.md`, correct the two orphan-sweep rows so they describe a historical trail
> rather than a growing one, add a row for **document version history** (the editor now
> keeps only the current document, and nothing offers the previous one back), and set this
> file to `**Status:** done` with an Outcome section recording what the pre-fix run of test
> 1 actually printed.

## Outcome

Built as specified. `formsRouter.put('/:id')` in `backend/src/routes/forms.ts` now reads the
replaced key with `keysReferencedBy([existing])` before the write — only when
`pdfFilenameFrom(data.pdfUrl)` differs from `pdfFilenameFrom(existing.pdfUrl)`, so an
unchanged document and a client echoing back a signed URL both skip storage entirely — and
calls `collectOrphanDocuments` after the update commits, outside every transaction, before
`res.json`. `services/pdf-gc.ts` itself was not changed except in its module comment.

**The failing test failed for the right reason.** `backend/tests/integration/editor-save-collects.spec.ts`
was written first and run against the unfixed code:

```
FAIL  tests/integration/editor-save-collects.spec.ts > the editor save collects the document
      it replaced > removes the previous object, its migration backup and its uploads row
AssertionError: expected true to be false // Object.is equality
 ❯ tests/integration/editor-save-collects.spec.ts:137
     expect(await storage.exists(original.filename)).toBe(false)

 Test Files  1 failed (1)
      Tests  1 failed | 3 passed (4)
```

That is the defect exactly: the repoint succeeded and the replaced object was still there.
The other three passed before the fix, which is expected — they assert that nothing is
removed, and nothing was. They are the guard on the fix, not on the bug: the second (two
forms on one upload) is what fails if anyone replaces the collector with
`remove(previousKey)`, and the third records the removals so "untouched" cannot be confused
with "removed and put back".

Storage is the in-memory `PdfStorageDriver` from `upload-ownership.spec.ts`, extended with a
`removed: string[]` log for that reason.

**Gate:** `test:backend` 32 files / 403 tests, `test:integration` 29 files / 280 tests (3 files
and 10 tests skipped — the Redis-gated ones, as always without `TEST_REDIS_URL`),
`test:frontend` 58 files / 497 tests, `tsc --noEmit` clean, frontend build clean.

**Two pieces of drift were corrected while syncing**, both found by opening the file the change
touched rather than by looking for them:

- `05-frontend-patterns.md` said `persistEditedDocument` repoints with `PATCH /api/forms/:id`.
  It is a `PUT` (`frontend/src/services/forms.ts:135`), and has been since before this change.
- `06-api-reference.md`'s *Not implemented* paragraph still listed the public API, API keys,
  outbound webhooks, account deletion and the organization export as missing. All five shipped
  ([`0019`](0019-api-keys-and-read-only-public-api.md), [`0020`](0020-outbound-webhooks.md),
  [`0021`](0021-api-keys-screen.md), [`0029`](0029-account-deletion-and-real-erasure.md),
  [`0030`](0030-account-data-export.md)) and the same document describes four of them above that
  paragraph. Corrected in place, saying what it used to claim, rather than deleted.

**Filed:** one new backlog row — the editor now keeps only the current document and nothing
offers the previous one back. That is this change's deliberate consequence, stated where it can
be argued with rather than left in a commit message.
