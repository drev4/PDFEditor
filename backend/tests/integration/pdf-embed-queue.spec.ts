import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
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
import {
  closeEmbedQueue,
  createEmbedWorker,
  embedQueueStatus,
  type EmbedWorkerHandle
} from '../../src/services/embed-queue.js'

/**
 * The **queued** path, against a real Redis (features/0017, goal 5).
 *
 * Everything else in this repository exercises the inline path, because
 * `REDIS_URL` is pinned empty in both vitest configs. That is the whole reason
 * this file exists: features/0017 deliberately keeps two implementations of one
 * operation, and the one nothing tests is the one that drifts.
 *
 * **It skips itself when `TEST_REDIS_URL` is unset**, which keeps `npm run
 * test:integration` runnable offline. `REDIS_URL` is deliberately *not* the
 * variable that switches it on: that name is pinned empty by the config so a
 * developer's `.env` cannot move the other thirteen specs onto a worker that is
 * not running. This spec sets `REDIS_URL` itself, for its own duration, and
 * runs the worker in-process.
 *
 * The invariant is the one `pdf-embed-concurrency.spec.ts` asserts for the
 * inline path, and it is the one that matters to a user: **the fields embedded
 * in the stored PDF are the fields the database says the form has.** The PDF
 * and the database are two copies of one truth, and a save that leaves them
 * disagreeing has lost somebody's work.
 */
const TEST_REDIS_URL = process.env.TEST_REDIS_URL?.trim()

