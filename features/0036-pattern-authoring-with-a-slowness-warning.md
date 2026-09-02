# 0036 — Authoring a field `pattern`, with a slowness warning

**Status:** done
**Priority:** P1 — the third and last part of the `pattern` story. [`features/0004`](0004-safe-author-supplied-regex.md) protected the server, [`features/0035`](0035-bounded-pattern-validation-in-the-browser.md) protected the respondent, and **nobody has ever told the author**
**Branch:** `feature/0036-pattern-authoring-with-a-slowness-warning`
**Related:** [`features/0004`](0004-safe-author-supplied-regex.md), [`features/0035`](0035-bounded-pattern-validation-in-the-browser.md), [07-security-and-privacy](../docs/sot/07-security-and-privacy.md), [05-frontend-patterns §3a](../docs/sot/05-frontend-patterns.md), [06-api-reference](../docs/sot/06-api-reference.md), [04-backend-patterns](../docs/sot/04-backend-patterns.md)

## Context

`FieldPropertiesPanel.vue` has **no validation section at all** — no `pattern`, no `minLength`, no `maxLength`. `updateField` at `:272` writes `name`, `label`, `required`, `border` and `options` and nothing else, so the only way to put a pattern on a field is to call the API by hand. The type already carries it (`frontend/src/services/forms.ts:23`) and `saveFields` already sends it (`stores/formFields.store.ts:233`), so the round trip works; there is simply no way to type one.

**The reason this is now worth doing is what [`features/0035`](0035-bounded-pattern-validation-in-the-browser.md) found.** RE2 accepts `^(a+)+$` and runs it in 0.05 ms, so the server stores it without complaint — and the same pattern backtracks catastrophically in a browser, measured still running after **25 seconds** on 41 characters. 0035 bounded that by running the pattern in a Worker and killing it after 50 ms, which protects the respondent completely: they see no error and the server still enforces the rule.

What nobody protects is the **author**, who has written a rule that is silently useless as client-side feedback for everyone filling in their form, and has been told nothing. Containing the damage was the right first move; **warning at authoring time is the only place the problem can actually be fixed.**

## Why the obvious approach is wrong

**1. Do not bind a pattern input to the panel's existing debounced save.** Every other field in that panel does exactly that — `updateField` writes to the store and schedules a save 1 second later (`FieldPropertiesPanel.vue:300`). A pattern cannot join them, because **a pattern is invalid for most of the time somebody is typing it**: `^(a`, `^(a+`, `[0-9` are all unterminated and all rejected. And the rejection is not local to the field — `pattern` is validated inside `createFieldSchema`'s `superRefine` (`backend/src/routes/form-fields.ts:33-39`), which means **one bad pattern fails the entire bulk save**, taking every other unsaved edit on the form with it. Binding an input to that save produces a stream of 400s while the author types, and silently loses their other work. The pattern must be validated before it can reach a save.

**2. Do not reimplement RE2's acceptance rules in the frontend.** It is the tempting way to get live feedback without a round trip, and it is a second source of truth about which patterns are legal — the exact thing `services/pattern-validator.ts` exists to prevent. The rules are not small or guessable either: RE2 rejects lookahead, lookbehind and backreferences, which JavaScript accepts, and it accepts `(?P<n>a)`, which JavaScript rejects. A hand-written approximation would drift from the engine on the first version bump and would be wrong in *both* directions. **Only the server can answer "may this be stored".**

**3. But the server cannot answer the question this feature exists for.** `checkPattern` compiles with RE2, and RE2 is linear by construction — `^(a+)+$` compiles fine and there is nothing for it to object to. The catastrophic case is **invisible to the engine that stores it** and only appears in a backtracking one. So the slowness check has to happen in the browser, and 0035 already built the machinery: `services/pattern-check.ts` runs a pattern in a killable Worker on a 50 ms deadline.

> **Two checks, in two places, and neither is sufficient.** The server says whether it may be *stored*; the browser says whether it will be *usable*. Getting this backwards — asking either one alone — is how this feature goes wrong.

