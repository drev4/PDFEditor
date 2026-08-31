# Security and privacy

This document exists because the product collects other people's data through a public link, and because a B2B buyer's security questionnaire is a sales blocker, not a formality.

Everything below is the state of the code on **2026-08-28**, read out of the source. Nothing here is aspirational; planned work is in [`docs/BACKLOG.md`](../BACKLOG.md).

## Authentication and authorization model

| Aspect | Current implementation |
|---|---|
| Credential | Email plus password, minimum **6 characters**, no complexity or breach check |
| Password storage | `bcrypt`, cost factor **10** |
| Session | Two credentials. An **access token** — JWT, HS256, payload `{userId}`, lifetime `JWT_ACCESS_TTL`, default **15 minutes** — and a **refresh token**, 32 bytes of CSPRNG output stored as a SHA-256 in `refresh_tokens` with a **7-day** default lifetime |
| Token transport | Access token in the `Authorization: Bearer` header. Refresh token in an `httpOnly`, `Secure`, `SameSite=Lax` cookie scoped to `Path=/api/auth` |
| Token storage | Access token **in memory only** (`frontend/src/services/api.ts`), gone on reload. Refresh token in a cookie the page cannot read. **Nothing authenticating is in `localStorage`** — what remains there is the `user` object, a rendering hint that authorises nothing |
| Revocation | **Yes, on the refresh token.** Logout, rotation and reuse detection all set `revokedAt`. An **access token is still not revocable** for its remaining lifetime — that is the price of verifying it without a database round trip, and why it is 15 minutes |
| Rotation | Every refresh issues a new token and revokes the one presented. Presenting an already-revoked token is treated as replay and **revokes the whole family**, ending that session everywhere |
| Logout | Server-side. `POST /api/auth/logout` revokes the family, so a captured refresh token stops working. Local state is cleared even if the request fails |
| CSRF | `POST /api/auth/refresh` and `POST /api/auth/logout` are the only cookie-authenticated routes and carry `middleware/csrf.ts`. Everything else authenticates with a header, which cannot be set cross-site, so it is not a CSRF target |
| Authorization | **Tenancy.** A caller may act on a form when a `Membership` links them to the organization that owns it — `verifyFormOwnership` / `verifyFieldOwnership`, called per handler. `Form.createdByUserId` is provenance and is never an input. Membership is resolved from the database per request, **not** carried in the JWT: access tokens live 15 minutes and cannot be revoked, so a membership claim inside one would keep working for 15 minutes after someone was removed from an organization |
| Roles | `owner \| admin \| member`, **enforced** ([`features/0010`](../../features/0010-member-invitations-and-role-enforcement.md)). `requireRole` in `middleware/membership.ts` is the only reader. `owner` invites anyone, changes roles, removes members; `admin` manages forms and invites `member`s; `member` manages forms. **An organization can never be left without an owner** — demoting or removing the last one is refused |
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
  ├── GET  /uploads/pdfs/<sig>/<file>  reads one uploaded PDF, no auth, signature-gated, expiring, no throttle
  └── POST /api/billing/webhook        writes subscriptions and plans, no session,
                                       Stripe-signature-gated, RAW body, no throttle (argued below)

