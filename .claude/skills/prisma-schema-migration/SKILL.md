---
name: prisma-schema-migration
description: Change backend/prisma/schema.prisma safely and keep the rest of the stack in sync - migrations, routes, Zod schemas, frontend types, tests and docs/sot. Use for any data-model change, including the Organization/Membership/Plan/Subscription work in the SaaS roadmap.
---

# Change the Prisma schema without leaving loose ends

Current model: `User → Form → Field → Response → Answer` (`docs/sot/03-domain-model.md`). Planned changes are in `docs/sot/10-saas-roadmap.md`.

## Stop: there is no migration history

`backend/prisma/migrations/` does not exist. Everything so far has used `prisma db push`, which mutates a database to match the schema with no record of intent, no ordering and no down path.

**Before the first schema change that touches a database with real data, baseline the migrations:** generate an initial migration from the current schema, check the generated SQL against what is already deployed, and commit it. Then switch CI and every environment to `prisma migrate deploy`. `db push` is for throwaway local databases only, from that point on.

Do not begin roadmap schema work on `db push`. See `docs/sot/08-operations.md`.

## Before editing the schema

1. **Read what the current code assumes about the model you are touching.** Every ownership check today reads `where: { userId: req.userId }` on `Form`. Moving ownership to an organization means every one of those sites, and their tests, not just the schema line.
2. **State the `onDelete` behaviour of every relation you add or touch, in words, in the PR description.** Not "I left the default". The one cascade nobody discussed — `Answer.field onDelete: Cascade` — is currently how the product loses customer data. For each relation ask: when the parent goes, should the child die with it, block the delete, or be orphaned deliberately?
3. **Never let customer-produced data be destroyed as a side effect of an edit.** Deleting it must be an action the user aimed at that data. If a change makes an edit path capable of deleting answers or responses, the design is wrong, not the implementation.
4. **If the model already holds real data, plan the data migration, not just the structure migration.** The `Form.userId` → `Form.organizationId` move needs a personal `Organization` created for every existing `User`; that is a sequence of deployable steps, described in `docs/sot/10-saas-roadmap.md`, not one migration.

## Executing the change

1. Edit `backend/prisma/schema.prisma`.
2. `cd backend && npx prisma migrate dev --name <descriptive_name>`. Read the generated SQL before committing it — Prisma will silently plan a destructive step if the diff implies one.
3. `npx tsc --noEmit` in `backend/` to find every site the new types break, all at once rather than one at a time in runtime.
4. Update the Zod schemas in `backend/src/routes/*.ts` that validate the changed model. Types and validators are separate; the compiler will not remind you.
5. Update the matching types in `frontend/src/services/*.ts` if the model is exposed over the API.
6. Update the tests in `backend/tests/` that mock the model (`mockDeep<PrismaClient>()`).
7. **Add an index for any column your new code filters or counts on.** A new soft-delete flag that every read filters on, or a foreign key you now count per row, needs one.
8. If correctness depends on database behaviour — a cascade, a constraint, a transaction — add a test against a real PostgreSQL instance. A mocked Prisma client will pass against broken code (`docs/sot/09-quality-and-testing.md`).

## On the way out

Apply the `sot-sync` skill: update `docs/sot/03-domain-model.md` (entities, invariants, the cascade map) and, if the change completes something described in `docs/sot/10-saas-roadmap.md`, move it out of the roadmap into the document that describes reality.

## Do not

- **Do not use `prisma db push`** on anything but a disposable local database.
- **Do not add speculative fields.** `Form.settings: Json?` has sat unused since it was added; do not repeat that on every new model. Add the column when something reads it.
- **Do not add a `Cascade`** because it is the shortest thing to type.
- **Do not rename or drop a column in the same migration that deploys code reading it.** Expand, migrate, contract — in separate deploys.
