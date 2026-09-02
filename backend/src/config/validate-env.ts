import { logger } from '../services/logger.js'
import { OVERRIDE_ENVIRONMENTS } from '../services/plans.js'
import {
  MIN_CODE_LENGTH,
  REGISTRATION_MODES,
  type RegistrationMode
} from './registration.js'

/**
 * Configuration checked once, at the boundary of a real process (features/0028).
 *
 * ## What this is not
 *
 * It is **not** a replacement for `config/env.ts`, and it does not change how a
 * single value is read. `envInt` and `envBool` warn and fall back on purpose:
 * a typo in `EMBED_WORKER_CONCURRENCY` must not take the service down, and
 * every caller picks the safe direction as its default. That contract stays
 * exactly as it was.
 *
 * This is the other half — the variables that have **no safe default**, where a
 * wrong value produces no error at all and a symptom days later. All four of
 * these are already documented individually in `docs/sot/08-operations.md`,
 * because each was found separately and none of them was found at boot:
 *
 *   - `STRIPE_WEBHOOK_SECRET` wrong: every event fails signature verification
 *     and answers `400`. Nothing logs, because a `400` is this API answering
 *     correctly. The symptom is subscriptions paid for and never activated.
 *   - `BASE_URL` absent: `services/pdf-url.ts` falls back to
 *     `http://localhost:3000` and signs PDF links pointing at the container's
 *     own loopback. Every uploaded PDF is unreachable and nothing errors.
 *   - `WEBHOOK_SIGNING_KEY` the wrong length: `services/webhooks.ts` logs once
 *     and treats it as absent, silently disabling webhooks.
 *   - `STRIPE_PRICE_PRO`/`_TEAM` wrong: a paying customer resolves to **free**.
 *
 * None of those is a bug in the module that owns it. Each chose the least-bad
 * behaviour available *at the point the value is read*, which is the middle of
 * serving a request. The point at which a deployment can still be fixed cheaply
 * is the boot, and until this module nothing looked at the environment there.
 *
 * ## Where it runs, and where it must not
 *
 * `assertEnv` is called from `src/index.ts` and `src/worker.ts` only — the two
 * files a real process enters and no test imports. It deliberately does **not**
 * run at import time in `app.ts`: that module calls `dotenv.config()` and every
 * backend spec imports it, so a strict check there would validate the
 * developer's own `.env` on every `npm run test:backend`. That bleed is not
 * hypothetical; `backend/vitest.config.ts` pins six variables to fake values
 * because of it, with the comment "which it did, and four of them failed before
 * this line existed".
 *
 * `validateEnv` is pure for the same reason the split exists: it takes the
 * environment as an argument and returns problems as strings, so the specs can
 * exercise a production-shaped environment without mutating `process.env`.
 */

/** Which process is booting. See `roleOf` on each rule for why it matters. */
export type ProcessRole = 'api' | 'worker'

/**
 * Whether a missing required variable is a failure.
 *
 * An **allowlist**, and the direction is the whole safety property — the same
 * argument `services/plans.ts` makes for `DEV_PLAN_KEY`, which is why this
 * imports that constant rather than writing a second copy of the list. The
 * obvious version, `NODE_ENV === 'production'`, skips validation whenever
 * `NODE_ENV` is unset, misspelled or dropped by a process manager: every one of
 * those is an ordinary way a real deployment ends up in the wrong branch, and
 * here the wrong branch is *do not check anything*.
 *
 * So the ambiguous cases fall into **strict**. A developer who has not set
 * `NODE_ENV` sees the check fire; a deployment that has lost it does too.
 */
export function isStrict(env: NodeJS.ProcessEnv): boolean {
  return !OVERRIDE_ENVIRONMENTS.includes(env.NODE_ENV?.trim() ?? '')
}

function value(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const raw = env[name]?.trim()
  return raw ? raw : undefined
}

/**
 * The complete message for a value that should be an absolute `http:`/`https:`
 * URL, or `null` when it is one.
 *
 * It returns the whole sentence rather than a fragment a caller appends to,
 * because the two cases want different endings: a value that is not a URL at
 * all is helped by an example, and one with the wrong scheme already knows what
 * a URL looks like and only needs to be told which schemes are accepted.
 */