**4. Do not run the probe on the main thread.** That is precisely the bug 0035 removed, and re-introducing it in the editor would hang the *author's* tab instead of the respondent's. Reuse `runPattern` from `services/pattern-check.ts`; do not construct a `RegExp` anywhere — `frontend/src/services/pattern-worker.ts` is the only module allowed to, and [05-frontend-patterns §3a](../docs/sot/05-frontend-patterns.md) says so.

**5. The slowness result is a warning, never a refusal.** A probe runs the pattern against synthetic input; it can show that a pattern *is* slow but never that it is safe, because the adversarial input depends on the pattern. Refusing to save on a heuristic would block legitimate patterns on a guess. **Invalid** (the server's answer) blocks saving; **slow** (the probe's answer) warns and lets the author decide.

**6. A `no-verdict` from the probe is not a warning either.** `runPattern` returns `no-verdict` for three different reasons — timed out, did not compile here, no `Worker` available — and only the first says anything about speed. A pattern that is valid RE2 and invalid JavaScript (`(?P<n>a)`) returns `no-verdict` without being slow at all. Distinguish them, or every RE2-only construct gets flagged as slow, which is both wrong and the kind of false alarm that teaches people to ignore warnings.

## Goal

1. `FieldPropertiesPanel.vue` has a **Pattern** input, shown only for `text` and `textarea` fields — the two types `useFormValidation` actually applies a pattern to (`useFormValidation.ts`, the `text`/`textarea` branch). Setting one on a checkbox would be inert and must not be offered.
2. `POST /api/forms/fields/check-pattern` is authenticated, takes `{ pattern }`, and returns `{ ok: true }` or `{ ok: false, reason }` — `reason` being `checkPattern`'s own message, which already names the unsupported construct (`invalid perl operator: (?=`). It calls `checkPattern` and **nothing else**: no database access, no form id, no ownership check to perform.
3. That route is **not shadowed** by `formsRouter` or by `formFieldsRouter`'s `/:formId` routes, both of which mount on `/api/forms`. Asserted by a test that calls it and gets a pattern verdict rather than a 404 or a form handler's response.
4. An invalid pattern is shown to the author with the server's reason, and **is not written to the store**, so it cannot reach `saveFields` and cannot fail the bulk save. The other properties in the panel keep saving normally while a pattern is invalid.
5. A valid pattern is probed with `runPattern` against synthetic input, and a probe that **times out** produces a visible warning that says the rule will not be checked in respondents' browsers and that the server still enforces it.
6. A `no-verdict` that is *not* a timeout produces **no slowness warning**. This requires distinguishing the causes — see *Why the obvious approach is wrong*, point 6.
7. `^(a+)+$` entered in the panel is accepted as valid by the server **and** warned about as slow. That pair is the whole feature and is asserted by a test.
8. `^[0-9]+$` produces no warning of any kind.
9. `new RegExp` still appears in exactly one module in `frontend/src/` — `services/pattern-worker.ts`.
10. Clearing the input removes the pattern from the field rather than storing an empty string, and `validation` is omitted entirely when it holds nothing (`stores/formFields.store.ts:233`, and `saveField` at `:265`, already drop an empty object — do not break either).

## Out of scope

- **`minLength` and `maxLength` inputs.** They belong in the same panel section and are deliberately not here: they need no round trip, no probe and no warning, so bundling them would mix a two-line UI addition with the design above and make the diff harder to review. **File them as their own P3 row** — the backend and the type already support both.
- **Changing the engines or the bound.** `checkPattern`, `pattern-validator.ts`, the 50 ms deadline, the kill, the pooling and the worker's monopoly on `new RegExp` are all settled by [`features/0004`](0004-safe-author-supplied-regex.md) and [`features/0035`](0035-bounded-pattern-validation-in-the-browser.md). Do not revisit any of them.

  **One narrow exception, and it is required by goal 6.** `runPattern` currently returns a flat `PatternVerdict`, so a caller cannot tell a timeout from "did not compile here" from "no `Worker`" — and this feature must, or every RE2-only construct is reported to the author as slow. Extend `pattern-check.ts` so the *reason* for `no-verdict` is available: an additional return field, or a second exported function. **Additive only** — `runPattern`'s existing signature and behaviour must not change, because `useFormValidation` depends on them and its tests assert them. The existing `pattern-check.spec.ts` cases must all still pass unmodified.
