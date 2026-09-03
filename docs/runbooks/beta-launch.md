# Runbook — the private beta

What the beta is, how somebody gets into it, how to check the deployment is actually working, and the criteria for opening to the public. It exists so that opening the beta is a decision somebody takes against written criteria rather than a feeling that things look fine.

Target date: **2026-09-30** (D-039, D-040). Public opening seven days later, and only through the gate at the end of this document.

Two things this runbook does not decide, because they are the founder's and are marked where they appear: the **cohort size** and the **support channel**.

## What the beta is

A small, hand-picked cohort using the product on real documents, so that the questions the roadmap is waiting on get answers from use rather than from argument.

**In scope, and all of it works today:** register with an invitation code, upload a PDF, keep or place fields, publish a public link, collect responses without the respondent needing an account, review them on the dashboard, export CSV, invite colleagues, mint an API key, configure an outbound webhook, export everything, and delete the account.

## What is deliberately out, and must be visibly out

Saying this out loud to the cohort is part of the scope. A beta tester who discovers a gap feels misled; one who was told about it evaluates the product instead.

| Not in the beta | Say it like this |
|---|---|
| **A completed PDF per response** | Responses are structured data and CSV. The product does not yet produce a filled-in copy of the document. *This is the single most important thing to ask them about* — whether it is a purchase requirement is what the beta exists to find out (H-009, H-010) |
| **Photo and signature fields** | A respondent cannot attach a photo or sign. Field types are text, long text, checkbox, radio and dropdown |
| **Any email at all** | Invitations are links you send yourself. No password reset, no notifications, no alerts. If their endpoint is auto-disabled after ten failures, nobody tells them |
| **AI field detection** | Existing AcroForm fields are extracted deterministically. Nothing is inferred. Do not call the extraction "AI" |
| **Payment** | The beta is free. Billing routes answer `503` and there is no plan picker |
| **Response retention limits** | Nothing deletes old submissions on a schedule |
| **A respondent reaching their own answers** | A share link is anonymous by design, so requests go through the form's owner |

**Plan limits during the beta are 10 published forms, 1,000 responses a month and 5 seats** ([`features/0040`](../../features/0040-beta-plan-limits.md)) — not the limits of any future plan, and they revert when Stripe is configured.

## Getting somebody in

`REGISTRATION_MODE=invite_only` plus a shared `REGISTRATION_CODE` ([`features/0033`](../../features/0033-close-public-registration.md)). Send the code with the sign-up link.

