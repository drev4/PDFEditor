import { rateLimit, MemoryStore, MINUTE, HOUR } from 'express-rate-limit'
import { envInt } from '../config/env.js'

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
// a leak between the others.
const stores: MemoryStore[] = []

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
}

function createLimiter(config: LimiterConfig) {
  const store = new MemoryStore()
  stores.push(store)

  return rateLimit({
    // The window is fixed at startup; the limit is read per request. That is
    // what lets the tests drive a limiter through the same configuration path
    // production uses, instead of reaching inside it to change its numbers.
    windowMs: envInt(config.windowEnv, config.windowDefault),
    limit: () => envInt(config.limitEnv, config.limitDefault),

    store,
    skipSuccessfulRequests: config.skipSuccessfulRequests ?? false,

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

/** `POST /api/auth/login` — brute force and credential stuffing. */
export const loginRateLimit = createLimiter({
  windowEnv: 'RATE_LIMIT_LOGIN_WINDOW_MS',
  windowDefault: 15 * MINUTE,
  limitEnv: 'RATE_LIMIT_LOGIN_MAX',
  limitDefault: 10,
  skipSuccessfulRequests: true,
  message: 'Too many failed login attempts. Please wait a few minutes and try again.'
})

/** `POST /api/auth/register` — account spam, and bcrypt as a CPU sink. */
export const registerRateLimit = createLimiter({
  windowEnv: 'RATE_LIMIT_REGISTER_WINDOW_MS',
  windowDefault: 1 * HOUR,
  limitEnv: 'RATE_LIMIT_REGISTER_MAX',
  limitDefault: 5,
  message: 'Too many accounts created from this address. Please try again later.'
})

/**
 * `POST /api/auth/refresh` — unauthenticated by definition: the only credential
 * it takes is the cookie it is there to validate. Without a limit it is a free
 * oracle for guessing refresh tokens, and every miss costs a database lookup.
 * The limit is generous because a legitimate tab refreshes on a timer.
 */
export const refreshRateLimit = createLimiter({
  windowEnv: 'RATE_LIMIT_REFRESH_WINDOW_MS',
  windowDefault: 15 * MINUTE,
  limitEnv: 'RATE_LIMIT_REFRESH_MAX',
  limitDefault: 60,
  message: 'Too many session refreshes from this address. Please try again in a few minutes.'
})

/** `POST /api/responses` — garbage submissions into a published form. */
export const responseRateLimit = createLimiter({
  windowEnv: 'RATE_LIMIT_RESPONSES_WINDOW_MS',
  windowDefault: 10 * MINUTE,
  limitEnv: 'RATE_LIMIT_RESPONSES_MAX',
  limitDefault: 20,
  message: 'Too many submissions from this address. Please try again in a few minutes.'
})

/**
 * Clears every limiter's hit counts. For tests only — the suites share one
 * `app`, so without this a limiter's state leaks from one test into the next.
 */
export async function resetRateLimitStores(): Promise<void> {
  await Promise.all(stores.map(store => store.resetAll()))
}
