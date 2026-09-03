# Backup and restore runbook

This runbook takes a backup of the product's durable state and rehearses getting it back. It covers the two stores that hold customer data — PostgreSQL and the PDF object storage — and deliberately does not cover Redis.

Written for [`features/0037`](../../features/0037-backups-with-a-tested-restore.md). The reasoning behind the design decisions is there; this file is the procedure.

## What is being protected, and what is not

| Store | Holds | Backed up by |
|---|---|---|
| PostgreSQL | Every row: accounts, organizations, forms, fields, **responses and answers** | `npm run backup:db` + the provider's own snapshots |
| Object storage | The uploaded PDF documents (`backend/src/services/pdf-storage.ts`) | `npm run backup:objects` + provider versioning |
| Redis | The embed and webhook job queues | **Nothing, deliberately** — see below |

**Redis is not backed up and that is correct.** A queue of embed jobs is not durable state: every job is reconstructible, the fields live in PostgreSQL, and re-saving a form enqueues another. `docker-compose.yml` says so where the container is defined.

**It is not correct to conclude that a restore loses nothing.** Whatever was in flight is gone, and the failure is silent — no request errors, the queue is simply short some jobs and those forms' PDFs stop matching their fields. There is a step for this after every restore; do not skip it.

## The two stores must be restored together

This is the one thing to carry away from this document.

`Form.pdfUrl` points out of PostgreSQL and into object storage, and nothing keeps the two consistent. Since [`features/0029`](../../features/0029-account-deletion-and-real-erasure.md), deleting a form deletes its document too — so a database restored to one moment against a bucket at another produces forms that open in the editor and fail at the document, with nothing logged anywhere.

**Restore order is bytes first, rows second.** This is the mirror of the deletion order, not a copy of it. [`features/0029`](../../features/0029-account-deletion-and-real-erasure.md) deletes rows first because the reversible failure is bytes left behind; on restore, the reversible failure flips. A form pointing at a missing object is a broken form. An object no form points at is storage cost and nothing else.

## Secrets are part of the backup

A database dump does not restore the product on its own. Restore it under freshly generated secrets and some of it does not work, in ways that are not obvious:

| Secret | What is lost without the original |
|---|---|
| `WEBHOOK_SIGNING_KEY` | **Every customer's webhook endpoint secret.** `webhook_endpoints.secret` is encrypted with AES-256-GCM under this key (`backend/src/services/webhooks.ts`). Restored under a different key the ciphertext cannot be opened, deliveries stop, and there is no rotation endpoint — the only remedy is delete-and-recreate, which changes the endpoint id as well as the secret and requires every customer to reconfigure their receiver |
| `JWT_SECRET` | Every access token and refresh token. Everyone is signed out — recoverable, and the least bad item on this list |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | The link to billing. `Subscription` rows restore fine and stop being reconcilable with Stripe |
| `PDF_STORAGE_*` | Access to the documents themselves |

Keep them wherever the deployment's secrets live, and verify that store is itself backed up. A dump in one place and its `WEBHOOK_SIGNING_KEY` in nobody's hands is a partial backup that reads as a complete one.

## Prerequisites

- `pg_dump` and `pg_restore` from the PostgreSQL client package, **at least the server's major version**. The server is PostgreSQL 16 (`docker-compose.yml`); `pg_dump` refuses to run against a server newer than itself. On Debian this is `postgresql-client-16` from the PGDG repository — the version in Debian bookworm is 15 and will not do.
- `DATABASE_URL` for the source, and the storage variables for whichever driver holds the documents. Both scripts load `.env` themselves.
- A **scratch** database for the drill. Never the production one; the tooling refuses, but do not rely on that as the only control.

## Taking a backup

```bash
npm run backup:db      --workspace=backend -- --out /var/backups/vuepdf
npm run backup:objects --workspace=backend -- --dump /var/backups/vuepdf/vuepdf-<stamp>.dump
```

