import { rateLimit, ipKeyGenerator, MemoryStore, MINUTE, HOUR, type Store } from 'express-rate-limit'
import type { Request, RequestHandler } from 'express'
import { RedisStore } from 'rate-limit-redis'
import { envInt } from '../config/env.js'
import { connectRedis, isRedisConfigured, keyPrefix, type Redis } from '../services/redis.js'
import type { ApiKeyRequest } from './apiKeyAuth.js'

// Rate limiters for the unauthenticated write paths. These are the whole of the
// external attack surface that costs an attacker nothing: credential stuffing
// against `POST /api/auth/login`, unbounded account creation (and unbounded
// bcrypt) against `POST /api/auth/register`, and unbounded garbage into any
// published form via `POST /api/responses`.
//
// Each limiter is applied at its route, next to the handler it guards, the same
// way `authenticate` is — see docs/sot/04-backend-patterns.md §2. Nothing here
// is mounted globally: the authenticated editor legitimately bursts (a bulk
// field save, a PDF upload), and a global number that does not break it would be
// a guess.

// Every limiter keeps its own store so that resetting one in a test cannot hide
// a leak between the others - and, on Redis, so that a burst of form
// submissions cannot consume somebody's login budget (features/0018).
const stores: { store: Store; prefix: string }[] = []

/**
 * The connection the limiter store uses, or `null` when there is no Redis.
 *
 * One connection for all five limiters: they issue one short `EVAL` per request
 * and there is nothing to gain from five sockets. It is built lazily and
 * memoised, and `services/redis.ts` is what decides how it behaves when Redis
 * is unreachable - which for this role is the difference between a slow login
 * and one that never answers at all.
 */
let clientPromise: Promise<Redis> | null = null

function rateLimitClient(): Promise<Redis> {
  if (!clientPromise) {
    clientPromise = connectRedis('rate-limit').catch(error => {
      clientPromise = null
      throw error
    })
  }

  return clientPromise
}

/**
 * The five limiters this application has, by name.
 *
 * Named rather than anonymous because the name is what the store keys on: each
 * limiter counts separately, so a burst of form submissions cannot consume
 * somebody's login budget (features/0018).
 */
export type LimiterName = 'login' | 'register' | 'refresh' | 'invitation' | 'responses' | 'api'

interface LimiterConfig {
  /** Environment variable holding the window length, in milliseconds. */
  windowEnv: string
  windowDefault: number
  /** Environment variable holding the maximum requests per window. */
  limitEnv: string
  limitDefault: number
  /** Shown to the user. It must say what to do, not just that they failed. */
  message: string
  /**
   * When true, a request that succeeded is refunded. Used for login so that a
   * person working normally cannot exhaust their own budget — the limit should
   * bite on failed attempts.
   */
  skipSuccessfulRequests?: boolean
  /**
   * What identity the count belongs to. Defaults to the client address, which
   * is right for a browser and wrong for a machine — see `api` below.
   */
  keyBy?: (req: Request) => string
}

