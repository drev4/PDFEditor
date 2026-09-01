import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import { app } from '../../src/app.js'
import { prisma } from '../../src/services/db.js'
import { createUser } from './helpers.js'
import { mintApiKey } from '../../src/services/api-key.js'
import { resetRateLimitStores } from '../../src/middleware/rateLimit.js'

/**
 * The published API's own limiter (features/0019).
 *
 * It is the only limiter in this application that does **not** count per IP,
 * and the two tests below are the two halves of why:
 *
 *   - A customer's integration calls from one server, so counting by address
 *     would make one customer's budget accidentally shared with anyone behind
 *     the same NAT or cloud egress address — and would let one customer's
 *     runaway loop throttle another's.
 *   - But a request with no valid key has no key to count against, and falling
 *     back to nothing would hand an attacker an unlimited budget in exchange for
 *     simply not authenticating. That is the cheapest imaginable bypass, so the
 *     fallback to the address is not a detail.
 *
 * Every request in this file is unauthenticated or authenticated in-process
 * against the same address, so the limits are driven through `process.env` the
 * way `tests/rate-limit.spec.ts` does it rather than by reaching into a limiter.
 */
describe('the /api/v1 rate limiter', () => {
  let alice: Awaited<ReturnType<typeof createUser>>
  let bob: Awaited<ReturnType<typeof createUser>>
  let aliceKey: string
  let bobKey: string

  beforeEach(async () => {
    vi.stubEnv('RATE_LIMIT_API_MAX', '3')

    alice = await createUser()
    bob = await createUser()
    // The API is a Team entitlement, and it is checked on every request.
    for (const org of [alice.organization.id, bob.organization.id]) {
      await prisma.organization.update({ where: { id: org }, data: { planKey: 'team' } })
    }
    aliceKey = (await mintApiKey({ organizationId: alice.organization.id, name: 'a' })).secret
    bobKey = (await mintApiKey({ organizationId: bob.organization.id, name: 'b' })).secret

    // The suites share one `app`, so counts leak between tests without this.
    await new Promise(resolve => setImmediate(resolve))
    await resetRateLimitStores()
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    await new Promise(resolve => setImmediate(resolve))
    await resetRateLimitStores()
  })

  function call(key: string) {
    return request(app).get('/api/v1/forms').set('Authorization', `Bearer ${key}`)
  }

  it('counts per API key, not per address', async () => {
    // Alice spends her budget. Same process, same address throughout.
    for (let i = 0; i < 3; i++) {
      expect((await call(aliceKey)).status).toBe(200)
    }
    const spent = await call(aliceKey)
    expect(spent.status).toBe(429)
    expect(spent.body).toHaveProperty('error')

    // Bob is a different customer on the same address, and is unaffected. With
    // a per-IP limiter this is a 429 and one customer has throttled another.
    expect((await call(bobKey)).status).toBe(200)
  })

  it('still limits a caller who does not authenticate at all', async () => {
    // No key: nothing to count against but the address. Every one of these is a
    // 401 — the point is that they are not *unlimited* 401s, because that would
    // be a free way to make this endpoint do work.
    const statuses: number[] = []
    for (let i = 0; i < 6; i++) {
      statuses.push((await request(app).get('/api/v1/forms')).status)
    }

    expect(statuses).toContain(429)
  })

  it('does not spend the API budget on the SPA\'s own endpoints', async () => {
    for (let i = 0; i < 3; i++) await call(aliceKey)
    expect((await call(aliceKey)).status).toBe(429)

    // A separate limiter with a separate namespace: the editor must not go down
    // because an integration is noisy.
    const internal = await request(app)
      .get('/api/forms')
      .set('Authorization', alice.authHeader)

    expect(internal.status).toBe(200)
    expect(await prisma.form.count({ where: { organizationId: alice.organization.id } })).toBe(0)
  })
})
