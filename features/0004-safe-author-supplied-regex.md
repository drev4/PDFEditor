# 0004 — Author-supplied regex that cannot hang or break the service

**Status:** done
**Priority:** P0 (see [`docs/BACKLOG.md`](../docs/BACKLOG.md))
**Branch:** `feature/0004-safe-author-supplied-regex`
**Related:** [`07-security-and-privacy`](../docs/sot/07-security-and-privacy.md) (S3) · [`04-backend-patterns`](../docs/sot/04-backend-patterns.md) · [`06-api-reference`](../docs/sot/06-api-reference.md) · [`09-quality-and-testing`](../docs/sot/09-quality-and-testing.md)

## Context

`backend/src/routes/responses.ts:106-107`, inside the public submission handler:

```ts
if (validation?.pattern) {
  const regex = new RegExp(validation.pattern)
  if (!regex.test(value)) {
    validationErrors[field.name] = 'Invalid format'
  }
}
```

A string written by one user (the form author) is compiled and executed against a string written by another (an anonymous respondent), on the unauthenticated endpoint, on the only thread the service has. Nothing validates the pattern when it is stored — `backend/src/routes/form-fields.ts:29` accepts `pattern: z.string().optional()`, any string at all.

Two separate defects, both verified against a running server rather than reasoned about:

**1. An invalid regex bricks the form, permanently.** Posting a field with `"pattern": "["` is accepted without complaint. Every public submission to that form then returns:

```
bulk save of an invalid regex -> accepted? {"fields":[{"id":"dab40e61-…
public submission -> {"error":"Internal server error"} [500]
```

`new RegExp('[')` throws `SyntaxError`, which is not an `AppError` or a `ZodError`, so `middleware/errorHandler.ts` turns it into a 500. The form stops accepting responses for everyone, the respondent sees a generic failure, and the author is told nothing. This needs no malice — a typo in a pattern does it.

**2. A backtracking regex hangs the whole service.** This is S3 in [07-security-and-privacy](../docs/sot/07-security-and-privacy.md). Measured on this machine with `/^(a+)+$/`:

| Input | Time |
|---|---|
| 22 chars | 239 ms |
| 24 chars | 179 ms |
| 26 chars | 843 ms |
| 28 chars | 2 851 ms |

Roughly doubling every two characters: ~3 minutes at 40 characters, days at 50. `app.ts:42` calls `express.json()` with no options, so the body limit is the default 100 kB — six orders of magnitude more input than is needed. One submission takes the process down for every user of every form, and it re-arms on the next request.

Note what this is **not** protected by. `POST /api/responses` is rate limited ([`features/0002`](0002-rate-limiting-on-public-write-paths.md)), which bounds how *often* an attacker can fire but not what one request costs — 20 requests per 10 minutes is 20 permanent hangs. And the `maxLength` check two lines above does **not** short-circuit: the three checks are sequential `if`s with no early exit, so a value that already failed `maxLength` is still handed to the regex.

There is currently **no way to author a pattern through the editor** — `FieldPropertiesPanel.vue` has no pattern input. Patterns can only arrive through the API. That does not reduce the severity (this is self-service signup: any account can do it), but it does mean there is no UI to migrate and almost certainly no real patterns in production. That is a good reason to fix this properly now rather than cheaply.

## Why the obvious approach is wrong

### A `try/catch` fixes the 500 and does nothing about the hang

It is the first thing anyone writes, it is genuinely needed, and on its own it is a trap: it makes the visible symptom disappear while leaving the dangerous one. **A catastrophic regex is a perfectly valid regex.** It does not throw. It returns — eventually, after longer than the heat death of the customer's patience. Do not let `try/catch` be the fix.

### You cannot put a timeout around `regex.test()`

This is the misconception to head off, because the code that implements it looks correct and does nothing at all:

```ts
// Does not work. Not "unreliable" - has no effect whatsoever.
await Promise.race([
  Promise.resolve(regex.test(value)),
  new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 100))
])
```

`regex.test()` is synchronous and runs to completion on the one JavaScript thread. The `setTimeout` callback cannot fire while it runs, because the event loop is precisely what is blocked. By the time anything can observe the timer, the regex has already finished. There are exactly three ways to bound this, and picking one is the substance of this feature:

1. **A regex engine that cannot backtrack.** RE2 is linear in input length by construction; there is no pathological case to bound.
2. **Execute somewhere killable** — a worker thread or child process with a hard terminate.
3. **Never store a dangerous pattern**, so nothing needs bounding at runtime.

### Authoring-time validation alone is not enough

Option 3 is the cheapest and it is where the author gets useful feedback, but shipping only that leaves two holes: rows already in the database were never validated, and static ReDoS detection is heuristic — `safe-regex` and similar tools have known false negatives. Authoring-time rejection is a good first line, not the line.

### Capping the input length is not a fix either

Superlinear means superlinear: the table above shows 28 characters already costing three seconds. Even a 256-character cap leaves an unbounded hang available. Fix the `maxLength` ordering because it is a real bug, but do not mistake it for the mitigation.

### The decision this feature has to make

