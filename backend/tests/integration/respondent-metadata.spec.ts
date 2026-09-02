import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { app } from '../../src/app.js'
import { prisma } from '../../src/services/db.js'
import { resetRateLimitStores } from '../../src/middleware/rateLimit.js'
import { createUser, createForm, createField } from './helpers.js'

/**
 * What a submission stores about the respondent (features/0032, finding S7).
 *
 * Database-backed because every assertion is about what is actually in the
 * `responses` row afterwards — the exact thing a mocked Prisma cannot tell you,
 * and the whole subject of this feature.
 */
describe('respondent metadata', () => {
  beforeEach(async () => {
    await resetRateLimitStores()
  })

  /** A published form with one field, ready to receive a submission. */
  async function publishedForm(collects: boolean) {
    const owner = await createUser()
    const form = await createForm(owner.user.id, {
      status: 'published',
      collectsRespondentMetadata: collects
    })
    const field = await createField(form.id, { required: false })
    return { owner, form, field }
  }

  function submit(form: { id: string; shareId: string }, fieldId: string, agent = 'Mozilla/5.0 (test)') {
    return request(app)
      .post('/api/responses')
      .set('User-Agent', agent)
      .send({ formId: form.id, shareId: form.shareId, answers: { [fieldId]: 'an answer' } })
  }

  describe('the form decides', () => {
    it('stores neither the address nor the user agent by default', async () => {
      const { form, field } = await publishedForm(false)

      const res = await submit(form, field.id)
      expect(res.status).toBe(201)

      const stored = await prisma.response.findFirstOrThrow({ where: { formId: form.id } })
      expect(stored.ipAddress).toBeNull()
      expect(stored.userAgent).toBeNull()
      // The submission itself is unaffected.
      expect(await prisma.answer.count({ where: { responseId: stored.id } })).toBe(1)
    })

    it('stores both when the author asked for them', async () => {
      const { form, field } = await publishedForm(true)

      await submit(form, field.id).expect(201)

      const stored = await prisma.response.findFirstOrThrow({ where: { formId: form.id } })
      expect(stored.ipAddress).not.toBeNull()
      expect(stored.userAgent).toBe('Mozilla/5.0 (test)')
    })

    /**
     * A new form must not collect. The default is the decision in this feature:
     * the collection had no implemented purpose, so it starts off.
     */
    it('defaults to off for a form created through the API', async () => {
      const owner = await createUser()

      const res = await request(app)
        .post('/api/forms')
        .set('Authorization', owner.authHeader)
        .send({ title: 'New form' })

      expect(res.status).toBe(201)
      const created = await prisma.form.findUniqueOrThrow({ where: { id: res.body.form.id } })
      expect(created.collectsRespondentMetadata).toBe(false)
    })
  })

  describe('the author controls it', () => {
    it('is turned on and off through the form endpoint', async () => {
      const owner = await createUser()
      const form = await createForm(owner.user.id)

      await request(app)
        .put(`/api/forms/${form.id}`)
        .set('Authorization', owner.authHeader)
        .send({ collectsRespondentMetadata: true })
        .expect(200)

      expect((await prisma.form.findUniqueOrThrow({ where: { id: form.id } })).collectsRespondentMetadata).toBe(true)

      await request(app)
        .put(`/api/forms/${form.id}`)
        .set('Authorization', owner.authHeader)
        .send({ collectsRespondentMetadata: false })
        .expect(200)

      expect((await prisma.form.findUniqueOrThrow({ where: { id: form.id } })).collectsRespondentMetadata).toBe(false)
    })

    it('is visible on the authenticated form read, so the editor can render it', async () => {
      const owner = await createUser()
      const form = await createForm(owner.user.id, { collectsRespondentMetadata: true })

      const res = await request(app).get(`/api/forms/${form.id}`).set('Authorization', owner.authHeader)

      expect(res.body.form.collectsRespondentMetadata).toBe(true)
    })

    it('cannot be set by a stranger', async () => {
      const owner = await createUser()
      const stranger = await createUser()
      const form = await createForm(owner.user.id)

      await request(app)
        .put(`/api/forms/${form.id}`)
        .set('Authorization', stranger.authHeader)
        .send({ collectsRespondentMetadata: true })
        .expect(404)

      expect((await prisma.form.findUniqueOrThrow({ where: { id: form.id } })).collectsRespondentMetadata).toBe(false)
    })
  })

  describe('the public payload', () => {
    it.each([true, false])('says whether metadata is collected (%s)', async collects => {
      const { form } = await publishedForm(collects)

      const res = await request(app).get(`/api/forms/public/${form.shareId}`)

      expect(res.status).toBe(200)
      expect(res.body.collectsMetadata).toBe(collects)
    })

    /**
     * The rule `routes/forms.ts` states at length for `showBranding`: this
     * payload is anonymous, and the owner's billing state is not the
     * respondent's business. The new field must not have widened it.
     */
    it('still carries nothing about the owner', async () => {
      const { form } = await publishedForm(true)

      const res = await request(app).get(`/api/forms/public/${form.shareId}`)
      const body = JSON.stringify(res.body)

      expect(res.body.plan).toBeUndefined()
      expect(res.body.entitlements).toBeUndefined()
      expect(res.body.usage).toBeUndefined()
      expect(res.body.form.organizationId).toBeUndefined()
      expect(res.body.form.createdByUserId).toBeUndefined()
      expect(body).not.toContain('planKey')
      expect(body).not.toContain('maxResponses')
    })
  })

  /**
   * **The assertion that stops this feature becoming a security hole.**
   *
   * `middleware/rateLimit.ts` counts `req.ip` on the request in flight and never
   * reads `responses.ip_address`. The two are unrelated, and the tempting wrong
   * implementation — routing the limiter through the flag "for consistency" —
   * would give every author a switch that disables their own abuse protection.
   *
   * So: a form with collection **off** must still be defended.
   */
  describe('turning collection off does not weaken the rate limiter', () => {
    const originalMax = process.env.RATE_LIMIT_RESPONSES_MAX

    afterEach(() => {
      process.env.RATE_LIMIT_RESPONSES_MAX = originalMax
    })

    it('still rejects a flood from one address against a non-collecting form', async () => {
      process.env.RATE_LIMIT_RESPONSES_MAX = '3'
      await resetRateLimitStores()

      const { form, field } = await publishedForm(false)

      const statuses: number[] = []
      for (let i = 0; i < 5; i += 1) {
        statuses.push((await submit(form, field.id)).status)
      }

      expect(statuses.filter(s => s === 201)).toHaveLength(3)
      expect(statuses.filter(s => s === 429)).toHaveLength(2)

      // And nothing was stored about the people who were let through.
      const stored = await prisma.response.findMany({ where: { formId: form.id } })
      expect(stored).toHaveLength(3)
      expect(stored.every(r => r.ipAddress === null)).toBe(true)
    })
  })
})
