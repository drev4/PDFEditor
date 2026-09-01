import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { buildRateLimiter, closeRateLimitStore } from '../../src/middleware/rateLimit.js'

/**
 * `REDIS_URL` set, Redis not there (features/0018).
 *
 * Two questions, and they are different:
 *
 *   1. **Does the request still answer?** A limiter runs in front of
 *      `POST /api/auth/login`, so a Redis client that waits for a connection
 *      that never arrives does not slow the site down - it hangs
 *      authentication, with no error anywhere. That is not hypothetical: it is
 *      exactly what features/0017 shipped on the embed path and
 *      `saas-readiness-reviewer` caught, and `services/redis.ts` exists so the
 *      per-role options that fix it live in one place.
 *   2. **What does it answer?** `passOnStoreError: false` means a store error
 *      rejects the request rather than waving it through. The alternative would
 *      silently remove rate limiting from every unauthenticated write path for
 *      the duration of the outage, with a 200 on every request and nothing in
 *      the logs to say the control was gone.
 *
 * Neither needs a Redis, so **this file runs in CI** - unlike
 * `rate-limit-store.spec.ts` beside it, which needs a real one.
 */
describe('the rate limiter when Redis is configured but absent', { timeout: 60_000 }, () => {
  function probe(limiter: express.RequestHandler) {
    const app = express()
    app.post('/probe', limiter, (_req, res) => {
      res.status(200).json({ ok: true })
    })
    // The limiter surfaces a store failure as an error, and an app with no error
    // handler answers 500. `src/middleware/errorHandler.ts` does the same in the
    // real app: a failure here is a 5xx, never a silent success.
    return app
  }

  beforeEach(() => {
    process.env.REDIS_KEY_PREFIX = `vuepdf-test-${process.pid}-${Date.now()}`
  })

  afterEach(async () => {
    await closeRateLimitStore()
    delete process.env.REDIS_URL
    delete process.env.REDIS_KEY_PREFIX
  })

  it('still answers when the configured Redis refuses the connection', async () => {
    // Nothing listens on port 1: ECONNREFUSED, reported quickly.
    process.env.REDIS_URL = 'redis://127.0.0.1:1'

    const response = await request(probe(buildRateLimiter('responses'))).post('/probe')

    // Not a 200. The request was refused rather than let through, which is
    // `passOnStoreError: false` doing its job.
    expect(response.status).toBeGreaterThanOrEqual(429)
  })

  it('still answers, within seconds, when the configured Redis black-holes the connection', async () => {
    // 192.0.2.0/24 is TEST-NET-1 (RFC 5737): reserved for documentation and
    // guaranteed not to be routed, so the connection attempt hangs rather than
    // being refused. This is the shape that hung the embed enqueue in
    // features/0017; here it would hang login.
    process.env.REDIS_URL = 'redis://192.0.2.1:6379'

    const started = Date.now()
    const response = await request(probe(buildRateLimiter('login'))).post('/probe')
    const elapsed = Date.now() - started

    // The property under test is that it answers at all, and quickly. The
    // ceiling is deliberately far above the ~2s the bounded client actually
    // takes and far below the unbounded wait it replaced - an earlier version
    // of the connection options, with ioredis' offline queue left on, took 15s
    // per request during an outage.
    expect(response.status).toBeGreaterThanOrEqual(429)
    expect(elapsed).toBeLessThan(10_000)
  })

  it('does not let a request through just because the store failed', async () => {
    process.env.REDIS_URL = 'redis://127.0.0.1:1'

    const app = probe(buildRateLimiter('register'))

    // Ten attempts, all of which would have succeeded unlimited under
    // `passOnStoreError: true`. None of them may answer 200.
    for (let i = 0; i < 10; i++) {
      const response = await request(app).post('/probe')
      expect(response.status).not.toBe(200)
    }
  })
})
