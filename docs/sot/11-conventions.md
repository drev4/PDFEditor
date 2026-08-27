# Conventions

Conventions observed in the code and the git history, plus the rules added deliberately since. They are recorded so they keep being followed, not to trigger a style migration.

## Language

- **Code, comments, commits, PRs, documentation and this SoT are in English.** No exceptions.
- **User-visible UI copy** is English today, with a few leftover Spanish placeholders. Those are drift, not a decision — resolve them through an i18n layer rather than string by string. See [05-frontend-patterns.md](./05-frontend-patterns.md).
- Conversation with the maintainer may happen in any language; the artifacts do not.

## Commits

Conventional Commits, already used consistently: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, with an optional scope — `feat(backend):`, `fix(frontend):`.

**Commits carry no `Co-Authored-By` trailer and no other AI-authorship marker.** This is an explicit decision by the repository owner. Any Claude Code session working here omits that trailer, whatever its default is.

Write the body to answer *why*, not *what* — the diff already says what. A `fix` commit should name the failure it prevents.

## Branches

```
feature/NNNN-slug   work that has a spec in features/  (name matches the file exactly)
feature/slug        small work with no spec file
fix/slug            a bug fix with no spec file
chore/slug          tooling, docs, CI, dependencies
```

Flow: branch → PR into `develop` → periodically `develop` → PR into `main`. This matches the history (`Merge pull request #N from drev4/develop`).

**Branch from `develop` with `--no-track`:**

```bash
git fetch origin
git checkout --no-track -b feature/0001-my-thing origin/develop
```

`--no-track` is not optional. Without it, git sets the new branch's upstream to `origin/develop` itself, and a later `git push` — or an IDE "Sync" button — lands the commit directly on `develop`, bypassing the PR entirely. Verify with `git branch -vv` that the new branch does not show `[origin/develop]`. On the first push, set the upstream explicitly: `git push -u origin feature/0001-my-thing`.

Creating a local branch needs no confirmation — it is reversible and touches nothing shared. **Pushing and opening a PR do**, like any action that publishes outside the local environment.

## File layout

**Backend**

- One file per resource in `routes/`. The Express handler holds its own logic — there is no controller layer and no repository layer, deliberately ([02-architecture.md](./02-architecture.md)).
- Non-trivial non-HTTP logic in `services/` (`pdf-processor.ts`, `csv-exporter.ts`, `db.ts`).
- Cross-cutting request concerns in `middleware/`.
- Tests in `backend/tests/`, one file per resource — **not** beside the source.
- ESM with explicit `.js` extensions on relative imports, including from `.ts` files.

**Frontend**

- `services/` HTTP per resource · `stores/` Pinia (`<name>.store.ts`) · `composables/` (`use<Name>.ts`, one per file) · `views/` one per route · `components/` grouped by domain (`auth/`, `forms/`, `pdf/`, `form-fields/`, `editor/`, `search/`, `toolbars/`, `ui/`).
- Tests **beside** the file they test, as `<name>.spec.ts`.

## Naming

| Thing | Convention | Example |
|---|---|---|
| URL paths | kebab-case | `/fields/bulk` |
| Variables and parameters | camelCase | `formId`, `shareId` |
| Vue components | PascalCase | `FormSavePanel.vue` |
| Pinia stores | `use<Name>Store` in `<name>.store.ts`, id lowercase without suffix | `useAuthStore` in `auth.store.ts`, `defineStore('auth', …)` |
| Composables | `use<Name>`, file named identically | `useFormManagement.ts` |
| Prisma models | PascalCase singular, mapped to snake_case plural tables | `Form` → `@@map("forms")`, `userId` → `@map("user_id")` |
| Zod schemas | `<verb><Entity>Schema`, declared beside the route | `createFieldSchema` |
| Feature specs and their branch | `NNNN-slug.md` ↔ `feature/NNNN-slug` | `0001-stable-field-ids-and-safe-bulk-save` |

## Documentation

- `docs/sot/` is the source of truth and is updated in the same commit as the code it describes.
- `docs/BACKLOG.md` is the live backlog; `features/` holds execution specs for work in flight.
- `docs/guides/` is end-user facing.
- `docs/archive/` holds superseded documents, kept for history. **Never cite an archived document as current** — each carries a banner saying so.
- The root `README.md` is the public front door and describes the product, not the internals.

## Working agreements for AI sessions

The repository is set up so that a Claude Code session with no prior memory can work here correctly. That relies on:

- Reading [`CLAUDE.md`](../../CLAUDE.md) and the relevant SoT documents before changing anything structural.
- Using the skills in `.claude/skills/` rather than improvising an equivalent process.
- **Never asserting a fact about the code from memory or inference.** Open the file. A wrong claim in the SoT is more expensive than no claim, because the next session trusts it.
- Filing what is discovered: a risk found while doing something else goes into `docs/BACKLOG.md`, not into a sentence in the chat.
