# 0005 — A CI pipeline that actually verifies the repository, and a Node version that cannot be got wrong

**Status:** done
**Priority:** P0 (see [`docs/BACKLOG.md`](../docs/BACKLOG.md))
**Branch:** `feature/0005-working-ci-and-enforced-node-version`
**Related:** [`08-operations`](../docs/sot/08-operations.md) · [`09-quality-and-testing`](../docs/sot/09-quality-and-testing.md) · [`04-backend-patterns`](../docs/sot/04-backend-patterns.md)

## Context

Two problems that look unrelated and are not. Both are about the repository failing to tell you the truth about itself.

**CI is red, and has been misdiagnosed.** Two of the three jobs in `.github/workflows/test.yml` fail:

```
FAIL  tests/integration/fields-bulk-save.spec.ts
FAIL  tests/integration/fields-visibility.spec.ts
Error: @prisma/client did not initialize yet. Please run "prisma generate" and try to import it again.
 ❯ new PrismaClient node_modules/.prisma/client/default.js:43:11
 ❯ src/services/db.ts:3:23
```

and the E2E job burns **over twenty minutes** before failing every test, each one looking like a UI bug:

```
Expected pattern: /\/dashboard/
Received string:  "http://localhost:5173/register"
```

**Both are the same missing step**, and the second one is disguised. See below.

**The wrong Node version also fails silently.** Measured on `develop` with Node v20.9.0:

| Command | What happens |
|---|---|
| `npm run test:frontend` | Every spec fails to start: `ERR_REQUIRE_ESM` from `html-encoding-sniffer` |
| `npm run build --workspace=frontend` | `[vite:vue] crypto.hash is not a function` |
| `npm run test:backend` | **Passes 81 of 83** — and silently disables field-pattern validation |

None of those messages contains the word "Node". `engines` is declared correctly (`^20.19.0 \|\| >=22.12.0`) but only produces `npm WARN EBADENGINE` and installs anyway; there is no `.npmrc`; `.nvmrc` says `22.12.0` while all three CI jobs pin `node-version: [20.x]`. **Nobody runs what CI runs, and CI runs what nobody runs.**

## The root cause of the CI failures

`prisma generate` never runs in CI, so `@prisma/client` is the un-generated stub that throws on construction.

It is not enough that `@prisma/client` ships a `postinstall`. Read `backend/node_modules/@prisma/client/scripts/postinstall.js`:

```js
if (process.env.INIT_CWD) {
  process.chdir(process.env.INIT_CWD) // necessary, because npm chooses __dirname as process.cwd()
}
```

`INIT_CWD` is the directory `npm` was invoked from. CI runs `npm ci` at the **repo root**, so the hook changes into the root and looks for `prisma/schema.prisma` there. This is a workspaces monorepo: the schema is at `backend/prisma/schema.prisma`. It is not found, and the failure is a **warning, not an error** (`postinstall.js:149-153`) — install succeeds, leaving the stub in place. Locally it works only because `prisma migrate dev` and `prisma generate` have been run by hand from `backend/`.

Neither the `integration-tests` nor the `e2e-tests` job runs a generate step; both run only `npx prisma migrate deploy`, and **`migrate deploy` does not generate the client** — only `migrate dev` does.

### Why that also explains the E2E job

`backend/src/services/db.ts:3` constructs `PrismaClient` at module scope, and `app.ts` imports the routers, which import `db.ts`. So an un-generated client throws **at import time** and the backend process exits immediately.

Playwright's `webServer` runs `npm run dev` and waits on `http://localhost:5173` — the *frontend*, which starts fine under `concurrently`. Playwright sees a healthy URL and proceeds. Every API call then gets connection-refused, registration never redirects, and 34 tests each burn their timeout and two retries. Hence twenty minutes, and hence a stack of failures that all look like front-end bugs.

Note the diagnostic gap that made this expensive: **the backend's crash output is invisible in the job log.** Nothing reports that the API died.

## Why the obvious approach is wrong

### Adding `prisma generate` only to the failing job leaves the trap armed

It turns CI green in one commit, and the next person to add a job that touches the database rediscovers this from scratch. The generate step is not a property of a job; it is a property of *having installed this repository*. Fix it where installation happens, and add the CI step as belt and braces — some pipelines run `npm ci --ignore-scripts`, which would skip a `postinstall` entirely.

