import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { app } from '../../src/app.js'
import { prisma } from '../../src/services/db.js'
import { createUser, createForm, createField, createResponse } from './helpers.js'
import { mintApiKey } from '../../src/services/api-key.js'

/**
 * The public API (features/0019), and above all its tenant boundary.
 *
 * `/api/v1` is the first surface in this product authenticated by something
 * that is **not a user**. Everything under `/api/*` scopes queries with
 * `organization: { memberships: { some: { userId } } }`
 * (`middleware/formOwnership.ts`); nothing here can use that, because an API
 * key belongs to an organization and to no person. So the scoping is written
 * fresh, and fresh scoping is exactly the kind that is wrong the first time —
 * which is why the cross-tenant tests were written before the router existed
 * and run against every endpoint rather than a representative one.
 *
 * The rule is the same as everywhere else in this codebase: **a resource
 * belonging to another organization is a `404`, never a `403`.** A `403`
 * confirms the id exists, and an API is a much better place to enumerate ids
 * from than a browser.
 */
describe('GET /api/v1', () => {
  let owner: Awaited<ReturnType<typeof createUser>>
  let stranger: Awaited<ReturnType<typeof createUser>>
  let ownerKey: string
  let strangerKey: string
  let formId: string

  /** Every request the API is meant to answer, so tenancy is checked on all of them. */
  function endpoints(id: string): { name: string; path: string }[] {
    return [
      { name: 'read a form', path: `/api/v1/forms/${id}` },
      { name: 'list responses', path: `/api/v1/forms/${id}/responses` },
      { name: 'export responses', path: `/api/v1/forms/${id}/responses.csv` }
    ]
  }

  beforeEach(async () => {
    owner = await createUser()
    stranger = await createUser()

    // Team is the plan with `hasApiAccess`; minting goes through the service
    // here rather than the endpoint, so these tests are about the API surface
    // and not about billing.
    ownerKey = (await mintApiKey({
      organizationId: owner.organization.id,
      name: 'owner key',
      createdByUserId: owner.user.id
    })).secret
    strangerKey = (await mintApiKey({
      organizationId: stranger.organization.id,
      name: 'stranger key',
      createdByUserId: stranger.user.id
    })).secret

    const form = await createForm(owner.user.id, { title: 'Quarterly report', status: 'published' })
    formId = form.id
    const field = await createField(formId, { name: 'full_name', label: 'Full name' })
    await createResponse(formId, { [field.id]: 'Ada Lovelace' })
  })

  function get(path: string, key?: string) {
    const call = request(app).get(path)
    return key ? call.set('Authorization', `Bearer ${key}`) : call
  }

  describe('the tenant boundary', () => {
    // **Both halves, deliberately.** Asserting only the `404` is a test that
    // passes against a router that was never mounted — which is exactly what it
    // did when it was written, before `/api/v1` existed, because Express answers
    // 404 for an unknown path too. The owner's `200` on the same URL is what
    // makes the stranger's `404` mean "scoped out" rather than "no such route".
    it.each(endpoints('x').map(e => e.name))('scopes to the calling organization: %s', async name => {
      const endpoint = endpoints(formId).find(e => e.name === name)!

      expect((await get(endpoint.path, ownerKey)).status).toBe(200)

      // 404, not 403. The stranger's key is perfectly valid — it just cannot
      // learn that this form exists.
      expect((await get(endpoint.path, strangerKey)).status).toBe(404)
    })

    it('lists only the calling organization\'s forms', async () => {
      await createForm(stranger.user.id, { title: 'Not yours' })

      const response = await get('/api/v1/forms', ownerKey)

      expect(response.status).toBe(200)
      expect(response.body.data).toHaveLength(1)
      expect(response.body.data[0].title).toBe('Quarterly report')
    })
  })

  describe('authentication', () => {
    it('answers 401 without a key', async () => {
      expect((await get(`/api/v1/forms`)).status).toBe(401)
    })

    it('answers 401 to a malformed or unknown key', async () => {
      expect((await get('/api/v1/forms', 'not-a-key')).status).toBe(401)
      expect((await get('/api/v1/forms', 'vpk_nope_nope')).status).toBe(401)
    })

    it('answers 401 to a revoked key, on the very next request', async () => {
      expect((await get('/api/v1/forms', ownerKey)).status).toBe(200)

      await prisma.apiKey.updateMany({
        where: { organizationId: owner.organization.id },
        data: { revokedAt: new Date() }
      })

      // No restart, no cache invalidation, no waiting. The key is read from the
      // database on every request precisely so this is true.
      expect((await get('/api/v1/forms', ownerKey)).status).toBe(401)
    })

    it('does not accept a session token', async () => {
      // The two credentials are not interchangeable in either direction: this
      // one, and the `/api/forms` check below.
      const response = await get('/api/v1/forms', owner.token)
      expect(response.status).toBe(401)
    })

    it('does not accept an API key on the internal API', async () => {
      const response = await request(app)
        .get('/api/forms')
        .set('Authorization', `Bearer ${ownerKey}`)

      expect(response.status).toBe(401)
    })
  })

  describe('what it returns', () => {
    it('publishes an explicitly built form, not a Prisma row', async () => {
      const response = await get(`/api/v1/forms/${formId}`, ownerKey)

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({
        id: formId,
        title: 'Quarterly report',
        status: 'published'
      })

      // The contract is a promise, so what is *absent* matters as much as what
      // is present: internal provenance and the organization's billing state
      // must never reach a customer's integration, and adding a column to the
      // model must not publish it by accident.
      expect(response.body).not.toHaveProperty('createdByUserId')
      expect(response.body).not.toHaveProperty('organizationId')
      expect(response.body).not.toHaveProperty('planKey')

      expect(response.body.fields[0]).toMatchObject({ name: 'full_name', label: 'Full name' })
    })

    it('pages responses, and says how many there are', async () => {
      const response = await get(`/api/v1/forms/${formId}/responses`, ownerKey)

      expect(response.status).toBe(200)
      expect(response.body.data).toHaveLength(1)
      expect(response.body.data[0].answers.full_name).toBe('Ada Lovelace')
      expect(response.body.pagination).toMatchObject({ total: 1, limit: expect.any(Number) })
    })

    it('exports the same responses as CSV', async () => {
      const response = await get(`/api/v1/forms/${formId}/responses.csv`, ownerKey)

      expect(response.status).toBe(200)
      expect(response.headers['content-type']).toMatch(/text\/csv/)
      expect(response.text).toContain('Ada Lovelace')
    })

    it('answers 404 for a form id that does not exist at all', async () => {
      const response = await get('/api/v1/forms/11111111-1111-1111-1111-111111111111', ownerKey)
      expect(response.status).toBe(404)
    })
  })
})
