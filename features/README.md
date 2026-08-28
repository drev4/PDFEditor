# Features

Each file here is one unit of work, specified well enough to be executed by someone — or some session — with no memory of the conversation that produced it. It sits between [`docs/BACKLOG.md`](../docs/BACKLOG.md), which is one line per item, and an actual working session.

A spec is not a ticket. A ticket says what to do; a spec says what to do, why the obvious approach is wrong, what not to touch, and how to know it worked.

## When to write one

When an item from the backlog is about to be picked up — not before. Specs written far ahead go stale before they are executed, and a stale spec is worse than none because it is trusted.

Not everything needs one. A typo, a dependency bump, a one-line fix does not. Anything with a design decision inside it does.

Finished specs are **not deleted**. They are marked done and stay as the record of what was asked and why.

## How much goes in one feature

One spec does **not** mean one functionality. Two of the six that exist cover several at once, and both were right to:

- [`0001`](0001-stable-field-ids-and-safe-bulk-save.md) carried four things — baselining the migrations, stable field ids, the non-destructive bulk save, and the whole `backend/tests/integration/` harness. The harness was not extra scope: a mocked Prisma had already passed the broken code, so without a real database there was **no way to show the fix worked**.
- [`0005`](0005-working-ci-and-enforced-node-version.md) carried a broken CI and an unenforced Node version, and says so in its first line: *"Two problems that look unrelated and are not."* Fixing CI without pinning Node leaves CI green **on the wrong Node**; pinning Node without fixing CI leaves a pipeline that still never generated the Prisma client. Either half alone produces a repository that still lies about itself.

The criterion is not size or subject area:

> **Combine when they share one reason to change, or when one cannot be verified without the other. Split when they share only a theme.**

The practical test is the revert: **a feature is the unit of undo.** If this turned out to be wrong in production, what would have to come out? Things that would never be reverted separately belong in one spec. Anything that could survive on its own belongs in its own.

Being in the same area of the code is not a reason. [`0002`](0002-rate-limiting-on-public-write-paths.md) (rate limiting) and [`0004`](0004-safe-author-supplied-regex.md) (regex guard) are both security, both High, both P0 — and separating them was correct. They share no files and no verification.

The history makes the point better than the argument does: `0002` merged with the E2E suite still red, and filed that as a new P0 in its own Outcome; [`0003`](0003-e2e-suite-green-and-independent.md) then closed it, and `0004` went in after. Bundled together, the rate limiter would have sat unmerged behind a test-repair job it had nothing to do with.

One real pressure to name, so it can be resisted: a spec here runs 14–20 KB, and that cost tempts you to bundle work to avoid writing another one. Grouping by "it's all security anyway" is exactly the wrong grouping, and it produces a PR nobody can review or revert.

## Naming

`NNNN-slug.md` — four digits, sequential, never reused; slug in kebab-case describing the outcome, not a ticket id.

The same number and slug name the git branch: `features/0001-stable-field-ids-and-safe-bulk-save.md` is implemented on `feature/0001-stable-field-ids-and-safe-bulk-save`. Given a branch or a PR you can find its spec without searching, and the reverse.

## Template

```markdown
# NNNN — Title

**Status:** backlog | in progress | done
**Priority:** P0 | P1 | P2 | P3 (see docs/BACKLOG.md)
**Branch:** feature/NNNN-slug (filled in when it moves to "in progress")
**Related:** links to the relevant docs/sot/*.md

## Context

Why this exists and what was discovered. Two to four paragraphs at most — the long
reasoning lives in the SoT; this is what the executor needs to understand the task.

## Why the obvious approach is wrong

Optional but usually the most valuable section. If someone already tried something
that failed, or the intuitive fix has a flaw, say so here. This is what stops the
work being redone the same wrong way.

## Goal

Acceptance criteria that can be checked. Not "handle this better" — statements that
are true or false when the work is finished.

## Out of scope

Explicitly. What this change must not touch, and which of those things is a
separate backlog item.

## Execution prompt

> Self-contained. Concrete file paths and function names. What to read first, what
> to build, what not to touch, which tests to write, which command verifies it,
> and which documents to update on the way out.
```

## How to write the execution prompt

- **Name real things.** `backend/src/routes/form-fields.ts`, the `formFieldsRouter.post('/:formId/fields/bulk', …)` handler — not "the bulk endpoint bug". Whoever executes it may have no context at all.
- **Read the code before writing the prompt.** A prompt describing how the code probably works is worse than no prompt: it produces confident wrong work.
- **Say how to verify.** The exact test command, and which tests must be written. For a bug fix: the failing test comes first.
- **Bound the scope.** If the change invites a wider refactor, forbid it in writing and file the wider refactor in the backlog instead.
- **Close the documentation loop.** End by requiring the relevant `docs/sot/` updates (skill `sot-sync`) and setting this file's status to `done`.

## From backlog to merge

1. **Backlog** — a row in [`docs/BACKLOG.md`](../docs/BACKLOG.md).
2. **Spec** — when it is next up, create `features/NNNN-slug.md` (skill `feature-spec-writer`) with `Status: backlog` and no branch.
3. **Start** — create the branch from `develop`:
   ```bash
   git fetch origin
   git checkout --no-track -b feature/NNNN-slug origin/develop
   ```
   `--no-track` is mandatory: without it the new branch's upstream is `origin/develop` itself, and a later push — including an IDE "Sync" — lands directly on `develop`, skipping the PR. Then set `Status: in progress` and `Branch:` in the file.
   Creating the branch needs no confirmation. Pushing it does.
4. **Implement** — follow the spec's own execution prompt, applying the relevant skills.
5. **Commit** — Conventional Commits, no AI-authorship trailer. See [`docs/sot/11-conventions.md`](../docs/sot/11-conventions.md).
6. **Before the PR** — run the `ship-checklist` skill: tests, type check, contract and SoT sync, backlog updates.
7. **PR into `develop`**, never straight into `main`. Push and PR creation both need explicit confirmation.
8. **Close** — on merge: `Status: done`, `sot-sync` if the change was structural, remove the row from the backlog, delete the branch (confirm before deleting the remote one).
9. **Release** — `develop` → `main` by PR, periodically.