There is a real constraint on the `postinstall` route worth stating before someone hits it: `prisma` is a **devDependency**. A production `npm ci --omit=dev` would run a `postinstall` whose CLI is not installed. Decide that deliberately — generate before pruning, move `prisma` to dependencies, or make the hook tolerant — rather than discovering it during a deploy.

### `engine-strict=true` alone does not fix the Node problem

It is worth adding, but notice the sequence that actually happens:

1. Install on a good Node. Everything works.
2. Switch Node — another project, or a shell that opened without `nvm use`.
3. Run the tests.

`engine-strict` fires at step 1 and correctly reports nothing wrong. Nothing checks at step 3, which is exactly where `crypto.hash is not a function` and the silent `re2` failure come from. A guard that only hardens install does not address the reported symptom.

### Documenting the Node version harder cannot work, because it is already documented

`.nvmrc` exists. `engines` is correct. This backlog row has been open for weeks. The information is present and is not reaching anyone at the moment they need it. **The check has to run where the failure happens** — in the scripts.

### Bumping CI to Node 22 makes CI green and the claim false

`engines` claims `^20.19.0 || >=22.12.0`, and **nobody has ever verified that 20.19 works** — it is inferred from Vite's and jsdom's own metadata. An untested support claim is one a contributor will act on. Either test both ends of the range in CI or narrow the range to what is tested.

### A `process.version` check would not have caught the `re2` failure

The `re2` binary's ABI tracks the Node **major** line, so a module built under 22.12 loads fine on 22.22, and one built under 20.19 loads fine on 20.9 — where the frontend is broken and the backend is not. Version and ABI are related but different predicates. Check that the native module *loads*, which is the thing that actually corresponds to the failure.

### Do not let any new guard become a way to take production down

The `re2` loader degrades deliberately ([04-backend-patterns](../docs/sot/04-backend-patterns.md)) so an ABI mismatch cannot kill the API. Guard the developer scripts and CI; leave the runtime's existing behaviour alone.

## Goal

**CI**

1. All jobs in `.github/workflows/test.yml` pass on `develop`.
2. `prisma generate` runs as a consequence of installing the repository, not only inside one CI job — a fresh clone plus `npm ci` yields a working client.
3. The E2E job surfaces the API server's output, so a backend that dies at boot is visible in the job log rather than presenting as 34 UI failures.
4. CI type-checks and builds both workspaces. Neither runs in CI today, so a type error or a broken build reaches `develop` (closes an existing backlog row).
5. Jobs that cannot pass when a cheaper job has already failed do not run — the expensive suites are gated on the fast ones.
6. A superseded run is cancelled rather than left to finish.
7. A green E2E run takes a few minutes, not twenty.

**Node**

8. `npm install` / `npm ci` **fails** rather than warns on an unsupported Node.
9. Running a test or build script on an unsupported Node prints a message naming Node, the version found, the version required, and the fix — *before* the tool-specific error.
10. A native module built for a different Node gets its own actionable message, not a silent behaviour change.
11. CI takes its Node version from `.nvmrc`, so the version lives in one place.
12. Every version in the `engines` range is verified in CI, or removed from the range.
13. `.nvmrc` and `engines` cannot silently disagree again.

**Both**

14. Every suite green on the supported Node: `test:frontend`, `test:backend`, `test:integration`, `test:e2e`, plus both type checks and the frontend build.
15. [`09-quality-and-testing`](../docs/sot/09-quality-and-testing.md) no longer claims the backend has no Node constraint; [`08-operations`](../docs/sot/08-operations.md) describes the real pipeline.

## Out of scope

- **ESLint in CI.** There is no ESLint configuration in the repository at all, so there is nothing to run. Its own backlog row.
- **Enforcing coverage thresholds.** Separate row, separate argument about what the number should be.
- **A deployment or release pipeline.** This is about the verification pipeline only.
- **Docker images or devcontainers.** Both would help the Node problem and both are their own decision. File a row if warranted.
- **`corepack` or pinning the npm version.** Not implicated in any failure here.
- **Upgrading dependencies** or changing what Vite, Vitest or jsdom require.
- **Making the maintainer's machine work.** The deliverable is an unambiguous repository, not one upgraded laptop.

## Execution prompt

