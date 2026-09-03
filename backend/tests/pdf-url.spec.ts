import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import fs from 'fs'
import path from 'path'
import { app } from '../src/app'
import { prisma } from '../src/services/db'
import { signPdfUrl, verifyPdfToken, canonicalPdfUrl } from '../src/services/pdf-url'
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import { mockCallerMembership } from './mock-caller.js'
import { PrismaClient } from '@prisma/client'

vi.mock('../src/services/db', async () => {
  const { mockDeep } = await import('vitest-mock-extended')
  return { prisma: mockDeep<PrismaClient>() }
})

vi.mock('../src/middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => { req.userId = 'user-1'; next() }
}))

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>

const FIXTURE = path.join(process.cwd(), 'test-fixtures', 'valid.pdf')
const UPLOADS = path.join(process.cwd(), 'uploads', 'pdfs')
const FILENAME = 'test-signed-url-fixture.pdf'
const ON_DISK = path.join(UPLOADS, FILENAME)
const CANONICAL = `http://localhost:3000/uploads/pdfs/${FILENAME}`

/** The path part of a signed absolute URL, for handing to supertest. */
function signedPath(canonical: string): string {
  return new URL(signPdfUrl(canonical)!).pathname
}

beforeAll(() => {
  fs.mkdirSync(UPLOADS, { recursive: true })
  fs.copyFileSync(FIXTURE, ON_DISK)
})

afterAll(() => {
  if (fs.existsSync(ON_DISK)) fs.unlinkSync(ON_DISK)
})

beforeEach(() => {
  mockReset(prismaMock)
  mockCallerMembership(prismaMock)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('Serving an uploaded PDF', () => {
  it('does not serve the file from the plain /uploads/pdfs/<filename> path', async () => {
    const res = await request(app).get(`/uploads/pdfs/${FILENAME}`)

    expect(res.status).toBe(404)
  })

  it('serves the file from a signed URL', async () => {
    const res = await request(app).get(signedPath(CANONICAL))

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('application/pdf')
    expect(res.headers['cache-control']).toBe('private, no-store')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.body).toEqual(fs.readFileSync(ON_DISK))
  })

  it('rejects a token signed for a different filename', async () => {
    const otherFile = 'test-signed-url-other.pdf'
    const stolenToken = new URL(signPdfUrl(`http://localhost:3000/uploads/pdfs/${otherFile}`)!)
      .pathname.split('/')[3]

    const res = await request(app).get(`/uploads/pdfs/${stolenToken}/${FILENAME}`)

    expect(res.status).toBe(403)
    expect(res.body.error).toBe('This link is invalid or has expired.')
  })

  it('rejects a tampered signature', async () => {
    const validPath = signedPath(CANONICAL)
    // Flip the final hex character of the HMAC.
    const last = validPath[validPath.lastIndexOf('/') - 1]!
    const tampered =
      validPath.slice(0, validPath.lastIndexOf('/') - 1) +
      (last === 'a' ? 'b' : 'a') +
      validPath.slice(validPath.lastIndexOf('/'))

    const res = await request(app).get(tampered)

    expect(res.status).toBe(403)
    expect(res.body.error).toBe('This link is invalid or has expired.')
  })

  it('rejects an expired token, and says nothing more than "invalid"', async () => {
    // Configured the way a deploy configures it, not by reaching into the module.
    vi.stubEnv('UPLOAD_URL_TTL_SECONDS', '60')
    const validPath = signedPath(CANONICAL)

    // The link works now...
    expect((await request(app).get(validPath)).status).toBe(200)

    // ...and not 61 seconds from now.
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 61_000)

    const res = await request(app).get(validPath)

    expect(res.status).toBe(403)
    // Deliberately indistinguishable from a forged signature.
    expect(res.body.error).toBe('This link is invalid or has expired.')
  })

  it('returns 404 when the signature is valid but the file is gone', async () => {
    const missing = canonicalPdfUrl('http://localhost:3000/uploads/pdfs/no-such-file.pdf')!

    const res = await request(app).get(signedPath(missing))

    expect(res.status).toBe(404)
  })

  it('never resolves a bare .. as a filename', async () => {
    const token = new URL(signPdfUrl(CANONICAL)!).pathname.split('/')[3]

    const res = await request(app).get(`/uploads/pdfs/${token}/..`)

    // The router normalises `/uploads/pdfs/<token>/..` down to `/uploads/pdfs/`
    // before any handler sees it, so this lands on the catch-all rather than on
    // the filename guard. Either way nothing is served.
    expect(res.status).toBe(404)
  })

  it.each([
    ['a traversal attempt', '..%2f..%2fetc%2fpasswd'],
    ['a non-PDF', 'payload.exe'],
    ['a double extension', 'payload.pdf.exe'],
    ['an encoded separator', 'a%2f..%2f..%2fpackage.json']
  ])('refuses %s as a filename', async (_label, filename) => {
    const token = new URL(signPdfUrl(CANONICAL)!).pathname.split('/')[3]

    const res = await request(app).get(`/uploads/pdfs/${token}/${filename}`)

    expect(res.status).toBe(403)
  })
})

