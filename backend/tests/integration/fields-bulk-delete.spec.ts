import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { Readable } from 'stream'
import request from 'supertest'
import { PDFDocument } from 'pdf-lib'
import { app } from '../../src/app.js'
import { prisma } from '../../src/services/db.js'
import { resetRateLimitStores } from '../../src/middleware/rateLimit.js'
import { setPdfStorage, type PdfStorageDriver } from '../../src/services/pdf-storage.js'
import { pdfProcessor } from '../../src/services/pdf-processor.js'
import { createUser, createForm, createField, createResponse } from './helpers.js'

/**
 * `POST /api/forms/:formId/fields/delete` — removing a marquee selection in one
 * request (features/0050).
 *
 * Database-backed for the reason `field-delete-archives.spec.ts` is:
 * `Answer.field` is `onDelete: Cascade`, so whether answers survive is decided
 * inside PostgreSQL, and a mocked Prisma would report whatever the mock was
 * told. Counting the rows afterwards is the only assertion that means anything.
 *
 * Two things here are not about deletion at all and are the reason this
 * endpoint exists rather than a client-side loop: **one** embed for the whole
 * set (features/0049 made every field write re-embed, so a loop over thirty
 * fields is thirty rewrites of one document), and **one** transaction, so a
 * partial failure cannot leave half a selection deleted.
 */

/** The `PdfStorageDriver` contract in a Map, recording every write. */
class CountingPdfStorage implements PdfStorageDriver {
  readonly objects = new Map<string, Buffer>()
  readonly writes: string[] = []

  async put(key: string, body: Buffer): Promise<void> {
    this.writes.push(key)
    this.objects.set(key, body)
  }

  async get(key: string): Promise<Buffer> {
    const found = this.objects.get(key)
    if (!found) throw new Error(`no such object: ${key}`)
    return found
  }

  async getStream(key: string): Promise<Readable | null> {
    const found = this.objects.get(key)
    return found ? Readable.from(found) : null
  }

  async exists(key: string): Promise<boolean> {
    return this.objects.has(key)
  }

  async remove(key: string): Promise<void> {
    this.objects.delete(key)
  }
}

let storage: CountingPdfStorage

beforeEach(async () => {
  await resetRateLimitStores()
  storage = new CountingPdfStorage()
  setPdfStorage(storage)
})

afterAll(() => {
  setPdfStorage(null)
})

function deleteFields(formId: string, authHeader: string, fieldIds: string[]) {
  return request(app)
    .post(`/api/forms/${formId}/fields/delete`)
    .set('Authorization', authHeader)
    .send({ fieldIds })
}