function urlProblem(name: string, raw: string, example: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return `${name} is not a URL. Expected an absolute URL such as ${example}.`
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return `${name} has scheme "${parsed.protocol.replace(':', '')}"; expected http or https.`
  }

  return null
}

/**
 * Every variable this backend reads.
 *
 * The list is explicit and the ones deliberately left unchecked are listed too,
 * each with its reason. `tests/config-coverage.spec.ts` scans `src/` and fails
 * when a name it finds is missing from here, which is what stops this from
 * quietly becoming a second, stale source of truth about the configuration —
 * the same technique `tests/async-handler-coverage.spec.ts` uses, and for the
 * same reason: `npm run lint` lints nothing.
 */
export const KNOWN_VARIABLES: readonly string[] = [
  // Checked below.
  'JWT_SECRET',
  'DATABASE_URL',
  'BASE_URL',
  'FRONTEND_URL',
  'PDF_STORAGE_DRIVER',
  'PDF_STORAGE_BUCKET',
  'WEBHOOK_SIGNING_KEY',
  'REDIS_URL',
  'TRUST_PROXY_HOPS',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PRICE_PRO',
  'STRIPE_PRICE_TEAM',
  'REGISTRATION_MODE',
  'REGISTRATION_CODE',
  'SENTRY_DSN',

  // Deliberately unchecked, one reason each.
  'NODE_ENV',                          // the input to `isStrict`; checking it against itself proves nothing
  'PORT',                              // a bad value fails loudly at `listen`, which is soon enough
  'LOG_LEVEL',                         // pino falls back to `info` on a name it does not know
  'JWT_ACCESS_TTL',                    // a bad span throws in `jsonwebtoken` on the first login, visibly
  'DEV_PLAN_KEY',                      // already ignored-and-logged outside development/test (services/plans.ts)
  'COOKIE_SECURE',                     // envBool: warns and falls back to the safe direction
  'ENABLE_HSTS',                       // envBool: warns and falls back to off
  'UPLOAD_URL_TTL_SECONDS',            // envInt tunable
  'REFRESH_TOKEN_TTL_DAYS',            // envInt tunable
  'INVITATION_TTL_HOURS',              // envInt tunable
  'EMBED_JOB_ATTEMPTS',                // envInt tunable
  'EMBED_WORKER_CONCURRENCY',          // envInt tunable
  'WEBHOOK_JOB_ATTEMPTS',              // envInt tunable
  'WEBHOOK_BACKOFF_MS',                // envInt tunable
  'WEBHOOK_WORKER_CONCURRENCY',        // envInt tunable
  'REDIS_KEY_PREFIX',                  // any string works; the default is `vuepdf`
  'PDF_STORAGE_REGION',                // only meaningful with the s3 driver, which the SDK validates
  'PDF_STORAGE_ENDPOINT',              // optional; unset means the provider's default
  'PDF_STORAGE_ACCESS_KEY_ID',         // optional; unset means the SDK's credential chain
  'PDF_STORAGE_SECRET_ACCESS_KEY',     // optional; pairs with the line above
  'PDF_STORAGE_PREFIX',                // optional key prefix
  'PDF_STORAGE_FORCE_PATH_STYLE',      // envBool tunable
  'RATE_LIMIT_LOGIN_WINDOW_MS',        // envInt tunable
  'RATE_LIMIT_LOGIN_MAX',              // envInt tunable
  'RATE_LIMIT_REGISTER_WINDOW_MS',     // envInt tunable
  'RATE_LIMIT_REGISTER_MAX',           // envInt tunable
  'RATE_LIMIT_REFRESH_WINDOW_MS',      // envInt tunable
  'RATE_LIMIT_REFRESH_MAX',            // envInt tunable
  'RATE_LIMIT_INVITATION_WINDOW_MS',   // envInt tunable
  'RATE_LIMIT_INVITATION_MAX',         // envInt tunable
  'RATE_LIMIT_API_WINDOW_MS',          // envInt tunable
  'RATE_LIMIT_API_MAX',                // envInt tunable
  'RATE_LIMIT_RESPONSES_WINDOW_MS',    // envInt tunable
  'RATE_LIMIT_RESPONSES_MAX',          // envInt tunable
  'RATE_LIMIT_EXPORT_WINDOW_MS',       // envInt tunable
  'RATE_LIMIT_EXPORT_MAX',             // envInt tunable
  'TEST_REDIS_URL',                    // read by a spec, never by src
  'TEST_DATABASE_URL'                  // read by the integration harness, never by src
]

