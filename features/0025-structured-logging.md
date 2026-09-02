# 0025 — Structured logging, so a failure can be found

**Status:** done
**Priority:** P1 (see [`docs/BACKLOG.md`](../docs/BACKLOG.md) — *Structured logging (`pino`) with request ids and redaction*, S9)
**Branch:** `feature/0025-structured-logging`
**Related:** [08-operations §Observability](../docs/sot/08-operations.md) · [07-security-and-privacy](../docs/sot/07-security-and-privacy.md) · [04-backend-patterns §5](../docs/sot/04-backend-patterns.md) · [09-quality-and-testing](../docs/sot/09-quality-and-testing.md) · [`features/0017`](0017-job-queue-for-pdf-embedding.md) · [`features/0020`](0020-outbound-webhooks.md)

## Context

The A track is closed and this is the first row of B, because it is the one that unblocks the most: [08-operations](../docs/sot/08-operations.md) lists it as **item 1** of minimum viable observability, error tracking and CSP violation reporting are both waiting on it, and the backlog names the practical consequence — *there is no way to answer "what happened to our submission at 14:32"*.

The log today is `console.log` / `warn` / `error` to stdout. That is not merely unstructured; it cannot express the two things this system most needs to say:

- **Which request a line belongs to.** With concurrent requests, interleaved lines about "a form" and "a job" cannot be tied to the submission a customer is asking about.
- **That something is fine.** `middleware/errorHandler.ts` logs 5xx with a stack and **nothing at all** for 4xx, and its own comment says why that compromise exists and what should replace it: *"Once `pino` lands, 4xx belongs at `info` with a request id — a distinction the bare console cannot express."* This feature is that sentence.

The silent failures make it concrete. The two best-effort PDF operations and the queued embed can fail permanently with no user-visible symptom ([04-backend-patterns §5](../docs/sot/04-backend-patterns.md)); the only signal is a log line nobody can correlate or search.

**The shape of the work, measured.** `grep -rn "console\." backend/src` finds **212** calls — but **150 of them are in `src/scripts/`**, one-shot CLI tools whose output is a human reading a terminal. The real surface is the other **62**, across `app.ts`, `index.ts`, `worker.ts`, `process-guards.ts`, `middleware/`, `routes/` and `services/`.

**No prior attempt.** `git log --all` has no logging branch and no revert; `pino` is in no `package.json`.

## Why the obvious approach is wrong

### 1. The runbook names exact log strings, and they are a contract

[08-operations](../docs/sot/08-operations.md) does not say "check the logs". It tells an operator to look for specific text, and those instructions are the only diagnosis path this product has:

| Line the runbook names | What it diagnoses |
|---|---|
| `[worker] pdf-embed worker started, waiting for jobs` / `[worker] pdf-embed worker stopped` | Whether a worker is alive at all — the silent failure [`features/0017`](0017-job-queue-for-pdf-embedding.md) documented |
| `embed job <id> done (form <formId>)` | Whether anything is consuming the queue |
| `EMBED GAVE UP` | A form whose stored PDF no longer matches its fields |
| `webhook delivery … will retry` / `WEBHOOK GAVE UP` | A customer's endpoint failing, and being given up on |
| `Rate limiting is counting in Redis (shared across every replica)` / `…in-memory (per process; …)` | Which store a process ended up with ([`features/0018`](0018-shared-rate-limit-store.md)) |

Rewording these while "improving the logs" would break every one of those instructions silently — the runbook would still be there, still confident, and no longer true. **Either the `msg` stays byte-identical, or [08-operations](../docs/sot/08-operations.md) is updated in the same commit.** Keeping the text and adding structured fields beside it is the cheaper half of that choice and the one to take.

### 2. `pino-http` logs the whole request by default, and that is the wrong default here

The obvious wiring is `pino-http`, which gives a request id and a child logger for free. What it also does by default is serialise `req` and `res` — **including headers**, which on this API means `Authorization` on every authenticated call and `Cookie` on the two that carry the refresh token.

