import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { app } from '../../src/app.js'
import { prisma } from '../../src/services/db.js'
import { resetRateLimitStores } from '../../src/middleware/rateLimit.js'
import { createUser, createForm, createField, createResponse } from './helpers.js'

/**
 * `DELETE /api/forms/:formId/fields/:fieldId` must not destroy collected
 * answers (features/0044).
 *
 * Database-backed for the same reason `fields-bulk-save.spec.ts` is:
 * `Answer.field` is `onDelete: Cascade`, so the destruction happens inside
 * PostgreSQL and a mocked Prisma client would report whatever the mock was told
 * to report. Counting the rows afterwards is the only assertion that means
 * anything here.
 */
describe('DELETE /api/forms/:formId/fields/:fieldId (database-backed)', () => {
  beforeEach(async () => {
    await resetRateLimitStores()
  })

  it('archives a field that holds answers, and keeps every answer', async () => {
    const { user, authHeader } = await createUser()
    const form = await createForm(user.id)
    const nameField = await createField(form.id, { name: 'full_name', label: 'Full name', order: 0 })
    const emailField = await createField(form.id, { name: 'email', label: 'Email', order: 1 })

    await createResponse(form.id, {
      [nameField.id]: 'Ada Lovelace',
      [emailField.id]: 'ada@example.com'
    })

    const res = await request(app)
      .delete(`/api/forms/${form.id}/fields/${nameField.id}`)
      .set('Authorization', authHeader)

    expect(res.status).toBe(200)
    expect(res.body.archived).toBe(true)
    expect(res.body.answerCount).toBe(1)

    // The row survives, archived — which is what keeps the historical column
    // and its label in the responses table and the CSV.
    const stored = await prisma.field.findUniqueOrThrow({ where: { id: nameField.id } })
    expect(stored.deletedAt).not.toBeNull()

    // And the answer it holds is still there, pointing at it.
    const answers = await prisma.answer.findMany({ orderBy: { value: 'asc' } })
    expect(answers).toHaveLength(2)
    expect(answers.map(a => a.value)).toEqual(['Ada Lovelace', 'ada@example.com'])
    expect(answers.some(a => a.fieldId === nameField.id)).toBe(true)
  })

  it('really deletes a field that holds none', async () => {
    const { user, authHeader } = await createUser()
    const form = await createForm(user.id)
    const field = await createField(form.id, { name: 'never_filled', label: 'Never filled' })

    const res = await request(app)
      .delete(`/api/forms/${form.id}/fields/${field.id}`)
      .set('Authorization', authHeader)

    expect(res.status).toBe(200)
    expect(res.body.archived).toBe(false)
    expect(res.body.answerCount).toBe(0)

    // Archiving everything would leave a permanent row for every field placed
    // and discarded while designing a form.
    expect(await prisma.field.findUnique({ where: { id: field.id } })).toBeNull()
  })

  it('404s for a field that is already archived', async () => {
    const { user, authHeader } = await createUser()
    const form = await createForm(user.id)
    const field = await createField(form.id)
    await prisma.field.update({ where: { id: field.id }, data: { deletedAt: new Date() } })

    const res = await request(app)
      .delete(`/api/forms/${form.id}/fields/${field.id}`)
      .set('Authorization', authHeader)

    expect(res.status).toBe(404)
  })

  /**
   * The race the lock exists for.
   *
   * A sequential test proves nothing here: delete-then-check passes against the
   * unfixed handler too. Both requests go through one `Promise.all` against a
   * real PostgreSQL, and the assertion is an invariant rather than an outcome,
   * because either order is legitimate:
   *
   *  - the submission lands first, its answer takes `FOR KEY SHARE` on the
   *    field, the delete's `FOR UPDATE` waits, sees the answer and archives;
   *  - the delete lands first on a field with no answers, removes it, and the
   *    submission then fails its foreign key.
   *
   * What must never happen is a submission accepted with a `201` whose answer
   * is not in the database — which is exactly what a count taken before the
   * lock allows.
   */
  it('never accepts a submission whose answer is then cascaded away', async () => {
    const { user, authHeader } = await createUser()
    const form = await createForm(user.id, { status: 'published' })
    const field = await createField(form.id, { name: 'answer', label: 'Answer', required: false })

    const [deleteRes, submitRes] = await Promise.all([
      request(app)
        .delete(`/api/forms/${form.id}/fields/${field.id}`)
        .set('Authorization', authHeader),
      request(app)
        .post('/api/responses')
        .send({ formId: form.id, shareId: form.shareId, answers: { [field.id]: 'made it' } })
    ])

    const answers = await prisma.answer.findMany({ where: { fieldId: field.id } })

    if (submitRes.status === 201) {
      // Accepted means stored. The field must have been archived rather than
      // deleted, since it holds an answer now.
      expect(answers).toHaveLength(1)
      expect(answers[0]!.value).toBe('made it')

      const stored = await prisma.field.findUnique({ where: { id: field.id } })
      expect(stored).not.toBeNull()
      expect(stored!.deletedAt).not.toBeNull()
    } else {
      // Rejected is fine — the delete won — but then the delete must have
      // reported an empty field, and no orphaned answer may exist.
      expect(deleteRes.status).toBe(200)
      expect(deleteRes.body.archived).toBe(false)
      expect(answers).toHaveLength(0)
    }
  })
})
