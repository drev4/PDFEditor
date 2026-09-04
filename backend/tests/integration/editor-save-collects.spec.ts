import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { Readable } from 'stream'
import request from 'supertest'
import { PDFDocument } from 'pdf-lib'
import { app } from '../../src/app.js'
import { prisma } from '../../src/services/db.js'
import { setPdfStorage, type PdfStorageDriver } from '../../src/services/pdf-storage.js'
import { createUser } from './helpers.js'

/**
 * Saving the document collects the PDF it replaced (features/0046).
 *
 * **This suite is a bug reproduction, not a regression guard.** The first test
 * was written before the fix, run against the unfixed code, and seen to fail —
 * the replaced object was still in storage and its `uploads` row was still
 * there. A test written after the fix would only prove that the code agrees
 * with itself (docs/sot/09-quality-and-testing.md).
 *
 * The defect: the editor's save uploads the edited bytes and repoints the form
 * through `PUT /api/forms/:id` (`useFormManagement.ts`, `FormSavePanel.vue`),
 * and nothing removed the document the form pointed at a moment earlier. Every
 * save left one more object nothing would ever reference again.
 *
 * Database-backed on purpose. The subject is "does any surviving row still
 * reference this key", which is a query over real rows: a mocked Prisma client
 * would be asserting on the answer the test itself supplied.
 *
 * Storage is the in-memory driver `upload-ownership.spec.ts` uses, extended to
 * record its `remove` calls — because two of these tests assert that **nothing
 * was removed**, and "the object is still there" cannot tell an untouched key
 * from one that was removed and put back.
 */

/** The `PdfStorageDriver` contract, held in a Map, with the removals recorded. */
class MemoryPdfStorage implements PdfStorageDriver {
  readonly objects = new Map<string, Buffer>()
  readonly removed: string[] = []

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
    this.removed.push(key)
    this.objects.delete(key)
  }
}

let storage: MemoryPdfStorage

/** A real one-page PDF, because `POST /api/upload` runs `validatePDF` on it. */
async function pdfBytes(): Promise<Buffer> {
  const doc = await PDFDocument.create()
  doc.addPage([200, 200])
  return Buffer.from(await doc.save())
}

/** Uploads through the real endpoint and returns what the client is told. */
async function upload(authHeader: string) {
  const res = await request(app)
    .post('/api/upload')
    .set('Authorization', authHeader)
    .attach('pdf', await pdfBytes(), 'document.pdf')

  expect(res.status).toBe(201)
  return res.body as { url: string; filename: string }
}

/** A draft form on `pdfUrl`, created through the real endpoint. */
async function draftForm(authHeader: string, pdfUrl: string) {
  const created = await request(app)
    .post('/api/forms')
    .set('Authorization', authHeader)
    .send({ title: 'Draft questionnaire', pdfUrl })

  expect(created.status).toBe(201)
  return created.body.form as { id: string; shareId: string }
}

/** The repoint the editor performs after uploading the edited bytes. */
function repoint(authHeader: string, formId: string, body: Record<string, unknown>) {
  return request(app)
    .put(`/api/forms/${formId}`)
    .set('Authorization', authHeader)
    .send(body)
}

async function uploadRowExists(key: string): Promise<boolean> {
  return (await prisma.upload.count({ where: { key } })) > 0
}

beforeEach(() => {
  storage = new MemoryPdfStorage()
  setPdfStorage(storage)
})

afterAll(() => {
  setPdfStorage(null)
})