`backup:db` writes two files and **both are the backup**: the `pg_dump --format=custom` archive and a `<dump>.manifest.json` beside it. The manifest is not a note for humans — it carries the checksum, the applied migration, a row count per table, and the list of document keys the dumped rows point at. `restore:verify` needs it to check anything, and `backup:objects` reads its work list from it.

**`backup:objects` takes its list from the manifest, not from the live database.** That is what makes the pair coherent: it captures the documents *this dump* refers to, rather than the ones the product happens to reference by the time the object copy runs.

Take backups when traffic is low. `pg_dump` gives a consistent snapshot, but the manifest's row counts are gathered just afterwards, so a database taking writes produces small legitimate differences — which is why `restore:verify` reports a count mismatch as a warning and a missing document as a failure.

Both scripts exit non-zero on failure. A scheduler that only checks exit codes is the intended audience.

### Provider backups as well, not instead

## Running it on a schedule

**One command, and it needs three things the manual run did not.**

```bash
BACKUP_DIR=/backups npm run backup --workspace=backend
```

It takes the dump, finds the manifest that dump produced, and copies the documents that manifest lists — in that order, stopping if the first half fails. Each run gets its own timestamped directory, so the manifest inside it is unambiguous and pruning is `rm -rf` on a directory rather than a filename pattern.

**`BACKUP_DIR` has no default, deliberately.** `backup:db` on its own writes to `./backups`, and a scheduled job normally runs in a container that is discarded when it exits — so that default produces a job which succeeds every night and keeps nothing. **A green job is worse than a missing one**, because it removes the pressure to fix it. Point it at a mounted volume.

**The image runs the compiled script and does not build.** `npm run backup` starts with `npm run build`, which is right at a terminal and wrong in a scheduled job: the image compiled `backend/dist` when it was built. It is also a removed failure — there is no `tsconfig.json` at the repository root, so a `tsc` whose working directory ends up there prints its usage instead of compiling, and a backup should not have a compiler on its critical path.

**Run it from the `backup` image, not the serving one.** `docker build -f Dockerfile.backend --target backup` produces the same build plus `postgresql-client-16` from PGDG. None of the other images has `pg_dump` at all, and the Debian package is 15, which will not read a 16 server. The image runs `pg_dump --version` at build time so a missing client fails then rather than at 03:00 on the first night.

**Alerting is the platform's job and it is not optional.** Both halves exit non-zero on failure, into a void. Configure the scheduled job to notify on a non-zero exit; without that, a backup that stops working is discovered at the restore, which is the worst possible moment.

**Retention is your decision and nothing prunes.** One directory per run, so deleting the oldest is a directory removal. Decide the number and write it down here.

Turn on the platform's own PostgreSQL snapshots and the bucket's versioning. They are a better answer than these scripts for the common cases — one deleted object, a mistake ten minutes ago — because they are continuous and need no host to run on.

They are not sufficient on their own, for two reasons. A managed snapshot **restores into that provider** and does not survive losing the account. And versioning protects against overwrite and deletion *inside* a bucket; it does nothing when the bucket, the account or the region is what is lost. The portable pair above is the off-site copy; keep at least one somewhere neither provider controls.

## The drill

Run it on a schedule, not only after changing something. An untested backup is a belief.

```bash
createdb vuepdf_restore     # or: psql -c 'CREATE DATABASE vuepdf_restore'

npm run restore:verify --workspace=backend -- \
  --dump /var/backups/vuepdf/vuepdf-<stamp>.dump \
  --target postgresql://…/vuepdf_restore
```

It refuses before touching anything if the target is the database in `DATABASE_URL` (compared on host, port and name — not as a string, because the same database is routinely named by two different URLs), if the target already contains a table, or if the archive does not match its manifest checksum.

Then it restores and asks four questions about the result:

