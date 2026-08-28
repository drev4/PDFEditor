import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import fs from 'fs'
import path from 'path'
import { app } from '../src/app'
import { signPdfUrl } from '../src/services/pdf-url'
import { PrismaClient } from '@prisma/client'

vi.mock('../src/services/db', async () => {
  const { mockDeep } = await import('vitest-mock-extended')
  return { prisma: mockDeep<PrismaClient>() }
})

const FIXTURE = path.join(process.cwd(), 'test-fixtures', 'valid.pdf')
const UPLOADS = path.join(process.cwd(), 'uploads', 'pdfs')
const FILENAME = 'test-security-headers-fixture.pdf'
const ON_DISK = path.join(UPLOADS, FILENAME)

/** The path part of a signed absolute URL, for handing to supertest. */
function signedPath(): string {
  const signed = signPdfUrl(`http://localhost:3000/uploads/pdfs/${FILENAME}`)!
  return new URL(signed).pathname
}

beforeAll(() => {
  fs.mkdirSync(UPLOADS, { recursive: true })
  fs.copyFileSync(FIXTURE, ON_DISK)
})

afterAll(() => {
  if (fs.existsSync(ON_DISK)) fs.unlinkSync(ON_DISK)
})

describe('security headers (S5)', () => {
  describe('API responses', () => {
    it('sets nosniff and a referrer policy, and does not advertise Express', async () => {
      const res = await request(app).get('/health')

      expect(res.status).toBe(200)
      expect(res.headers['x-content-type-options']).toBe('nosniff')
      expect(res.headers['referrer-policy']).toBe('no-referrer')
      expect(res.headers['x-powered-by']).toBeUndefined()
    })

    it('sends no Content-Security-Policy, because this process serves no document', async () => {
      // Not an oversight — see the comment in src/app.ts. A CSP constrains a
      // document; the API serves JSON. The policy that matters is delivered
      // with the SPA, and asserting its absence here is what stops someone
      // "fixing" that by adding a policy that governs nothing.
      const res = await request(app).get('/health')

      expect(res.headers['content-security-policy']).toBeUndefined()
    })

    it('does not send HSTS when ENABLE_HSTS is off', async () => {
      // The default. A browser that sees HSTS from localhost forces HTTPS on
      // localhost for every port afterwards, which breaks unrelated local work.
      const res = await request(app).get('/health')

      expect(res.headers['strict-transport-security']).toBeUndefined()
    })

    it('keeps cross-origin resource policy closed on API responses', async () => {
      const res = await request(app).get('/health')

      expect(res.headers['cross-origin-resource-policy']).toBe('same-origin')
    })
  })

  describe('the signed PDF route', () => {
    it('still serves the file', async () => {
      // The regression this whole describe block exists to catch: helmet's
      // default `Cross-Origin-Resource-Policy: same-origin` blocks the SPA —
      // a different origin — from fetching a PDF, and it fails as a blank
      // viewer rather than an error.
      const res = await request(app).get(signedPath())

      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toBe('application/pdf')
      expect(res.body.length).toBeGreaterThan(0)
    })

    it('opens CORP to cross-origin so the SPA can fetch it', async () => {
      const res = await request(app).get(signedPath())

      expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin')
    })

    it('serves the PDF under a policy that stops it acting as a document', async () => {
      const res = await request(app).get(signedPath())

      const csp = res.headers['content-security-policy']
      expect(csp).toBeDefined()
      expect(csp).toContain("default-src 'none'")
      expect(csp).toContain("object-src 'none'")
      expect(csp).toContain("frame-ancestors 'none'")
      expect(csp).toContain('sandbox')
      expect(res.headers['x-frame-options']).toBe('DENY')
    })

    it('keeps the headers features/0006 set', async () => {
      const res = await request(app).get(signedPath())

      expect(res.headers['x-content-type-options']).toBe('nosniff')
      expect(res.headers['cache-control']).toBe('private, no-store')
      expect(res.headers['content-disposition']).toContain('inline')
    })

    it('applies the headers to a rejected token too', async () => {
      const res = await request(app).get(`/uploads/pdfs/not-a-valid-token/${FILENAME}`)

      expect(res.status).toBe(403)
      expect(res.headers['x-content-type-options']).toBe('nosniff')
      expect(res.headers['x-powered-by']).toBeUndefined()
    })
  })
})
