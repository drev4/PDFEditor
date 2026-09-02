---
name: feature-spec-writer
description: Create a spec file in features/ for a backlog item from docs/BACKLOG.md, and create its git branch when implementation starts. Use when asked to prepare, specify or write the prompt for a feature or fix, or to start implementing something that already has a file in features/.
---

# Write a feature spec, and start its branch

Conventions, template and the full backlog-to-merge flow: `features/README.md`. This skill covers two moments in that lifecycle — writing the spec, and starting the work.

## Part 1 — writing the spec

Write one when a backlog item is **about to be picked up**. Not earlier: specs written ahead of time go stale before they are executed, and a stale spec is worse than none because it gets trusted. Not later: if the work is already done, the thing to update is the SoT (`sot-sync`).

Not everything needs a spec. A typo or a dependency bump does not. Anything containing a design decision does.

### Steps

1. Find the item in `docs/BACKLOG.md`. Take its priority and its stated "why" from there — do not re-invent the rationale.
2. **Read the real code the change will touch, before writing a word of the spec.** Open the actual files. A spec describing how the code probably works produces confident wrong work; it is worse than an empty spec, which at least prompts someone to look.
3. Check for prior attempts: `git log --oneline` and any reverts. If something was tried and reverted, **find out why it failed** and put that in the spec. Otherwise it gets redone the same wrong way — which has already happened once in this repo.
4. Next sequential number: `ls features/ | sort`. Never reuse a number.
5. Write the file using the template in `features/README.md`. Leave `Branch:` empty; it is filled in when work starts.

### What makes the spec worth having

- **Concrete names.** `backend/src/routes/form-fields.ts`, the `formFieldsRouter.post('/:formId/fields/bulk', …)` handler. Not "the bulk endpoint issue". The executor may have no context at all.
- **A "why the obvious approach is wrong" section**, whenever there is one. This is usually the highest-value part of the document. It is what a ticket cannot carry.
- **Checkable acceptance criteria.** Statements that are true or false when the work is done, not "handle deletions better".
- **Explicit scope boundaries.** What must not be touched, and which backlog item covers it instead.
- **How to verify.** The exact commands. For a bug fix, require the failing test first — written before the fix, run against the unfixed code, and seen to fail. A test written after the fix proves nothing about whether it catches the bug.
- **The documentation exit.** End the prompt by requiring the relevant `docs/sot/` updates (`sot-sync`), the backlog rows removed, and this file set to `**Status:** done`.

### Do not

- Do not write specs for several backlog items at once unless asked. One at a time, as they are picked up.
- Do not restate the SoT in the spec. Link to it. Two copies of the same explanation drift.

## Part 2 — starting the implementation

When the work described by an existing `features/NNNN-slug.md` begins:

1. **`git status` first.** Uncommitted changes that are not part of this work must be committed or stashed before starting. Do not build on top of someone else's unfinished state.
2. Create the branch from `develop`:
   ```bash
   git fetch origin
   git checkout --no-track -b feature/NNNN-slug origin/develop
   ```
   The branch name is exactly `feature/` plus the spec filename without `.md`.

   **`--no-track` is mandatory.** Without it, git sets the new branch's upstream to `origin/develop` itself — not to a new remote branch of the same name. A later `git push`, including an IDE "Sync" button, then lands the commit directly on `develop`, bypassing the PR entirely. Confirm with `git branch -vv` that the new branch does **not** show `[origin/develop]`.
3. Creating a local branch needs no confirmation — it is reversible and touches nothing shared. **Pushing and opening a PR do.** On the first push, set the upstream explicitly: `git push -u origin feature/NNNN-slug`.
4. Update the spec: `**Status:** in progress`, `**Branch:** feature/NNNN-slug`.
5. Follow the spec's own execution prompt, applying whichever skills it calls for.
6. Before opening the PR, run the `ship-checklist` skill.
