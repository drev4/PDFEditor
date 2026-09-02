# 0035 — Bounded pattern validation in the browser

**Status:** done
**Priority:** P1 — the open half of [`features/0004`](0004-safe-author-supplied-regex.md). The server case was closed; the respondent's browser was left running the author's pattern on a native engine
**Branch:** `feature/0035-bounded-pattern-validation-in-the-browser`
**Related:** [`features/0004`](0004-safe-author-supplied-regex.md), [`features/0007`](0007-security-headers-and-csp.md), [07-security-and-privacy](../docs/sot/07-security-and-privacy.md), [05-frontend-patterns](../docs/sot/05-frontend-patterns.md), [06-api-reference §`validation.pattern`](../docs/sot/06-api-reference.md)

## Context

[`features/0004`](0004-safe-author-supplied-regex.md) removed the ReDoS surface from the API: an author's `pattern` is compiled by RE2 through `backend/src/services/pattern-validator.ts`, never `new RegExp` at a call site, because a catastrophically backtracking pattern hangs the only thread the service has.

**The browser kept the native engine.** `frontend/src/composables/useFormValidation.ts:42` still does `new RegExp(field.validation.pattern)` and runs it against the respondent's input — and `frontend/src/views/PublicFormView.vue:281` calls it on every change to a field, on the public form, for an anonymous member of the public. The backlog filed this as lower severity because it burns the respondent's own tab rather than shared infrastructure, and because the call is already `try`/`catch`-wrapped.

**Both engines were compared directly against the code before writing this, and the result is worse than the backlog row assumes.** RE2 and JavaScript disagree in both directions, and one of the disagreements is not about syntax at all:

| Pattern | RE2 (what the server stores) | Native `RegExp` (what the respondent runs) |
|---|---|---|
| `^(a+)+$` | **accepted**, linear, 0.05 ms | **accepted**, catastrophic backtracking |
| `(?P<n>a)` | **accepted** | `SyntaxError` |
| `(?=.*\d).{8,}` | rejected — `invalid perl operator: (?=` | accepted |

The first row is the finding. `^(a+)+$` passes `checkPattern` and is stored, because RE2 has no reason to object — it runs that case in 0.05 ms. The respondent's browser then evaluates the same pattern on a backtracking engine, where 33 characters took **155 seconds** when [`features/0004`](0004-safe-author-supplied-regex.md) measured it. **So a form author can hang the tab of every person who fills in their form**, using a pattern the product accepted without complaint. The server-side fix did not make this safe; it moved where the unsafe engine runs.

The second row is quieter and still wrong: a pattern the server accepted throws `SyntaxError` in the browser, `checkField` logs to the console and returns `null` — which means *valid* — so the respondent gets no feedback, submits, and is refused by the server.

## Why the obvious approach is wrong

**1. Do not move the pattern check into a Worker by making `checkField` async and stopping there.** The composable's contract is synchronous and one of its two callers is a **submit gate**: `PublicFormView.vue:302` reads `if (!validate(fields.value, answers)) return`. If `validate` starts returning a `Promise`, that line becomes `if (!Promise) return` — a promise object is always truthy, so the guard silently passes **every** submission, including ones it should have stopped. The failure is invisible: no error, no console line, and the server still refuses the bad values, so it looks like the client-side check simply got quieter. Both `validateField` and `validate` have to migrate together with their caller, and the submit path needs `await`.

**2. Do not ship RE2 to the browser as WebAssembly to get engine parity.** It is the intuitive fix and it costs more than it buys. `frontend/vite.config.ts:36` sets `script-src 'self'`, and WebAssembly compilation needs `'wasm-unsafe-eval'` added to it — weakening the one directive [`features/0007`](0007-security-headers-and-csp.md) measured and deliberately kept tight, for every page including the public form. It also adds a few hundred kilobytes to the bundle a respondent downloads before they can fill in a form. A Worker needs no CSP change at all: `worker-src 'self' blob:` is already in the policy (`vite.config.ts:61`) because pdf.js needs it.

**3. Do not try to bound this by capping the input length instead.** It sounds like the cheap version and it does not work: the measurement in [`features/0004`](0004-safe-author-supplied-regex.md) is 155 seconds at **33 characters**, doubling every two, so any cap loose enough to be a usable text field is already far past hanging the tab. The thing to bound is the time, and the only way to bound a synchronous regex is to run it somewhere you can terminate — which is precisely what the browser has and the API does not. That asymmetry is the reason this feature exists as its own thing rather than as "do what the backend did".

**4. Do not treat "the browser could not evaluate this" as "the value is valid".** That is what happens today by accident: the `catch` at `useFormValidation.ts:46` logs and falls through to `return null`. Keep the outcome — the client must not invent a failure for a pattern it cannot run — but make it a decision with a name, because it is now reachable three ways (a `SyntaxError` from an RE2-only construct, a timeout, and a Worker that failed to start) and each needs to behave the same way: **no client-side verdict, the server decides.**

