import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { Readable } from 'stream'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { PDFDocument } from 'pdf-lib'
import { app } from '../../src/app.js'
import { prisma } from '../../src/services/db.js'
import { setPdfStorage, type PdfStorageDriver } from '../../src/services/pdf-storage.js'
import { createUser } from './helpers.js'

/**
 * An upload belongs to an organization (features/0039).
 *
 * **This suite is a bug reproduction, not a regression guard**, and the
 * distinction matters: the first two tests were written before the fix, run
 * against the unfixed code, and seen to fail. Recorded in features/0039's
 * Outcome. A test written after the fix would only prove that the code agrees
 * with itself.
 *
 * The defect: `Form.pdfUrl` was a client-supplied string that nothing checked
 * the ownership of, and the filename is not a secret — `GET
 * /api/forms/public/:shareId` hands it to every respondent, because their
 * browser has to fetch the document. So anyone who was ever sent a share link
 * could point their own form at another organization's document and have the
 * API mint them fresh signed URLs for ever, defeating `UPLOAD_URL_TTL_SECONDS`.
 * And it ran backwards too: `collectOrphanDocuments` keeps a key while any
 * surviving form references it, so that stranger's row pinned the victim's
 * document alive against the victim's own deletion.
 *
 * Database-backed on purpose. The subject is a cross-tenant boundary and a
 * cascade, and a mocked Prisma client can express neither
 * (docs/sot/09-quality-and-testing.md).
 *
 * Storage is the in-memory driver `account-deletion.spec.ts` uses, so "which
 * keys still exist" is an exact question and nothing leaks between tests
 * through `backend/uploads/`.
 */

/** The `PdfStorageDriver` contract, held in a Map. */
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

/** A published form on `pdfUrl`. Free allows exactly one, so use it once per org. */
async function publishForm(authHeader: string, pdfUrl: string) {
  const created = await request(app)
    .post('/api/forms')
    .set('Authorization', authHeader)
    .send({ title: 'Alice questionnaire', pdfUrl })

  expect(created.status).toBe(201)

  await request(app)
    .patch(`/api/forms/${created.body.form.id}/status`)
    .set('Authorization', authHeader)
    .send({ status: 'published' })
    .expect(200)

  return created.body.form as { id: string; shareId: string }
}

beforeEach(() => {
  storage = new MemoryPdfStorage()
  setPdfStorage(storage)
})

afterAll(() => {
  setPdfStorage(null)
})

describe('a form cannot point at another organization document', () => {
  /**
   * The whole attack, in the order an attacker performs it. No guessing at any
   * step: step 3 is the product handing the filename over, by design.
   */
  it('refuses a pdfUrl whose key belongs to another organization', async () => {
    const alice = await createUser('alice-0039@example.com')
    const bob = await createUser('bob-0039@example.com')

    const document = await upload(alice.authHeader)
    const form = await publishForm(alice.authHeader, document.url)

    // Bob fills in Alice's public form like anyone else, and is handed a signed
    // URL that contains the filename.
    const publicView = await request(app).get(`/api/forms/public/${form.shareId}`)
    expect(publicView.status).toBe(200)
    const leaked = String(publicView.body.form.pdfUrl).split('/').pop()
    expect(leaked).toBe(document.filename)

    const stolen = await request(app)
      .post('/api/forms')
      .set('Authorization', bob.authHeader)
      .send({ title: "Bob's copy", pdfUrl: leaked })

    expect(stolen.status).toBe(400)

    // And nothing of Bob's ends up referencing Alice's document.
    const bobForms = await prisma.form.findMany({
      where: { organizationId: bob.organization.id },
      select: { pdfUrl: true }
    })
    expect(bobForms.some(f => f.pdfUrl?.includes(document.filename))).toBe(false)
  })

  /**
   * The same door, one endpoint along. `PUT /api/forms/:id` took `pdfUrl`
   * through the identical unchecked path, so a stranger did not even need to
   * create the form with it.
   */
  it('refuses the same key on an update to a form the caller does own', async () => {
    const alice = await createUser('alice-patch-0039@example.com')
    const bob = await createUser('bob-patch-0039@example.com')

    const document = await upload(alice.authHeader)
    await publishForm(alice.authHeader, document.url)

    const bobForm = await request(app)
      .post('/api/forms')
      .set('Authorization', bob.authHeader)
      .send({ title: "Bob's own form" })
      .expect(201)

    const stolen = await request(app)
      .put(`/api/forms/${bobForm.body.form.id}`)
      .set('Authorization', bob.authHeader)
      .send({ pdfUrl: document.filename })

    expect(stolen.status).toBe(400)

    const stored = await prisma.form.findUniqueOrThrow({ where: { id: bobForm.body.form.id } })
    expect(stored.pdfUrl).toBeNull()
  })

  /**
   * The half that is an erasure defect rather than a confidentiality one, and
   * it is asserted end to end because that is the only honest way to assert it.
   *
   * `collectOrphanDocuments` keeps a key while any surviving form references it,
   * and **that stays true after this feature** — same-organization aliasing is
   * real, so the collector must not be made less conservative. What changes is
   * that a *stranger* can no longer create the reference. So the test drives the
   * whole path through the API rather than planting a row: Bob tries the steal,
   * Alice deletes her form, and her document is gone.
   *
   * Against the unfixed code both halves failed — Bob's create answered `201`
   * and Alice's document was still in storage afterwards, pinned by his row.
   */
  it('lets an owner erase a document a stranger tried to claim', async () => {
    const alice = await createUser('alice-gc-0039@example.com')
    const bob = await createUser('bob-gc-0039@example.com')

    const document = await upload(alice.authHeader)
    const form = await publishForm(alice.authHeader, document.url)

    const publicView = await request(app).get(`/api/forms/public/${form.shareId}`)
    const leaked = String(publicView.body.form.pdfUrl).split('/').pop()

    const stolen = await request(app)
      .post('/api/forms')
      .set('Authorization', bob.authHeader)
      .send({ title: "Bob's squatting form", pdfUrl: leaked })
    expect(stolen.status).toBe(400)

    await request(app)
      .delete(`/api/forms/${form.id}`)
      .set('Authorization', alice.authHeader)
      .expect(200)

    expect(await storage.exists(document.filename)).toBe(false)
    expect(await prisma.upload.findUnique({ where: { key: document.filename } })).toBeNull()
  })

  /**
   * The conservatism that must survive: a second form **in the same
   * organization** on one document is legitimate, so deleting one of them keeps
   * the bytes. This is the assertion that fails if somebody ever "simplifies"
   * `stillReferenced` now that keys have owners.
   */
  it('keeps the document while another form in the same organization uses it', async () => {
    const alice = await createUser('alice-alias-0039@example.com')

    // Drafts, deliberately: Free allows one *published* form, and what is being
    // asserted is aliasing, not the plan limit.
    const document = await upload(alice.authHeader)
    const first = await draftForm(alice.authHeader, document.url)
    await draftForm(alice.authHeader, document.url)

    await request(app)
      .delete(`/api/forms/${first.id}`)
      .set('Authorization', alice.authHeader)
      .expect(200)

    expect(await storage.exists(document.filename)).toBe(true)
    expect(await prisma.upload.findUnique({ where: { key: document.filename } })).not.toBeNull()
  })
})