// A longer timeout than the suite's 30s default. Everything here waits on a
// second moving part - a real Redis, a worker, and a deliberately slowed
// storage driver - and on a cold cache the first test alone has to warm all of
// it up.
describe.skipIf(!TEST_REDIS_URL)('PDF embedding through the job queue', { timeout: 90_000 }, () => {
  const FIXTURE = path.join(process.cwd(), 'test-fixtures', 'valid.pdf')

  /**
   * A driver that stalls the first reader **after** it has the bytes.
   *
   * Copied in shape from `pdf-embed-concurrency.spec.ts`, and the delay is on
   * this side of the read for the same reason: sleeping *before* the read makes
   * the stalled worker read last, so it gets the fresher document and no update
   * is ever lost. A lost update needs the opposite - read early, write late,
   * holding bytes that went stale in between. An earlier draft of the inline
   * test got this backwards and passed against broken code.
   *
   * Here it does a second job: it makes the first embed slow enough that the
   * second save genuinely lands **while a job is in flight**, which is the case
   * BullMQ's job-id deduplication would silently discard.
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

  let workerHandle: EmbedWorkerHandle
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

  /**
   * Waits until the queue has nothing waiting, running or scheduled.
   *
   * The assertions run against a **drained** queue rather than after a sleep:
   * polling for the answer we want would turn "the second save was dropped"
   * into a timeout that still ends up asserting the right value by luck.
   */
  async function drain(timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs

    for (;;) {
      const status = await embedQueueStatus()
      if (status && status.waiting + status.active + status.delayed === 0) return
      if (Date.now() > deadline) {
        throw new Error(`Queue did not drain within ${timeoutMs}ms: ${JSON.stringify(status)}`)
      }
      await new Promise(resolve => setTimeout(resolve, 50))
    }
  }

  /**
   * Waits until a job is actually **running**.
   *
   * This is the load-bearing line of the overlap test, and leaving it out is how
   * an earlier draft of this file passed against a worker with no lock at all.
   * Both requests below return as soon as they have enqueued, so without this
   * wait both jobs start *after* both saves have committed - and since a job
   * re-reads the fields when it runs, both then embed the same, final field set
   * and agree by accident. The race needs the first job to have already read
   * before the second save exists.
   */
  async function waitForActiveJob(timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs

    for (;;) {
      const status = await embedQueueStatus()
      if (status && status.active > 0) return
      if (Date.now() > deadline) throw new Error('No embed job ever became active')
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  }

  beforeAll(async () => {
    // Only for this file, and only in this process. Restored in `afterAll`.
    process.env.REDIS_URL = TEST_REDIS_URL
    // Namespaced away from anything a developer's Redis is already doing, and
    // from the keys a real local run of the application would write.
    process.env.REDIS_KEY_PREFIX = `vuepdf-test-${process.pid}`

    workerHandle = await createEmbedWorker()
  })

  afterAll(async () => {
    await workerHandle?.close()
    await closeEmbedQueue()
    delete process.env.REDIS_URL
    delete process.env.REDIS_KEY_PREFIX
  })

  beforeEach(async () => {
    owner = await createUser()
    pdfKey = `queue-${Date.now()}.pdf`

    await new LocalPdfStorage().put(pdfKey, fs.readFileSync(FIXTURE))

    const membership = await prisma.membership.findFirstOrThrow({
      where: { userId: owner.user.id }
    })
    const form = await prisma.form.create({
      data: {
        organizationId: membership.organizationId,
        createdByUserId: owner.user.id,
        title: 'Queued embed',
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

  it('embeds through a worker, leaving the request itself unchanged', async () => {
    const response = await bulkSave([fieldPayload('alpha', 0)])

    // Goal 2 and goal 16: the response is what it always was. It carries no job
    // id, no status, and nothing that says an embed is pending.
    expect(response.status).toBe(200)
    expect(response.body.fields).toHaveLength(1)
    expect(response.body.archived).toEqual([])
    expect(Object.keys(response.body).sort()).toEqual(['archived', 'fields'])

    await drain()
    expect(await embeddedFieldCount()).toBe(1)
  })

  it('does not drop a save made while an embed is already running', async () => {
    // One field, settled, so the second save has an id to send back.
    const first = await bulkSave([fieldPayload('alpha', 0)])
    expect(first.status).toBe(200)
    const alphaId = first.body.fields[0].id as string
    await drain()

    // From here every embed is slow, so the save below lands while the first
    // job is still in flight.
    setPdfStorage(new SlowReadStorage(new LocalPdfStorage(), 800))

    const a = await bulkSave([fieldPayload('alpha', 0, alphaId)])
    expect(a.status).toBe(200)

    // A's job is now running and stalled inside its read, holding the document
    // as it was before `beta` existed and a field list that does not contain it.
    await waitForActiveJob()

    // Saved while that job is in flight. Two ways this save can be lost, and the
    // test does not care which one is being prevented:
    //
    //   - a stable job id per form would discard it outright, because BullMQ
    //     ignores an `add` for an id that is already active;
    //   - two jobs running at once would both write, and A - holding bytes and
    //     fields from before `beta` - would land last and erase it.
    //
    // Either way the form's PDF ends up permanently behind its fields with no
    // error anywhere, which is the bug features/0016 closed for the inline path.
    const b = await bulkSave([fieldPayload('alpha', 0, alphaId), fieldPayload('beta', 1)])
    expect(b.status).toBe(200)

    await drain()

    const liveFields = await prisma.field.count({ where: { formId, deletedAt: null } })
    expect(liveFields).toBe(2)
    expect(await embeddedFieldCount()).toBe(liveFields)
  })

  it('is idempotent: embedding the same form twice leaves the same document', async () => {
    // Goal 7. A retry is the same job data run again, so re-running an embed
    // that changed nothing must not accumulate anything in the document - a
    // duplicated AcroForm field would break the form for everyone who opens the
    // PDF itself.
    const first = await bulkSave([fieldPayload('alpha', 0), fieldPayload('beta', 1)])
    await drain()

    const countOnce = await embeddedFieldCount()
    expect(countOnce).toBe(2)

    const ids = (first.body.fields as { id: string }[]).map(f => f.id)
    // The same field set again: nothing changes in the database, and another
    // embed job runs over the document the previous one wrote.
    await bulkSave([
      fieldPayload('alpha', 0, ids[0]),
      fieldPayload('beta', 1, ids[1])
    ])
    await drain()

    expect(await embeddedFieldCount()).toBe(countOnce)
  })
})