**5. The server stays authoritative and nothing about it changes.** This feature adds no validation and removes none. It only changes *where and how* the browser evaluates a pattern it was already evaluating.

## Goal

1. `frontend/src/composables/useFormValidation.ts` contains no `new RegExp`. A repository-wide grep for `new RegExp` in `frontend/src/` returns nothing outside the new worker module.
2. A pattern is evaluated in a Worker that is **terminated** after a hard timeout, and the timeout is a named constant with a comment saying why that number.
3. `^(a+)+$` against 40 `a`s resolves in under a second with a "no verdict" outcome rather than hanging — asserted by a test, and the test must be seen to hang or fail against the current code first.
4. A pattern that is valid RE2 and invalid JavaScript (`(?P<n>a)`) produces **no client-side error** and does not throw. The respondent is not told their input is wrong because the browser cannot read the rule.
5. `validate()` and `validateField()` are `async`, and **`PublicFormView.vue:302` awaits `validate`**. A test covers the submit gate specifically: an invalid value must still stop the submit after the migration.
6. Every non-pattern check — required, `minLength`, `maxLength` — still runs synchronously in-process and is unaffected in behaviour. Only the pattern branch waits on anything.
7. No change to `frontend/vite.config.ts`'s CSP. If one turns out to be needed, stop: it means the approach drifted to WASM and this spec's point 2 applies.
8. Nothing is sent to the server that was not sent before, and no new endpoint exists.

## Out of scope

- **`backend/src/services/pattern-validator.ts` and anything server-side.** The server case is closed and correct. Do not "align" the engines by loosening `checkPattern`.
- **Making RE2 and JavaScript agree.** They will still disagree after this: the browser will simply decline to judge what it cannot compile. Genuine parity needs one engine in both places, which is point 2 and is rejected. If the disagreement ever needs closing, it is a backlog row, not this.
- **A UI for authoring a field `pattern`** — already filed in `docs/BACKLOG.md` as its own P1. Note that it is where a *better* answer to the `^(a+)+$` case would live: warning the **author** at authoring time is the real fix, and this feature only protects the respondent from a pattern that got stored anyway. Add that observation to that row.
- **Anything owned by `feature/0031-production-deployment`** — `Dockerfile.*`, `compose.production.yml`, `deploy/**`, `docs/runbooks/**`, `backend/.env.local.example`, `frontend/.env.local.example`, `backend/src/routes/health.ts`, `backend/src/services/readiness.ts`. This feature has no reason to touch any of them; if it does, something has gone wrong.

## Execution prompt

> Read first: `frontend/src/composables/useFormValidation.ts` in full — `checkField` at `:12`, the pattern branch at `:39-47`, and both exported functions `validateField` and `validate`; `frontend/src/views/PublicFormView.vue` lines 175-200 (where the composable is destructured), `:281` (per-change validation) and `:296-306` (**the submit gate**); `frontend/vite.config.ts:30-75` (the CSP — `worker-src` is already permissive enough, `script-src` must not change); `backend/src/services/pattern-validator.ts` (the argument this mirrors, and the 155-second measurement); and `frontend/src/components/pdf/PDFViewer.vue:199` for how this repo already points at a worker.
>
> Apply the `frontend-state-pattern` skill. **No backend change and no schema change** — do not open `backend/src/` or `prisma/schema.prisma`.
>
> **Write the failing tests first and run them against the unchanged code.** Two matter and neither is optional:
> 1. `^(a+)+$` against a 40-character string of `a`s returns a result promptly. Against today's code this hangs the test runner — so write it with a per-test timeout, confirm it times out, and record that in the Outcome. That is the test hanging *because the bug is real*, which is the strongest evidence this feature can produce.
> 2. The submit gate: an answer that fails `minLength` must still prevent submission after `validate` becomes async. Write it against the current synchronous code, watch it pass, then keep it green through the migration — this is the one that catches the `if (!Promise)` trap.
>
> **Build, in this order:**
> 1. `frontend/src/services/pattern-worker.ts` — the worker itself. It receives `{ pattern, value }`, compiles with `new RegExp` and posts back `{ matched: boolean }`. It is the **only** place in `frontend/src/` allowed to construct a `RegExp`; say so in a comment, the way `pattern-validator.ts` does.
> 2. `frontend/src/services/pattern-check.ts` — the module the composable talks to. It owns the worker lifecycle and returns one of three outcomes: matched, did-not-match, or **no verdict**. A timeout **terminates** the worker (a `postMessage` asking it to stop cannot work — it is the thread that is stuck), and a worker that fails to construct, throws, or returns a `SyntaxError` yields *no verdict* too. Give the timeout a named constant and justify the number in a comment. Consider reusing one worker across checks and replacing it after a termination; if you keep it simple and spawn per check, say why in a comment rather than leaving it unexplained.
> 3. `useFormValidation.ts` — `checkField`, `validateField` and `validate` all become `async`. The pattern branch awaits `pattern-check`; **no verdict means no error**, matching today's behaviour but on purpose rather than by accident. Every other check stays exactly as it is.
> 4. `PublicFormView.vue` — `await` at `:281` and at the submit gate. Re-read the surrounding handler before editing: the gate is followed by `showPreview.value = true`, so the `await` must sit before that, not after.
>
> **Verify:** `npm run test:frontend`, `npm run build --workspace=frontend`, and `npm run test:e2e` — the E2E suite fills in public forms, so it is the real check that the async migration did not break submission. `npm run test:backend` and `npm run test:integration` should be untouched; run them anyway to prove it. Then confirm by hand what no suite can: `npm run dev`, author a field with pattern `^(a+)+$`, open the public form and type 40 `a`s into it — the tab must stay responsive. Report the real output.
>
> **On the way out:** run `sot-sync`. [07-security](../docs/sot/07-security-and-privacy.md) is the main one — the ReDoS finding is recorded there as closed on the server, and it must now say what the browser does and that the two engines still disagree by design. [05-frontend-patterns](../docs/sot/05-frontend-patterns.md) gains the rule: **`new RegExp` lives in one module, exactly as it does on the backend**. Remove the "Frontend still compiles patterns with native `RegExp`" row from `docs/BACKLOG.md`, and add the observation from *Out of scope* to the field-`pattern` authoring UI row. Set this file to `**Status:** done` with an Outcome recording the measured before/after for `^(a+)+$`. Run `ship-checklist` before the PR.

