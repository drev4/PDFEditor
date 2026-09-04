# Domain model

Source of record: `backend/prisma/schema.prisma`. Everything below was read out of that file and the routes that write to it.

## Entities

```
Organization 1───* Membership *───1 User
Organization 1───* Form 1───* Field 1───* Answer *───1 Response *───1 Form
Organization 1───* UsageCounter     (one row per calendar month)
Organization 1───1 Subscription     (the Stripe relationship; at most one)
Organization 1───* Upload           (the PDFs it uploaded; Form.pdfUrl is the pointer)
Organization 1───* ApiKey           (credentials that authenticate the tenant, not a person)
Organization 1───* WebhookEndpoint 1───* WebhookDelivery   (where to call, and what happened)
User 1───* RefreshToken
User *───1 Organization       (activeOrganizationId — which one they are acting in; nullable)
StripeEvent                        (standalone — no relation, deliberately)
User 0───* Form            (createdByUserId — provenance, never ownership)
User 0───* Upload          (uploadedByUserId — provenance, never ownership)
```

**`Organization` owns forms; `User` does not.** A user reaches a form only through a `Membership`. A B2C account is an organization with exactly one member, created at signup — there is no separate "personal account" concept and no second code path ([`features/0009`](../../features/0009-organizations-own-resources.md)).

