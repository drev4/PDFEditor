# 0016 — Object storage for uploaded PDFs, behind the signed URL that already exists

**Status:** done
**Priority:** P2 (see [`docs/BACKLOG.md`](../docs/BACKLOG.md) — *Object storage (S3/R2) for PDFs*)
**Branch:** `feature/0016-object-storage-for-uploaded-pdfs`
**Related:** [02-architecture](../docs/sot/02-architecture.md) · [04-backend-patterns §5, §8](../docs/sot/04-backend-patterns.md) · [06-api-reference](../docs/sot/06-api-reference.md) · [07-security-and-privacy](../docs/sot/07-security-and-privacy.md) · [08-operations](../docs/sot/08-operations.md) · [09-quality-and-testing](../docs/sot/09-quality-and-testing.md) · [10-saas-roadmap](../docs/sot/10-saas-roadmap.md) · [`features/0006`](0006-signed-expiring-urls-for-uploaded-pdfs.md)

## Context

Step 9 of the [build order](../docs/sot/10-saas-roadmap.md#build-order) is the first step after billing, and it is the one that stands between this product and a real deployment. [02-architecture §Runtime topology](../docs/sot/02-architecture.md) names the constraint plainly: **PDFs live on the local filesystem of the API process.** `middleware/upload.ts` writes to `process.cwd()/uploads/pdfs`, and five other places read or write that directory by joining the path themselves. The consequences are not theoretical — the API cannot run as more than one replica, and a redeploy onto ephemeral disk loses every PDF every customer has uploaded. Forms keep their rows and lose their documents.

**This spec is object storage only. The job queue is not in it**, and that split needs justifying because the roadmap lists them as one step. [`features/README.md`](README.md) gives the test: *combine when they share one reason to change, or when one cannot be verified without the other; split when they share only a theme.* These share the theme "step 9" and nothing else. They touch different files, they are verified by different tests, and each is independently revertible — if object storage went wrong in production you would not also want the queue backed out. There is also an ordering dependency that makes this one first: the queue's whole payload is `extractFieldsFromPDF` and `embedFieldsInPDF`, and **a worker in another process cannot read a file on the API container's local disk.** Building the queue first would mean building it against storage that is about to be replaced. So: storage now, queue as 0017.

No prior attempt. `git log --oneline --all` has no storage commit and no revert, and `package.json` has no AWS, S3, MinIO or Redis dependency. The nearest relative is [`features/0006`](0006-signed-expiring-urls-for-uploaded-pdfs.md), which replaced `express.static` with the signed URL this feature must preserve — and that is the constraint that shapes everything below.

## Why the obvious approach is wrong

### 1. Swapping `multer.diskStorage` for `multer-s3` does not do it, because six places reach the filesystem directly

The change looks like one file. It is not. `middleware/upload.ts` is only the write; the reads and the *other* write are spread out, and each one builds the path itself:

| Where | What it does |
|---|---|
| `middleware/upload.ts:13` | `multer.diskStorage` writes the upload |
| `routes/upload.ts:18` | reads it straight back to validate and extract |
| `routes/forms.ts:129` (`syncFieldsFromPDF`) | reads, to sync AcroForm fields |
| `routes/form-fields.ts:73` (`embedFieldsInPDF`) | reads **and overwrites in place** |
| `app.ts:122` | `res.sendFile` on the signed route |
| `scripts/migrate-existing-forms.ts:103` | reads, in the `migrate:run` / `migrate:dry-run` maintenance script |

Five of those six do `path.join(process.cwd(), 'uploads', 'pdfs', filename)` by hand. **The sixth is the one that gets forgotten**: it is a script, not a route, so no test and no request path covers it — it simply starts failing with `PDF file not found` the next time somebody runs `npm run migrate:run`, long after this change shipped.

Leaving any one of them on the filesystem produces the worst possible outcome: a deployment where uploads succeed, most reads succeed, and one path silently 404s or serves a stale document depending on which replica answered. **The unit of this change is a storage service every one of those six call sites goes through**, in the same shape as `services/pdf-url.ts` — one audited module, and nothing else touching the bytes ([04-backend-patterns §8](../docs/sot/04-backend-patterns.md)).

### 2. `embedFieldsInPDF` overwrites the stored PDF in place, and that becomes a lost update the moment storage is remote

This is the sharpest thing in the feature and it is easy to miss, because on local disk it looks fine. `embedFieldsInPDF` (`routes/form-fields.ts:66`) reads the PDF, embeds the current fields as an AcroForm, and writes the result back over the same object. It is a read-modify-write of the whole document.

Two bulk saves on the same form, overlapping — two browser tabs, a retry, a slow request — both read the same bytes, both embed their own view of the fields, and both write. The last writer wins and **the other author's fields are gone from the PDF**, with no error anywhere. The window on local disk is milliseconds; over a network round trip to an object store it is hundreds of milliseconds, which turns a theoretical race into one that happens.

Do not fix this by adding a lock and calling it done, and do not treat it as out of scope because "it already existed". The honest options, in order of preference:

1. **Write a new object per embed and update `Form.pdfUrl`** — content-addressed or a new `nanoid`, so a write never destroys the bytes another request is reading. This is the shape object storage wants anyway, it makes the operation atomic at the database rather than at the file, and it is the one that survives concurrency.
2. **Serialise per form**, reusing `services/organization-lock.ts` keyed by form id. Cheaper, and it is a real mitigation — but it is in-process only, and the entire point of this feature is running more than one process. Read `organization-lock.ts`'s own comment on what it does not cover before choosing this.

Option 1 is the recommendation. If option 2 is chosen it must be argued in the Outcome, and the residual race filed in the backlog. **What is not acceptable is porting the in-place overwrite to the object store unchanged**, because it converts a narrow local race into a wide distributed one while appearing to change nothing.

Note also what a new object per embed costs: **every superseded PDF is an object nobody deletes.** See trap 5.

### 3. Do not hand out the provider's presigned URLs — the signed URL stays ours

The intuitive shape is to presign an S3/R2 URL and redirect the browser to it, so the bytes never pass through Node. It is genuinely tempting and it is wrong here for four separate reasons, three of which are things [`features/0006`](0006-signed-expiring-urls-for-uploaded-pdfs.md) deliberately built:

- **It breaks the URL shape three places in the frontend depend on.** `services/pdf-url.ts` documents this: `FormSavePanel.vue` and two others derive a display filename with `url.split('/').pop()`, which is exactly why the signature is a **path segment and not a query string**. A presigned URL is query parameters, and all three would start returning `<file>.pdf?X-Amz-Signature=…`, silently breaking the document-to-form matching in the editor.
- **It loses the response headers, and those headers exist for a reason.** `app.ts:127-157` sets `Content-Security-Policy: default-src 'none'; sandbox`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` and a deliberate `Cross-Origin-Resource-Policy: cross-origin`, all because **the bytes are attacker-supplied** — anybody can upload a PDF. Those headers are what stop a hostile document acting as a document. A bucket does not set them unless every object is uploaded with the right metadata, and getting that wrong is silent.
- **It moves expiry to the provider**, so `UPLOAD_URL_TTL_SECONDS` and `verifyPdfToken` stop being the answer to "who may read this file", and there are two systems to reason about instead of one.
- **It exposes the bucket and account structure** in a URL handed to every anonymous respondent.

So: **keep `GET /uploads/pdfs/:token/:filename` exactly as it is, keep `services/pdf-url.ts` as the only thing that signs or parses a PDF URL, and stream the object from the store behind that route.** The cost is real and must be stated rather than hidden: the bytes flow through the API process, so egress and event-loop time scale with reads. That is an acceptable trade for a 10 MB cap, and the redirect variant can be revisited later if read volume makes it hurt — at which point it needs bucket CORS, per-object headers and a plan for the three `.pop()` call sites. If the executor concludes streaming is untenable, that is a finding for the Outcome, not a decision to take quietly.

### 4. `multer.memoryStorage` is not the answer to "there is no disk"

With the disk gone the obvious replacement is `memoryStorage`, and it buffers the whole upload in RAM: 10 MB per concurrent upload, unbounded by anything except the rate limiter. It is also a change in failure mode — a disk-full error becomes an OOM that takes the process down for every request, not just the upload.

The upload is capped at 10 MB (`middleware/upload.ts:38`) so this is survivable, and `memoryStorage` may well be the pragmatic choice for a first cut. **But it has to be a decision with the number written down**, not a side effect of deleting `diskStorage`. State the worst-case memory (concurrent uploads × 10 MB), and confirm `RATE_LIMIT_*` actually bounds the concurrency it depends on. Streaming multipart straight to the store is the alternative, and it costs the ability to validate the PDF before it lands.

### 5. Deleting a form deletes no file today, and object storage turns that from waste into a bill and a privacy problem

`formsRouter.delete('/:id')` (`routes/forms.ts:274`) deletes the `Form` row and nothing else. **No PDF is ever removed, by anything, anywhere in this codebase** — `grep -rn "unlink" backend/src` finds exactly one call, and it is the invalid-upload cleanup in `routes/upload.ts:24`. Today that is wasted bytes on a disk nobody is measuring. On object storage it is a line item that only ever grows, and — more seriously — it is **customer data retained after the customer deleted it**, which is a GDPR answer this product would rather not have to give.

**Deleting files is deliberately out of scope for this feature**, and hard rule 5 in [`CLAUDE.md`](../CLAUDE.md) is why: writing a delete means answering what customer data it destroys and whether anybody asked for that, and a storage migration is not the change in which to start destroying documents. File it instead. But do not make it worse silently: if trap 2 is solved by writing a new object per embed, say in the backlog row that the orphan count is now *per save* rather than *per form*.

### 6. The test suites must not need a network, and one of them writes a real file

`backend/tests/security-headers.spec.ts:15` writes a fixture into `uploads/pdfs` and fetches it through the signed route; the E2E suite uploads real PDFs through `e2e/helpers.ts:101`. If the storage service can only talk to S3, the entire suite needs credentials and a network, and [09-quality-and-testing](../docs/sot/09-quality-and-testing.md) stops being runnable offline.

So the service takes the shape the rest of this repository already uses for optional infrastructure — the same discipline as the Stripe variables and `DEV_PLAN_KEY`: **a driver chosen by configuration, with the local-filesystem driver as the default.** Unset means the product behaves exactly as it does today. That keeps the suites offline, makes the change deployable in stages, and gives a rollback that is an environment variable rather than a revert.

## Goal

**The storage service**

1. One module — `backend/src/services/pdf-storage.ts` — is the only thing in the backend that reads or writes PDF bytes. `grep -rn "uploads/pdfs\|'uploads'" backend/src` finds it and `services/pdf-url.ts` (which builds URLs, not paths) and nothing else — it currently matches **9 lines across 7 files**, which is the number to drive to zero outside those two. No `path.join(process.cwd(), 'uploads', …)` survives outside it.
2. It exposes at least: put, get (as a stream or buffer), exists, and delete. `delete` is implemented and tested even though no caller deletes on form deletion (trap 5) — `routes/upload.ts`'s invalid-file cleanup already needs it.
3. Two drivers: `local` (current behaviour, the default) and `s3` (S3-compatible, so R2 and MinIO work through the same client). Selected by `PDF_STORAGE_DRIVER`. An unrecognised value **fails to boot** rather than falling back — unlike a plan limit, silently using the wrong storage loses files, so the safe direction here is refusing to start.
4. All six call sites in trap 1 go through it, **including the maintenance script** — which no test will catch, so check it by hand.

**Behaviour that must not change**

5. `GET /uploads/pdfs/:token/:filename` keeps its path shape, its token, its expiry and **every one of its response headers**. `backend/tests/security-headers.spec.ts` passes unmodified against both drivers.
6. `services/pdf-url.ts` is the only module that signs, parses or verifies a PDF URL. `Form.pdfUrl` still stores the unsigned canonical URL, never a signature.
7. `POST /api/upload` returns the same JSON — `{url, filename, size, fields}` — and still validates the PDF before it is kept.
8. With `PDF_STORAGE_DRIVER` unset, the application behaves exactly as it does today, files land in `backend/uploads/pdfs`, and every existing test passes without modification.

**The in-place overwrite**

9. `embedFieldsInPDF` no longer destroys the bytes a concurrent request may be reading — by option 1 of trap 2, or by option 2 with the residual race argued and filed.
10. A test proves it: two overlapping bulk saves on one form, and neither one's fields vanish from the stored PDF. Against a real PostgreSQL, and against the `local` driver at minimum.

**Existing data**

11. Forms uploaded before this change keep working. A `Form.pdfUrl` written by the old code must still resolve — whichever way that is achieved (dual-read, or a documented one-time migration), it is stated and tested, and the "expand, migrate, contract" rule in the `prisma-schema-migration` skill applies even though no schema column changes.

**Operations**

12. `08-operations` documents every new variable, what unset means, and — for the `s3` driver — the bucket configuration this code assumes: private by default, no public read, and who is expected to create it.
13. The `s3` driver is verified against a real S3-compatible endpoint at least once, by hand, and the result recorded in the Outcome. MinIO in `docker-compose.yml` is acceptable and is the cheapest way to do it.

## Out of scope

- **The job queue, and making PDF processing asynchronous.** Step 9's other half, and 0017. This feature must not move `extractFieldsFromPDF` or `embedFieldsInPDF` off the request path — only change where the bytes come from.
- **Redis, and the shared rate-limit store.** Arrives with the queue; its backlog row stays open.
- **Deleting PDFs when a form is deleted.** Trap 5. File it, do not build it.
- **Per-file revocation for signed URLs.** Its own backlog row, unchanged by this.
- **An uploads table** ([03-domain-model](../docs/sot/03-domain-model.md) names it), which would let `Form.pdfUrl` be verified against a file the organization actually uploaded. Related, separately revertible, its own row.
- **Changing the 10 MB limit, the PDF validation, or the AcroForm extraction logic.** Different bytes, same behaviour.
- **A CDN in front of the bucket.**

## Execution prompt

> Move uploaded PDFs off the API's local disk and behind a storage service, **without changing the signed URL, its headers, or anything the frontend can observe**. Read this whole spec first. Trap 2 is the one that silently loses customer work, and trap 3 is the one that undoes a shipped security feature by accident.
>
> **Read first.**
>
> - [`features/0006`](0006-signed-expiring-urls-for-uploaded-pdfs.md) and `backend/src/services/pdf-url.ts` — why the signature is a path segment, and why that module is the only thing allowed to build a PDF URL.
> - `backend/src/app.ts:96-165` — the signed route and every header it sets (lines 127-157), each with a comment saying why.
> - The six call sites in trap 1, all of them, before writing any code.
> - `backend/src/services/organization-lock.ts` — its own comment on what an in-process lock does not cover, which is the argument against trap 2's option 2.
> - `backend/tests/security-headers.spec.ts` — the test that must keep passing untouched.
>
> **Apply the skills:** `backend-endpoint-pattern` (for anything that touches a route), `api-contract-guard` (the upload response shape), then `sot-sync` and `ship-checklist`.
>
> ---
>
> **Step 1 — the service, with the local driver only.** `services/pdf-storage.ts`, both drivers' interface defined, `local` implemented, all six call sites moved onto it. **The whole suite must be green at the end of this step with no test modified** — that is the proof the refactor changed nothing observable. Commit here; it is a clean revert point.
>
> **Step 2 — the overwrite.** Fix `embedFieldsInPDF` per trap 2. **Write the concurrency test first and watch it fail** against the current in-place write: two overlapping bulk saves on one form, then assert both authors' fields are in the stored PDF. If it does not fail first, it is not testing what it says.
>
> **Step 3 — the `s3` driver.** Behind `PDF_STORAGE_DRIVER`, unset meaning `local`. An unknown value refuses to boot.
>
> **Step 4 — existing data.** Decide dual-read or one-time migration, implement it, test that a pre-change `Form.pdfUrl` still resolves.
>
> **Step 5 — verify against a real endpoint.** MinIO in `docker-compose.yml`, or a real R2/S3 bucket. Upload, read through the signed URL, embed fields, read again. Record what happened in the Outcome, including anything the provider did that this spec did not predict.
>
> **Do not** hand out provider presigned URLs, do not change the signed route's path shape or headers, do not move PDF processing off the request path, and do not add a delete on form deletion.
>
> **Verify:**
> ```bash
> npm run test:backend
> npm run test:integration
> npm run test:frontend
> npm run test:e2e
> npm run build --workspace=frontend
> cd backend && npx tsc --noEmit && npm run typecheck:tests
> ```
> Then by hand, with `PDF_STORAGE_DRIVER=s3` against MinIO: upload a PDF in the editor, place fields, save, reload the editor, open the public form as an anonymous visitor, and download the PDF from the forms list. All four read paths, because they are four different call sites.
>
> **Before the PR:** run `saas-readiness-reviewer`. This changes where every customer document lives and touches an unauthenticated public route.
>
> **Documentation exit, required:**
> - [`02-architecture`](../docs/sot/02-architecture.md): the runtime topology diagram and constraint 1 both describe local disk as load-bearing. Constraint 2 (synchronous processing) is still true and stays.
> - [`04-backend-patterns`](../docs/sot/04-backend-patterns.md): a new audited-module rule for PDF bytes, alongside §8's rule for regex and URLs.
> - [`06-api-reference`](../docs/sot/06-api-reference.md): only if the upload response or the signed route changed — it should not have.
> - [`07-security-and-privacy`](../docs/sot/07-security-and-privacy.md): the bytes now leave this origin's disk; say what the bucket must be configured as, and that the headers are still set by this API because it still serves them.
> - [`08-operations`](../docs/sot/08-operations.md): every new variable, what unset means, the bucket configuration, and the rollback (set the driver back to `local` — noting what that does *not* recover).
> - [`09-quality-and-testing`](../docs/sot/09-quality-and-testing.md): that the suites run offline on the `local` driver, and how the `s3` driver is covered.
> - [`10-saas-roadmap`](../docs/sot/10-saas-roadmap.md): step 9 is **half** closed. Say so explicitly and name 0017 as the other half — do not strike the row through.
> - [`docs/BACKLOG.md`](../docs/BACKLOG.md): close the object-storage row. Do **not** close the job-queue row or the Redis row. **Add** the orphaned-files row from trap 5, with its cost and privacy angle.
> - `CLAUDE.md`: the current-state paragraph says nothing about where PDFs live; it should, because it is the first thing a new session needs before touching an upload.
> - This file: `**Status:** done` and an **Outcome** — what shipped, the real test output, the trap-2 decision and why, and everything the object store did that this spec got wrong.

## Outcome

Shipped. PDF bytes go through one module, `PDF_STORAGE_DRIVER` chooses `local` (default) or `s3`, and the signed URL, its path shape and every one of its response headers are unchanged — verified against a live S3 endpoint rather than assumed.

### The count in trap 1 was wrong, and the sixth was the interesting one

The spec said five call sites. It is **six**: `grep -rn "uploads/pdfs\|'uploads'" backend/src` matched 9 lines across 7 files, and the one the first draft missed is `src/scripts/migrate-existing-forms.ts` — the `migrate:run` maintenance script. No test and no request path covers it, so leaving it behind would not have failed anything; it would simply have started throwing `PDF file not found` the next time somebody ran it, long after this shipped. The spec was corrected before implementation started.

That script also writes a backup copy, and its name was `<key>.backup.pdf` — which the storage key guard rejects, because `SAFE_KEY` is `[A-Za-z0-9_-]+\.pdf` and `x.backup` is not. Changed to `-backup.pdf` so there is one key alphabet across `pdf-url.ts`, `pdf-storage.ts` and the script.

### Trap 2: the recommended fix does not work, and the reason is worth keeping

The spec recommended **writing a new object per embed** over serialising, and reading the code changed that. Two problems:

1. **It does not make the PDF converge on the database.** A new object per embed stops a write destroying bytes another request is reading, but the *pointer* still races: two saves each write their own object and each update `Form.pdfUrl`, and the last one to update wins with whatever field set it embedded. The lost update moves from the bytes to the column; it does not go away.
2. It rotates the stored filename on every save, which perturbs `Form.pdfUrl` for something that is not a new document.

What shipped instead is option 2 **plus the part that actually fixes it**, which neither option in the spec named: the embed is serialised per form *and* **re-reads the fields inside that serialisation**. Taking the caller's already-read `savedFields` — which is what a plain lock would do — only moves the race, because whichever request is queued second still embeds what it read before it began waiting. Reading inside the lock is what makes the last writer the best-informed one.

The local driver's `put` also became atomic (temporary file plus rename), so no reader can observe a half-written document. `writeFile` truncates then fills; the object store is already atomic per object, and the local driver should not have been the weaker one.

The **cross-replica** case is not closed and is filed in `docs/BACKLOG.md`. The honest fix is not a bigger lock: the embed is moving to the job queue in step 9's other half, where one in-flight job per form serialises across processes.

### The failing test, and the two times it lied

`tests/integration/pdf-embed-concurrency.spec.ts` was written first and **passed against the unfixed code** on its first run. The delay was on the wrong side of the read: sleeping *before* `get` makes the stalled request read last, so it gets the fresher document and no update is lost. Moving the delay to after the read produced the intended failure — `expected 1 to be 2`, the database holding two fields and the stored PDF one. Then it passed against the fix. The reason is recorded in the file, because the wrong version looks equally plausible.

`tests/pdf-storage.spec.ts` caught a real bug in this feature's own code: `exists` resolved the key inside its `try`, so an unsafe key was swallowed into `false` rather than throwing — which would send a caller down the silent "no PDF, skip the work" path with a name that should have stopped the request. The S3 driver already rethrew non-404s for the same reason; the local one now matches.

### Trap 4 decided: `memoryStorage`, with the number written down

`multer.memoryStorage`, so worst case is 10 MB (the existing `fileSize` cap) × concurrent uploads. `POST /api/upload` is behind `authenticate`, so that concurrency is not an anonymous surface, and a deployment wanting a hard ceiling should bound it at the proxy. The failure mode genuinely changed and is recorded in the file: a full disk used to fail one request, and memory exhaustion takes the process down for everybody.

It also improved the upload path by accident. The old code wrote the file, read it back, validated, and deleted it again when it was not a PDF; now nothing is stored until the bytes are known to be a PDF, so a corrupt or hostile upload leaves nothing to clean up.

### What Windows forced

`rename` is atomic on POSIX and replaces an open file happily. **Windows returns `EPERM` while the destination is open**, so the atomicity test failed on the first run — a real portability defect, not a test artefact: on a developer machine an embed landing while somebody downloads the same PDF would fail outright. `put` now retries the rename on `EPERM`/`EBUSY`/`EACCES` with a short bounded backoff. If the retries are exhausted the error propagates and `embedFieldsInPDF`, which is best-effort by design, logs it and leaves the PDF as it was — the fields are in the database either way.

### One behaviour lost, deliberately

`res.sendFile` advertised `Accept-Ranges` and answered range requests, so pdf.js could fetch a large document in parts. A driver has no local path to hand Express, so the route streams and always sends the whole file. Acceptable at a 10 MB cap; implementing ranges over a driver is a feature, not a detail of this move. Recorded at the call site.

### Verified against a real endpoint

MinIO in `docker-compose.yml` (private `vuepdf-pdfs` bucket, created by a `createbuckets` service so the first run needs no clicking). Nothing requires it — with the container stopped the default driver is unaffected.

Driver level: put, get, getStream, exists, remove, remove-again-is-idempotent, and 404 handling on both `exists` and `getStream`. Then the whole HTTP flow with the app on the `s3` driver — 14 checks, all passing:

- upload returns 201, extracts the AcroForm, and returns the canonical unsigned URL shape
- form create, then the first `GET /api/forms/:id` triggers `syncFieldsFromPDF`, which reads the object
- bulk save embeds, and the stored AcroForm matches the database (`pdf=2 db=2`)
- the signed download returns 200 and the whole document, byte length matching
- **every security header survived**: `sandbox` CSP, `nosniff`, `DENY`, `cross-origin`
- a forged signature still gets 403
- the public form read returns a signed URL to an anonymous caller

Two of those checks failed on the first run and **both were the verification script being wrong, not the product** — confirmed by running the identical flow on the `local` driver and getting identical failures. `syncFieldsFromPDF` runs on the first `GET` of a form, not on create; the script asserted it after create.

`storage:migrate` was exercised for real: a dry run correctly refused to green-light a switch because one referenced file was missing from disk, a real run copied and verified by read-back, and a second run copied nothing.

### Test output

```
npm run test:backend        15 passed (15 files) / 203 passed (203)
npm run test:integration    14 passed (14 files) / 140 passed (140)
npm run test:frontend       38 passed (38 files) / 321 passed (321)
npm run test:e2e            50 passed
npm run build --workspace=frontend      clean
cd backend && npx tsc --noEmit          clean
cd backend && npm run typecheck:tests   clean
```

Step 1's requirement held: **the whole suite passed with no test modified** after the six call sites moved, which is the proof the refactor changed nothing observable. The new tests came afterwards. Backend went 187 → 203 and integration 139 → 140.

`npm audit` reports 15 high findings on the backend workspace both with and without `@aws-sdk/client-s3` — they are pre-existing and this dependency added none.

### Not done, and why

- **The job queue.** Out of scope by design; it is the other half of step 9 and the backlog row now says so.
- **Deleting PDFs on form deletion.** Trap 5, filed rather than built — hard rule 5, and a storage migration is not the change in which to start destroying customer documents. The row now carries the cost and the GDPR angle, and notes the `-backup.pdf` copies that need an answer too.
- **A manual browser pass on the `s3` driver.** The 14-check HTTP flow covers all four read paths through the real routes, but nobody has clicked through the editor with `PDF_STORAGE_DRIVER=s3` set.
