import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { app } from '../../src/app.js'
import { prisma } from '../../src/services/db.js'
import { createUser } from './helpers.js'
import { resetRateLimitStores } from '../../src/middleware/rateLimit.js'

/**
 * Minting, listing and revoking API keys (features/0019).
 *
 * Three properties are asserted here that a reader of the code would otherwise
 * have to take on trust:
 *
 *   - **The secret appears exactly once.** There is no endpoint that can return
 *     it again, because anything that can is storing a password.
 *   - **`402` and `403` are not the same answer.** A member without the role
 *     hears `403`; an admin whose plan has no API access hears `402`. Collapsing
 *     them tells an owner to ask permission for something no permission grants
 *     (features/0012).
 *   - **Revoking works when the plan no longer does.** Turning a credential off
 *     is never something to charge for, so a downgraded organization can still
 *     revoke the keys it minted while it paid.
 */
describe('API key management', () => {
  let owner: Awaited<ReturnType<typeof createUser>>

  /** Puts the caller's organization on a plan, the way a subscription would. */
  async function setPlan(organizationId: string, planKey: string) {
    await prisma.organization.update({ where: { id: organizationId }, data: { planKey } })
  }

  beforeEach(async () => {
    owner = await createUser()
    // `hasApiAccess` is true only on Team, so that is the plan under test here;
    // the `402` case sets its own.
    await setPlan(owner.organization.id, 'team')
    await resetRateLimitStores()
  })

  afterEach(async () => {
    await resetRateLimitStores()
  })

  function post(body: unknown, auth = owner.authHeader) {
    return request(app).post('/api/organizations/api-keys').set('Authorization', auth).send(body)
  }

  it('returns the secret once, and never again', async () => {
    const created = await post({ name: 'CI' })

    expect(created.status).toBe(201)
    expect(created.body.apiKey.secret).toMatch(/^vpk_[0-9a-f]+_/)
    const secret = created.body.apiKey.secret as string

    // It works.
    const used = await request(app).get('/api/v1/forms').set('Authorization', `Bearer ${secret}`)
    expect(used.status).toBe(200)

    // And the listing cannot give it back — not the secret, not the hash.
    const listed = await request(app)
      .get('/api/organizations/api-keys')
      .set('Authorization', owner.authHeader)

    expect(listed.status).toBe(200)
    expect(listed.body.apiKeys).toHaveLength(1)
    expect(listed.body.apiKeys[0]).not.toHaveProperty('secret')
    expect(listed.body.apiKeys[0]).not.toHaveProperty('hash')
    expect(listed.body.apiKeys[0]).toMatchObject({ name: 'CI', revokedAt: null })

    // What is stored is a hash, not the credential.
    const stored = await prisma.apiKey.findFirstOrThrow({
      where: { organizationId: owner.organization.id }
    })
    expect(stored.hash).not.toContain(secret)
    expect(secret).not.toContain(stored.hash)
  })

  it('answers 402 — not 403 — when the plan has no API access', async () => {
    await setPlan(owner.organization.id, 'pro')

    const response = await post({ name: 'CI' })

    // The distinction features/0012 established: this is a plan limit, and the
    // caller is an owner, so no permission change could fix it.
    expect(response.status).toBe(402)
    expect(response.body.error).toMatch(/API access/i)

    // And nothing was created on the way to refusing.
    expect(await prisma.apiKey.count({ where: { organizationId: owner.organization.id } })).toBe(0)
  })

  it('answers 403 to a member, whatever the plan', async () => {
    const member = await createUser()
    await prisma.membership.updateMany({
      where: { userId: member.user.id },
      data: { organizationId: owner.organization.id, role: 'member' }
    })

    const response = await post({ name: 'CI' }, member.authHeader)

    expect(response.status).toBe(403)
  })

  it('revokes, and the key stops working on the next request', async () => {
    const created = await post({ name: 'CI' })
    const secret = created.body.apiKey.secret as string
    const id = created.body.apiKey.id as string

    const revoked = await request(app)
      .delete(`/api/organizations/api-keys/${id}`)
      .set('Authorization', owner.authHeader)
    expect(revoked.status).toBe(200)

    const after = await request(app).get('/api/v1/forms').set('Authorization', `Bearer ${secret}`)
    expect(after.status).toBe(401)

    // Revocation is a timestamp, not a delete: the customer can still see the
    // key existed and when it stopped working.
    const stored = await prisma.apiKey.findUniqueOrThrow({ where: { id } })
    expect(stored.revokedAt).not.toBeNull()
  })

  it('still revokes after the plan has lost API access', async () => {
    const created = await post({ name: 'CI' })
    const id = created.body.apiKey.id as string

    // A downgrade. The key keeps working until somebody turns it off, and
    // turning it off must not be gated on the plan that could no longer create
    // it.
    await setPlan(owner.organization.id, 'free')

    const revoked = await request(app)
      .delete(`/api/organizations/api-keys/${id}`)
      .set('Authorization', owner.authHeader)

    expect(revoked.status).toBe(200)
  })

  it('does not let one organization revoke another\'s key', async () => {
    const created = await post({ name: 'CI' })
    const id = created.body.apiKey.id as string

    const stranger = await createUser()
    await setPlan(stranger.organization.id, 'team')

    const response = await request(app)
      .delete(`/api/organizations/api-keys/${id}`)
      .set('Authorization', stranger.authHeader)

    // 404 rather than 403, like every other cross-tenant read.
    expect(response.status).toBe(404)

    const stored = await prisma.apiKey.findUniqueOrThrow({ where: { id } })
    expect(stored.revokedAt).toBeNull()
  })

  it('records when a key was last used', async () => {
    const created = await post({ name: 'CI' })
    const secret = created.body.apiKey.secret as string
    const id = created.body.apiKey.id as string

    expect((await prisma.apiKey.findUniqueOrThrow({ where: { id } })).lastUsedAt).toBeNull()

    await request(app).get('/api/v1/forms').set('Authorization', `Bearer ${secret}`)

    // Written without the request waiting for it, so give the write a moment.
    await new Promise(resolve => setTimeout(resolve, 200))

    expect((await prisma.apiKey.findUniqueOrThrow({ where: { id } })).lastUsedAt).not.toBeNull()
  })
})
