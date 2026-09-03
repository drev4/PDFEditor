# 0038 — Production dependency triage, and an audit gate that measures what ships

**Status:** done
**Priority:** P1 (see [`docs/BACKLOG.md`](../docs/BACKLOG.md) — *Production dependency audit is red*)
**Branch:** `feature/0038-production-dependency-triage-and-an-audit-gate`
**Related:** [08-operations](../docs/sot/08-operations.md) · [07-security-and-privacy](../docs/sot/07-security-and-privacy.md) · [04-backend-patterns §8](../docs/sot/04-backend-patterns.md) · [`features/0031`](0031-production-deployment.md) · [`features/0004`](0004-safe-author-supplied-regex.md)

## Context

Building the pruned backend runtime for [`features/0031`](0031-production-deployment.md) turned up production dependency advisories and filed them rather than guessing at them: *"The advisory detail could not be fetched in this session, so exploitability was not guessed and the risk was not described as resolved"* (`features/0031-production-deployment.md:81`). The backlog row says the counts are real, the exploitability is untriaged, and both a triage and an automated policy are owed **before the beta is exposed to the internet**. That date is 2026-09-30, and D1 — provisioning the Railway environments — is the only other thing standing in front of it ([10-saas-roadmap](../docs/sot/10-saas-roadmap.md#what-comes-next)).

The detail is now fetchable, and it was fetched on 2026-09-03. `npm audit --omit=dev` reports **18**, not the 15 recorded in `0031` and repeated in [08-operations](../docs/sot/08-operations.md) and the backlog: 1 critical, 13 high, 4 moderate. **Nothing in this repository changed to cause that.** The lockfile is the same; three more advisories were published against packages already installed. That drift, over a few days and with nobody watching, is the whole argument for the second half of this feature.

Every one of the 18 reports `fixAvailable: true`, and `npm audit fix --dry-run` prints no `--force` and no `SEMVER WARNING` — so the remediation appears to be one command. It is not, and the two reasons are in the next section.

The advisories divide cleanly by whether the attacker input is this product's own request path. `re2` (`backend/src/services/pattern-validator.ts:41`), `multer` (`backend/src/middleware/upload.ts:49`), `nanoid` (`upload.ts:37`, `backend/src/routes/forms.ts:118`, `backend/src/services/organization.ts:26`) and `qs`/`body-parser` under `express@4.22.2` sit on paths a respondent or an author reaches. `tar` (critical), `@mapbox/node-pre-gyp`, `minimatch`, `picomatch` and `brace-expansion` arrive through `bcrypt`'s and `re2`'s install-time gyp toolchain, which no runtime code path calls. `postcss`, `defu`, `effect`, `deepmerge-ts`, `@prisma/config` and `prisma` arrive through the Vue compiler and the Prisma CLI. **That division is a claim about reachability, and this feature's job is to establish it with evidence rather than to assert it — the paragraph above is a starting hypothesis, not a finding.**

## Why the obvious approach is wrong

**1. `npm audit --omit=dev` does not describe any artifact this project ships, and treating its number as the production risk is the mistake.** One lockfile spans three deliverables built by three Dockerfiles: the backend runtime (`Dockerfile.backend`, target `runtime`), the SPA (`Dockerfile.frontend` — an Nginx image serving static files, which contains no `node_modules` at all), and the migration job (`Dockerfile.migrations`, which *deliberately* retains the Prisma CLI and is never a serving image). `postcss@8.5.6` and its four highs reach the audit through `vue → @vue/compiler-sfc`, a frontend **production** dependency in the lockfile — and the thing built from it is CSS. Counting those four against the API is how a number becomes theatre.

The inverse trap is just as real and is why this cannot be settled by reading the workspace manifests either. `Dockerfile.backend`'s runtime stage copies **`/app/node_modules`**, the hoisted root, from the `production-dependencies` stage — and npm workspaces hoist the frontend's production dependencies into exactly that directory. So packages that belong to the SPA's build may well be sitting inside the API image. Do not assume either way: **enumerate what is actually in the image.**

**2. `npm audit fix` looks safe here and has one bump inside it that can break the product without failing a test.** `re2` is the only ReDoS control in the codebase ([`features/0004`](0004-safe-author-supplied-regex.md), [04-backend-patterns §8](../docs/sot/04-backend-patterns.md)); it is a native module; its binary is tied to the Node ABI; and `scripts/check-node.mjs:153` exists *because it has already stopped loading once* — the script's own comment says a version comparison does not catch it. A bump that resolves on a developer's Windows machine via a prebuilt download and then compiles differently, or not at all, in `node:22-bookworm` is a live possibility, and the failure surface is the module the whole pattern-validation design depends on. `bcrypt` is the second native dependency and sits under every login.

Note also that `express@4.22.2` is flagged (moderate, via `qs` and `body-parser`) and the fix is **inside 4.x**. Do not take this as an opening to move to Express 5: that is a separate filed row precisely because it deletes `asyncHandler` and the scan that keeps it honest (`backend/tests/async-handler-coverage.spec.ts`).

**3. `npm audit --audit-level=high` as a CI step is the gate that gets deleted three weeks later.** Run against this lockfile it fails on `vitest`, `vite` and `ws` — dev-only advisories in a test runner that ships nowhere. A gate whose first red build has no action behind it teaches the team to ignore it, and then somebody removes it. Lowering the threshold to `critical` to make it quiet is the same mistake with an extra step: it would pass today with `tar`'s critical still present. The gate has to measure **the production tree** and it needs an **explicit, dated exception list** for what is knowingly accepted — not a lowered bar, which accepts everything silently and records nothing.

**4. A triage that lives in a PR description is gone by the next advisory.** The reason 18 advisories are sitting here untriaged is that the reasoning from the last look at them was never written down anywhere a later session could find. The output of this work is a document, not a decision.

## Goal

Checkable when the work is done:

1. `npm run audit:prod` exists at the repository root, runs offline-of-Docker or with it (see the execution prompt), and reports advisories **only** for packages that are present in `Dockerfile.backend`'s `runtime` stage — with the set of those packages derived from the image, not from a hand-written list.
2. Its exit code is non-zero when a `high` or `critical` advisory affects a shipped package and is not covered by an entry in `.audit-exceptions.json`.
3. `.audit-exceptions.json` entries each carry the advisory id, the package, a one-line reason, and an `expires` date. An expired entry fails the run — the exception is a deadline, not a mute button.
4. Every one of the 18 advisories currently reported by `npm audit --omit=dev` is either **fixed** by a dependency update or **listed** in the triage document with the reachability argument for why it is not exploitable in this application's paths. None is left unmentioned.
5. `docs/runbooks/dependency-audit.md` exists, records the triage with the date it was performed, names the shipped-vs-not division and how it was established, and says how to run the audit and how to add an exception.
6. After remediation, `npm audit --omit=dev` reports **zero critical** and every remaining `high` is either outside the runtime image or has an exception entry.
7. A CI job runs `audit:prod` on every pull request in `.github/workflows/test.yml`, and it is red today's-lockfile-red only for things the triage did not clear.
8. `.github/dependabot.yml` exists, grouped so the repository receives a manageable number of pull requests, and is documented in [08-operations](../docs/sot/08-operations.md).
9. `npm run test:backend`, `npm run test:frontend`, `npm run test:integration`, `npm run test:e2e`, `npm run build --workspace=frontend`, `cd backend && npx tsc --noEmit` and `npm run check:node` all pass **after** the dependency updates — with the re2 and bcrypt checks explicitly exercised, not inferred.
10. `docker build -f Dockerfile.backend --target runtime .` succeeds and the resulting image starts, after the updates.

## Out of scope

- **Secret scanning.** The same [08-operations](../docs/sot/08-operations.md) row names it; it is a different mechanism with a different failure mode. File it as its own backlog row.
- **Express 4 → 5.** Separate filed row (*Express 5 would delete `asyncHandler` and its scan*). Stay inside `^4`.
- **Any change to what `pattern-validator.ts` does.** A `re2` version bump is a dependency update; the module's contract, its call sites and [`features/0004`](0004-safe-author-supplied-regex.md)'s design are untouched.
- **ESLint.** Separate P1 row. Do not add a linter while you are in `test.yml`.
- **D1 provisioning.** This feature makes the image auditable; it does not deploy it.
- **Coverage thresholds**, the other CI gap in that table. Separate row.
- **Frontend runtime dependency policy beyond what Dependabot covers.** The SPA ships no `node_modules`; its build toolchain is a supply-chain question of a different shape and is not being answered here.

## Execution prompt

> **Read first**, in this order: `Dockerfile.backend` (all five stages — the copy list in `runtime` is the entire question), `Dockerfile.frontend`, `Dockerfile.migrations`, `scripts/check-node.mjs` (particularly the `re2` check around line 148), `backend/src/services/pattern-validator.ts`, `backend/src/middleware/upload.ts`, `.github/workflows/test.yml`, and the *What CI still does not do* table in `docs/sot/08-operations.md`.
>
> **Step 1 — establish what actually ships, before touching a version.** Build the dependency stage and enumerate it:
> ```bash
> docker build -f Dockerfile.backend --target production-dependencies -t vuepdf-prod-deps .
> docker run --rm vuepdf-prod-deps sh -c 'cd /app && npm ls --omit=dev --all --json' > shipped.json
> ```
> If `npm ls` inside the image is unreliable (pruned trees can fail its integrity check), fall back to walking the directory — `find /app/node_modules /app/backend/node_modules -name package.json -maxdepth 4` — and take the name/version from each manifest. Either way the answer must come from the image. Record which method you used and why in the runbook; the choice is a fact a later session needs.
>
> Confirm or refute, in writing, the hoisting question from *Why the obvious approach is wrong* §1: **is `postcss` (and the rest of the SPA's production tree) present in the runtime image?** If it is, that is a finding in its own right and belongs in the runbook and in the backlog — the API image carrying the SPA's compiler is a supply-chain surface nobody chose. Do not fix it in this feature; file it.
>
> **Step 2 — write `scripts/audit-production.mjs`** and wire it as `audit:prod` in the root `package.json`. It runs `npm audit --omit=dev --json`, intersects the advisory package set with the shipped set from Step 1, applies `.audit-exceptions.json`, prints a table of what remains, and exits `1` if anything `high` or `critical` survives. It must fail loudly, not silently pass, when it cannot determine the shipped set — a gate that degrades to "no findings" when Docker is unavailable is worse than no gate. Give it a documented `--shipped-from=<file>` so CI and a developer without Docker can both run it against a committed snapshot, and make the snapshot's staleness visible in the output.
>
> `.audit-exceptions.json` is an array of `{ "id": "GHSA-…", "package": "…", "reason": "…", "expires": "YYYY-MM-DD" }`. An entry whose `expires` is in the past fails the run with a message saying so.
>
> **Step 3 — triage, then remediate.** Take the 18 advisories one at a time. For each: is the package in the shipped set, and is the vulnerable code path reachable from a request this application serves? The ones needing the most care, because their input is genuinely attacker-influenced here:
> - **`re2`** — the advisories describe an out-of-bounds heap read and a non-advancing global match. In this application the *pattern* is author-supplied and the *subject* is a respondent's answer value, both attacker-influenced in the relevant sense. Assume reachable unless you can show otherwise; the fix range is `>1.26.0`, inside `^1.24.1`.
> - **`multer`** — five DoS advisories on the upload path (`upload.ts:49`).
> - **`nanoid`** — the advisories concern zero/negative sizes; this codebase calls `nanoid(12)` and `nanoid(8)` with literals. Say that in the triage rather than bumping and moving on, because it is the shape of argument the runbook is for.
> - **`qs` / `body-parser` / `express`** — request parsing, inside `^4`.
>
> Then apply the updates. Prefer targeted `npm install <pkg>@<version>` over a blanket `npm audit fix`, so the diff to `package-lock.json` is reviewable and a regression is attributable. **After the updates, run `npm run check:node` and read its output** — it is the check that catches a `re2` binary that no longer loads, and it must be run inside the image too:
> ```bash
> docker build -f Dockerfile.backend --target runtime -t vuepdf-api .
> docker run --rm vuepdf-api node -e "require('re2'); require('bcrypt'); console.log('native ok')"
> ```
> A pass on Windows says nothing about `node:22-bookworm`; run both.
>
> **Step 4 — the gate.** Add a `dependency-audit` job to `.github/workflows/test.yml` running `npm run audit:prod`. It uses `node-version-file: .nvmrc` like every other job in that file. It must be red only for findings the triage did not clear — verify that by running it against the branch before opening the PR, and say in the PR what it reports.
>
> **Step 5 — the policy.** Add `.github/dependabot.yml`: weekly, npm ecosystem, root directory (workspaces are covered by the root lockfile), with production and development dependencies in separate groups so a security bump is not buried under a test-runner bump. Do not enable auto-merge.
>
> **Step 6 — write `docs/runbooks/dependency-audit.md`**, following the shape of `docs/runbooks/backup-and-restore.md`: what the audit measures and what it deliberately does not, the triage table with the date, how to run it, how to add an exception and why an exception expires, and what to do when Dependabot opens a pull request.
>
> **Do not touch**: `pattern-validator.ts`'s logic or its call sites; `asyncHandler`; Express's major version; anything in `docs/sot/` beyond the sync below; the coverage or lint gaps in the CI table.
>
> **Verify**: `npm run check:node`, `npm run test:backend`, `npm run test:frontend`, `npm run test:integration`, `npm run test:e2e`, `npm run build --workspace=frontend`, `cd backend && npx tsc --noEmit`, `cd backend && npm run typecheck:tests`, `npm run audit:prod`, and both Docker builds above. Report the real output of each — if a suite fails after a bump, that is the finding, not a detail to smooth over. There is no failing-test-first requirement here because this is not a behavioural bug fix; the equivalent obligation is that `audit:prod` was **seen to fail** on the unremediated lockfile before the updates were applied. Record that observation in the runbook.
>
> **On the way out**: run the `sot-sync` skill. Update the *What CI still does not do* table in `docs/sot/08-operations.md` — the "No dependency or secret scanning" row now covers only secret scanning, and its stale "15 production advisories" figure goes with it. Add a short subsection to [08-operations](../docs/sot/08-operations.md) on the audit gate and the exception file, linking the runbook. Note the `re2` version constraint in [04-backend-patterns §8](../docs/sot/04-backend-patterns.md) if the bump changes anything a caller can observe. Remove the *Production dependency audit is red* row from `docs/BACKLOG.md`, and the *Production build must generate the Prisma client before pruning devDependencies* row too — `Dockerfile.backend` already generates in the `build` stage and prunes afterwards, so that row was closed by [`features/0031`](0031-production-deployment.md) and left behind. File whatever Step 1 turns up about hoisting, plus secret scanning. Set this file to `**Status:** done` with an Outcome section saying what was fixed, what was excepted and until when.

## Outcome

**Done.** 52 blocking findings to 0; the image went from 343 packages to 304. All ten goals met, and the two most useful things the work produced were not in the plan.

**The spec's own central hypothesis was wrong, and the verification is why that matters.** It reasoned that `postcss`'s four highs described the SPA's build toolchain and shipped nowhere. Enumerating the built image showed the opposite: `Dockerfile.backend`'s runtime stage copies the **hoisted** `/app/node_modules`, `npm prune --omit=dev` keeps every workspace's production tree, and so `vue`, `@vue/compiler-sfc` and `postcss` were inside the API image. `notShipped` was **0** — every one of the 18 advisory packages shipped, and the intersection the gate is built around filtered nothing on its first run. It still earns its place, because it is what will filter `vitest`, `vite` and `ws` on the next run, and because determining the shipped set is what found everything below. The surface itself is filed rather than fixed: removing it means installing only the backend workspace for the runtime stage, which is a packaging change wanting its own review.

**Two things went wrong while doing the work, and both are the feature justifying itself.** A blanket `npm update` moved `pdfjs-dist` from `5.4.530` *into* the `>=5.6.83 <6.2.108` advisory band — a dependency update that created a vulnerability. And the `bcrypt` 5→6 bump changed npm's hoisting enough that `/app/backend/node_modules` ceased to exist, breaking the image build outright; the stage now creates the directory so that no future update can do it again. The second surfaced as the gate's **exit 2** — the deliberate refusal to report "no findings" when the shipped set is unknown — rather than as a green build over a broken image.

**`bcrypt` 5→6 was the single highest-leverage change and the only real risk.** Replacing `@mapbox/node-pre-gyp` with `node-gyp-build` cleared `tar@6`, `minimatch@3`, `brace-expansion@1`, `rimraf` and `glob` — 24 findings including the only critical. What a bcrypt major can break is the one thing that must not break: every stored `passwordHash` was written by bcrypt 5. `backend/tests/password-hash-compatibility.spec.ts` holds three hashes generated by `bcrypt@5.1.1` **before** the upgrade and committed as fixtures, run green against bcrypt 5 first so it is known not to be a tautology, and verified again inside `node:22-bookworm-slim` because a pass on Windows says nothing about the image.

**What was accepted, and it is a deliberate limit rather than an omission.** `GHSA-ggr8-5vv4-36mx` (`deepmerge-ts`, and `@prisma/config`/`prisma` indirectly) has no in-range fix — `@prisma/config` pins `deepmerge-ts` to exactly `7.1.5` — and is not reachable: `require('@prisma/client')` loads neither module, and the only loader is the Prisma CLI reading a `prisma.config.*` file this repository does not have. It carries an exception expiring **2026-12-01**, and the expiry was tested by setting it in the past and watching the run fail. The two `qs` moderates need no exception because only `high` and `critical` gate, and they cannot be fixed inside Express 4 — filed with the Express 5 row.

**Verified** (all real output, all green): `check:node`; backend 30 files / 383 tests; frontend 56 / 479; integration 25 passed + 3 skipped / 250 passed + 10 skipped against a real PostgreSQL; e2e 53 passed; `tsc --noEmit` and `typecheck:tests` clean; `build --workspace=frontend` clean; both Docker targets build; `bcrypt` and `re2` load and work inside the runtime image. `audit:prod` was seen to **fail** on the unremediated lockfile (exit 1, 52 blocking) before any change was applied, and passes now.

Procedure, the full triage table and the Dependabot policy: [`docs/runbooks/dependency-audit.md`](../docs/runbooks/dependency-audit.md).

**A third thing went wrong, and it was found only in CI — every local verification above passed while `npm ci` could not run at all.** `re2@1.26.1` narrowed its own `engines` to `^22.22.2 || ^24.15.0 || >=26.0.0`, and `.nvmrc` still said `22.12.0`. Every CI job installs the version in `.nvmrc`, `.npmrc` sets `engine-strict=true`, and an unsatisfied `engines` under `engine-strict` is a **failed install**, not a warning — so all four jobs died at their first step. It passed locally because the developer's Node was already `22.23.2`, which satisfies the new range: the guard that exists precisely so developers and CI run the same thing was defeated by a dependency moving its floor underneath a pinned version nobody re-read. Fixed by raising the floor to `>=22.22.2` in the root `engines` and `.nvmrc` to `22.23.2`. **The lasting lesson is that `re2`'s `engines` is a moving input to this repository's supported Node version** — read it after any `re2` bump and move `.nvmrc` and `engines` together, recorded in [08-operations](../docs/sot/08-operations.md#re2-is-a-native-dependency).

**Not done, and filed:** the `pdfjs-dist` 5→6 major; removing the SPA's tree from the API image; secret scanning; base-image scanning; `qs` via Express 5.
