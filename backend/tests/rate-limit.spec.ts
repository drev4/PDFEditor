import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { app } from '../src/app'
import { prisma } from '../src/services/db'
import { resetRateLimitStores } from '../src/middleware/rateLimit'
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import { PrismaClient } from '@prisma/client'

vi.mock('../src/services/db', async () => {
  const { mockDeep } = await import('vitest-mock-extended')
  return { prisma: mockDeep<PrismaClient>() }
})

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>

// The limits come from the environment, exactly as they do in production. The
// spec never reaches into a limiter to change its numbers — if it did, it would
// stop testing the configuration path a deploy actually uses.
const TEST_LIMITS = {
  RATE_LIMIT_LOGIN_MAX: '2',
  RATE_LIMIT_REGISTER_MAX: '2',
  RATE_LIMIT_RESPONSES_MAX: '2'
} as const

describe('Rate limiting', () => {
  beforeEach(async () => {
    mockReset(prismaMock)
    for (const [name, value] of Object.entries(TEST_LIMITS)) {
      vi.stubEnv(name, value)
    }
    // The suites share one `app`, so hit counts leak between tests without this.
    // `skipSuccessfulRequests` refunds a hit from a response `finish` handler,
    // which can still be pending after supertest has resolved — let those settle
    // before clearing, or the reset races them.
    await new Promise(resolve => setImmediate(resolve))
    await resetRateLimitStores()
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    await new Promise(resolve => setImmediate(resolve))
    await resetRateLimitStores()
  })

  /** Drives an endpoint `count` times and returns the responses in order. */
  async function hit(count: number, send: () => Promise<request.Response>) {
    const responses: request.Response[] = []
    for (let i = 0; i < count; i++) {
      responses.push(await send())
    }
    return responses
  }

  function expectRateLimited(res: request.Response) {
    expect(res.status).toBe(429)
    // JSON in this API's shape. A plain-string body would make
    // `await response.json()` in frontend/src/services/api.ts throw a
    // SyntaxError instead of producing an ApiError, and the user would be told
    // nothing useful.
    expect(res.headers['content-type']).toMatch(/application\/json/)
    expect(typeof res.body.error).toBe('string')
    expect(res.body.error.length).toBeGreaterThan(0)
    // The only part of the response a client can act on programmatically.
    expect(res.headers['retry-after']).toBeDefined()
  }

  describe('POST /api/auth/login', () => {
    const credentials = { email: 'someone@example.com', password: 'wrong-password' }

    it('returns 429 once the limit is exceeded', async () => {
      // No such user, so every attempt is a failed one and none is refunded.
      prismaMock.user.findUnique.mockResolvedValue(null)

      const responses = await hit(3, () =>
        request(app).post('/api/auth/login').send(credentials)
      )

      expect(responses[0]!.status).toBe(401)
      expect(responses[1]!.status).toBe(401)
      expectRateLimited(responses[2]!)
    })

    it('does not limit a request under the limit', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null)

      const responses = await hit(2, () =>
        request(app).post('/api/auth/login').send(credentials)
      )

      expect(responses.every(r => r.status === 401)).toBe(true)
    })

    it('does not spend the budget on successful logins', async () => {
      // A person working normally must not be able to lock themselves out.
      const passwordHash = await (await import('bcrypt')).default.hash('correct-password', 4)
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'someone@example.com',
        passwordHash,
        name: 'Someone',
        createdAt: new Date()
      } as any)

      const responses = await hit(4, () =>
        request(app)
          .post('/api/auth/login')
          .send({ email: 'someone@example.com', password: 'correct-password' })
      )

      // Four successes, well past a limit of two, because each one is refunded.
      expect(responses.map(r => r.status)).toEqual([200, 200, 200, 200])
    })
  })

  describe('POST /api/auth/register', () => {
    function payload() {
      return { email: `user-${Math.random()}@example.com`, password: 'password123' }
    }

    it('returns 429 once the limit is exceeded', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null)
      prismaMock.user.create.mockResolvedValue({
        id: 'user-1', email: 'a@example.com', name: null, createdAt: new Date()
      } as any)
      // Registration is transactional since features/0009.
      prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock))
      prismaMock.organization.create.mockResolvedValue({ id: 'org-1' } as any)
      prismaMock.membership.create.mockResolvedValue({ id: 'membership-1' } as any)

      const responses = await hit(3, () =>
        request(app).post('/api/auth/register').send(payload())
      )

      expect(responses[0]!.status).toBe(201)
      expect(responses[1]!.status).toBe(201)
      // Counted even though they succeeded — unlike login, account creation has
      // no legitimate reason to repeat.
      expectRateLimited(responses[2]!)
    })
  })

  describe('POST /api/responses', () => {
    const submission = {
      formId: '550e8400-e29b-41d4-a716-446655440000',
      shareId: 'share-123',
      answers: {}
    }

    it('returns 429 once the limit is exceeded', async () => {
      prismaMock.form.findFirst.mockResolvedValue(null)

      const responses = await hit(3, () =>
        request(app).post('/api/responses').send(submission)
      )

      expect(responses[0]!.status).toBe(404)
      expect(responses[1]!.status).toBe(404)
      expectRateLimited(responses[2]!)
    })
  })

  describe('unprotected paths', () => {
    it('never rate limits GET /health', async () => {
      const responses = await hit(10, () => request(app).get('/health'))

      expect(responses.every(r => r.status === 200)).toBe(true)
      expect(responses.some(r => r.status === 429)).toBe(false)
    })
  })

  describe('configuration', () => {
    it('falls back to the safe default when the limit is not a usable integer', async () => {
      vi.stubEnv('RATE_LIMIT_LOGIN_MAX', 'not-a-number')
      prismaMock.user.findUnique.mockResolvedValue(null)

      const res = await request(app).post('/api/auth/login').send({
        email: 'someone@example.com',
        password: 'wrong-password'
      })

      // The draft-8 policy header reports the limit actually in force, so assert
      // it directly. Inferring it from "N requests were not blocked" would
      // depend on how many hits the shared limiter happens to be holding, which
      // this test does not control - and that made it flaky.
      expect(res.headers['ratelimit-policy']).toMatch(/\bq=10\b/)
      expect(res.status).toBe(401)
    })

    it('uses a configured limit when it is valid', async () => {
      vi.stubEnv('RATE_LIMIT_LOGIN_MAX', '7')
      prismaMock.user.findUnique.mockResolvedValue(null)

      const res = await request(app).post('/api/auth/login').send({
        email: 'someone@example.com',
        password: 'wrong-password'
      })

      expect(res.headers['ratelimit-policy']).toMatch(/\bq=7\b/)
    })
  })
})