`redact` can strip those, and redaction should be configured anyway. But the order matters: a design that logs everything and then removes the known-bad paths fails **open** — a header or body field nobody listed reaches the log. A design that logs only what it names fails **closed**.

So: a small `middleware/requestLog.ts` of our own that names its fields — method, route, status, duration, request id — and logs no headers and no body at all. Thirty lines, one fewer dependency, and the failure mode is the safe one.

### 3. Redaction is the second line of defence. The first is never logging bodies

The most sensitive thing this API handles is **answer values typed by members of the public** ([07-security-and-privacy](../docs/sot/07-security-and-privacy.md)). They arrive as `POST /api/responses` with `answers` keyed by field id — an object whose paths are *data*, not a fixed shape, so no `redact` path list can cover them.

**Nothing logs `req.body`, ever.** Not at debug, not behind a flag. `redact` for `authorization`, `cookie`, `password`, `token` and `secret` is configured as a backstop against a future line that forgets, and it is not permission to log the body because "it will be redacted". This is also why the delivery log stores no payloads ([`features/0020`](0020-outbound-webhooks.md)) — the same rule, one layer down.

### 4. An inbound `x-request-id` must not be adopted as the request id

Behind a proxy it is normal to continue an upstream trace, and the temptation is `req.id = req.headers['x-request-id'] ?? randomUUID()`. But this API is reachable directly, `TRUST_PROXY_HOPS` exists precisely because what is in front of it is deployment configuration, and a header a caller controls becomes: an id they can repeat to interleave their requests with somebody else's, unbounded text in every log line, and newlines if the log is ever read as text.

**Generate the id, always.** If an inbound `x-request-id` is present, log it once as a separate, length-capped field (`upstreamRequestId`) on the request's completion line. The trace survives and the id remains ours.

### 5. `src/scripts/` keeps `console`, and converting it would be a regression

Those 150 calls are a person running `npm run storage:migrate` and reading what happened. JSON lines with timestamps and levels are worse for that, not better, and a script is not a service: it has no request, no correlation and no aggregator. Leave them.

The line to draw is not "backend code" but **"is there an operator reading this, or a machine?"** — `src/scripts/**` is the first, everything else is the second.

### 6. Two entrypoints, and the worker is the one that needs this most

`index.ts` and `worker.ts` both install `process-guards.ts`, whose handlers are exactly the lines somebody will hunt for after an incident — an unhandled rejection that was survived, an uncaught exception that ended the process. Both must go through the logger with the process name as a field, and `installProcessGuards` already takes one.

Note the ordering hazard: the uncaught-exception handler exits after a 100ms tick "so the log line actually flushes". `pino` writes asynchronously. Keep the delay and verify the line actually appears — a guard that logs nothing before exiting is worse than the console it replaced.

## Goal

Checkable when the work is done:

1. `backend/src/services/logger.ts` is the only module that constructs a `pino` instance. `grep -rn "from 'pino'" backend/src` names exactly that file.
2. Every request gets an id; `middleware/requestLog.ts` attaches a child logger to the request and logs one completion line with method, route, status code, duration and the id.
3. **No log line contains a request body, an `Authorization` header or a `Cookie` header**, and a test asserts it for an authenticated request carrying answers.
4. `redact` is configured for `authorization`, `cookie`, `password`, `token` and `secret`, as a backstop rather than as the plan.
5. `errorHandler` logs 5xx at `error` with the stack **and the request id**, and 4xx at `info` — the distinction its comment has been waiting for. A 4xx no longer prints a stack trace, and now leaves a record.
6. Every `console.*` outside `src/scripts/` is gone: `grep -rn "console\." backend/src --include=*.ts | grep -v "src/scripts/"` returns nothing.
7. The six runbook strings in the table above appear **verbatim** as `msg` values, or [08-operations](../docs/sot/08-operations.md) is updated to the new text in the same commit. Either is acceptable; silence is not.
8. `LOG_LEVEL` selects the level, documented in [08-operations](../docs/sot/08-operations.md) with its default. The test environment is silent — running a suite prints no log lines that are not a test's own output.
9. Development output is readable by a person; production output is one JSON object per line.
10. `npm run test:frontend`, `npm run test:backend`, `npm run test:integration`, `npm run test:e2e`, `npm run build --workspace=frontend` and `cd backend && npx tsc --noEmit` all pass.