**The code is forwardable and that was accepted deliberately** (D-046): anyone it reaches can register. It is adequate for a hand-picked cohort and it is not adequate for a public one. If the cohort grows or the code leaks, rotate it — one variable and a restart, and both directions are one operator action ([08-operations](../sot/08-operations.md#closing-and-reopening-sign-ups)).

Colleagues a customer invites go through the invitation flow, not the code, and that path stays open with registration closed.

Cohort size and selection: <span>**founder's decision — record it here when taken**</span>. The waitlist is the source (`landing`, D-041).

## Checking the deployment, repeatably

Run this after any deploy that touches configuration, and again before inviting anybody. It is ordered so that each step's failure mode is distinguishable from the next one's.

**Every check here corresponds to something that fails silently.** That is the reason the list is not "click around and see": four of these produce no error anywhere when they are wrong.

| # | Check | Wrong looks like | Why it is on the list |
|---:|---|---|---|
| 1 | `curl https://api.docaiflow.com/health/ready` | Anything but `200` with `database: ok` and `queue.status` `ok` or `disabled` | With `REDIS_URL` set and no worker, **nothing errors**: the queue fills and every form's PDF stops matching its fields |
| 2 | The served SPA's CSP `connect-src` contains the Sentry ingest origin | Origin absent | `VITE_SENTRY_DSN` is compiled in. Set-but-not-rebuilt reports nothing, and the browser would block it anyway ([`features/0041`](../../features/0041-sentry-reaches-the-spa.md)) |
| 3 | Both API and worker logs say `error tracking: reporting` at boot | `not configured`, or the `NODE_ENV` line | The backend has no external surface to check this on. `SENTRY_VERIFY_ON_BOOT=true` sends one event per process to prove the whole path, then turn it off |
| 4 | Register → upload a PDF → place a field → publish → submit from another browser → see the row → export CSV | Any step fails | The only check that exercises R2, the signed PDF URL, the cookie across `app.`/`api.`, CORS and the response transaction together |
| 5 | The submitted response's row carries **no IP address** unless the form's author asked for one | An address present on a form that did not enable it | `Form.collectsRespondentMetadata` is off by default ([`features/0032`](../../features/0032-respondent-notice-and-ip-collection.md)), and the public notice is written from it |
| 6 | Rate limiting counts the real client | One address blocking everyone, or nobody blocked | `TRUST_PROXY_HOPS` is a guess until measured, and **both wrong values fail silently in opposite directions** ([08-operations](../sot/08-operations.md)) |
| 7 | A backup run: dump, manifest, and **`0 failed`** documents | `1 failed` (credentials), or `0 referenced documents` when forms have PDFs (missing `PDF_STORAGE_*`) | A backup that copies zero documents restores forms whose PDFs are gone |
| 8 | `restore:verify` against a **production** backup, timed | Any failure; a mismatch in row counts is a warning, a missing document is not | The recovery time on record is from a 736 KB development dataset and says nothing about production |

Record the run: the date, who did it, and the result of each numbered step. A check whose result was not written down did not happen.

## Support, while the product cannot send email

The product has no email delivery of any kind, so support is whatever channel you give the cohort directly: <span>**founder's decision — record the channel and the response expectation here**</span>.

Two consequences to plan for rather than discover:

- **You will be the notification system.** Nothing tells a customer their webhook endpoint was disabled, that a plan limit was reached, or that anything failed. Watch Sentry and the logs, and tell them.
- **A forgotten password cannot be reset.** There is no reset flow because there is no email. Today the answer is to help them directly.

## What to do when something is wrong

**Rollback is a deploy, not a data operation.** Redeploy the previous image. The database is the thing a rollback cannot undo, which is why migrations are their own one-shot job run deliberately.

| Situation | Action |
|---|---|
| A release is bad | Redeploy the previous image. If the release included a migration, check [03-domain-model](../sot/03-domain-model.md) before considering reverting it — several are not reversible without data loss |
| Data loss suspected | Stop writes if you can, then [the restore procedure](./backup-and-restore.md). Restore order is **bytes first, rows second** |
| The code leaked | Rotate `REGISTRATION_CODE` and restart. Existing accounts are unaffected |
| A respondent's data must go | Through the form's owner; there is no self-service path |
| The queue is backed up | Check `/health/ready` first: a missing worker looks like nothing at all |

## The gate for opening publicly

Seven days after the cohort is in. **Every line is checkable, and the decision is written down either way** — a go with a known gap is a decision; a go because nobody looked is not.

- [ ] Registration, login and the invitation flow all work for somebody who is not you.
- [ ] The flow PDF → publish → respond → dashboard → CSV completes with no manual intervention.
- [ ] No data loss and no critical security or privacy finding is open.
- [ ] Errors and service health are visible: Sentry reporting from all three processes, `/health/ready` green.
- [ ] **A backup restored and timed against production data**, with the number recorded in [the backup runbook](./backup-and-restore.md). Not "backups are configured".
- [ ] The backup is scheduled **and the platform alerts on a non-zero exit**. An unwatched backup is not a control.
- [ ] A support channel exists, with a stated response expectation, and somebody is reading it.
- [ ] The product privacy notice and beta terms are **published**, not just written — they carry a placeholder address until the professional address is decided, and the landing's ship check treats that as production-blocking.
- [ ] Analytics measures activation without capturing document content or response values.
- [ ] The public claims on the landing match what registration actually allows.

**If a line fails, the honest outcomes are to fix it or to delay.** Opening with a known failing line is also allowed — as a recorded decision with a reason, not as an oversight.

## Log

| Date | Event | Notes |
|---|---|---|
| 2026-09-03 | Deployment verified | Railway, Cloudflare, R2, Redis and PostgreSQL live. `/health/ready` `200` with `workers: 1`. Sentry reporting from the SPA (CSP origin and bundle both confirmed). First production backup completed: PostgreSQL 18 dump, manifest, one referenced document copied |
| | | |
