# API reference

**Canonical contract.** Verified line by line against `backend/src/app.ts` and every file in `backend/src/routes/` on 2026-08-28. It supersedes the archived `docs/archive/API_DOCUMENTATION.md`, which described three field endpoints that never existed.

Base URL: `VITE_API_URL` on the frontend, default `http://localhost:3000/api`.

Nothing gets added to this file without opening the route file first — see the `api-contract-guard` skill.

## Router mounting (`app.ts`)

```
/api/auth       -> authRouter
/api/forms      -> formsRouter
/api/forms      -> formFieldsRouter    (same prefix as formsRouter — field paths are nested)
/api/upload     -> uploadRouter
/api/responses  -> responsesRouter
/uploads/pdfs/:token/:filename  -> signed PDF download (no auth; the signature IS the capability)
/uploads/*                      -> 404 (the old unauthenticated static mount is gone)
/health         -> { status, timestamp }
```

## Auth — `routes/auth.ts`

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| POST | `/auth/register` | — | `{email, password (min 6), name?}` | `201 {user, token}` · `400` if the email exists or validation fails · `429` when rate limited |
| POST | `/auth/login` | — | `{email, password}` | `200 {user, token}` · `401 Invalid credentials` · `429` when rate limited |
| GET | `/auth/me` | Bearer | — | `200 {user}` · `401` · `404` if the user no longer exists |

`token` is a JWT signed with `JWT_SECRET`, payload `{userId}`, expiry `JWT_EXPIRES_IN` (default `7d`). `user` never includes `passwordHash` — every select is explicit.

