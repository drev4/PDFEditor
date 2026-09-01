# 0026 — `asyncHandler`, and something that notices when it is missing

**Status:** done
**Priority:** P1 (see [`docs/BACKLOG.md`](../docs/BACKLOG.md) — *No `asyncHandler` wrapper, so every async route still depends on its own `try`/`catch`*)
**Branch:** `feature/0026-async-handler`
**Related:** [04-backend-patterns](../docs/sot/04-backend-patterns.md) · [08-operations](../docs/sot/08-operations.md) · [09-quality-and-testing](../docs/sot/09-quality-and-testing.md) · [`features/0016`](0016-object-storage-for-uploaded-pdfs.md) · [`features/0017`](0017-job-queue-for-pdf-embedding.md) · [`features/0025`](0025-structured-logging.md)

## Context

Express **4.21.2** does not forward a rejected promise from an `async` handler. The handler rejects, Express never learns, and the request hangs until something times out; on Node 22 the rejection also reaches `process.on('unhandledRejection')`, which without a guard is `process.exit(1)`.

**It has shipped once already.** [`features/0016`](0016-object-storage-for-uploaded-pdfs.md) introduced exactly that on the **unauthenticated** signed-PDF route — the one anybody holding a link can call.

Half of the problem is closed. [`features/0017`](0017-job-queue-for-pdf-embedding.md) added `src/process-guards.ts`, installed by both entrypoints, which logs an unhandled rejection and keeps the process alive rather than exiting. So a forgotten `try`/`catch` no longer takes the server down.

**What is not closed is the request.** It still never answers. The caller waits for a timeout, gets nothing, and — since [`features/0025`](0025-structured-logging.md) — there is a log line saying a rejection happened, with no request id on it, because the rejection escaped the request entirely.

**Measured before writing this, and it matters for how the work is framed:** every one of the **48** async route handlers in `backend/src/routes/` and `app.ts` currently *has* a `try`/`catch`, and so do the two `async` middleware in `middleware/apiKeyAuth.ts`. **Nothing is broken right now.** 47 of the 48 catches contain nothing but `next(error)`.

So this is not a bug fix and there is no live defect to reproduce. It is about the **forty-ninth** handler — the one somebody writes next month, in a hurry, on a route that reaches customer data.

**No prior attempt.** `git log --all` has no branch and no revert for this.

## Why the obvious approach is wrong

### 1. A wrapper you have to remember fails exactly like a `try`/`catch` you have to remember

This is the whole feature, so it goes first. Writing `asyncHandler`, wrapping 48 handlers and stopping there would **replace one act of discipline with another**: the next handler that forgets `asyncHandler(...)` is in precisely the position today's would be if it forgot `try`. The backlog row does not say "the handlers are unguarded" — it says *"nothing stops a route forgetting"*, and a wrapper on its own stops nothing.

So the wrapper ships **with something that notices**. A spec that reads `backend/src/routes/**/*.ts` and `app.ts` and fails when a handler passed to `router.get|post|put|patch|delete|use` is `async` and not wrapped. It is a lint rule in the only form this repository can currently run one — `npm run lint` lints nothing, there is no ESLint config, and that is its own backlog row.

A source scan is crude and this is the right place for it: the file it guards is uniform, the rule is one line, and the failure it prevents is a route that silently stops answering.

### 2. Express 5 is the real alternative, and dismissing it without checking would be dishonest

Express 5 forwards rejected promises to the error handler natively. No wrapper, no discipline, nothing to remember — strictly better than what this spec proposes, on the axis this spec cares about.

The usual blocker is `path-to-regexp` v8, which removed regex paths, optional `:param?` segments and bare `*` wildcards. **This repository has none of them**: all 41 route paths were listed and every one is a literal or a plain `:param`. `req.query` is never assigned. `res.sendFile` is not used — the PDF route streams deliberately. So the usual reasons to refuse do not apply here.

It is still not this change, for one reason that is about review rather than about Express: it alters the behaviour of **every route and every middleware at once** — `helmet`, `cors`, `cookie-parser`, `express-rate-limit`, the raw-body Stripe mount that must stay above `express.json()` — and the places the suites are thinnest are exactly the ones the backlog says hide this class of bug. That is a dependency upgrade with its own review, its own revert, and its own spec.

**File it.** A row in `docs/BACKLOG.md` saying Express 5 makes this wrapper redundant, that the path syntax was checked and is clear, and that the wrapper is what closes the hole meanwhile. Whoever does the upgrade should delete this feature's wrapper in the same change, and the note is how they will know they may.