| Entity | Purpose | Notes that matter |
|---|---|---|
| `User` | An account | `id, email (unique), passwordHash, name?`. Owns nothing directly — reaches forms through `Membership`. |
| `Organization` | The tenant. Owns forms | `id, name, slug (unique)`. Created for every user at signup. `planKey` (default `"free"`) names an entry of the catalogue in `services/plans.ts` — a plain string rather than an enum so that adding a plan needs no migration, and an unknown value resolves **downward** to free ([`features/0012`](../../features/0012-plan-catalogue-and-entitlements.md)). It is **derived and has exactly one writer** since [`features/0013`](../../features/0013-stripe-subscriptions.md): `reconcileSubscription` in `services/stripe.ts`, driven by the Stripe webhook, plus the column default that registration relies on. Every *read* still goes through it — `getEntitlements` and `assertCanPublishForm` were not changed — which is what stops there being two answers to "which plan is this?". |
| `Membership` | Which users may act on which organization's resources | `(organizationId, userId)` unique. `role: owner \| admin \| member`, **enforced** since [`features/0010`](../../features/0010-member-invitations-and-role-enforcement.md) by `requireRole` in `middleware/membership.ts`. An organization is never left without an owner. |
| `Invitation` | A pending offer of membership, redeemable once | Bound to an `email` and a `role`. `tokenHash` is a SHA-256, never the token. `expiresAt` / `revokedAt` / `acceptedAt` are what make it expiring, cancellable and single-use — a JWT was rejected here for the same reason it was in [`0008`](../../features/0008-session-hardening.md): it cannot be revoked. The link is delivered by the inviter, because this service cannot send email. |
| `Form` | A PDF plus its field layout | Belongs to an `Organization` (`organizationId`, required). `createdByUserId` records who made it and is **nullable and never an authorization input** — a deleted user must not take the organization's forms with them. `shareId` (nanoid 12) is the public identifier. `status: draft \| published \| closed`. `settings: Json?` is writable through `PUT /forms/:id` but is never read by any code — a free extension point for per-form configuration (branding, limits, webhooks) that needs no migration. `viewCount` incremented on every public fetch. |
| `Upload` | A PDF this organization uploaded, and the record that makes `Form.pdfUrl` checkable | `key` (unique) is the storage key exactly as `middleware/upload.ts` minted it and `services/pdf-url.ts` parses it back out of a `pdfUrl` — the join between the two stores. `organizationId` is the **only authorization input on this table**; `uploadedByUserId` is provenance, nullable and never read by a check, the same split as `Form.createdByUserId` — a colleague uploads a document and somebody else builds the form on it, which is why the check is scoped to the organization and not the user. `originalName` and `size` are display and accounting only. **It exists because `Form.pdfUrl` had no owner** ([`features/0039`](../../features/0039-uploads-belong-to-an-organization.md)): `canonicalPdfUrl` validated shape alone, and the filename is not a secret — `GET /api/forms/public/:shareId` hands a signed URL containing it to every respondent — so anyone sent a share link could point their own form at another organization's document and be issued fresh signed URLs for ever. **It is not a lifecycle record**: whether the bytes may go is still "does any surviving form reference this key", asked by `services/pdf-gc.ts`. |
| `Field` | One input placed on the PDF | `type: text \| textarea \| checkbox \| radio \| dropdown`. `position: Json` in **canvas** coordinates. `options: Json?` for radio/dropdown. `validation: Json?` = `{minLength?, maxLength?, pattern?}`. `order: Int` drives render and tab order. `deletedAt: DateTime?` — non-null means **archived**: removed from the editor and the public form, still present in the responses table and the CSV export. See [the `deletedAt` lifecycle](#the-deletedat-lifecycle). |
| `Response` | One public submission | Stores `ipAddress` and `userAgent`. No respondent identity beyond that. `pdfUrl?` exists on the model but nothing writes it today. |
| `Answer` | One value in one submission | `value: String` — **everything is a string**, including booleans (`String(value)`). Type meaning is reconstructed at read time. |
| `UsageCounter` | The response meter: one row per organization per calendar month | `(organizationId, period)` unique, `period` is `YYYY-MM` in **UTC**, produced only by `currentPeriod()` in `services/entitlements.ts`. It counts **submissions accepted during the period**, not rows that still exist — see the invariant below. Written only inside the transaction that writes a `Response` ([`features/0012`](../../features/0012-plan-catalogue-and-entitlements.md)). |
| `Subscription` | The organization's relationship with Stripe | `organizationId` unique, so at most one. Holds `stripeCustomerId`, `stripeSubscriptionId?`, `status` (Stripe's own string, stored verbatim — not an enum, because Stripe adds statuses and an unknown one must be storable), `priceId?`, `currentPeriodEnd?`, `cancelAtPeriodEnd`, `quantity?`. **`quantity` is the number of seats paid for, read from the Stripe subscription item and never computed here** ([`features/0015`](../../features/0015-team-plan-and-purchased-seats.md)) — the first plan limit that is bought rather than declared, and the only input to a limit check that does not come from the frozen catalogue. `reconcileSubscription` is its only writer and it writes what the event said; a customer can change the quantity in Stripe's portal without this application being in the request, so anything this code remembered having *asked for* would drift from what was actually paid for. `null` means Stripe reported none, and it resolves to the catalogue floor rather than to unlimited (`seatLimitFor`). The nullable columns are null between the first Checkout attempt and the webhook that confirms it: the customer id has to be stored *before* anything is bought, or a second attempt mints a second Stripe customer and the person is billed twice. **No card data of any kind** — only opaque Stripe identifiers; Checkout and the Portal are hosted by Stripe and no card reaches this origin ([`features/0013`](../../features/0013-stripe-subscriptions.md)). |
| `StripeEvent` | Every Stripe event already processed | `id` **is Stripe's own `evt_…`**, as the primary key. It exists because Stripe delivers **at least once, not exactly once**: a replay collides on insert and is ignored instead of re-running the handler. Deliberately **not** related to `Organization` — an event can arrive for a customer this application cannot resolve, and losing the idempotency record when an organization is deleted would let that event be reprocessed forever. |
| `ApiKey` | A credential that authenticates an **organization**, with no user behind it | `prefix` (unique, indexed) is the public half and `hash` is a SHA-256 of the secret — the same fast-hash decision as `RefreshToken` below, for the same reason, and it is verified on *every* API request, which is why bcrypt (used only on passwords) would be a CPU sink. The secret is returned once, by `POST /api/organizations/api-keys`, and stored nowhere. `createdByUserId` is provenance and nullable, exactly like `Form.createdByUserId`: a key belongs to the organization and must not stop working because an employee left. `revokedAt` rather than a delete, so a customer can still see that a key existed and when it stopped working; revocation takes effect on the next request because the row is read on every one ([`features/0019`](../../features/0019-api-keys-and-read-only-public-api.md)). `lastUsedAt` is written at most once a minute per key — enough to tell a live integration from a forgotten credential, without turning every API read into a write. |
| `WebhookEndpoint` | Where an organization wants to be told that something happened | `url` is always `https`, never carries credentials and never resolves to a private address — enforced by `services/webhook-egress.ts` **at configuration time and again at every delivery**, because a hostname that was public when it was saved can point at `10.0.0.5` today. `secret` is **encrypted, not hashed**, and that is a real difference from `ApiKey.hash`: a key is only ever verified, while this has to be *used* to sign. AES-256-GCM under `WEBHOOK_SIGNING_KEY`, which does nothing against a compromised process and everything against a leaked backup. `events` is a list so a second event type is not a migration. `consecutiveFailures` / `disabledAt` / `lastError` are how a dead endpoint stops costing deliveries — and, since this product has no email, the only way its owner finds out ([`features/0020`](../../features/0020-outbound-webhooks.md)). |
| `WebhookDelivery` | One attempt to deliver one event | Event id, endpoint, attempt number, HTTP status, duration, truncated error — and **deliberately no payload body**. The body of `response.created` contains respondent answers, so storing it would be a second copy of personal data in a table nobody counts as holding any, and one that outlives its source: `Response` cascades from `Form`, so deleting a form destroys the answers while a delivery row would keep them. The consequence is accepted: a delivery cannot be replayed from this table alone. `eventId` is **stable across retries** and is the customer's deduplication key — the same contract `StripeEvent` implements in the other direction. |
| `RefreshToken` | One issued refresh token — the part of a session that can be taken away | `tokenHash` is a SHA-256 of the token, never the token; a fast hash is right **here and nowhere else** in this codebase, because the input is 32 bytes of CSPRNG output rather than a low-entropy secret. `family` ties every token descended from one login together, which is what makes replay detectable. `revokedAt` is how logout, rotation and reuse detection all take effect. Written only by `services/refresh-token.ts` ([`features/0008`](../../features/0008-session-hardening.md)). |

