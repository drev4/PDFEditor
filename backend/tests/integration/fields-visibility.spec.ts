import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { app } from '../../src/app.js'
import { prisma } from '../../src/services/db.js'
import { createUser, createForm, createField, createResponse, fieldPayload } from './helpers.js'

// An archived field must disappear from everywhere the form is *filled in*, and
// stay everywhere the form is *read back*.
describe('Archived field visibility (database-backed)', () => {
  async function formWithAnArchivedField() {
    const { user, authHeader } = await createUser()
    const form = await createForm(user.id)
    const keep = await createField(form.id, { name: 'keep', label: 'Keep', order: 0 })
    const drop = await createField(form.id, { name: 'drop', label: 'Old question', order: 1 })
    await createResponse(form.id, { [keep.id]: 'kept value', [drop.id]: 'historical answer' })

    const save = await request(app)
      .post(`/api/forms/${form.id}/fields/bulk`)
      .set('Authorization', authHeader)
      .send({ fields: [{ ...fieldPayload({ name: 'keep', label: 'Keep', order: 0 }), id: keep.id }] })

    expect(save.body.archived).toEqual([drop.id])
    return { user, authHeader, form, keep, drop }
  }

  it('is absent from GET /api/forms/:id', async () => {
    const { authHeader, form, keep, drop } = await formWithAnArchivedField()

    const res = await request(app).get(`/api/forms/${form.id}`).set('Authorization', authHeader)

    expect(res.status).toBe(200)
    expect(res.body.form.fields.map((f: { id: string }) => f.id)).toEqual([keep.id])
    expect(res.body.form.fields.map((f: { id: string }) => f.id)).not.toContain(drop.id)
  })

  it('is absent from the public form', async () => {
    const { form, keep, drop } = await formWithAnArchivedField()

    const res = await request(app).get(`/api/forms/public/${form.shareId}`)

    expect(res.status).toBe(200)
    expect(res.body.form.fields.map((f: { id: string }) => f.id)).toEqual([keep.id])
    expect(res.body.form.fields.map((f: { id: string }) => f.id)).not.toContain(drop.id)
  })

  it('is never required for a public submission', async () => {
    const { form, keep, drop } = await formWithAnArchivedField()
    await prisma.field.update({ where: { id: drop.id }, data: { required: true } })

    const res = await request(app)
      .post('/api/responses')
      .send({ formId: form.id, shareId: form.shareId, answers: { [keep.id]: 'submitted' } })

    expect(res.status).toBe(201)
  })

  it('keeps its column and its original label in the CSV export', async () => {
    const { authHeader, form, drop } = await formWithAnArchivedField()

    const res = await request(app)
      .get(`/api/forms/${form.id}/responses/export`)
      .set('Authorization', authHeader)

    expect(res.status).toBe(200)
    expect(res.text).toContain('Old question')
    expect(res.text).toContain('historical answer')
    expect(drop.label).toBe('Old question')
  })

  it('is returned by the responses listing so its answers keep a labelled column', async () => {
    const { authHeader, form, keep, drop } = await formWithAnArchivedField()

    const res = await request(app)
      .get(`/api/forms/${form.id}/responses`)
      .set('Authorization', authHeader)

    expect(res.status).toBe(200)
    const ids = res.body.fields.map((f: { id: string }) => f.id)
    expect(ids).toContain(keep.id)
    expect(ids).toContain(drop.id)
  })

  it('cannot be updated or deleted individually', async () => {
    const { authHeader, form, drop } = await formWithAnArchivedField()

    const put = await request(app)
      .put(`/api/forms/${form.id}/fields/${drop.id}`)
      .set('Authorization', authHeader)
      .send({ label: 'Resurrected' })
    expect(put.status).toBe(404)

    const del = await request(app)
      .delete(`/api/forms/${form.id}/fields/${drop.id}`)
      .set('Authorization', authHeader)
    expect(del.status).toBe(404)

    // And the answers are still there, because nothing was deleted.
    expect(await prisma.answer.count({ where: { fieldId: drop.id } })).toBe(1)
  })

  it('does not inflate the field count on the forms list', async () => {
    const { authHeader } = await formWithAnArchivedField()

    const res = await request(app).get('/api/forms').set('Authorization', authHeader)

    expect(res.status).toBe(200)
    expect(res.body.forms[0]._count.fields).toBe(1)
  })
})
