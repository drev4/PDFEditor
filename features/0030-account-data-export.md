# 0030 — Account data export

**Status:** done
**Priority:** P1 (see [`docs/BACKLOG.md`](../docs/BACKLOG.md) — *Per-account data export*, the open half of S8)
**Branch:** `feature/0030-account-data-export`
**Related:** [07-security-and-privacy](../docs/sot/07-security-and-privacy.md) · [06-api-reference](../docs/sot/06-api-reference.md) · [`features/0029`](0029-account-deletion-and-real-erasure.md)

## Context

[`features/0029`](0029-account-deletion-and-real-erasure.md) shipped erasure and deliberately split portability out. The consequence is written into three documents and is the reason this is next: **the only way out of this product is currently to lose everything.** A customer can delete their account and cannot take their data with them, and the Danger zone in Settings is a button whose honest companion does not exist yet.

The pieces of an export already exist and none of them is an export. `GET /api/forms/:id/responses/export` produces a CSV for **one** form (`backend/src/routes/forms.ts:363`); `/api/v1` reads forms and responses one page at a time and needs an API key, which is Team-only; `GET /api/organizations/responses` lists everything the organization has collected but deliberately carries no answer values at all. A customer leaving would have to walk their forms by hand, and would still get nothing about the organization, its members or its plan.

What this adds is one endpoint that produces one file containing everything the organization holds, in a format a machine can read.

## Why the obvious approach is wrong

### 1. There is no such thing as "the user's data" in this schema

The obvious reading of "per-account export" is a dump keyed on `users.id`. That is not where the data is. Since [`features/0009`](0009-organizations-own-resources.md) **forms belong to organizations**, `Form.createdByUserId` is provenance and explicitly never an authorization input, and a user's own row holds an email, a name and a password hash — nothing anybody wants to port.

So this is an **organization** export with the caller's user record attached, and the scoping question becomes *which* organization. The answer is already settled and must not be re-litigated here: **the one the caller is acting in**, resolved by `requireMembership`, exactly like every other read in the product. Merging every organization the caller belongs to into one file is the bug [`features/0023`](0023-active-organization.md) fixed, not a convenience — a person in two organizations would get two tenants' respondent data in one document.

### 2. Restricting it to owners is a boundary that is not one — but do it anyway, and say so

A whole-tenant file containing every respondent's answers, IP address and user agent looks like something to put behind a role. It is, and this spec does: **owner or admin**, through `requireRole`.

But be honest in the code about what that buys, because the next reader will assume more: **a plain member can already assemble the same data by hand.** `GET /api/forms/:id/responses/export` is behind `callerCanReachForm` — any member of the owning organization — and its CSV includes the IP address column. So the role check here is not a confidentiality boundary; it makes the *whole-tenant artifact* a deliberate act by somebody accountable for it, and nothing more.

Do not "fix" the per-form CSV in this feature. It is a working tool for the people operating a form and changing who can use it is a product decision with its own blast radius. File it.

### 3. Do not build the document in memory

The existing exporter is the shape to avoid, not the shape to copy. `services/csv-exporter.ts:19` takes **every response with every answer already loaded** and returns one string, and its route loads them with an unbounded `findMany`. At Team's allowance — 25,000 responses a month — that is a live risk today, and an organization-wide export is strictly worse: every form, every field and every answer at once.

So: **stream it.** Page through responses with a cursor in batches, write each chunk with `res.write`, and never hold the whole document. `JSON.stringify(everything)` anywhere in this feature is the defect.

### 4. A stream cannot change its mind about the status code

This is the trap that only appears once streaming is chosen, and it is the reason the format has a peculiarity in it.

The moment the first byte is written the response is a `200`. If the database fails on page 40 there is no way to turn that into a `500`: the customer gets a **truncated file that no longer parses**, or — worse, if the truncation happens to land on a boundary — one that parses and is quietly missing half their responses. A file that looks complete and is not is the failure mode this product cannot afford in an export somebody is about to delete their account behind.

So the document **ends with an explicit completion marker** written only after the last page: a top-level `"complete": true`. A file without it is incomplete, and [08-operations](../docs/sot/08-operations.md) and the UI must both say so. Emitting the marker at the top, where it would be convenient, defeats the entire mechanism.

### 5. Do not put it on the queue

An asynchronous export — enqueue, notify, download later — is the shape a mature product ends at, and it is wrong here now. `REDIS_URL` is **optional** in this deployment, so a queued export means two code paths that both have to work, which is precisely the cost [`features/0017`](0017-job-queue-for-pdf-embedding.md) took on knowingly for the embed and documented as a cost. There is also no email to notify anybody with.

Streaming synchronously is correct at beta scale. File the async version, with the note that it needs email and a non-optional queue before it is worth having.

### 6. Never serialise a Prisma row into it

Build every object in the export field by field, the way `GET /api/organizations/responses` does and for the reason its comment gives: *"the next column added to `Response` would otherwise reach this screen without anybody deciding it should."* An export is the worst place for that to happen — a column added for an internal purpose would leave the building in every customer's file from then on, silently.

