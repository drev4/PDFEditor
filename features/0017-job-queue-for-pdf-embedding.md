# 0017 — A job queue, and the one PDF operation that can actually go on it

**Status:** done
**Priority:** P2 (see [`docs/BACKLOG.md`](../docs/BACKLOG.md) — *Job queue (BullMQ + Redis) for PDF extraction and embedding*)
**Branch:** `feature/0017-job-queue-for-pdf-embedding`
**Related:** [02-architecture](../docs/sot/02-architecture.md) · [04-backend-patterns §5](../docs/sot/04-backend-patterns.md) · [07-security-and-privacy](../docs/sot/07-security-and-privacy.md) · [08-operations](../docs/sot/08-operations.md) · [09-quality-and-testing](../docs/sot/09-quality-and-testing.md) · [10-saas-roadmap](../docs/sot/10-saas-roadmap.md) · [`features/0016`](0016-object-storage-for-uploaded-pdfs.md)

## Context

This closes build-order step 9. [`features/0016`](0016-object-storage-for-uploaded-pdfs.md) did the first half — PDF bytes moved behind `services/pdf-storage.ts` and can live in an object store — and deliberately did not touch *where the work runs*. [02-architecture](../docs/sot/02-architecture.md) still names it as a load-bearing constraint: **PDF processing is synchronous and inline in the request**, so a large or pathological PDF blocks the Node event loop for every other request, not just its own.

The ordering was the point. The queue's payload is PDF work, and a worker in another process cannot read a file on the API container's local disk — so storage had to come first or the queue would have been built against storage that was about to be replaced. That is now done, and a worker can reach the bytes wherever they are.

Two things this also unblocks, and **neither is in scope**: the shared rate-limit store needs the Redis this brings ([`docs/BACKLOG.md`](../docs/BACKLOG.md)), and email delivery for invitations wants a queue for retries. Both are their own rows, for the same reason storage and the queue were split — they share the theme and nothing else.

## Why the obvious approach is wrong

### 1. "Move PDF processing to a queue" is three call sites with three different contracts, and only one of them can go

This is the trap the backlog row's own wording walks into by saying *extraction and embedding*. There are three synchronous PDF operations and they are not interchangeable:

| Where | What it does | Can it be a job? |
|---|---|---|
| `routes/upload.ts:26` | `validatePDF` then `extractFieldsFromPDF` on `POST /api/upload` | **No** — see below |
| `routes/forms.ts:124` (`syncFieldsFromPDF`) | extract + `createMany` on the first `GET /api/forms/:id` | **No** — same reason |
| `routes/form-fields.ts` (`embedFieldsInPDF`) | rewrite the stored PDF's AcroForm after a bulk save | **Yes** |

**The upload's extracted fields are used immediately, by the client, on that response.** `frontend/src/composables/useFormManagement.ts:33-50` takes `response.fields` and calls `formFieldsStore.loadFieldsFromPDF(...)` — the editor draws them the moment the upload finishes. Making that asynchronous does not move work off the request path; it changes the product. The user would upload a PDF, see an empty canvas, and need a "we are still reading your document" state, polling or a socket, and an answer for what happens if extraction fails after they have already started drawing their own fields. That is a feature with a design, not a refactor.

`syncFieldsFromPDF` has the same shape: it runs inside `GET /api/forms/:id` and the response is the form *with* the fields it just created.

**`embedFieldsInPDF` is the one that is already fire-and-forget.** It runs after the transaction commits, its errors are swallowed on purpose, and nothing in the response depends on it ([04-backend-patterns §5](../docs/sot/04-backend-patterns.md)). It is the only one of the three whose contract does not change at all when it moves to a worker — which is exactly why it is the one to move.

So: **the queue ships with one job type.** That is not a reduced version of this feature, it is the correct scope. Moving the other two is a product decision with a UX attached, and it gets its own row.

### 2. The queue must *replace* the per-form lock, not sit next to it

[`features/0016`](0016-object-storage-for-uploaded-pdfs.md) serialises the embed with `withOrganizationLock(\`form-embed:${formId}\`, …)` and re-reads the fields inside that lock, because the embed is a read-modify-write and two overlapping saves otherwise lose one author's work. Read that feature's trap 2 and its Outcome before touching this — the fix has two halves and dropping either one reinstates the bug.

An in-process lock and a queue do not compose. If the handler keeps the lock and also enqueues, the lock serialises the *enqueue* — which is instant — and serialises nothing that matters, while the real ordering moves to workers that the lock cannot see. **The queue has to become the serialiser**, with at most one embed in flight per form, and the in-process lock for embedding is then dead code that must be removed rather than left as a comforting extra.

