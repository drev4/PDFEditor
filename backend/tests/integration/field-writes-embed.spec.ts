import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { Readable } from 'stream'
import request from 'supertest'
import { PDFDocument } from 'pdf-lib'
import { app } from '../../src/app.js'
import { prisma } from '../../src/services/db.js'
import { setPdfStorage, type PdfStorageDriver } from '../../src/services/pdf-storage.js'
import { pdfProcessor } from '../../src/services/pdf-processor.js'
import { pdfFilenameFrom } from '../../src/services/pdf-url.js'
import { createUser } from './helpers.js'

/**
 * Every write that changes the field set re-embeds the PDF (features/0049).
 *
 * **This suite is a bug reproduction, not a regression guard.** Every test here
 * was written before the fix, run against the unfixed code, and seen to fail —
 * the stored document kept describing the form as it was before the request.
 * A test written afterwards would only prove the code agrees with itself
 * (docs/sot/09-quality-and-testing.md).
 *
 * The defect: only `POST /forms/:formId/fields/bulk` called `requestEmbed`. The
 * individual create, update, delete and restore did not, and neither did
 * `PUT /api/forms/:id` when it repointed a form at a newly uploaded document —
 * which is the editor's own save. So the stored PDF's AcroForm described a form
 * that no longer existed, invisibly, until somebody downloaded the document.
 *
 * The invariant asserted is the same one `pdf-embed-concurrency.spec.ts`
 * asserts for overlapping bulk saves, and it is the one a user can see: **the
 * fields embedded in the stored PDF are the fields the database says the form
 * has.** Database-backed, because the subject is what a committed write leaves
 * behind — a mocked Prisma would be asserting on values the test supplied.
 */

/** The `PdfStorageDriver` contract, held in a Map. Same shape as `editor-save-collects.spec.ts`. */
class MemoryPdfStorage implements PdfStorageDriver {
  readonly objects = new Map<string, Buffer>()