## Invariants

Rules the system depends on. Some are enforced, some are only conventions — the difference is the point of this table.

| Invariant | Enforced by | Strength |
|---|---|---|
| A `Form` is only readable by its owner through the authenticated API | `verifyFormOwnership` in every owning handler | Enforced, but by convention — nothing stops a new route from forgetting the call |
| The public endpoint never leaks `userId` | Explicit destructuring in `routes/forms.ts` | Enforced at one site only; a new public field would have to remember this |
| Only `published` forms accept responses | Status check in `routes/responses.ts` | Enforced |
| An organization never has more forms `published` than its plan allows | `assertCanPublishForm(tx, …)` in **both** `PATCH /forms/:id/status` and `PUT /forms/:id`, inside the transaction that writes `status` and behind the organization row lock | Enforced against concurrency since [`features/0027`](../../features/0027-atomic-plan-limits.md) — until then the count and the write were separate transactions and two publishes at the last slot both passed. Still by convention as to *reach*: a third way to set `status: 'published'` would have to remember the call |
| An organization never holds more seats — members plus redeemable invitations — than its plan allows | `assertCanInvite(tx, …)` in `POST /organizations/invitations`, inside the transaction that inserts the `Invitation` and behind the organization row lock | Enforced against concurrency since [`features/0027`](../../features/0027-atomic-plan-limits.md). Note it refuses the *next* seat and removes nobody: a downgrade leaves every existing membership in place |
| `UsageCounter.responses` never decreases | Nothing decrements it; the only write is an `increment` inside the submission transaction | Enforced by there being no other write path. **It will disagree with `SELECT count(*)` on `responses`, and that is correct** — deleting a form cascades its responses away and must not refund the month's quota, because this is the number an invoice will one day be computed from |
| `Organization.planKey` and `Subscription.status` never disagree | `reconcileSubscription` writes both **in one transaction**, and it is the only writer of either | Enforced by there being no other write path, and asserted after every event sequence in `tests/integration/billing.spec.ts`. Two separate writes would leave a permanent disagreement on a failure |
| A Stripe event is applied at most once | `stripe_events.id` is Stripe's `event.id` as the primary key; `claimEvent` inserts and treats the collision as "already processed" | Enforced by the database. Insert-and-catch, not read-then-insert: two concurrent deliveries of the same event both pass a read check |
| A billing event never unpublishes a form or deletes a response | Nothing in `services/stripe.ts` writes to `Form` or `Response` at all | Enforced by absence, and asserted in `tests/integration/billing.spec.ts`. **A downgrade refuses new state and destroys none of the old** — five published forms stay published on a drop to free; publishing a sixth is refused |
| A respondent is never told anything about the owner's plan | `POST /responses` answers `403` with the wording a closed form gets; `GET /forms/public/:shareId` answers `404` | Enforced at both sites, and asserted in `tests/integration/entitlements.spec.ts` |
| A `Field.id` handed out by the server is stable for the life of the field | The bulk save is a diff keyed on `id`; `createFieldSchema` refuses a client-supplied `id`, so only the server mints them | Enforced by the write path — see [04-backend-patterns](./04-backend-patterns.md) |
| An `Answer` always points at a `Field` row that still exists | Removal of a field that has answers is a soft delete, never a `delete` | Enforced in the bulk handler; **not** a database constraint — `DELETE /forms/:formId/fields/:fieldId` still hard-deletes |
| An `Answer.fieldId` always belongs to the same form as its `Response.formId` | Filter in `routes/responses.ts`, which silently drops foreign field ids with a `console.warn` | Enforced at write time; **not** a database constraint |
| `Answer.value` is a string representation of a value whose type is defined by `Field.type` | Convention only | Not enforced anywhere; `csv-exporter.ts` and the public form both re-derive it |
| Field `position` is in canvas space, at the scale the editor rendered with | Convention only | Not enforced; see the scale coupling in [02-architecture.md](./02-architecture.md) |