**Recommended: RE2 for execution, plus authoring-time validation, plus the ordering fix.** Belt and braces, because the braces are cheap and the existing rows are unvalidated.

RE2 is not free, and the costs must be checked rather than assumed:

- It is a **native dependency** (`re2` on npm, node-gyp with prebuilt binaries). Verify it installs on the CI image and on a clean checkout, and note what it implies for a future Docker image — Alpine in particular. If it will not build reliably, fall back to option 2 and say so in the PR.
- It **does not support** lookahead, lookbehind or backreferences. Patterns like `^(?=.*[A-Z])` would stop being accepted. With no pattern UI and no known production patterns this is close to free today and expensive later, which is an argument for doing it now.

### What to do with patterns already stored that the new rules reject

A decision, not an oversight. **Treat an uncompilable or unsupported stored pattern as "no pattern constraint", and log it.** The alternatives are worse: throwing gives back the 500 this feature exists to remove, and rejecting the submission punishes a respondent for the author's mistake. `pattern` is a formatting convenience, not a security control — nothing downstream trusts it — so degrading to "unconstrained" is the failure mode that keeps the form working. Say this out loud in the SoT, because a future reader will otherwise assume the constraint is enforced.

## Goal

1. A field whose `pattern` is not a valid regex is **rejected at write time** with `400`, by both `POST /api/forms/:formId/fields` and the bulk save.
2. A pattern that the execution engine cannot support is rejected the same way, with a message naming what is unsupported.
3. `pattern` has a length cap, enforced at write time.
4. **No submission to any form can block the event loop for more than a bounded time**, whatever pattern is stored — including patterns stored before this change.
5. A submission to a form whose stored pattern is invalid or unsupported returns a normal validation outcome, never a `500`.
6. The `maxLength` check short-circuits: a value that already failed a length check is not handed to the regex.
7. A test that **fails against the unfixed code** proves 4 — written first, run before the change, and seen to exceed its time bound. Mocked Prisma is fine here; this is CPU behaviour, not database behaviour.
8. Backend tests cover: invalid pattern rejected at write, unsupported pattern rejected at write, over-long pattern rejected, a legitimate pattern still validating correctly, a catastrophic pattern completing within the bound, and a pre-existing bad pattern in the database not causing a 500.
9. [`07-security-and-privacy`](../docs/sot/07-security-and-privacy.md) records S3 as resolved and states the degrade-to-unconstrained behaviour; [`06-api-reference`](../docs/sot/06-api-reference.md) documents the new `400`; the backlog row is removed.
10. Every suite green: `test:frontend`, `test:backend`, `test:integration`, `test:e2e`.

## Out of scope

- **Adding a pattern input to the editor UI.** `FieldPropertiesPanel.vue` has none, and designing that — with live validation and an explanation of which syntax is supported — is its own piece of work. File it.
- **The frontend's own `new RegExp` in `frontend/src/composables/useFormValidation.ts:42`.** Different threat model: it burns the respondent's own tab, not shared infrastructure, and it is already wrapped in `try/catch`. Once patterns are validated at authoring time it is materially safer anyway. File a row for aligning it with whatever engine the backend adopts.
- **The other validation rules** (`minLength`, `maxLength`, `options`, type checks) beyond the ordering fix in goal 6.
- **The 100 kB `express.json()` default.** Worth revisiting, but as a deliberate body-size policy across every endpoint, not smuggled in here.
- **Retro-cleaning existing rows.** The runtime handles them; a migration that rewrites customer data needs its own justification.

## Execution prompt