  async put(key: string, body: Buffer): Promise<void> {
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

let storage: MemoryPdfStorage
let owner: Awaited<ReturnType<typeof createUser>>

/** A real one-page PDF with no AcroForm, because `POST /api/upload` validates it. */
async function pdfBytes(): Promise<Buffer> {
  const doc = await PDFDocument.create()
  doc.addPage([400, 400])
  return Buffer.from(await doc.save())
}

/** A PDF that already carries an AcroForm, the way a customer's form does. */
async function pdfBytesWithAcroForm(name: string): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([400, 400])
  const field = doc.getForm().createTextField(name)
  field.addToPage(page, { x: 20, y: 300, width: 200, height: 24 })
  return Buffer.from(await doc.save())
}

async function upload(bytes?: Buffer) {
  const res = await request(app)
    .post('/api/upload')
    .set('Authorization', owner.authHeader)
    .attach('pdf', bytes ?? (await pdfBytes()), 'document.pdf')

  expect(res.status).toBe(201)
  return res.body as { url: string; filename: string }
}

async function draftForm(pdfUrl: string) {
  const created = await request(app)
    .post('/api/forms')
    .set('Authorization', owner.authHeader)
    .send({ title: 'Questionnaire', pdfUrl })

  expect(created.status).toBe(201)
  return created.body.form as { id: string; pdfUrl: string }
}

function fieldBody(overrides: Record<string, unknown> = {}) {
  return {
    type: 'text',
    name: 'full_name',
    label: 'Full name',
    required: false,
    position: { x: 10, y: 20, width: 120, height: 24, page: 1 },
    order: 0,
    ...overrides
  }
}

/**
 * The bulk save, which is the one write that already embedded before this
 * feature.
 *
 * The delete and restore tests use it to put the document into the state they
 * are about to change, rather than driving it with the individual writes those
 * same tests are testing: otherwise "the field is not in the PDF" would be true
 * before the request as well as after it, and the assertion would pass against
 * the unfixed code for the wrong reason.
 */
async function bulkSave(formId: string, fields: unknown[]) {
  const res = await request(app)
    .post(`/api/forms/${formId}/fields/bulk`)
    .set('Authorization', owner.authHeader)
    .send({ fields })

  expect(res.status).toBe(200)
  return res.body.fields as Array<{ id: string; name: string }>
}

/**
 * The names of the AcroForm fields actually inside the stored document.
 *
 * Names rather than a count: a rename leaves the count untouched, so counting
 * alone would pass against the unfixed `PUT` for the wrong reason.
 */
async function embeddedNames(key: string): Promise<string[]> {
  const stored = await storage.get(key)
  const extracted = await pdfProcessor.extractFieldsFromPDF(stored)
  return extracted.map(field => field.name).sort()
}

/** What the database says the form's live fields are called. */
async function liveNames(formId: string): Promise<string[]> {
  const fields = await prisma.field.findMany({
    where: { formId, deletedAt: null },
    select: { name: true }
  })
  return fields.map(field => field.name).sort()
}

beforeEach(async () => {
  storage = new MemoryPdfStorage()
  setPdfStorage(storage)
  owner = await createUser()
})

afterAll(() => {
  setPdfStorage(null)
})

describe('every field write re-embeds the PDF', () => {
  it('embeds a field created through the individual POST', async () => {
    const document = await upload()
    const form = await draftForm(document.url)

    const created = await request(app)
      .post(`/api/forms/${form.id}/fields`)
      .set('Authorization', owner.authHeader)
      .send(fieldBody())

    expect(created.status).toBe(201)
    expect(await embeddedNames(document.filename)).toEqual(['full_name'])
    expect(await embeddedNames(document.filename)).toEqual(await liveNames(form.id))
  })

  it('re-embeds under the new name when a field is renamed through PUT', async () => {
    const document = await upload()
    const form = await draftForm(document.url)

    const created = await request(app)
      .post(`/api/forms/${form.id}/fields`)
      .set('Authorization', owner.authHeader)
      .send(fieldBody())

    const updated = await request(app)
      .put(`/api/forms/${form.id}/fields/${created.body.field.id}`)
      .set('Authorization', owner.authHeader)
      .send({ name: 'surname', label: 'Surname' })

    expect(updated.status).toBe(200)
    expect(await embeddedNames(document.filename)).toEqual(['surname'])
  })

  it('removes a deleted field from the document', async () => {
    const document = await upload()
    const form = await draftForm(document.url)

    const [field] = await bulkSave(form.id, [fieldBody()])
    expect(await embeddedNames(document.filename)).toEqual(['full_name'])

    const deleted = await request(app)
      .delete(`/api/forms/${form.id}/fields/${field.id}`)
      .set('Authorization', owner.authHeader)

    expect(deleted.status).toBe(200)
    expect(deleted.body).toMatchObject({ archived: false, answerCount: 0 })
    expect(await embeddedNames(document.filename)).toEqual([])
  })

  /**
   * The archiving branch of `DELETE` (features/0044). The row survives with a
   * `deletedAt`, and `embedFormFields` reads only live fields — so the question
   * this asserts is that an archived field leaves the *document* too. A form
   * whose PDF still asks a question the form no longer asks is the same defect
   * as one that has lost a question.
   */
  it('removes an archived field from the document, keeping its answers', async () => {
    const document = await upload()
    const form = await draftForm(document.url)

    const [field] = await bulkSave(form.id, [fieldBody()])
    expect(await embeddedNames(document.filename)).toEqual(['full_name'])

    const fieldId = field.id
    await prisma.response.create({
      data: {
        formId: form.id,
        ipAddress: '127.0.0.1',
        answers: { create: [{ fieldId, value: 'Ada' }] }
      }
    })

    const deleted = await request(app)
      .delete(`/api/forms/${form.id}/fields/${fieldId}`)
      .set('Authorization', owner.authHeader)

    expect(deleted.status).toBe(200)
    expect(deleted.body).toMatchObject({ archived: true, answerCount: 1 })
    expect(await embeddedNames(document.filename)).toEqual([])
    expect(await prisma.answer.count({ where: { fieldId } })).toBe(1)
  })

  /**
   * Restore is the mirror, and it is the route whose toast used to apologise
   * for this bug: "Save the form to put it back in the PDF"
   * (features/0045, `EditorRail.vue`).
   */
  it('puts a restored field back into the document', async () => {
    const document = await upload()
    const form = await draftForm(document.url)

    const [field] = await bulkSave(form.id, [fieldBody()])
    const fieldId = field.id
    await prisma.response.create({
      data: {
        formId: form.id,
        ipAddress: '127.0.0.1',
        answers: { create: [{ fieldId, value: 'Ada' }] }
      }
    })

    await request(app)
      .delete(`/api/forms/${form.id}/fields/${fieldId}`)
      .set('Authorization', owner.authHeader)

    // The document is brought to "the field is gone" through the bulk save
    // rather than through the `DELETE` above, so this test fails on the
    // restore and not on somebody else's half of the fix. The field is
    // archived, so an empty save archives nothing further — it only embeds.
    await bulkSave(form.id, [])
    expect(await embeddedNames(document.filename)).toEqual([])

    const restored = await request(app)
      .post(`/api/forms/${form.id}/fields/${fieldId}/restore`)
      .set('Authorization', owner.authHeader)

    expect(restored.status).toBe(200)
    expect(await embeddedNames(document.filename)).toEqual(['full_name'])
  })

  /**
   * The fifth path, and the one nobody had filed until features/0046 went
   * looking: the editor's own save. It uploads the edited bytes and repoints
   * the form at them, so without an embed the *new* document carries whatever
   * AcroForm the uploaded file had — here, none at all — while the database
   * says the form has a field.
   */
  it('embeds the form fields into a document the form is repointed at', async () => {
    const original = await upload()
    const form = await draftForm(original.url)

    await request(app)
      .post(`/api/forms/${form.id}/fields`)
      .set('Authorization', owner.authHeader)
      .send(fieldBody())

    const edited = await upload()
    expect(await embeddedNames(edited.filename)).toEqual([])

    const repointed = await request(app)
      .put(`/api/forms/${form.id}`)
      .set('Authorization', owner.authHeader)
      .send({ pdfUrl: edited.url })

    expect(repointed.status).toBe(200)
    expect(await embeddedNames(edited.filename)).toEqual(['full_name'])
    expect(await embeddedNames(edited.filename)).toEqual(await liveNames(form.id))
  })

  /**
   * A form that gains its **first** document is the case an implementation
   * reusing features/0046's `replaced` list would silently miss: nothing is
   * being orphaned, so that list is empty, and the embed would never be asked
   * for. The condition is "the stored key changed", not "an old key was
   * replaced".
   */
  it('embeds when a form with no document gains one', async () => {
    const created = await request(app)
      .post('/api/forms')
      .set('Authorization', owner.authHeader)
      .send({ title: 'No document yet' })

    expect(created.status).toBe(201)
    const formId = created.body.form.id as string
    expect(created.body.form.pdfUrl).toBeNull()

    await request(app)
      .post(`/api/forms/${formId}/fields`)
      .set('Authorization', owner.authHeader)
      .send(fieldBody())

    const document = await upload()
    const repointed = await request(app)
      .put(`/api/forms/${formId}`)
      .set('Authorization', owner.authHeader)
      .send({ pdfUrl: document.url })

    expect(repointed.status).toBe(200)
    expect(await embeddedNames(document.filename)).toEqual(['full_name'])
  })

  /**
   * The trap the `allowEmpty` option exists for, and the reason it is the
   * caller who decides.
   *
   * A form whose fields have never been extracted has **no field rows**, and its
   * document is still the source of truth: `GET /api/forms/:id` is what reads
   * them out of the PDF, and it has not run yet. An embed that treated that
   * empty list as an answer would flatten the AcroForm the author uploaded, and
   * the sync that was about to read it would then find nothing at all.
   *
   * `PUT /api/forms/:id` says nothing about fields, so it does not claim the
   * empty list is an answer — and the document survives.
   */
  it('does not flatten a document whose fields the database has never seen', async () => {
    const original = await upload()
    const form = await draftForm(original.url)
    expect(await prisma.field.count({ where: { formId: form.id } })).toBe(0)

    const edited = await upload(await pdfBytesWithAcroForm('legacy_question'))
    expect(await embeddedNames(edited.filename)).toEqual(['legacy_question'])

    const repointed = await request(app)
      .put(`/api/forms/${form.id}`)
      .set('Authorization', owner.authHeader)
      .send({ pdfUrl: edited.url })

    expect(repointed.status).toBe(200)
    expect(await embeddedNames(edited.filename)).toEqual(['legacy_question'])
  })

  /**
   * Its mirror: once the author has removed the last field, the empty list *is*
   * the answer and the document loses it. A field write says so; that is the
   * whole difference between this test and the one above.
   */
  it('flattens the document when the author deletes the last field', async () => {
    const document = await upload(await pdfBytesWithAcroForm('legacy_question'))
    const form = await draftForm(document.url)

    // The extraction that `GET /api/forms/:id` performs on a form that has
    // never had fields — the moment the database becomes the source of truth.
    const loaded = await request(app)
      .get(`/api/forms/${form.id}`)
      .set('Authorization', owner.authHeader)
    expect(loaded.status).toBe(200)
    expect(loaded.body.form.fields).toHaveLength(1)

    const fieldId = loaded.body.form.fields[0].id as string
    const deleted = await request(app)
      .delete(`/api/forms/${form.id}/fields/${fieldId}`)
      .set('Authorization', owner.authHeader)

    expect(deleted.status).toBe(200)
    expect(await embeddedNames(document.filename)).toEqual([])
  })

  /**
   * The other half of the condition, and the reason it is a condition at all:
   * `PUT /api/forms/:id` also takes the title, the description and the status.
   * Rewriting the whole document because somebody fixed a typo is work nobody
   * asked for, and on the queued path it is a job per rename.
   *
   * Asserted on the bytes rather than on a spy: `pdf-lib` re-serialises the
   * document on every save, so an embed that ran would change them even when it
   * embedded exactly the same field.
   */
  it('does not touch the document when only the title changes', async () => {
    const document = await upload()
    const form = await draftForm(document.url)

    await request(app)
      .post(`/api/forms/${form.id}/fields`)
      .set('Authorization', owner.authHeader)
      .send(fieldBody())

    const before = Buffer.from(await storage.get(document.filename))

    const renamed = await request(app)
      .put(`/api/forms/${form.id}`)
      .set('Authorization', owner.authHeader)
      .send({ title: 'A better title' })

    expect(renamed.status).toBe(200)
    expect(await storage.get(document.filename)).toEqual(before)
  })

  /**
   * The client may echo back the signed URL it read from this API, which is a
   * different string naming the same object (features/0046). `pdfFilenameFrom`
   * is the one parser that decides, so a "repoint" at the document the form
   * already has is not a change and must not rewrite anything.
   */
  it('does not touch the document when the pdfUrl names the key it already has', async () => {
    const document = await upload()
    const form = await draftForm(document.url)

    await request(app)
      .post(`/api/forms/${form.id}/fields`)
      .set('Authorization', owner.authHeader)
      .send(fieldBody())

    expect(pdfFilenameFrom(form.pdfUrl)).toBe(document.filename)
    const before = Buffer.from(await storage.get(document.filename))

    const resent = await request(app)
      .put(`/api/forms/${form.id}`)
      .set('Authorization', owner.authHeader)
      .send({ title: 'Same document', pdfUrl: form.pdfUrl })

    expect(resent.status).toBe(200)
    expect(await storage.get(document.filename)).toEqual(before)
  })
})
