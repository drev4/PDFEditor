# 0006 — Signed, expiring URLs for uploaded PDFs

**Status:** done
**Priority:** P1 (see [`docs/BACKLOG.md`](../docs/BACKLOG.md))
**Branch:** `feature/0006-signed-expiring-urls-for-uploaded-pdfs`
**Related:** [07-security-and-privacy](../docs/sot/07-security-and-privacy.md) (S1) · [04-backend-patterns](../docs/sot/04-backend-patterns.md) · [06-api-reference](../docs/sot/06-api-reference.md) · [08-operations](../docs/sot/08-operations.md)

## Context

`backend/src/app.ts:44` mounts `express.static` on `/uploads`. Every PDF a customer has
ever uploaded is fetchable by anyone who knows its URL — no token, no expiry, no
revocation. The filenames are `nanoid(12)-<timestamp>.pdf` (`backend/src/middleware/upload.ts:20`),
so the only thing protecting them is that the string is hard to guess. Once a URL
escapes — browser history, a forwarded link, a proxy log, a referrer — access can
never be withdrawn. The uploaded file is usually the customer's own confidential
template. This is finding **S1**, the highest-severity open item in
[07-security-and-privacy](../docs/sot/07-security-and-privacy.md).

The two constraints that shape the fix:

**The PDF must be fetchable without a JWT.** `frontend/src/views/PublicFormView.vue:157`
fetches it for an anonymous respondent, so this cannot become an `authenticate`d route.
Worse, `frontend/src/components/forms/FormsList.vue:249` and
`frontend/src/views/FormsManagementView.vue:220` call bare `fetch(form.pdfUrl)` with no
`Authorization` header at all — the token lives in `localStorage` and only
`frontend/src/services/api.ts` ever attaches it. Putting auth on `/uploads` breaks the
editor as well as the public form. A capability in the URL itself is what fits both.

**`Form.pdfUrl` is load-bearing on the server, not just a link.** Three backend call
sites derive a disk path from it by splitting on `/` and taking the last segment:
`syncFieldsFromPDF` (`backend/src/routes/forms.ts:82-85`), `embedFieldsInPDF`
(`backend/src/routes/form-fields.ts:65-71`), and
`backend/src/scripts/migrate-existing-forms.ts:98-100`. Whatever is stored in that
column has to keep yielding the filename.

## Why the obvious approach is wrong

**Do not store the signed URL in `Form.pdfUrl`.** It is the first thing that comes to
mind and it rots within one TTL: the column is written once at upload and read forever
after, so a signed value stored there stops working the moment it expires and the form
is permanently broken. The signature has to be **minted on every read**, and the
database must keep holding the canonical, unsigned URL.

That has a trap on the write side. `e2e/helpers.ts:112-116` takes `url` straight out of
the `POST /api/upload` response and posts it as `pdfUrl` when creating the form, and so
do `frontend/src/composables/useFormManagement.ts:77-88` and `:173`, and
`frontend/src/components/forms/FormSavePanel.vue:350`. So **`POST /api/upload` must keep
returning the canonical unsigned URL** — if it returns a signed one, every one of those
paths persists an expiring string. This is safe to leave as-is precisely because nothing
fetches the upload response's URL: the caller already holds the `File` locally. Signing
belongs on the read paths only. Belt and braces: `PUT /api/forms/:id` must normalise any
incoming `pdfUrl` back to canonical form, so a client that ever round-trips a value it
read cannot poison the column.