## Out of scope

- **Error tracking (Sentry or equivalent).** Item 2 of the same list in [08-operations](../docs/sot/08-operations.md), its own backlog row, and it needs an account and a DSN. This makes it cheap, it is not this.
- **CSP violation reporting.** Waiting on this, and it needs a decision about where reports go. Separate row.
- **Log aggregation, metrics, alerting, real health checks.** Items 3 and 4 of the same list, all needing infrastructure that does not exist.
- **The frontend.** `console` in `frontend/src` stays: a browser log is a different problem with a different answer, and that is what error tracking is for.
- **`src/scripts/`.** Trap 5.
- **Changing what is logged, beyond what conversion requires.** This feature makes the existing lines structured and correlatable. Adding new events — audit trails, business metrics — is a separate decision, and one of them (*no audit of who invited, removed or promoted whom*) is already filed.
- **`asyncHandler`.** The neighbouring P1 row, genuinely separate: this makes a failure findable, that one stops a rejected promise escaping in the first place.

## Execution prompt

> Give the backend a structured logger. There is no skill for this one; follow [04-backend-patterns](../docs/sot/04-backend-patterns.md) for module shape and `sot-sync` on the way out.
>
> **Read first.** `backend/src/middleware/errorHandler.ts` — the whole comment above `errorHandler`, which is the argument this feature completes. `backend/src/process-guards.ts` — both handlers and the reason they are asymmetric, including the deferred exit. [08-operations §Observability](../docs/sot/08-operations.md) and the runbook sections above it, for the exact strings in trap 1. `backend/src/index.ts` and `backend/src/worker.ts` — the two entrypoints. Then `grep -rn "console\." backend/src --include=*.ts | grep -v src/scripts/` for the 62 lines you are actually converting.
>
> **Build.** `services/logger.ts` exports one configured `pino` instance and nothing else constructs one: level from `LOG_LEVEL` (default `info`, `silent` when `NODE_ENV === 'test'`), `redact` per criterion 4, pretty transport only when `NODE_ENV === 'development'`, JSON otherwise. Then `middleware/requestLog.ts`: generate a request id with `crypto.randomUUID()`, attach `req.log = logger.child({ requestId })`, and on `res` finishing log one line naming method, the matched route (`req.route?.path` where available, never the raw URL with ids in it if you can avoid it), status, duration in ms, and `upstreamRequestId` when an inbound `x-request-id` was present — capped in length, never adopted as the id. Mount it in `app.ts` **before** the routes and after the body parsers, and skip `/health`, which a load balancer will call every few seconds forever.
>
> **Convert.** Every non-script `console.*` becomes a logger call at the right level: `error` for something broken, `warn` for a degraded-but-handled path (a bad env value, a swallowed best-effort failure), `info` for lifecycle. Inside a request, prefer `req.log` so the line carries the id. Keep every message string in trap 1 byte-identical and put the varying parts in fields beside it — `logger.info({ formId, jobId }, 'embed job done')` loses the runbook's grep; keep the sentence and add the fields.
>
> **Tests.** `backend/tests/` gains a spec for the logger and the request-log middleware: an authenticated request carrying answers produces a line with no `Authorization`, no cookie and no answer value in it — assert on the serialised line, not on the object, because that is what reaches a log file. Assert the 4xx/5xx split at the levels criterion 5 names. **29 specs currently spy on `console`** (`grep -rln "vi.spyOn(console" backend/tests frontend/src`); the backend ones that assert a converted module's output must assert on the logger instead — do not delete the assertion, move it. Frontend specs are untouched.
>
> **Verify.** All four suites and both type checks. Then by hand, because no test can: start the API with `NODE_ENV=development` and confirm the output is still readable; start it with `NODE_ENV=production LOG_LEVEL=info` and confirm one JSON object per line; force an uncaught exception in the worker and confirm the guard's line **appears before the process exits** — trap 6, and the one thing pino's asynchronous writing can quietly break.
>
> **On the way out.** Run `sot-sync`. [08-operations §Observability](../docs/sot/08-operations.md) is rewritten: it currently opens *"Currently: `console.log`…"*, which stops being true, and item 1 of its list is done — record `LOG_LEVEL`, the request id, what is never logged and why, and re-check every runbook string above it against the code. [07-security-and-privacy](../docs/sot/07-security-and-privacy.md) records that no request body is logged and that redaction is a backstop rather than the mechanism. [09-quality-and-testing](../docs/sot/09-quality-and-testing.md) notes that suites run silent. Remove the backlog row, and note in the two rows that were waiting on this — CSP reporting and error tracking — that their dependency is now met. Set this file to `**Status:** done` with an Outcome, then run `ship-checklist`.

