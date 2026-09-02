import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { Readable } from 'stream'
import request from 'supertest'
import { app } from '../../src/app.js'
import { prisma } from '../../src/services/db.js'
import { setPdfStorage, type PdfStorageDriver } from '../../src/services/pdf-storage.js'
import { canonicalPdfUrl } from '../../src/services/pdf-url.js'

/**
 * Account deletion, and erasure that reaches the documents (features/0029).
 *
 * These are database-backed on purpose. Every assertion here is about a cascade
 * or about rows surviving a refusal, and a mocked Prisma client cannot express
 * either — which is the rule in docs/sot/09-quality-and-testing.md and the
 * reason this repository's data-loss defect shipped green once already.
 *
 * Storage is an in-memory driver rather than the local disk one, so "which keys
 * still exist" is an exact question with an exact answer and nothing leaks
 * between tests through `backend/uploads/`.
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

  /** "Succeeds when it was already gone", per the interface. */
  async remove(key: string): Promise<void> {
    this.objects.delete(key)
  }
}

let storage: MemoryPdfStorage

const password = 'TestPassword123!'
const email = () => `acct-${Date.now()}-${Math.random().toString(36).slice(2, 10)}@example.com`

/** Registers through the real endpoint, so the password hash is a real one. */
async function register(address = email()) {
  const res = await request(app).post('/api/auth/register').send({ email: address, password, name: 'Test Person' })
  expect(res.status).toBe(201)

  const membership = await prisma.membership.findFirstOrThrow({ where: { userId: res.body.user.id } })

  return {
    address,
    userId: res.body.user.id as string,
    organizationId: membership.organizationId,
    authHeader: `Bearer ${res.body.token}`
  }
}

/** A form pointing at `key`, with the document actually in storage. */
async function formWithDocument(userId: string, key: string, title = 'Test Form') {
  const membership = await prisma.membership.findFirstOrThrow({ where: { userId } })
  await storage.put(key, Buffer.from('%PDF-1.4 fake'))

  return prisma.form.create({
    data: {
      organizationId: membership.organizationId,
      createdByUserId: userId,
      title,
      shareId: `share-${Math.random().toString(36).slice(2, 11)}`,
      status: 'draft',
      pdfUrl: canonicalPdfUrl(key)
    }
  })
}

beforeEach(() => {
  storage = new MemoryPdfStorage()
  setPdfStorage(storage)
})

afterAll(() => {
  setPdfStorage(null)
})

describe('deleting a form removes its document', () => {
  it('removes the stored PDF', async () => {
    const owner = await register()
    const form = await formWithDocument(owner.userId, 'only-form.pdf')

    const res = await request(app).delete(`/api/forms/${form.id}`).set('Authorization', owner.authHeader)

    expect(res.status).toBe(200)
    expect(await storage.exists('only-form.pdf')).toBe(false)
  })

  /**
   * **The trap this feature exists to avoid** (features/0029 §2).
   *
   * `Form.pdfUrl` is an unconstrained client-supplied string, so two forms can
   * point at one key — and nothing makes them belong to the same organization.
   * An unconditional `remove(pdfFilenameFrom(form.pdfUrl))` therefore destroys
   * a document another form, possibly another tenant's, is still using.
   */
  it('leaves a document another form still references', async () => {
    const owner = await register()
    const shared = 'shared-key.pdf'
    const first = await formWithDocument(owner.userId, shared, 'First')
    const second = await formWithDocument(owner.userId, shared, 'Second')

    await request(app).delete(`/api/forms/${first.id}`).set('Authorization', owner.authHeader).expect(200)

    expect(await storage.exists(shared)).toBe(true)

    await request(app).delete(`/api/forms/${second.id}`).set('Authorization', owner.authHeader).expect(200)

    expect(await storage.exists(shared)).toBe(false)
  })

  it('never reaches across a tenant boundary', async () => {
    const mine = await register()
    const theirs = await register()
    const shared = 'cross-tenant.pdf'

    const myForm = await formWithDocument(mine.userId, shared)
    await formWithDocument(theirs.userId, shared)

    await request(app).delete(`/api/forms/${myForm.id}`).set('Authorization', mine.authHeader).expect(200)

    expect(await storage.exists(shared)).toBe(true)
  })

  it('deletes cleanly when the document is already gone from storage', async () => {
    const owner = await register()
    const form = await formWithDocument(owner.userId, 'vanished.pdf')
    await storage.remove('vanished.pdf')

    await request(app).delete(`/api/forms/${form.id}`).set('Authorization', owner.authHeader).expect(200)

    expect(await prisma.form.findUnique({ where: { id: form.id } })).toBeNull()
  })

  /**
   * `scripts/migrate-existing-forms.ts` writes `<key>-backup.pdf` beside the
   * original. It is the same customer document, so it goes when the original
   * does — and stays while any form still references the original.
   */
  it('removes the migration backup beside the document', async () => {
    const owner = await register()
    const form = await formWithDocument(owner.userId, 'with-backup.pdf')
    await storage.put('with-backup-backup.pdf', Buffer.from('%PDF-1.4 older'))

    await request(app).delete(`/api/forms/${form.id}`).set('Authorization', owner.authHeader).expect(200)

    expect(await storage.exists('with-backup-backup.pdf')).toBe(false)
  })
})

