import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { app } from '../../src/app.js'
import { prisma } from '../../src/services/db.js'
import { createUser, createForm, createField } from './helpers.js'

/**
 * The organization-wide response listing (features/0024).
 *
 * The assertions that matter most here are the **negative** ones. This endpoint
 * exists beside a per-form listing that returns whole `Response` rows — answers,
 * `ipAddress` and `userAgent` — and the single most likely way for this feature
 * to be undone later is somebody "just adding the answers" to a row. So their
 * absence is asserted by name.
 */
describe('organization-wide responses', () => {
  let owner: Awaited<ReturnType<typeof createUser>>

  /**
   * A submission with a real `ipAddress` and `userAgent`, because their absence
   * from the response body is the thing under test.
   */
  async function submitTo(formId: string, value: string, submittedAt?: Date) {
    const field = await prisma.field.findFirstOrThrow({ where: { formId } })

    return prisma.response.create({
      data: {
        formId,
        ...(submittedAt ? { submittedAt } : {}),
        ipAddress: '203.0.113.7',
        userAgent: 'Mozilla/5.0 (test)',
        answers: { create: [{ fieldId: field.id, value }] }
      }
    })
  }

  /** A form with one field, ready to receive answers. */
  async function formWithField(userId: string, title: string) {
    const form = await createForm(userId, { title })
    await createField(form.id)
    return form
  }

  function list(query = '', auth = owner.authHeader) {
    return request(app)
      .get(`/api/organizations/responses${query}`)
      .set('Authorization', auth)
  }

  beforeEach(async () => {
    owner = await createUser()
  })

  it('lists responses from every form in the organization, newest first', async () => {
    const first = await formWithField(owner.user.id, 'First form')
    const second = await formWithField(owner.user.id, 'Second form')
    await submitTo(first.id, 'older', new Date('2026-08-01T10:00:00.000Z'))
    await submitTo(second.id, 'newer', new Date('2026-08-02T10:00:00.000Z'))

    const res = await list()

    expect(res.status).toBe(200)
    expect(res.body.responses).toHaveLength(2)
    // Ordering is the server's, not something a client re-sorts.
    expect(res.body.responses[0].formTitle).toBe('Second form')
    expect(res.body.responses[1].formTitle).toBe('First form')
    expect(res.body.pagination.total).toBe(2)
  })

  it('says which form and how many answers, and nothing about the respondent', async () => {
    const form = await formWithField(owner.user.id, 'A form')
    await submitTo(form.id, 'Ada')

    const res = await list()
    const row = res.body.responses[0]

    expect(row).toMatchObject({ formId: form.id, formTitle: 'A form', answerCount: 1 })
    // The three that must never appear. A cross-form browsing surface is not
    // where every answer and address in the organization belongs (S7).
    expect(row).not.toHaveProperty('answers')
    expect(row).not.toHaveProperty('ipAddress')
    expect(row).not.toHaveProperty('userAgent')
    // And not merely absent from the row — absent from the payload entirely.
    expect(JSON.stringify(res.body)).not.toContain('203.0.113.7')
    expect(JSON.stringify(res.body)).not.toContain('Mozilla')
    expect(JSON.stringify(res.body)).not.toContain('Ada')
  })

  it('never returns another organization responses', async () => {
    const stranger = await createUser()
    const theirForm = await formWithField(stranger.user.id, 'Their form')
    await submitTo(theirForm.id, 'not yours')

    const mine = await formWithField(owner.user.id, 'My form')
    await submitTo(mine.id, 'mine')

    const res = await list()

    expect(res.body.responses).toHaveLength(1)
    expect(res.body.responses[0].formTitle).toBe('My form')
  })

  it('shows only the active organization for a caller who belongs to two', async () => {
    const second = await prisma.organization.create({
      data: { name: 'Second', slug: `org-${Math.random().toString(36).slice(2, 12)}` }
    })
    await prisma.membership.create({
      data: { organizationId: second.id, userId: owner.user.id, role: 'member' }
    })

    const personalForm = await formWithField(owner.user.id, 'Personal form')
    await submitTo(personalForm.id, 'personal')

    const secondForm = await prisma.form.create({
      data: {
        organizationId: second.id,
        createdByUserId: owner.user.id,
        title: 'Second organization form',
        shareId: `share-${Math.random().toString(36).slice(2, 11)}`,
        status: 'draft'
      }
    })
    await createField(secondForm.id)
    await submitTo(secondForm.id, 'second')

    // One organization at a time, decided by `requireMembership` (features/0023).
    const before = await list()
    expect(before.body.responses.map((r: { formTitle: string }) => r.formTitle)).toEqual([
      'Personal form'
    ])

    await request(app)
      .post('/api/organizations/active')
      .set('Authorization', owner.authHeader)
      .send({ organizationId: second.id })

    const after = await list()
    expect(after.body.responses.map((r: { formTitle: string }) => r.formTitle)).toEqual([
      'Second organization form'
    ])
  })

  describe('the form filter', () => {
    it('narrows to one form', async () => {
      const first = await formWithField(owner.user.id, 'First form')
      const second = await formWithField(owner.user.id, 'Second form')
      await submitTo(first.id, 'a')
      await submitTo(second.id, 'b')

      const res = await list(`?formId=${first.id}`)

      expect(res.body.responses).toHaveLength(1)
      expect(res.body.responses[0].formTitle).toBe('First form')
      expect(res.body.pagination.total).toBe(1)
    })

    it('returns an empty list for another organization form, not a 404', async () => {
      const stranger = await createUser()
      const theirForm = await formWithField(stranger.user.id, 'Their form')
      await submitTo(theirForm.id, 'not yours')

      const res = await list(`?formId=${theirForm.id}`)

      // A 404 would confirm the form exists. An empty list says nothing.
      expect(res.status).toBe(200)
      expect(res.body.responses).toHaveLength(0)
      expect(res.body.pagination.total).toBe(0)
    })
  })

  describe('paging', () => {
    it('caps the limit rather than handing over the table', async () => {
      const form = await formWithField(owner.user.id, 'A form')
      await submitTo(form.id, 'one')

      const res = await list('?limit=5000')

      expect(res.body.pagination.limit).toBe(100)
    })

    it('pages with limit and offset, and reports the real total', async () => {
      const form = await formWithField(owner.user.id, 'A form')
      await submitTo(form.id, 'one', new Date('2026-08-01T10:00:00.000Z'))
      await submitTo(form.id, 'two', new Date('2026-08-02T10:00:00.000Z'))
      await submitTo(form.id, 'three', new Date('2026-08-03T10:00:00.000Z'))

      const page = await list('?limit=2&offset=2')

      expect(page.body.responses).toHaveLength(1)
      // The total is of everything matched, not of the page.
      expect(page.body.pagination.total).toBe(3)
      expect(page.body.pagination.offset).toBe(2)
    })
  })

  it('requires a session', async () => {
    const res = await request(app).get('/api/organizations/responses')

    expect(res.status).toBe(401)
  })
})