## Outcome

Built as specified. All six traps were real, and two of them were caught by the tooling rather than by care.

**The type checker caught what a blind conversion would have lost.** `console.error('msg:', err)` and `logger.error('msg:', err)` look identical and are not: pino's signature is `(obj, msg)`, so the error object becomes a printf argument with no placeholder and is **dropped silently**. A regex swap of all 47 remaining calls left six multi-line sites that `tsc` refused — each one an error object about to disappear — and they were rewritten by hand as `logger.error({ err }, 'msg')`. Worth remembering: this conversion is only safe on a codebase that type-checks.

**`process-guards.spec.ts` turned trap 6 into an assertion instead of a manual check.** It runs a real child process, and it failed twice for two different real reasons: pino writes every level to **stdout**, not stderr, so the assertions moved; and the child inherited `NODE_ENV=test`, which silenced the logger — so the spec now sets `NODE_ENV=production` and `LOG_LEVEL=info` explicitly, and measures the guards rather than how the runner is configured. Its uncaught-exception test now proves the line survives the 100ms flush before `process.exit`, which the spec had listed as a thing to check by hand.

**Two self-inflicted wounds, both from the same script.** The regex that inserted `import { logger }` after "the last import line" put it *inside* a multi-line `import { … }` block in two specs, which esbuild reported as `Expected "as" but found "{"`. Fixed by hand. A cheaper lesson than it looks: the suites caught it immediately.

**Redaction is tested through the real configuration.** `REDACT` is exported from `services/logger.ts` and the spec builds a pino instance with it over a memory stream — a spec asserting one list against another list would only prove somebody typed the same thing twice. The stronger assertion is elsewhere: `request-log.spec.ts` checks that no `Authorization`, cookie, or answer value is ever *handed* to the logger, which is stricter than checking the bytes it writes, because redaction would hide a value that had still been collected.

**Verified:** backend 19 specs / 239 tests, integration 221 (211 passed, 10 skipped), frontend 47 / 393, E2E 53, `npm run build --workspace=frontend`, `tsc --noEmit` and `typecheck:tests`. By hand: `NODE_ENV=production LOG_LEVEL=info` boots to one JSON object per line, and the E2E suite's own dev server output shows the `pino-pretty` format, so both halves of criterion 9 were observed rather than assumed.

**The runbook strings all survive byte-identical** — `[worker] started, waiting for jobs`, `[worker] stopped`, `embed job … done`, `EMBED GAVE UP`, `will retry`, `WEBHOOK GAVE UP`, `Rate limiting is counting in …` — with structured fields added beside them, so every grep in [08-operations](../docs/sot/08-operations.md) still works. That was the cheaper half of trap 1 and it is the half that was taken.

**Not done, deliberately:** `frontend/src` still uses `console`, and the 150 calls in `backend/src/scripts/` still do too. Both are in Out of scope, and the second is the one somebody will be tempted to "finish" later — the line is whether an operator or a machine is reading.