Three of these say "behind the organization row lock", and it is one mechanism: `lockOrganization` takes `SELECT … FOR UPDATE` on the `organizations` row as the first statement of the transaction, so a second request counting the same limit blocks until the first has committed its write. Nothing in the schema changed for it — no counter column, no constraint — which is why it is recorded here as how an invariant became enforced rather than hoped for. The reasoning is in [04-backend-patterns §10](./04-backend-patterns.md).

The two unenforced invariants at the bottom are the ones to watch. Both are the kind of implicit contract that survives right up until a second writer appears — a public API, an import feature, a migration script.

## Indexes

Present and appropriate: `Form.organizationId`, `Field.formId`, `Response.formId`, `Answer.responseId`, and the composite `Response(formId, submittedAt)` that backs the paginated dashboard listing.

`Membership.userId` and `Membership.organizationId` are both indexed: every authenticated request resolves the caller's membership, so this is the hottest lookup in the application. `Form.userId`'s index was dropped with the column's rename — nothing filters on the creator.

`Answer.fieldId` is also indexed, added with the safe bulk save: the handler counts answers per removed field on every editor save.

Nothing is currently missing that a known workload needs.

### What a submission stores about the respondent

`Form.collectsRespondentMetadata` decides whether a submission writes `Response.ipAddress` and `Response.userAgent` ([`features/0032`](../../features/0032-respondent-notice-and-ip-collection.md)). **It defaults to `false`**, and that default is the decision rather than caution: both columns used to be written on every submission with no notice to the person filling the form in, for an anti-abuse purpose nothing in this codebase implements — `ipAddress` is read only by the responses screen, the CSV exporter and the organization export, all of which are ways *out* of the building.

Three properties of it are easy to get wrong.