const LIMITERS: Record<LimiterName, LimiterConfig> = {
  /** `POST /api/auth/login` - brute force and credential stuffing. */
  login: {
    windowEnv: 'RATE_LIMIT_LOGIN_WINDOW_MS',
    windowDefault: 15 * MINUTE,
    limitEnv: 'RATE_LIMIT_LOGIN_MAX',
    limitDefault: 10,
    skipSuccessfulRequests: true,
    message: 'Too many failed login attempts. Please wait a few minutes and try again.'
  },

  /** `POST /api/auth/register` - account spam, and bcrypt as a CPU sink. */
  register: {
    windowEnv: 'RATE_LIMIT_REGISTER_WINDOW_MS',
    windowDefault: 1 * HOUR,
    limitEnv: 'RATE_LIMIT_REGISTER_MAX',
    limitDefault: 5,
    message: 'Too many accounts created from this address. Please try again later.'
  },

  /**
   * `POST /api/auth/refresh` - unauthenticated by definition: the only
   * credential it takes is the cookie it is there to validate. Without a limit
   * it is a free oracle for guessing refresh tokens, and every miss costs a
   * database lookup. The limit is generous because a legitimate tab refreshes
   * on a timer.
   */
  refresh: {
    windowEnv: 'RATE_LIMIT_REFRESH_WINDOW_MS',
    windowDefault: 15 * MINUTE,
    limitEnv: 'RATE_LIMIT_REFRESH_MAX',
    limitDefault: 60,
    message: 'Too many session refreshes from this address. Please try again in a few minutes.'
  },

  /**
   * `POST /api/organizations/invitations/accept` - unauthenticated by design,
   * and it grants access to a customer's organization. Without a limit it is a
   * free oracle for guessing invitation tokens.
   */
  invitation: {
    windowEnv: 'RATE_LIMIT_INVITATION_WINDOW_MS',
    windowDefault: 15 * MINUTE,
    limitEnv: 'RATE_LIMIT_INVITATION_MAX',
    limitDefault: 20,
    message: 'Too many invitation attempts from this address. Please try again in a few minutes.'
  },

  /**
   * `/api/v1/*` - the published API (features/0019).
   *
   * **Keyed on the API key, not on the address**, which is the one limiter here
   * that is not per-IP and the reason `keyBy` exists. A customer's integration
   * calls from one server, so a per-IP limit would be a per-customer limit by
   * accident and would collapse the moment two customers sat behind the same
   * NAT or the same cloud egress address.
   *
   * The fallback matters as much as the rule: a request with **no** valid key
   * has no id to count against, so it falls back to the address. Without that,
   * an attacker gets an unlimited budget simply by not authenticating - the
   * cheapest possible bypass.
   *
   * The number is generous because it is *published* (see
   * docs/sot/06-api-reference.md): a limit an integration trips over during
   * normal use is a support ticket, and this exists to stop a runaway loop
   * rather than to ration.
   */
  api: {
    windowEnv: 'RATE_LIMIT_API_WINDOW_MS',
    windowDefault: 1 * MINUTE,
    limitEnv: 'RATE_LIMIT_API_MAX',
    limitDefault: 120,
    keyBy: (req: Request) => {
      // `apiKey` is set by `middleware/apiKeyAuth.ts`, which runs before this
      // limiter on the same router.
      const keyId = (req as ApiKeyRequest).apiKey?.id
      // `ipKeyGenerator` rather than `req.ip`: it normalises IPv6 to a subnet,
      // which is what the library's own default does and what stops one client
      // rotating through addresses inside its /56.
      return keyId ? `key:${keyId}` : `ip:${ipKeyGenerator(req.ip ?? '')}`
    },
    message: 'Too many API requests. Slow down and try again shortly.'
  },

  /** `POST /api/responses` - garbage submissions into a published form. */
  responses: {
    windowEnv: 'RATE_LIMIT_RESPONSES_WINDOW_MS',
    windowDefault: 10 * MINUTE,
    limitEnv: 'RATE_LIMIT_RESPONSES_MAX',
    limitDefault: 20,
    message: 'Too many submissions from this address. Please try again in a few minutes.'
  }
}

/**
 * Builds one limiter by name, **on its first request rather than at import**.
 *
 * The laziness is load-bearing and not a style choice. `src/app.ts` calls
 * `dotenv.config()` in its body, but ES module imports are evaluated first, so
 * this module runs before `backend/.env` has been read: choosing a store at
 * import time would ignore a developer's `REDIS_URL` entirely and silently use
 * the memory store, which is the sort of difference between environments that
 * takes a day to find. Deferring to the first request also lets a test set
 * `REDIS_URL` in a `beforeEach` and get the store it asked for.
 *
 * Exported for `tests/integration/rate-limit-store.spec.ts`, which builds two
 * of the same limiter to stand in for two replicas - the only way to show, in
 * one process, that the count is shared rather than per-process.
 */
export function buildRateLimiter(name: LimiterName): RequestHandler {
  let delegate: RequestHandler | null = null

  return (req, res, next) => {
    delegate ??= createLimiter(name)
    return delegate(req, res, next)
  }
}

/**
 * Picks the store for this deployment.
 *
 * **`REDIS_URL` unset means the memory store, and that stays correct**: it is
 * what a single-replica deployment wants, it is what every suite runs on, and
 * it is the rollback for this feature. What must never happen is the *other*
 * degradation - a deployment that configured Redis, lost it, and quietly went
 * back to counting per process. See `passOnStoreError` below.
 */
function createStore(name: LimiterName): { store: Store; prefix: string } {
  if (!isRedisConfigured()) {
    announceStore('in-memory (per process; correct at one replica, and the limit multiplies by replica count above that)')
    const store = new MemoryStore()
    return { store, prefix: '' }
  }

  announceStore('Redis (shared across every replica)')

  // One namespace per limiter, under the application-wide prefix. Sharing a
  // namespace would let a burst of public form submissions exhaust the login
  // limit for every user of that address.
  const prefix = `${keyPrefix()}:rl:${name}:`

  const store = new RedisStore({
    prefix,
    // `call` is ioredis' raw-command escape hatch, which is exactly what this
    // store wants: it sends `EVAL` itself.
    sendCommand: async (...args: string[]) => {
      const client = await rateLimitClient()
      return client.call(args[0] as string, ...args.slice(1)) as Promise<never>
    }
  })

  return { store, prefix }
}

