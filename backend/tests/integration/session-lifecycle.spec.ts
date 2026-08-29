import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { app } from '../../src/app.js'
import { prisma } from '../../src/services/db.js'
import { REFRESH_COOKIE } from '../../src/services/session-cookie.js'

/**
 * Session revocation, rotation and replay detection, against a real PostgreSQL.
 *
 * These belong here and not in the mocked suite because every claim they make is
 * a claim about the database: that a row was revoked, that the revocation is
 * visible to the next request, that a whole family went with it. A mocked Prisma
 * client would return whatever it was told and pass against code that revokes
 * nothing — which is the failure mode `docs/sot/09-quality-and-testing.md`
 * exists to prevent.
 */

const PASSWORD = 'TestPassword123!'

function email(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}@example.com`
}

/** Reads the refresh token out of a Set-Cookie header. */
function refreshCookieFrom(res: request.Response): string | null {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined
  if (!raw) return null
  const cookie = raw.find(c => c.startsWith(`${REFRESH_COOKIE}=`))
  if (!cookie) return null
  const value = cookie.split(';')[0].split('=')[1]
  return value === '' ? null : value
}

async function registerUser() {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ email: email(), password: PASSWORD, name: 'Session Test' })

  expect(res.status).toBe(201)
  return { accessToken: res.body.token as string, refresh: refreshCookieFrom(res)!, userId: res.body.user.id as string }
}

function withRefresh(path: string, token: string) {
  return request(app).post(path).set('Cookie', [`${REFRESH_COOKIE}=${token}`])
}

describe('session lifecycle (S4)', () => {
  describe('issuing', () => {
    it('puts the refresh token in an httpOnly cookie and never in the body', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: email(), password: PASSWORD })

      expect(res.status).toBe(201)
      expect(res.body).toHaveProperty('token')

      const cookie = (res.headers['set-cookie'] as unknown as string[]).find(c =>
        c.startsWith(`${REFRESH_COOKIE}=`)
      )!
      expect(cookie).toContain('HttpOnly')
      expect(cookie).toContain('SameSite=Lax')
      expect(cookie).toContain('Path=/api/auth')

      // The refresh token must not be reachable from JavaScript by any route.
      expect(JSON.stringify(res.body)).not.toContain(refreshCookieFrom(res)!)
    })

    it('stores a hash, never the token itself', async () => {
      const { refresh } = await registerUser()

      const rows = await prisma.refreshToken.findMany()
      expect(rows).toHaveLength(1)
      expect(rows[0].tokenHash).not.toBe(refresh)
      expect(rows[0].tokenHash).toHaveLength(64) // sha256 hex
    })
  })

  describe('rotation', () => {
    it('exchanges the refresh token for a new one and revokes the old row', async () => {
      const { refresh } = await registerUser()

      const res = await withRefresh('/api/auth/refresh', refresh)
      expect(res.status).toBe(200)
      expect(res.body.token).toBeTruthy()

      const next = refreshCookieFrom(res)
      expect(next).toBeTruthy()
      expect(next).not.toBe(refresh)

      const rows = await prisma.refreshToken.findMany({ orderBy: { createdAt: 'asc' } })
      expect(rows).toHaveLength(2)
      expect(rows[0].revokedAt).not.toBeNull()
      expect(rows[1].revokedAt).toBeNull()
      // Same session, so the family carries over.
      expect(rows[1].family).toBe(rows[0].family)
    })

    it('issues an access token that works on an authenticated route', async () => {
      const { refresh } = await registerUser()

      const refreshed = await withRefresh('/api/auth/refresh', refresh)
      const me = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${refreshed.body.token}`)

      expect(me.status).toBe(200)
      expect(me.body.user.email).toContain('session-')
    })
  })

  describe('replay detection', () => {
    it('rejects a refresh token that was already exchanged, and kills the family', async () => {
      const { refresh } = await registerUser()

      const first = await withRefresh('/api/auth/refresh', refresh)
      expect(first.status).toBe(200)
      const rotated = refreshCookieFrom(first)!

      // The original token again — a replay.
      const replay = await withRefresh('/api/auth/refresh', refresh)
      expect(replay.status).toBe(401)

      // The whole family is now dead, including the token the legitimate client
      // is holding. That is the point: a replay means one of the two copies was
      // stolen, and there is no way to tell which.
      const afterReplay = await withRefresh('/api/auth/refresh', rotated)
      expect(afterReplay.status).toBe(401)

      const rows = await prisma.refreshToken.findMany()
      expect(rows.every(r => r.revokedAt !== null)).toBe(true)
    })

    it('does not leak which failure occurred', async () => {
      const { refresh } = await registerUser()
      await withRefresh('/api/auth/refresh', refresh)

      const replayed = await withRefresh('/api/auth/refresh', refresh)
      const unknown = await withRefresh('/api/auth/refresh', 'a-token-that-never-existed')

      expect(replayed.status).toBe(unknown.status)
      expect(replayed.body).toEqual(unknown.body)
    })
  })

  describe('logout', () => {
    it('revokes server-side, so a captured refresh token stops working', async () => {
      const { refresh } = await registerUser()

      const out = await withRefresh('/api/auth/logout', refresh)
      expect(out.status).toBe(204)

      // This is the defect S4 describes: before this feature, logout only
      // deleted the token from localStorage and anyone holding a copy kept
      // full access for the rest of the week.
      const after = await withRefresh('/api/auth/refresh', refresh)
      expect(after.status).toBe(401)

      const rows = await prisma.refreshToken.findMany()
      expect(rows.every(r => r.revokedAt !== null)).toBe(true)
    })

    it('works without an access token, because that is when it is needed', async () => {
      const { refresh } = await registerUser()

      const out = await withRefresh('/api/auth/logout', refresh)

      expect(out.status).toBe(204)
    })

    it('does not touch another user session', async () => {
      const a = await registerUser()
      const b = await registerUser()

      await withRefresh('/api/auth/logout', a.refresh)

      const stillValid = await withRefresh('/api/auth/refresh', b.refresh)
      expect(stillValid.status).toBe(200)
    })
  })

  describe('expiry', () => {
    it('rejects a refresh token past its expiry', async () => {
      const { refresh } = await registerUser()

      await prisma.refreshToken.updateMany({
        data: { expiresAt: new Date(Date.now() - 1000) }
      })

      const res = await withRefresh('/api/auth/refresh', refresh)
      expect(res.status).toBe(401)
    })
  })

  describe('cascade', () => {
    it('deleting a user takes their sessions with them', async () => {
      const { userId } = await registerUser()

      await prisma.user.delete({ where: { id: userId } })

      // onDelete: Cascade on RefreshToken.user — see the cascade map in
      // docs/sot/03-domain-model.md. Nothing of the customer's is in this
      // table, so there is nothing to protect here.
      expect(await prisma.refreshToken.count()).toBe(0)
    })
  })
})
