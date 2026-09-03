# 0039 — An upload belongs to an organization, and `Form.pdfUrl` must name one

**Status:** backlog
**Priority:** P1 (see [`docs/BACKLOG.md`](../docs/BACKLOG.md))
**Branch:** *(filled in when it moves to "in progress")*
**Related:** [07-security](../docs/sot/07-security-and-privacy.md) · [03-domain-model](../docs/sot/03-domain-model.md) · [04-backend-patterns](../docs/sot/04-backend-patterns.md) · [`features/0006`](0006-signed-expiring-urls-for-uploaded-pdfs.md) · [`features/0009`](0009-organizations-own-resources.md) · [`features/0016`](0016-object-storage-for-uploaded-pdfs.md) · [`features/0029`](0029-account-deletion-and-real-erasure.md)

## Context

`Form.pdfUrl` is a client-supplied string that nothing checks the ownership of. `createFormSchema` and `updateFormSchema` declare it `pdfUrl: z.string().optional()` (`backend/src/routes/forms.ts:23`, `:30`), and the only processing on the way in is `canonicalPdfUrl` (`:117`, `:213`), which validates **shape and nothing else**: `SAFE_FILENAME = /^[A-Za-z0-9_-]+\.pdf$/` in `backend/src/services/pdf-url.ts:29`. Any well-formed filename is accepted from anybody.

The backlog row for this says *"filenames are unguessable, so this is obscurity, not a control."* **That is too kind, and reading the code is what shows it.** No guessing is required:

1. `signPdfUrl` puts the filename in the URL path — `${baseUrl()}/uploads/pdfs/${exp}.${hmac}/${filename}` (`pdf-url.ts:107`) — and `GET /api/forms/public/:shareId` returns it through `toApiForm` (`forms.ts:332`). **Every respondent of every published form is handed a valid filename**, by design, because their browser has to fetch the document.
2. That respondent creates their own form with `pdfUrl` set to that filename. It is accepted. From then on their own `GET /api/forms` mints fresh signed URLs for another organization's document, **indefinitely** — surviving the original form being unpublished, closed or deleted, and defeating `UPLOAD_URL_TTL_SECONDS`, which is the entire control [`features/0006`](0006-signed-expiring-urls-for-uploaded-pdfs.md) exists to provide.

So this is a cross-tenant read reachable by anyone who was ever sent a share link, not a brute-force distance. Under this repository's own definition — `CLAUDE.md`, first section — missing authorization is the product not working.

**It also runs backwards, and that half is an erasure defect.** `collectOrphanDocuments` deliberately keeps a key while any *surviving* form references it (`backend/src/services/pdf-gc.ts:90`, and `forms.ts:275` says so out loud). A stranger's dangling reference therefore **pins a victim's document alive against the victim's own deletion request**: the form row goes, the bytes stay, and [`features/0029`](0029-account-deletion-and-real-erasure.md)'s promise that deleting a form removes its document is quietly false for exactly the documents somebody else has pointed at. `pdf-gc.ts` is not wrong — it is correctly defensive about a hazard that should not exist.

The fix the backlog names is the right one and it names its own prerequisite: verify at write time that the key came from an upload this tenant made, **which needs an uploads table**. There is none today — `POST /api/upload` (`backend/src/routes/upload.ts`) writes bytes through `pdfStorage().put()` and returns a URL, recording nothing at all.

## Why the obvious approach is wrong

**Do not scope the check to the user.** `Upload.uploadedByUserId` must be provenance, never the authorization input — exactly the split `Form.createdByUserId` already documents in `backend/prisma/schema.prisma`. A colleague uploads a document and another member builds the form from it: that is ordinary B2B use, it works today, and a user-scoped check would break it. The authorization key is `organizationId`, because that is what owns a `Form` ([`features/0009`](0009-organizations-own-resources.md)).