Both `POST` endpoints are rate limited per IP (`middleware/rateLimit.ts`). Login counts **failed attempts only**, so a person signing in normally cannot exhaust their own budget; register counts every request. See [the 429 response](#the-429-response) and [08-operations](./08-operations.md#configuration) for the limits.

## Forms — `routes/forms.ts`

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/forms` | Bearer | The caller's forms, with `_count.fields` (live fields only) and `_count.responses` |
| POST | `/forms` | Bearer | `{title, description?, pdfUrl?}`. Generates `shareId` with `nanoid(12)` |
| GET | `/forms/:id` | Bearer + ownership | Includes ordered **live** `fields` (`deletedAt: null`). **Side effect:** if `pdfUrl` is set and the form has never had a field — archived ones count — it extracts them from the PDF on disk and persists them before responding (`syncFieldsFromPDF`, best-effort) |
| PUT | `/forms/:id` | Bearer + ownership | Partial `{title?, description?, status?, pdfUrl?, settings?}` |
| PATCH | `/forms/:id/status` | Bearer + ownership | `{status: 'draft' \| 'published' \| 'closed'}` |
| DELETE | `/forms/:id` | Bearer + ownership | **Cascades to fields and every response.** Irreversible, no soft delete, no export prompt |
| GET | `/forms/public/:shareId` | — | Published forms only, **live** fields only. Increments `viewCount`. **Never returns `userId`** |
| GET | `/forms/:id/responses` | Bearer + ownership | Query `limit`, `offset`. Returns `{responses, fields, pagination: {total, limit, offset}}`. `fields` includes **archived** fields, so an answer to a removed question keeps a labelled column |
| GET | `/forms/:id/responses/export` | Bearer + ownership | CSV download, `Content-Disposition: attachment`, UTF-8 BOM, built by `csv-exporter.ts`. Columns include **archived** fields, under their original label |

Ownership is `verifyFormOwnership` (`middleware/formOwnership.ts`): **404, not 403**, when the form exists but belongs to another user, so the API does not confirm the existence of other people's resources.

## Fields — `routes/form-fields.ts`

Mounted under `/api/forms`, so every path here is nested under a form. **There is no list endpoint** — fields come embedded in `GET /forms/:id`.

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/forms/:formId/fields` | Bearer + form ownership | Creates one field. Body validated by `createFieldSchema`. The client cannot supply an `id`. `400` if `validation.pattern` is not a usable regex — see below |
| PUT | `/forms/:formId/fields/:fieldId` | Bearer + field ownership | Partial body (`createFieldSchema.partial()`) |
| DELETE | `/forms/:formId/fields/:fieldId` | Bearer + field ownership | ⚠️ Cascades: deletes every `Answer` given to this field in past responses. The bulk save does **not** do this |
| POST | `/forms/:formId/fields/bulk` | Bearer + form ownership | Body `{fields: BulkFieldData[]}`. A **diff**, not a replacement — see below. Re-embeds the AcroForm in the PDF on disk from the resulting live set |

`PUT` and `DELETE` resolve the field through `verifyFieldOwnership`, which only matches live fields: an archived field is `404` to both.

### `POST /forms/:formId/fields/bulk`

The editor's ordinary save. One algorithm for every form — there is deliberately no branch on whether responses exist, because a destructive branch would be the one exercised in development.

Each entry is validated by `bulkFieldSchema` = `createFieldSchema` plus an optional `id: string().uuid()`. This is the **only** endpoint that accepts a client-supplied `id`.

| Entry | Meaning |
|---|---|
| Carries an `id` that is a live field of this form | Update that row; the id is kept |
| Carries no `id` | Create a new field |
| Carries an `id` that is not a live field of this form | **`400`** — the client is confused, and creating instead would duplicate the form |
| Carries an `id` that appears twice in the payload | **`400`** |

Live fields whose id is absent from the payload are removals. A removal with no answers is deleted; a removal that has answers is **archived** (`deletedAt` set) so its answers survive — see [03-domain-model](./03-domain-model.md#the-deletedat-lifecycle).

Updates, creates, deletes and archives all run inside one `prisma.$transaction`, which locks the fields it is about to remove (`SELECT … FOR UPDATE`) before counting their answers — a response submitted mid-save cannot slip between the count and the delete. A failure part-way leaves the previous field set intact. The PDF is re-embedded after the transaction commits.

```ts
// 200
{
  fields: Field[],      // live fields only, ordered by `order`
  archived: string[]    // ids removed in the editor but kept because they hold responses
}
```

The frontend must send back the ids the server gave it. `saveAllFields` in `frontend/src/stores/formFields.store.ts` includes `id` for server ids and omits it for locally-created fields, which it distinguishes by the `field-` prefix it mints them with. Dropping the ids is what made an ordinary save destroy every collected answer.

### `validation.pattern`

Accepted by `POST /fields`, `PUT /fields/:fieldId` and the bulk save, and rejected with `400` when it is unusable. The message names the problem rather than saying "invalid":

```jsonc
// 400
{ "error": "Validation error", "details": [
  { "code": "custom", "message": "Invalid pattern: missing ]: [", "path": [0, "validation", "pattern"] }
]}
```

Three rules, all enforced at write time by `services/pattern-validator.ts`:

| Rule | Example rejection |
|---|---|
| At most 200 characters | `Pattern must be 200 characters or fewer (got 300)` |
| Must be a valid regex | `Invalid pattern: missing ]: [` |
| Must be supported by RE2 — **no lookahead, lookbehind or backreferences** | `Invalid pattern: invalid perl operator: (?=` |

That third rule is the surprising one: `^(?=.*[A-Z]).+$` is a valid JavaScript regex and is refused. RE2 has no lookaround by design — it is what makes execution linear.

`CreateFieldData` — identical in `backend` `createFieldSchema` and `frontend/src/services/fields.ts`; `BulkFieldData` is this plus an optional `id`:

```ts
{
  type: 'text' | 'textarea' | 'checkbox' | 'radio' | 'dropdown',
  name: string,            // 1..255
  label: string,           // 1..255
  required: boolean,       // default false
  position: { x: number, y: number, width: number, height: number, page: number },  // canvas space
  options?: string[],      // radio / dropdown
  validation?: { minLength?: number, maxLength?: number, pattern?: string },
  order: number            // default 0
}
```

## Responses — `routes/responses.ts`

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/responses` | **Public** | Body `{formId (uuid), shareId, answers: Record<fieldId, unknown>}`. Rate limited per IP; `429` when exceeded |

Validation, in order, before anything is persisted:

1. The form exists and its `shareId` matches — otherwise `404`.
2. `status === 'published'` — otherwise `403 Form is not accepting responses`.
3. Every `required` field is present and non-empty — otherwise `400` with the missing field **labels**.
4. Each value matches its field type: `checkbox` must be a boolean; `radio` and `dropdown` must be one of `options`; `text` and `textarea` must be strings satisfying `minLength`, `maxLength` and `pattern` — otherwise `400` keyed by field **name**.
5. Answers whose `fieldId` does not belong to the form are dropped silently, with a `console.warn`.

Stores `ipAddress` and `userAgent` from the request. Returns `201 {success, responseId, message}`.

`pattern` is author-supplied and executed server-side here, but it is compiled by RE2, which cannot backtrack — execution is linear in input length, and a pattern that will not compile is ignored rather than throwing. A value that already failed `minLength`/`maxLength` is never handed to the regex.

## The 429 response

`POST /auth/login`, `POST /auth/register` and `POST /responses` answer with `429` once their per-IP limit is exceeded. The body uses the same shape as every other error in this API, which matters because `frontend/src/services/api.ts` parses the body as JSON before it inspects the status:

```ts
// 429
{ error: 'Too many failed login attempts. Please wait a few minutes and try again.' }
```

Headers: `Retry-After` (seconds), plus the draft-8 `RateLimit` and `RateLimit-Policy` headers. `X-RateLimit-*` legacy headers are **not** sent.

Limits, windows and the `trust proxy` hop count are configuration — [08-operations](./08-operations.md#configuration).

## Upload — `routes/upload.ts`

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/upload` | Bearer | Multipart, field name `pdf`. Multer: 10 MB limit, `application/pdf` mimetype filter, stored to `uploads/pdfs/<nanoid(12)>-<timestamp>.pdf` |

Then: `pdfProcessor.validatePDF` — on failure the file is deleted and the request fails with `400`. Then `extractFieldsFromPDF` — best-effort, a failure is logged and the upload still succeeds with `fields: []`.

Response `201 {url, filename, size, fields}`, where `url` is the **canonical, unsigned** `${BASE_URL}/uploads/pdfs/<filename>`. This is the value to persist as `Form.pdfUrl`, and it is deliberately not a signed URL — a signature stored in that column would stop verifying one TTL later and permanently break the form. It is not fetchable on its own.

## Serving an uploaded PDF — `app.ts`

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/uploads/pdfs/:token/:filename` | — | `token` is `<expiry-unix-seconds>.<hmac-sha256-hex>`, minted by `services/pdf-url.ts` |

Unauthenticated on purpose: an anonymous respondent has to load the PDF of a published form, and the editor's download paths use a bare `fetch` with no `Authorization` header. The capability is the signature, not a session.

- `200` — `application/pdf`, `Content-Disposition: inline`, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, `Cross-Origin-Resource-Policy: cross-origin`, `X-Frame-Options: DENY`, and `Content-Security-Policy: default-src 'none'; object-src 'none'; frame-ancestors 'none'; sandbox`. The CORP value overrides helmet's `same-origin` default because the SPA is a different origin — see [07-security](./07-security-and-privacy.md#where-the-headers-actually-are)
- `403 {error: "This link is invalid or has expired."}` — bad signature, expired token, or a filename outside `/^[A-Za-z0-9_-]+\.pdf$/`. Expired and forged are **deliberately indistinguishable**
- `404 {error: "File not found"}` — signature valid, file absent
- `404 {error: "Not found"}` — anything else under `/uploads`, including every URL of the old unsigned shape

**Every response that carries a form carries a freshly signed `pdfUrl`** — `GET /api/forms`, `GET /api/forms/:id`, `GET /api/forms/public/:shareId`, `POST /api/forms`, `PUT /api/forms/:id`, `PATCH /api/forms/:id/status`. All of them go through one `toApiForm` serializer in `routes/forms.ts`. Conversely `POST /api/forms` and `PUT /api/forms/:id` normalise an incoming `pdfUrl` back to canonical form before writing, so a client echoing back a value it read cannot persist a signature.

TTL is configuration — [08-operations](./08-operations.md#configuration).

## Error format — `middleware/errorHandler.ts`

```
400  { error: "Validation error", details: [...] }   ZodError, or an explicit safeParse failure
401  { error: "..." }                                 AppError
403  { error: "..." }                                 AppError
404  { error: "..." }                                 AppError
500  { error: "Internal server error" }               never leaks the underlying message
```

`402 Payment Required` is reserved for plan-limit rejections and is not yet emitted anywhere — see [10-saas-roadmap.md](./10-saas-roadmap.md).

## Not implemented

No public/machine API, no API keys, no webhooks, no pagination beyond `/forms/:id/responses`, no bulk response deletion, no account deletion, no data export beyond per-form CSV. The last two are GDPR obligations, tracked in [07-security-and-privacy.md](./07-security-and-privacy.md).
