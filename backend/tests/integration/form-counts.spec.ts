import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { app } from '../../src/app.js'
import { prisma } from '../../src/services/db.js'
import { createUser, createForm, createField, createResponse } from './helpers.js'

/**
 * Every route that returns a form returns its counts.
 *
 * The share dialog reads `_count.responses`, and only `GET /api/forms` used to
 * include it. Publishing from that dialog issues `PATCH /api/forms/:id/status`
 * and the store writes the response over the row it already had — so the
 * counts vanished and the dialog said 0 responses for a form that had answers.
 * A mocked Prisma cannot catch this: `_count` is computed by the database, so
 * the assertion has to run against a real one.
 */
describe('form counts on every form-returning route (database-backed)', () => {
  async function formWithTwoResponses() {
    const { user, authHeader } = await createUser()
    const form = await createForm(user.id, { status: 'draft' })
    const field = await createField(form.id)

    await createResponse(form.id, { [field.id]: 'first' })
    await createResponse(form.id, { [field.id]: 'second' })

    return { authHeader, form }
  }

  it('includes counts when listing forms', async () => {
    const { authHeader, form } = await formWithTwoResponses()

    const res = await request(app).get('/api/forms').set('Authorization', authHeader)

    expect(res.status).toBe(200)
    const listed = res.body.forms.find((f: any) => f.id === form.id)
    expect(listed._count).toEqual({ fields: 1, responses: 2 })
  })

  it('includes counts when reading one form', async () => {
    const { authHeader, form } = await formWithTwoResponses()

    const res = await request(app).get(`/api/forms/${form.id}`).set('Authorization', authHeader)

    expect(res.status).toBe(200)
    expect(res.body.form._count).toEqual({ fields: 1, responses: 2 })
  })

  // The regression itself: this is the request the share dialog makes.
  it('still reports the responses after publishing', async () => {
    const { authHeader, form } = await formWithTwoResponses()

    const res = await request(app)
      .patch(`/api/forms/${form.id}/status`)
      .set('Authorization', authHeader)
      .send({ status: 'published' })

    expect(res.status).toBe(200)
    expect(res.body.form.status).toBe('published')
    expect(res.body.form._count.responses).toBe(2)
  })

  it('still reports the responses after updating the form', async () => {
    const { authHeader, form } = await formWithTwoResponses()

    const res = await request(app)
      .put(`/api/forms/${form.id}`)
      .set('Authorization', authHeader)
      .send({ title: 'Renamed' })

    expect(res.status).toBe(200)
    expect(res.body.form.title).toBe('Renamed')
    expect(res.body.form._count.responses).toBe(2)
  })

  it('does not count a field that was archived', async () => {
    const { user, authHeader } = await createUser()
    const form = await createForm(user.id)
    await createField(form.id, { name: 'live_1' })
    // `createField` only forwards the columns it names, so archiving has to be
    // a second write rather than an override.
    const archived = await createField(form.id, { name: 'archived_1' })
    await prisma.field.update({ where: { id: archived.id }, data: { deletedAt: new Date() } })

    const res = await request(app).get(`/api/forms/${form.id}`).set('Authorization', authHeader)

    // An archived field is still in the responses table and its answers are
    // still exported, but it is not a field of the form any more.
    expect(res.body.form._count.fields).toBe(1)
  })
})
