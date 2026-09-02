import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import fs from 'fs'
import path from 'path'
import { Readable } from 'stream'
import { app } from '../../src/app.js'
import { prisma } from '../../src/services/db.js'
import { createUser } from './helpers.js'
import { pdfProcessor } from '../../src/services/pdf-processor.js'
import {
  LocalPdfStorage,
  setPdfStorage,
  type PdfStorageDriver
} from '../../src/services/pdf-storage.js'
import { resetOrganizationLocks } from '../../src/services/organization-lock.js'

/**
 * Two bulk saves on one form, overlapping
 * ([`features/0016`](../../../features/0016-object-storage-for-uploaded-pdfs.md), trap 2).
 *
 * `embedFieldsInPDF` is a read-modify-write of the whole document: it reads the
 * PDF, embeds the form's fields as an AcroForm, and writes the result back. Two
 * saves that overlap therefore both read, both embed their own view, and both
 * write — and **the last write wins, silently discarding whatever the other one
 * embedded.** The author sees a successful save and a PDF that does not contain
 * their fields.
 *
 * On local disk the window is a few milliseconds and this is a curiosity. The
 * point of features/0016 is that the bytes move to an object store, where a read
 * and a write are network round trips and the window is hundreds of
 * milliseconds — so the test widens the window deliberately rather than trying
 * to lose a race by luck. A test that reproduces this once in fifty runs is not
 * a regression test.
 *
 * The invariant asserted is the one that matters to a user, and it is stronger
 * than "no exception was thrown": **the fields embedded in the stored PDF are
 * the fields the database says the form has.** The PDF and the database are two
 * copies of one truth, and a save that leaves them disagreeing has lost work.
 */
describe('concurrent PDF embedding', () => {
  const FIXTURE = path.join(process.cwd(), 'test-fixtures', 'valid.pdf')

  /**
   * A driver that stalls the first reader **after** it has the bytes.
   *
   * The delay is deliberately on this side of the read, and getting it the
   * other way round is how this test first passed against broken code: sleeping
   * *before* the read makes the stalled request read last, so it gets the
   * fresher document and the update is never lost. A lost update needs the
   * opposite shape — read early, write late, holding bytes that went stale in
   * between, which is exactly what a slow embed or a slow network does to a
   * read-modify-write.
   */
  class SlowReadStorage implements PdfStorageDriver {
    private reads = 0
    constructor(private readonly inner: PdfStorageDriver, private readonly delayMs: number) {}

    async put(key: string, body: Buffer) {
      return this.inner.put(key, body)
    }

    async get(key: string): Promise<Buffer> {
      this.reads += 1
      const data = await this.inner.get(key)
      if (this.reads === 1) {
        await new Promise(resolve => setTimeout(resolve, this.delayMs))
      }
      return data
    }

    async getStream(key: string): Promise<Readable | null> {
      return this.inner.getStream(key)
    }

    async exists(key: string) {
      return this.inner.exists(key)
    }

    async remove(key: string) {
      return this.inner.remove(key)
    }
  }

  let owner: Awaited<ReturnType<typeof createUser>>
  let formId: string
  let pdfKey: string

  function bulkSave(fields: unknown[]) {
    return request(app)
      .post(`/api/forms/${formId}/fields/bulk`)
      .set('Authorization', owner.authHeader)
      .send({ fields })
  }

  function fieldPayload(name: string, order: number, id?: string) {
    return {
      ...(id ? { id } : {}),
      type: 'text',
      name,
      label: name,
      required: false,
      position: { x: 10, y: 20 + order * 30, width: 100, height: 20, page: 1 },
      order
    }
  }

  /** How many AcroForm fields are actually in the stored document. */
  async function embeddedFieldCount(): Promise<number> {
    const stored = await new LocalPdfStorage().get(pdfKey)
    return (await pdfProcessor.extractFieldsFromPDF(stored)).length
  }

  beforeEach(async () => {
    resetOrganizationLocks()

    owner = await createUser()
    pdfKey = `concurrency-${Date.now()}.pdf`

    // A real PDF, put where the application would have put it.
    await new LocalPdfStorage().put(pdfKey, fs.readFileSync(FIXTURE))

    const membership = await prisma.membership.findFirstOrThrow({
      where: { userId: owner.user.id }
    })
    const form = await prisma.form.create({
      data: {
        organizationId: membership.organizationId,
        createdByUserId: owner.user.id,
        title: 'Concurrency',
        shareId: `share-${Math.random().toString(36).slice(2, 11)}`,
        status: 'draft',
        pdfUrl: `http://localhost:3000/uploads/pdfs/${pdfKey}`
      }
    })
    formId = form.id
  })

  afterEach(async () => {
    setPdfStorage(null)
    await new LocalPdfStorage().remove(pdfKey)
  })

  it('leaves the stored PDF agreeing with the database when two saves overlap', async () => {
    // One field, settled, so the second save has an id to send back.
    const first = await bulkSave([fieldPayload('alpha', 0)])
    expect(first.status).toBe(200)
    const alphaId = first.body.fields[0].id as string

    // From here the reads are slow, so the two requests below overlap inside
    // `embedFieldsInPDF` rather than running one after the other.
    setPdfStorage(new SlowReadStorage(new LocalPdfStorage(), 400))

    // A changes nothing and will read the document first, then stall.
    // B adds a field and will finish its write while A is still stalled.
    const [a, b] = await Promise.all([
      bulkSave([fieldPayload('alpha', 0, alphaId)]),
      // Started a moment later, so A is the one holding the stale read.
      new Promise(resolve => setTimeout(resolve, 50)).then(() =>
        bulkSave([fieldPayload('alpha', 0, alphaId), fieldPayload('beta', 1)])
      )
    ])

    expect(a.status).toBe(200)
    expect((b as { status: number }).status).toBe(200)

    const liveFields = await prisma.field.count({ where: { formId, deletedAt: null } })
    expect(liveFields).toBe(2)

    // The assertion this suite exists for. Against the in-place overwrite the
    // stored document ends up with whatever the *last writer* embedded, which
    // is the request that read before `beta` existed — so this reads 1 while
    // the database says 2, and the author's field is missing from the PDF with
    // no error anywhere.
    expect(await embeddedFieldCount()).toBe(liveFields)
  })
})