**It governs what is stored, never who may read anything.** No authorization check reads it, and turning it on grants nobody anything.

**It has nothing to do with rate limiting.** `middleware/rateLimit.ts` counts against `req.ip` on the request in flight and never touches the stored column, so a form with collection off is exactly as protected from a flood as one with it on. Routing the limiter through this flag would hand every author a switch that disables their own abuse protection — asserted by `backend/tests/integration/respondent-metadata.spec.ts`.

**The migration touched no existing row.** `20260902112033_add_collects_respondent_metadata` is a single additive `ALTER TABLE ... ADD COLUMN ... DEFAULT false`. Addresses already collected are still there, deliberately: nobody asked for them to be destroyed, and an author relying on them should not lose them to a schema change. Erasing them is a separate act, filed in [`docs/BACKLOG.md`](../BACKLOG.md). What existing forms do change is their behaviour from now on — they stop collecting, which is the direction that collects less.

## Cascade map

`onDelete` behaviour, read out of the schema. This table is the most important thing in this document, because two of these rows are how the product loses customer data.

| Relation | On delete of the parent | Consequence |
|---|---|---|
| `Form.organization` → `Organization` | `Cascade` | Deleting an organization deletes all its forms, fields and responses. **The largest blast radius in this schema**, and deliberate: an organization is the tenant, so deleting it deletes the tenant's data. **`DELETE /api/account` now fires it** ([`features/0029`](../../features/0029-account-deletion-and-real-erasure.md)) — but only for an organization whose sole member is the caller. An organization with anybody else in it, or with a pending invitation, refuses the deletion rather than taking a company's data with a personal account. |
| **`Form.createdBy` → `User`** | **`SetNull`** | Deleting a user **no longer destroys forms**. This was `Cascade` until [`features/0009`](../../features/0009-organizations-own-resources.md), when removing a user destroyed their forms and every response ever collected through them. The organization owns those forms and colleagues may depend on them, so the row survives and only the record of who created it is lost. |
| `Membership.user` → `User` | `Cascade` | Deleting a user removes their memberships. A membership is a link and holds no customer data. Note the consequence: deleting the last member of an organization would leave the organization and its forms with nobody able to reach them. **That is now unreachable from the application** ([`features/0029`](../../features/0029-account-deletion-and-real-erasure.md)): account deletion either deletes the organization with the account (sole member) or refuses (last owner, others present). It remains reachable by deleting a `users` row directly in the database. |
| `Membership.organization` → `Organization` | `Cascade` | Deleting an organization removes its memberships. |
| `Invitation.organization` → `Organization` | `Cascade` | An invitation into a deleted organization is meaningless. |
| `Invitation.invitedBy` → `User` | `SetNull` | Deleting the inviter must not cancel invitations the organization is still waiting on. Provenance only, same as `Form.createdByUserId`. |
| `Field.form` → `Form` | `Cascade` | Deleting a form deletes its fields. Correct. |
| `Response.form` → `Form` | `Cascade` | Deleting a form deletes its responses. Correct and intended — but irreversible, with no soft delete and no export prompt. |
| `Answer.response` → `Response` | `Cascade` | Correct. |
| `UsageCounter.organization` → `Organization` | `Cascade` | Deleting an organization removes its meters. Nothing is lost that matters: the tenant and everything it was metered for are gone in the same statement. **Note what is *not* here — deleting a `Form` does not touch a counter**, which is the whole reason the meter is a table and not a `count(*)`. |
| `Upload.organization` → `Organization` | `Cascade` | Deleting an organization removes its upload records, in the same statement as its forms. **The bytes are not a row and are not reached by this** — `services/pdf-gc.ts` removes them separately, and [`features/0029`](../../features/0029-account-deletion-and-real-erasure.md)'s rows-first-bytes-second ordering is what makes that safe. |
| `Upload.uploadedBy` → `User` | `SetNull` | **Deleting a user does not orphan the organization's documents.** Same decision as `Form.createdBy`, `Invitation.invitedBy`, `ApiKey.createdBy` and `WebhookEndpoint.createdBy`: the column is provenance, and a document that became unusable because an employee left would break forms nobody could explain. |
| **Deleting a `Form`** → `Upload` | **nothing** | Deliberate, and the asymmetry is the point: a form is deleted far more often than a document stops being wanted, and the editor's save path repoints a form at a new upload without deleting the old one. The `Upload` row goes only when `collectOrphanDocuments` actually removes the object — never before it, or the organization would keep a key it may no longer point a form at. |
| `ApiKey.organization` → `Organization` | `Cascade` | Deleting an organization deletes its keys. Nothing of the customer's is lost that outlives the tenant, and a credential pointing at a deleted organization would be a credential that authenticates nothing. |
| `ApiKey.createdBy` → `User` | `SetNull` | **Deleting a user does not break the organization's integrations.** Same decision as `Form.createdBy` and `Invitation.invitedBy`: the column is provenance, and a key that stopped working because an employee left would take production down for a reason nobody could see. |
| `WebhookEndpoint.organization` → `Organization` | `Cascade` | Deleting an organization removes where it wanted to be called. Nothing outlives the tenant. |
| `WebhookEndpoint.createdBy` → `User` | `SetNull` | Same decision as `ApiKey.createdBy`: an integration must not break because an employee left. |
| `WebhookDelivery.endpoint` → `WebhookEndpoint` | `Cascade` | Deleting an endpoint removes its history. It holds no payload and no customer-produced data — only a record that this endpoint was told — which is meaningless once the endpoint is gone. |
| `User.activeOrganization` → `Organization` | `SetNull` | The organization a person was acting in disappearing leaves the account intact and falls back to whatever membership it has left ([`features/0023`](../../features/0023-active-organization.md)). Nothing is lost: the column is a **cache of a choice, never a grant**, so clearing it removes no access and no data. |
| `RefreshToken.user` → `User` | `Cascade` | Deleting a user deletes their sessions. Correct and uncontroversial: this table holds no customer-produced data, only credentials that are worthless once the account is gone. |
| `Subscription.organization` → `Organization` | `Cascade` | Deleting an organization deletes its billing record. **This does not cancel anything at Stripe** — Stripe is a separate system and no cascade here can reach it. That is still true of the cascade, so [`features/0029`](../../features/0029-account-deletion-and-real-erasure.md) does the cancelling **above** it: `cancelSubscriptionsForOrganizations` in `services/stripe.ts` runs *before* the transaction, and a failure there abandons the deletion with a `502`. The ordering is the point — cancelling after the delete would leave a live subscription that no row in this database can name. Deleting an `organizations` row directly in the database still bills for ever. |
| `StripeEvent` → *(nothing)* | — | **Has no relation at all, deliberately.** Tying it to an organization would mean deleting an organization deletes the record that its events were already processed, and a redelivery after that would be reprocessed as new. |
| **`Answer.field` → `Field`** | **`Cascade`** | Deleting a field destroys every answer ever given to it, across all past responses. Two write paths can fire it and **neither does any more** — since [`features/0044`](../../features/0044-field-delete-archives-its-answers.md) both archive a field that holds answers, and both really delete one that holds none. See below. |