Two properties the replacement must have, and the second is where this gets subtle:

- **The job re-reads the fields when it runs**, not when it is enqueued. Same reasoning as 0016: a payload carrying the field list is a payload that was stale before the worker picked it up. The job should carry `formId` and nothing else that can go stale.
- **Deduplication must never drop the newest save.** The obvious implementation is a stable job id per form so a second save collapses into the first. Verify what the library actually does when a job with that id is *already running*: if the second one is silently discarded, then a save made during an in-flight embed is a save whose fields never reach the PDF, and the document is permanently behind the database — which is the same class of bug as the lost update, arrived at from the other direction. The safe shape is *coalescing*: at most one waiting job per form, and if one is running, guarantee another runs after it. Whatever the mechanism, **there must be a test that saves twice with an embed in flight and asserts the PDF ends up matching the database.**

### 3. Redis must be optional, or the test suites stop being runnable

`npm run test:backend`, `test:integration` and `test:e2e` all exercise bulk save, and therefore the embed. If the queue is mandatory, every one of them needs a Redis, and [09-quality-and-testing](../docs/sot/09-quality-and-testing.md)'s property that the suites run offline is gone.

This repository already has the pattern, twice: Stripe is off when `STRIPE_SECRET_KEY` is unset ([`features/0013`](0013-stripe-subscriptions.md)) and PDF storage is `local` unless `PDF_STORAGE_DRIVER` says otherwise ([`features/0016`](0016-object-storage-for-uploaded-pdfs.md)). Follow it: **`REDIS_URL` unset means no queue, and the embed runs inline exactly as it does today** — lock and all. That keeps the suites offline, makes the change deployable in stages, and makes the rollback an environment variable rather than a revert.

Note the consequence and accept it deliberately: **the inline path stays**, so there are two code paths for the same operation and both must work. That is the cost. Do not "simplify" by deleting the inline path — deleting it is what makes Redis a hard boot dependency for every developer and every CI run.

There is a real risk in this shape that must be tested rather than assumed: the two paths can drift, and the inline one is the one every test exercises. **At least one test must run the queued path**, against a real Redis, asserting the same invariant the inline test asserts.

### 4. A worker is a second process, and this codebase has one shape of process failure it has already been bitten by

The worker is **the same image with a different entrypoint** — it imports `services/pdf-storage.ts`, `services/pdf-processor.ts` and Prisma, and duplicating any of that into a separate service is how the two copies start disagreeing about what a PDF is.

But a second long-running process introduces failure modes the API does not have, and one of them this repository has already hit. [`features/0016`](0016-object-storage-for-uploaded-pdfs.md)'s Outcome records a **Critical** finding: an `async` Express handler with no `try`/`catch` produced an unhandled rejection, and Node 22 turns that into `process.exit(1)`. There is still **no `process.on('unhandledRejection')` anywhere in `backend/src`** — verify that before relying on this sentence.

In the API that meant a crash-loop that a supervisor restarts and someone notices. **In a worker it is worse: a crashed worker stops processing silently.** Nothing 500s, no request fails, no user sees an error — the queue just fills up and every form's PDF quietly falls behind its database. Build the worker with that in mind: guard the process, make a dead worker visible, and do not assume a rejected promise inside a job handler is contained.

### 5. Retries make failure survivable and also make it invisible in a new way

Today a failed embed logs to stdout and the PDF stays stale — [04-backend-patterns §5](../docs/sot/04-backend-patterns.md) already calls this an observability hole and says these call sites are the first things to instrument. A queue improves this genuinely: transient failures (a storage blip, an S3 throttle) now retry instead of being lost.

It also creates a state that does not exist today: **a job that has exhausted its retries.** That is a form whose PDF is permanently behind its database, and if the only trace is a log line the queue has made the hole deeper rather than closing it — because now there is a place where the truth is recorded and nothing reads it. This feature does not have to build the user-visible signal (that is the instrumentation row), but it must not pretend the state does not exist: exhausted jobs must be distinguishable in the logs from ordinary failures, and what a human is supposed to do about one must be written down in [08-operations](../docs/sot/08-operations.md).

**The embed must stay idempotent**, because a retry re-runs it. It already is — it reads the current fields and rewrites the AcroForm from them — and re-reading inside the job is what keeps it that way.

## Goal

**The queue**