1. **Migration** — does `_prisma_migrations` match the newest directory in `backend/prisma/migrations/`? A restore one migration behind the code is a deploy that crashes on its first query.
2. **Row counts** — against the manifest. A table that is missing entirely shows as `-1` and is a failure of a different order from a count that drifted by three.
3. **Foreign keys** — established by `pg_restore --exit-on-error`, which creates constraints after loading data and validates them as it goes. The flag is not optional; without it `pg_restore` continues past a failed constraint and reports success.
4. **Documents** — for every restored `Form.pdfUrl`, is the object actually in storage? **This is the check nothing else in the codebase performs**, and it is the one that fails when a database backup was taken without its objects.

A pass prints the restore duration. Write it down here with the date; a drill nobody recorded is a drill nobody ran.

### After a real restore, not a drill

1. Restore the **objects first**, then the database.
2. Confirm the secrets above are the ones the dump was taken under, especially `WEBHOOK_SIGNING_KEY`.
3. Run the smoke checks in [`production-deployment.md`](./production-deployment.md) — readiness alone is not enough. `/health/ready` reports the database and the queue worker, and none of it proves a document can be read: sign in, open a form, and download its PDF, which is the one check that crosses storage as well.
4. **Re-save any form edited near the moment of the failure.** The embed jobs in flight are gone with Redis, and nothing reports it: those forms' PDFs will not match their fields until a save enqueues the work again. If the window is unknown, the safe move is to treat every form modified in the hour before the incident as suspect — `SELECT id, title, updated_at FROM forms ORDER BY updated_at DESC LIMIT 50` is where to start.
5. Tell whoever owns the affected accounts. Nothing in this product sends email.

## Drill log

| Date | Dataset | Dump | Restore | Result |
|---|---|---|---|---|
| 2026-09-02 | Development database: 16 tables, 1,925 users, 1,824 organizations, 155 forms, 154 referenced documents, 56 responses | 736 KB in 0.4 s; objects 5.7 MB in 1.8 s | < 1 s | **Pass.** Migration, row counts across all 16 tables and all 154 documents verified. Run against PostgreSQL 16 with the `local` storage driver |

Three things that run established this is not a vacuous pass, and are worth repeating on any future drill:

- **All three refusals were exercised against real databases.** Pointing `--target` at the live database under a *different username* was refused — a string comparison would have allowed it. A target with 16 tables was refused. An archive with four bytes appended was refused on its checksum, and the target was confirmed still empty afterwards.
- **The document check was made to fail on purpose.** Three PDFs were removed from storage and the drill reported exactly those three by name and exited non-zero. A check that has only ever passed proves nothing.
- **The first run failed and found a real defect** — `pg_restore` requires an explicit `--dbname` and, unlike `pg_dump`, will not take its target from `PGDATABASE`. It is fixed. This is what drills are for.

**What this number is not.** It is a development dataset of 736 KB. It says the procedure is correct and it says nothing useful about production recovery time, which is unmeasured because no production environment is provisioned yet ([`features/0031`](../../features/0031-production-deployment.md) defines the target; D1 in [10-saas-roadmap](../sot/10-saas-roadmap.md) stays open until it exists). **Re-run this drill against the production database within a week of the first deploy and replace this row.** Until then the honest RTO is unknown, and the honest RPO is the backup interval, which is not scheduled yet either.

## What is not built

- **No schedule.** Nothing in this codebase runs on a clock — the same wall [`features/0029`](../../features/0029-account-deletion-and-real-erasure.md) and [`features/0032`](../../features/0032-respondent-notice-and-ip-collection.md) hit. Until there is a scheduler, the backup is a platform cron job calling `backup:db` and then `backup:objects`, and the runbook cannot promise an RPO the deployment does not enforce.
- **No alert on a failed backup.** Both scripts exit non-zero and nobody is told, because this product has no notification path at all. Filed in [`docs/BACKLOG.md`](../BACKLOG.md).
- **No point-in-time recovery.** The provider's WAL retention is the answer to that, and it is a setting to enable rather than code to write.
- **No per-tenant restore.** Everything here restores the whole database. Restoring one organization needs an import to pair with [`features/0030`](../../features/0030-account-data-export.md)'s export, which does not exist.
