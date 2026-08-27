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
| GET | `/forms` | Bearer | The caller's forms, with `_count.fields` and `_count.responses` |
| POST | `/forms` | Bearer | `{title, description?, pdfUrl?}`. Generates `shareId` with `nanoid(12)` |
| GET | `/forms/:id` | Bearer + ownership | Includes ordered `fields`. **Side effect:** if `pdfUrl` is set and there are no fields in the database, it extracts them from the PDF on disk and persists them before responding (`syncFieldsFromPDF`, best-effort) |
| PUT | `/forms/:id` | Bearer + ownership | Partial `{title?, description?, status?, pdfUrl?, settings?}` |
| PATCH | `/forms/:id/status` | Bearer + ownership | `{status: 'draft' \| 'published' \| 'closed'}` |
| DELETE | `/forms/:id` | Bearer + ownership | **Cascades to fields and every response.** Irreversible, no soft delete, no export prompt |
| GET | `/forms/public/:shareId` | — | Published forms only. Increments `viewCount`. **Never returns `userId`** |
| GET | `/forms/:id/responses` | Bearer + ownership | Query `limit`, `offset`. Returns `{responses, pagination: {total, limit, offset}}` |
| GET | `/forms/:id/responses/export` | Bearer + ownership | CSV download, `Content-Disposition: attachment`, UTF-8 BOM, built by `csv-exporter.ts` |

Ownership is `verifyFormOwnership` (`middleware/formOwnership.ts`): **404, not 403**, when the form exists but belongs to another user, so the API does not confirm the existence of other people's resources.

## Fields — `routes/form-fields.ts`

Mounted under `/api/forms`, so every path here is nested under a form. **There is no list endpoint** — fields come embedded in `GET /forms/:id`.

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/forms/:formId/fields` | Bearer + form ownership | Creates one field. Body validated by `createFieldSchema`. The client cannot supply an `id` |
| PUT | `/forms/:formId/fields/:fieldId` | Bearer + field ownership | Partial body (`createFieldSchema.partial()`) |
| DELETE | `/forms/:formId/fields/:fieldId` | Bearer + field ownership | ⚠️ Cascades: deletes every `Answer` given to this field in past responses |
| POST | `/forms/:formId/fields/bulk` | Bearer + form ownership | Body `{fields: CreateFieldData[]}`. ⚠️ **Replaces all fields** (`deleteMany` + `createMany`) and re-embeds the AcroForm in the PDF on disk |

> ⚠️ **Known data-loss defect.** `bulk` is the editor's ordinary save action. Because it deletes every field and `Answer.field` cascades, saving a form that already has responses destroys all previously collected answers. Do not build anything on top of this endpoint's current semantics — it is being redesigned around stable field ids. See [03-domain-model.md](./03-domain-model.md#the-active-defect-bulk-field-save-destroys-collected-answers) and [`features/0001-stable-field-ids-and-safe-bulk-save.md`](../../features/0001-stable-field-ids-and-safe-bulk-save.md).

`CreateFieldData` — identical in `backend` `createFieldSchema` and `frontend/src/services/fields.ts`:

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