1. `REDIS_URL` unset ⇒ no queue, no Redis connection attempted, and the embed runs inline exactly as today. Every existing test passes unmodified with it unset.
2. `REDIS_URL` set ⇒ `POST /api/forms/:formId/fields/bulk` enqueues instead of embedding inline, and the handler's response is unchanged.
3. One module owns the queue, in the shape `services/pdf-storage.ts` and `services/stripe.ts` established: nothing else imports the queue library.
4. The job payload is `formId` and nothing that can go stale. The worker re-reads the fields when it runs.

**Correctness**

5. At most one embed per form in flight, and **a save made while one is running still reaches the PDF.** Tested against a real Redis, with two saves overlapping an in-flight embed, asserting the stored PDF's AcroForm matches the database at the end — the same invariant `tests/integration/pdf-embed-concurrency.spec.ts` already asserts for the inline path.
6. The in-process `withOrganizationLock` call for embedding is **removed** on the queued path, not kept alongside it. The inline path keeps it, because there it is still the thing doing the work.
7. The embed is idempotent under retry: running the same job twice leaves the same document.

**The worker**

8. Same image, different entrypoint — `npm run worker`, `dist/worker.js`. No duplicated PDF or storage code.
9. `process.on('unhandledRejection')` and `uncaughtException` handlers exist in **both** entrypoints, and a test proves a rejected promise inside a job handler does not take the worker down.
10. A worker that dies is visible: it logs distinctly on startup and shutdown, and [08-operations](../docs/sot/08-operations.md) says how to tell whether one is alive.
11. Graceful shutdown: on `SIGTERM` the worker finishes its current job before exiting, so a deploy does not abandon an embed half-done.

**Failure**

12. A job that exhausts its retries logs distinctly from a job that failed once and will retry, and names the form.
13. [08-operations](../docs/sot/08-operations.md) documents what to do about one.

**Behaviour that must not change**

14. `POST /api/upload` still returns `{url, filename, size, fields}` synchronously, with the fields extracted. `frontend/src/composables/useFormManagement.ts` is not touched.
15. `syncFieldsFromPDF` still runs inside `GET /api/forms/:id`.
16. The bulk save response is byte-identical, and it still does not depend on the embed succeeding.
17. No route gains a "processing" status, and no schema column is added for one.

## Out of scope

- **Moving extraction off the request path**, on upload or on first read. Trap 1. It needs an async UX — a processing state, polling or a socket, and an answer for a failed extraction — and that is a product decision. File it.
- **The shared rate-limit store.** It needs the Redis this brings and nothing else about it; its own row, and bundling it would put a security-relevant change in a queue PR.
- **Email delivery.** Also wants a queue, also its own row.
- **A user-visible signal that a PDF is out of sync with its form.** The instrumentation row in [04-backend-patterns §5](../docs/sot/04-backend-patterns.md); this feature only has to make the state legible in logs.
- **Deleting orphaned PDFs**, and the cross-replica embed race — the latter is *closed by* this feature if goal 5 holds, so remove that backlog row only if the test proves it.
- **Horizontal scaling of the API itself**, or any deployment topology change beyond adding the worker entrypoint.

## Execution prompt

