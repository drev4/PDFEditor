# 0020 — Outbound webhooks, and the first request this server makes to an address a customer chose

**Status:** backlog
**Priority:** P2 (see [`docs/BACKLOG.md`](../docs/BACKLOG.md) — *Webhooks with signed payloads, retries and a delivery log*)
**Branch:** *(filled in when it moves to "in progress")*
**Related:** [10-saas-roadmap §build order](../docs/sot/10-saas-roadmap.md#build-order) · [07-security-and-privacy](../docs/sot/07-security-and-privacy.md) · [04-backend-patterns §5](../docs/sot/04-backend-patterns.md) · [06-api-reference](../docs/sot/06-api-reference.md) · [08-operations](../docs/sot/08-operations.md) · [`features/0017`](0017-job-queue-for-pdf-embedding.md) · [`features/0019`](0019-api-keys-and-read-only-public-api.md) · [`features/0013`](0013-stripe-subscriptions.md)

## Context

**The last item in the build order.** [`features/0019`](0019-api-keys-and-read-only-public-api.md) shipped the read half of step 10 — API keys and `/api/v1` — and left this: the half where the product calls the customer instead of the customer calling the product. The backlog row names the three parts, and they are not separable: signed payloads, a retry policy, and a delivery log the customer can read.

It is unblocked rather than new. [`features/0017`](0017-job-queue-for-pdf-embedding.md) brought the queue that retries need, and this is the second job type on it. [`features/0019`](0019-api-keys-and-read-only-public-api.md) settled the shape a machine-facing feature takes here: it belongs to an **organization**, not to a user, and its credentials are rows that can be revoked.

Polling exists as an alternative and is why this is P2 rather than P1: a customer *can* poll `GET /api/v1/forms/:id/responses`. Webhooks are what make an integration cheap enough to build, and they are the thing every "does it integrate with…" conversation asks for.

**No prior attempt.** `git log --all` has no webhook branch and no revert. Note that the word appears in the codebase already, meaning the *incoming* Stripe webhook — the opposite direction, and one useful precedent (see trap 4).

## Why the obvious approach is wrong

### 1. `fetch(endpoint.url)` is SSRF, and this is the first outbound request in the codebase

**Nothing in `backend/src` makes an outbound HTTP request today.** Grep it: there is no `fetch(`, no axios, no `http.request` — the only egress is the Stripe SDK, to an address this repository chose. This feature adds the first request to a URL a **customer** supplies, made from inside the deployment's own network, and that is the single most dangerous thing in it.

A naive implementation lets any customer aim this server at:

- `http://169.254.169.254/latest/meta-data/` — the cloud metadata service, which on many deployments hands out credentials;
- `http://localhost:3000/api/...` — this very API, from inside, bypassing whatever sits in front of it;
- `10.0.0.0/8`, `192.168.0.0/16`, `172.16.0.0/12` — the private network the database is on, using delivery latency and error text as a port scanner.

The delivery client must therefore, and none of these is optional:

- **require `https://`**, and reject anything else at configuration time *and* at delivery time;
- **resolve the hostname and check every resolved address** against loopback, private, link-local (including `169.254.0.0/16`), unique-local, multicast and `0.0.0.0/8`;
- **connect to the address it checked.** Checking a hostname and then handing the hostname to `fetch` is a DNS-rebinding hole: the second resolution can answer differently. Pin the validated IP for the connection, or re-validate in a socket-level hook;
- **refuse redirects.** A `302` to `http://169.254.169.254/` undoes every check above. Following redirects with re-validation at each hop is possible and is more code than it is worth for a webhook;
- **bound the request**: a connect and total timeout, and a cap on the response body read. A customer endpoint that accepts the connection and never answers is a worker slot held for ever — the failure mode [`features/0017`](0017-job-queue-for-pdf-embedding.md) already learned about locks, in a new place.

Write these as one audited module the way `services/pdf-storage.ts` and `services/pattern-validator.ts` are, and make it the only thing in the repository that may make an outbound request to a customer-supplied address.

### 2. The queue is optional for embedding and must **not** be optional here

[`features/0017`](0017-job-queue-for-pdf-embedding.md) established that `REDIS_URL` unset means the work runs inline in the request, and that pattern is right there and wrong here, for two independent reasons:

- **The caller is a respondent.** The event source is `POST /api/responses`, an anonymous public endpoint. An inline delivery puts a third party's endpoint on the critical path of somebody submitting a form: a customer whose server takes 30 seconds makes *their own respondents* wait 30 seconds, and a customer whose server is down makes submissions fail.
- **Retries cannot exist inline.** Retry with backoff over minutes is the entire point of a webhook, and a request handler cannot do it.

So webhooks **require** the queue, and they are the first feature in this repository with a hard Redis dependency. That makes one thing mandatory: **the dependency must be visible at configuration time.** Creating a webhook endpoint on a deployment with no `REDIS_URL` must fail loudly — a `503` naming the reason — and must never accept the configuration and then silently never deliver.

That is the deliberate inverse of 0017's known hole, where a queue with no worker running fails silently and every PDF quietly falls behind ([08-operations](../docs/sot/08-operations.md)). Do not reproduce that shape in a feature whose whole purpose is to tell somebody something happened.

### 3. The delivery log is a second copy of respondent personal data, and it outlives the first

The payload of `response.created` contains the answers a member of the public typed into a form. A delivery log that stores request bodies "for replay" is therefore a **second copy of respondent personal data**, in a table nobody thinks of as holding any, with a retention nobody has decided ([07-security §data inventory](../docs/sot/07-security-and-privacy.md)).

Worse, it outlives the original: `Response` cascades from `Form`, so deleting a form destroys the answers — and a delivery log holding the payload would keep them after the customer deleted the form they came from. That is exactly the answer this product does not want to give a data-protection question.

**Store metadata, not payloads**: event id, endpoint id, event type, attempt count, HTTP status, duration, truncated error. A replay re-renders the payload from the `Response` row, and a response that has since been deleted **cannot** be replayed — which is correct rather than a limitation. Whatever is decided, the inventory in [07-security](../docs/sot/07-security-and-privacy.md) gains a row and the cascade goes in [03-domain-model](../docs/sot/03-domain-model.md).

### 4. A signing secret is not an API key, because we have to be able to read it

[`features/0019`](0019-api-keys-and-read-only-public-api.md) stores a SHA-256 of an API key and can do so because it only ever needs to *verify* one. **This secret has to be used to sign**, so it cannot be hashed, and that is a real difference rather than a detail: `webhook_endpoints` will hold a live secret that a database dump alone would make usable.

Two defensible answers, and the choice must be written down rather than defaulted into:

- **Plaintext in the row**, with the blast radius stated honestly in [07-security](../docs/sot/07-security-and-privacy.md) — the same posture as `STRIPE_WEBHOOK_SECRET` in the environment, applied to a column.
- **Encrypted with a key from the environment** (AES-256-GCM, `WEBHOOK_SIGNING_KEY`). It is not theatre even though the key sits in the same deployment as `DATABASE_URL`: a leaked backup, a snapshot, or a read-only SQL injection is a real and common shape of incident, and this defeats all three. It is not defence against a compromised application process, and the documentation must not claim otherwise.

The scheme itself should mirror the one this product already **receives**: `t=<unix>,v1=<hex hmac-sha256>` over `<timestamp>.<raw body>`, with the receiver told to reject an old timestamp. And the reverse of 0013's hardest-won lesson applies — Stripe signs raw bytes, and mounting the route under `express.json()` broke every verification silently. Ours must sign **the exact bytes sent**, and the documentation must tell customers to verify against their raw body, not their re-serialised JSON.

### 5. At-least-once is a promise to keep, not a bug to hide

The retry policy means a customer will occasionally receive the same event twice. That is not a defect to be engineered away — it is what every webhook system does, and this product already **built the receiving half of the answer**: `StripeEvent` exists because Stripe delivers at least once, and its primary key is Stripe's event id ([`features/0013`](0013-stripe-subscriptions.md)).

So: every delivery carries a stable event id that is **identical across retries**, it is documented as the deduplication key, and the docs say plainly that delivery is at-least-once and out of order. A per-endpoint concurrency of 1 gives ordering *in practice* for one endpoint and must not be promised in writing, because a retry re-orders it the moment one delivery fails.

### 6. Auto-disable is right, and this product cannot tell anybody it happened

An endpoint whose owner deleted it is a queue slowly filling with doomed jobs, so disabling after N consecutive failures is correct. But **there is no email in this repository** — [`features/0010`](0010-member-invitations-and-role-enforcement.md) had to make invitations a link the inviter copies for exactly this reason.

So the auto-disable must be *discoverable*: `disabledAt` and `lastError` on the endpoint, both returned by the management API, and the reason readable in the delivery log. And the feature must not pretend the customer was told — file the notification, and say in the Outcome that a customer with a broken endpoint finds out by looking.

## Goal

**Configuration**

1. `WebhookEndpoint` is a table: organization, `url`, `secret`, `events` (a list; only `response.created` exists), `disabledAt`, `lastError`, `createdAt`. The cascade is decided against [03-domain-model](../docs/sot/03-domain-model.md) and written into it.
2. Managed from the **session**-authenticated API under `routes/organizations.ts`, owner or admin, exactly as API keys are — a credential must not be able to create a new place for data to be sent. The secret is returned **once**, at creation.
3. The URL is validated at creation: `https` only, and a host that resolves outside the blocked ranges. A private or loopback target is refused with a message that says so.
4. **With no `REDIS_URL`, creating an endpoint answers `503`** and says webhooks require the queue. No configuration is stored that cannot be delivered.
5. The plan gate matches the API's: `assertHasApiAccess`, checked at creation **and at delivery**, so a downgrade stops deliveries at the next event rather than whenever somebody notices ([`features/0019`](0019-api-keys-and-read-only-public-api.md) shipped that fix; do not reintroduce the mint-time-only shape).

**Delivery**

6. `response.created` is enqueued **after** the submission transaction commits, and a failure to enqueue never fails the submission — the response is already saved, which is the record that matters ([04-backend-patterns §5](../docs/sot/04-backend-patterns.md)).
7. The request is signed `t=…,v1=…` over `<timestamp>.<body>`, carries a stable event id, and is delivered by the one audited egress module.
8. Delivery is bounded: connect and total timeouts, a response-size cap, no redirects, and one in flight per endpoint.
9. Retries use the queue's backoff; a job that exhausts them logs distinctly, as the embed does.
10. After N consecutive failed deliveries the endpoint is disabled and `lastError` says why.

**Log**

11. `WebhookDelivery` records event id, endpoint, event type, attempt, status, duration and a truncated error — **and no payload body** (trap 3).
12. `GET /api/v1/webhooks/deliveries` (or the equivalent) lets a customer read their own recent deliveries, scoped by organization like everything else on that router.

**Safety, tested**

13. A test proves each blocked target class is refused: `http://`, loopback, `169.254.169.254`, an RFC1918 address, and a redirect to one of them. **Written before the client**, and seen to fail against a plain `fetch`.
14. A test proves a slow endpoint does not hold a worker for ever.
15. A test proves the signature verifies against the exact bytes sent, using an independent implementation of the check.

**Must not change**

16. `POST /api/responses` keeps its current status codes, timing characteristics and behaviour when no endpoint is configured; its tests pass unmodified.
17. The Stripe webhook route, the embed queue and `/api/v1`'s existing endpoints are untouched.

## Out of scope

- **Any event other than `response.created`.** `form.published`, `response.deleted` and the rest are cheap to add later and each is a payload decision; one event proves the machinery.
- **A customer-facing UI.** The SPA has no webhooks screen and no API keys screen either ([`docs/BACKLOG.md`](../docs/BACKLOG.md)); both belong to the same piece of work.
- **Telling a customer their endpoint was disabled.** Needs the email this product does not have. File it.
- **Replaying a delivery from the log.** The log makes it possible; the endpoint that does it can come later.
- **Ordering guarantees, fan-out to many endpoints per organization beyond the obvious loop, and event filtering by form.**
- **Making the embed queue mandatory.** `REDIS_URL` stays optional for everything that already works without it.

## Execution prompt

> Close build-order step 10 by shipping outbound webhooks for `response.created`. Read this whole spec first. The dangerous part is not the queue or the signature — it is that this is the first time this server makes an HTTP request to an address a customer chose, so read trap 1 twice and write its test first.
>
> **Read first.**
>
> - `backend/src/routes/responses.ts` — the event source, its transaction, and why nothing may fail the submission after it commits.
> - `backend/src/services/embed-queue.ts` — the queue, its per-form lock, its retry and "gave up" logging, and `createEmbedWorker`. This is a second job type on the same Redis, not a second queue system.
> - `backend/src/worker.ts` — where the new worker is wired, and the process guards.
> - `backend/src/services/stripe.ts`, `constructWebhookEvent` — how this product verifies a signature it receives, which is the scheme to mirror when signing.
> - `backend/src/routes/organizations.ts`, the `api-keys` handlers — the management pattern, including `402` versus `403` and the secret shown once.
> - `backend/src/middleware/apiKeyAuth.ts`, `requireApiAccess` — the entitlement checked per request, not at creation.
>
> **Apply the skills:** `prisma-schema-migration`, `backend-endpoint-pattern`, then `sot-sync` and `ship-checklist`.
>
> ---
>
> **Step 1 — the egress guard, alone.** `services/webhook-delivery.ts` (or similar): URL validation, DNS resolution and address checks, timeouts, no redirects, size cap. **Write the blocked-target tests first** and watch a plain `fetch` fail them. Nothing else in this step. Commit here.
>
> **Step 2 — the tables and the management endpoints**, with the `503` when there is no queue and the entitlement check.
>
> **Step 3 — the job type and the worker**, the signature, the delivery log, retries and auto-disable.
>
> **Step 4 — the read endpoint** for the delivery log on `/api/v1`.
>
> **Do not** make `REDIS_URL` mandatory for anything else, do not store payload bodies, do not follow redirects, and do not put delivery on the request path.
>
> **Verify:**
> ```bash
> npm run test:backend
> npm run test:integration
> TEST_REDIS_URL=redis://localhost:6379 npm run test:integration
> npm run test:frontend
> npm run test:e2e
> npm run build --workspace=frontend
> cd backend && npx tsc --noEmit && npm run typecheck:tests
> ```
> Then by hand, with Redis and a worker running: point an endpoint at a local receiver, submit a form, and verify the signature on the raw body with an independent script. Stop the receiver and watch the retries and then the auto-disable. Point an endpoint at `http://169.254.169.254/` and confirm it is refused at creation.
>
> **Before the PR:** run `saas-readiness-reviewer`. This adds outbound requests to customer-controlled addresses, a stored live secret, and a new table that touches respondent data — and the last two reviews each found a real defect, so budget for fixing one.
>
> **Documentation exit, required:**
> - [`07-security-and-privacy`](../docs/sot/07-security-and-privacy.md): SSRF and what the egress guard does about it; the stored signing secret and its honest blast radius; the delivery log in the data inventory; the trust-boundary diagram gains an **outbound** arrow, which it has never had.
> - [`03-domain-model`](../docs/sot/03-domain-model.md): the two tables and their cascades.
> - [`06-api-reference`](../docs/sot/06-api-reference.md): the management endpoints, the delivery-log endpoint, the payload, the signature scheme, and the at-least-once contract — written for a customer implementing a receiver.
> - [`08-operations`](../docs/sot/08-operations.md): `REDIS_URL` is now required for webhooks specifically; what an exhausted delivery and a disabled endpoint look like in the logs.
> - [`04-backend-patterns`](../docs/sot/04-backend-patterns.md): the second job type, and the rule that one module owns egress.
> - [`10-saas-roadmap`](../docs/sot/10-saas-roadmap.md): **step 10 is closed.** Say what the build order does *not* cover now that it is finished, and what the next chain would be built from.
> - [`docs/BACKLOG.md`](../docs/BACKLOG.md): close the webhooks row. Add rows for notifying a customer that their endpoint was disabled, for replaying a delivery, and for more event types.
> - `CLAUDE.md`: the current-state paragraph gains outbound webhooks, and loses "no public API, no webhooks".
> - This file: `**Status:** done` and an **Outcome** — what shipped, the real test output, the failing-first evidence for the blocked targets, what the signing-secret decision ended up being and why, and what a customer with a broken endpoint actually experiences.

## Outcome

*(filled in when the work is finished)*