describe('The API mints a signed URL on every read', () => {
  const storedForm = {
    id: 'form-1',
    organizationId: 'org-1',
    createdByUserId: 'user-1',
    title: 'Test',
    description: null,
    shareId: 'share-1',
    status: 'published',
    pdfUrl: CANONICAL,
    settings: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    viewCount: 0,
    fields: []
  }

  /** Asserts the value is a signed URL for our fixture, not the stored one. */
  function expectSigned(pdfUrl: string) {
    expect(pdfUrl).not.toBe(CANONICAL)

    const segments = new URL(pdfUrl).pathname.split('/')
    const token = segments[3]!
    const filename = segments[4]!

    expect(filename).toBe(FILENAME)
    expect(verifyPdfToken(token, filename)).toBe('ok')
  }

  it('signs pdfUrl in GET /api/forms', async () => {
    prismaMock.form.findMany.mockResolvedValue([storedForm as any])

    const res = await request(app).get('/api/forms')

    expect(res.status).toBe(200)
    expectSigned(res.body.forms[0].pdfUrl)
  })

  it('signs pdfUrl in GET /api/forms/:id', async () => {
    prismaMock.form.findFirst.mockResolvedValue({ ...storedForm, fields: [{ id: 'f1' }] } as any)

    const res = await request(app).get('/api/forms/form-1')

    expect(res.status).toBe(200)
    expectSigned(res.body.form.pdfUrl)
  })

  it('signs pdfUrl in GET /api/forms/public/:shareId', async () => {
    prismaMock.form.findUnique.mockResolvedValue(storedForm as any)
    prismaMock.form.update.mockResolvedValue(storedForm as any)

    const res = await request(app).get('/api/forms/public/share-1')

    expect(res.status).toBe(200)
    expectSigned(res.body.form.pdfUrl)
    // The existing guarantee, not to be regressed by the new serializer.
    expect(res.body.form.createdByUserId).toBeUndefined()
    expect(res.body.form.organizationId).toBeUndefined()
  })

  it('keeps the stored URL canonical when a client sends back a signed one', async () => {
    prismaMock.form.findFirst.mockResolvedValue(storedForm as any)
    prismaMock.form.update.mockResolvedValue(storedForm as any)
    // Since features/0039 a `pdfUrl` must name an upload belonging to the
    // acting organization, so the row has to exist for this test to reach the
    // behaviour it is about. Note what is being asserted through it: the
    // ownership check takes the value the client sent — a *signed* URL — and
    // still stores the canonical one.
    prismaMock.upload.findUnique.mockResolvedValue({ organizationId: 'org-1' } as never)

    const signed = signPdfUrl(CANONICAL)!
    const res = await request(app).put('/api/forms/form-1').send({ pdfUrl: signed })

    expect(res.status).toBe(200)
    expect(prismaMock.form.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ pdfUrl: CANONICAL }) })
    )
  })
})
