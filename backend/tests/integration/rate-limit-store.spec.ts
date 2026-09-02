import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import {
  buildRateLimiter,
  resetRateLimitStores,
  closeRateLimitStore
} from '../../src/middleware/rateLimit.js'

/**
 * The whole point of features/0018: **the limit belongs to the service, not to
 * the replica that happened to answer.**
 *
 * `REDIS_URL` is pinned empty in both vitest configs, so every other spec -
 * `tests/rate-limit.spec.ts` included - exercises the in-memory store, which is
 * correct for a single-replica deployment and is what this repository has always
 * run. That leaves the interesting property untested, and this file covers it
 * against a real Redis. It **skips itself unless `TEST_REDIS_URL` is set**, the
 * same arrangement `tests/integration/pdf-embed-queue.spec.ts` uses and for the
 * same reason: `npm run test:integration` must stay runnable offline.
 *
 * Two limiters built independently stand in for two API replicas. That is an
 * honest model of the thing under test - what makes a replica separate here is
 * that it has its own limiter object with its own store, which is exactly what
 * two `buildRateLimiter` calls produce - and it is the only version of this that
 * can run in one process. The `npm run dev` two-port check in the spec's
 * execution prompt is the end-to-end confirmation.
 *
 * Against the `MemoryStore` implementation this file fails on its first
 * assertion, which is the point: each limiter counts alone, so the second one
 * lets through a request the first had already exhausted.
 */
const TEST_REDIS_URL = process.env.TEST_REDIS_URL?.trim()

describe.skipIf(!TEST_REDIS_URL)('the rate-limit store is shared', { timeout: 60_000 }, () => {
  /**
   * The probe answers 200, so the limiter under test must **not** be `login`.
   *
   * Login carries `skipSuccessfulRequests`, which refunds a hit whose response
   * succeeded - deliberately, so that somebody working normally cannot exhaust
   * their own budget. A probe that returns 200 therefore never accumulates
   * anything and the limiter never bites, which is what the first draft of this
   * file measured: it failed for the right reason and for a wrong one at the
   * same time. `responses` and `register` have no refund, so a 200 counts.
   */

  /** A minimal app carrying one limiter, standing in for one replica. */
  function replica(limiter: express.RequestHandler) {
    const app = express()
    app.post('/probe', limiter, (_req, res) => {
      res.status(200).json({ ok: true })
    })
    return app
  }

  beforeEach(async () => {
    process.env.REDIS_URL = TEST_REDIS_URL
    // Namespaced away from anything else in this Redis, and from a real local
    // run of the application.
    process.env.REDIS_KEY_PREFIX = `vuepdf-test-${process.pid}-${Date.now()}`
    process.env.RATE_LIMIT_RESPONSES_MAX = '2'
    process.env.RATE_LIMIT_REGISTER_MAX = '2'
    await resetRateLimitStores()
  })

  afterEach(async () => {
    await resetRateLimitStores()
    await closeRateLimitStore()
    delete process.env.REDIS_URL
    delete process.env.REDIS_KEY_PREFIX
    delete process.env.RATE_LIMIT_RESPONSES_MAX
    delete process.env.RATE_LIMIT_REGISTER_MAX
  })

  it('counts a client once across two independently built limiters', async () => {
    const one = replica(buildRateLimiter('responses'))
    const two = replica(buildRateLimiter('responses'))

    // Two requests to the first replica: the limit is 2, so both pass.
    expect((await request(one).post('/probe')).status).toBe(200)
    expect((await request(one).post('/probe')).status).toBe(200)

    // The third request goes to the *other* replica. With a per-process store
    // this is a fresh counter and answers 200 - the bug this feature closes,
    // where the effective limit is the configured one times the replica count.
    const third = await request(two).post('/probe')
    expect(third.status).toBe(429)
    expect(third.headers['content-type']).toMatch(/application\/json/)
    expect(third.body).toHaveProperty('error')
  })

  it('gives each limiter its own counter, so one cannot exhaust another', async () => {
    const responses = replica(buildRateLimiter('responses'))
    const register = replica(buildRateLimiter('register'))

    // Exhaust the submission limiter (limit 2).
    await request(responses).post('/probe')
    await request(responses).post('/probe')
    expect((await request(responses).post('/probe')).status).toBe(429)

    // The registration limiter is untouched: a burst of form submissions must
    // not consume anybody else's budget, which is what one shared key would do.
    expect((await request(register).post('/probe')).status).toBe(200)
  })

  it('keeps counting across a restart, unlike the in-memory store', async () => {
    const before = replica(buildRateLimiter('responses'))
    await request(before).post('/probe')
    await request(before).post('/probe')

    // A new limiter with a new store, as a redeployed process would have. The
    // count is in Redis, so it survives - which is the fix, and also the reason
    // 08-operations has to say how to clear a locked-out identity, because
    // restarting the API no longer does it.
    await closeRateLimitStore()
    const after = replica(buildRateLimiter('responses'))

    expect((await request(after).post('/probe')).status).toBe(429)
  })
})
