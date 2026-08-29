# Domain model

Source of record: `backend/prisma/schema.prisma`. Everything below was read out of that file and the routes that write to it.

## Entities

```
Organization 1───* Membership *───1 User
Organization 1───* Form 1───* Field 1───* Answer *───1 Response *───1 Form
User 1───* RefreshToken
User 0───* Form            (createdByUserId — provenance, never ownership)
```

**`Organization` owns forms; `User` does not.** A user reaches a form only through a `Membership`. A B2C account is an organization with exactly one member, created at signup — there is no separate "personal account" concept and no second code path ([`features/0009`](../../features/0009-organizations-own-resources.md)).

| Entity | Purpose | Notes that matter |
|---|---|---|
| `User` | An account | `id, email (unique), passwordHash, name?`. Owns nothing directly — reaches forms through `Membership`. |
| `Organization` | The tenant. Owns forms | `id, name, slug (unique)`. Created for every user at signup. |
| `Membership` | Which users may act on which organization's resources | `(organizationId, userId)` unique. `role: owner \| admin \| member` — **stored but not enforced**: nothing reads it to make a decision yet, so every member is effectively an admin. |
| `Form` | A PDF plus its field layout | Belongs to an `Organization` (`organizationId`, required). `createdByUserId` records who made it and is **nullable and never an authorization input** — a deleted user must not take the organization's forms with them. `shareId` (nanoid 12) is the public identifier. `status: draft \| published \| closed`. `settings: Json?` is writable through `PUT /forms/:id` but is never read by any code — a free extension point for per-form configuration (branding, limits, webhooks) that needs no migration. `viewCount` incremented on every public fetch. |
| `Field` | One input placed on the PDF | `type: text \| textarea \| checkbox \| radio \| dropdown`. `position: Json` in **canvas** coordinates. `options: Json?` for radio/dropdown. `validation: Json?` = `{minLength?, maxLength?, pattern?}`. `order: Int` drives render and tab order. `deletedAt: DateTime?` — non-null means **archived**: removed from the editor and the public form, still present in the responses table and the CSV export. See [the `deletedAt` lifecycle](#the-deletedat-lifecycle). |
| `Response` | One public submission | Stores `ipAddress` and `userAgent`. No respondent identity beyond that. `pdfUrl?` exists on the model but nothing writes it today. |
| `Answer` | One value in one submission | `value: String` — **everything is a string**, including booleans (`String(value)`). Type meaning is reconstructed at read time. |
| `RefreshToken` | One issued refresh token — the part of a session that can be taken away | `tokenHash` is a SHA-256 of the token, never the token; a fast hash is right **here and nowhere else** in this codebase, because the input is 32 bytes of CSPRNG output rather than a low-entropy secret. `family` ties every token descended from one login together, which is what makes replay detectable. `revokedAt` is how logout, rotation and reuse detection all take effect. Written only by `services/refresh-token.ts` ([`features/0008`](../../features/0008-session-hardening.md)). |

## Invariants

Rules the system depends on. Some are enforced, some are only conventions — the difference is the point of this table.

| Invariant | Enforced by | Strength |
|---|---|---|
| A `Form` is only readable by its owner through the authenticated API | `verifyFormOwnership` in every owning handler | Enforced, but by convention — nothing stops a new route from forgetting the call |
| The public endpoint never leaks `userId` | Explicit destructuring in `routes/forms.ts` | Enforced at one site only; a new public field would have to remember this |
| Only `published` forms accept responses | Status check in `routes/responses.ts` | Enforced |
| A `Field.id` handed out by the server is stable for the life of the field | The bulk save is a diff keyed on `id`; `createFieldSchema` refuses a client-supplied `id`, so only the server mints them | Enforced by the write path — see [04-backend-patterns](./04-backend-patterns.md) |
| An `Answer` always points at a `Field` row that still exists | Removal of a field that has answers is a soft delete, never a `delete` | Enforced in the bulk handler; **not** a database constraint — `DELETE /forms/:formId/fields/:fieldId` still hard-deletes |
| An `Answer.fieldId` always belongs to the same form as its `Response.formId` | Filter in `routes/responses.ts`, which silently drops foreign field ids with a `console.warn` | Enforced at write time; **not** a database constraint |
| `Answer.value` is a string representation of a value whose type is defined by `Field.type` | Convention only | Not enforced anywhere; `csv-exporter.ts` and the public form both re-derive it |
| Field `position` is in canvas space, at the scale the editor rendered with | Convention only | Not enforced; see the scale coupling in [02-architecture.md](./02-architecture.md) |

The two unenforced invariants at the bottom are the ones to watch. Both are the kind of implicit contract that survives right up until a second writer appears — a public API, an import feature, a migration script.

## Indexes

Present and appropriate: `Form.organizationId`, `Field.formId`, `Response.formId`, `Answer.responseId`, and the composite `Response(formId, submittedAt)` that backs the paginated dashboard listing.

`Membership.userId` and `Membership.organizationId` are both indexed: every authenticated request resolves the caller's membership, so this is the hottest lookup in the application. `Form.userId`'s index was dropped with the column's rename — nothing filters on the creator.

`Answer.fieldId` is also indexed, added with the safe bulk save: the handler counts answers per removed field on every editor save.

Nothing is currently missing that a known workload needs.

## Cascade map

`onDelete` behaviour, read out of the schema. This table is the most important thing in this document, because two of these rows are how the product loses customer data.

| Relation | On delete of the parent | Consequence |
|---|---|---|
| `Form.organization` → `Organization` | `Cascade` | Deleting an organization deletes all its forms, fields and responses. **The largest blast radius in this schema**, and deliberate: an organization is the tenant, so deleting it deletes the tenant's data. No endpoint does this; it fires only from the database. |
| **`Form.createdBy` → `User`** | **`SetNull`** | Deleting a user **no longer destroys forms**. This was `Cascade` until [`features/0009`](../../features/0009-organizations-own-resources.md), when removing a user destroyed their forms and every response ever collected through them. The organization owns those forms and colleagues may depend on them, so the row survives and only the record of who created it is lost. |
| `Membership.user` → `User` | `Cascade` | Deleting a user removes their memberships. A membership is a link and holds no customer data. Note the consequence: deleting the last member of an organization leaves the organization and its forms with nobody able to reach them — tracked in [`docs/BACKLOG.md`](../BACKLOG.md). |
| `Membership.organization` → `Organization` | `Cascade` | Deleting an organization removes its memberships. |
| `Field.form` → `Form` | `Cascade` | Deleting a form deletes its fields. Correct. |
| `Response.form` → `Form` | `Cascade` | Deleting a form deletes its responses. Correct and intended — but irreversible, with no soft delete and no export prompt. |
| `Answer.response` → `Response` | `Cascade` | Correct. |
| `RefreshToken.user` → `User` | `Cascade` | Deleting a user deletes their sessions. Correct and uncontroversial: this table holds no customer-produced data, only credentials that are worthless once the account is gone. |
| **`Answer.field` → `Field`** | **`Cascade`** | Deleting a field destroys every answer ever given to it, across all past responses. Only two write paths can fire it, and one of them refuses to — see below. |

That last row is not wrong on its own; it is only ever as safe as the write paths that can trigger it. There are exactly two:

| Write path | Behaviour | Answers |
|---|---|---|
| `POST /forms/:formId/fields/bulk` — the editor's save | A diff keyed on `Field.id`. A removed field that has answers is **soft-deleted**, never deleted. | Never destroyed |
| `DELETE /forms/:formId/fields/:fieldId` — the individual delete | Hard `delete`, cascading to answers | **Destroyed.** Deliberate for now: an explicit act by the user aimed at that field, not a side effect of saving. Tracked in [`docs/BACKLOG.md`](../BACKLOG.md) to move to soft delete too. |

### The `deletedAt` lifecycle

`Field.deletedAt` exists so that removing a question from a form does not destroy the answers already given to it.

A field is **archived** (`deletedAt` set) by exactly one code path: the bulk save, when the field is absent from the payload *and* at least one `Answer` references it. A removed field with no answers is hard-deleted, because there is nothing to protect.

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

There is no un-archive path, and no UI that lists archived fields. A field is archived silently to the form and visibly to the responses; the editor tells the user it happened via the `archived` array the endpoint returns (see [06-api-reference](./06-api-reference.md)).

One consequence worth knowing: `GET /forms/:id` re-extracts fields from the PDF when a form has none. That guard counts archived fields too, so a form edited down to zero live fields does not resurrect them as new rows.

## What is missing for multi-tenancy

`Form.userId` hard-codes the assumption that a form's owner is one user. Every ownership check reads `where: { userId: req.userId }`. Moving to organization ownership therefore touches every route that reads or writes a `Form`, plus their tests.

The target model and the migration path are in [10-saas-roadmap.md](./10-saas-roadmap.md). Nothing about `Organization`, `Membership`, `Plan` or `Subscription` exists in the schema today.

## Rules for changing this model

Operational detail lives in the `prisma-schema-migration` skill. The two rules that belong here:

1. **Every new relation states its `onDelete` deliberately, in the PR description, in words.** Not "I left the default". The one cascade nobody argued about is the one currently deleting customer data.
2. **Data that a customer produced is never destroyed as a side effect of an edit.** Deleting it must be an action the user explicitly took, aimed at that data. Editing a form is not consent to delete its responses.
