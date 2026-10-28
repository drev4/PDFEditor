import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { app } from '../../src/app.js'
import { prisma } from '../../src/services/db.js'
import { resetRateLimitStores } from '../../src/middleware/rateLimit.js'
import { mintApiKey } from '../../src/services/api-key.js'
import { createUser, createForm, createField } from './helpers.js'

/**
 * The respondent's declared name (features/0054).
 *
 * Database-backed for the same reason as `respondent-metadata.spec.ts`: the
 * assertions are about what is in the `responses` row afterwards, and about a
 * rejected submission leaving neither a row nor a usage increment behind — a
 * transaction boundary a mocked Prisma cannot show.
 */
describe('declared respondent name', () => {
  beforeEach(async () => {
    await resetRateLimitStores()
  })

  async function publishedForm(asks: boolean) {
    const owner = await createUser()
    const form = await createForm(owner.user.id, { status: 'published', asksRespondentName: asks })
    const field = await createField(form.id, { required: false, name: 'site', label: 'Site' })
    return { owner, form, field }
  }

  function submit(form: { id: string; shareId: string }, fieldId: string, respondentName?: unknown) {
    return request(app)
      .post('/api/responses')
      .send({
        formId: form.id,
        shareId: form.shareId,
        answers: { [fieldId]: 'Bristol depot' },
        ...(respondentName === undefined ? {} : { respondentName })
      })
  }

  describe('the form decides', () => {
    it('ignores a name sent to a form that does not ask for one', async () => {
      const { form, field } = await publishedForm(false)

      await submit(form, field.id, 'Ada Lovelace').expect(201)

      const stored = await prisma.response.findFirstOrThrow({ where: { formId: form.id } })
      expect(stored.respondentName).toBeNull()
    })

    it('stores the normalised name when the form asks', async () => {
      const { form, field } = await publishedForm(true)

      await submit(form, field.id, '  Ada   Lovelace ').expect(201)

      const stored = await prisma.response.findFirstOrThrow({ where: { formId: form.id } })
      expect(stored.respondentName).toBe('Ada Lovelace')
    })

    it.each([
      ['missing', undefined],
      ['blank', '   '],
      ['too long', 'a'.repeat(121)],
      ['a control character', 'Ada\nLovelace'],
      ['not a string', 42]
    ])('rejects a name that is %s, and stores nothing', async (_label, value) => {
      const { owner, form, field } = await publishedForm(true)

      const res = await submit(form, field.id, value)

      expect(res.status).toBe(400)
      expect(res.body.details.respondentName).toEqual(expect.any(String))
      expect(await prisma.response.count({ where: { formId: form.id } })).toBe(0)
      // The meter is claimed inside the transaction that writes; a rejection
      // before it must not have claimed anything.
      expect(await prisma.usageCounter.count({ where: { organizationId: owner.organization.id } })).toBe(0)
    })

    it('accepts exactly the maximum length', async () => {
      const { form, field } = await publishedForm(true)

      await submit(form, field.id, 'a'.repeat(120)).expect(201)
    })

    it('defaults to not asking for a form created through the API', async () => {
      const owner = await createUser()

      const res = await request(app)
        .post('/api/forms')
        .set('Authorization', owner.authHeader)
        .send({ title: 'New form' })

      expect(res.status).toBe(201)
      expect(res.body.form.asksRespondentName).toBe(false)
    })

    it('is changed through the form update, and survives it', async () => {
      const { owner, form } = await publishedForm(false)

      const res = await request(app)
        .put(`/api/forms/${form.id}`)
        .set('Authorization', owner.authHeader)
        .send({ asksRespondentName: true })

      expect(res.status).toBe(200)
      expect(res.body.form.asksRespondentName).toBe(true)
      expect((await prisma.form.findUniqueOrThrow({ where: { id: form.id } })).asksRespondentName).toBe(true)
    })
  })

  describe('the public payload', () => {
    it('says whether the respondent will be asked, as one boolean', async () => {
      const asking = await publishedForm(true)
      const silent = await publishedForm(false)

      const a = await request(app).get(`/api/forms/public/${asking.form.shareId}`).expect(200)
      const b = await request(app).get(`/api/forms/public/${silent.form.shareId}`).expect(200)

      expect(a.body.asksRespondentName).toBe(true)
      expect(b.body.asksRespondentName).toBe(false)
      expect(a.body.form.organizationId).toBeUndefined()
    })
  })

  describe('where the name goes', () => {
    it('is carried by the per-form listing and the CSV, as a declared name', async () => {
      const { owner, form, field } = await publishedForm(true)
      await submit(form, field.id, 'Ada Lovelace').expect(201)

      const list = await request(app)
        .get(`/api/forms/${form.id}/responses`)
        .set('Authorization', owner.authHeader)
        .expect(200)
      expect(list.body.responses[0].respondentName).toBe('Ada Lovelace')

      const csv = await request(app)
        .get(`/api/forms/${form.id}/responses/export`)
        .set('Authorization', owner.authHeader)
        .expect(200)
      const [header, row] = csv.text.replace(/^﻿/, '').split('\n')
      expect(header).toBe('"Date Submitted","Declared name","IP Address","Site"')
      expect(row!.split(',')[1]).toBe('Ada Lovelace')
    })

    it('is carried by the v1 API, and is null where the form did not ask', async () => {
      const { owner, form, field } = await publishedForm(true)
      await prisma.organization.update({ where: { id: owner.organization.id }, data: { planKey: 'team' } })
      await submit(form, field.id, 'Ada Lovelace').expect(201)
      await prisma.form.update({ where: { id: form.id }, data: { asksRespondentName: false } })
      await submit(form, field.id).expect(201)

      const key = (await mintApiKey({
        organizationId: owner.organization.id,
        name: 'test key',
        createdByUserId: owner.user.id
      })).secret

      const res = await request(app)
        .get(`/api/v1/forms/${form.id}/responses`)
        .set('Authorization', `Bearer ${key}`)
        .expect(200)

      const names = res.body.data.map((r: { respondentName: string | null }) => r.respondentName)
      expect(names.sort()).toEqual(['Ada Lovelace', null].sort())
    })

    it('is carried by the organization export', async () => {
      const { owner, form, field } = await publishedForm(true)
      await submit(form, field.id, 'Ada Lovelace').expect(201)

      const res = await request(app).get('/api/organizations/export').set('Authorization', owner.authHeader)

      expect(res.status).toBe(200)
      expect(JSON.parse(res.text).responses[0].respondentName).toBe('Ada Lovelace')
    })

    /**
     * The organization-wide listing carries no respondent data, by decision
     * (features/0024). A name is respondent data, so it stays out.
     */
    it('is not carried by the organization-wide listing', async () => {
      const { owner, form, field } = await publishedForm(true)
      await submit(form, field.id, 'Ada Lovelace').expect(201)

      const res = await request(app)
        .get('/api/organizations/responses')
        .set('Authorization', owner.authHeader)
        .expect(200)

      expect(res.body.responses).toHaveLength(1)
      expect(res.body.responses[0]).not.toHaveProperty('respondentName')
      expect(res.text).not.toContain('Ada Lovelace')
    })
  })
})