describe('the editor save collects the document it replaced', () => {
  /**
   * The defect itself, driven the way the editor drives it: upload the edited
   * bytes, then `PUT` the form at them.
   *
   * The `-backup.pdf` sibling is written by hand because only
   * `scripts/migrate-existing-forms.ts` ever creates one, and it is part of
   * what `collectOrphanDocuments` is responsible for taking with the original.
   */
  it('removes the previous object, its migration backup and its uploads row', async () => {
    const author = await createUser('author-0046@example.com')

    const original = await upload(author.authHeader)
    const backupKey = original.filename.replace(/\.pdf$/i, '') + '-backup.pdf'
    await storage.put(backupKey, await pdfBytes())

    const form = await draftForm(author.authHeader, original.url)

    const edited = await upload(author.authHeader)
    await repoint(author.authHeader, form.id, { pdfUrl: edited.url }).expect(200)

    expect(await storage.exists(original.filename)).toBe(false)
    expect(await storage.exists(backupKey)).toBe(false)
    expect(await uploadRowExists(original.filename)).toBe(false)

    // And the document the form now points at is untouched.
    expect(await storage.exists(edited.filename)).toBe(true)
    expect(await uploadRowExists(edited.filename)).toBe(true)

    const stored = await prisma.form.findUniqueOrThrow({ where: { id: form.id } })
    expect(stored.pdfUrl).toContain(edited.filename)
  })

  /**
   * The reason this may not be `remove(previousKey)`.
   *
   * Two forms in one organization can point at one upload — an upload is not
   * consumed by being used (`services/uploads.ts`) — so the question is never
   * "which key did this form have" but "is any surviving form still using it".
   */
  it('keeps the previous object while another form still references it', async () => {
    const author = await createUser('sharer-0046@example.com')

    const shared = await upload(author.authHeader)
    const first = await draftForm(author.authHeader, shared.url)
    await draftForm(author.authHeader, shared.url)

    const edited = await upload(author.authHeader)
    await repoint(author.authHeader, first.id, { pdfUrl: edited.url }).expect(200)

    expect(await storage.exists(shared.filename)).toBe(true)
    expect(await uploadRowExists(shared.filename)).toBe(true)
    expect(storage.removed).toEqual([])
  })

  /**
   * A save that changes the title sends the same `pdfUrl` back, and the client
   * may send the **signed** URL it read from the API — a different string
   * naming the same object. Neither is a replacement, and neither may reach
   * storage at all.
   */
  it('touches storage on neither an unchanged pdfUrl nor a body without one', async () => {
    const author = await createUser('rename-0046@example.com')

    const document = await upload(author.authHeader)
    const form = await draftForm(author.authHeader, document.url)

    // The signed shape, exactly as `toApiForm` hands it back.
    const read = await request(app)
      .get(`/api/forms/${form.id}`)
      .set('Authorization', author.authHeader)
      .expect(200)
    const signed = String(read.body.form.pdfUrl)
    expect(signed).not.toBe(document.url)

    await repoint(author.authHeader, form.id, { title: 'Renamed', pdfUrl: signed }).expect(200)
    await repoint(author.authHeader, form.id, { title: 'Renamed again' }).expect(200)

    expect(storage.removed).toEqual([])
    expect(await storage.exists(document.filename)).toBe(true)
    expect(await uploadRowExists(document.filename)).toBe(true)
  })

  /**
   * Rows first, bytes second. A storage failure after the row is written is the
   * reversible half — an orphan, logged — and it must not turn the author's
   * save into a `500`.
   */
  it('still saves when the storage removal fails', async () => {
    const author = await createUser('failure-0046@example.com')

    const original = await upload(author.authHeader)
    const form = await draftForm(author.authHeader, original.url)
    const edited = await upload(author.authHeader)

    vi.spyOn(storage, 'remove').mockRejectedValue(new Error('bucket unreachable'))

    await repoint(author.authHeader, form.id, { pdfUrl: edited.url }).expect(200)

    const stored = await prisma.form.findUniqueOrThrow({ where: { id: form.id } })
    expect(stored.pdfUrl).toContain(edited.filename)

    // The object stayed, which is the orphan `services/pdf-gc.ts` logs. The row
    // stays with it: it is deleted only after the object is gone.
    expect(await storage.exists(original.filename)).toBe(true)
    expect(await uploadRowExists(original.filename)).toBe(true)

    vi.restoreAllMocks()
  })
})
