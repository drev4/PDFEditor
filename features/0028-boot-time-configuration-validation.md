# 0028 — Boot-time configuration validation

**Status:** in progress
**Priority:** P1 (see [`docs/BACKLOG.md`](../docs/BACKLOG.md) — *Validate all configuration at boot with Zod*)
**Branch:** `feature/0028-boot-time-configuration-validation`
**Related:** [08-operations](../docs/sot/08-operations.md) · [10-saas-roadmap → D2](../docs/sot/10-saas-roadmap.md#what-comes-next) · [04-backend-patterns](../docs/sot/04-backend-patterns.md)

## Context

Exactly one environment variable can stop this process from starting. `backend/src/app.ts:25` throws when `JWT_SECRET` is missing, and that is the whole of the configuration validation in the backend. Everything else is read where it is used, defaulted, and — at best — logged.

That is not an oversight for the tunables. `backend/src/config/env.ts` is deliberate and documented: `envInt` and `envBool` warn and fall back, because a typo in `EMBED_WORKER_CONCURRENCY` must not take the service down, and every caller picks the safe direction as its default. **That contract stays.** What is missing is the other half — the variables that have no safe default, where a wrong value produces no error at all and a symptom days later.

[08-operations](../docs/sot/08-operations.md) already documents four of them, individually, because each was discovered separately:

- **`STRIPE_WEBHOOK_SECRET`** wrong ⇒ every event fails signature verification and answers `400`. Nothing logs an error, because a `400` is this API answering correctly. The symptom is *subscriptions that were paid for and never activated*, visible only in Stripe's dashboard.
- **`BASE_URL`** wrong or absent ⇒ `services/pdf-url.ts:60` falls back to `http://localhost:3000` and mints signed PDF links pointing at the container's own loopback. Every uploaded PDF is unreachable and nothing errors.
- **`WEBHOOK_SIGNING_KEY`** the wrong length ⇒ `services/webhooks.ts:65` logs once and returns `null`, and webhooks are *silently disabled* — treated exactly as if the deployment had never configured one.
- **`STRIPE_PRICE_PRO` / `STRIPE_PRICE_TEAM`** wrong ⇒ a paying customer resolves to the **free** plan, deliberately, with one `console.error` nobody is watching.

None of those is a bug in the module that owns it — each chose the least-bad behaviour available *at the point where the value is read*, which is usually the middle of serving a request. The point where the deployment can still be fixed cheaply is the boot, and nothing looks at the environment there.

This is **D2** in the roadmap's D track, and its timing is the whole reason it is next: the product has never been deployed anywhere ([08-operations §1](../docs/sot/08-operations.md) — no production environment, no `Dockerfile`, no infrastructure definition), a private beta is committed for 2026-09-30, and **the first deploy is exactly when a variable is wrong for the first time**. Doing this after D1 means finding out from a customer.

## Why the obvious approach is wrong

Four traps, in the order somebody would hit them.

### 1. Do not `parse()` a schema at import time in `app.ts`

`app.ts` calls `dotenv.config()` at line 23 and **every one of the 21 backend spec files imports the app**. A strict schema evaluated there would validate the *developer's local `.env`* on every `npm run test:backend` and turn a personal misconfiguration into a red suite that has nothing to do with the code under test.

This repository has already been bitten by that exact bleed and the scar is in `backend/vitest.config.ts`: `DEV_PLAN_KEY`, `REDIS_URL` and the four Stripe variables are pinned to empty or fake values there, with a comment on each explaining that `src/app.ts` calls `dotenv.config()` so a local `.env` reaches every suite — *"which it did, and four of them failed before this line existed."*

Validation belongs at the **process boundary**, which is `backend/src/index.ts` and `backend/src/worker.ts`. Those two files are entered by a real process and imported by no test.

### 2. Do not refactor every read into a typed config object

The tempting version of this feature builds `config.ts` exporting a frozen, parsed object and rewrites ~20 call sites to use it. Do not. Several reads are **deliberately lazy and re-read `process.env` per call**, and tests depend on that:

- `middleware/rateLimit.ts:258` passes `limit: () => envInt(config.limitEnv, config.limitDefault)` — a function, evaluated per request, because `tests/rate-limit.spec.ts` tightens limits per test through `process.env` in the same process.
- `services/webhooks.ts:60` reads the signing key per call, and says why in its comment: *"like every other configuration in this codebase that a test may want to set."*
- `services/plans.ts` reads `DEV_PLAN_KEY` per call for the same reason.

Making those eager is a large, risky refactor that breaks tests in service of tidiness. **This feature adds a check; it does not change how anything is read.** If a typed config object is still wanted afterwards, file it as its own backlog row.

### 3. Do not gate strictness on `NODE_ENV === 'production'`

This is the failure mode `services/plans.ts:234` already reasoned about at length for `DEV_PLAN_KEY`, and the reasoning transfers exactly: `NODE_ENV` unset, misspelled, or dropped by a process manager is an ordinary way a real deployment ends up in the wrong branch — and here that branch is *skip validation entirely*, in precisely the deployment that needs it.

Use the same **allowlist** shape: validation is lenient when `NODE_ENV` is exactly `development` or `test`, and **strict in every other case, including unset**. `plans.ts` already exports the idea as `OVERRIDE_ENVIRONMENTS = ['development', 'test']` (line 242); read it before writing a second copy, and prefer sharing the constant to duplicating the list.

Note the direction matters and is the opposite of the intuition: the *safe* default here is to be strict, so the ambiguous cases must fall into strict.

### 4. Do not let the variable list drift

A schema naming variables is a second source of truth about which variables exist, and it will fall behind the first one the next time somebody adds a `process.env.SOMETHING_NEW`. This repository already has an answer to that shape of problem and it should be reused rather than reinvented: `backend/tests/async-handler-coverage.spec.ts` walks `src/` and fails when a handler is not wrapped, explicitly as *"a lint rule in the only shape this repository can run one"* — because `npm run lint` lints nothing.

Do the same here: a spec that scans `src/` for `process.env.X`, `envInt('X'` and `envBool('X'` and fails when a name it finds is absent from the schema. Include the negative control the existing spec has, so a scan that silently matches nothing cannot pass.

### A deliberate deviation from the backlog row

The row says *"Validate all configuration at boot with **Zod**"*, and this spec does not require Zod. The reason: two of the goals below — returning **every** problem rather than the first, and every message naming its **consequence** rather than its type — are both things a hand-written list of checks does directly and a Zod schema does through `flatten()` plus a custom message on every field. Zod earns its place at the request edge, where the parsed value is then used with its inferred type ([04-backend-patterns §2](../docs/sot/04-backend-patterns.md)); here nothing consumes the parsed output, because every call site keeps reading `process.env` itself (§2 above).

Use Zod if it comes out cleaner once written. It is not forbidden — it is simply not the requirement, and the requirement is the message quality.

## Goal

1. A new module `backend/src/config/validate-env.ts` exports:
   - `validateEnv(env: NodeJS.ProcessEnv, role: 'api' | 'worker'): string[]` — **a pure function** returning every problem it found, in the order the variables are documented. It reads nothing from `process.env` itself, which is what makes it testable without mutating the process.
   - `assertEnv(role: 'api' | 'worker'): void` — calls the above with `process.env`, and when the list is non-empty logs every entry through `services/logger.ts` and exits with a non-zero code.
2. `backend/src/index.ts` calls `assertEnv('api')` after `dotenv.config()` and **before** `app.listen`. `backend/src/worker.ts` calls `assertEnv('worker')` after `dotenv.config()` and before `createEmbedWorker()`.
3. **All problems are reported, not the first.** A deploy that is missing three variables must learn all three from one restart.
4. **Strictness follows an allowlist**: lenient when `NODE_ENV` is exactly `development` or `test`; strict otherwise, including when it is unset. In lenient mode the function returns `[]` for everything in the *required-in-strict-mode* group below, and still reports the *always-wrong* group.
5. Required in strict mode, both roles:
   - `JWT_SECRET` — present, and at least 32 characters.
   - `DATABASE_URL` — present, and parses with a `postgresql:` or `postgres:` scheme.
   - `BASE_URL` — present, parses as an absolute `http:`/`https:` URL, and has no trailing slash *or* is normalised the way `services/pdf-url.ts` expects (read it; do not guess).
   - `FRONTEND_URL` — present, and parses as an absolute `http:`/`https:` URL.
6. Always wrong, in every mode and both roles — these are shape errors, not missing values, and a developer benefits from them as much as a deployment:
   - `PDF_STORAGE_DRIVER` set to anything other than `local` or `s3`.
   - `PDF_STORAGE_DRIVER=s3` with no `PDF_STORAGE_BUCKET`.
   - `WEBHOOK_SIGNING_KEY` present but not decoding to exactly 32 bytes of base64.
   - `REDIS_URL` present but not parsing with a `redis:` or `rediss:` scheme.
   - `TRUST_PROXY_HOPS` present but not a non-negative integer.
   - `STRIPE_SECRET_KEY` present with no `STRIPE_WEBHOOK_SECRET`, or with neither `STRIPE_PRICE_PRO` nor `STRIPE_PRICE_TEAM`.
7. Every message names the variable, says what was expected, and says what the consequence is — in the voice `services/pdf-storage.ts:377` already uses (*"Refusing to start rather than fall back to local disk, which would accept uploads and lose them on the next deploy"*). A message that only says "invalid" makes the operator read this repository.
8. `backend/tests/config-validate-env.spec.ts` covers, at minimum: strict mode rejects each required variable's absence; lenient mode accepts an empty environment; `NODE_ENV` unset is **strict**; `NODE_ENV="staging"` is strict; each always-wrong rule fires in lenient mode; a fully valid strict environment returns `[]`.
9. `backend/tests/config-coverage.spec.ts` scans `backend/src/**/*.ts` for `process.env.NAME`, `envInt('NAME'` and `envBool('NAME'`, and fails naming any variable absent from an explicit list in `validate-env.ts` of *every* variable this backend reads — including the ones it deliberately does not check, which are listed as knowingly unchecked with a one-line reason each. The negative control asserts the scan finds a variable that is present.
10. [08-operations](../docs/sot/08-operations.md) gains a short section stating what refuses to boot and what only warns, and its environment table marks which rows are validated.
11. Every existing suite still passes untouched: `npm run test:backend`, `npm run test:integration`, `npm run test:frontend`, `npm run test:e2e`.

## Out of scope

- **A typed config object, and any change to how values are read.** `envInt`/`envBool` keep their warn-and-fall-back contract and every lazy read stays lazy. Reason in *Why the obvious approach is wrong* §2; file the refactor separately if it is still wanted.
- **The `JWT_SECRET` throw in `app.ts:25`.** Leave it exactly where it is. It is what makes the suites set the variable, and moving it changes what 21 spec files depend on. The new validator is a superset that runs at the process boundary; the overlap is deliberate and costs nothing.
- **The worker's `REDIS_URL` check** (`worker.ts`, inside `main()`). It already exits `1` with a message explaining why a worker without a queue refuses to idle. Do not duplicate it in the validator — two different messages for one condition is worse than one.
- **`DEV_PLAN_KEY` becoming fatal.** It is currently ignored-and-logged outside `development`/`test`, which is a deliberate decision in `plans.ts` with its own reasoning. Changing it is a behaviour change, not validation. Its removal is already filed in [`docs/BACKLOG.md`](../docs/BACKLOG.md).
- **Frontend build-time configuration.** `frontend/vite.config.ts` builds the CSP at build time; that is a different problem with a different failure mode.
- **Checking that a worker is actually running** when `REDIS_URL` is set. Real, filed, and not solvable by reading the environment.
- **D1 itself** — the deployment target, the `Dockerfile`s, the infrastructure. This feature is the check that runs inside whatever D1 produces.

## Execution prompt

> Add boot-time configuration validation to the VuePDF backend. Apply the `backend-endpoint-pattern` skill's conventions for error messages and the `sot-sync` skill on the way out.
>
> **Read first, in this order, and do not write code until you have:**
> 1. `backend/src/config/env.ts` — the existing `envInt`/`envBool` contract. It does not change.
> 2. `backend/src/app.ts:23-45` — `dotenv.config()`, the `JWT_SECRET` throw, and the `TRUST_PROXY_HOPS` comment.
> 3. `backend/src/index.ts` and `backend/src/worker.ts` — the two process entrypoints, and the only places this validation may run.
> 4. `backend/src/services/plans.ts:230-245` — `OVERRIDE_ENVIRONMENTS` and the allowlist reasoning. Share the constant rather than copying the list.
> 5. `backend/src/services/pdf-storage.ts:370-410` — the refuse-to-boot precedent and the voice its messages use.
> 6. `backend/src/services/webhooks.ts:50-75` — why a wrong-length key disables webhooks silently.
> 7. `backend/vitest.config.ts` — the pinned test environment, and the comments explaining why each line exists.
> 8. `backend/tests/async-handler-coverage.spec.ts` — the scan-test pattern to copy for goal 9, including its negative control.
>
> **Build:**
> - `backend/src/config/validate-env.ts` with `validateEnv(env, role)` (pure, returns `string[]`) and `assertEnv(role)` (logs each problem via `services/logger.ts`, then `process.exit(1)`). Strictness is an allowlist on `NODE_ENV`: lenient only for exactly `development` and `test`.
> - The explicit inventory of every variable the backend reads, with the deliberately-unchecked ones listed and each carrying a one-line reason.
> - Calls in `index.ts` (after `dotenv.config()`, before `app.listen`) and `worker.ts` (after `dotenv.config()`, before `createEmbedWorker()`).
>
> **Do not touch:** `config/env.ts`'s behaviour, any call site that reads an environment variable, the `JWT_SECRET` throw in `app.ts`, or the worker's own `REDIS_URL` check.
>
> **Tests, written before the implementation is finished and run against a build that lacks it:**
> - `backend/tests/config-validate-env.spec.ts` — goal 8's cases. Because `validateEnv` takes an env object, pass literals; do not mutate `process.env`.
> - `backend/tests/config-coverage.spec.ts` — goal 9's scan, with the negative control.
>
> **Verify, all of them, and paste the real output:**
> ```
> npm run test:backend
> npm run test:integration        # docker-compose up -d first
> npm run test:frontend
> npm run test:e2e
> cd backend && npx tsc --noEmit
> npm run typecheck:tests --workspace=backend
> ```
> Then check the two behaviours a test cannot assert, by hand, and report what you saw. The primary shell here is PowerShell, so set the variables the way that shell does (`$env:NODE_ENV = 'production'`) or run the command through the Bash tool — either is fine, but a `VAR=x cmd` prefix is a parser error in PowerShell:
> - Start `src/index.ts` with `NODE_ENV=production` and a deliberately broken environment (a short `JWT_SECRET`, no `BASE_URL`). It must **exit non-zero** and name `JWT_SECRET` *and* every other missing variable in one run — not just the first.
> - Run `npm run dev` with the developer's ordinary `.env`. It must start exactly as before, with no new output.
>
> **On the way out:**
> - Update [08-operations](../docs/sot/08-operations.md): a section on what refuses to boot versus what warns, and the validated rows marked in the environment table. Remove its closing note that *"there is no startup validation of configuration beyond `JWT_SECRET`"*.
> - Remove the *Validate all configuration at boot with Zod* row from [`docs/BACKLOG.md`](../docs/BACKLOG.md).
> - Mark D2 done in [10-saas-roadmap](../docs/sot/10-saas-roadmap.md#what-comes-next).
> - Set this file to `**Status:** done` and record, under an `## Outcome` heading, anything found while doing it — especially any variable the scan turned up that nobody knew was being read.
>
> If any part cannot be completed, say which part and why. Do not describe partial work as finished.