describe('an upload stays usable inside its own organization', () => {
  it('lets two forms in the same organization share one document', async () => {
    const alice = await createUser('alice-reuse-0039@example.com')
    const document = await upload(alice.authHeader)

    await request(app)
      .post('/api/forms')
      .set('Authorization', alice.authHeader)
      .send({ title: 'First', pdfUrl: document.url })
      .expect(201)

    await request(app)
      .post('/api/forms')
      .set('Authorization', alice.authHeader)
      .send({ title: 'Second', pdfUrl: document.url })
      .expect(201)
  })

  /**
   * **The reason the check is scoped to the organization and not to the user.**
   *
   * A colleague uploads the document and somebody else builds the form on it.
   * That is ordinary B2B use and it worked before this feature; a user-scoped
   * check would have broken it silently, which is why this test exists rather
   * than being implied by the one above.
   */
  it('lets a colleague build a form on an upload somebody else made', async () => {
    const owner = await createUser('owner-0039@example.com')
    const colleague = await prisma.user.create({
      data: { email: 'colleague-0039@example.com', passwordHash: 'not-a-real-hash', name: 'Colleague' }
    })
    await prisma.membership.create({
      data: { organizationId: owner.organization.id, userId: colleague.id, role: 'member' }
    })
    const colleagueAuth = `Bearer ${jwt.sign({ userId: colleague.id }, process.env.JWT_SECRET!, { expiresIn: '1h' })}`

    const document = await upload(owner.authHeader)

    const built = await request(app)
      .post('/api/forms')
      .set('Authorization', colleagueAuth)
      .send({ title: "Built on the owner's upload", pdfUrl: document.url })

    expect(built.status).toBe(201)
    expect(built.body.form.pdfUrl).toContain(document.filename)
  })
})

describe('a pdfUrl that names no upload is rejected rather than dropped', () => {
  /**
   * Both endpoints used to accept a malformed value and quietly discard it:
   * `POST` wrote `null` and `PATCH` dropped the key from the update. The
   * customer was told 201/200 and got a form with no document.
   */
  it('rejects a malformed pdfUrl on create instead of writing null', async () => {
    const alice = await createUser('alice-malformed-0039@example.com')

    const res = await request(app)
      .post('/api/forms')
      .set('Authorization', alice.authHeader)
      .send({ title: 'Nonsense', pdfUrl: 'not-a-pdf-at-all' })

    expect(res.status).toBe(400)
  })

  it('rejects a malformed pdfUrl on update instead of dropping it', async () => {
    const alice = await createUser('alice-malformed-patch-0039@example.com')
    const document = await upload(alice.authHeader)

    const form = await request(app)
      .post('/api/forms')
      .set('Authorization', alice.authHeader)
      .send({ title: 'Real', pdfUrl: document.url })
      .expect(201)

    const res = await request(app)
      .put(`/api/forms/${form.body.form.id}`)
      .set('Authorization', alice.authHeader)
      .send({ pdfUrl: '../../etc/passwd' })

    expect(res.status).toBe(400)

    // The document it already had is untouched by the refusal.
    const stored = await prisma.form.findUniqueOrThrow({ where: { id: form.body.form.id } })
    expect(stored.pdfUrl).toContain(document.filename)
  })

  /**
   * An upload has to land in an organization, so a caller with no membership
   * has nowhere to put one. No real account is in this state — registration
   * creates a personal organization transactionally — so this asserts the
   * boundary rather than a flow anybody walks.
   */
  it('refuses an upload from a caller with no membership', async () => {
    const stray = await prisma.user.create({
      data: { email: 'stray-0039@example.com', passwordHash: 'not-a-real-hash', name: 'Stray' }
    })
    const auth = `Bearer ${jwt.sign({ userId: stray.id }, process.env.JWT_SECRET!, { expiresIn: '1h' })}`

    const res = await request(app)
      .post('/api/upload')
      .set('Authorization', auth)
      .attach('pdf', await pdfBytes(), 'document.pdf')

    expect(res.status).toBe(404)
    expect(storage.objects.size).toBe(0)
  })
})