> **Step 1 — read before writing.** `backend/src/routes/responses.ts` from the `submitResponseSchema` down to `prisma.response.create` — especially the validation loop at `:95-112` and the fact that the three checks do not short-circuit. Then `backend/src/routes/form-fields.ts` (`createFieldSchema` at `:12-31`, `bulkFieldSchema`, and the individual `POST`/`PUT`), `backend/src/middleware/errorHandler.ts` (why a `SyntaxError` becomes a 500), and `backend/tests/responses.spec.ts` for the test style. Confirm for yourself that nothing validates `pattern` on write.
>
> **Step 2 — reproduce both defects first.** Write the failing tests before touching the implementation, in `backend/tests/responses.spec.ts` or a new `backend/tests/regex-guard.spec.ts`:
> - A form whose field has `pattern: '['`, submitted against — assert the response is **not** 500. Run it now and watch it fail with 500.
> - A form whose field has `pattern: '^(a+)+$'` with an input like `'a'.repeat(30) + '!'`, wrapped in a wall-clock assertion (say, must complete in under 500 ms). Run it now and watch it exceed. **Keep the input modest** — 30 characters is already seconds; do not write a test that hangs your own run for hours.
>
> **Step 3 — choose the execution engine, and verify the choice.** Try `npm install re2 --workspace=backend`. Confirm it builds on this machine and think about CI. If it installs cleanly, use it; if it does not, use a worker thread with a hard terminate and record why in the PR description. Either way, state the decision and its cost.
>
> **Step 4 — validate at write time.** Add a shared helper — `backend/src/services/pattern-validator.ts` or similar — exporting something like `isSupportedPattern(pattern): { ok: true } | { ok: false, reason: string }`. Wire it into `createFieldSchema` via a Zod `.refine()` (or `.superRefine()` for a useful message) so it covers `POST /fields`, `PUT /fields/:fieldId` and the bulk save at once, since `updateFieldSchema` and `bulkFieldSchema` both derive from `createFieldSchema` — verify that is still true when you get there. Include the length cap. The `400` must say what is wrong with the pattern; "Validation error" alone sends the author guessing.
>
> **Step 5 — bound execution.** In `routes/responses.ts`, replace `new RegExp(...)` / `.test(...)` with the chosen engine, behind the same helper module so there is one place that knows how patterns are compiled. A stored pattern that will not compile is logged and treated as no constraint (see the reasoning above) — never thrown. Make the `maxLength` failure short-circuit so an over-long value never reaches the regex.
>
> **Step 6 — verify.** The Step 2 tests now pass. Then the full gate: `npm run test:backend`, `npm run test:integration`, `npm run test:frontend`, `npm run test:e2e`, `npx tsc --noEmit` in `backend/`, `npm run build --workspace=frontend`. All of them — a feature is not finished while any suite is red. Then by hand against a running server: create a field with `pattern: '['` and confirm the API now rejects it with a useful 400; create one with a valid pattern and confirm a submission still validates against it.
>
> **Step 7 — document.** Run `sot-sync`. [`07-security-and-privacy`](../docs/sot/07-security-and-privacy.md): S3 resolved, what is enforced, and explicitly that an unsupported stored pattern degrades to no constraint rather than failing. [`06-api-reference`](../docs/sot/06-api-reference.md): the new `400` on the field endpoints and the removal of the ReDoS caveat on `POST /responses` — re-read the routes first, per `api-contract-guard`. [`04-backend-patterns`](../docs/sot/04-backend-patterns.md): a short rule that user-supplied code-like input is compiled through one audited helper, never `new RegExp` at a call site. [`08-operations`](../docs/sot/08-operations.md) if a native dependency was added, because that is a build-environment fact. Remove the regex row from [`docs/BACKLOG.md`](../docs/BACKLOG.md); add rows for the two out-of-scope items above. Set this file to `**Status:** done`.

## Outcome

Delivered as specified, on `re2@1.24.1`. Every suite green: 237 frontend, **83** mocked backend (was 70), 14 database-backed, 34 E2E, both type checks and the frontend build.

### The failing tests, before and after

`backend/tests/regex-guard.spec.ts` was written first and run against the unfixed code. It failed 7 of 10, and the numbers are the argument for this feature:

| Test | Before | After |
|---|---|---|
| catastrophic pattern completes within 500 ms | **155 175 ms** | pass |
| regex not run on a value that failed `maxLength` | **45 525 ms** | pass |
| invalid stored pattern does not 500 | 500 | pass |
| invalid pattern rejected on create / bulk / update | accepted | pass |

The whole file now runs in **70 ms**, down from over 200 seconds.

### Verified against a real server

| Case | Result |
|---|---|
| `pattern: "["` on write | `400` — `Invalid pattern: missing ]: [` |
| `pattern: "^(?=.*[A-Z]).+$"` | `400` — `Invalid pattern: invalid perl operator: (?=` |
| 300-character pattern | `400` — `Pattern must be 200 characters or fewer (got 300)` |
| valid `^[0-9]{3}-[0-9]{4}$`, matching input | `201` |
| valid pattern, non-matching input | `400 Invalid format` |
| **legacy** `[` forced into the database | `201`, no 500 — degrades to no constraint |
| **legacy** `^(a+)+$` with 60 characters | `400` in **0.01 s** (previously ~50 hours) |

### The engine decision, checked rather than assumed

RE2 installed in ~6 s from a prebuilt binary — no C++ compile — and runs the pathological case in 0.05 ms. Two costs were verified, not assumed:

- **ABI-bound.** A binary built under Node 22 does **not** load under Node 20. `npm ci` builds the right one, so CI (`node-version: 20.x`) is fine; locally, `npm rebuild re2` is required after switching Node. Documented in [08-operations](../docs/sot/08-operations.md), and the existing Node-version backlog row was sharpened because `.nvmrc` (22.12.0) and CI (20.x) disagree.
- **No lookaround or backreferences.** `^(?=.*[A-Z]).+$` is now refused. Acceptable precisely because there is no pattern UI and so almost certainly nothing in production — the cost only grows from here.

Because of that ABI fragility the engine is loaded defensively, which was then tested for real: with a Node-20 binary under Node 22, the service **still starts**, logs a loud diagnostic, and 10 of the 12 guard tests still pass — every "does not 500" and "does not hang" assertion holds with no engine at all. Only the two enforcement tests fail, which is exactly the documented degradation. Nothing ever falls back to a backtracking `RegExp`.

### Deferred, and filed

The editor has no pattern input, and `frontend/src/composables/useFormValidation.ts:42` still uses native `RegExp` in the respondent's browser — different threat model (their own tab, already `try/catch`-wrapped). Both are rows in [`docs/BACKLOG.md`](../docs/BACKLOG.md).