Authenticated user (access token)
  ├── /api/auth/me, /api/upload               the caller themselves
  └── /api/forms/**                           scoped to the ORGANIZATIONS they are a member of
                                              (not to what they created)

Tenant boundary
  └── Organization ──< Membership >── User    the only thing an authorization check reads

Server-side, no boundary
  └── PDF processing, filesystem writes
```

These are the whole external attack surface. Three of the four write paths are rate limited; the two read paths are not, which is a deliberate gap — a limit on `GET /api/forms/public/:shareId` has to be reconciled with `viewCount` (S11) and with legitimately popular forms, and the PDF route now requires a signature this service issued, which bounds who can call it at all.

**Author-supplied regex is compiled by RE2, and degrades to no constraint.** A `pattern` that the engine cannot compile — one stored before validation existed, or an engine that failed to load — is logged and treated as *no pattern constraint*, never thrown. Throwing would restore the 500 this fixed; rejecting would punish a respondent for the author's mistake. `pattern` is a formatting convenience that nothing downstream trusts, so unconstrained is the right degradation — but do not read the field as a guaranteed-enforced rule.

**`POST /api/billing/webhook` has no rate limiter, and rule 2 below requires that to be argued in writing** ([`features/0013`](../../features/0013-stripe-subscriptions.md)). The argument is that the signature is a strictly *stronger* gate than a limiter, not a weaker one: an unsigned or forged request is rejected before any work at the cost of one HMAC, so there is no expensive path behind it to protect, and there is no enumeration to slow down because the endpoint returns nothing an attacker can learn from. What a limiter *would* throttle is **Stripe's own retries** — and every dropped retry is a subscription state this application never learns about: a customer who paid and did not get the plan, or one who cancelled and kept it. The failure mode of adding the limiter is worse than the failure mode it prevents. `backend/tests/billing.spec.ts` asserts that 40 unsigned requests all answer `400` and none answers `429`, so the absence is deliberate and stays deliberate.

Two more things about that route are security-relevant and easy to break. **It must stay mounted above `express.json()`** — Stripe signs the exact bytes it sent, so a parsed-and-restringified body fails every signature check, silently and totally, leaving an endpoint that answers while activating nobody. And **it answers `200` to anything it verified but did not act on** — a duplicate, an unknown event type, an unresolvable organization — because any other status makes Stripe retry forever and eventually disable the endpoint, which would take every real customer's subscription updates down with it. See [04-backend-patterns §10a](./04-backend-patterns.md).

**No card data is stored anywhere in this system, and none ever reaches this origin.** Checkout and the Customer Portal are hosted by Stripe; the application holds only opaque Stripe identifiers (`cus_…`, `sub_…`, `price_…`) in `subscriptions`. There is no PAN, no last four digits, no expiry and no card token. That is a deliberate architectural choice rather than a gap — Stripe Elements or any in-app card form would move the PCI surface onto this origin, and deciding otherwise is a security decision, not a UI one. None of those identifiers is exposed to the client either: `GET /api/organizations/entitlements` returns only `status`, `currentPeriodEnd` and `cancelAtPeriodEnd`.

**`UsageCounter` is not personal data**, and the judgement is recorded here so the next reader does not have to make it again. It holds an organization id, a `YYYY-MM` string and a count. It says nothing about who submitted, from where, or what they answered — a count of submissions per tenant per month is business telemetry about a customer *organization*, not about a person, and it is not linkable to a respondent. It therefore adds no row to the data inventory and nothing to an erasure request. Note the direction this cuts: because it is not personal data, it is also **not deleted** by a respondent-facing erasure, which is the correct outcome for a billing meter.

**The tenant boundary is one filter, and it is the whole of multi-tenancy.** Every form query is scoped by `organization: { memberships: { some: { userId } } }` ([04-backend-patterns §9](./04-backend-patterns.md)). A cross-tenant read is a `404`, never a `403`, so no endpoint confirms that a form id exists. `backend/tests/integration/tenancy.spec.ts` asserts that on every affected route, and all eight of its tests fail if the filter is removed — which was verified rather than assumed.

**Per-IP is only as good as `req.ip`.** That depends on `trust proxy`, configured from `TRUST_PROXY_HOPS` in `app.ts` and defaulting to trusting nothing. Set too high — or to `true` — and the client can forge its own identity through `X-Forwarded-For` and bypass every limiter. See [08-operations](./08-operations.md#configuration).

## Findings

Severity is about impact on the product's ability to be sold and trusted, not CVSS.

| # | Finding | Severity | Where |
|---|---|---|---|
| ~~S1~~ | ~~**Uploaded PDFs are served publicly and permanently.**~~ **Resolved** ([`features/0006`](../../features/0006-signed-expiring-urls-for-uploaded-pdfs.md)). `express.static` is gone. A PDF is reachable only through `GET /uploads/pdfs/:token/:filename`, where the token is an HMAC-SHA256 over the filename **and** an expiry, minted per read by `services/pdf-url.ts` and never persisted. A leaked URL now stops working on its own. Two limits worth knowing: the link is a **bearer capability** for its lifetime — anyone holding it can fetch that PDF, there is no per-viewer binding — and revocation is all-or-nothing (rotate `JWT_SECRET`, or delete the file). Per-file revocation is in [`docs/BACKLOG.md`](../BACKLOG.md). | ~~High~~ | `backend/src/services/pdf-url.ts` |
| ~~S2~~ | ~~**No rate limiting anywhere.**~~ **Resolved** ([`features/0002`](../../features/0002-rate-limiting-on-public-write-paths.md)). The three unauthenticated write paths carry per-IP limiters. Two limits remain deliberately absent and are tracked in [`docs/BACKLOG.md`](../BACKLOG.md): a shared store (the current one is per-process, so the effective limit multiplies by replica count) and account-level lockout. | ~~High~~ | `middleware/rateLimit.ts` |
| ~~S3~~ | ~~**Author-supplied regex executed on a public endpoint.**~~ **Resolved** ([`features/0004`](../../features/0004-safe-author-supplied-regex.md)). Patterns are compiled by RE2, which cannot backtrack, so execution is linear in input length: the case that took 155 s on a native `RegExp` now takes 0.05 ms. Patterns are also validated when stored, so an invalid one is rejected with a `400` instead of turning every later submission into a 500. | ~~High~~ | `backend/src/services/pattern-validator.ts` |
| ~~S4~~ | ~~**JWT in `localStorage`, 7-day lifetime, not revocable.**~~ **Resolved** ([`features/0008`](../../features/0008-session-hardening.md)). The long-lived credential is an `httpOnly` cookie an XSS cannot read; the access token it can read is in memory and lasts 15 minutes; and logout now actually ends the session. What remains: an access token cannot be revoked within its lifetime, so the worst case is **15 minutes** of access rather than seven days. | ~~High~~ | `backend/src/services/refresh-token.ts`, `frontend/src/services/api.ts` |
| ~~S5~~ | ~~**No security headers.**~~ **Resolved** ([`features/0007`](../../features/0007-security-headers-and-csp.md)). `helmet` sets the header set on every API response, and the SPA carries a CSP built in `frontend/vite.config.ts`. Three limits worth knowing, all deliberate: `style-src` needs `'unsafe-inline'` (measured — see below); the SPA policy is a `<meta>` element, so `frame-ancestors`, `report-uri` and `sandbox` cannot be expressed and must come from the production host; and there is no violation reporting. | ~~Medium~~ | `backend/src/app.ts`, `frontend/vite.config.ts` |
| S6 | **Uploads are not scanned.** A file is accepted on mimetype plus a `pdf-lib` parse, then stored and served back to browsers from our own origin. | **Medium** | `middleware/upload.ts` |
| S7 | **PII is collected from respondents with no notice, retention limit or erasure path.** Every submission stores `ipAddress` and `userAgent`, plus whatever the form author asked for — which in the target market means health, financial or employment data. | **Medium** (legal: high) | `routes/responses.ts` |
| S8 | **No account deletion and no data export.** Neither the account holder nor a respondent has any way to exercise erasure or portability. | **Medium** (legal: high) | no endpoint exists |
| S9 | **The error handler logs full error objects** with `console.error`, including whatever a Prisma error carries in its parameters. With no log redaction and no structured logging, secrets and PII can land in stdout. | **Medium** | `middleware/errorHandler.ts` |
| S10 | **Weak password policy, no lockout, no breach check.** Six characters, unlimited attempts. | **Medium** | `routes/auth.ts` |
| S11 | **`viewCount` is incremented by any anonymous GET**, so the only usage metric the product has is trivially forgeable — and it is the kind of number a usage-based plan would eventually meter on. | **Low** | `routes/forms.ts` |

Correctly handled today, and worth not regressing: uploaded PDFs are reachable only through a signed, expiring URL, and the URL persisted in `Form.pdfUrl` is always the unsigned canonical one; ownership failures return 404 rather than 403; the public form endpoint strips `userId`; the 500 handler never leaks internal messages; user selects are explicit so `passwordHash` cannot escape; CORS is pinned to a single configured origin; the service refuses to start without `JWT_SECRET`.

## The session model

Two credentials, deliberately split, because they have opposite requirements.

| | Access token | Refresh token |
|---|---|---|
| What it is | JWT, HS256, `{userId}` | 32 random bytes |
| Lifetime | 15 minutes (`JWT_ACCESS_TTL`) | 7 days (`REFRESH_TOKEN_TTL_DAYS`) |
| Where the browser keeps it | A module variable in `services/api.ts`. Never `localStorage`, never a cookie | `httpOnly` cookie, `Path=/api/auth` |
| Readable by page JavaScript | Yes | **No** |
| Revocable | **No** — verifying it must not cost a database round trip | Yes, via `revokedAt` |
| Sent with | `Authorization: Bearer`, on every API request | The cookie, only to `/api/auth/*` |

**Why the access token is not in the cookie too.** Moving everything to a cookie is the obvious reading of "use `httpOnly`", and it would have been worse. A `Bearer` header cannot be set by a cross-site request, so the entire API is CSRF-immune as it stands; the moment a cookie authenticates a write, every one of those routes becomes forgeable and needs a defence it does not have. Splitting the two keeps the long-lived credential unreadable **and** keeps the CSRF surface at exactly two endpoints, which is small enough to guard properly and to test.

**Rotation and replay.** Each refresh issues a new token and revokes the one presented. If an already-revoked token is presented, it was either captured and replayed or the client retried — indistinguishable from the server — so the whole `family` is revoked. The legitimate user logs in again; the attacker gets nothing. Silently allowing it is what makes rotation decorative.

**The client side has one non-obvious requirement:** the refresh-on-401 in `services/api.ts` is single-flight. Several requests failing at once would otherwise each start a refresh, and with rotation the second presents an already-exchanged token — the server reads it as replay, kills the family, and the user is logged out by the mechanism meant to keep them signed in.

### What the session model does not cover

- **An access token cannot be revoked within its lifetime.** Logging out, or revoking a stolen session, stops the refresh but leaves any access token already issued working for up to 15 minutes. Shortening it further trades user-visible latency for that window; making it revocable means a database read on every authenticated request. The 15 minutes is the deliberate middle.
- **`SameSite=Lax` requires the SPA and the API to be same-site**, which is a deployment property nothing in the code enforces. Development is same-site (`localhost` on two ports), so this will look fine locally and fail in production if the two are put on unrelated domains. The requirement is in [08-operations](./08-operations.md); `SameSite=None` is not a fix, because Safari and Firefox block third-party cookies outright.
- **No idle timeout and no session listing.** A refresh token lives 7 days regardless of use, and a user cannot see or revoke their other sessions. Filed in [`docs/BACKLOG.md`](../BACKLOG.md).
- **No account-level lockout** (S10), unchanged by this work.

## Invitations are bearer capabilities

There is **no email service in this application** — no provider, no dependency, no configuration. An invitation therefore produces a link the inviter copies and delivers themselves, the same idiom as the `shareId` public form link. That makes it the same class of thing as the signed PDF URL in [`features/0006`](../../features/0006-signed-expiring-urls-for-uploaded-pdfs.md): whoever holds it can spend it.

What bounds it:

| Control | How |
|---|---|
| Unguessable | 32 bytes of CSPRNG output, base64url |
| Not recoverable from the database | Stored as a SHA-256; the raw token exists only in the response that creates it |
| Expiring | `INVITATION_TTL_HOURS`, default **72** |
| Single-use | `acceptedAt` is set inside the accepting transaction |
| Cancellable | `revokedAt`, set by `DELETE /api/organizations/invitations/:id`. **A JWT would not have been** — the same reason it was rejected for sessions in [`0008`](../../features/0008-session-hardening.md) |
| Bound to one address | Accepting while signed in as a different email is refused with `409`, not silently granted — a forwarded link must not put the wrong person inside a customer's organization |
| Throttled | `POST /api/organizations/invitations/accept` is unauthenticated by design and carries a named per-IP limiter. Unknown, expired, revoked and already-accepted tokens all answer identically, so it is not an oracle |

**What this does not do:** nothing notifies the invited person. If the inviter loses the link before sending it, the invitation is unusable and has to be revoked and reissued. An email provider is filed in [`docs/BACKLOG.md`](../BACKLOG.md); it wants the job queue that arrives at step 9 of the [build order](./10-saas-roadmap.md#build-order).

### Two rejections, two codes

| Situation | Status | Why |
|---|---|---|
| Not a member of the organization | `404` | A `403` confirms the resource exists. Unchanged from [`0009`](../../features/0009-organizations-own-resources.md) |
| A member whose role does not allow it | `403` | They already know it exists — they are inside the organization. Hiding it tells them nothing and makes the product feel broken |

Both are asserted on the same endpoint in `backend/tests/integration/organization-roles.spec.ts`. This mirrors the `402` / `403` split the roadmap specifies for plan limits versus permissions.

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
5. ~~**Token handling** (S4)~~ — done ([`features/0008`](../../features/0008-session-hardening.md)). See **The session model** below for what it does and does not cover.
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
| Stripe customer and subscription identifiers | Account holder (the paying organization) | `subscriptions` | Contract | Until the organization is deleted (`onDelete: Cascade`) |
| Stripe event ids | — | `stripe_events` | Legitimate interest (correct billing) | Indefinite, and deliberately not linked to an organization — see [03-domain-model](./03-domain-model.md) |

**Neither Stripe row is card data.** `subscriptions` holds `stripe_customer_id`, `stripe_subscription_id`, `price_id`, a status string and two dates. The name on the card, the card number, the billing address and the invoice history are all held by **Stripe**, which is therefore a subprocessor and belongs on the subprocessor list this product does not yet have (see below). `stripe_events` holds an event id, an event type and a timestamp, and describes no person at all.

The last row is the weakest position in this table. Data collected for a stated purpose that the system does not actually implement is hard to defend. Either use it for abuse prevention and say so, or stop collecting it. Deciding this is cheap now and expensive after the first enterprise review.

## Roles and responsibilities

For form responses the customer is the data controller and this product is the processor. That means the roadmap eventually needs a DPA, subprocessor list, breach-notification path and documented retention. None exists yet — and the subprocessor list is now overdue rather than hypothetical, because **Stripe is a subprocessor** as of [`features/0013`](../../features/0013-stripe-subscriptions.md). This is not premature for B2B — it is the second page of every procurement questionnaire.

## Rules for new code

1. **Every new route declares its authentication and authorization explicitly.** A route with neither is a deliberate, reviewed decision, not an omission.
2. **Every new public endpoint ships with rate limiting, or an argument in this document for why not.** Add a named limiter in `middleware/rateLimit.ts` and apply it at the route, the way `authenticate` is applied. Its limit and window come from the environment, so the test suites and CI can set their own without weakening the production default. There is exactly one endpoint without one — the Stripe webhook — and its argument is above; copy that standard of proof, including a test that the absence is intentional, or add the limiter.
3. **New personal data added to a model updates the inventory above in the same PR.** A field that appears in the schema but not in this table cannot be answered for in an audit.
4. **Never log a whole request, error or entity object.** Log identifiers and the fields you actually need.
5. **User-supplied code-like input** — regex, templates, formulas, file names — is untrusted input with a resource cost, not just a value to validate. Compile it through one audited helper (`services/pattern-validator.ts` is the model), never at the call site, and remember that a synchronous evaluator **cannot** be bounded by a timeout on the same thread.
