import type { Redis } from 'ioredis'

// Re-exported so that not even a *type* import of `ioredis` is needed anywhere
// else. The library stays one module's business, whichever way it is referred
// to.
export type { Redis }

/**
 * The one place a Redis connection is made (features/0018).
 *
 * Same rule as `services/pdf-storage.ts` for PDF bytes and `services/stripe.ts`
 * for the Stripe SDK (docs/sot/04-backend-patterns.md §8): **nothing else in
 * this repository imports `ioredis`.** Two subsystems now need a connection -
 * the embed queue (features/0017) and the rate limiters (features/0018) - and
 * the reason they share this module is not tidiness. It is that *how* a client
 * is configured differs per role in a way that is easy to get wrong and was got
 * wrong once already, and a second `new IORedis(...)` elsewhere would copy the
 * easy half of that knowledge and leave the hard half behind.
 *
 * ## The bug this module exists to not have again
 *
 * `services/embed-queue.ts` built every client with `maxRetriesPerRequest: null`
 * - which BullMQ's worker genuinely requires, because its blocking commands sit
 * on a connection for minutes at a time and ioredis' default would kill them as
 * failed requests. But ioredis' default `retryStrategy` never gives up either,
 * so on the connection the **request path** used, the two together meant a
 * command waited for a connection that might never arrive.
 *
 * A Redis that *refuses* the TCP connection is not the dangerous case; that
 * errors quickly. A Redis that is simply unreachable - a wrong host, a dropped
 * route, a security group - refuses nothing, so the command never settled and
 * `POST /api/forms/:formId/fields/bulk` never answered. Found by
 * `saas-readiness-reviewer`, fixed in features/0017, and worth restating here
 * because the rate limiters put a Redis command in front of **login**: the same
 * mistake there does not slow the site down, it hangs authentication with no
 * error anywhere.
 */

/**
 * What a connection is for. It decides the failure behaviour, and nothing else.
 *
 * - `worker` — BullMQ's worker connection. The **only** role that may wait
 *   indefinitely, because that is what its blocking commands do on purpose.
 * - `producer` — enqueuing from inside a request.
 * - `locks` — the per-form lock a job takes. A wedged `SET`/`EVAL` here would
 *   hold a worker slot for ever with no error and no `EMBED GAVE UP` log, which
 *   is worse than the dead-worker failure that feature designed its logging
 *   around. Failing the job hands it to BullMQ's retries instead.
 * - `rate-limit` — the limiter store, consulted on every login, registration
 *   and public submission. The most latency-sensitive of the four.
 */
export type RedisRole = 'worker' | 'producer' | 'locks' | 'rate-limit'

/** The configured Redis, or `undefined` when this deployment has none. */
export function redisUrl(): string | undefined {
  return process.env.REDIS_URL?.trim() || undefined
}

/** Whether this process has a Redis behind it at all. */
export function isRedisConfigured(): boolean {
  return redisUrl() !== undefined
}

/**
 * Every key this application writes in Redis lives under one prefix, so a Redis
 * shared with something else stays legible - and so a developer pointing
 * `REDIS_URL` at a Redis another project is already using cannot collide with
 * it.
 *
 * Read per call rather than memoised into a constant, for the same reason the
 * rate limits and `DEV_PLAN_KEY` are: a constant is fixed at import, which is
 * before any test can set it.
 */
export function keyPrefix(): string {
  return process.env.REDIS_KEY_PREFIX?.trim() || 'vuepdf'
}

/**
 * Connects for one role.
 *
 * `ioredis` is imported **only** when a connection is actually wanted, the same
 * way the S3 client and the Stripe client are built lazily: a deployment
 * without Redis - which includes every test run - should not pay for, or fail
 * on, a dependency it never uses.
 */
export async function connectRedis(role: RedisRole): Promise<Redis> {
  const url = redisUrl()
  if (!url) throw new Error('REDIS_URL is not set')

  const { default: IORedis } = await import('ioredis')

  if (role === 'worker') {
    return new IORedis(url, { maxRetriesPerRequest: null })
  }

  // Every other role: a command fails after a bounded number of attempts rather
  // than queueing for ever, while reconnection keeps trying so a blip recovers
  // on its own. See the module comment for what the unbounded version cost.
  return new IORedis(url, {
    maxRetriesPerRequest: 2,
    connectTimeout: 5_000,
    commandTimeout: 10_000
  })
}