> **Step 1 — read before writing.** `.github/workflows/test.yml` in full (three jobs: `unit-tests`, `integration-tests`, `e2e-tests`). `backend/package.json` (no `postinstall`; `prisma` is a devDependency), root `package.json` (`engines`, and every script), `.nvmrc`, `playwright.config.ts` (`webServer`, `retries`, `workers`), `backend/src/services/db.ts` (the client is constructed at import), and `backend/node_modules/@prisma/client/scripts/postinstall.js` around the `INIT_CWD` chdir and the `Can't find schema.prisma` warning. Confirm for yourself that `migrate deploy` does not generate.
>
> **Step 2 — reproduce the generate failure locally, before fixing it.** Move `backend/node_modules/.prisma` aside, then run `npm run test:integration --workspace=backend` and watch it fail with the same "did not initialize yet" error CI reports. Then start the backend and watch it exit at boot. That second observation is the one that explains the E2E job, and it is worth seeing rather than believing. Restore with `npx prisma generate` from `backend/`.
>
> **Step 3 — make generate a property of installing.** Add `"postinstall": "prisma generate"` to `backend/package.json`. npm runs a workspace's lifecycle script with that workspace as the working directory, so the schema is found — verify that rather than assuming it, with a clean `npm ci` from the repo root. Decide and record what happens under `npm ci --omit=dev`, where the `prisma` CLI would be absent.
>
> **Step 4 — add the explicit CI step anyway.** In both `integration-tests` and `e2e-tests`, run `npx prisma generate` (`working-directory: backend`) after `npm ci` and before `migrate deploy`. Redundant with Step 3 by design: a pipeline that installs with `--ignore-scripts` still works, and a reader of the workflow can see that the client is generated.
>
> **Step 5 — make a dead API visible.** The E2E job must not be able to fail 34 times without saying that the server died. Either give `webServer` in `playwright.config.ts` a `stdout`/`stderr` pipe so its output reaches the log, or start the API in CI as its own step with its log captured and uploaded as an artifact on failure. Verify by deliberately breaking the backend and confirming the job log names the real cause.
>
> **Step 6 — Node version, enforced where it breaks.** Add `.npmrc` at the repo root with `engine-strict=true`, and confirm `npm install` now exits non-zero on an unsupported Node. Then add `scripts/check-node.mjs`: dependency-free, reads the supported range from root `package.json` (**do not restate the range** — one source of truth), compares `process.version`, and on mismatch prints an actionable message and exits non-zero. Wire it in as `pretest` / `prebuild` / `predev`, or a single `preflight` the others call. Have the same script check that `re2` loads and say plainly that a failure means the Node version changed since `npm install` and `npm rebuild re2` fixes it — a version comparison alone does not catch that case. Also have it assert that `.nvmrc` satisfies `engines`, which is the check that would have caught the current state.
>
> **Step 7 — decide the supported range with evidence.** Install Node 20.19.x and run `npm ci`, `npm run test:frontend`, `npm run build --workspace=frontend`, `npm run test:backend`. If it all passes, keep the range and make CI test both ends. If anything fails, **narrow `engines`** and say so in the PR. Do not leave an unverified bound standing.
>
> **Step 8 — make CI run what developers run, and stop wasting minutes.** Replace `node-version: ${{ matrix.node-version }}` with `node-version-file: .nvmrc` in all three jobs. If Step 7 kept the lower bound, give `unit-tests` a matrix covering the floor and `.nvmrc`. Add a `concurrency` block keyed on the ref with `cancel-in-progress: true`. Gate `integration-tests` and `e2e-tests` on `unit-tests` with `needs:`. Cache the Playwright browser download. Add type checking (`npx tsc --noEmit` in `backend/`, and the frontend build, which runs `vue-tsc`) to `unit-tests`.
>
> **Step 9 — verify.** Locally on the supported Node: `npm run test:frontend`, `npm run test:backend`, `npm run test:integration`, `npm run test:e2e`, `npx tsc --noEmit` in `backend/`, `npm run build --workspace=frontend` — all green. Then the negative tests, which are the point of this feature: switch to an unsupported Node and confirm each guard fires with a message naming Node; remove the generated Prisma client and confirm the preflight or the job says so clearly. **Then push the branch and confirm CI is actually green** — this feature is about CI, so a local pass proves nothing. Report the run.
>
> **Step 10 — document.** Run `sot-sync`. [`08-operations`](../docs/sot/08-operations.md): rewrite the CI section to describe the real jobs, their ordering, the generate step and the Node source of truth; extend the existing `re2` note with the rebuild step. [`09-quality-and-testing`](../docs/sot/09-quality-and-testing.md): correct the claim that backend tests have no Node constraint, and state what the preflight checks. `CLAUDE.md`: the Commands block's Node warning needs to be current. Remove the Node row and the "type check, lint and build in CI" row from [`docs/BACKLOG.md`](../docs/BACKLOG.md) to the extent this closes them, and file what it does not. Set this file to `**Status:** done`.

