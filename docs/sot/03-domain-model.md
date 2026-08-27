# Domain model

Source of record: `backend/prisma/schema.prisma`. Everything below was read out of that file and the routes that write to it.

## Entities

```
User 1───* Form 1───* Field 1───* Answer *───1 Response *───1 Form
```

| Entity | Purpose | Notes that matter |
|---|---|---|
| `User` | An account | `id, email (unique), passwordHash, name?`. No roles, no organization. Flat and single-tenant. |
| `Form` | A PDF plus its field layout | Belongs to a `User`. `shareId` (nanoid 12) is the public identifier. `status: draft \| published \| closed`. `settings: Json?` is writable through `PUT /forms/:id` but is never read by any code — a free extension point for per-form configuration (branding, limits, webhooks) that needs no migration. `viewCount` incremented on every public fetch. |
| `Field` | One input placed on the PDF | `type: text \| textarea \| checkbox \| radio \| dropdown`. `position: Json` in **canvas** coordinates. `options: Json?` for radio/dropdown. `validation: Json?` = `{minLength?, maxLength?, pattern?}`. `order: Int` drives render and tab order. |
| `Response` | One public submission | Stores `ipAddress` and `userAgent`. No respondent identity beyond that. `pdfUrl?` exists on the model but nothing writes it today. |
| `Answer` | One value in one submission | `value: String` — **everything is a string**, including booleans (`String(value)`). Type meaning is reconstructed at read time. |

## Invariants

Rules the system depends on. Some are enforced, some are only conventions — the difference is the point of this table.

| Invariant | Enforced by | Strength |
|---|---|---|
| A `Form` is only readable by its owner through the authenticated API | `verifyFormOwnership` in every owning handler | Enforced, but by convention — nothing stops a new route from forgetting the call |
| The public endpoint never leaks `userId` | Explicit destructuring in `routes/forms.ts` | Enforced at one site only; a new public field would have to remember this |
| Only `published` forms accept responses | Status check in `routes/responses.ts` | Enforced |
| An `Answer.fieldId` always belongs to the same form as its `Response.formId` | Filter in `routes/responses.ts`, which silently drops foreign field ids with a `console.warn` | Enforced at write time; **not** a database constraint |
| `Answer.value` is a string representation of a value whose type is defined by `Field.type` | Convention only | Not enforced anywhere; `csv-exporter.ts` and the public form both re-derive it |
| Field `position` is in canvas space, at the scale the editor rendered with | Convention only | Not enforced; see the scale coupling in [02-architecture.md](./02-architecture.md) |

The two unenforced invariants at the bottom are the ones to watch. Both are the kind of implicit contract that survives right up until a second writer appears — a public API, an import feature, a migration script.

## Indexes

Present and appropriate: `Form.userId`, `Field.formId`, `Response.formId`, `Answer.responseId`, and the composite `Response(formId, submittedAt)` that backs the paginated dashboard listing.

Missing and likely to matter: `Answer.fieldId` has **no index**, while the safe bulk-save design needs to count answers per field on every editor save. Add it with that change, not before.

## Cascade map

`onDelete` behaviour, read out of the schema. This table is the most important thing in this document, because two of these rows are how the product loses customer data.

| Relation | On delete of the parent | Consequence |
|---|---|---|
| `Form.user` → `User` | `Cascade` | Deleting a user deletes all their forms, fields and responses. Correct, but there is no account-deletion endpoint, so this only fires from the database. |
| `Field.form` → `Form` | `Cascade` | Deleting a form deletes its fields. Correct. |
| `Response.form` → `Form` | `Cascade` | Deleting a form deletes its responses. Correct and intended — but irreversible, with no soft delete and no export prompt. |
| `Answer.response` → `Response` | `Cascade` | Correct. |
| **`Answer.field` → `Field`** | **`Cascade`** | **Deleting a field destroys every answer ever given to it, across all past responses.** |

That last row is not wrong on its own. It becomes a data-loss bug because of how it combines with the write path below.

### The active defect: `bulk` field save destroys collected answers

`POST /api/forms/:formId/fields/bulk` in `backend/src/routes/form-fields.ts` — the normal "save" action of the editor — currently does:

```ts
await prisma.field.deleteMany({ where: { formId } })
await prisma.field.createMany({ data: fieldsData.map(field => ({ formId, ...field })) })
```

Every save deletes every field and recreates it with a **new** `id`. Combined with `Answer.field onDelete: Cascade`, the effect is:

> If a form has already collected responses and its owner opens the editor and saves — moving a field one pixel is enough — every answer in every past response is silently deleted. The `Response` rows survive, empty. There is no warning, no confirmation, and no backup.

Nothing in the test suite covers "save fields on a form that has responses", which is why this shipped.

Two fixes have been written and reverted (`fb8acd8`, `771b77c`, and a re-application that was also dropped). Both attempts added a second code path for forms that have responses, which left the underlying problem — unstable field ids — in place. The redesign is specified in [`features/0001-stable-field-ids-and-safe-bulk-save.md`](../../features/0001-stable-field-ids-and-safe-bulk-save.md), and the direction is:

**Field ids must be stable across saves, unconditionally.** Not "stable when responses exist". A field id that changes on save is not just a data-loss risk; it makes webhooks, a public API, response-level analytics and any external integration impossible, because nothing outside the database can hold a durable reference to a field. Making ids stable is the prerequisite for [10-saas-roadmap.md](./10-saas-roadmap.md)'s API work, and it fixes the cascade bug as a side effect rather than as a special case.

## What is missing for multi-tenancy

`Form.userId` hard-codes the assumption that a form's owner is one user. Every ownership check reads `where: { userId: req.userId }`. Moving to organization ownership therefore touches every route that reads or writes a `Form`, plus their tests.

The target model and the migration path are in [10-saas-roadmap.md](./10-saas-roadmap.md). Nothing about `Organization`, `Membership`, `Plan` or `Subscription` exists in the schema today.

## Rules for changing this model

Operational detail lives in the `prisma-schema-migration` skill. The two rules that belong here:

1. **Every new relation states its `onDelete` deliberately, in the PR description, in words.** Not "I left the default". The one cascade nobody argued about is the one currently deleting customer data.
2. **Data that a customer produced is never destroyed as a side effect of an edit.** Deleting it must be an action the user explicitly took, aimed at that data. Editing a form is not consent to delete its responses.
