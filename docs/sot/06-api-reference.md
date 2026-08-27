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
/uploads        -> express.static      (raw PDF files, NO authentication)
/health         -> { status, timestamp }
```

## Auth — `routes/auth.ts`

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| POST | `/auth/register` | — | `{email, password (min 6), name?}` | `201 {user, token}` · `400` if the email exists or validation fails |
| POST | `/auth/login` | — | `{email, password}` | `200 {user, token}` · `401 Invalid credentials` |
| GET | `/auth/me` | Bearer | — | `200 {user}` · `401` · `404` if the user no longer exists |

`token` is a JWT signed with `JWT_SECRET`, payload `{userId}`, expiry `JWT_EXPIRES_IN` (default `7d`). `user` never includes `passwordHash` — every select is explicit.

**No rate limiting on login.** See [07-security-and-privacy.md](./07-security-and-privacy.md).

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
| POST | `/forms/:formId/fields` | Bearer + form ownership | Creates one field. Body validated by `createFieldSchema`. The client cannot supply an `id` |
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
| POST | `/responses` | **Public** | Body `{formId (uuid), shareId, answers: Record<fieldId, unknown>}` |

Validation, in order, before anything is persisted:

1. The form exists and its `shareId` matches — otherwise `404`.
2. `status === 'published'` — otherwise `403 Form is not accepting responses`.
3. Every `required` field is present and non-empty — otherwise `400` with the missing field **labels**.
4. Each value matches its field type: `checkbox` must be a boolean; `radio` and `dropdown` must be one of `options`; `text` and `textarea` must be strings satisfying `minLength`, `maxLength` and `pattern` — otherwise `400` keyed by field **name**.
5. Answers whose `fieldId` does not belong to the form are dropped silently, with a `console.warn`.

Stores `ipAddress` and `userAgent` from the request. Returns `201 {success, responseId, message}`.

Two things a caller should know: the `pattern` regex is **author-supplied and executed server-side on this public endpoint** (a ReDoS surface, see [07](./07-security-and-privacy.md)), and this endpoint has **no rate limiting**.

## Upload — `routes/upload.ts`

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/upload` | Bearer | Multipart, field name `pdf`. Multer: 10 MB limit, `application/pdf` mimetype filter, stored to `uploads/pdfs/<nanoid(12)>-<timestamp>.pdf` |

Then: `pdfProcessor.validatePDF` — on failure the file is deleted and the request fails with `400`. Then `extractFieldsFromPDF` — best-effort, a failure is logged and the upload still succeeds with `fields: []`.

Response `201 {url, filename, size, fields}`, where `url` is `${BASE_URL}/uploads/pdfs/<filename>` and is publicly fetchable without a token.

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