/**
 * Every problem with `env`, as messages an operator can act on without opening
 * this repository.
 *
 * **All of them, not the first.** A deploy missing three variables must learn
 * all three from one restart; discovering them one container start at a time is
 * how a ten-minute fix becomes an afternoon.
 *
 * Each message names the variable, what was expected, and — this is the part
 * that earns its length — what goes wrong if it is left as it is. The voice is
 * the one `services/pdf-storage.ts` already uses when it refuses to boot.
 */
export function validateEnv(env: NodeJS.ProcessEnv, role: ProcessRole): string[] {
  const problems: string[] = []
  const strict = isStrict(env)

  // ---------------------------------------------------------------------
  // Required when strict. Both processes.
  //
  // `JWT_SECRET` is required for the worker too, although nothing on the
  // worker's path signs anything today. The two processes are the same image
  // reading the same environment, and a rule that holds for one and not the
  // other produces the worst possible outcome: an environment that boots the
  // worker and then fails the API, discovered one deploy later.
  // ---------------------------------------------------------------------
  const jwtSecret = value(env, 'JWT_SECRET')
  if (strict && !jwtSecret) {
    problems.push(
      'JWT_SECRET is missing. It signs access tokens and derives the key for ' +
      'signed PDF URLs; without it nothing can authenticate.'
    )
  } else if (strict && jwtSecret && jwtSecret.length < 32) {
    problems.push(
      `JWT_SECRET is ${jwtSecret.length} characters; expected at least 32. ` +
      'A short secret is guessable offline, and every session and PDF link in ' +
      'the deployment rests on it.'
    )
  }

  const databaseUrl = value(env, 'DATABASE_URL')
  if (strict && !databaseUrl) {
    problems.push(
      'DATABASE_URL is missing. Prisma reads it from the environment ' +
      '(prisma/schema.prisma), so the first query fails rather than the boot.'
    )
  } else if (databaseUrl) {
    const scheme = databaseUrl.split(':')[0]
    if (scheme !== 'postgresql' && scheme !== 'postgres') {
      problems.push(
        `DATABASE_URL has scheme "${scheme}"; expected postgresql or postgres. ` +
        'This application is PostgreSQL-only — the row locks the plan limits ' +
        'depend on do not exist elsewhere.'
      )
    }
  }

  // ---------------------------------------------------------------------
  // Required when strict, API only.
  //
  // The worker mints no URLs: `services/pdf-embed.ts` reads `form.pdfUrl` and
  // calls `pdfFilenameFrom`, which parses rather than builds, and no worker
  // path renders an invitation link or a Stripe return URL. Requiring these of
  // the worker would fail a correct deployment.
  // ---------------------------------------------------------------------
  if (role === 'api') {
    const baseUrl = value(env, 'BASE_URL')
    if (strict && !baseUrl) {
      problems.push(
        'BASE_URL is missing. services/pdf-url.ts falls back to ' +
        'http://localhost:3000, so every signed PDF link points at the ' +
        "container's own loopback and no uploaded document is reachable — " +
        'with no error anywhere.'
      )
    } else if (baseUrl) {
      const problem = urlProblem('BASE_URL', baseUrl, 'https://api.example.com')
      if (problem) {
        problems.push(problem)
      } else if (baseUrl.endsWith('/')) {
        problems.push(
          'BASE_URL ends with "/". services/pdf-url.ts concatenates it with ' +
          '"/uploads/pdfs/...", so a trailing slash produces a double slash in ' +
          'every signed link.'
        )
      }
    }

    const frontendUrl = value(env, 'FRONTEND_URL')
    if (strict && !frontendUrl) {
      problems.push(
        'FRONTEND_URL is missing. It is the CORS origin, the CSRF origin check ' +
        'and the base of every invitation and Stripe return link; the fallback ' +
        'is http://localhost:5173, which rejects the real SPA.'
      )
    } else if (frontendUrl) {
      const problem = urlProblem('FRONTEND_URL', frontendUrl, 'https://app.example.com')
      if (problem) problems.push(problem)
    }

    // Not required — the default of 0 is safe and documented — but a value
    // that cannot be read at all is worth saying out loud, because this is the
    // variable that decides whether a rate limiter identifies the client.
    const hops = value(env, 'TRUST_PROXY_HOPS')
    if (hops !== undefined && !/^\d+$/.test(hops)) {
      problems.push(
        `TRUST_PROXY_HOPS="${hops}" is not a non-negative integer. It is the ` +
        'number of proxies in front of this process and it decides what req.ip ' +
        'is; a value that cannot be read leaves every request behind the ' +
        "balancer sharing one limit."
      )
    }
  }

  // ---------------------------------------------------------------------
  // Shape errors. Checked in every environment, including development —
  // these are not missing values, they are values that cannot work, and a
  // developer benefits from hearing about them as much as a deployment does.
  // ---------------------------------------------------------------------
  const driver = value(env, 'PDF_STORAGE_DRIVER') ?? 'local'
  if (driver !== 'local' && driver !== 's3') {
    problems.push(
      `PDF_STORAGE_DRIVER="${driver}" is not a driver. Expected "local" or "s3".`
    )
  } else if (driver === 's3' && !value(env, 'PDF_STORAGE_BUCKET')) {
    problems.push(
      'PDF_STORAGE_DRIVER=s3 requires PDF_STORAGE_BUCKET. Falling back to local ' +
      'disk would accept uploads and lose them on the next deploy.'
    )
  }

  const signingKey = value(env, 'WEBHOOK_SIGNING_KEY')
  if (signingKey !== undefined && Buffer.from(signingKey, 'base64').length !== 32) {
    problems.push(
      `WEBHOOK_SIGNING_KEY decodes to ${Buffer.from(signingKey, 'base64').length} ` +
      'bytes; expected exactly 32 bytes of base64. services/webhooks.ts treats a ' +
      'wrong-length key as absent, so webhook delivery switches itself off ' +
      'silently and endpoints can no longer be configured.'
    )
  }

  // Same shape as `WEBHOOK_SIGNING_KEY` above, and for the same reason
  // (features/0034). The variable is **optional** — unset means error tracking
  // is off, which is a deployment with less visibility rather than a broken
  // one — but a value that is *present and unusable* is a different thing.
  //
  // The SDK does not throw on a malformed DSN: it logs to its own debug channel
  // and disables itself, so the process boots, serves, reports success and
  // sends nothing. That was verified rather than assumed — an API started with
  // `SENTRY_DSN=totally-not-a-dsn` produced no error on any path anybody
  // watches. It is precisely the failure this feature exists to remove, so it
  // is caught here instead.
  //
  // Checked in every environment, like the other shape errors: a typo is not a
  // missing value, and a developer benefits from hearing about it too.
  const sentryDsn = value(env, 'SENTRY_DSN')
  if (sentryDsn !== undefined) {
    let parsed: URL | null = null
    try {
      parsed = new URL(sentryDsn)
    } catch {
      parsed = null
    }

    if (!parsed || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) {
      problems.push(
        `SENTRY_DSN="${sentryDsn}" is not a DSN. Expected ` +
        'https://<key>@<host>/<projectId>. The SDK does not reject a bad one — ' +
        'it disables itself quietly — so the process would boot, look ' +
        'instrumented and report nothing.'
      )
    }
  }

  const redisUrl = value(env, 'REDIS_URL')
  if (redisUrl !== undefined) {
    const scheme = redisUrl.split(':')[0]
    if (scheme !== 'redis' && scheme !== 'rediss') {
      problems.push(
        `REDIS_URL has scheme "${scheme}"; expected redis or rediss. An ` +
        'unusable value here is read as "a queue is configured", so the API ' +
        'stops embedding inline and no worker can pick the jobs up.'
      )
    }
  }

  // ---------------------------------------------------------------------
  // Registration (features/0033). Checked for **both** roles, although the
  // worker registers nobody — the same argument JWT_SECRET makes above: the
  // two processes are one image reading one environment, and a rule that
  // holds for one and not the other produces an environment that boots the
  // worker and then fails the API, one deploy later.
  //
  // `config/registration.ts` defaults an unset mode to `open`. That default
  // is only safe because of the strict check here: without it a production
  // deploy that forgot the variable would run an open beta and nothing would
  // say so. The pair is the whole mechanism, so neither half may be removed
  // without the other.
  // ---------------------------------------------------------------------
  const registrationMode = value(env, 'REGISTRATION_MODE')

  if (strict && !registrationMode) {
    problems.push(
      'REGISTRATION_MODE is missing. It decides whether POST /api/auth/register ' +
      'accepts new accounts from the open internet; unset means "open", so a ' +
      'deployment running a private beta would quietly let anybody sign up. Set ' +
      'it to "open" or "invite_only" explicitly.'
    )
  } else if (registrationMode !== undefined && !REGISTRATION_MODES.includes(registrationMode as RegistrationMode)) {
    // A shape error, so it is checked in every environment: a typo like
    // "inviteonly" is not a missing value, it is a value that cannot work.
    problems.push(
      `REGISTRATION_MODE="${registrationMode}" is not a mode. Expected "open" or ` +
      '"invite_only".'
    )
  }

  if (registrationMode === 'invite_only') {
    const code = value(env, 'REGISTRATION_CODE')

    if (!code) {
      problems.push(
        'REGISTRATION_MODE=invite_only requires REGISTRATION_CODE. Without it no ' +
        'code can ever match, so registration is closed with no way back in ' +
        'short of another deploy — which is the one thing this switch exists to ' +
        'avoid.'
      )
    } else if (code.length < MIN_CODE_LENGTH) {
      problems.push(
        `REGISTRATION_CODE is ${code.length} characters; expected at least ` +
        `${MIN_CODE_LENGTH}. It is a shared secret sent by email and guessed ` +
        'through the register rate limiter, so a short one is a word somebody ' +
        'picked rather than a credential.'
      )
    }
  }

  // ---------------------------------------------------------------------
  // Stripe, as a group. Nothing here is required — all four are optional and
  // unset means billing is off, answering 503 — but a half-configured Stripe
  // is worse than none, and both halves fail invisibly.
  // ---------------------------------------------------------------------
  if (role === 'api' && value(env, 'STRIPE_SECRET_KEY')) {
    if (!value(env, 'STRIPE_WEBHOOK_SECRET')) {
      problems.push(
        'STRIPE_SECRET_KEY is set without STRIPE_WEBHOOK_SECRET. Nothing grants ' +
        'a plan except the webhook, and without the secret every event fails ' +
        'signature verification and answers 400 — so subscriptions are paid for ' +
        'and never activated, with no error in this log.'
      )
    }

    if (!value(env, 'STRIPE_PRICE_PRO') && !value(env, 'STRIPE_PRICE_TEAM')) {
      problems.push(
        'STRIPE_SECRET_KEY is set but neither STRIPE_PRICE_PRO nor ' +
        'STRIPE_PRICE_TEAM is. A subscription on a price this deployment does ' +
        'not recognise resolves the organization to free, deliberately — so a ' +
        'customer who has paid lands on the free plan.'
      )
    }
  }

  return problems
}

/**
 * Validate `process.env` for this process, or refuse to start.
 *
 * Called from `src/index.ts` and `src/worker.ts` after `dotenv.config()`.
 * `process.exit(1)` rather than a thrown error: this runs before anything is
 * listening, there is nothing to unwind, and an exit code is what a process
 * manager reads.
 */
export function assertEnv(role: ProcessRole): void {
  const problems = validateEnv(process.env, role)
  if (problems.length === 0) return

  logger.error(
    { role, count: problems.length, strict: isStrict(process.env) },
    `[${role}] refusing to start: ${problems.length} configuration problem(s)`
  )
  for (const problem of problems) logger.error(`  - ${problem}`)

  process.exit(1)
}
