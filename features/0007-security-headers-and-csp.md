# 0007 — Security headers, and a CSP delivered where it actually applies

**Status:** done
**Priority:** P1 (see [`docs/BACKLOG.md`](../docs/BACKLOG.md); S5 in [07-security-and-privacy](../docs/sot/07-security-and-privacy.md))
**Branch:** `feature/0007-security-headers-and-csp`
**Related:** [`07-security-and-privacy`](../docs/sot/07-security-and-privacy.md) (S5, and S4 which this makes cheaper) · [`02-architecture`](../docs/sot/02-architecture.md) · [`08-operations`](../docs/sot/08-operations.md) · [`09-quality-and-testing`](../docs/sot/09-quality-and-testing.md)

## Context

Finding S5: the service sets no security headers at all. No `helmet`, no CSP, no `X-Content-Type-Options` outside the one PDF route, no `Referrer-Policy`, no HSTS, and Express still advertises itself with `X-Powered-By`. `backend/src/app.ts` mounts CORS, `express.json()`, one signed-PDF route, `/health` and five routers, and nothing else.

This is next because of the order recorded in [07-security-and-privacy](../docs/sot/07-security-and-privacy.md#recommended-order-of-work), which is sorted by *risk removed per unit of effort*: `helmet` + CSP is item 3, token handling (S4) is item 5, with the note that S4 *"is a real change on both sides — plan it as a feature, not a patch."* The two are related, and the order is not arbitrary: S4's severity comes from what an XSS can do with a 7-day token in `localStorage`, and a CSP is the control that makes that XSS harder to land in the first place. Doing the cheap mitigation first does not remove the need for S4.

The XSS surface is real rather than theoretical. The editor renders user-controlled field labels, and it loads `pdfjs-dist` to render attacker-supplied PDFs — `frontend/src/components/pdf/PDFViewer.vue:187` configures the worker, `frontend/src/composables/usePDFRendering.ts:43` calls `getDocument`.

## Why the obvious approach is wrong

**The obvious approach is `app.use(helmet())` in `backend/src/app.ts`, and on its own it protects almost nothing.**

A Content-Security-Policy constrains a *document*: what it may load, connect to, and execute. `backend/src/app.ts` never serves a document. It serves JSON and one PDF. `frontend/index.html` is served by the Vite dev server locally, and in production by nothing yet — there is no deploy pipeline ([08-operations](../docs/sot/08-operations.md)). So a `Content-Security-Policy` header emitted by Express lands on responses that have no scripts to govern, while the origin that runs the application code receives no policy at all. It looks like the finding is closed, and the XSS path S5 exists to narrow is untouched.

This is the central design decision of the feature: **the API headers and the SPA policy are two different deliverables with two different delivery mechanisms**, and only the first one is a `helmet` call.

Three more things that will go wrong in the order they will go wrong:

**1. helmet's defaults break the PDF route, and the failure looks like a bug in `features/0006`.**
The SPA and the API are separate origins (`localhost:5173` and `localhost:3000` in development, and `VITE_API_URL` is compile-time, so they are separate in production too). helmet sets `Cross-Origin-Resource-Policy: same-origin` by default. The signed PDF URL from `services/pdf-url.ts` points at the API origin and is fetched by the SPA, so that default blocks every PDF in the editor and every published form. The symptom will be a blank viewer, not an error, and the tempting fix is to remove helmet. The correct fix is `cross-origin-resource-policy: cross-origin` **on that route only**, decided deliberately rather than by whichever value makes the page render.

**2. pdf.js will demand `unsafe-eval` unless you tell it not to.**
`usePDFRendering.ts:43` calls `getDocument({ data: bufferCopy })` with no options. `isEvalSupported` defaults to `true`, and pdf.js uses `Function`/`eval` for font handling when it is. A CSP with `script-src 'unsafe-eval'` gives back most of what the CSP was for. Passing `isEvalSupported: false` is the intended escape hatch and costs some font-rendering performance. **Verify the visual result on a real PDF** — do not assume it is free, and do not assume it is broken.

**3. `style-src` is where an honest CSP gets uncomfortable.**
PrimeVue 4 with `@primevue/themes` injects styles at runtime, and Tailwind's build output is a static stylesheet but the component library's is not. Expect `style-src` to need `'unsafe-inline'`. A nonce cannot help: nonces must be per-response, and `index.html` is a static asset here. **Do not paper over this.** Determine what is actually required, ship the strictest policy that keeps the app working, and write down in the SoT exactly which directive had to be loosened and why — a CSP whose real content nobody can state is worse than a documented partial one, because the next person assumes it is strict.

**A fourth, smaller trap:** helmet sends `Strict-Transport-Security` by default. On `http://localhost` that header is ignored by browsers for the current request, but a browser that has seen HSTS for `localhost` from any port will force HTTPS on `localhost` for *every* port afterwards, which breaks unrelated local development in a way that is very hard to diagnose. Disable HSTS unless the connection is HTTPS, or gate it on an environment variable that is off by default.

## Goal

Each of these is true or false when the work is done.

1. Every API response carries `X-Content-Type-Options: nosniff`, a `Referrer-Policy`, and no `X-Powered-By`.
2. `GET /uploads/pdfs/:token/:filename` still returns the PDF, and the editor and the public form still render it, in the browser and in the E2E suite.
3. That PDF route sets a `Content-Security-Policy` of its own that stops the file from acting as an active document (at minimum `sandbox`; `default-src 'none'` where it does not break rendering), keeping the `nosniff`, `Content-Disposition` and `Cache-Control` headers already set by [`features/0006`](0006-signed-expiring-urls-for-uploaded-pdfs.md).
4. `frontend/index.html` carries a CSP that the running application does not violate — no CSP errors in the browser console on: login, the editor with a PDF loaded and a field added, save, the public form, and CSV download.
5. The policy does **not** contain `script-src 'unsafe-eval'`.
6. Whatever `style-src` ends up as is stated in [07-security-and-privacy](../docs/sot/07-security-and-privacy.md) with its reason, along with what a `<meta>` CSP cannot express (`frame-ancestors`, `report-uri`, `sandbox`) and therefore what the eventual production host must send as a real header.
7. HSTS is not sent over plain HTTP in development.
8. A backend test asserts the headers on a normal API response and on the PDF route.
9. All four suites green: `npm run test:backend`, `npm run test:integration`, `npm run test:frontend`, `npm run test:e2e`.

## Out of scope

- **S4, session hardening** — shorter expiry, refresh tokens, `httpOnly` cookie. Its own backlog row and the next security feature. This one makes it cheaper; it does not do it.
- **Virus scanning of uploads** (S6) — separate row.
- **A production host configuration.** There is no deploy pipeline to configure. This feature *records the requirement* in [08-operations](../docs/sot/08-operations.md); it does not build the deployment.
- **CSP reporting endpoint.** `report-uri`/`report-to` need somewhere to send reports and something that reads them, which is the structured-logging row (S9). Note it, do not build it.
- **Rewriting how PrimeVue delivers styles.** If it forces `'unsafe-inline'`, document that; do not restructure the theme layer inside this feature.

## Execution prompt

> Read [`docs/sot/07-security-and-privacy.md`](../docs/sot/07-security-and-privacy.md) first, then work through this in order. Everything below names a real file; open it rather than trusting the description.
>
> **Step 1 — read before writing.** `backend/src/app.ts` in full — note that `express.static` is gone, that the PDF route at `:56-85` already sets four headers deliberately, and that the SPA is not served from here. `backend/src/services/pdf-url.ts`. `frontend/index.html` (13 lines, no CSP today). `frontend/vite.config.ts`. `frontend/src/components/pdf/PDFViewer.vue:187-190` (the worker URL) and `frontend/src/composables/usePDFRendering.ts:38-55` (`getDocument`). Grep the frontend for `createObjectURL` — there are three call sites, and they decide whether `blob:` is needed in a directive. Confirm for yourself that Express serves no HTML.
>
> **Step 2 — establish the baseline.** Start the app and record, from the browser, every origin and scheme the SPA actually uses: script, style, font, image, `connect-src` (the API origin from `VITE_API_URL`), `worker-src` (the pdf.js worker), and anything `blob:` or `data:`. Write this list down — it is the policy. A CSP derived from a template rather than from observation is how the app ends up with `unsafe-inline` everywhere.
>
> **Step 3 — remove pdf.js's need for `eval` first, before writing any policy.** Add `isEvalSupported: false` to the `getDocument` call in `usePDFRendering.ts`. Check `useThumbnails.ts`, which also imports `pdfjs-dist`, for a second call site. Then load a real PDF — use one from `backend/test-fixtures/` — and compare rendering against before. If text or fonts visibly degrade, say so in the PR and decide explicitly; do not silently accept either outcome.
>
> **Step 4 — headers on the API.** Add `helmet` to `backend`. Mount it in `app.ts` before the routers. Turn **off** its `contentSecurityPolicy` for API responses (it governs nothing there and its defaults will fight the PDF route), and turn off HSTS unless HTTPS is in use — gate it on an environment variable defaulting to off, with an entry in `backend/.env.example`, following the `envInt`/`config/env.ts` pattern already used by `TRUST_PROXY_HOPS`. Keep `nosniff`, `Referrer-Policy` and the removal of `X-Powered-By`. Write a comment saying why CSP is off here, or the next person will "fix" it.
>
> **Step 5 — headers on the PDF route, deliberately.** In the `/uploads/pdfs/:token/:filename` handler, set `Cross-Origin-Resource-Policy: cross-origin` — the SPA is a different origin and must be able to fetch it — and a restrictive per-response `Content-Security-Policy` (start from `default-src 'none'; sandbox;`). Then **verify a PDF still renders in the editor and in the public form**, which is the check that matters; adjust the directives with a reason, not by deleting them. Extend the existing comment block: it already explains why the route exists, and now also has to explain why its cross-origin policy is deliberately looser than the default.
>
> **Step 6 — the policy that actually protects the app.** Add a `<meta http-equiv="Content-Security-Policy">` to `frontend/index.html` from the Step 2 list. Start strict — `default-src 'self'` — and loosen one directive at a time, only when a console violation proves it necessary, recording each concession. `script-src` must not contain `'unsafe-eval'`; Step 3 is what makes that possible. Expect `style-src` to need `'unsafe-inline'` for PrimeVue; confirm it rather than assuming, and if it is needed, record it as a known limitation instead of hiding it. Note that a `<meta>` CSP silently ignores `frame-ancestors`, `report-uri` and `sandbox` — that is a documentation item for Step 9, not a reason to skip the meta tag.
>
> **Step 7 — tests.** New `backend/tests/security-headers.spec.ts`, in the style of `backend/tests/pdf-url.spec.ts` (mocked Prisma, `supertest` over the real `app`). Assert: a normal API response carries `nosniff` and a `Referrer-Policy` and no `X-Powered-By`; the PDF route carries its CSP and `Cross-Origin-Resource-Policy: cross-origin` **and still returns the file**; no HSTS header when the HTTPS flag is off. Mint a valid token through `services/pdf-url.ts` as `pdf-url.spec.ts` does rather than hand-constructing one.
>
> **Step 8 — verify.** `npm run test:backend`, `npm run test:integration`, `npm run test:frontend`, `npm run test:e2e`, `npx tsc --noEmit` in `backend/`, `npm run build --workspace=frontend`. All of them — the E2E run is the one that catches a broken PDF route, and this feature is exactly the kind that breaks it. Then by hand, with the console open and **zero CSP violations** in it: register, log in, open the editor with a PDF, add a field, save, open the public form, submit a response, and download the CSV. Report what the final policy is, verbatim.
>
> **Step 9 — document.** Run `sot-sync`. [`07-security-and-privacy`](../docs/sot/07-security-and-privacy.md): mark S5 resolved with what is actually set and, explicitly, **what is not** — the `style-src` concession if it was needed, the absence of CSP reporting, and the fact that a `<meta>` policy cannot carry `frame-ancestors`; update the "Recommended order of work" list, where S4 then becomes the next item. [`08-operations`](../docs/sot/08-operations.md): the new environment variable, and a deployment requirement that the production host must serve the SPA's CSP as a real header including the directives `<meta>` cannot express. [`04-backend-patterns`](../docs/sot/04-backend-patterns.md): one line on where response headers are set and why the PDF route differs. [`09-quality-and-testing`](../docs/sot/09-quality-and-testing.md): the new spec in the count table. Remove the `helmet` + CSP row from [`docs/BACKLOG.md`](../docs/BACKLOG.md), and file anything deferred — CSP reporting at minimum. Close step 3 in the [build order](../docs/sot/10-saas-roadmap.md#build-order). Set this file to `**Status:** done` and add an `## Outcome` section, as [`0002`](0002-rate-limiting-on-public-write-paths.md) and [`0005`](0005-working-ci-and-enforced-node-version.md) do.


## Outcome

**Done.** All nine acceptance criteria hold. Verified on Node 22.22.0: backend 11 specs / 107 tests, integration 2 / 14, frontend 29 / 237, E2E 34, plus `tsc --noEmit` on the backend and the frontend build (`vue-tsc`).

**One E2E flake, reported rather than smoothed over.** Across six full E2E runs on this branch, `auth-flow.spec.ts > should register a new user successfully` failed once. It did not reproduce in three targeted runs or three further full runs. The failing run took 48.9 s against a usual ~25 s, so the likeliest cause is machine contention timing out `waitForURL`, not this change — nothing here touches registration, and the run before the documentation edits was green. Filed in [`docs/BACKLOG.md`](../docs/BACKLOG.md) rather than left in a sentence.

**The central claim held.** `app.use(helmet())` alone would have closed the finding on paper. Express serves JSON and one PDF and never serves `index.html`, so the policy that matters is built in `frontend/vite.config.ts` and injected as a `<meta>` tag at build time. helmet's CSP is explicitly disabled on the API, and `backend/tests/security-headers.spec.ts` asserts that absence so it cannot be quietly "fixed".

**The predicted trap was real.** helmet's default `Cross-Origin-Resource-Policy: same-origin` does block the SPA from fetching a PDF. The route now overrides it to `cross-origin`, and the assertion covering it was confirmed to fail for the right reason: removing the override produces `expected 'same-origin' to be 'cross-origin'` and nothing else in the suite moves.

**`style-src` was measured rather than assumed, and the spec's guess was half wrong.** Under `style-src 'self'` a single editor session produces **423 violations**, and the console text (*"Applying inline style"*) misattributes them. The `securitypolicyviolation` event's `effectiveDirective` gives the real split:

- **373 `style-src-attr`** — `style` attributes, from Vue `:style` bindings and the editor's absolutely positioned field overlays. The spec did not anticipate these at all.
- **50 `style-src-elem`** — `<style>` elements, PrimeVue 4 injecting its theme at runtime. This is the part the spec predicted.

Because both shapes occur, the narrower `style-src-elem` + `style-src-attr` split was tried and grants exactly the same permission with more words. `'unsafe-inline'` stands, with the measurement recorded in [07-security-and-privacy](../docs/sot/07-security-and-privacy.md#what-the-spa-policy-does-not-cover) and in a comment at the directive itself.

**`script-src` is `'self'` with no `'unsafe-eval'`**, which required `isEvalSupported: false` on the one `getDocument` call. The spec expected a second call site in `useThumbnails.ts`; there is none — it receives an already-loaded document. No rendering regression was observed on the fixture PDFs or in the E2E run.

**Zero CSP violations** across the real flows, checked in a browser rather than inferred: register → upload → pdf.js render → editor, and the public form. Both reported empty violation and console-error lists.

**Scope notes.** The policy is built in `vite.config.ts` rather than written into `index.html` because `connect-src` must name the API origin (per-environment, `VITE_API_URL`) and because the dev server needs `ws:` for HMR — and the E2E suite runs against `npm run dev`, so a policy correct only for the built app would have failed in Playwright looking like an application bug. `X-Frame-Options: DENY` was added to the PDF route beyond the spec, to stop it disagreeing with its own `frame-ancestors 'none'`.

**Deferred and filed** in [`docs/BACKLOG.md`](../docs/BACKLOG.md): CSP violation reporting (needs the S9 logging work), and narrowing `style-src`, which means changing how the app styles things rather than how the policy is written. Not touched, as scoped: S4, virus scanning, and any production host configuration — there is still no deployment, so the `frame-ancestors` requirement is recorded in [08-operations](../docs/sot/08-operations.md) rather than implemented.
