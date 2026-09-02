import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { app } from '../../src/app.js'
import { prisma } from '../../src/services/db.js'
import { createUser, createForm, createField, createResponse, fieldPayload } from './helpers.js'

// Database-backed. `Answer.field` is `onDelete: Cascade`, so the only way to
// prove a bulk save does not destroy collected answers is to run it against a
// real PostgreSQL and count the rows afterwards.
describe('POST /api/forms/:formId/fields/bulk (database-backed)', () => {
  it('preserves collected answers and field ids when a saved field is moved', async () => {
    const { user, authHeader } = await createUser()
    const form = await createForm(user.id)
    const nameField = await createField(form.id, { name: 'full_name', label: 'Full name', order: 0 })
    const emailField = await createField(form.id, { name: 'email', label: 'Email', order: 1 })

    await createResponse(form.id, {
      [nameField.id]: 'Ada Lovelace',
      [emailField.id]: 'ada@example.com'
    })

    const res = await request(app)
      .post(`/api/forms/${form.id}/fields/bulk`)
      .set('Authorization', authHeader)
      .send({
        fields: [
          // Same fields, one nudged a few pixels — the ordinary editor save.
          { ...fieldPayload({ name: 'full_name', label: 'Full name', order: 0 }), id: nameField.id, position: { x: 42, y: 20, width: 100, height: 30, page: 1 } },
          { ...fieldPayload({ name: 'email', label: 'Email', order: 1 }), id: emailField.id }
        ]
      })

    expect(res.status).toBe(200)

    const answers = await prisma.answer.findMany({ orderBy: { value: 'asc' } })
    expect(answers).toHaveLength(2)
    expect(answers.map(a => a.value).sort()).toEqual(['Ada Lovelace', 'ada@example.com'])

    // Ids must be the same rows, not recreated ones.
    const fields = await prisma.field.findMany({ where: { formId: form.id }, orderBy: { order: 'asc' } })
    expect(fields.map(f => f.id)).toEqual([nameField.id, emailField.id])
    expect((fields[0]!.position as any).x).toBe(42)

    // And every answer still points at a live field.
    expect(answers.every(a => [nameField.id, emailField.id].includes(a.fieldId))).toBe(true)
  })

  it('creates fields with no id and keeps the ids it hands back', async () => {
    const { user, authHeader } = await createUser()
    const form = await createForm(user.id)

    const first = await request(app)
      .post(`/api/forms/${form.id}/fields/bulk`)
      .set('Authorization', authHeader)
      .send({ fields: [fieldPayload({ name: 'a', label: 'A', order: 0 })] })

    expect(first.status).toBe(200)
    const createdId = first.body.fields[0].id

    // Second save sends the id back; the row must be the same one.
    const second = await request(app)
      .post(`/api/forms/${form.id}/fields/bulk`)
      .set('Authorization', authHeader)
      .send({ fields: [{ ...fieldPayload({ name: 'a', label: 'A renamed', order: 0 }), id: createdId }] })

    expect(second.status).toBe(200)
    expect(second.body.fields).toHaveLength(1)
    expect(second.body.fields[0].id).toBe(createdId)
    expect(second.body.fields[0].label).toBe('A renamed')
    expect(await prisma.field.count({ where: { formId: form.id } })).toBe(1)
  })

  it('hard-deletes a removed field that has no answers', async () => {
    const { user, authHeader } = await createUser()
    const form = await createForm(user.id)
    const keep = await createField(form.id, { name: 'keep', label: 'Keep', order: 0 })
    const drop = await createField(form.id, { name: 'drop', label: 'Drop', order: 1 })

    const res = await request(app)
      .post(`/api/forms/${form.id}/fields/bulk`)
      .set('Authorization', authHeader)
      .send({ fields: [{ ...fieldPayload({ name: 'keep', label: 'Keep', order: 0 }), id: keep.id }] })

    expect(res.status).toBe(200)
    expect(res.body.archived).toEqual([])
    expect(await prisma.field.findUnique({ where: { id: drop.id } })).toBeNull()
    expect(await prisma.field.findUnique({ where: { id: keep.id } })).not.toBeNull()
  })

  it('soft-deletes a removed field that has answers, keeps the answers, and reports it as archived', async () => {
    const { user, authHeader } = await createUser()
    const form = await createForm(user.id)
    const keep = await createField(form.id, { name: 'keep', label: 'Keep', order: 0 })
    const drop = await createField(form.id, { name: 'drop', label: 'Old question', order: 1 })

    await createResponse(form.id, { [keep.id]: 'kept', [drop.id]: 'historical answer' })

    const res = await request(app)
      .post(`/api/forms/${form.id}/fields/bulk`)
      .set('Authorization', authHeader)
      .send({ fields: [{ ...fieldPayload({ name: 'keep', label: 'Keep', order: 0 }), id: keep.id }] })

    expect(res.status).toBe(200)
    expect(res.body.archived).toEqual([drop.id])
    expect(res.body.fields.map((f: { id: string }) => f.id)).toEqual([keep.id])

    const archivedField = await prisma.field.findUnique({ where: { id: drop.id } })
    expect(archivedField).not.toBeNull()
    expect(archivedField!.deletedAt).toBeInstanceOf(Date)
    expect(archivedField!.label).toBe('Old question')

    expect(await prisma.answer.count()).toBe(2)
    expect(await prisma.answer.findFirst({ where: { fieldId: drop.id } })).not.toBeNull()
  })

  it('rejects an id that does not belong to this form, instead of creating a field', async () => {
    const { user, authHeader } = await createUser()
    const form = await createForm(user.id)
    const otherForm = await createForm(user.id, { title: 'Other' })
    const foreignField = await createField(otherForm.id, { name: 'foreign', label: 'Foreign' })

    const res = await request(app)
      .post(`/api/forms/${form.id}/fields/bulk`)
      .set('Authorization', authHeader)
      .send({ fields: [{ ...fieldPayload(), id: foreignField.id }] })

    expect(res.status).toBe(400)
    expect(await prisma.field.count({ where: { formId: form.id } })).toBe(0)
  })

  it('rejects the same id twice in one payload', async () => {
    const { user, authHeader } = await createUser()
    const form = await createForm(user.id)
    const field = await createField(form.id, { name: 'a', label: 'A' })

    const res = await request(app)
      .post(`/api/forms/${form.id}/fields/bulk`)
      .set('Authorization', authHeader)
      .send({
        fields: [
          { ...fieldPayload({ name: 'a', label: 'A', order: 0 }), id: field.id },
          { ...fieldPayload({ name: 'a2', label: 'A2', order: 1 }), id: field.id }
        ]
      })

    expect(res.status).toBe(400)
    expect(await prisma.field.count({ where: { formId: form.id } })).toBe(1)
  })

  it('rolls the whole save back when a write fails part-way through', async () => {
    const { user, authHeader } = await createUser()
    const form = await createForm(user.id)
    const existing = await createField(form.id, { name: 'a', label: 'A', order: 0 })

    // `order` is int4 in PostgreSQL. 2^31 passes Zod (it is just a number) and
    // fails at the database, inside the transaction and *after* the first
    // entry's update has already been issued. That is the only way to prove the
    // rollback: a payload rejected by validation never opens a transaction.
    const res = await request(app)
      .post(`/api/forms/${form.id}/fields/bulk`)
      .set('Authorization', authHeader)
      .send({
        fields: [
          { ...fieldPayload({ name: 'a', label: 'A edited', order: 0 }), id: existing.id },
          fieldPayload({ name: 'b', label: 'B', order: 2147483648 })
        ]
      })

    expect(res.status).toBeGreaterThanOrEqual(400)

    // The first entry's edit must not have survived, and no new row was created.
    const fields = await prisma.field.findMany({ where: { formId: form.id } })
    expect(fields).toHaveLength(1)
    expect(fields[0]!.id).toBe(existing.id)
    expect(fields[0]!.label).toBe('A')
  })
})
