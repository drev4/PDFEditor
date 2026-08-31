# API reference

**Canonical contract.** Verified line by line against `backend/src/app.ts` and every file in `backend/src/routes/` on 2026-08-28. It supersedes the archived `docs/archive/API_DOCUMENTATION.md`, which described three field endpoints that never existed.

Base URL: `VITE_API_URL` on the frontend, default `http://localhost:3000/api`.

Nothing gets added to this file without opening the route file first — see the `api-contract-guard` skill.


> **Every route that returns a form returns its `_count`** (`fields` excluding archived, and `responses`). This was not true — only `GET /api/forms` included it — and the share dialog, which reads `_count.responses`, showed 0 for a form with hundreds the moment it was published, because `PATCH /:id/status` returned a form without counts and the client wrote that over the row it had. The shape is defined once as `formCounts` in `backend/src/routes/forms.ts`. Covered by `backend/tests/integration/form-counts.spec.ts`, which needs a real database because `_count` is computed by one.


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
| POST | `/auth/register` | — | `{email, password (min 6), name?}` | `201 {user, token}` + `Set-Cookie: refresh_token` · `400` if the email exists or validation fails · `429` when rate limited |
| POST | `/auth/login` | — | `{email, password}` | `200 {user, token}` + `Set-Cookie: refresh_token` · `401 Invalid credentials` · `429` when rate limited |
| POST | `/auth/refresh` | refresh cookie | — | `200 {token}` + a rotated `Set-Cookie` · `401` · `403` cross-site · `429` when rate limited |
| POST | `/auth/logout` | refresh cookie | — | `204` · `403` cross-site |
| GET | `/auth/me` | Bearer | — | `200 {user}` · `401` · `404` if the user no longer exists |

`token` is the **access token**: a JWT signed with `JWT_SECRET`, payload `{userId}`, lifetime `JWT_ACCESS_TTL` (default **15m**). The **refresh token** is never in a response body — it is only ever a `Set-Cookie` (`httpOnly`, `Secure`, `SameSite=Lax`, `Path=/api/auth`). `user` never includes `passwordHash` — every select is explicit.