- **Making the probe exhaustive.** Generating genuinely adversarial input per pattern is a research problem. A short list of synthetic inputs is enough to catch the shapes that actually occur, and point 5 says why it must stay a warning.
- **A pattern library or presets** (email, phone, postcode). Reasonable, separate, and it should be filed as a P3 row if it does not already exist.
- **Anything owned by `feature/0031-production-deployment`** — `Dockerfile.*`, `compose.production.yml`, `deploy/**`, `docs/runbooks/**`, `backend/.env.local.example`, `frontend/.env.local.example`, `backend/src/routes/health.ts`, `backend/src/services/readiness.ts`. This feature has no reason to touch any of them.

## Execution prompt

> Read first: `frontend/src/components/form-fields/FieldPropertiesPanel.vue` — the `watch` on `selectedField` at `:206`, `updateField` at `:272`, and the debounced save at `:300`; `frontend/src/stores/formFields.store.ts:215-242` (`saveFields`, and how `validation` is dropped when empty at `:233` — `saveField` repeats it at `:265`); `frontend/src/services/pattern-check.ts` (`runPattern` and the three reasons for `no-verdict`); `backend/src/routes/form-fields.ts:13-44` (`createFieldSchema`, and the `superRefine` that makes one bad pattern fail the whole save); `backend/src/services/pattern-validator.ts` (`checkPattern`, `MAX_PATTERN_LENGTH`); and `backend/src/app.ts:233-234`, where **both** form routers mount on `/api/forms`.
>
> Apply `backend-endpoint-pattern` for the route and `frontend-state-pattern` for the panel. **No schema change.**
>
> **Write the failing tests first and run them against the unchanged code.** Three matter:
> 1. `POST /api/forms/fields/check-pattern` returns `{ ok: false }` with a reason for `(?=.*\d).{8,}` and `{ ok: true }` for `^[0-9]+$` — and is reached at all, rather than being swallowed by a `/:formId` route.
> 2. The panel shows the server's reason for an invalid pattern and **does not** put it in the store.
> 3. `^(a+)+$` is accepted by the server and warned about as slow, while `^[0-9]+$` is warned about not at all.
>
> **Build, in this order:**
> 1. `backend/src/routes/form-fields.ts` — add the check route. Declare it **above** the `/:formId` routes and add the shadowing test from point 1. It needs `authenticate` and no ownership middleware, because it touches no form; say so in a comment, since every neighbouring route has one. Decide whether it needs a rate limiter and write the answer down either way — note that `checkPattern` only *compiles*, never executes against input, so its cost is bounded, and the route is authenticated.
> 2. `frontend/src/services/fields.ts` — a `checkPattern(pattern)` calling that endpoint, following the one-service-per-resource shape.
> 3. `frontend/src/services/pattern-check.ts` — the additive change described under *Out of scope*, so the caller can tell a timeout from the other reasons for `no-verdict`. Do this before the composable; writing the composable first will tempt you into inferring the cause from elapsed time, which is guesswork.
> 4. `frontend/src/composables/usePatternAuthoring.ts` — the orchestration, so the panel stays a panel. It debounces, asks the server whether the pattern is storable, and only if it is, probes it with `runPattern` against a few synthetic inputs. It exposes something like `{ state, reason }` where state distinguishes **invalid**, **slow**, **ok** and **checking**. Keep the probe inputs in a named constant with a comment on why each is there.
> 5. `FieldPropertiesPanel.vue` — the input, the messages, and the rule that an invalid pattern never calls `formFieldsStore.updateField`. Mirror the existing panel's markup conventions rather than inventing new ones.
>
> **Do not touch** anything under *Out of scope*. Do not construct a `RegExp` anywhere.
>
> **Verify:** `npm run test:backend`, `npm run test:frontend`, `npm run test:integration`, `npm run test:e2e`, `cd backend && npx tsc --noEmit`, `npm run build --workspace=frontend`. Then confirm by hand, because no suite can: `npm run dev`, select a text field, type `^(a+)+$` — the editor must stay responsive, the pattern must be accepted, and the slowness warning must appear. Then type `(?=.*\d).{8,}` and check the server's reason is shown verbatim. Report the real output.
>
> **On the way out:** run `api-contract-guard` for the new route and add it to [06-api-reference](../docs/sot/06-api-reference.md). Run `sot-sync`: [07-security](../docs/sot/07-security-and-privacy.md) already has the section on the two engines — extend it to say the author is now warned, and strike the "warning the author is still the better fix and is not built" paragraph, which this feature closes. [05-frontend-patterns §3a](../docs/sot/05-frontend-patterns.md) gains the composable. Remove the "No UI for authoring a field `pattern`" row from `docs/BACKLOG.md`, file the `minLength`/`maxLength` inputs as P3, and set this file to `**Status:** done`. Run `ship-checklist` before the PR.