describe('POST /api/forms/:formId/fields/delete (database-backed)', () => {
  it('archives the fields that hold answers and deletes the ones that do not', async () => {
    const { user, authHeader } = await createUser()
    const form = await createForm(user.id)
    const answered = await createField(form.id, { name: 'full_name', label: 'Full name', order: 0 })
    const empty = await createField(form.id, { name: 'phone', label: 'Phone', order: 1 })
    const untouched = await createField(form.id, { name: 'email', label: 'Email', order: 2 })

    await createResponse(form.id, { [answered.id]: 'Ada Lovelace' })

    const res = await deleteFields(form.id, authHeader, [answered.id, empty.id])

    expect(res.status).toBe(200)
    expect(res.body.archived).toEqual([{ id: answered.id, answerCount: 1 }])
    expect(res.body.deleted).toEqual([empty.id])

    // The archived row survives with its answer; the empty one is gone.
    const stored = await prisma.field.findUniqueOrThrow({ where: { id: answered.id } })
    expect(stored.deletedAt).not.toBeNull()
    expect(await prisma.answer.count({ where: { fieldId: answered.id } })).toBe(1)
    expect(await prisma.field.findUnique({ where: { id: empty.id } })).toBeNull()

    // And a field that was not in the request is untouched.
    const survivor = await prisma.field.findUniqueOrThrow({ where: { id: untouched.id } })
    expect(survivor.deletedAt).toBeNull()
  })

  it('reports the real answer count per archived field', async () => {
    const { user, authHeader } = await createUser()
    const form = await createForm(user.id)
    const a = await createField(form.id, { name: 'a', label: 'A', order: 0 })
    const b = await createField(form.id, { name: 'b', label: 'B', order: 1 })

    await createResponse(form.id, { [a.id]: 'one', [b.id]: 'x' })
    await createResponse(form.id, { [a.id]: 'two' })
    await createResponse(form.id, { [a.id]: 'three' })

    const res = await deleteFields(form.id, authHeader, [a.id, b.id])

    expect(res.status).toBe(200)
    const counts = Object.fromEntries(
      (res.body.archived as Array<{ id: string; answerCount: number }>).map(f => [f.id, f.answerCount])
    )
    expect(counts).toEqual({ [a.id]: 3, [b.id]: 1 })
  })

  /**
   * The whole request fails, the same rule the bulk save applies to an unknown
   * id. Skipping it quietly would let a confused client believe it had deleted
   * something that is still on the form.
   */
  it('rejects the whole request when an id is not a live field of this form', async () => {
    const { user, authHeader } = await createUser()
    const form = await createForm(user.id)
    const mine = await createField(form.id, { name: 'mine', label: 'Mine', order: 0 })

    const otherForm = await createForm(user.id)
    const theirs = await createField(otherForm.id, { name: 'theirs', label: 'Theirs', order: 0 })

    const res = await deleteFields(form.id, authHeader, [mine.id, theirs.id])

    expect(res.status).toBe(400)
    expect(res.body.details.fieldIds).toEqual([theirs.id])

    // Nothing happened to either of them.
    expect(await prisma.field.findUnique({ where: { id: mine.id } })).not.toBeNull()
    expect(await prisma.field.findUnique({ where: { id: theirs.id } })).not.toBeNull()
  })

  it('refuses an already-archived field rather than reporting it deleted again', async () => {
    const { user, authHeader } = await createUser()
    const form = await createForm(user.id)
    const field = await createField(form.id)
    await prisma.field.update({ where: { id: field.id }, data: { deletedAt: new Date() } })

    const res = await deleteFields(form.id, authHeader, [field.id])

    expect(res.status).toBe(400)
  })

  it('is a 404 for somebody who is not a member of the form\'s organization', async () => {
    const { user, authHeader } = await createUser()
    const stranger = await createUser()
    const form = await createForm(user.id)
    const field = await createField(form.id)

    const res = await deleteFields(form.id, stranger.authHeader, [field.id])

    expect(res.status).toBe(404)
    expect(await prisma.field.findUnique({ where: { id: field.id } })).not.toBeNull()
  })

  /**
   * The reason this endpoint exists rather than a loop over the individual
   * `DELETE`. Since features/0049 each of those re-embeds the document, so
   * deleting five fields one at a time is five read-modify-writes of the same
   * PDF; here it is one, after one transaction.
   */
  it('rewrites the document once for the whole set', async () => {
    const { user, authHeader } = await createUser()

    const doc = await PDFDocument.create()
    doc.addPage([400, 400])
    const key = `bulk-delete-${Date.now()}.pdf`
    await storage.put(key, Buffer.from(await doc.save()))

    const form = await createForm(user.id, {
      pdfUrl: `http://localhost:3000/uploads/pdfs/${key}`
    })
    const fields = await Promise.all([
      createField(form.id, { name: 'a', label: 'A', order: 0 }),
      createField(form.id, { name: 'b', label: 'B', order: 1 }),
      createField(form.id, { name: 'c', label: 'C', order: 2 }),
      createField(form.id, { name: 'keep', label: 'Keep', order: 3 })
    ])

    storage.writes.length = 0

    const res = await deleteFields(form.id, authHeader, fields.slice(0, 3).map(f => f.id))
    expect(res.status).toBe(200)

    expect(storage.writes).toEqual([key])

    // And the one write left the document agreeing with the database.
    const embedded = await pdfProcessor.extractFieldsFromPDF(await storage.get(key))
    expect(embedded.map(f => f.name)).toEqual(['keep'])
  })

  /**
   * The race the `SELECT … FOR UPDATE` exists for, made deterministic.
   *
   * Two requests through `Promise.all` (below) could not be made to fail
   * against a handler with the lock removed: this transaction is short, so it
   * simply wins every time and the test passes for the wrong reason. So the
   * interleave is arranged instead of hoped for — an answer is inserted in a
   * transaction that is **held open** while the deletion runs.
   *
   * With the lock, the handler's `FOR UPDATE` waits behind the `FOR KEY SHARE`
   * that inserting an answer takes on the field it references. When the
   * submission commits, the handler sees the answers and **archives**.
   *
   * With the lock removed, the count runs immediately, sees nothing committed,
   * and the `deleteMany` then blocks — so it deletes *after* the answer is
   * committed and the cascade takes it. Run that way this test fails with
   * `expected [] to have a length of 2`, which is the defect: an answer that
   * was accepted and then destroyed.
   */
  it('archives a field whose answer commits while the deletion is waiting', async () => {
    const { user, authHeader } = await createUser()
    const form = await createForm(user.id, { status: 'published' })
    const one = await createField(form.id, { name: 'one', label: 'One', order: 0 })
    const two = await createField(form.id, { name: 'two', label: 'Two', order: 1 })

    let commitSubmission: () => void = () => {}
    const held = new Promise<void>(resolve => { commitSubmission = resolve })

    const submission = prisma.$transaction(async tx => {
      await tx.response.create({
        data: {
          formId: form.id,
          ipAddress: '127.0.0.1',
          answers: {
            create: [
              { fieldId: one.id, value: 'made it' },
              { fieldId: two.id, value: 'me too' }
            ]
          }
        }
      })
      // Holds `FOR KEY SHARE` on both fields until this resolves.
      await held
    }, { timeout: 20_000 })

    // Let the insert happen before the deletion asks for its lock.
    await new Promise(resolve => setTimeout(resolve, 300))

    const deletion = deleteFields(form.id, authHeader, [one.id, two.id])

    // The deletion is now blocked on the row lock. Commit the submission.
    setTimeout(() => commitSubmission(), 500)

    const [res] = await Promise.all([deletion, submission])

    expect(res.status).toBe(200)
    expect(res.body.archived).toHaveLength(2)
    expect(res.body.deleted).toEqual([])

    // The answers the submission committed are still there.
    expect(await prisma.answer.count({ where: { fieldId: { in: [one.id, two.id] } } })).toBe(2)
  })

  /**
   * The race the `SELECT … FOR UPDATE` exists for, and it must come **before**
   * the count.
   *
   * A sequential test proves nothing: delete-then-check passes against a
   * handler that counts first. Both requests go through one `Promise.all`
   * against a real PostgreSQL, and the assertion is an invariant rather than an
   * outcome, because either order is legitimate — what must never happen is a
   * submission accepted with a `201` whose answer is not in the database.
   *
   * Run against the handler with the lock removed, this fails: the count sees
   * no answers, both fields are hard-deleted, and the cascade takes the answer
   * of a response the API had already accepted.
   */
  it('never accepts a submission whose answer is then cascaded away', async () => {
    const { user, authHeader } = await createUser()
    const form = await createForm(user.id, { status: 'published' })
    const one = await createField(form.id, { name: 'one', label: 'One', order: 0 })
    const two = await createField(form.id, { name: 'two', label: 'Two', order: 1 })

    const [deleteRes, submitRes] = await Promise.all([
      deleteFields(form.id, authHeader, [one.id, two.id]),
      request(app)
        .post('/api/responses')
        .send({
          formId: form.id,
          shareId: form.shareId,
          answers: { [one.id]: 'made it', [two.id]: 'me too' }
        })
    ])

    const answers = await prisma.answer.findMany({
      where: { fieldId: { in: [one.id, two.id] } }
    })

    if (submitRes.status === 201) {
      // Accepted means stored, and both fields must have been archived rather
      // than deleted, since they hold answers now.
      expect(answers).toHaveLength(2)

      const stored = await prisma.field.findMany({ where: { id: { in: [one.id, two.id] } } })
      expect(stored).toHaveLength(2)
      expect(stored.every(f => f.deletedAt !== null)).toBe(true)
    } else {
      // Rejected is fine — the deletion won — but then it must have reported
      // empty fields, and no orphaned answer may exist.
      expect(deleteRes.status).toBe(200)
      expect(deleteRes.body.archived).toEqual([])
      expect(answers).toHaveLength(0)
    }
  })
})
