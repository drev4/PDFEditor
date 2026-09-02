# 0037 — Backups with a tested restore

**Status:** in progress
**Priority:** P1 (see `docs/BACKLOG.md`, *Automated backups with a tested restore*)
**Branch:** `feature/0037-backups-with-a-tested-restore`
**Related:** [08-operations](../docs/sot/08-operations.md#backups-and-recovery) · [03-domain-model](../docs/sot/03-domain-model.md) · [10-saas-roadmap D3](../docs/sot/10-saas-roadmap.md#d--the-beta-on-2026-09-30) · [`features/0016`](0016-object-storage-for-uploaded-pdfs.md) · [`features/0029`](0029-account-deletion-and-real-erasure.md) · [`features/0031`](0031-production-deployment.md)

## Context

[08-operations §Backups and recovery](../docs/sot/08-operations.md) states the whole of it in one line: *"There are no backups, and nothing has been restored, so recovery time is unknown."* This is D3 in the roadmap, and it is the **only** row in the D track that genuinely waits on D1 — you cannot back up an environment that does not exist.

D1 is no longer the blocker it was. [`features/0031`](0031-production-deployment.md) packaged the product and defined the target: Railway hosts the API, the worker, the SPA and managed PostgreSQL/Redis; Cloudflare provides DNS/TLS and two private R2 buckets. Its own Out of scope says *"Backups and restore drills (D3)"* — this spec is that hand-off. It is dated by the same 2026-09-30 private beta as the rest of the D track, and it is the one whose absence is unrecoverable rather than merely embarrassing: every other D-track gap costs a day, this one costs the customer's data.

The word in the roadmap row is **tested**. A backup nobody has restored is a belief. The deliverable of this feature is therefore not a `pg_dump` line in a cron entry — it is a *drill that has been run, whose output is recorded, and whose recovery time is a measured number rather than an unknown*.

Two facts about this codebase decide the shape of the work, and neither is obvious from the roadmap row.

**There are two stores, not one.** PostgreSQL holds every row; the uploaded PDF bytes live behind `backend/src/services/pdf-storage.ts`, under the `s3` driver in production ([`features/0016`](0016-object-storage-for-uploaded-pdfs.md)). `Form.pdfUrl` is a pointer from the first into the second. Nothing in the codebase keeps the two consistent, and since [`features/0029`](0029-account-deletion-and-real-erasure.md) they actively diverge: `routes/forms.ts:274` and `routes/account.ts:139` call `keysReferencedBy` then `collectOrphanDocuments`, so deleting a form deletes its document too.

**A database dump is not sufficient to restore the product.** `backend/src/services/webhooks.ts:50` encrypts `webhook_endpoints.secret` with AES-256-GCM under `WEBHOOK_SIGNING_KEY`. The key is not in the dump. Restore the database under a freshly generated key and every customer's webhook endpoint holds ciphertext nobody can open — and there is no rotation endpoint (`docs/BACKLOG.md`, P2), so the only remedy is delete-and-recreate, which changes the endpoint id as well as its secret.

## Why the obvious approach is wrong

**"Railway takes automatic backups" is not an answer to this row.** It is a checkbox that has never been exercised, and the row's word is *tested*. Two further problems with stopping there. A provider snapshot restores **into that provider**, so it does not survive losing the account — and the reason the D track exists at all is that this product is about to run somewhere it has never run. And a snapshot covers PostgreSQL only; R2 is a separate service with a separate failure mode and no snapshot at all. Provider backups should absolutely be turned on, and the runbook must say how — but they are a *floor*, and the portable dump plus a rehearsed restore is the actual deliverable.

**Restoring the database alone is worse than restoring neither store.** A database at T-1 against a bucket at T-0 gives forms whose `pdfUrl` names an object that was collected when the form was deleted at T-0.5. Every one of those forms opens in the editor and fails at the document. Nothing errors on the write path, so the damage is discovered by a customer.

**And the restore order is the mirror of the deletion order, not the same as it.** [`features/0029`](0029-account-deletion-and-real-erasure.md) settled *rows first, bytes second* for deletion, because the reversible failure is bytes left behind. Restore reverses which failure is reversible: **bytes first, rows second.** A form pointing at a missing object is a broken form; an object no form points at is only storage cost — and `pdf-gc.ts` will not remove it unprompted, because `collectOrphanDocuments` runs only from a delete handler and only over the keys that handler was given.

**A restore that ends in `pg_restore` exiting `0` proves nothing.** That is hard rule 6 restated in a new place: this repository has already shipped a data-loss defect underneath a green check. `pg_restore` reports on its own execution, not on whether the application can work against the result. The drill's assertion has to be about the restored data — migration state, referential integrity, and the cross-store pointer check nothing else in the codebase performs.

**Do not back up Redis — and do not conclude that nothing is lost.** `docker-compose.yml` already argues the first half: a queue of embed jobs is not durable state, every job is reconstructible from PostgreSQL, and re-saving a form enqueues another. But a restore loses whatever was in flight, and CLAUDE.md names exactly what that looks like: *no request errors, the queue just fills and every form's PDF quietly stops matching its fields*. So "we do not back up Redis" is correct and incomplete. The runbook needs a post-restore step that names the affected forms, because nothing will report them.

**A drill run against production is not a drill.** It restores into a scratch database, always, and the restore tool must refuse a target that is not empty rather than trusting the operator's `--target` flag. Note the specific trap: `_prisma_migrations` travels inside the dump, so restoring into a database the migration job has already touched produces a conflict rather than a clean failure — which is the good outcome only because the tool refused first.

## Goal

Each of these is true or false when the work is finished.

1. `npm run backup:db --workspace=backend` produces a portable `pg_dump --format=custom` artifact plus a sidecar manifest recording: the artifact's SHA-256, the UTC timestamp, the applied migration name from `_prisma_migrations`, and a row count per table in the cascade map.
2. `npm run backup:objects --workspace=backend` (or a documented provider-native equivalent, if the executor concludes a script is the wrong tool — the spec permits either, but the runbook must contain whichever was chosen) captures the PDF bucket, and the runbook states which of the two it is and why.
3. `npm run restore:verify --workspace=backend -- --dump <file> --target <url>` restores the dump into the named database and **refuses to run if that database contains any table**. It exits non-zero on any failed assertion below.
4. That verification asserts, against the restored database: the migration recorded in `_prisma_migrations` matches the newest directory in `backend/prisma/migrations/`; row counts match the manifest; no foreign key is violated; and — the check nothing else in this codebase performs — **for a bounded sample of forms with a non-null `pdfUrl`, `pdfFilenameFrom` yields a filename and `pdfStorage()` reports the object present.** A form whose document is missing is reported by id, and the count of such forms is the drill's headline number.
5. The restore tool never writes to the store the application is using: it refuses a `--target` equal to `DATABASE_URL`, and its object check is read-only (`HeadObject`, never `Put` or `Delete`).
6. `docs/runbooks/backup-and-restore.md` exists, in the shape of `docs/runbooks/production-deployment.md`, and contains: the provider configuration steps (Railway PostgreSQL backups, R2 versioning/lifecycle), the schedule, where artifacts are stored and for how long, the exact restore procedure in the correct order (**bytes, then rows**), the post-restore step for stale PDF embeds, and a **secret inventory** naming every value that must be restored alongside the data — `WEBHOOK_SIGNING_KEY` first, with the consequence of losing it spelled out.
7. **A drill has actually been run**, and its measured RPO and RTO are written into the runbook and into [08-operations §Backups and recovery](../docs/sot/08-operations.md), replacing *"recovery time is unknown"* with a number and the date it was measured.
8. Backend tests cover the refusals — non-empty target, target equal to `DATABASE_URL` — and the missing-object assertion, using the existing `setPdfStorage` seam in `pdf-storage.ts` rather than a network call.

## Out of scope

- **Provisioning anything.** No Railway or Cloudflare resource, no bucket, no credential. Same boundary as [`features/0031`](0031-production-deployment.md).
- **Point-in-time recovery.** A daily artifact with a stated RPO is the beta's answer; WAL shipping is a provider feature to enable, not code to write here.
- **Alerting when a backup fails.** It needs the notification path this product does not have — the same missing dependency as *"Nothing tells a customer their webhook endpoint was disabled"* and *"Nothing alerts on a tracked error"* in `docs/BACKLOG.md`. File the row; do not build half a mail service inside a backup script.
- **The scheduler.** Two backlog rows already wait on one (the deletion grace period, response retention) and this makes three. If the backup schedule is a platform cron, say so in the runbook and file the general scheduler row unchanged — do not introduce a second scheduling mechanism for this alone.
- **Soft delete / undo for `DELETE /api/forms/:id`.** [08-operations](../docs/sot/08-operations.md) notes a misclick is unrecoverable *even with backups*, because nobody would know to restore. That is real and it is a different feature.
- **Restoring a single tenant.** Everything here restores the whole database. Per-organization restore needs the export/import round trip that [`features/0030`](0030-account-data-export.md) only half exists for.
- **Changing any application behaviour, route, schema or migration.** This feature adds scripts, a runbook and documentation. If it needs a schema change, stop and re-specify.

## Execution prompt

> Read first, in this order: `docs/sot/08-operations.md` (§Database migrations, §Backups and recovery, §Observability), `docs/runbooks/production-deployment.md` and `deploy/railway/README.md` (both from [`features/0031`](0031-production-deployment.md)), `backend/src/services/pdf-storage.ts` (the driver interface, `pdfStorage()`, `setPdfStorage()`), `backend/src/services/pdf-url.ts` (`pdfFilenameFrom`), `backend/src/services/pdf-gc.ts` (`keysReferencedBy`, `collectOrphanDocuments`) and its two call sites at `backend/src/routes/forms.ts:274` and `backend/src/routes/account.ts:139`, `backend/src/services/webhooks.ts:50-70` (the AES key), and the cascade map in `docs/sot/03-domain-model.md`. Do not start from this spec's summary of any of them.
>
> **Build three things and no more.**
>
> 1. `backend/src/scripts/backup-db.ts`, wired as `backup:db` in `backend/package.json` beside the existing `storage:migrate` and `migrate:run` entries. It shells `pg_dump --format=custom` and writes the manifest described in Goal 1. Read `DATABASE_URL` through the existing config path; do not add a new environment variable unless you can name what has no safe default, and if you do, add it to `validate-env.ts` and its `KNOWN_VARIABLES` inventory — `backend/tests/config-coverage.spec.ts` will fail otherwise, by design ([`features/0028`](0028-boot-time-configuration-validation.md)).
> 2. `backend/src/scripts/restore-verify.ts`, wired as `restore:verify`. The refusals in Goal 3 and 5 come **before** any `pg_restore`, not after. The object check goes through `pdfStorage()` and `pdfFilenameFrom` — never `path.join` and never a bucket key built by hand; `pdf-storage.ts` says in its own header that nothing outside it may do that, and this script is not an exception.
> 3. `docs/runbooks/backup-and-restore.md`, following the structure of `docs/runbooks/production-deployment.md` — Prerequisites, the procedure, smoke checks, and what to do when it goes wrong. Cross-link it from that runbook's rollback section, because a rollback and a restore are adjacent decisions and the operator reaching one should see the other.
>
> **The object side.** Decide between a script and provider-native versioning, and write the decision down with its reason. Prefer the provider if it is genuinely sufficient — this repository does not need another moving part. Whatever you choose, the *verification* stays in `restore-verify.ts`, because that is the half nothing else can do.
>
> **Tests.** `backend/tests/` (mocked Prisma) for the refusals and the argument handling. For the missing-object assertion, install a fake driver through `setPdfStorage` — the seam exists for this. No test may require a network, a real bucket or a real `pg_dump` binary; the three suites run offline and must keep doing so (`docs/sot/09-quality-and-testing.md`). If you find yourself wanting a real PostgreSQL for a genuine restore assertion, that belongs in `backend/tests/integration/` and must skip cleanly when `DATABASE_URL` is absent, in the shape `tests/integration/pdf-embed-queue.spec.ts` already uses for `TEST_REDIS_URL`.
>
> **Then run the drill, for real, and report what actually happened.** Take a dump of a database with representative data, restore it into a scratch target, run the verification, and time it end to end. Hard rule 8 governs the write-up: if the object check finds missing documents, that number goes in the runbook — it is the most valuable output of this feature, not a blemish on it. If the drill cannot be run in this session because no environment is provisioned, say so explicitly, leave Goal 7 open, and do **not** describe the feature as done.
>
> **Verify:**
> ```
> npm run test:backend
> npm run test:integration          # only if you added an integration spec
> cd backend && npx tsc --noEmit
> cd backend && npm run typecheck:tests
> npm run build
> ```
>
> **On the way out:** run `sot-sync`. `docs/sot/08-operations.md` §Backups and recovery is the section this feature exists to rewrite — it must no longer say recovery time is unknown, and it must carry the measured numbers and the date. Update `docs/sot/10-saas-roadmap.md` D3 with what shipped and what deliberately did not. Remove the *Automated backups with a tested restore* row from `docs/BACKLOG.md` P1, and file the new rows this work creates (backup-failure alerting; anything the drill uncovered). Set this file to `**Status:** done` with an Outcome section. Then run `ship-checklist` before the PR.