## Outcome

Built as specified. `POST /api/forms/fields/check-pattern` answers the storability question; `composables/usePatternAuthoring.ts` combines it with a worker probe; `FieldPropertiesPanel.vue` gained a pattern box.

**Verified:** backend 26 specs / **336 tests**, frontend 56 specs / **479 tests**, integration 25 / **250** (10 skipped, unchanged), E2E **53**, `tsc --noEmit` clean, frontend build clean. Each group of tests was run against the unwritten code first and seen to fail — 6 for the route, 5 for `describePattern`.

**Real-browser evidence, against the probe inputs the editor actually uses** (Chromium via Playwright, since jsdom has no `Worker`):

| Pattern | Probe |
|---|---|
| `^(a+)+$` | **SLOW** |
| `^(\d+)*$` | **SLOW** |
| `^([0-9]+)*$` | **SLOW** |
| `^[0-9]+$` | ok |
| `^[A-Z]{2}[0-9]{1,2} ?[0-9][A-Z]{2}$` | ok |
| `^\w+@\w+\.\w{2,}$` | ok |

No false positives and no false negatives on that set. An earlier run of this check reported `^(\d+)*$` as `ok`, which I nearly recorded as a probe limitation — it was an escaping bug in the throwaway proof script, which had tested `^(d+)*$`. Confirmed by measuring the pattern directly first: `^(\d+)*$` runs over 8 seconds on 30 characters, so "slow" is the right answer and the probe gives it.

**One real bug, found by a test and not by reading.** Writing an accepted pattern made the slowness warning vanish. `store.updateField` **replaces the field object**, so the `selectedField` computed returns a new reference and the panel's `watch` fires on every edit — which called `resetPattern()` and cleared the state the write had just produced. The watcher now keys its reset on the field **id**, so it distinguishes a real selection change from the object being replaced. `FieldPropertiesPanel.spec.ts` covers it.

**Two deviations from the execution prompt:**

1. **`scheduleSave()` was extracted from `updateField`.** The prompt assumed the pattern could reuse the existing debounced save; the debounce was written inline inside `updateField`, so there was nothing to call. Extracted rather than duplicated, so both paths share one save and one status indicator.
2. **`FieldPropertiesPanel.spec.ts` uses real timers.** Fake timers deadlock with the shared `flushPromises` helper, which is a real `setTimeout(0)` — every test timed out at 5 s. Waiting 450 ms for real costs under half a second per case and leaves the helper usable by everything else.

**On the additive change to `pattern-check.ts`:** `runPattern` is untouched and every pre-existing case in `pattern-check.spec.ts` passes unmodified; `describePattern` is the same work with the reason kept rather than discarded, and `runPattern` is now a one-line wrapper over it.

**Filed, not built:** `minLength` and `maxLength` still have no UI, now a P3 row with the reason they were left out.