> Close build-order step 9 by putting the PDF embed on a job queue. Read this whole spec first, and then read [`features/0016`](0016-object-storage-for-uploaded-pdfs.md)'s trap 2 and Outcome — the concurrency fix you are replacing has two halves, and dropping either reinstates a bug that silently loses an author's work.
>
> **Read first.**
>
> - `backend/src/routes/form-fields.ts` — `embedFieldsInPDF` and `embedNow`, and why the fields are re-read inside the lock.
> - `backend/src/services/organization-lock.ts` — what an in-process lock does not cover, which is the whole argument for the queue.
> - `backend/src/services/pdf-storage.ts` — the driver interface the worker will use, and the `local` default that keeps tests offline.
> - `backend/src/routes/upload.ts` and `frontend/src/composables/useFormManagement.ts:33-50` — why extraction cannot move.
> - `backend/tests/integration/pdf-embed-concurrency.spec.ts` — the invariant to preserve, and the note on why an earlier draft of it passed against broken code.
>
> **Apply the skills:** `backend-endpoint-pattern`, then `sot-sync` and `ship-checklist`.
>
> ---
>
> **Step 1 — the seam, with no queue behind it.** One module owning the queue, `REDIS_URL` unset meaning inline. **The whole suite must pass unmodified at the end of this step**, which is the proof the seam changed nothing. Commit here.
>
> **Step 2 — the worker.** Entrypoint, graceful shutdown, and the process guards from goal 9. Add Redis to `docker-compose.yml` the way [`features/0016`](0016-object-storage-for-uploaded-pdfs.md) added MinIO: present, documented, and required by nothing.
>
> **Step 3 — the queued path, and the test that has to fail first.** Write the two-saves-during-an-in-flight-embed test **before** the coalescing logic and watch it fail — if it passes immediately, it is not reproducing the race and the delay is probably on the wrong side of the read (0016 made exactly that mistake; its spec records the shape). Then make it pass.
>
> **Step 4 — verify both paths.** The inline path is what every existing test runs; the queued path needs its own run against a real Redis. Say in the Outcome which tests covered which path.
>
> **Do not** move extraction off the request path, do not add a status column, do not bundle the rate-limit store, and do not leave the in-process lock in place on the queued path.
>
> **Verify:**
> ```bash
> npm run test:backend
> npm run test:integration
> npm run test:frontend
> npm run test:e2e
> npm run build --workspace=frontend
> cd backend && npx tsc --noEmit && npm run typecheck:tests
> ```
> Then by hand, with `REDIS_URL` set and a worker running: save a form's fields and watch the job run; stop the worker, save again, restart it, and confirm the embed still happens; kill the worker mid-job and confirm the job is retried rather than lost.
>
> **Before the PR:** run `saas-readiness-reviewer`. This adds a second process that writes customer documents, and a failure mode where nothing errors and work silently stops.
>
> **Documentation exit, required:**
> - [`02-architecture`](../docs/sot/02-architecture.md): constraint 2 says PDF processing is synchronous and inline. It becomes *partly* — embedding is queued when Redis is configured, extraction is still inline and deliberately so. Add the worker to the topology.
> - [`04-backend-patterns §5`](../docs/sot/04-backend-patterns.md): the embed's serialisation moves from the in-process lock to the queue; say what that buys (cross-replica) and what it costs (two paths).
> - [`08-operations`](../docs/sot/08-operations.md): `REDIS_URL`, running the worker, how to tell if one is alive, what an exhausted job means and what to do about it, and the rollback.
> - [`09-quality-and-testing`](../docs/sot/09-quality-and-testing.md): the suites still run offline on the inline path, and how the queued path is covered.
> - [`10-saas-roadmap`](../docs/sot/10-saas-roadmap.md): **step 9 is fully closed.** Strike it through and say what step 10 now depends on.
> - [`docs/BACKLOG.md`](../docs/BACKLOG.md): close the job-queue row. Close the cross-replica embed race **only if** goal 5's test proves it. Do **not** close the rate-limit store or email delivery. Add a row for moving extraction off the request path, with the UX it needs.
> - `CLAUDE.md`: the current-state paragraph says PDF processing is synchronous; it changes for one of the three operations.
> - This file: `**Status:** done` and an **Outcome** — what shipped, the real test output, what the queue library actually did about duplicate jobs, and which path each test covered.

## Outcome

**Shipped**, in two commits: the seam (`c55da35`) and the worker with the queued path (`f56984a`).

### What shipped

- `backend/src/services/pdf-embed.ts` — the embed itself, moved out of `routes/form-fields.ts`. `embedFormFields(formId)` reads the form, its live fields and the stored PDF for itself and **throws**; `embedInline(formId)` is the old behaviour, in-process lock and swallowed errors.
- `backend/src/services/embed-queue.ts` — the only module that imports `bullmq` or `ioredis`. `requestEmbed(formId)` is what the route calls and the only entry point: it enqueues when `REDIS_URL` is set and runs `embedInline` when it is not. `createEmbedWorker()`, `embedQueueStatus()` and `closeEmbedQueue()` are the rest of the surface.
- `backend/src/worker.ts` + `npm run worker` / `worker:dev` — the same image, a second entrypoint. It refuses to start without `REDIS_URL` rather than idling and looking healthy.
- `backend/src/process-guards.ts`, installed by both entrypoints.
- `POST /api/forms/:formId/fields/bulk` now calls `requestEmbed(formId)` and nothing else changed in it; `routes/upload.ts`, `syncFieldsFromPDF` and `useFormManagement.ts` were not touched at all.
- Redis in `docker-compose.yml` (required by nothing, no volume), four new variables in `backend/.env.example`, and `REDIS_URL: ''` pinned in both vitest configs.

### What the queue library actually did about duplicate jobs

