import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import fs from 'fs'
import path from 'path'
import { app } from '../../src/app.js'
import { prisma } from '../../src/services/db.js'
import { createUser } from './helpers.js'
import { pdfProcessor } from '../../src/services/pdf-processor.js'
import { LocalPdfStorage, setPdfStorage } from '../../src/services/pdf-storage.js'
import { closeEmbedQueue } from '../../src/services/embed-queue.js'
import { resetOrganizationLocks } from '../../src/services/organization-lock.js'

/**
 * `REDIS_URL` set, Redis not there (features/0017).
 *
 * This is the case `saas-readiness-reviewer` found on the 0017 branch, and it
 * is worth stating why it needed a test of its own. The module claimed that a
 * configured-but-unreachable Redis falls back to running the embed inline, and
 * the `try`/`catch` that was supposed to do it only fires on a **rejection**.
 * The two ways a Redis can be absent are not the same:
 *
 *   - it **refuses** the connection (nothing listening on the port): ioredis
 *     errors quickly, the catch runs, and the fallback worked even before the
 *     fix;
 *   - it **black-holes** the connection (a wrong host, a dropped route, a
 *     security group): nothing refuses anything, and with ioredis' default
 *     retry strategy plus `maxRetriesPerRequest: null` the command waited for a
 *     connection that never came. `queue.add()` never settled, so the catch
 *     never ran and `POST /api/forms/:formId/fields/bulk` never answered. The
 *     fields were already committed - nothing was lost - but the editor sat
 *     waiting on a response that would not arrive, which to the author is a
 *     broken save.
 *
 * So both are exercised here, and the second is the one that matters. It needs
 * no Redis of any kind, which is the point: this runs in CI on every push,
 * unlike the queued-path spec beside it.
 */
describe('embed fallback when Redis is configured but absent', () => {
  const FIXTURE = path.join(process.cwd(), 'test-fixtures', 'valid.pdf')

  let owner: Awaited<ReturnType<typeof createUser>>
  let formId: string
  let pdfKey: string

  function bulkSave(fields: unknown[]) {
    return request(app)
      .post(`/api/forms/${formId}/fields/bulk`)
      .set('Authorization', owner.authHeader)
      .send({ fields })
  }

  function fieldPayload(name: string, order: number) {
    return {
      type: 'text',
      name,
      label: name,
      required: false,
      position: { x: 10, y: 20 + order * 30, width: 100, height: 20, page: 1 },
      order
    }
  }

  async function embeddedFieldCount(): Promise<number> {
    const stored = await new LocalPdfStorage().get(pdfKey)
    return (await pdfProcessor.extractFieldsFromPDF(stored)).length
  }

  beforeEach(async () => {
    resetOrganizationLocks()

    owner = await createUser()
    pdfKey = `fallback-${Date.now()}.pdf`
    await new LocalPdfStorage().put(pdfKey, fs.readFileSync(FIXTURE))

    const membership = await prisma.membership.findFirstOrThrow({
      where: { userId: owner.user.id }
    })
    const form = await prisma.form.create({
      data: {
        organizationId: membership.organizationId,
        createdByUserId: owner.user.id,
        title: 'Fallback',
        shareId: `share-${Math.random().toString(36).slice(2, 11)}`,
        status: 'draft',
        pdfUrl: `http://localhost:3000/uploads/pdfs/${pdfKey}`
      }
    })
    formId = form.id
  })

  afterEach(async () => {
    delete process.env.REDIS_URL
    await closeEmbedQueue()
    setPdfStorage(null)
    await new LocalPdfStorage().remove(pdfKey)
  })

  it('embeds inline when the configured Redis refuses the connection', async () => {
    // Nothing listens on port 1. ioredis reports ECONNREFUSED quickly.
    process.env.REDIS_URL = 'redis://127.0.0.1:1'

    const response = await bulkSave([fieldPayload('alpha', 0)])

    expect(response.status).toBe(200)
    // The assertion that matters: the embed was not merely "not crashed", it
    // actually happened.
    expect(await embeddedFieldCount()).toBe(1)
  })

  it('embeds inline, and answers, when the configured Redis black-holes the connection', async () => {
    // 192.0.2.0/24 is TEST-NET-1 (RFC 5737): reserved for documentation and
    // guaranteed not to be routed, so the connection attempt hangs rather than
    // being refused. This is the shape that hung the save before the deadline
    // in `withDeadline` and the bounded connection options existed.
    process.env.REDIS_URL = 'redis://192.0.2.1:6379'

    const started = Date.now()
    const response = await bulkSave([fieldPayload('alpha', 0), fieldPayload('beta', 1)])
    const elapsed = Date.now() - started

    expect(response.status).toBe(200)
    expect(await embeddedFieldCount()).toBe(2)

    // The bound is the property under test. Before the fix this never returned
    // at all; a generous ceiling still fails an unbounded wait.
    expect(elapsed).toBeLessThan(20_000)
  })
})