**Do not put the signature in a query string.** `?token=…` is the conventional shape and
it silently breaks three frontend sites that derive a filename with `.split('/').pop()`:
`FormSavePanel.vue:184` (matches a form to an open document by filename — a query string
makes the match always fail, so opening a document stops loading its form),
`FormsList.vue:219` and `FormsManagementView.vue:219` (the downloaded `File`'s name).
None of the three has test coverage, so all three fail quietly. Putting the signature in
its own **path segment before the filename** — `/uploads/pdfs/<token>/<file>.pdf` — keeps
`.pop()` returning exactly what it returns today, and those three sites need no change.

**Do not read `JWT_SECRET` at module load** to derive the signing key. `app.ts` throws if
it is missing, but ES module imports are hoisted above that guard, so a module-level
`process.env.JWT_SECRET` read runs first and gets `undefined`. It would also freeze the
key against `vi.stubEnv`, which is how `backend/tests/rate-limit.spec.ts` configures
things (see [09-quality](../docs/sot/09-quality-and-testing.md#testing-something-configured-by-the-environment)).
Derive the key inside each call, the way `middleware/auth.ts:23` reads the secret.

## Goal

1. `GET /uploads/pdfs/<filename>.pdf` — the URL shape that works today — returns **404**.
   `express.static` is gone from `app.ts`.
2. A PDF is served only from `GET /uploads/pdfs/:token/:filename`, where `token` carries
   an expiry and an HMAC over `filename` **and** that expiry.
3. Every API response that carries a `pdfUrl` carries a freshly signed one: `GET /api/forms`,
   `GET /api/forms/:id`, `GET /api/forms/public/:shareId`, `POST /api/forms`,
   `PUT /api/forms/:id`. No route returns an unsigned `/uploads` URL.
4. `POST /api/upload` still returns the canonical **unsigned** URL as `url`, unchanged.
5. The `pdf_url` column, after any create or update, holds the canonical unsigned URL —
   even if the client sent a signed one.
6. A tampered signature, a signature valid for a different filename, and an expired token
   each return **403**. A valid token for a file that is not on disk returns **404**.
   A filename outside `/^[A-Za-z0-9_-]+\.pdf$/` returns **403** without touching the disk.
7. TTL comes from `UPLOAD_URL_TTL_SECONDS` (default **900**), read through
   `backend/src/config/env.ts`'s `envInt`, so a test configures it the way a deploy does.
8. The three server-side filename derivations and the new route all resolve the filename
   through **one** helper. No new `split('/').pop()` at a call site.
9. The full suite is green: `npm run test:backend`, `npm run test:frontend`,
   `npm run test:integration`, `npm run test:e2e`, plus both type checks.

## Out of scope

- **`helmet`, CSP and the rest of the security headers** (S5) — separate backlog row. The
  only exception: this one route sets `X-Content-Type-Options: nosniff` itself, because
  it is one line and it is the route that serves attacker-influenced bytes.
- **Virus scanning uploads** (S6) — separate backlog row.
- **Object storage (S3/R2)** — P2 in the backlog. This change deliberately lands signed
  URLs on local disk first; the helper is where a presigned-S3 implementation later slots
  in, and doing it now is what makes that swap a one-file change.
- **Per-file revocation.** Rotating `JWT_SECRET` invalidates every outstanding link at
  once, and deleting the file works. Revoking one file's links while leaving others valid
  needs a database-backed nonce — file it in the backlog, do not build it.
- **Session hardening** (S4), and anything about `localStorage` or token lifetime.
- **`Response.pdfUrl`** — the column is never written by any code path. Leave it.
- **The `BASE_URL`-in-the-database design.** Storing an absolute URL rather than a storage
  key is a real wart (a changed `BASE_URL` breaks old rows), but fixing it is a schema
  migration and a backfill. Not here.

## Execution prompt

> Read first, in this order: `backend/src/app.ts`, `backend/src/routes/upload.ts`,
> `backend/src/routes/forms.ts`, `backend/src/routes/form-fields.ts` (the
> `embedFieldsInPDF` helper at the top), `backend/src/middleware/rateLimit.ts` (as the
> model for an environment-configured module), `backend/src/config/env.ts`, and
> `docs/sot/04-backend-patterns.md`. Then read the "Why the obvious approach is wrong"
> section above — it names three specific ways this change breaks things quietly.
>
> **Write the failing test first.** Add `backend/tests/pdf-url.spec.ts` following the
> mocked-suite pattern in `docs/sot/09-quality-and-testing.md`. Its first case asserts
> that `GET /uploads/pdfs/<filename>.pdf` does **not** serve the file. Run
> `npm run test:backend` and confirm it fails against the current code — today that URL
> returns 200 with the PDF. Do not start the fix until you have seen it fail.
>
> **Build `backend/src/services/pdf-url.ts`.** One module, the single audited place for
> this, the way `services/pattern-validator.ts` is for regex
> ([04-backend-patterns §8](../docs/sot/04-backend-patterns.md)). It exports:
>
> - `pdfFilenameFrom(url: string | null): string | null` — last path segment; returns
>   `null` unless it matches `/^[A-Za-z0-9_-]+\.pdf$/`. Tolerates an already-signed URL.
> - `canonicalPdfUrl(url: string | null): string | null` — `${BASE_URL}/uploads/pdfs/<filename>`.
> - `signPdfUrl(url: string | null): string | null` — `${BASE_URL}/uploads/pdfs/<exp>.<hmac>/<filename>`,
>   where `exp` is a unix-seconds expiry `UPLOAD_URL_TTL_SECONDS` from now and `hmac` is
>   HMAC-SHA256 over `` `${filename}:${exp}` ``, hex.
> - `verifyPdfToken(token: string, filename: string): 'ok' | 'invalid' | 'expired'` —
>   compare with `crypto.timingSafeEqual` on equal-length buffers, never `===`.
>
> Derive the key **per call** as `createHmac('sha256', process.env.JWT_SECRET!).update('vuepdf:pdf-url:v1').digest()`.
> Per call, not memoised, and not at module load — see the section above for why both
> matter. The `'vuepdf:pdf-url:v1'` domain separator is what stops this key and the JWT
> signing key from being the same key used for two purposes; keep it.
>
> **Replace the static mount in `backend/src/app.ts`.** Delete
> `app.use('/uploads', express.static(...))` and the now-unused `path` import if nothing
> else needs it. Add `app.get('/uploads/pdfs/:token/:filename', …)`:
> reject a filename that fails `pdfFilenameFrom` with `403`; `verifyPdfToken` → `403` on
> both `invalid` and `expired`, with the same body `{ error: 'This link is invalid or has expired.' }`
> (do not distinguish the two — it tells an attacker which half they got right, and the
> client's remedy is identical either way); then `res.sendFile` from
> `path.join(process.cwd(), 'uploads', 'pdfs', filename)` with `Content-Type: application/pdf`,
> `Content-Disposition: inline`, `Cache-Control: private, no-store` and
> `X-Content-Type-Options: nosniff`. A missing file is `404`. Add a catch-all
> `app.use('/uploads', …)` returning `404 { error: 'Not found' }` so the old URL shape
> gets a JSON 404 rather than Express's default HTML.
>
> `no-store` is deliberate: the URL is a bearer capability, and a shared cache holding the
> bytes under it would outlive the expiry the token is there to enforce.
>
> **Sign on the way out, in `backend/src/routes/forms.ts`.** Add one local
> `toApiForm(form)` that returns the form with `pdfUrl: signPdfUrl(form.pdfUrl)`, and put
> **every** `res.json({ form … })` through it: `GET /`, `GET /:id` (both the plain return
> and the one after `syncFieldsFromPDF`), `POST /`, `PUT /:id`, `PATCH /:id/status`, and
> `GET /public/:shareId` (after the existing `userId` strip). Verify you got all of them:
> `grep -n "res.json({ form" backend/src/routes/forms.ts`. A missed one is a PDF that
> 403s in one screen and works in another.
>
> In `PUT /:id` and `POST /`, run an incoming `pdfUrl` through `canonicalPdfUrl` before
> it reaches `prisma.form.update` / `create`. Leave `createFormSchema` / `updateFormSchema`
> as `z.string().optional()`.
>
> **Route the existing filename derivations through the helper**: `syncFieldsFromPDF`
> (`routes/forms.ts:82-85`), `embedFieldsInPDF` (`routes/form-fields.ts:65-71`) and
> `scripts/migrate-existing-forms.ts:98-100` all call `pdfFilenameFrom` instead of
> splitting inline, and bail when it returns `null`. This is consistency and one place to
> change for object storage — do not describe it as a traversal fix, the last-segment
> split already contains traversal by construction.
>
> **Frontend — one change only.** In `frontend/src/components/forms/FormsList.vue`,
> `handleEdit` fetches `form.pdfUrl` off the cached list, which may be many minutes old
> and past the TTL. Re-fetch the form (`formsStore.fetchForm(form.id)`) and use the
> `pdfUrl` from that response before downloading. Do the same in
> `frontend/src/views/FormsManagementView.vue:213-231`. Nothing else in the frontend
> changes: `buildApiUrl` passes an absolute URL through untouched
> (`frontend/src/utils/apiUrl.ts:4`), and the `.split('/').pop()` sites keep working
> because the signature is a path segment, not a query string. **Verify that claim by
> running the app**, not by reasoning about it: open a saved form from the dashboard and
> confirm the PDF renders and the fields load.
>
> **Tests.** All of these go in the mocked backend suite — none of them is about database
> behaviour, so per [09-quality](../docs/sot/09-quality-and-testing.md#backend-database-backed-tests)
> none belongs in `tests/integration/`. Write a temp PDF into `uploads/pdfs/` in
> `beforeAll` and remove it in `afterAll`; `backend/test-fixtures/valid.pdf` is a usable
> source. Set the TTL with `vi.stubEnv('UPLOAD_URL_TTL_SECONDS', …)`, not by reaching into
> the module.
>
> 1. `GET /uploads/pdfs/<filename>.pdf` → 404 (written first, seen to fail).
> 2. A `signPdfUrl` link → 200, `application/pdf`, the right bytes, and the
>    `Cache-Control` / `X-Content-Type-Options` headers.
> 3. Token signed for file A, requested against file B → 403.
> 4. One hex character flipped in the HMAC → 403.
> 5. Expired token → 403 (sign with `UPLOAD_URL_TTL_SECONDS=60`, then advance time with
>    fake timers).
> 6. Valid token, file deleted from disk → 404.
> 7. `../etc/passwd`, `foo.exe`, `foo.pdf.exe` as the filename → 403.
> 8. `GET /api/forms/:id`, `GET /api/forms` and `GET /api/forms/public/:shareId` each
>    return a `pdfUrl` that differs from the stored value and that `verifyPdfToken`
>    accepts.
> 9. `PUT /api/forms/:id` with a **signed** `pdfUrl` in the body → assert the
>    `prisma.form.update` mock was called with the canonical unsigned URL.
>
> **Configuration.** Add `UPLOAD_URL_TTL_SECONDS` to `backend/.env.example` with the
> default and a one-line comment saying what it costs to set it long.
>
> **Do not touch:** `helmet`/CSP, upload virus scanning, `Response.pdfUrl`, the JWT
> lifetime or its storage, the `express.static` mount for anything other than `/uploads`,
> or the `pdf_url` column's type. Do not start an object-storage abstraction — one local
> helper is the deliverable.
>
> **File what you find.** Two things noticed while specifying this, both of which belong
> in `docs/BACKLOG.md` rather than in this branch: (a) `createFormSchema.pdfUrl` is an
> unconstrained client-supplied `z.string()`, so an author can point their own form at
> another author's uploaded filename — unguessable, but obscurity again, and after this
> change the API will happily mint a signed URL for it; the fix is to verify at write time
> that the filename came from an upload this user made, which needs an uploads table.
> (b) Per-file revocation, as described in "Out of scope".
>
> **On the way out:** run the `sot-sync` skill. It must update
> [07-security-and-privacy](../docs/sot/07-security-and-privacy.md) — the S1 row struck
> through as resolved with a link to this file, the trust-boundaries diagram's
> `GET /uploads/pdfs/<file>` line, the "Recommended order of work" item 4, and the data
> inventory's "Local disk, publicly served" row;
> [06-api-reference](../docs/sot/06-api-reference.md) — the router map at line 17 and the
> Upload section at lines 156-164, which currently states the URL "is publicly fetchable
> without a token"; and [08-operations](../docs/sot/08-operations.md) — the configuration
> table gains `UPLOAD_URL_TTL_SECONDS`. Then remove the "Signed, expiring URLs for
> uploaded PDFs" row from `docs/BACKLOG.md`, update the P0 paragraph that currently names
> S1 as next up, and set this file to `**Status:** done`. Run the `ship-checklist` skill
> before opening the PR.