**It was not used for deduplication, and that is the main design decision of this feature.** BullMQ ignores an `add` whose `jobId` matches a job that is *already running*, so the obvious "one stable job id per form" collapses a save made during an in-flight embed into nothing: the fields never reach the PDF and the document is permanently behind the database — the same lost update [`features/0016`](0016-object-storage-for-uploaded-pdfs.md) closed, reached from the other side and with no error anywhere.

So every save enqueues its own job, and serialisation is a **Redis lock per form** (`SET NX PX` + a random token, compare-and-delete release, renewed while the work runs) taken inside the job. Duplicate jobs are harmless: the job re-reads the fields and the embed is idempotent, so a second job rewrites the same document from the same truth. That is also what makes the lock genuinely cross-process, which the in-process lock never was.

### The test that had to fail first, and the way it did not

Written before the lock, and **its first version passed against a worker with no lock at all** — the exact trap this spec warned about, arrived at differently from 0016's. The reason: both `bulkSave` requests return as soon as they have enqueued, so both jobs started *after* both saves had committed, and since a job re-reads the fields when it runs they both embedded the same final field set and agreed by accident. `waitForActiveJob()` is what fixes it: the second save is made only once a job is genuinely active and holding the pre-`beta` document.

With that in place, and the lock removed from the worker:

```
AssertionError: expected 1 to be 2
  × does not drop a save made while an embed is already running
  Tests  1 failed | 2 passed (3)
```

which is the lost update exactly. With the lock restored, 3 passed.

### Which path each test covered

| Test | Path |
|---|---|
| `tests/integration/pdf-embed-concurrency.spec.ts` (unchanged) | **inline** — two overlapping saves, in-process lock |
| Every other backend, integration and E2E spec | **inline** — `REDIS_URL` pinned empty |
| `tests/integration/pdf-embed-queue.spec.ts` (new, 3 tests) | **queued** — real Redis, in-process worker: response unchanged, a save during an in-flight embed still reaches the PDF, and the embed is idempotent |
| `tests/process-guards.spec.ts` (new, 2 tests) | neither — a real child process, for a rejection that must be survived and an exception that must not be |

```
npm run test:backend        16 specs, 206 tests passed
npm run test:integration    14 specs, 140 passed, 1 spec (3 tests) skipped   # offline
  with TEST_REDIS_URL set   15 specs, 143 tests passed
npm run test:frontend       38 specs, 321 tests passed
npm run test:e2e            50 passed (21.4s)
npm run build --workspace=frontend    built in 10.33s
cd backend && npx tsc --noEmit && npm run typecheck:tests    clean
```

### Verified by hand, against a real Redis and a real worker

1. **Save with no worker running** → `STATUS { waiting: 1, active: 0, delayed: 0, failed: 0 }` and `EMBEDDED 0 / DATABASE 2`. The documented silent failure, reproduced on purpose: nothing errored.
2. **Start the worker** → `embed job 17 done (form 5b67140c…)`, then `EMBEDDED 2 / DATABASE 2` and an empty queue. So stopping the worker, saving, and restarting it does still embed.
3. **`SIGKILL` mid-run** (60 jobs queued): 5 jobs were left `active` by the dead process, and a restarted worker drained everything to zero with the document matching the database. Nothing was lost — BullMQ recovers a stalled job and the embed is idempotent, which is why re-running it is safe.
4. **Graceful shutdown** was verified through `close()` directly — 15 active jobs before, `{ waiting: 0, active: 0 }` after, nothing abandoned. **A real `SIGTERM` could not be tested on this machine**: Windows has no signals, and `kill -TERM` from the shell terminates the process outright (exit 143, none of the shutdown logging), so the signal handler's own path is unverified here. What it calls is the code that was verified.

That last check found and fixed one real defect: the shutdown path ended in `process.exit(0)`, which discards buffered stdout when it is a file or a pipe — losing exactly the shutdown logs this feature relies on to make a dead worker visible. The worker now lets the process end on its own, with an `unref`d 10-second forced exit as the safety net.

### What was deliberately not done

Extraction stays inline (a new backlog row carries the async UX it needs); the shared rate-limit store and email delivery keep their own rows; no status column, no route change, no user-visible "your PDF is out of sync" signal — that is still the instrumentation row.

**The cross-replica embed race row was not closed**, and the reason matters: it is closed on the queued path and untouched on the inline one, and the inline one is the default. It is now a deployment rule — more than one API replica means `REDIS_URL` and a worker — which [08-operations](../docs/sot/08-operations.md) states.

**The queued spec is not in CI.** It skips unless `TEST_REDIS_URL` is set and no workflow sets it; filed as a gap in [09-quality-and-testing](../docs/sot/09-quality-and-testing.md).
