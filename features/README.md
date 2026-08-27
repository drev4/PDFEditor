# Features

Each file here is one unit of work, specified well enough to be executed by someone — or some session — with no memory of the conversation that produced it. It sits between [`docs/BACKLOG.md`](../docs/BACKLOG.md), which is one line per item, and an actual working session.

A spec is not a ticket. A ticket says what to do; a spec says what to do, why the obvious approach is wrong, what not to touch, and how to know it worked.

## When to write one

When an item from the backlog is about to be picked up — not before. Specs written far ahead go stale before they are executed, and a stale spec is worse than none because it is trusted.

Not everything needs one. A typo, a dependency bump, a one-line fix does not. Anything with a design decision inside it does.

Finished specs are **not deleted**. They are marked done and stay as the record of what was asked and why.

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