### 3. Three `catch` blocks do more than `next(error)`, and removing them would create bugs

47 of 48 are `catch (error) { next(error) }` and unwrap mechanically. The exceptions are not:

- `routes/forms.ts` — the field sync after a PDF read logs and continues, because a form that cannot be re-read from its PDF still has fields in the database ([04-backend-patterns §5](../docs/sot/04-backend-patterns.md), best effort);
- `routes/upload.ts` — extraction failure warns and continues, because an upload with no extractable AcroForm is a normal PDF, not an error;
- `routes/organizations.ts:557` — a bare `catch {}` inside `callerFromHeader`, a **helper**, not a handler at all: an expired or forged token there means "not signed in", not an error, and turning it into one would break opening an invitation link in a browser whose session has lapsed.

None of the three is the outer `try` of a route, and none is the wrapper's business. They must survive untouched — unwrapping them would turn a deliberately swallowed best-effort failure into a 500 the customer sees, which is the opposite of what those comments spent paragraphs arguing.

### 4. Middleware mounted with `.use()` is exposed exactly like a handler

`identifyApiKey` and `requireApiAccess` (`middleware/apiKeyAuth.ts`) are `async` and mounted on the `/api/v1` router. They both have a `try`/`catch` today, and if either lost it the failure would be the same hang — on the router that customers integrate against.

So the wrapper must support the 3-argument middleware signature as well as a handler, and the scan in trap 1 must cover `.use(...)` and the middleware directory, not only `router.get(...)`.

### 5. The wrapper must not answer twice

A handler that has already written a response and then rejects — a stream that fails mid-write, which is a real shape on the PDF route — must not have `next(err)` try to send a second response. Express's default handler delegates to closing the connection when `res.headersSent`, and `middleware/errorHandler.ts` currently does **not** check it: it would call `res.status(...)` on a response already sent.

Check `res.headersSent` in the error handler and log-and-delegate when it is true. It is a small thing and it is the one the wrapper makes reachable.

## Goal

Checkable when the work is done:

1. `backend/src/middleware/asyncHandler.ts` exports a wrapper that takes an `async` handler or middleware and returns one whose rejection reaches `next`. It preserves the request/response types the routes already use, so no handler needs a cast.
2. Every `async` handler in `backend/src/routes/**` and `app.ts` is wrapped, and every `async` middleware mounted with `.use()` is wrapped.
3. The outer `try`/`catch` that did nothing but `next(error)` is gone from those handlers. The three blocks named in trap 3 are unchanged.
4. **A test fails when a handler is added without the wrapper.** It reads the route sources, and its own failure message names the file and the line.
5. A deliberately unguarded async handler mounted on a throwaway app answers **500** rather than hanging — the test that fails before the wrapper exists.
6. `middleware/errorHandler.ts` checks `res.headersSent` and does not attempt a second response.
7. Every existing route answers exactly as it did: same statuses, same bodies. The suites are the evidence, and none of their expectations change.
8. A backlog row records that Express 5 makes the wrapper redundant, that the route syntax was checked and is compatible, and that the upgrade should remove it.
9. `npm run test:frontend`, `npm run test:backend`, `npm run test:integration`, `npm run test:e2e`, `npm run build --workspace=frontend` and `cd backend && npx tsc --noEmit` all pass.

## Out of scope

- **Upgrading to Express 5.** Trap 2, and it gets its own row.
- **ESLint.** The scan in trap 1 is a test, not a lint rule, precisely because there is no ESLint config; adding one is a separate P1 row.
- **`src/services/**` and the workers.** A service is called by something that already handles its rejection — the queue's own `failed` handler, or a wrapped route. `process-guards.ts` is the backstop there and is already built.
- **Changing any error response.** Same statuses, same bodies. If a suite expectation changes, something is wrong with the change and not with the suite.
- **The frontend.** Unrelated.

## Execution prompt