## Goal

1. `GET /api/organizations/export`, session-authenticated, **owner or admin** (`requireRole`), streaming `application/json` with a `Content-Disposition` attachment filename containing the organization slug and the UTC date.
2. The document covers the caller's **active organization only**, resolved through `requireRole`/`requireMembership`, and contains:
   - `exportedAt`, the schema `version` (start at `1`), the organization (`id`, `name`, `slug`, `planKey`);
   - the caller's own user record: `id`, `email`, `name`, `createdAt` — never `passwordHash`;
   - `members`: user id, email, name, role, joined date;
   - `forms`: id, title, description, `shareId`, status, `pdfUrl`, settings, timestamps, and their `fields` **including archived ones** (`deletedAt` present), because an archived field is the only thing that explains a historical answer;
   - `responses`: id, form id, `submittedAt`, `ipAddress`, `userAgent`, and `answers` as `{fieldId, value}`;
   - `usage`: the `UsageCounter` rows;
   - and **`"complete": true` as the last key written**.
3. Every object is built field by field. No Prisma row is spread or serialised whole, and a test asserts that `passwordHash` and `tokenHash` appear nowhere in the output.
4. Responses are read in pages with a cursor — batch size a named constant, not a literal at the call site — and each page is written before the next is fetched. Nothing accumulates the whole set.
5. A new `export` limiter in `backend/src/middleware/rateLimit.ts`, keyed by **`req.userId`** rather than by address (an authenticated, expensive endpoint; the address is the wrong identity, as `api` already argues). Default: a small number per hour.
6. **`KNOWN_VARIABLES` in `backend/src/config/validate-env.ts` gains the new `RATE_LIMIT_EXPORT_*` names.** `backend/tests/config-coverage.spec.ts` fails without this, which is [`features/0028`](0028-boot-time-configuration-validation.md)'s scan doing its job — do not work around it.
7. A **Download my data** control in the Settings General tab, above the Danger zone, using `api.download` and `frontend-state-pattern`. It says what the file contains and that a file without the completion marker is incomplete.
8. Tests:
   - **Integration** (`backend/tests/integration/`), because this is about what a real database returns across five tables: the export contains a form, its archived field, a response and its answers; it contains no `passwordHash`; a member (not owner or admin) gets `403`; a caller in two organizations gets **only** the active one; the document ends with `"complete": true`; and an organization with more responses than one page still returns all of them.
   - **Unit** for whatever builds a form or response object, asserting the shape is explicit.
   - **Frontend** for the Settings control.
9. All suites pass: `npm run test:backend`, `npm run test:integration`, `npm run test:frontend`, `npm run test:e2e`, both type checks, and the frontend build.

## Out of scope

- **The uploaded PDFs themselves.** They are binary, including them turns this into ZIP assembly with its own streaming and memory design, and the customer uploaded those files — they have the originals. Each form carries its canonical `pdfUrl`. File "documents in the export" separately.
- **Asynchronous export**, and any use of the queue. Argued in §5; file it with its dependency on email and a non-optional Redis.
- **Widening or narrowing `GET /api/forms/:id/responses/export`.** It stays any-member. File the inconsistency named in §2.
- **Rewriting `services/csv-exporter.ts` to stream.** It is a real risk and it is a separate change with its own tests; file it, do not fold it in.
- **A respondent-facing export.** A respondent still cannot reach their own answers; that belongs with the respondent privacy notice (D6, S7).
- **Deleting anything.** This feature is read-only. It must not touch `services/pdf-gc.ts`, `routes/account.ts` or any delete path.
- **Making the Danger zone conditional on having exported.** Tempting, and it is a product decision rather than an engineering one.

## Execution prompt

