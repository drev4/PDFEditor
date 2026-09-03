# Runbook — the production dependency audit

Built by [`features/0038`](../../features/0038-production-dependency-triage-and-an-audit-gate.md). Companion to [`backup-and-restore.md`](./backup-and-restore.md) and [`production-deployment.md`](./production-deployment.md).

The short version: `npm audit` answers a question nobody ships. `npm run audit:prod` answers the one that matters — **is the vulnerable package inside the image we run, at a version the advisory covers?**

---

## What this measures, and what it deliberately does not

One `package-lock.json` spans three deliverables built by three Dockerfiles:

| Artifact | Built by | Contains `node_modules`? |
|---|---|---|
| The API and the worker | `Dockerfile.backend`, target `runtime` | **Yes** — this is what the audit measures |
| The SPA | `Dockerfile.frontend` | No. Nginx serving static files |
| The migration job | `Dockerfile.migrations` | Yes, and it *deliberately* keeps the Prisma CLI. Never serves traffic |

So `npm audit --omit=dev` is wrong in both directions, and it is worth being precise about which:

- It **counts** advisories against packages that reach no serving image — `vitest`, `vite`, `ws` and the rest of the test toolchain.
- It **hides** the fact that `Dockerfile.backend`'s runtime stage copies the *hoisted* `/app/node_modules`, so **every workspace's production tree is inside the API image, the SPA's included.** On 2026-09-03 that meant `vue@3.5.27`, `@vue/compiler-sfc` and `postcss` were sitting in the API image. This was the opposite of what the spec had assumed, and it was only found by enumerating the built image.

`audit:prod` therefore takes the shipped set **from the image**, never from a manifest. A hand-written inventory of what ships is a second source of truth and would drift from the Dockerfile by the third change to it — the same argument `tests/config-coverage.spec.ts` makes about the environment variables.

**Out of its reach, and the gap is real:** the base image's OS packages. `npm audit` sees no `openssl` and no `ca-certificates`. Dependabot's `docker` ecosystem covers the base image tag; nothing in this repository scans the layer itself.

## Running it

```bash
npm run audit:prod                                   # builds the image, enumerates, audits
npm run audit:prod -- --shipped-from=.audit-shipped.json   # reuse the snapshot, no Docker
npm run audit:prod -- --write-snapshot=.audit-shipped.json # refresh the snapshot
npm run audit:prod -- --json                         # machine-readable
```

Exit codes: `0` clean, `1` a shipped `high`/`critical` is unexcepted or an exception has expired, **`2` the shipped set could not be determined**. Exit 2 is not a warning — a gate that degrades to "no findings" when Docker is missing is worse than no gate, because it is believed.

`.audit-shipped.json` is committed for the developer who has no Docker. It goes stale on every lockfile change and the script says so loudly when it does. **CI never uses it** — the `dependency-audit` job in `.github/workflows/test.yml` builds the image itself, precisely so the gate cannot end up measuring an image nobody ships.

## Exceptions

`.audit-exceptions.json`, one object per `{id, package}`:

```json
{ "id": "GHSA-…", "package": "…", "reason": "…", "expires": "YYYY-MM-DD" }
```

**An exception is a deadline, not a mute button.** Past its `expires` the run fails and says so. That is the whole design: the alternative — lowering the failure threshold until the build is quiet — accepts everything silently and records no reasoning, and then nobody can reconstruct why.

A `reason` must carry a **reachability argument**, not a severity opinion. "Low risk" is not a reason. "Present in the image but never loaded by it, verified as follows" is.

The script also flags exceptions that match nothing — the advisory was fixed and the entry should go.

## Triage of 2026-09-03

Performed on `feature/0038-production-dependency-triage-and-an-audit-gate`. `audit:prod` was run against the unremediated lockfile first and **seen to fail**: 343 packages in the image, **52 blocking findings** (shipped, high or critical, unexcepted) and 24 more below the threshold. `notShipped` was **0** — every one of the 18 advisory packages was in the image, so the intersection filtered nothing. The remediation below took it to 304 packages and 0 blocking.

Note the drift that motivated the automation: `features/0031` recorded **15** advisories (1 critical, 13 high, 1 moderate) and by 2026-09-03 the same lockfile reported **18** (1 critical, 13 high, 4 moderate). Nothing in the repository had changed.

### Fixed

| Package | Was | Now | Notes |
|---|---|---|---|
| `bcrypt` | 5.1.1 | 6.0.0 | **The highest-leverage change.** Replaces `@mapbox/node-pre-gyp` with `node-gyp-build`, which removed `@mapbox/node-pre-gyp`, `tar@6`, `minimatch@3`, `brace-expansion@1`, `rimraf` and `glob` — 24 findings including the only **critical** (`tar` hardlink path traversal). See the risk it carried, below |
| `re2` | 1.24.1 | 1.26.1 | In-range. Four moderates whose attacker input is genuinely this product's: the *pattern* is author-supplied and the *subject* is a respondent's answer value. This is the module the whole ReDoS design rests on ([04-backend-patterns §8](../sot/04-backend-patterns.md)) |
| `multer` | 2.0.2 | 2.3.0 | In-range. Five DoS advisories on the upload path (`backend/src/middleware/upload.ts:49`) |
| `nanoid` | 5.1.6 | 5.1.16 | In-range. The advisories concern zero and negative sizes; every call site passes a literal (`nanoid(12)`, `nanoid(8)`) so none was reachable — bumped anyway because it was free |
| `picomatch` | 4.0.3 | 4.0.7+ | Cleared by the `re2` bump (it arrived via `node-gyp → tinyglobby`) |
| `postcss` | 8.5.6 | 8.5.26 | In-range. Reaches the API image via `vue → @vue/compiler-sfc`; see the hoisting note above. Also cleared `nanoid@3` |
| `defu`, `effect` | 6.1.4, 3.18.4 | 6.1.7, 3.21.0 | In-range, via `npm update` |