> Add `asyncHandler`, apply it everywhere, and add the test that notices when somebody does not. Apply `backend-endpoint-pattern` for handler shape and `sot-sync` on the way out.
>
> **Write the failing test first.** In `backend/tests/`, mount a throwaway Express app with one `async` handler that rejects, and assert the request answers **500**. Run it before the wrapper exists and watch it **hang and time out** rather than fail cleanly — that hang is the defect, and seeing it is the point. Then write the wrapper and watch the same test answer 500.
>
> **Read first.** `backend/src/middleware/errorHandler.ts` — where a wrapped rejection lands, and the `res.headersSent` gap in trap 5. `backend/src/middleware/apiKeyAuth.ts` — the two `async` middleware, and why `.use()` is as exposed as a route. `backend/src/routes/forms.ts` and `routes/upload.ts` — the inner best-effort catches that must survive. `backend/src/routes/organizations.ts` around line 557 — the bare `catch {}`.
>
> **Build.** `middleware/asyncHandler.ts`, typed so `asyncHandler(async (req: AuthRequest, res, next) => { … })` needs no cast at any existing call site — `AuthRequest` and `ApiKeyRequest` both flow through. Then convert: wrap the handler, delete the outer `try {` / `} catch (error) { next(error) }`, re-indent. 48 handlers and 2 middleware, mechanically, **checking each diff** — the three in trap 3 are the ones to slow down for. Add the `res.headersSent` check to `errorHandler`.
>
> **The scan.** `backend/tests/async-handler-coverage.spec.ts`: read every file under `src/routes/` plus `src/app.ts` and `src/middleware/apiKeyAuth.ts`, find each `async (` handler passed to a router method or `.use(`, and assert it is preceded by `asyncHandler(`. Make the failure message name the file and line, because a green-to-red change here will be somebody's first encounter with this rule. Keep the regex boring and the file list explicit; a clever scan that silently matches nothing is worse than no scan, so include a **negative control**: a fixture string that the scan must flag, asserted in the same spec.
>
> **Verify.** All four suites, both type checks. The suites are the real evidence here: this touches every route in the product and **not one expectation should change**. If one does, stop — the conversion is wrong, not the test. Then by hand: `curl` a route that 404s and one that 400s, and confirm the bodies are identical to `develop`.
>
> **On the way out.** Run `sot-sync`. [04-backend-patterns](../docs/sot/04-backend-patterns.md) gains the wrapper as the handler shape — its example handler currently shows `try`/`catch`, and that example is what the next handler will be copied from, so it is the most important edit in this feature. [09-quality-and-testing](../docs/sot/09-quality-and-testing.md) records the coverage scan and what it is for. Add the Express 5 row to `docs/BACKLOG.md`, remove the row this closes, set this file to `**Status:** done` with an Outcome, and run `ship-checklist`.

## Outcome

Built as specified. 48 handlers and 2 middleware wrapped, 47 redundant `try`/`catch` blocks removed, and **not one test expectation changed** — which was criterion 7 and is the only evidence that mattered for a change touching every route in the product.

**The failing test failed the way the spec said it would: it hung.** Written against `develop` it did not go red, it timed out at 5000ms and produced an `Unhandled Error` beside it. That is the defect exactly — the request is never answered — and it is worth having seen, because a reviewer reading "adds error handling" would not picture a hang.

**Trap 5 was real and measurable.** Before the `res.headersSent` guard, an error after the response had started made the error handler throw `Cannot set headers after they are sent to the client` — a crash on top of a failure. It was measured with a throwaway handler rather than assumed, and the test now asserts the real outcome: the connection is aborted mid-body (which is what a broken stream *is*) and the server logs why, once.

**Two typing consequences the spec did not predict.** `asyncHandler` erases the request-parameter types Express derives from the path string, so `req.params.token` and `req.params.shareId` became `string | string[]`. Two sites needed an annotation. It fails loudly at the use site rather than silently, which is the acceptable half of the trade, and it is recorded in the wrapper's own comment so the next person meets it as a note rather than a surprise.

**The coverage scan earned its negative control within a minute of existing.** The first draft matched the literal `asyncHandler(` and flagged both `/api/v1` middleware, which are written `asyncHandler<ApiKeyRequest>(`. The control is now in the spec as a fixture the scan must flag, so a regex that quietly stops matching cannot report a clean codebase for ever.

**The most important edit is not in `src/`.** `.claude/skills/backend-endpoint-pattern/SKILL.md` showed a handler with `try`/`catch` and said *"every path ends in `next(error)`"*. That skill is what the next handler gets written from, so it mattered more than the SoT document did; both are updated, and `04-backend-patterns §1` now carries the rule and the three deliberate exceptions.

**Verified:** backend 21 specs / 248 tests, integration 221 (211 passed, 10 skipped), frontend 47 / 393, E2E 53, `npm run build --workspace=frontend`, `tsc --noEmit` and `typecheck:tests`. By hand against a running server: a 401, a 404 and a 400 return byte-identical bodies to `develop`.

**Express 5 is filed rather than done**, with the compatibility check recorded so nobody repeats it: all 41 route paths are literals or plain `:param`, `req.query` is never assigned, `res.sendFile` is unused. Whoever upgrades should delete `middleware/asyncHandler.ts` and `tests/async-handler-coverage.spec.ts`, and both files say so themselves.
