---
name: ship-checklist
description: Run the pre-PR gate before calling work done - tests, type checks, API contract verification, SoT sync, backlog and feature-spec updates, and commit hygiene. Use before opening a pull request or before telling the user a change is finished.
---

# Before this ships

The definition of done is in `docs/sot/09-quality-and-testing.md`. This is the gate that enforces it. Run it before opening a PR, and before telling the user a change is finished.

Report the result honestly. A failing check is a finding to report, never something to work around or leave unmentioned.

## 1. Scope

- Does the change do what its `features/` spec or the request asked, and nothing else?
- Did scope grow? Either remove the extra or state it explicitly in the PR description. Silent scope growth is what makes a diff unreviewable.
- Is anything left unfinished? Say so plainly, and file it in `docs/BACKLOG.md`. Do not describe partial work as complete.

## 2. Tests

```bash
npm run test:frontend
npm run test:backend
npm run test:e2e          # if a user-visible flow changed
```

- **For a bug fix: does a test exist that fails without this change?** If it was not run against the unfixed code and seen to fail, it has not been shown to catch anything.
- Is the test at the level that would actually catch the bug? A mocked Prisma client cannot demonstrate a cascade, a constraint or a rollback — those need a real database (`docs/sot/09-quality-and-testing.md`).
- Backend tests in `backend/tests/`; frontend tests beside their source. Do not mix the conventions.

## 3. Types and build

```bash
cd backend && npx tsc --noEmit
npm run build --workspace=frontend      # runs vue-tsc
```

Neither runs in CI today, so this is the only place they get checked.

## 4. Contract and documentation

- Routes changed? Update `docs/sot/06-api-reference.md` **after re-reading the route file** — `api-contract-guard`.
- Schema changed? `docs/sot/03-domain-model.md`, including the cascade map, and a migration committed. State every new relation's `onDelete` in words in the PR description.
- Anything else structural? Run `sot-sync` and update every document it points at.
- New public endpoint, new personal data, new permission? `docs/sot/07-security-and-privacy.md`, including the data inventory table. A new public endpoint without rate limiting needs a stated reason.
- Backlog: rows this change closed are removed; debt this change created is added, with a why.
- The `features/NNNN-*.md` spec is set to `**Status:** done`.

## 5. Data safety

The question that outranks the rest, because it is the one this project has already got wrong:

> **Can this destroy or expose customer data?**

Check any `delete`, `deleteMany`, cascade, bulk write, or newly public route against the cascade map in `docs/sot/03-domain-model.md`. If an edit path can destroy data the user did not aim at, stop and redesign — do not ship it behind a condition.

## 6. Commits

- Conventional Commits: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, with an optional scope.
- The body explains **why**; the diff already says what.
- **No `Co-Authored-By` trailer and no AI-authorship marker.** Explicit decision of the repository owner (`docs/sot/11-conventions.md`).
- On a `feature/*` branch created from `develop` with `--no-track`, never committing directly on `develop` or `main`.

## 7. Publishing

Pushing and opening a PR are outward-facing actions and need explicit confirmation from the user every time. The PR targets `develop`, never `main`.

First push: `git push -u origin <branch>`.