**Do not answer `404` for a key that belongs to another organization and `400` for one that does not exist.** Two different answers is an oracle: it lets a caller enumerate which filenames are real without ever reading one. Both cases get the **same** rejection — a `400` validation error with wording that distinguishes neither. Note this is not the `404`-for-cross-tenant convention from [`features/0009`](0009-organizations-own-resources.md); that convention is about *addressing a resource you may not reach*, and this is a **field inside a body being invalid**, which this API answers `400`. The `404` shape would additionally be wrong here because the resource being addressed — the form — is one the caller genuinely owns.

**Do not make `Upload` the collector's source of truth, and do not simplify `pdf-gc.ts`.** It is tempting to conclude that once a key belongs to one organization, `collectOrphanDocuments` can go back to `remove(pdfFilenameFrom(form.pdfUrl))`. It cannot, and the failure destroys data. Two forms **in the same organization** can still reference one key: `useFormManagement.ts:287` and `FormSavePanel.vue:384` repoint a form at a newly uploaded document without deleting the old one, and nothing stops a member creating a second form on the same upload. The question `stillReferenced` asks — *is any surviving form using this key* — stays exactly right. This feature narrows who can create an alias; it does not remove aliasing.

**Do not treat an `Upload` row as single-use.** A key stays usable by its organization for as long as the organization exists. Consuming the row on first use would break re-pointing a form at a document it already used, and would make the editor's save path depend on upload order.

**The backfill cannot assume the bug never fired.** Existing `forms.pdf_url` values have no `Upload` row, and one key may already be referenced by forms in **two different organizations** — that is precisely the defect. The migration must not silently pick one and call it settled. It attributes each distinct key to the organization of the **oldest** form referencing it, and it must **count and report** every key referenced from more than one organization, because that count is evidence and the executor has to state it. On a dataset where the count is zero, say zero.

**A key in storage that no form references gets no `Upload` row, deliberately.** Documents orphaned before [`features/0029`](0029-account-deletion-and-real-erasure.md) and the editor's replace trail are already unreachable — nothing legitimately re-points a form at them, and inventing owners for them would be guessing. Finding those is the separate *documents orphaned before erasure existed, and a sweep to find them* backlog row.

## Goal

Each of these is true or false when the work is done.

1. A new `Upload` model exists: the storage key (unique), `organizationId` (cascade on organization delete), a nullable `uploadedByUserId` (`SetNull`, provenance only, never read by an authorization check), `size`, `originalName`, `createdAt`. One migration, made with `prisma migrate dev`.
2. `POST /api/upload` resolves the caller's organization through `requireOrganizationId(req)` and writes the `Upload` row **after** `pdfStorage().put()` succeeds and before it responds. The response body is unchanged.
3. `POST /api/forms` and `PATCH /api/forms/:id` reject a `pdfUrl` whose key has no `Upload` row for the acting organization, with `400` and a message that does not reveal whether the key exists. A `pdfUrl` that is not a well-formed filename gets the same `400` — today `PATCH` silently drops it (`forms.ts:213`) and `POST` silently writes `null` (`:117`).
4. The check reads the key through `pdfFilenameFrom` and nothing else. No new place splits a URL on `/`. `services/pdf-url.ts` stays the one parser ([04-backend-patterns §8](../docs/sot/04-backend-patterns.md)).
5. A user with no membership cannot upload. (Registration always creates a personal organization, so this changes nothing for a real account — state it, do not design around it.)
6. `collectOrphanDocuments` deletes the `Upload` row for a key whose bytes it has just removed, in the same `try`, after a successful `remove`. The row never outlives the object.
7. `pdf-gc.ts`'s `stillReferenced` is **unchanged** and still asks about surviving forms.
8. The migration backfills one `Upload` per distinct key in `forms.pdf_url`, attributed to the oldest referencing form's organization, with a null `uploadedByUserId`. Every form that renders today still renders after it.
9. `GET /api/organizations/export` includes the organization's uploads, so [`features/0030`](0030-account-data-export.md)'s "the whole tenant" stays true of a tenant that now has a new table.
10. An integration test against a real PostgreSQL reproduces the attack from Context — organization B creates a form pointing at organization A's key — and it was **written first, run against the unfixed code, and seen to fail**. Record that observation.

## Out of scope