### What no cascade can reach: the stored document

A cascade deletes rows, and an uploaded PDF is not a row. Until [`features/0029`](../../features/0029-account-deletion-and-real-erasure.md) **nothing in the application deleted one at all** — `PdfStorageDriver.remove()` had existed since [`features/0016`](../../features/0016-object-storage-for-uploaded-pdfs.md) with zero call sites — so deleting a form removed its rows and left the document in storage for ever.

`services/pdf-gc.ts` is now the only module that calls `remove()`, and two properties of it belong here rather than in the code alone.

**A key is not owned by the form that points at it.** Two forms may reference one key: the editor's save path repoints a form at a new document without deleting the old one, and nothing stops a member building a second form on the same upload. So the collector asks *"does any surviving form still reference this key"*, never *"which key did this form have"* — the second question, asked as `remove(pdfFilenameFrom(form.pdfUrl))`, destroys a living form's document, and `tests/integration/account-deletion.spec.ts` fails when it is asked that way.

**[`features/0039`](../../features/0039-uploads-belong-to-an-organization.md) narrowed who can create that alias and did not remove aliasing**, so the question is unchanged and must stay unchanged. Until it, `Form.pdfUrl` was an unconstrained client-supplied string and the two forms need not even have shared an organization — which made this collector's conservatism the only thing standing between a stranger's row and another tenant's document, and made the reverse true as well: **a stranger's dangling reference pinned a victim's document alive against the victim's own deletion request.** A `pdfUrl` must now name an `Upload` belonging to the acting organization, which closes the cross-tenant case; same-organization aliasing is still real, which is why the collector is still asked the same question. `tests/integration/upload-ownership.spec.ts` asserts both halves.