## Outcome

Built as specified. `frontend/src/services/pattern-worker.ts` is the only module in the SPA that constructs a `RegExp`; `services/pattern-check.ts` owns the deadline and the kill.

**Verified:** frontend 54 specs / **450 tests**, backend 25 / **326**, integration 25 / **250** (10 skipped, unchanged), E2E **53** — the last matters most here, because it fills in and submits public forms and is the real evidence the sync→async migration did not break the submit path. Frontend build clean, and the CSP in the emitted `index.html` is byte-for-byte what it was: `script-src 'self'`, no `wasm-unsafe-eval`.

**The bug was demonstrated before it was fixed, twice.** The new composable test hung the Vitest runner until it was killed at 120 s. Separately, `new RegExp('^(a+)+$').test('a'.repeat(40) + 'b')` in plain Node compiled instantly and was **still running after 25 seconds**.

**Real-browser evidence, which no suite in this repo can produce** (jsdom has no `Worker`). Chromium via Playwright, one pooled worker:

| Case | Verdict | Time |
|---|---|---|
| `^[0-9]+$` vs `12345` | matched | 0.3 ms |
| `^[0-9]+$` vs `abc` | no-match | 0.3 ms |
| `(?P<n>a)` — valid RE2, invalid JS | no-verdict | 0.5 ms |
| `^(a+)+$` vs 41 chars | no-verdict, **worker killed** | 50.3 ms |

The main thread ran 0.3 ms after the kill and the page was still responsive.

**That browser check earned itself immediately, by finding a bug the whole test suite was blind to.** The first version started `DEADLINE_MS` at worker *construction*, and starting a module worker took **over 50 ms** — so `^[0-9]+$` against `12345` also came back `no-verdict`. Client-side pattern validation would have been switched off completely, for every pattern, while every unit test passed and nothing logged. The deadline must bound **the regex, not the thread**, so the worker now announces `{ ready: true }` and the clock starts after that, with a separate and much looser `STARTUP_MS`.

**A second bug found while writing the tests:** one pooled worker with per-call listeners meant two overlapping checks both received the first reply — the second field's verdict would have been the first field's answer, and two debounced `validateField` calls firing together is enough to hit it. Checks are now serialised through a promise chain, and `never answers one check with another check's reply` covers it.

**Two deviations from the execution prompt**, both forced by the environment rather than chosen:

1. **The tests are split across two levels.** The prompt implied testing the pattern behaviour through the composable, but jsdom has no `Worker`, so every verdict there would be `no-verdict` and the existing `validates regex patterns` test could not pass. `services/pattern-check.spec.ts` installs a fake worker and tests the supervision — the clock, the kill, the pooling, the serialisation — while the composable's spec mocks `runPattern` and tests what the composable decides given a verdict. The real engine is covered by the browser run above.
2. **`resetPatternWorker()` is exported for the tests.** Module-level pooling is right for a page that loads once and wrong for a suite that runs many cases against one module.

**Filed, not fixed:** nothing warns the *author* who writes `^(a+)+$`. This feature protects the respondent from a pattern that got stored anyway; the real fix is authoring-time validation, and the observation is now on that backlog row.
