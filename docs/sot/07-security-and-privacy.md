# Security and privacy

This document exists because the product collects other people's data through a public link, and because a B2B buyer's security questionnaire is a sales blocker, not a formality.

Everything below is the state of the code on **2026-08-28**, read out of the source. Nothing here is aspirational; planned work is in [`docs/BACKLOG.md`](../BACKLOG.md).

## Authentication and authorization model

| Aspect | Current implementation |
|---|---|
| Credential | Email plus password, minimum **6 characters**, no complexity or breach check |
| Password storage | `bcrypt`, cost factor **10** |
| Session | JWT signed with `JWT_SECRET` (HS256), payload `{userId}`, expiry `JWT_EXPIRES_IN`, default **7 days** |
| Token transport | `Authorization: Bearer` header |
| Token storage | **`localStorage`** in the browser (`frontend/src/services/api.ts`) |
| Revocation | **None.** There is no token blacklist, no `tokenVersion`, no refresh/rotation. A leaked token is valid until it expires |
| Logout | Client-side only — deletes the token from `localStorage` |
| Authorization | Resource ownership, checked per handler by `verifyFormOwnership` / `verifyFieldOwnership`. No roles, no organizations |
| Lockout / throttling | Per-IP rate limits on `POST /api/auth/login` (failed attempts only), `POST /api/auth/register` and `POST /api/responses` — `middleware/rateLimit.ts`. **No account-level lockout**: a per-account limiter without an unlock path would let anyone lock a named user out by spamming their address, so it is deferred to S10 |
| MFA / SSO | **None** |

The startup guard in `app.ts` refuses to boot without `JWT_SECRET`, which is correct and worth keeping when new required configuration appears.

## Trust boundaries

```
Anonymous internet
  ├── POST /api/auth/login             rate limited per IP, on failures only
  ├── POST /api/auth/register          rate limited per IP
  ├── POST /api/responses              writes to the database, no auth, rate limited per IP
  ├── GET  /api/forms/public/:shareId  reads a form, no auth, mutates viewCount, no throttle
  └── GET  /uploads/pdfs/<sig>/<file>  reads one uploaded PDF, no auth, signature-gated, expiring, no throttle

Authenticated user (JWT)
  └── /api/forms, /api/upload, /api/auth/me   scoped to resources they own

Server-side, no boundary
  └── PDF processing, filesystem writes
```

These are the whole external attack surface. The three write paths are rate limited; the two read paths are not, which is a deliberate gap — a limit on `GET /api/forms/public/:shareId` has to be reconciled with `viewCount` (S11) and with legitimately popular forms, and the PDF route now requires a signature this service issued, which bounds who can call it at all.

**Author-supplied regex is compiled by RE2, and degrades to no constraint.** A `pattern` that the engine cannot compile — one stored before validation existed, or an engine that failed to load — is logged and treated as *no pattern constraint*, never thrown. Throwing would restore the 500 this fixed; rejecting would punish a respondent for the author's mistake. `pattern` is a formatting convenience that nothing downstream trusts, so unconstrained is the right degradation — but do not read the field as a guaranteed-enforced rule.