**Rows first, bytes second.** Removal runs after the deleting transaction commits, never inside it. A rollback after the bytes are gone destroys a living form's document and is unrecoverable; a commit followed by a failed removal leaves an orphan, which is logged and fixable. Only one of the two failures can be undone, so the code is arranged so that it is the one that can happen.

That last row is not wrong on its own; it is only ever as safe as the write paths that can trigger it. There are exactly two, and **they now agree**:

| Write path | Behaviour | Answers |
|---|---|---|
| `POST /forms/:formId/fields/bulk` — the editor's save | A diff keyed on `Field.id`. A removed field that has answers is **soft-deleted**, never deleted. | Never destroyed |
| `DELETE /forms/:formId/fields/:fieldId` — the individual delete | Same rule since [`features/0044`](../../features/0044-field-delete-archives-its-answers.md): archived when it holds answers, deleted when it holds none. | Never destroyed |

Three things about that agreement are worth keeping, because each of them is a way to get it wrong.

**The lock comes before the count, in both.** A count taken before `SELECT … FOR UPDATE` restores the race in full: inserting an `Answer` takes `FOR KEY SHARE` on the field it references, so a submission arriving between the count and the delete is accepted with a `201` and has its answer cascaded away a moment later. The integration test for the individual path fires both requests through one `Promise.all`, and **it was run against the unfixed handler and seen to reproduce exactly that** — a `201` with no answer behind it.

**Archiving unconditionally would be the wrong fix.** A field holding no answers is really deleted, or every field placed and discarded while designing a form leaves a permanent row and the responses table grows columns nobody ever filled.

**The old behaviour was defended by an argument about the user, and the interface did not support it.** [`features/0001`](../../features/0001-stable-field-ids-and-safe-bulk-save.md) left the cascade in place as "an explicit act by the user rather than a side effect of saving", and said to revisit it once soft delete existed. By then the editor's whole confirmation was a `window.confirm` that named the field and never mentioned responses, so nothing about the act was informed. The dialog that replaced it says what happens to collected responses, and the toast afterwards reports what the server actually did — which is the only place the count can honestly come from, since the form is published and can take a submission while the author reads.

### The `deletedAt` lifecycle

`Field.deletedAt` exists so that removing a question from a form does not destroy the answers already given to it.

A field is **archived** (`deletedAt` set) by two code paths, which apply the same rule: the bulk save, when the field is absent from the payload *and* at least one `Answer` references it, and the individual `DELETE` since [`features/0044`](../../features/0044-field-delete-archives-its-answers.md). A removed field with no answers is hard-deleted by either, because there is nothing to protect.

Who sees an archived field:

