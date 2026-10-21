import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { app } from '../../src/app.js'
import { prisma } from '../../src/services/db.js'
import { createUser, createForm, createField, createResponse, fieldPayload } from './helpers.js'

// Listing and restoring archived fields (features/0045).
//
// Archiving already worked and was covered; being able to *see* it did not
// exist. These need a real database because the thing under test is a
// `deletedAt` filter plus a `_count` — both computed by PostgreSQL — and
// because the last test in here is about what two endpoints do to each other.
describe('Archived fields: listing and restoring (database-backed)', () => {
  async function formWithAnArchivedField() {
    const { user, authHeader } = await createUser()
    const form = await createForm(user.id)
    const keep = await createField(form.id, { name: 'keep', label: 'Keep', order: 0 })
    const drop = await createField(form.id, { name: 'drop', label: 'Old question', order: 1 })
    await createResponse(form.id, { [keep.id]: 'kept value', [drop.id]: 'first answer' })
    await createResponse(form.id, { [keep.id]: 'kept value 2', [drop.id]: 'second answer' })

    const save = await request(app)
      .post(`/api/forms/${form.id}/fields/bulk`)
      .set('Authorization', authHeader)
      .send({ fields: [{ ...fieldPayload({ name: 'keep', label: 'Keep', order: 0 }), id: keep.id }] })

    expect(save.body.archived).toEqual([drop.id])
    return { user, authHeader, form, keep, drop }
  }

  describe('GET /api/forms/:formId/fields/archived', () => {
    it('lists only archived fields, with the answers each one is keeping', async () => {
      const { authHeader, form, keep, drop } = await formWithAnArchivedField()

      const res = await request(app)
        .get(`/api/forms/${form.id}/fields/archived`)
        .set('Authorization', authHeader)

      expect(res.status).toBe(200)
      expect(res.body.fields).toHaveLength(1)
      expect(res.body.fields[0].id).toBe(drop.id)
      expect(res.body.fields[0].label).toBe('Old question')
      expect(res.body.fields[0].deletedAt).not.toBeNull()
      // Two responses answered it, and both are still there.
      expect(res.body.fields[0].answerCount).toBe(2)
      expect(res.body.fields.map((f: { id: string }) => f.id)).not.toContain(keep.id)
    })

    it('is empty for a form that has never archived anything', async () => {
      const { user, authHeader } = await createUser()
      const form = await createForm(user.id)
      await createField(form.id, { name: 'live', label: 'Live' })

      const res = await request(app)
        .get(`/api/forms/${form.id}/fields/archived`)
        .set('Authorization', authHeader)

      expect(res.status).toBe(200)
      expect(res.body.fields).toEqual([])
    })

    // The static segment sits under `/:formId/fields/:fieldId`, which is where
    // shadowing happens; this is the assertion that it is still reached.
    it('is not shadowed by the parameterised field routes', async () => {
      const { authHeader, form } = await formWithAnArchivedField()

      const res = await request(app)
        .get(`/api/forms/${form.id}/fields/archived`)
        .set('Authorization', authHeader)

      expect(res.status).toBe(200)
      expect(res.body).toHaveProperty('fields')
    })

    it('is 404 for a form belonging to another organization', async () => {
      const { form } = await formWithAnArchivedField()
      const stranger = await createUser()

      const res = await request(app)
        .get(`/api/forms/${form.id}/fields/archived`)
        .set('Authorization', stranger.authHeader)

      expect(res.status).toBe(404)
    })

    it('is 401 without a token', async () => {
      const { form } = await formWithAnArchivedField()

      const res = await request(app).get(`/api/forms/${form.id}/fields/archived`)

      expect(res.status).toBe(401)
    })
  })

  describe('POST /api/forms/:formId/fields/:fieldId/restore', () => {
    it('brings the field back to the editor and out of the archived list', async () => {
      const { authHeader, form, drop } = await formWithAnArchivedField()

      const res = await request(app)
        .post(`/api/forms/${form.id}/fields/${drop.id}/restore`)
        .set('Authorization', authHeader)

      expect(res.status).toBe(200)
      expect(res.body.field.id).toBe(drop.id)
      expect(res.body.field.deletedAt).toBeNull()
      // The whole row comes back — the editor cannot put a field on the page
      // without its position, and cannot round-trip it through the bulk save
      // without its options and validation.
      expect(res.body.field.position).toEqual(drop.position)
      expect(res.body.field.name).toBe('drop')

      const form_ = await request(app).get(`/api/forms/${form.id}`).set('Authorization', authHeader)
      expect(form_.body.form.fields.map((f: { id: string }) => f.id)).toContain(drop.id)

      const archived = await request(app)
        .get(`/api/forms/${form.id}/fields/archived`)
        .set('Authorization', authHeader)
      expect(archived.body.fields).toEqual([])
    })

    it('keeps every answer the field was holding', async () => {
      const { authHeader, form, drop } = await formWithAnArchivedField()

      await request(app)
        .post(`/api/forms/${form.id}/fields/${drop.id}/restore`)
        .set('Authorization', authHeader)

      const answers = await prisma.answer.findMany({ where: { fieldId: drop.id } })
      expect(answers).toHaveLength(2)
    })

    it('is 404 for a live field — the mirror of PUT and DELETE on an archived one', async () => {
      const { authHeader, form, keep } = await formWithAnArchivedField()

      const res = await request(app)
        .post(`/api/forms/${form.id}/fields/${keep.id}/restore`)
        .set('Authorization', authHeader)

      expect(res.status).toBe(404)
    })

    it('is 404 for a field of another organization, and does not restore it', async () => {
      const { form, drop } = await formWithAnArchivedField()
      const stranger = await createUser()

      const res = await request(app)
        .post(`/api/forms/${form.id}/fields/${drop.id}/restore`)
        .set('Authorization', stranger.authHeader)

      expect(res.status).toBe(404)
      const row = await prisma.field.findUnique({ where: { id: drop.id } })
      expect(row?.deletedAt).not.toBeNull()
    })

    it('is 401 without a token', async () => {
      const { form, drop } = await formWithAnArchivedField()

      const res = await request(app).post(`/api/forms/${form.id}/fields/${drop.id}/restore`)

      expect(res.status).toBe(401)
    })
  })

  // The reason the store must put a restored field into its local list.
  //
  // The bulk save reads its removals as "a live field of this form whose id is
  // not in the payload", so a restored field is one save away from being
  // archived again — silently, with a 200 and no error anywhere. These two
  // tests are the same scenario with and without the field in the payload, and
  // the second is what a wrong frontend produces.
  describe('a restored field and the next bulk save', () => {
    it('stays live when the editor sends it back with the save', async () => {
      const { authHeader, form, keep, drop } = await formWithAnArchivedField()

      await request(app)
        .post(`/api/forms/${form.id}/fields/${drop.id}/restore`)
        .set('Authorization', authHeader)

      const save = await request(app)
        .post(`/api/forms/${form.id}/fields/bulk`)
        .set('Authorization', authHeader)
        .send({
          fields: [
            { ...fieldPayload({ name: 'keep', label: 'Keep', order: 0 }), id: keep.id },
            { ...fieldPayload({ name: 'drop', label: 'Old question', order: 1 }), id: drop.id }
          ]
        })

      expect(save.status).toBe(200)
      expect(save.body.archived).toEqual([])
      expect(save.body.fields.map((f: { id: string }) => f.id)).toContain(drop.id)

      const row = await prisma.field.findUnique({ where: { id: drop.id } })
      expect(row?.deletedAt).toBeNull()
    })

    it('is archived again when the editor leaves it out', async () => {
      const { authHeader, form, keep, drop } = await formWithAnArchivedField()

      await request(app)
        .post(`/api/forms/${form.id}/fields/${drop.id}/restore`)
        .set('Authorization', authHeader)

      const save = await request(app)
        .post(`/api/forms/${form.id}/fields/bulk`)
        .set('Authorization', authHeader)
        .send({ fields: [{ ...fieldPayload({ name: 'keep', label: 'Keep', order: 0 }), id: keep.id }] })

      // No error, nothing to notice: exactly why the store has to add the
      // restored field to `fields` rather than only refreshing the sidebar.
      expect(save.status).toBe(200)
      expect(save.body.archived).toEqual([drop.id])

      const row = await prisma.field.findUnique({ where: { id: drop.id } })
      expect(row?.deletedAt).not.toBeNull()
      // And the answers survive this second archiving too.
      expect(await prisma.answer.count({ where: { fieldId: drop.id } })).toBe(2)
    })
  })
})
