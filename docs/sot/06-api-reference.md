# API reference

**Canonical contract.** Verified line by line against `backend/src/app.ts` and every file in `backend/src/routes/` on 2026-08-28. It supersedes the archived `docs/archive/API_DOCUMENTATION.md`, which described three field endpoints that never existed.

Base URL: `VITE_API_URL` on the frontend, default `http://localhost:3000/api`.

Nothing gets added to this file without opening the route file first — see the `api-contract-guard` skill.

> **Two audiences, and only one of them is a promise** ([`features/0019`](../../features/0019-api-keys-and-read-only-public-api.md)).
>
> - **`/api/v1/**` is the published API.** It is authenticated by an API key, it is what customers integrate against, and its shapes cannot change without breaking somebody. Adding a field is fine; renaming or removing one is a versioned, announced event.
> - **Everything else under `/api/*` is internal.** It exists to serve `frontend/`, it is authenticated by a session, and it may change in any release. This document describes it for *our* benefit, not as a contract. Do not point an integration at it, and do not point the SPA at `/api/v1` "for consistency" — that would make every internal change a public API change.


> **Every route that returns a form returns its `_count`** (`fields` excluding archived, and `responses`). This was not true — only `GET /api/forms` included it — and the share dialog, which reads `_count.responses`, showed 0 for a form with hundreds the moment it was published, because `PATCH /:id/status` returned a form without counts and the client wrote that over the row it had. The shape is defined once as `formCounts` in `backend/src/routes/forms.ts`. Covered by `backend/tests/integration/form-counts.spec.ts`, which needs a real database because `_count` is computed by one.


## Router mounting (`app.ts`)

```
/api/auth       -> authRouter
/api/forms      -> formsRouter
/api/forms      -> formFieldsRouter    (same prefix as formsRouter — field paths are nested)
/api/account    -> accountRouter
/api/upload     -> uploadRouter
/api/responses  -> responsesRouter
/uploads/pdfs/:token/:filename  -> signed PDF download (no auth; the signature IS the capability)
/uploads/*                      -> 404 (the old unauthenticated static mount is gone)
/api/v1         -> v1Router             (published; API key auth — see below)
   /api/v1/webhooks/deliveries          the webhook delivery log
/health         -> liveness compatibility alias: `200 {status: "ok", timestamp}`
/health/live    -> liveness: process is serving HTTP; dependencies are not checked
/health/ready   -> readiness: PostgreSQL and, when configured, Redis plus a registered PDF worker
```

The health routes are public, bounded machine probes. Readiness returns `200 {status: "ready", checks, timestamp}` or `503 {status: "not_ready", checks, timestamp}`. `checks.database.status` is `ok` or `unavailable`; `checks.queue.status` is `disabled`, `ok`, `no_workers` or `unavailable`. An enabled queue also reports worker and job counts, never connection strings or exception text. Liveness deliberately stays green during a dependency outage so the process manager does not turn a recoverable database incident into a restart loop.

## Auth — `routes/auth.ts`

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| GET | `/auth/registration` | — | — | `200 {mode: "open" \| "invite_only"}` |
| POST | `/auth/register` | — | `{email, password (min 6), name?, code?}` | `201 {user, token}` + `Set-Cookie: refresh_token` · `400` if the email exists or validation fails · `403` when registration is invitation-only and `code` is missing or wrong · `429` when rate limited |
| POST | `/auth/login` | — | `{email, password}` | `200 {user, token}` + `Set-Cookie: refresh_token` · `401 Invalid credentials` · `429` when rate limited |
| POST | `/auth/refresh` | refresh cookie | — | `200 {token}` + a rotated `Set-Cookie` · `401` · `403` cross-site · `429` when rate limited |
| POST | `/auth/logout` | refresh cookie | — | `204` · `403` cross-site |
| GET | `/auth/me` | Bearer | — | `200 {user}` · `401` · `404` if the user no longer exists |

`token` is the **access token**: a JWT signed with `JWT_SECRET`, payload `{userId}`, lifetime `JWT_ACCESS_TTL` (default **15m**). The **refresh token** is never in a response body — it is only ever a `Set-Cookie` (`httpOnly`, `Secure`, `SameSite=Lax`, `Path=/api/auth`). `user` never includes `passwordHash` — every select is explicit.