| Reader | Archived fields | Why |
|---|---|---|
| `GET /forms/:id` (editor) | Hidden | The user removed it; it must not reappear |
| `GET /forms/public/:shareId` | Hidden | Never rendered, never required |
| `POST /responses` required-field check | Hidden | An archived field can never block a submission |
| `_count.fields` on `GET /forms` | Hidden | Must not inflate the dashboard's field count |
| `verifyFieldOwnership` (individual `PUT`/`DELETE`) | Hidden → `404` | Not editable; it is not in the editor |
| `GET /forms/:id/responses` (`fields` in the payload) | **Included** | Its answers are in these responses and need a labelled column |
| `GET /forms/:id/responses/export` (CSV) | **Included** | A historical row keeps its column and its original label |
| `scripts/migrate-existing-forms.ts` | Hidden | Re-embedding it would put it back on the PDF |
| `GET /forms/:formId/fields/archived` | **The only ones** | The editor rail's Archived list — the one place an author can see what was kept ([`features/0045`](../../features/0045-archived-fields-are-visible-and-restorable.md)) |
| `GET /organizations/export` | **Included**, with `archivedAt` | The export is the record of everything held |

**There is an un-archive path** since [`features/0045`](../../features/0045-archived-fields-are-visible-and-restorable.md): `POST /forms/:formId/fields/:fieldId/restore` clears `deletedAt` and hands back the whole row. It exists because the alternative was permanent: placing a replacement field mints a **new id**, so the old answers stay on the old id and the CSV grows two columns for one question that nothing can ever join. Stable field ids ([`features/0001`](../../features/0001-stable-field-ids-and-safe-bulk-save.md)) are what make recovery possible at all.

Three consequences worth carrying:

- **A restored field must go back into the editor's own field list, not just the sidebar.** The bulk save reads its removals as *a live field whose id is missing from the payload*, so a field restored on the server and absent from the next save is archived again — with a `200`, and no error for anyone to see.
- **Restoring does not re-embed the PDF**, like every other individual field write. The document lags until the next bulk save; the editor's toast says so.
- **A name collision is a warning, not a refusal.** `Field.name` has no unique constraint, and refusing to restore over a live field with the same name would strand its answers permanently — the exact outcome soft deletion exists to prevent. The rail warns and the author decides.

Three surfaces show an archived field to its owner now: the rail's **Archived** list, the marked column in the responses table, and the CSV — where the column is deliberately **not** marked, because the header text is a contract with whatever parses the export.

One consequence worth knowing: `GET /forms/:id` re-extracts fields from the PDF when a form has none. That guard counts archived fields too, so a form edited down to zero live fields does not resurrect them as new rows.

## What is missing for multi-tenancy

Multi-tenancy itself is **built**: `Organization`, `Membership` and `Invitation` exist, `Form.organizationId` is required, and every authorization check resolves a membership ([`features/0009`](../../features/0009-organizations-own-resources.md), [`0010`](../../features/0010-member-invitations-and-role-enforcement.md)). This section used to say the opposite; it was left behind by those two changes.

Since [`features/0023`](../../features/0023-active-organization.md) it also answers *which* organization, when somebody belongs to more than one: `User.activeOrganizationId`, read only by `requireMembership`. Belonging to two became reachable the moment invitations shipped, and until then the model had no answer — reads spanned every membership and writes took the oldest.

What is still absent from the schema, and where it is due:

- ~~**`Subscription`**~~ — **built** ([`features/0013`](../../features/0013-stripe-subscriptions.md)). `Organization.planKey` kept its place as the thing every limit check reads and gained exactly one writer, the Stripe webhook.
- **`Plan` as a table** — deliberately not a table. It is a frozen constant in `backend/src/services/plans.ts`, and it earns a table only when a customer needs limits nobody else has.
- **An uploads table**, which is what would let `Form.pdfUrl` be verified against a file the organization actually uploaded ([`docs/BACKLOG.md`](../BACKLOG.md)).

## Rules for changing this model

Operational detail lives in the `prisma-schema-migration` skill. The two rules that belong here:

1. **Every new relation states its `onDelete` deliberately, in the PR description, in words.** Not "I left the default". The one cascade nobody argued about is the one currently deleting customer data.
2. **Data that a customer produced is never destroyed as a side effect of an edit.** Deleting it must be an action the user explicitly took, aimed at that data. Editing a form is not consent to delete its responses.