- **Anything about how orphaned bytes are found.** No bucket-vs-database sweep. Separate backlog row.
- **Rate limiting `POST /api/upload`.** It is authenticated; the global fallback limiter is its own P1 row.
- **`services/pdf-url.ts`'s signing scheme, TTL or URL shape.** Not touched. Per-document revocation is a separate row.
- **`storage:migrate` and `scripts/migrate-existing-forms.ts`.** Neither writes `pdf_url`; the `<key>-backup.pdf` siblings are not uploads and get no rows.
- **Any frontend change.** All four call sites that write `pdfUrl` (`useFormManagement.ts:145`, `:237`, `:287`, `FormSavePanel.vue:384`) already take the value straight from an upload response, so a correct client is unaffected. **If a frontend change turns out to be needed, that is a finding — stop and say so**, because it would mean a legitimate flow sets a `pdfUrl` the user did not upload.
- **The editor's abandoned-document trail** (`persistEditedDocument` leaving the previous key behind). Its own P3 row, and this feature makes it no worse.
- **`/api/v1`.** It exposes no `pdfUrl` at all — verified in `backend/src/routes/v1/` — so the contract does not move.

## Execution prompt

> Read first, in this order: `backend/src/services/pdf-url.ts` in full (it is the one parser and it explains why); `backend/src/services/pdf-gc.ts` in full (its module comment is the argument you must not undo); `backend/src/routes/upload.ts`; `backend/src/routes/forms.ts:1-230` and `:265-350`; `backend/src/middleware/membership.ts` for `requireOrganizationId`; the `Form` model in `backend/prisma/schema.prisma` for the provenance-versus-ownership comment you are about to mirror. Then read the Context and *Why the obvious approach is wrong* sections above — every claim in them names a file and a line, and they are checkable.
>
> **Step 0 — the failing test, before any fix.** Add `backend/tests/integration/upload-ownership.spec.ts`, following the shape of `backend/tests/integration/tenancy.spec.ts` and using `createUser` / `createForm` from `backend/tests/integration/helpers.ts`. It must assert the real attack: user A uploads a PDF and publishes a form on it; user B, in a different organization, reads the public form, takes the filename out of the returned `pdfUrl`, and creates their own form with it. Today that succeeds and `GET /api/forms` mints B a valid signed URL for A's document. Add the second half too: A deletes their form, and the bytes survive because B's row still references the key. **Run it against the unfixed code and record both failures** — a test written after the fix proves nothing about whether it catches the bug (hard rule 8, and `docs/sot/09-quality-and-testing.md`).
>
> **Step 1 — the schema.** Use the `prisma-schema-migration` skill. Add the `Upload` model per Goal 1, with `key` `@unique` and `@@index([organizationId])`. Document on the model, in the style of the surrounding models, that `organizationId` is the authorization input and `uploadedByUserId` is provenance that no check reads. Add the back-relations to `Organization` and `User`. Generate the migration with `migrate dev`, never by hand, and put the backfill from Step 2 in the same migration.
>
> **Step 2 — the backfill.** In the migration SQL: one row per distinct key in `forms.pdf_url`, organization taken from the oldest referencing form, `uploaded_by_user_id` null, `size` and `original_name` null. Extract the key in SQL the same way `pdfFilenameFrom` does — last path segment, matching `^[A-Za-z0-9_-]+\.pdf$` — and skip anything that does not match rather than inserting a row for it. **Before writing it, run the multi-organization query and report the number**: how many distinct keys are referenced by forms in more than one organization. That number is a finding either way; if it is not zero, say which keys and stop to decide, because it means the defect has already fired on real data.
>
> **Step 3 — record the upload.** In `backend/src/routes/upload.ts`, resolve `const organizationId = await requireOrganizationId(req)` and create the `Upload` row after `pdfStorage().put(filename, pdfBuffer)` returns. Order matters and say why in a comment: a row with no bytes is a key the customer can point a form at that 404s on read, and a row written first then a failed `put` leaves exactly that. Bytes first, row second — note that this is the **opposite** order from deletion in `pdf-gc.ts`, and for the same reason: in both cases it is the arrangement whose failure is the reversible one.
>
> **Step 4 — the check.** Add one function to `backend/src/services/pdf-url.ts`'s neighbourhood — a new `backend/src/services/uploads.ts` is the better home, since `pdf-url.ts` is deliberately pure and knows nothing about the database. Something of the shape `assertUploadBelongsTo(organizationId, pdfUrl): Promise<string>`, returning the canonical URL or throwing `AppError(400, …)`. Call it from `POST /api/forms` and `PATCH /api/forms/:id` in `backend/src/routes/forms.ts`, replacing the bare `canonicalPdfUrl` calls at `:117` and `:213`. Follow the `backend-endpoint-pattern` skill. **One message for every rejection**, per *Why the obvious approach is wrong*.
>
> **Step 5 — close the loop in the collector.** In `collectOrphanDocuments` (`backend/src/services/pdf-gc.ts`), delete the `Upload` row for the key inside the existing `try`, after `storage.remove(key)` succeeds. Do not touch `stillReferenced`, and do not touch the module comment's argument — extend it with one sentence saying that same-organization aliasing is why the question is still the right one after 0039.
>
> **Step 6 — the export.** Add the organization's uploads to `backend/src/services/organization-export.ts`, in the streaming style already there. Key, size, original name, created-at, and the uploader's id. No bytes — that stays the *uploaded PDFs are not in the data export* backlog row.
>
> **Step 7 — the rest of the tests.** Make Step 0's spec pass. Add to it: an upload is reusable by two forms in its own organization; a member can build a form on a colleague's upload (the case a user-scoped check would break — this one is the reason the check is organization-scoped, so it must exist); a malformed `pdfUrl` now `400`s on both `POST` and `PATCH` rather than being dropped; a caller with no membership cannot upload. Update `backend/tests/forms.spec.ts` and any mocked-Prisma spec that creates a form with a `pdfUrl`. Use the `test-author` agent if it helps, but the Step 0 test is yours and must exist before the fix.
>
> **Do not touch**: `stillReferenced`; the signing scheme, TTL or URL shape in `pdf-url.ts`; any frontend file (and if you believe you must, stop — see *Out of scope*); `/api/v1`; `scripts/migrate-existing-forms.ts`; `storage:migrate`.
>
> **Verify**, and report the real output of each — if something fails, that is the finding, not a detail to smooth over: `npm run check:node`, `npm run test:backend`, `npm run test:frontend`, `npm run test:integration`, `npm run test:e2e`, `npm run build --workspace=frontend`, `cd backend && npx tsc --noEmit`, `cd backend && npm run typecheck:tests`, `npm run audit:prod`. Also state, separately: the multi-organization key count from Step 2, and the observed failure of Step 0's test against the unfixed code.
>
> Run the `saas-readiness-reviewer` agent on the branch before the PR — this change is a tenancy boundary and a migration touching customer data, which is exactly its subject.
>
> **On the way out**: run the `sot-sync` skill and the `api-contract-guard` skill. Update [03-domain-model](../docs/sot/03-domain-model.md) with `Upload` and its place in the cascade map — including that deleting an organization takes its uploads, and that deleting a *form* does not. Update [07-security](../docs/sot/07-security-and-privacy.md): the `Form.pdfUrl` row moves from open to closed, and the finding in Context — that the share link hands out the filename — belongs in the record rather than only here. Update [06-api-reference](../docs/sot/06-api-reference.md) for the new `400` on both form-write endpoints and for the export's new array. Note in [04-backend-patterns](../docs/sot/04-backend-patterns.md) that `pdf-url.ts` stays the only parser and `uploads.ts` is the only ownership check. Remove the *`Form.pdfUrl` is an unconstrained client-supplied string* row from `docs/BACKLOG.md`, and correct — do not just delete — its claim that this was obscurity: leave the sharpened reachability in whatever row survives. File anything Step 2 turns up. Set this file to `**Status:** done` with an Outcome section saying what was found in the data, what the backfill did, and what it deliberately left alone.