### Accepted, with the reason

| Advisory | Package | Why |
|---|---|---|
| `GHSA-ggr8-5vv4-36mx` | `deepmerge-ts`, and `@prisma/config` / `prisma` indirectly | Stack exhaustion merging recursive object graphs. **No in-range fix exists**: `@prisma/config` pins `deepmerge-ts` to exactly `7.1.5`, so only Prisma can clear it. Not reachable here: `require('@prisma/client')` loads neither `@prisma/config` nor `deepmerge-ts` (verified by inspecting `require.cache`), and the only loader is the Prisma CLI reading a `prisma.config.*` file — **this repository has none**. Expires 2026-12-01 |
| `GHSA-x5fp-wj9c-mxmx`, `GHSA-4mjr-xmp4-gh2g` | `qs`, and `express` / `body-parser` indirectly | Both **moderate**, below the gate's failure threshold, so no exception entry is needed — but they are listed here so nobody thinks they were missed. `express@4.22.2` and `body-parser@1.20.6` declare `qs: ~6.15.1` and the fix is only in `6.16.0`, outside that range. Express 4.22.2 is the last 4.x release. Forcing an out-of-range minor on the request parser to clear a moderate is not a trade this codebase should take; **Express 5 is the durable answer and is a separate filed row** — it deletes `asyncHandler` and its scan, so it is its own piece of work |

### Two things that went wrong during the work, and both are findings

**A blanket `npm update` moved a package *into* a vulnerable range.** `pdfjs-dist` was at `5.4.530`; the advisory band is `>=5.6.83 <6.2.108`; `npm update` took it to `5.7.284`. The declared range `^5.4.296` guarantees this happens again, because every future `5.x` lands in the band. Constrained to `~5.4.296` (now `5.4.624`), which keeps patches and stays below it. **The real fix is the 5→6 major on the PDF renderer — the core of the product — and it is filed, not done here.** The general lesson is in `.github/dependabot.yml`: `npm update` is not a safe no-op in this repository.

**The `bcrypt` bump broke the Docker build.** `Dockerfile.backend`'s runtime stage copies `/app/backend/node_modules`, and after the change npm hoisted everything to the root, so that directory no longer existed: `failed to compute cache key … "/app/backend/node_modules": not found`. Whether a workspace keeps a nested `node_modules` at all is a function of which versions are installed — meaning **any** dependency update could have done this. The stage now creates the directory explicitly so it cannot recur. This is exactly the failure the gate is for: it surfaced as an exit `2`, not as a silent pass.

### The risk the `bcrypt` major carried, and how it was closed

Every `User.passwordHash` in the database was written by bcrypt 5. If bcrypt 6 could not verify them, nobody could log in — a total, silent failure at deploy time that no test hashing and comparing within one version would catch, because it would agree with itself.

`backend/tests/password-hash-compatibility.spec.ts` holds three hashes **generated by bcrypt@5.1.1 before the upgrade and committed as fixtures** — ASCII, non-ASCII, and 71 bytes. They must never be regenerated: doing so restores the version-agreeing-with-itself problem the file exists to prevent. The suite was run green against bcrypt 5 first, so it is known to be a real check and not a tautology.

Verified again inside `node:22-bookworm-slim`, because a pass on a developer's Windows machine says nothing about the image:

```bash
docker run --rm vuepdf-audit-runtime node -e "require('bcrypt').compareSync('…','\$2b\$10\$…')"
```

## When Dependabot opens a pull request

1. Read the diff. Do not auto-merge — see `.github/dependabot.yml` for why.
2. Check the `dependency-audit` job. Green means nothing shipped is affected above the threshold; it does **not** mean the update is safe.
3. If the update touches `bcrypt`, `re2` or `@prisma/client`, the suites are not enough. `bcrypt` needs `password-hash-compatibility.spec.ts` green; `bcrypt` and `re2` are native and need the in-image load check above; a major on any of them needs its own reasoning written down here.
4. If the update touches `pdfjs-dist`, re-read the advisory band above before accepting it.
5. If the Docker build fails on a `COPY` of a `node_modules` path, it is hoisting, not the package — see above.

## Re-running the triage

The triage is a snapshot, not a standing fact. Re-run it when the `dependency-audit` job goes red for something new, when an exception approaches its `expires`, and once before the first production deploy — the advisory set moved three times in the few days between `features/0031` and `features/0038`.