describe('DELETE /api/account', () => {
  it('refuses a wrong password and deletes nothing', async () => {
    const owner = await register()
    const form = await formWithDocument(owner.userId, 'kept.pdf')

    const res = await request(app)
      .delete('/api/account')
      .set('Authorization', owner.authHeader)
      .send({ password: 'NotThePassword1!' })

    expect(res.status).toBe(401)
    expect(await prisma.user.findUnique({ where: { id: owner.userId } })).not.toBeNull()
    expect(await prisma.form.findUnique({ where: { id: form.id } })).not.toBeNull()
    expect(await storage.exists('kept.pdf')).toBe(true)
  })

  it('deletes the account, its sole-member organization, its forms and its documents', async () => {
    const owner = await register()
    const form = await formWithDocument(owner.userId, 'erased.pdf')

    const field = await prisma.field.create({
      data: {
        formId: form.id,
        type: 'text',
        name: 'field_1',
        label: 'Field 1',
        required: false,
        position: { x: 1, y: 2, width: 3, height: 4, page: 1 },
        order: 0
      }
    })
    const response = await prisma.response.create({
      data: { formId: form.id, ipAddress: '127.0.0.1', answers: { create: [{ fieldId: field.id, value: 'x' }] } }
    })

    const res = await request(app)
      .delete('/api/account')
      .set('Authorization', owner.authHeader)
      .send({ password })

    expect(res.status).toBe(200)

    expect(await prisma.user.findUnique({ where: { id: owner.userId } })).toBeNull()
    expect(await prisma.organization.findUnique({ where: { id: owner.organizationId } })).toBeNull()
    expect(await prisma.form.findUnique({ where: { id: form.id } })).toBeNull()
    expect(await prisma.response.findUnique({ where: { id: response.id } })).toBeNull()
    expect(await prisma.answer.count()).toBe(0)
    expect(await prisma.membership.count()).toBe(0)
    expect(await prisma.refreshToken.count({ where: { userId: owner.userId } })).toBe(0)
    expect(await storage.exists('erased.pdf')).toBe(false)
  })

  /**
   * The rule the backlog said had to be decided alongside account deletion:
   * an organization with other people in it is not the account holder's to
   * destroy, so the request is refused rather than resolved by guessing.
   */
  it('refuses the last owner of an organization that still has members, and deletes nothing', async () => {
    const owner = await register()
    const colleague = await register()

    await prisma.membership.create({
      data: { organizationId: owner.organizationId, userId: colleague.userId, role: 'member' }
    })
    const form = await formWithDocument(owner.userId, 'company.pdf')

    const res = await request(app)
      .delete('/api/account')
      .set('Authorization', owner.authHeader)
      .send({ password })

    expect(res.status).toBe(409)
    expect(await prisma.user.findUnique({ where: { id: owner.userId } })).not.toBeNull()
    expect(await prisma.organization.findUnique({ where: { id: owner.organizationId } })).not.toBeNull()
    expect(await prisma.form.findUnique({ where: { id: form.id } })).not.toBeNull()
    expect(await storage.exists('company.pdf')).toBe(true)
  })

  it('refuses the last owner of an organization with a pending invitation', async () => {
    const owner = await register()

    await prisma.invitation.create({
      data: {
        organizationId: owner.organizationId,
        email: 'pending@example.com',
        role: 'member',
        tokenHash: 'hash',
        invitedByUserId: owner.userId,
        expiresAt: new Date(Date.now() + 86_400_000)
      }
    })

    const res = await request(app)
      .delete('/api/account')
      .set('Authorization', owner.authHeader)
      .send({ password })

    expect(res.status).toBe(409)
    expect(await prisma.user.findUnique({ where: { id: owner.userId } })).not.toBeNull()
  })

  /**
   * A member who is not the last owner takes their account and nothing else.
   * `Form.createdBy` is `SetNull`, so the forms they made stay with the
   * organization — the property features/0009 built and this must not undo.
   */
  it('lets a non-last-owner leave, and the organization survives with its forms', async () => {
    const owner = await register()
    const colleague = await register()

    await prisma.membership.create({
      data: { organizationId: owner.organizationId, userId: colleague.userId, role: 'member' }
    })

    const form = await formWithDocument(colleague.userId, 'made-by-colleague.pdf')
    await prisma.form.update({
      where: { id: form.id },
      data: { organizationId: owner.organizationId, createdByUserId: colleague.userId }
    })

    const res = await request(app)
      .delete('/api/account')
      .set('Authorization', colleague.authHeader)
      .send({ password })

    expect(res.status).toBe(200)

    expect(await prisma.user.findUnique({ where: { id: colleague.userId } })).toBeNull()
    expect(await prisma.organization.findUnique({ where: { id: owner.organizationId } })).not.toBeNull()

    const survivor = await prisma.form.findUnique({ where: { id: form.id } })
    expect(survivor).not.toBeNull()
    expect(survivor!.createdByUserId).toBeNull()
    expect(await storage.exists('made-by-colleague.pdf')).toBe(true)
  })

  it('requires authentication', async () => {
    await request(app).delete('/api/account').send({ password }).expect(401)
  })
})