## Outcome

Locally green: 237 frontend, 83 mocked backend, 14 database-backed, 34 E2E, both type checks and the frontend build. **CI has not yet been observed green — that requires a push, which needs the owner's approval, so goal 1 is unverified until then.**

### The CI root cause, fixed twice on purpose

Reproduced before fixing: with `backend/node_modules/.prisma` removed, the integration suite failed exactly as CI reported, and the backend **exited 1 at boot**. Driving one E2E test in that state reproduced the reported symptom precisely — a `toHaveURL` failure on `/register`, with *no mention of Prisma or the backend anywhere in the log*.

- `backend/package.json` gained `"postinstall": "prisma generate"`, so installing the repository produces a working client. Verified with a real `rm -rf node_modules && npm ci`: 22 seconds, client generated, `new PrismaClient()` constructs.
- Both database jobs also run `npx prisma generate` explicitly, so `--ignore-scripts` pipelines work and a reader can see it happen.

### The diagnostic gap, closed

`playwright.config.ts` now declares **two** `webServer` entries, the API on `/health` and the frontend, both with output piped. Verified by breaking it again:

```
[WebServer] SyntaxError: The requested module '@prisma/client' does not provide an export named 'PrismaClient'
Error: Timed out waiting 120000ms from config.webServer.
```

Before: 34 failures, twenty minutes, cause invisible. After: no tests run, cause named.

### `engines` was narrowed, because it was false

Step 7 said not to leave an unverified bound standing, and the bound turned out to be wrong — this is the finding of the feature.

Node 20.19.5 *appeared* to work: 237 frontend tests, a clean build, 83 backend tests. But that was an already-installed tree with `re2` rebuilt by hand. A clean `npm ci` on Node 20.19.5 **fails**, and `engine-strict` is what surfaced it:

```
npm error notsup Not compatible with your version of node/npm: re2@1.24.1
npm error notsup Required: {"node":">=22"}
```

`re2@1.24.1` declares `engines: { node: ">=22" }`. **Adding it in [`features/0004`](0004-safe-author-supplied-regex.md) silently dropped Node 20 support**, and the root `engines` went on claiming `^20.19.0 || >=22.12.0` for four commits. Now `>=22.12.0`, which matches `.nvmrc`, so every job derives from `node-version-file: .nvmrc` and the planned two-version matrix was dropped as meaningless.

### Guards, each tested in both directions

| Guard | Catches |
|---|---|
| `.npmrc` `engine-strict=true` | Install on an unsupported Node — now fails instead of `EBADENGINE` warning |
| `scripts/check-node.mjs` via `pre*` hooks | Switching Node *after* install, which `engine-strict` cannot see |
| `--native`: Prisma client loads | The bug this feature exists for, caught before the confusing symptom |
| `--native`: `re2` loads | An ABI mismatch, which the runtime hides by design |
| `.nvmrc` vs `engines` assertion | The exact drift that had CI on 20.x and developers on 22.12 |

Negative tests all confirmed: an unsupported Node, a mismatched `re2`, and a missing client each produce a message naming the cause and the fix.

### Also in this change

`concurrency` with `cancel-in-progress`; `needs: unit-tests` on both database jobs; cached Chromium; type check and build added to `unit-tests` — which closes most of the "type check, lint and build in CI" row, leaving only lint, blocked on there being an ESLint config at all.

**P0 is now empty.**

### Filed, not fixed

`prisma` is a devDependency, so a production `npm ci --omit=dev` would run the `postinstall` without its CLI. Harmless today — there is no deploy pipeline — and a trap for whoever writes one. Recorded in [`docs/BACKLOG.md`](../docs/BACKLOG.md).