**Per-IP is only as good as `req.ip`.** That depends on `trust proxy`, configured from `TRUST_PROXY_HOPS` in `app.ts` and defaulting to trusting nothing. Set too high — or to `true` — and the client can forge its own identity through `X-Forwarded-For` and bypass every limiter. See [08-operations](./08-operations.md#configuration).

## Findings

Severity is about impact on the product's ability to be sold and trusted, not CVSS.

| # | Finding | Severity | Where |
|---|---|---|---|
| ~~S1~~ | ~~**Uploaded PDFs are served publicly and permanently.**~~ **Resolved** ([`features/0006`](../../features/0006-signed-expiring-urls-for-uploaded-pdfs.md)). `express.static` is gone. A PDF is reachable only through `GET /uploads/pdfs/:token/:filename`, where the token is an HMAC-SHA256 over the filename **and** an expiry, minted per read by `services/pdf-url.ts` and never persisted. A leaked URL now stops working on its own. Two limits worth knowing: the link is a **bearer capability** for its lifetime — anyone holding it can fetch that PDF, there is no per-viewer binding — and revocation is all-or-nothing (rotate `JWT_SECRET`, or delete the file). Per-file revocation is in [`docs/BACKLOG.md`](../BACKLOG.md). | ~~High~~ | `backend/src/services/pdf-url.ts` |
| ~~S2~~ | ~~**No rate limiting anywhere.**~~ **Resolved** ([`features/0002`](../../features/0002-rate-limiting-on-public-write-paths.md)). The three unauthenticated write paths carry per-IP limiters. Two limits remain deliberately absent and are tracked in [`docs/BACKLOG.md`](../BACKLOG.md): a shared store (the current one is per-process, so the effective limit multiplies by replica count) and account-level lockout. | ~~High~~ | `middleware/rateLimit.ts` |
| ~~S3~~ | ~~**Author-supplied regex executed on a public endpoint.**~~ **Resolved** ([`features/0004`](../../features/0004-safe-author-supplied-regex.md)). Patterns are compiled by RE2, which cannot backtrack, so execution is linear in input length: the case that took 155 s on a native `RegExp` now takes 0.05 ms. Patterns are also validated when stored, so an invalid one is rejected with a `400` instead of turning every later submission into a 500. | ~~High~~ | `backend/src/services/pattern-validator.ts` |
| S4 | **JWT in `localStorage`, 7-day lifetime, not revocable.** Any XSS on the origin yields a week of full account access with no way to cut it short. The editor renders user-controlled content and loads PDF.js, which widens the XSS surface rather than narrowing it. | **High** | `frontend/src/services/api.ts` |
| ~~S5~~ | ~~**No security headers.**~~ **Resolved** ([`features/0007`](../../features/0007-security-headers-and-csp.md)). `helmet` sets the header set on every API response, and the SPA carries a CSP built in `frontend/vite.config.ts`. Three limits worth knowing, all deliberate: `style-src` needs `'unsafe-inline'` (measured — see below); the SPA policy is a `<meta>` element, so `frame-ancestors`, `report-uri` and `sandbox` cannot be expressed and must come from the production host; and there is no violation reporting. | ~~Medium~~ | `backend/src/app.ts`, `frontend/vite.config.ts` |
| S6 | **Uploads are not scanned.** A file is accepted on mimetype plus a `pdf-lib` parse, then stored and served back to browsers from our own origin. | **Medium** | `middleware/upload.ts` |
| S7 | **PII is collected from respondents with no notice, retention limit or erasure path.** Every submission stores `ipAddress` and `userAgent`, plus whatever the form author asked for — which in the target market means health, financial or employment data. | **Medium** (legal: high) | `routes/responses.ts` |
| S8 | **No account deletion and no data export.** Neither the account holder nor a respondent has any way to exercise erasure or portability. | **Medium** (legal: high) | no endpoint exists |
| S9 | **The error handler logs full error objects** with `console.error`, including whatever a Prisma error carries in its parameters. With no log redaction and no structured logging, secrets and PII can land in stdout. | **Medium** | `middleware/errorHandler.ts` |
| S10 | **Weak password policy, no lockout, no breach check.** Six characters, unlimited attempts. | **Medium** | `routes/auth.ts` |
| S11 | **`viewCount` is incremented by any anonymous GET**, so the only usage metric the product has is trivially forgeable — and it is the kind of number a usage-based plan would eventually meter on. | **Low** | `routes/forms.ts` |

Correctly handled today, and worth not regressing: uploaded PDFs are reachable only through a signed, expiring URL, and the URL persisted in `Form.pdfUrl` is always the unsigned canonical one; ownership failures return 404 rather than 403; the public form endpoint strips `userId`; the 500 handler never leaks internal messages; user selects are explicit so `passwordHash` cannot escape; CORS is pinned to a single configured origin; the service refuses to start without `JWT_SECRET`.

## Where the headers actually are

The single most important thing to know before changing anything here: **a CSP constrains a document, and `backend/src/app.ts` never serves one.** It serves JSON and one PDF; `frontend/index.html` is served by Vite in development and by whatever hosts the built assets in production. So the work splits in two, and mounting `helmet()` alone would have closed the finding on paper while leaving the XSS path untouched.

| Delivered by | Covers | Set in |
|---|---|---|
| `helmet` | Every API response: `nosniff`, `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy: same-origin`, `Cross-Origin-Opener-Policy`, `X-Frame-Options`, and no `X-Powered-By` | `backend/src/app.ts` |
| A per-response `setHeader` | The signed PDF route: `default-src 'none'; object-src 'none'; frame-ancestors 'none'; sandbox`, plus `X-Frame-Options: DENY` | `backend/src/app.ts`, in the `/uploads/pdfs/:token/:filename` handler |
| A `<meta http-equiv>` injected at build time | The SPA — the origin that actually runs application code | `frontend/vite.config.ts` (`buildCsp`) |

Two headers are deliberately **not** what a default install would give:

- **`contentSecurityPolicy: false` in the `helmet()` call.** Not an oversight. A policy on a JSON response governs nothing, and asserting its absence is a test in `backend/tests/security-headers.spec.ts` precisely so nobody "fixes" it.
- **`Cross-Origin-Resource-Policy: cross-origin` on the PDF route only**, overriding helmet's `same-origin` default. The SPA is a different origin and must fetch that file; under the default every PDF in the editor and every published form silently fails to render. The access control there is the signed token, not the origin ([`features/0006`](../../features/0006-signed-expiring-urls-for-uploaded-pdfs.md)).

**HSTS is off by default**, behind `ENABLE_HSTS`. A browser that receives `Strict-Transport-Security` from `localhost` forces HTTPS on `localhost` for every port afterwards. The deployment turns it on where TLS terminates ([08-operations](./08-operations.md)).

### What the SPA policy does not cover

- **`style-src` requires `'unsafe-inline'`.** This was measured, not assumed: under `style-src 'self'` a single editor session produces 423 violations — 373 with `effectiveDirective: style-src-attr` (Vue `:style` bindings and the editor's absolutely positioned field overlays) and 50 with `style-src-elem` (PrimeVue 4 injecting its theme at runtime). Because both shapes occur, splitting into `style-src-elem` and `style-src-attr` grants the same permission with more words — it was tried. A nonce is not available: nonces are per-response and `index.html` is a static asset. Narrowing this means changing how the app styles things, not how the policy is written.
- **`frame-ancestors`, `report-uri` and `sandbox` are absent.** A `<meta>`-delivered policy cannot express them; browsers ignore them and warn. They must be sent as a real header by whatever serves the SPA in production — recorded as a deployment requirement in [08-operations](./08-operations.md).
- **There is no violation reporting**, so a policy the app quietly breaks in a browser nobody is watching will not be noticed. That needs somewhere to send reports, which is the structured-logging item (S9). Filed in [`docs/BACKLOG.md`](../BACKLOG.md).
- **`script-src` is `'self'` with no `'unsafe-eval'`**, which required turning off pdf.js's eval-based font path (`isEvalSupported: false` in `frontend/src/composables/usePDFRendering.ts`). If a future change reintroduces a library that needs `eval`, the cost is the whole point of this policy — treat it as a design decision, not a config tweak.

## Recommended order of work

Ordered by risk removed per unit of effort, not by severity alone:

1. ~~**Rate limiting** (S2)~~ — done.
2. ~~**A regex guard** (S3)~~ — done.
3. ~~**`helmet` plus a CSP** (S5)~~ — done. Cheaper than expected on the API and more subtle on the SPA, for the reason in **Where the headers actually are** below.
4. ~~**Signed, expiring URLs for PDFs** (S1)~~ — done, on local disk. `services/pdf-url.ts` is the seam the move to object storage in [08-operations.md](./08-operations.md) replaces with presigned S3/R2 URLs; nothing else builds an `/uploads` path.
5. **Token handling** (S4): shorten expiry, add refresh, and move the session to an `httpOnly` `Secure` `SameSite` cookie. This is a real change on both sides — plan it as a feature, not a patch. **This is now the next item**, and the CSP from item 3 narrows the XSS path that gives it its severity without removing the need for it.
6. **A privacy layer** (S7, S8): a retention policy per form, an IP-collection toggle, a respondent notice on the public form, account deletion, and per-account export.
7. **Structured logging with redaction** (S9), which is also the observability prerequisite in [08](./08-operations.md).

## Data inventory

Needed for any privacy policy, DPA or security questionnaire, so it is maintained here rather than reconstructed under time pressure.

| Data | Subject | Where | Lawful basis (intended) | Retention today |
|---|---|---|---|---|
| Email, name, password hash | Account holder | `users` | Contract | Indefinite — no deletion path |
| Uploaded PDF | Account holder | Local disk, served only through a signed expiring URL | Contract | Indefinite |
| Form and field definitions | Account holder | `forms`, `fields` | Contract | Until the form is deleted |
| Answer values | **Respondent** | `answers` | The form author's basis; we are the processor | Indefinite |
| IP address, user agent | **Respondent** | `responses` | Legitimate interest (anti-abuse) — **but not documented, not disclosed, and not currently used for anti-abuse** | Indefinite |

The last row is the weakest position in this table. Data collected for a stated purpose that the system does not actually implement is hard to defend. Either use it for abuse prevention and say so, or stop collecting it. Deciding this is cheap now and expensive after the first enterprise review.

## Roles and responsibilities

For form responses the customer is the data controller and this product is the processor. That means the roadmap eventually needs a DPA, subprocessor list, breach-notification path and documented retention. None exists yet. This is not premature for B2B — it is the second page of every procurement questionnaire.

## Rules for new code

1. **Every new route declares its authentication and authorization explicitly.** A route with neither is a deliberate, reviewed decision, not an omission.
2. **Every new public endpoint ships with rate limiting.** Add a named limiter in `middleware/rateLimit.ts` and apply it at the route, the way `authenticate` is applied. Its limit and window come from the environment, so the test suites and CI can set their own without weakening the production default.
3. **New personal data added to a model updates the inventory above in the same PR.** A field that appears in the schema but not in this table cannot be answered for in an audit.
4. **Never log a whole request, error or entity object.** Log identifiers and the fields you actually need.
5. **User-supplied code-like input** — regex, templates, formulas, file names — is untrusted input with a resource cost, not just a value to validate. Compile it through one audited helper (`services/pattern-validator.ts` is the model), never at the call site, and remember that a synchronous evaluator **cannot** be bounded by a timeout on the same thread.
