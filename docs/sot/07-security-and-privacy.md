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
  └── GET  /uploads/pdfs/<file>        reads any uploaded PDF, no auth, no expiry, no throttle

Authenticated user (JWT)
  └── /api/forms, /api/upload, /api/auth/me   scoped to resources they own

Server-side, no boundary
  └── PDF processing, filesystem writes, author-supplied regex execution
```

These are the whole external attack surface. The three write paths are rate limited; the two read paths are not, which is a deliberate gap — a limit on `GET /api/forms/public/:shareId` has to be reconciled with `viewCount` (S11) and with legitimately popular forms, and `/uploads` is being replaced by signed URLs (S1).

**Per-IP is only as good as `req.ip`.** That depends on `trust proxy`, configured from `TRUST_PROXY_HOPS` in `app.ts` and defaulting to trusting nothing. Set too high — or to `true` — and the client can forge its own identity through `X-Forwarded-For` and bypass every limiter. See [08-operations](./08-operations.md#configuration).

## Findings

Severity is about impact on the product's ability to be sold and trusted, not CVSS.

| # | Finding | Severity | Where |
|---|---|---|---|
| S1 | **Uploaded PDFs are served publicly and permanently.** `app.ts` mounts `express.static` on `/uploads`. Any PDF is fetchable by URL with no token, no expiry and no revocation. Filenames are unguessable (`nanoid(12)` + timestamp), so this is security by obscurity: once a URL leaks — a browser history, a shared link, a proxy log — access cannot be withdrawn. Uploaded PDFs frequently contain the customer's own confidential template. | **High** | `backend/src/app.ts` |
| ~~S2~~ | ~~**No rate limiting anywhere.**~~ **Resolved** ([`features/0002`](../../features/0002-rate-limiting-on-public-write-paths.md)). The three unauthenticated write paths carry per-IP limiters. Two limits remain deliberately absent and are tracked in [`docs/BACKLOG.md`](../BACKLOG.md): a shared store (the current one is per-process, so the effective limit multiplies by replica count) and account-level lockout. | ~~High~~ | `middleware/rateLimit.ts` |
| S3 | **Author-supplied regex executed on a public endpoint.** `routes/responses.ts` runs `new RegExp(field.validation.pattern).test(value)` on every submission. A catastrophically backtracking pattern — whether malicious or merely careless — blocks the single Node event loop for the entire service. | **High** | `backend/src/routes/responses.ts` |
| S4 | **JWT in `localStorage`, 7-day lifetime, not revocable.** Any XSS on the origin yields a week of full account access with no way to cut it short. The editor renders user-controlled content and loads PDF.js, which widens the XSS surface rather than narrowing it. | **High** | `frontend/src/services/api.ts` |
| S5 | **No security headers.** No `helmet`, no CSP, no `X-Content-Type-Options`, no `Referrer-Policy`, no HSTS. PDFs are served from the same origin as the app, so a crafted file is same-origin content. | **Medium** | `backend/src/app.ts` |
| S6 | **Uploads are not scanned.** A file is accepted on mimetype plus a `pdf-lib` parse, then stored and served back to browsers from our own origin. | **Medium** | `middleware/upload.ts` |
| S7 | **PII is collected from respondents with no notice, retention limit or erasure path.** Every submission stores `ipAddress` and `userAgent`, plus whatever the form author asked for — which in the target market means health, financial or employment data. | **Medium** (legal: high) | `routes/responses.ts` |
| S8 | **No account deletion and no data export.** Neither the account holder nor a respondent has any way to exercise erasure or portability. | **Medium** (legal: high) | no endpoint exists |
| S9 | **The error handler logs full error objects** with `console.error`, including whatever a Prisma error carries in its parameters. With no log redaction and no structured logging, secrets and PII can land in stdout. | **Medium** | `middleware/errorHandler.ts` |
| S10 | **Weak password policy, no lockout, no breach check.** Six characters, unlimited attempts. | **Medium** | `routes/auth.ts` |
| S11 | **`viewCount` is incremented by any anonymous GET**, so the only usage metric the product has is trivially forgeable — and it is the kind of number a usage-based plan would eventually meter on. | **Low** | `routes/forms.ts` |

Correctly handled today, and worth not regressing: ownership failures return 404 rather than 403; the public form endpoint strips `userId`; the 500 handler never leaks internal messages; user selects are explicit so `passwordHash` cannot escape; CORS is pinned to a single configured origin; the service refuses to start without `JWT_SECRET`.

## Recommended order of work

Ordered by risk removed per unit of effort, not by severity alone:

1. ~~**Rate limiting** (S2)~~ — done.
2. **A regex guard** (S3): a length cap on `pattern`, a compile-time complexity check, and execution under a timeout — or move the check to a safe engine. Also validate the pattern at authoring time so the author learns immediately rather than the respondent.
3. **`helmet` plus a CSP** (S5). Near-zero effort.
4. **Signed, expiring URLs for PDFs** (S1), which arrives naturally with the move to object storage in [08-operations.md](./08-operations.md).
5. **Token handling** (S4): shorten expiry, add refresh, and move the session to an `httpOnly` `Secure` `SameSite` cookie. This is a real change on both sides — plan it as a feature, not a patch.
6. **A privacy layer** (S7, S8): a retention policy per form, an IP-collection toggle, a respondent notice on the public form, account deletion, and per-account export.
7. **Structured logging with redaction** (S9), which is also the observability prerequisite in [08](./08-operations.md).

## Data inventory

Needed for any privacy policy, DPA or security questionnaire, so it is maintained here rather than reconstructed under time pressure.

| Data | Subject | Where | Lawful basis (intended) | Retention today |
|---|---|---|---|---|
| Email, name, password hash | Account holder | `users` | Contract | Indefinite — no deletion path |
| Uploaded PDF | Account holder | Local disk, publicly served | Contract | Indefinite |
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
5. **User-supplied code-like input** — regex, templates, formulas, file names — is untrusted input with a resource cost, not just a value to validate.
