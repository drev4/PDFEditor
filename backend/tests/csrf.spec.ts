import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import { app } from '../src/app'
import { prisma } from '../src/services/db'
import { REFRESH_COOKIE } from '../src/services/session-cookie'
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import { PrismaClient } from '@prisma/client'

vi.mock('../src/services/db', async () => {
  const { mockDeep } = await import('vitest-mock-extended')
  return { prisma: mockDeep<PrismaClient>() }
})

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>

beforeEach(() => {
  mockReset(prismaMock)
})

const ALLOWED = 'http://localhost:5173'
const EVIL = 'https://evil.example.com'
const cookie = [`${REFRESH_COOKIE}=some-token`]

/**
 * CSRF on the two cookie-authenticated routes.
 *
 * The rest of the API authenticates with an `Authorization` header, which a
 * cross-site request cannot set, so it needs nothing here — and the last test
 * asserts that the guard was not quietly mounted globally, because a CSRF check
 * on every route would look like more protection while only breaking clients.
 */
describe('CSRF protection on the cookie-authenticated routes', () => {
  describe('POST /api/auth/refresh', () => {
    it('rejects a cross-site Origin', async () => {
      const res = await request(app)
        .post('/api/auth/refresh')
        .set('Origin', EVIL)
        .set('Cookie', cookie)

      expect(res.status).toBe(403)
      expect(res.body.error).toBe('Cross-site request rejected')
    })

    it('rejects Sec-Fetch-Site: cross-site even when Origin is absent', async () => {
      const res = await request(app)
        .post('/api/auth/refresh')
        .set('Sec-Fetch-Site', 'cross-site')
        .set('Cookie', cookie)

      expect(res.status).toBe(403)
    })

    it('does not reject the configured frontend origin', async () => {
      prismaMock.refreshToken.findUnique.mockResolvedValue(null)

      const res = await request(app)
        .post('/api/auth/refresh')
        .set('Origin', ALLOWED)
        .set('Sec-Fetch-Site', 'same-site')
        .set('Cookie', cookie)

      // 401 because the token does not resolve — the point is that it got past
      // the CSRF guard rather than being turned away at 403.
      expect(res.status).toBe(401)
    })

    it('allows a request with neither header', async () => {
      prismaMock.refreshToken.findUnique.mockResolvedValue(null)

      const res = await request(app).post('/api/auth/refresh').set('Cookie', cookie)

      // Deliberate: CSRF needs a browser, and a browser always sends one of the
      // two on a cross-site POST. Rejecting their absence would break curl and
      // every non-browser client while adding no protection.
      expect(res.status).toBe(401)
    })
  })

  describe('POST /api/auth/logout', () => {
    it('rejects a cross-site Origin', async () => {
      const res = await request(app)
        .post('/api/auth/logout')
        .set('Origin', EVIL)
        .set('Cookie', cookie)

      expect(res.status).toBe(403)
    })

    it('succeeds from the configured origin, with no access token', async () => {
      prismaMock.refreshToken.findUnique.mockResolvedValue(null)

      const res = await request(app)
        .post('/api/auth/logout')
        .set('Origin', ALLOWED)
        .set('Cookie', cookie)

      expect(res.status).toBe(204)
    })
  })

  describe('the guard is not mounted globally', () => {
    it('leaves Bearer-authenticated routes alone', async () => {
      const res = await request(app).get('/api/forms').set('Origin', EVIL)

      // 401 for the missing token, not 403 for the origin. A Bearer header
      // cannot be set cross-site, so these routes are not a CSRF target and a
      // guard here would be noise.
      expect(res.status).toBe(401)
    })

    it('leaves the public response endpoint alone', async () => {
      const res = await request(app)
        .post('/api/responses')
        .set('Origin', EVIL)
        .send({})

      expect(res.status).not.toBe(403)
    })
  })
})
