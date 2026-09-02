---
name: sot-sync
description: Update docs/sot/ (the project Source of Truth) after a change that touches the data model, the API, an architectural pattern, security posture, or operations. Use before calling any structural change done, and whenever code and documentation may have drifted apart.
---

# Sync the Source of Truth after a change

`docs/sot/` is the project's single source of truth (index: `docs/sot/README.md`). It only stays true if it is updated in the same change as the code. This skill is the checklist for that.

## Which document owns what

| The change touched | Update |
|---|---|
| `backend/prisma/schema.prisma` | `03-domain-model.md` — entities, invariants, and the **cascade map** |
| Any file in `backend/src/routes/` | `06-api-reference.md`, after re-reading the route (see the `api-contract-guard` skill) |
| A new backend pattern — service shape, error handling, transactions | `04-backend-patterns.md` |
| A new frontend pattern — a store/composable convention, a state library | `05-frontend-patterns.md` |
| Auth, permissions, anything newly public, any new personal data | `07-security-and-privacy.md`, including the **data inventory table** |
| Configuration, CI, deployment, logging, backups | `08-operations.md` |
| Test tooling, a new test level, the definition of done | `09-quality-and-testing.md` |
| A piece of the SaaS target that is now real | Move it from `10-saas-roadmap.md` into the document that describes reality |
| Commits, branches, naming, file layout | `11-conventions.md` |
| A known risk that was fixed, or made worse | The section that describes it — never leave it saying "pending" once it is done |

Two or three of these usually apply at once. A schema change almost always touches `03`, `06` and `09`.

## How

1. Use the index in `docs/sot/README.md` to find every affected document. More than one usually is.
2. **Re-read the affected section against the new code.** Do not edit from memory of what it said; the drift you are fixing may be older than this change.
3. Edit only what changed. The SoT is not a document to rewrite wholesale — the rest of it is still accurate and someone verified it.
4. If the change closed a backlog item, remove the row from `docs/BACKLOG.md` and set the `features/` spec to `**Status:** done`.
5. If the change **created** debt or a risk, add it to `docs/BACKLOG.md` at the right priority with a one-line why. Debt that only lives in the head of whoever wrote it is not tracked.
6. Update the verification date and status block at the bottom of `docs/sot/README.md` when the change was structural.

## Do not

- **Do not describe anything that is not built** as though it exists. Aspirational content belongs in `10-saas-roadmap.md`, or fenced with `[NOT IMPLEMENTED]`. This is the single failure mode this skill exists to prevent.
- **Do not add a new file to `docs/sot/`** unless the subject fits none of the twelve existing documents. It almost always fits one.
- **Do not fix a document by weakening it.** If code and docs disagree, find out which is wrong. Deleting the sentence that contradicts the code hides a bug rather than reporting it.
- **Do not edit anything in `docs/archive/`.** Those are historical records that are known to be wrong.