**`POST /auth/refresh` returns one `401` for every failure** — unknown token, expired token, replayed token — with the same body. That is deliberate: distinguishing them would turn the endpoint into an oracle for probing whether a captured token was ever valid. A replay additionally revokes the whole token family server-side, so the session ends everywhere ([07-security](./07-security-and-privacy.md#the-session-model)).

**`POST /auth/logout` is not behind `authenticate`.** Logging out has to work when the access token has already expired, which is exactly when a user reaches for it. The cookie is the credential.

Both cookie-authenticated routes carry the CSRF guard and answer `403 {error: "Cross-site request rejected"}` to a cross-site `Origin` or `Sec-Fetch-Site: cross-site`. No other route needs it — see [04-backend-patterns §11](./04-backend-patterns.md).

`/auth/register`, `/auth/login` and `/auth/refresh` are rate limited per IP (`middleware/rateLimit.ts`). Login counts **failed attempts only**, so a person signing in normally cannot exhaust their own budget; the others count every request. See [the 429 response](#the-429-response) and [08-operations](./08-operations.md#configuration) for the limits.

## Organizations — `routes/organizations.ts`

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| GET | `/organizations/entitlements` | Bearer, any member | — | `200 {plan: {key, name, maxPublishedForms, maxResponsesPerMonth, seats}, usage: {publishedForms, responsesThisPeriod, seats}, subscription: {status, currentPeriodEnd, cancelAtPeriodEnd} \| null}` · `404` if the caller is in no organization |
| GET | `/organizations/members` | Bearer, any member | — | `200 {members: [{id, email, name, role, joinedAt}]}` · `404` if the caller is in no organization |
| PATCH | `/organizations/members/:userId` | Bearer, **owner** | `{role}` | `200 {member}` · `400` if it would leave no owner · `403` wrong role · `404` not a member of this organization |
| DELETE | `/organizations/members/:userId` | Bearer, **owner** | — | `204` · `400` if it would leave no owner · `403` · `404` |
| GET | `/organizations/invitations` | Bearer, **owner/admin** | — | `200 {invitations}` — pending only, never a `tokenHash` |
| POST | `/organizations/invitations` | Bearer, **owner/admin** | `{email, role}` | `201 {invitation: {id, email, role, expiresAt, link}}` · `400` already a member · `403` (an `admin` may only invite `member`) |
| DELETE | `/organizations/invitations/:id` | Bearer, **owner/admin** | — | `204` · `404` |
| POST | `/organizations/invitations/accept` | — | `{token, password?, name?}` | `200 {organizationId}` when signed in · `201 {user, token, organizationId}` for a new account · `400` invalid/expired/revoked/used or missing password · `401` the account exists, sign in first · `409` signed in as a different address · `429` |

**`/organizations/entitlements` is readable by any member, not just an owner.** The sidebar plan card and the plan screen are visible to everyone in the organization, and a member who cannot see why publishing was refused has no way to understand the product. It carries no organization id. `null` in any limit means **unlimited** — the same representation the backend catalogue uses, because `Infinity` does not survive JSON and a sentinel like `-1` invites a comparison that accidentally works.

**`subscription` carries no Stripe identifier and no amount** ([`features/0013`](../../features/0013-stripe-subscriptions.md)). `stripeCustomerId`, `stripeSubscriptionId` and `priceId` are credentials for a third-party API and never leave the server; nothing on screen needs them, because every billing action goes through `POST /billing/*`, which resolves the organization from the caller's own membership. No price is in this payload either — the amount lives in Stripe and the customer sees it on Stripe's own pages. `status` is Stripe's own string and is **not** what decides the plan: the server already did that, and `plan.key` is the answer. It is `null` until a subscription actually exists at Stripe, so a row left behind by an abandoned checkout does not put "Manage billing" in front of somebody who never paid.

**`POST /organizations/invitations` does not check the seat limit yet.** `assertCanInvite` exists and is tested, and is deliberately not wired: the design gives Free and Pro one seat each, only Team has more, and Team still cannot be bought — [`features/0013`](../../features/0013-stripe-subscriptions.md) shipped Free ↔ Pro only, because Team is priced per seat and that quantity has to be kept in step with `Membership`. Enforcing it today would still answer `402` to every invitation from every account. See the row in [`docs/BACKLOG.md`](../BACKLOG.md).

## Billing — `routes/billing.ts`

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| POST | `/billing/checkout` | Bearer, **owner** | — | `200 {url}` — a Stripe Checkout URL · `400` the organization already has an active subscription · `403` wrong role · `404` the caller is in no organization · `503` billing is not configured on this server |
| POST | `/billing/portal` | Bearer, **owner** | — | `200 {url}` — a Stripe Customer Portal URL · `403` · `404` no billing account, or the caller is in no organization · `503` |
| POST | `/billing/webhook` | **Stripe signature** over the raw body | Stripe's event JSON | `200 {received: true, processed}` · `400 {error: "Invalid signature"}` · `503` if no `STRIPE_WEBHOOK_SECRET` is set |

**Neither `checkout` nor `portal` takes an organization.** It comes from the caller's membership. A body parameter would be an authorization decision made by the client, and both routes send someone to a page that spends money.

**`checkout` reuses the stored Stripe customer.** Minting a fresh one on a second attempt is how one organization ends up with two Stripe customers and two invoices for one product. The customer id is written before Checkout opens, which is why `Subscription` exists with null subscription columns.

**Coming back from Checkout proves nothing.** `success_url` is `/dashboard/settings?checkout=complete` — a URL anyone can visit, which a customer who closes the tab never visits at all. The plan moves only when the webhook says Stripe took the money. The Settings screen says activation is in progress and re-reads entitlements; it writes nothing.

**Cancelling, resuming, changing the card and reading invoices all happen in Stripe's portal.** This product builds none of those screens, and no card number ever reaches this origin — which is what keeps the PCI surface Stripe's.

**`/billing/webhook` is the only unauthenticated route in this API with no rate limiter**, and the reason is argued in [04-backend-patterns §10a](./04-backend-patterns.md) and [07-security-and-privacy](./07-security-and-privacy.md). It answers `200` to duplicates, to event types it does not handle, and to events naming an organization it cannot resolve — anything else makes Stripe retry forever and eventually disable the endpoint. `processed` in the body says whether anything was written.

**Status drives the plan.** `active`, `trialing` and `past_due` keep the paid plan — Stripe retries a failed payment for days, and cutting a customer off the moment a card expires is premature. Everything else, including statuses this code has never heard of, resolves to free. See `planKeyForStatus` in `services/stripe.ts`.

**`link` is returned exactly once.** The server stores only a SHA-256 of the token and cannot reproduce it, and **nothing emails it** — the inviter copies the link and delivers it themselves. A client that discards this value has created an invitation nobody can accept.

**Every failure of `accept` on the token itself answers `400` with one message**, whether the token is unknown, expired, revoked or already spent. Distinguishing them would make the endpoint an oracle for probing tokens.

**`409` rather than a silent join.** Accepting while signed in as an address other than the one invited is refused and names the invited address. A forwarded link must not put the wrong person inside a customer's organization.

The role rules and the `404` / `403` split are in [07-security-and-privacy](./07-security-and-privacy.md#two-rejections-two-codes).

## Forms — `routes/forms.ts`

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/forms` | Bearer | The caller's forms, with `_count.fields` (live fields only) and `_count.responses` |
| POST | `/forms` | Bearer | `{title, description?, pdfUrl?}`. Generates `shareId` with `nanoid(12)`. **Never refused by a plan limit** — drafting is free |
| GET | `/forms/:id` | Bearer + ownership | Includes ordered **live** `fields` (`deletedAt: null`). **Side effect:** if `pdfUrl` is set and the form has never had a field — archived ones count — it extracts them from the PDF on disk and persists them before responding (`syncFieldsFromPDF`, best-effort) |
| PUT | `/forms/:id` | Bearer + ownership | Partial `{title?, description?, status?, pdfUrl?, settings?}`. **`402`** when `status: 'published'` would exceed the plan's published-form limit |
| PATCH | `/forms/:id/status` | Bearer + ownership | `{status: 'draft' \| 'published' \| 'closed'}`. **`402`** when publishing would exceed the plan's limit |
| DELETE | `/forms/:id` | Bearer + ownership | **Cascades to fields and every response.** Irreversible, no soft delete, no export prompt |
| GET | `/forms/public/:shareId` | — | Published forms only, **live** fields only. Increments `viewCount`. **Never returns `userId`**. Answers `404` — not `402` — when the owning organization has spent the month's responses, so the form is unavailable before anyone fills it in |
| GET | `/forms/:id/responses` | Bearer + ownership | Query `limit`, `offset`. Returns `{responses, fields, pagination: {total, limit, offset}}`. `fields` includes **archived** fields, so an answer to a removed question keeps a labelled column |
| GET | `/forms/:id/responses/export` | Bearer + ownership | CSV download, `Content-Disposition: attachment`, UTF-8 BOM, built by `csv-exporter.ts`. Columns include **archived** fields, under their original label |

Ownership is `verifyFormOwnership` (`middleware/formOwnership.ts`): **404, not 403**, when the form exists but belongs to another user, so the API does not confirm the existence of other people's resources.

**Publishing is metered, creating is not.** The plan limits how many forms are published *at once*, so unpublishing frees a slot immediately, and the form being published is excluded from its own count — re-saving an already-published form is never refused. Both write paths that can set `status` carry the check; see [04-backend-patterns §10](./04-backend-patterns.md).

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
6. The month's allowance is claimed, **inside the transaction that writes the response** — otherwise `403 Form is not accepting responses`, byte-identical to step 2.

Stores `ipAddress` and `userAgent` from the request. Returns `201 {success, responseId, message}`.

**The plan rejection is deliberately indistinguishable from a closed form, and it is never a `402`.** A respondent is not the customer: a `402` would be meaningless to them and would publish the customer's billing state to anyone holding the share link. The claim is an atomic upsert-and-compare on `UsageCounter`, so a rejection rolls back the increment and the response together and two concurrent submissions cannot both pass at the last slot.

`pattern` is author-supplied and executed server-side here, but it is compiled by RE2, which cannot backtrack — execution is linear in input length, and a pattern that will not compile is ignored rather than throwing. A value that already failed `minLength`/`maxLength` is never handed to the regex.

## The 429 response

`POST /auth/login`, `POST /auth/register`, `POST /auth/refresh`, `POST /organizations/invitations/accept` and `POST /responses` answer with `429` once their per-IP limit is exceeded. The body uses the same shape as every other error in this API, which matters because `frontend/src/services/api.ts` parses the body as JSON before it inspects the status:

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

**No form response carries an owner id.** `toApiForm` strips `organizationId` and `createdByUserId` from every form the API returns, authenticated or public. Ownership is decided entirely on the server ([04-backend-patterns §9](./04-backend-patterns.md)); the client is deliberately unaware that organizations exist. A form the caller cannot reach answers `404`, never `403`.

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

`402 Payment Required` means a **plan limit**, and `403` means a **permission failure**. They are never collapsed, so a client can show "upgrade your plan" versus "you do not have access" without parsing a message string. Today `402` is emitted by `PUT /forms/:id` and `PATCH /forms/:id/status` only ([`features/0012`](../../features/0012-plan-catalogue-and-entitlements.md)); it is never sent to an unauthenticated caller. Note that the billing routes emit `403` and never `402`: refusing someone who is not an owner is a permission failure, not a plan limit.

## Not implemented

No public/machine API, no API keys, no outgoing webhooks, no endpoint returning an organization's name, no pagination beyond `/forms/:id/responses`, no bulk response deletion, no account deletion, no data export beyond per-form CSV. The last two are GDPR obligations, tracked in [07-security-and-privacy.md](./07-security-and-privacy.md). Billing exists as of [`features/0013`](../../features/0013-stripe-subscriptions.md), but only Free ↔ Pro: there is no endpoint that buys **Team**, because it is priced per seat.