/**
 * Says once, in the log, which store this process ended up with.
 *
 * Which store is in force is a security-relevant property of a deployment, and
 * "read the environment of the container" is not an answer anybody has at 3am.
 * Once rather than per limiter, because five identical lines are noise.
 */
let announced = false

function announceStore(description: string): void {
  if (announced) return
  announced = true
  console.log(`Rate limiting is counting in ${description}`)
}

function createLimiter(name: LimiterName): RequestHandler {
  const config = LIMITERS[name]
  const entry = createStore(name)
  stores.push(entry)

  return rateLimit({
    // The window is fixed at startup; the limit is read per request. That is
    // what lets the tests drive a limiter through the same configuration path
    // production uses, instead of reaching inside it to change its numbers.
    windowMs: envInt(config.windowEnv, config.windowDefault),
    limit: () => envInt(config.limitEnv, config.limitDefault),

    store: entry.store,
    skipSuccessfulRequests: config.skipSuccessfulRequests ?? false,
    ...(config.keyBy ? { keyGenerator: config.keyBy } : {}),

    // **A store that errors rejects the request; it does not wave it through.**
    // The default, made explicit because it is the security decision this
    // feature turns on and it must not be changed by accident.
    //
    // The alternative - `true` - means a Redis outage silently removes rate
    // limiting from every unauthenticated write path while every request keeps
    // answering 200. This way an outage is an outage: loud, immediate, and
    // recoverable in one step by emptying `REDIS_URL` and restarting, which
    // returns the process to per-instance limits rather than to none.
    // docs/sot/07-security-and-privacy.md carries the argument, to the same
    // standard as the webhook's missing limiter.
    passOnStoreError: false,

    // The library warns when a limiter is constructed inside a request handler,
    // because the usual way to do that is by accident - a new limiter per
    // request counts nothing. That is not what happens here: `buildRateLimiter`
    // constructs exactly one and reuses it for the life of the process, and the
    // deferral exists only so the store is chosen after `dotenv.config()` has
    // run (see `buildRateLimiter`). The check cannot tell the two apart, so it
    // is turned off deliberately and only this one.
    validate: { creationStack: false },

    // `standardHeaders` also drives `Retry-After`, which is the only part of the
    // response a client can act on programmatically.
    standardHeaders: 'draft-8',
    legacyHeaders: false,

    // An object, not a string. The library's default handler passes this to
    // `res.send`, so an object is serialized as JSON — and it has to be JSON in
    // this API's `{ error }` shape, because `frontend/src/services/api.ts` calls
    // `await response.json()` before it checks `response.ok`. A plain-string body
    // makes that throw a SyntaxError instead of an ApiError, and the user is told
    // nothing useful.
    message: { error: config.message }
  })
}

export const loginRateLimit = buildRateLimiter('login')
export const registerRateLimit = buildRateLimiter('register')
export const refreshRateLimit = buildRateLimiter('refresh')
export const invitationRateLimit = buildRateLimiter('invitation')
export const responseRateLimit = buildRateLimiter('responses')
export const apiRateLimit = buildRateLimiter('api')

/**
 * Clears every limiter's hit counts. For tests only — the suites share one
 * `app`, so without this a limiter's state leaks from one test into the next.
 */
export async function resetRateLimitStores(): Promise<void> {
  await Promise.all(
    stores.map(async ({ store, prefix }) => {
      // `MemoryStore` has `resetAll`. **`RedisStore` (rate-limit-redis 6) does
      // not** - it implements `resetKey` only - so the Redis path needs its own
      // sweep, and assuming otherwise would have failed only in the one spec
      // that uses it.
      if (typeof store.resetAll === 'function') {
        await store.resetAll()
        return
      }

      const client = await rateLimitClient()
      const keys = await client.keys(`${prefix}*`)
      if (keys.length > 0) await client.del(...keys)
    })
  )
}

/**
 * Closes the limiter's Redis connection and forgets every store.
 *
 * For tests and for shutdown. The stores are dropped as well as closed, because
 * a store holding a closed connection is worse than no store.
 */
export async function closeRateLimitStore(): Promise<void> {
  const pending = clientPromise
  clientPromise = null
  stores.length = 0

  if (!pending) return

  try {
    const client = await pending
    await client.quit().catch(() => client.disconnect())
  } catch {
    // It never connected; nothing to close.
  }
}