**`POST /auth/refresh` returns one `401` for every failure** — unknown token, expired token, replayed token — with the same body. That is deliberate: distinguishing them would turn the endpoint into an oracle for probing whether a captured token was ever valid. A replay additionally revokes the whole token family server-side, so the session ends everywhere ([07-security](./07-security-and-privacy.md#the-session-model)).

**`POST /auth/logout` is not behind `authenticate`.** Logging out has to work when the access token has already expired, which is exactly when a user reaches for it. The cookie is the credential.

Both cookie-authenticated routes carry the CSRF guard and answer `403 {error: "Cross-site request rejected"}` to a cross-site `Origin` or `Sec-Fetch-Site: cross-site`. No other route needs it — see [04-backend-patterns §11](./04-backend-patterns.md).

**Registration can be closed** ([`features/0033`](../../features/0033-close-public-registration.md)). `REGISTRATION_MODE=invite_only` makes `POST /auth/register` require `code` to equal `REGISTRATION_CODE`, and it answers `403` otherwise. Four things a consumer needs to know:

- **The refusal comes before the email lookup**, so a closed deployment answers `403` for a registered address and an unregistered one alike. Documented here because it is the opposite of the usual ordering, and deliberate: refusing afterwards would let an unadmitted caller tell the two apart by comparing this `403` against the `400`.
- **A missing `code` and a wrong one are the same response.** Nothing distinguishes them.
- **`403`, not `402`.** `402` means a plan limit everywhere else in this API ([10-saas-roadmap](./10-saas-roadmap.md#entitlements-where-plan-limits-get-checked)); this is the platform refusing, which is not one.
- **`POST /organizations/invitations/accept` is unaffected in every mode.** It also creates accounts, and it must: the person redeeming a single-use, expiring, address-bound token was already admitted by a customer. An integration test asserts this.

`GET /auth/registration` is what the SPA's signup screen reads before it draws, so it can show the code field rather than let a visitor discover the beta from a `403`. It is unauthenticated, carries **no rate limiter** — it reads no database, takes no input and returns one enum — and returns the mode alone: never the code, its length, or whether one is configured.

`/auth/register`, `/auth/login` and `/auth/refresh` are rate limited per IP (`middleware/rateLimit.ts`). Login counts **failed attempts only**, so a person signing in normally cannot exhaust their own budget; the others count every request. See [the 429 response](#the-429-response) and [08-operations](./08-operations.md#configuration) for the limits.

## Organizations — `routes/organizations.ts`

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| GET | `/organizations` | Bearer, any member | — | `200 {organizations: [{id, name, slug, role}], activeOrganizationId}` — the caller's organizations and the one the API is **acting in**. `activeOrganizationId` is the *resolved* one, not the raw column: a choice that no longer names a live membership falls back, and a screen highlighting the raw value would point at an organization the API is not using ([`features/0023`](../../features/0023-active-organization.md)) |
| POST | `/organizations/active` | Bearer, any member | `{organizationId}` | `200 {activeOrganizationId, role}` · **`404`** when the caller has no membership there — not `403`, which would confirm the organization exists. Persists on the account, so it applies to every device and survives a reload |
| GET | `/organizations/responses` | Bearer, any member | — | `200 {responses: [{id, formId, formTitle, submittedAt, answerCount}], pagination: {total, limit, offset}}` — everything the **active** organization has collected, newest first ([`features/0024`](../../features/0024-organization-responses.md)). `?formId=` narrows to one form; another organization's form matches nothing and returns an empty list, never a `404`. `limit` defaults to 20 and caps at 100 |
| GET | `/organizations/entitlements` | Bearer, any member | — | `200 {plan: {key, name, maxPublishedForms, maxResponsesPerMonth, seats, hasApiAccess}, usage: {publishedForms, responsesThisPeriod, seats}, subscription: {status, currentPeriodEnd, cancelAtPeriodEnd} \| null}` · `404` if the caller is in no organization |
| GET | `/organizations/members` | Bearer, any member | — | `200 {members: [{id, email, name, role, joinedAt}]}` · `404` if the caller is in no organization |
| PATCH | `/organizations/members/:userId` | Bearer, **owner** | `{role}` | `200 {member}` · `400` if it would leave no owner · `403` wrong role · `404` not a member of this organization |
| DELETE | `/organizations/members/:userId` | Bearer, **owner** | — | `204` · `400` if it would leave no owner · `403` · `404` |
| GET | `/organizations/invitations` | Bearer, **owner/admin** | — | `200 {invitations}` — pending only, never a `tokenHash` |
| POST | `/organizations/invitations` | Bearer, **owner/admin** | `{email, role}` | `201 {invitation: {id, email, role, expiresAt, link}}` · `400` already a member · `402` no free seat · `403` (an `admin` may only invite `member`) |
| DELETE | `/organizations/invitations/:id` | Bearer, **owner/admin** | — | `204` · `404` |
| POST | `/organizations/invitations/accept` | — | `{token, password?, name?}` | `200 {organizationId}` when signed in · `201 {user, token, organizationId}` for a new account · `400` invalid/expired/revoked/used or missing password · `401` the account exists, sign in first · `409` signed in as a different address · `429` |

**`plan.seats` is the *effective* limit, not always the catalogue's number.** For a per-seat plan it is what the customer actually bought, resolved server-side by `seatLimitFor`; for every other plan it is the catalogue value unchanged. The client is deliberately not told which of the two it received and must not try to work it out — a second copy of that rule in the browser is a rule that can disagree with the one enforcing the limit ([`features/0015`](../../features/0015-team-plan-and-purchased-seats.md)). `usage.seats` is members plus pending invitations.

**`/organizations/responses` deliberately carries no respondent data.** No answer values, no `ipAddress`, no `userAgent` — unlike `GET /forms/:id/responses`, which returns whole `Response` rows and whose screen renders an IP column ([S7 in 07-security-and-privacy](./07-security-and-privacy.md)). The difference is what the two are: one is a customer opening one form they own, the other is a browsing surface over everything the organization has ever collected. Its body is built field by field for that reason, so a column added to `Response` later cannot arrive here by default. **There is no combined CSV** and there should not be: two forms share no fields, so the export lives per form, where the columns exist.

**Which organization a request acts in is decided by `requireMembership`, and by nothing else** ([`features/0023`](../../features/0023-active-organization.md)). Most accounts belong to one organization and never notice. A second appears when somebody who already had an account accepts an invitation — and until 0023 that was ambiguous rather than merely uncommon: `GET /forms` returned **both** organizations' forms merged while `POST /forms` wrote to whichever membership was oldest. Now every authenticated route acts in exactly one, `GET /forms` returns that one's forms, and the switch above is how it changes. **No client sends an organization id on any other endpoint**, and none should: an organization supplied per request is an authorization input in the caller's hands.

**`plan.hasApiAccess` says what the plan includes, and decides nothing** ([`features/0021`](../../features/0021-api-keys-screen.md)). It is on this payload so the API keys screen knows whether to draw a create form at all — a button whose only possible answer is `402` reads as a broken product rather than an enforced rule. `assertHasApiAccess` inside `POST /organizations/api-keys` remains the only enforcer, and every client acting on this flag must still handle the `402`, because the plan can change between a page loading and a button being pressed. Note where it is **not** sent: `GET /forms/public/:shareId` is anonymous and carries nothing about the owner's plan but `showBranding`.

**`/organizations/entitlements` is readable by any member, not just an owner.** The sidebar plan card and the plan screen are visible to everyone in the organization, and a member who cannot see why publishing was refused has no way to understand the product. It carries no organization id. `null` in any limit means **unlimited** — the same representation the backend catalogue uses, because `Infinity` does not survive JSON and a sentinel like `-1` invites a comparison that accidentally works.

**`subscription` carries no Stripe identifier and no amount** ([`features/0013`](../../features/0013-stripe-subscriptions.md)). `stripeCustomerId`, `stripeSubscriptionId` and `priceId` are credentials for a third-party API and never leave the server; nothing on screen needs them, because every billing action goes through `POST /billing/*`, which resolves the organization from the caller's own membership. No price is in this payload either — the amount lives in Stripe and the customer sees it on Stripe's own pages. `status` is Stripe's own string and is **not** what decides the plan: the server already did that, and `plan.key` is the answer. It is `null` until a subscription actually exists at Stripe, so a row left behind by an abandoned checkout does not put "Manage billing" in front of somebody who never paid.

**`POST /organizations/invitations` enforces the seat limit, and answers `402`** ([`features/0015`](../../features/0015-team-plan-and-purchased-seats.md)). Three things about it:

- **`402` is not `403`, and the order matters.** `403` comes first, from `requireRole` and from an admin trying to hand out `owner`; `402` is checked last, after "already a member" too. Re-inviting somebody who is already here must not be refused for money, and a member who may not invite at all must not be told to go and buy seats they cannot buy.
- **Seats count total people, not people beyond the owner.** The organization's own owner is a `Membership`, so Free's one seat means *you, alone* — a Free or Pro account inviting a colleague gets `402`, and that is the product working. Team is the plan that adds people. A pending invitation holds a seat too, or an organization on its limit could hand out any number of working keys.
- **The limit is what was bought.** On Team it is `max(catalogue floor, Subscription.quantity)`, so raising the quantity in Stripe's portal lifts the refusal with no deploy. Lowering it removes nobody — it refuses the next invitation ([04-backend-patterns §10](./04-backend-patterns.md)).

## Account — `routes/account.ts`

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| DELETE | `/account` | Bearer | `{password}` | `200 {message}` + a cleared refresh cookie · `400` no password · `401` wrong password · `409` last owner of an organization that still has members or pending invitations · `502` the payment provider refused to cancel · `404` the user no longer exists |

**The password is re-authentication, not authorization.** The Bearer token proves the session; a borrowed laptop has one. This is the only endpoint in the product that destroys collected responses with no undo, so it asks who is at the keyboard.

**What a success destroys**, in words: the `User` row, cascading its memberships and refresh tokens; every organization where the caller is the **only** member, cascading that organization's forms, fields, responses, answers, usage counters, API keys, webhook endpoints and subscription row; and the stored PDF of every deleted form that no surviving form still references ([03-domain-model](./03-domain-model.md#what-no-cascade-can-reach-the-stored-document)).

**The `409` is the interesting status.** An organization with other people in it is not the account holder's to destroy, and simply deleting the `User` row would strand it with no members. Neither guess is acceptable, so the request is refused and the message names the organizations. It is *not* a `403`: nothing is forbidden about the caller, the account is simply not in a state that can be deleted yet.

**The `502` means nothing was deleted.** Subscriptions are cancelled at Stripe *before* the transaction, because no cascade can reach Stripe; if that call fails the deletion is abandoned with the account and the subscription both intact, which is recoverable by trying again.

There is **no grace period**. The deletion is immediate and complete — see [`features/0029`](../../features/0029-account-deletion-and-real-erasure.md) for why a thirty-day marker would be a claim rather than a feature in a codebase with no scheduler.

## Organization export — `routes/organizations.ts`

| Method | Path | Auth | Response |
|---|---|---|---|
| GET | `/organizations/export` | Bearer, **owner or admin** | `200` a streamed `application/json` attachment · `403` wrong role · `404` not a member · `429` when rate limited |

Everything the **active** organization holds, as one document ([`features/0030`](../../features/0030-account-data-export.md)): the organization, the caller's own user record, members, forms with **all** their fields including archived ones, every response with its answers, `ipAddress` and `userAgent`, and the usage counters. `services/organization-export.ts` is the only module that knows the format, and `version` (currently `1`) is bumped when a reader would notice a change.

**The last key in the document is `"complete": true`, and that is load-bearing.** The response streams, so the status is committed at the first byte: a database failure on page forty cannot become a `500` and would otherwise hand the customer a file that is truncated — or worse, one that still parses and is quietly missing half their responses. The marker is the reader's proof that the writer reached the end. After the first byte the route destroys the socket rather than calling `next(error)`, so a live client sees a broken connection; a saved file is judged by the marker.

**The role check is not a confidentiality boundary and must not be described as one.** A plain member can already assemble the same data by hand through `GET /forms/:id/responses/export`, whose CSV includes the IP column and is open to any member. What owner-or-admin buys is that the whole-tenant artifact is a deliberate act by somebody accountable for it. The inconsistency is filed in [`docs/BACKLOG.md`](../BACKLOG.md).

**Active organization only**, resolved by `requireRole` like every other read. Merging every organization the caller belongs to would put a second tenant's respondent data in this customer's file ([`features/0023`](../../features/0023-active-organization.md)).

Rate limited **per user, not per address** (`RATE_LIMIT_EXPORT_MAX`, default 5 per hour): the route is authenticated, so the address is the wrong identity to spend, and two colleagues on one office connection must not share a budget. The uploaded PDFs are **not** in the file — each form carries its canonical `pdfUrl` — which is filed.

## Billing — `routes/billing.ts`

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| POST | `/billing/checkout` | Bearer, **owner** | `{plan?}` — `pro` (default) or `team` | `200 {url}` — a Stripe Checkout URL · `400` the organization already has an active subscription, or `plan` is not one this API sells · `403` wrong role · `404` the caller is in no organization · `503` billing is not configured, or this deployment has no price for that plan |
| POST | `/billing/portal` | Bearer, **owner** | — | `200 {url}` — a Stripe Customer Portal URL · `403` · `404` no billing account, or the caller is in no organization · `503` |
| POST | `/billing/webhook` | **Stripe signature** over the raw body | Stripe's event JSON | `200 {received: true, processed}` · `400 {error: "Invalid signature"}` · `503` if no `STRIPE_WEBHOOK_SECRET` is set |

**`plan` is which product to buy, not who is buying it** ([`features/0015`](../../features/0015-team-plan-and-purchased-seats.md)). `free` is refused — it is what an organization falls back to, never something sold — and an unset `STRIPE_PRICE_TEAM` means Team is simply not for sale on this deployment, which is a `503` and leaves Pro untouched. **No seat quantity is accepted.** A Team session opens at the plan's floor with `adjustable_quantity`, so the buyer sets the real number on Stripe's page; after that, seats change in the portal and the webhook is how this application finds out. An open session for a *different* plan is expired rather than handed back — reusing it would send somebody who chose Team to a page that charges them for Pro.

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
| GET | `/forms/public/:shareId` | — | `200 {form, showBranding}`. Published forms only, **live** fields only. Increments `viewCount`. **Never returns `userId`**, and carries nothing about the owner's plan except `showBranding` — see below. Answers `404` — not `402` — when the owning organization has spent the month's responses, so the form is unavailable before anyone fills it in |
| GET | `/forms/:id/responses` | Bearer + ownership | Query `limit`, `offset`. Returns `{responses, fields, pagination: {total, limit, offset}}`. `fields` includes **archived** fields, so an answer to a removed question keeps a labelled column |
| GET | `/forms/:id/responses/export` | Bearer + ownership | CSV download, `Content-Disposition: attachment`, UTF-8 BOM, built by `csv-exporter.ts`. Columns include **archived** fields, under their original label |

Ownership is `verifyFormOwnership` (`middleware/formOwnership.ts`): **404, not 403**, when the form exists but belongs to another user, so the API does not confirm the existence of other people's resources.

**Publishing is metered, creating is not.** The plan limits how many forms are published *at once*, so unpublishing frees a slot immediately, and the form being published is excluded from its own count — re-saving an already-published form is never refused. Both write paths that can set `status` carry the check; see [04-backend-patterns §10](./04-backend-patterns.md).

### The public form payload, and what a respondent is told

`GET /forms/public/:shareId` returns `{ form, showBranding, collectsMetadata }`. Both booleans are derived on the server and both are deliberately single values rather than objects.

`collectsMetadata` ([`features/0032`](../../features/0032-respondent-notice-and-ip-collection.md)) says whether **this respondent's** IP address and user agent will be stored with their submission, and the public form renders its privacy notice from it — mentioning an address only when it is true. It sits beside `showBranding` rather than being read off the form object, which does carry the column through `toApiForm`'s spread: the notice is a contract of its own, so the column can be renamed without silently changing what a stranger is told.

It is safe under the rule `showBranding` established and worth checking against it rather than assuming: it says nothing about the owner's plan, limits, usage or identity. It says what happens to the person reading it. `backend/tests/integration/respondent-metadata.spec.ts` asserts both halves.

The client treats the two flags' absence in **opposite** directions, and that is deliberate: a missing `showBranding` keeps the mark (under-claiming a paid entitlement gives it away), while a missing `collectsMetadata` claims nothing is stored (a privacy notice that over-claims is the worse failure).

The form endpoints accept and return `collectsRespondentMetadata` as an explicit field — never a key inside `settings`, which is `z.record(z.unknown())` and validated in no way.

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

### `POST /forms/fields/check-pattern`

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| POST | `/forms/fields/check-pattern` | Bearer | `{pattern}` | `200 {ok: true}` · `200 {ok: false, reason}` · `400` if the body is malformed |

Whether a pattern may be **stored**, asked before anything is saved ([`features/0036`](../../features/0036-pattern-authoring-with-a-slowness-warning.md)). It calls `checkPattern` and touches no database, no form and no field, so it carries `authenticate` and no ownership middleware.

Four things about it:

- **`200` for a rejected pattern.** "This may not be stored" is the answer to the question, not a failure to answer it; a `400` there would be indistinguishable from a malformed request. `400` is reserved for a body without a `pattern`.
- **`reason` is RE2's own message**, which names the construct (`invalid perl operator: (?=`) — that is what an author needs, and it is why the message is passed through rather than replaced.
- **It exists because the alternative is worse than it sounds.** `pattern` is validated inside `createFieldSchema`, so an invalid one fails the **whole** bulk save and takes every other unsaved edit on the form with it — and a pattern is invalid for most of the time somebody is typing one.
- **It cannot tell you a pattern is fast enough.** RE2 is linear, so `^(a+)+$` is perfectly acceptable to it and catastrophic in a browser. That half is the SPA's, via `services/pattern-check.ts` ([07-security](./07-security-and-privacy.md)).

It is declared **above** the `/:formId` routes in `routes/form-fields.ts`, because both that router and `formsRouter` mount on `/api/forms` and a static path under a family of parameterised ones is where shadowing happens. `backend/tests/fields.spec.ts` asserts it is still reached.

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

## The published API — `routes/v1/`

**The only part of this document that is a contract.** Authenticated by an API key, never by a session token; a session token here answers `401`, and an API key on any other route answers `401` too.

```
Authorization: Bearer vpk_<prefix>_<secret>
```

Keys are minted from the internal API (below), belong to an **organization** rather than to a person, and are read from the database on every request — so revoking one takes effect on the next call.

| Endpoint | Answers |
|---|---|
| `GET /api/v1/forms` | `{ data: Form[], pagination }` — the calling organization's forms, newest first |
| `GET /api/v1/forms/:id` | One form plus its live `fields`; `404` if it belongs to anybody else |
| `GET /api/v1/forms/:id/responses` | `{ data: Response[], pagination }`, answers keyed by **field name** |
| `GET /api/v1/forms/:id/responses.csv` | The same export the SPA downloads, unpaginated |

`Form` is `{ id, title, description, status, shareId, createdAt, updatedAt }` and `Field` is `{ id, name, label, type, required, order, options?, archived }`. **Field ids are stable across saves** ([`features/0001`](../../features/0001-stable-field-ids-and-safe-bulk-save.md)), which is what makes them safe for an integration to store. `archived: true` means the question is no longer asked but its past answers remain.

Deliberately absent from every response: `organizationId`, `createdByUserId`, `planKey`, and anything else about the tenant or its billing. Bodies are built explicitly rather than serialised from Prisma rows, so adding a column never publishes it by accident.

**Pagination** is `?limit=` (default 20, maximum 100) and `?offset=`, and every list answers `{ data, pagination: { total, limit, offset } }`.

**Rate limit: 120 requests per minute per key** (`RATE_LIMIT_API_MAX` / `RATE_LIMIT_API_WINDOW_MS`). It counts **per API key**, not per IP address — an integration calling from one server is one caller, and two customers behind the same address do not share a budget. A request with no valid key is limited by address instead, so not authenticating is not a way around it. Over the limit is a `429` in the shape described under *The 429 response* above.

**Errors** use the same `{ error }` shape as the rest of the API. `401` covers every authentication failure — missing, malformed, unknown, revoked — without distinguishing them. `402` is different and is not an authentication failure: the key is valid and the caller is who they say they are, but the organization's plan no longer includes API access. **It is checked on every request, not only when the key was minted**, so a downgrade stops the integration at the next call rather than whenever somebody remembers to revoke the key. `404` covers both "no such form" and "not yours", deliberately: a `403` would confirm that an id exists.

**Read-only, for now.** There are no write endpoints and no webhooks; both are tracked in [`docs/BACKLOG.md`](../BACKLOG.md).

## API keys — `routes/organizations.ts`

Managed from the **internal** API, with a session, because a credential that could mint more credentials would turn one leaked key into permanent access. Owner or admin only.

| Endpoint | Answers |
|---|---|
| `GET /api/organizations/api-keys` | `{ apiKeys: [{ id, name, prefix, lastUsedAt, revokedAt, createdAt }] }` — never a secret, never a hash |
| `POST /api/organizations/api-keys` | `201 { apiKey: { id, name, prefix, secret, createdAt } }`. **`secret` appears here and nowhere else, ever.** `402` when the plan has no API access, `403` when the caller is not an owner or admin |
| `DELETE /api/organizations/api-keys/:id` | Revokes. `404` for a key belonging to another organization. Works even when the plan has since lost API access — turning a credential off is never gated |

`402` and `403` are never collapsed: `403` is a permission failure, `402` is a plan limit ([`features/0012`](../../features/0012-plan-catalogue-and-entitlements.md)). `Plan.hasApiAccess` is true only on **Team**, so a Free or Pro organization gets the `402`.

## Webhooks — `routes/organizations.ts` and `services/webhook-queue.ts`

**Configured with a session** (owner or admin), for the same reason API keys are: a credential that could add a new place for customer data to be sent would turn one leaked key into an exfiltration channel.

| Endpoint | Answers |
|---|---|
| `GET /api/organizations/webhooks` | `{ webhooks: [{ id, url, events, disabledAt, lastError, consecutiveFailures, createdAt }], deliverable }` — `deliverable` says whether this deployment can actually deliver |
| `POST /api/organizations/webhooks` | `201 { webhook: { …, secret } }`. **`secret` appears here and nowhere else.** `400` for a URL that is not `https`, carries credentials, or resolves inside; `402` when the plan has no API access; `403` for a member; **`503`** when the deployment has no `REDIS_URL` or no `WEBHOOK_SIGNING_KEY` |
| `PATCH /api/organizations/webhooks/:id` | Re-enables a disabled endpoint: clears `disabledAt`, `consecutiveFailures` and `lastError`, and **nothing else** ([`features/0022`](../../features/0022-webhooks-screen.md)). **Takes no body** — a `url` or `events` in one is ignored, because re-pointing an endpoint under an existing secret is a different feature. Keeps the id and the secret, which delete-and-recreate does not. Re-runs `assertDeliverableUrl` on the **stored** URL first, so an endpoint whose hostname now resolves inside the network is a `400` and stays disabled. `503` without the queue or signing key and `402` without the plan — unlike `DELETE`, this turns delivery *on*. `403` for a member, `404` across tenants |
| `GET /api/organizations/webhooks/:id/deliveries` | The same log as the v1 reader, for a person instead of an integration ([`features/0022`](../../features/0022-webhooks-screen.md)): `{ deliveries: [{ id, eventId, eventType, attempt, status, durationMs, succeeded, error, createdAt }] }`, newest first, `?limit=` capped at 200. **Internal, not a contract.** No plan check and no queue check — history is readable on a deployment that can no longer deliver, which is exactly when it is read. `403` for a member, `404` across tenants |
| `DELETE /api/organizations/webhooks/:id` | Deletes it and its delivery history. Works when the deployment can no longer deliver and after a downgrade — turning delivery off is never gated |
| `GET /api/v1/webhooks/deliveries` | The delivery log, read with an API key: `{ data: [{ id, endpointId, eventId, eventType, attempt, status, durationMs, succeeded, error, createdAt }], pagination }` |

**Why the delivery log is readable two ways, and why that is not duplication.** `GET /api/v1/webhooks/deliveries` answers an integration asking *did you send me everything?* and is authenticated by an API key; `GET /api/organizations/webhooks/:id/deliveries` answers a person looking at a screen asking *is my endpoint working?*. Requiring the second one to mint an API key would be absurd, and putting the screen's reader on `/api/v1` would freeze its shape into a published contract. Same columns, same absence of a payload body, different audiences and different guarantees.

**The event.** One type exists, `response.created`, sent when a public submission is accepted:

```json
{
  "id": "<event id>",
  "type": "response.created",
  "createdAt": "2026-09-01T12:00:00.000Z",
  "data": {
    "form": { "id": "…", "title": "…", "shareId": "…" },
    "response": { "id": "…", "submittedAt": "…", "answers": { "<field name>": "value" } }
  }
}
```

Answers are keyed by **field name**, as they are in `GET /api/v1/forms/:id/responses`.

**Verifying the signature.** Each request carries:

```
X-VuePDF-Signature: t=<unix seconds>,v1=<hex hmac-sha256>
X-VuePDF-Event-Id:  <stable across every retry>
X-VuePDF-Event-Type: response.created
```

`v1` is `HMAC-SHA256(secret, "<t>.<raw request body>")`. **Verify against the raw body**, before any JSON parsing — a re-serialised object is not the bytes that were signed, and that is the single most common way a receiver ends up rejecting valid deliveries. Reject a `t` older than a few minutes: the timestamp is inside the signed material, so a captured payload cannot be replayed with a fresh one.

**Delivery is at-least-once and unordered.** Retries mean the same event id arrives more than once; deduplicate on `X-VuePDF-Event-Id`. A 2xx is success and everything else — including a 3xx, because redirects are not followed — is a failure that will be retried with exponential backoff. After ten consecutive failures the endpoint is **disabled**, and `disabledAt` and `lastError` on the endpoint are the only way its owner learns that: this product has no email.

**What is deliberately absent.** No payload bodies in the delivery log (they would be a second copy of respondent answers, outliving the form). No replay endpoint. No event types other than `response.created`. No customer-facing screen — endpoints are configured through this API only ([`docs/BACKLOG.md`](../BACKLOG.md)).

## `X-Request-Id`, on every response

Every response carries `X-Request-Id`, set by `middleware/requestLog.ts` ([`features/0034`](../../features/0034-error-tracking-on-api-and-spa.md)). It is the id every log line for that request was written under, so a client that reports a failure can name the request and the server log for it can be found.

Four things about it:

- **It is always the id this API generated**, never the inbound `x-request-id`. That value is the caller's, is treated as untrusted, and is only ever *recorded* as `upstreamRequestId` on the completion line ([08-operations](./08-operations.md#observability)). Echoing it back would reflect an attacker-chosen string and make the header useless as a key.
- **It is set before the `/health` early return**, so a health check is traceable too even though it is not logged.
- **`app.ts` names it in the CORS `exposedHeaders`.** The SPA is a different origin, and without that a cross-origin response exposes only a handful of headers to script — the header would be on the wire, visible in devtools, and unreadable by `fetch`.
- `frontend/src/services/api.ts` reads it and puts it on `ApiError.requestId`, which is what lets a browser-side error report be joined to the server line that explains it.

## Error format — `middleware/errorHandler.ts`

```
400  { error: "Validation error", details: [...] }   ZodError, or an explicit safeParse failure
401  { error: "..." }                                 AppError
403  { error: "..." }                                 AppError
404  { error: "..." }                                 AppError
500  { error: "Internal server error" }               never leaks the underlying message
```

**`GET /forms/public/:shareId` returns `showBranding: boolean`** ([`features/0014`](../../features/0014-close-the-subscription-surface.md)) — whether the public form must carry the "Made with VuePDF" mark, derived from `Plan.hasBranding` on the owner's plan.

**That boolean is the only thing about the owner's plan in that payload, and the constraint is deliberate.** The endpoint is anonymous: anyone holding a share link receives it. Sending the plan, or the entitlements object, and letting the client decide would publish the customer's billing state to every respondent — undoing the reason this same handler answers `404` rather than `402` when the month's responses are spent. There is no plan name, no limit, no usage, no subscription and no organization id, and `backend/tests/integration/branding.spec.ts` asserts their absence rather than only the flag's presence. It does reveal paid-versus-not, which is unavoidable, because the mark is visible either way.

A client that receives no `showBranding` at all must **show** the mark. `frontend/src/services/forms.ts` defaults it to `true` for that reason: the failure mode of guessing the other way is silently giving away the paid tier's only visible benefit.

`402 Payment Required` means a **plan limit**, and `403` means a **permission failure**. They are never collapsed, so a client can show "upgrade your plan" versus "you do not have access" without parsing a message string. Today `402` is emitted by `PUT /forms/:id` and `PATCH /forms/:id/status` (the published-form limit), `POST /organizations/invitations` (the seat limit), and `POST /organizations/api-keys` and the webhook routes (`hasApiAccess`); it is never sent to an unauthenticated caller.

**Every one of those refusals is decided inside the transaction that writes** ([`features/0027`](../../features/0027-atomic-plan-limits.md)), behind a `SELECT … FOR UPDATE` on the organization row. It is not a property a client can observe on one request, and it is stated here because the shape it replaced looked identical from outside: two requests sent at the same instant on the last seat or the last publishing slot both used to receive success, and now exactly one does. Note that the billing routes emit `403` and never `402`: refusing someone who is not an owner is a permission failure, not a plan limit.

## Not implemented

No public/machine API, no API keys, no outgoing webhooks, no endpoint returning an organization's name, no pagination beyond `/forms/:id/responses`, no bulk response deletion, no account deletion, no data export beyond per-form CSV. The last two are GDPR obligations, tracked in [07-security-and-privacy.md](./07-security-and-privacy.md). Billing covers all three plans as of [`features/0015`](../../features/0015-team-plan-and-purchased-seats.md). What is deliberately absent there: no endpoint changes an existing subscription's plan or its seat quantity — both are Stripe's portal, and this application never sends a quantity.