> Add an organization data export to the VuePDF backend and a control for it in Settings. Apply `backend-endpoint-pattern` for the route, `frontend-state-pattern` for the screen, `test-author` for the integration tests, `api-contract-guard` before documenting the endpoint, and `sot-sync` on the way out.
>
> **Read first, and do not write code until you have:**
> 1. `backend/src/routes/organizations.ts:118-160` — `GET /organizations/responses`, and the comment explaining why its body is built field by field. This export follows that rule.
> 2. `backend/src/services/csv-exporter.ts` and `backend/src/routes/forms.ts:363` — the in-memory shape this must not copy, and the any-member authorization it must not change.
> 3. `backend/src/middleware/membership.ts` — `requireMembership` and `requireRole`, including the `404` versus `403` distinction (not a member is `404`; wrong role is `403`).
> 4. `backend/src/middleware/rateLimit.ts:55-100` and `:246-270` — `LimiterName`, the `LIMITERS` table, `keyBy`, and `createLimiter`.
> 5. `backend/src/config/validate-env.ts` — `KNOWN_VARIABLES`, and why `tests/config-coverage.spec.ts` will fail if the new variables are not declared.
> 6. `backend/prisma/schema.prisma` — every column on `Form`, `Field`, `Response`, `Answer`, `Membership`, `Organization` and `UsageCounter`, so the export names what it includes rather than inheriting it.
> 7. `frontend/src/services/api.ts` — `api.download`, and `frontend/src/components/settings/DangerZone.vue` for where the new control sits.
>
> **Build:** a service that writes the document (the only module that knows the export format), the route, the limiter, the environment declarations, and the Settings control.
>
> **The two things to get right, restated because they are easy to lose while writing the happy path:** nothing may hold the whole document or the whole response set in memory, and `"complete": true` is written **last**, after the final page, so that a truncated file is detectable.
>
> **Do not touch:** the per-form CSV route or its exporter, any delete path, `services/pdf-gc.ts`, or the authorization of anything that exists.
>
> **Verify, and paste the real output:**
> ```
> npm run test:backend
> npm run test:integration        # docker-compose up -d first
> npm run test:frontend
> npm run test:e2e
> cd backend && npx tsc --noEmit
> npm run typecheck:tests --workspace=backend
> npm run build --workspace=frontend
> ```
> Then check by hand, and report what you saw: export an organization holding more responses than one page and confirm the file parses, ends with the completion marker, and contains every response; and confirm `passwordHash` appears nowhere in it.
>
> **On the way out:**
> - `docs/sot/06-api-reference.md`: the endpoint, verified against the route file — including that it streams, that the status is committed at the first byte, and what the completion marker means.
> - `docs/sot/07-security-and-privacy.md`: **S8 is now closed** — say so, and add the export to the data inventory as a standing way out of the building, in the shape the `/api/v1` and webhook rows already use. While there, fix the stale *"Indefinite — no deletion path"* retention cell for `users`: [`features/0029`](0029-account-deletion-and-real-erasure.md) built one.
> - `docs/sot/08-operations.md`: how to tell a truncated export from a complete one.
> - `docs/BACKLOG.md`: remove the export row; add the four things filed above — PDFs in the export, async export, the per-form CSV inconsistency, and the CSV exporter's unbounded memory.
> - `docs/sot/10-saas-roadmap.md`: D5's remaining half is closed.
> - Set this file to `**Status:** done` with an `## Outcome` recording what the real database returned, and anything the schema turned out to hold that the goal above did not name.
>
> If any part cannot be completed, say which and why. Do not describe partial work as finished.

## Outcome

Done on `feature/0030-account-data-export`. Backend 24 files / 290 tests, integration 24 / 238, frontend 49 / 405, E2E 53, both type checks and the frontend build clean. **S8 is closed.**

### Verified against a real database, by hand

The spec asked for an export larger than one page checked outside the suite. 640 responses, so the 200-row cursor paging runs four times:

```
status               : 200
content-disposition  : attachment; filename="vuepdf-export-manual-...-2026-09-02.json"
bytes                : 169547
respuestas esperadas : 640
respuestas en fichero: 640
ids unicos           : 640
complete             : true
ultimos 24 caracteres: "],
  \"complete\": true
}
"
contiene passwordHash: false
```

The last two lines are the ones worth keeping: the completion marker is genuinely the final token in the file, and the user record carries no hash.

### What the design got right, and the two things it did not say

The six traps held. Two details the spec did not name and the code now does:

**Paging is by `id` cursor, not by offset.** An offset re-scans the rows it skips, which turns a large export quadratic on the one table here that can hold a million rows — and it can lose or repeat a row if anything is written while the export runs. The spec said "cursor" without saying why; the code now does.

**The route destroys the socket rather than calling `next(error)`.** After the first byte the error handler would try to write JSON into a response that is already a partly-written file, producing something that looks like a document with an error object glued to the end. A broken connection is the only honest signal left to a live client; the marker is the durable one for a saved file.

### Corrections made while implementing

`resetRateLimiters` does not exist — the helper is `resetRateLimitStores`. Caught by the first run of the new spec, where all 12 tests failed on `is not a function` before a single assertion ran.

The organization store exposes `currentRole` and `activeOrganization`, not `role` and `current`. `SettingsView` already calls `organizationStore.load()` on mount with a comment explaining that the role comes from the members list, so the new panel's visibility check works on a hard load; without that call it would have been invisible to its own owner.

### The 0028 scan did its job, two features later

Adding `RATE_LIMIT_EXPORT_WINDOW_MS` and `RATE_LIMIT_EXPORT_MAX` required declaring them in `KNOWN_VARIABLES`, exactly as the spec predicted. `tests/config-coverage.spec.ts` is a lint rule written against variables that did not exist when it was written, and it caught the first configuration added after it.

### Filed rather than done

The PDFs are not in the export; an asynchronous export needs email and a non-optional queue first; the per-form CSV is open to any member while this is not, and deciding which is right is a product question; and `services/csv-exporter.ts` still builds its whole file in memory — now with a worked example next door to copy.
