import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import { app } from '../src/app'
import { prisma } from '../src/services/db'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import { mockCallerMembership } from './mock-caller.js'
import { PrismaClient } from '@prisma/client'

// Mock Prisma
vi.mock('../src/services/db', async () => {
  const { mockDeep } = await import('vitest-mock-extended')
  return {
    prisma: mockDeep<PrismaClient>()
  }
})

// Mock Auth Middleware
vi.mock('../src/middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = 'user-1'
    next()
  }
}))

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>

describe('Forms Routes', () => {
  beforeEach(() => {
    mockReset(prismaMock)
    mockCallerMembership(prismaMock)
  })

  const mockForm = {
    id: 'form-1',
    organizationId: 'org-1',
    createdByUserId: 'user-1',
    title: 'Test Form',
    description: 'Test description',
    shareId: 'share-123',
    status: 'draft',
    pdfUrl: null,
    settings: null,
    createdAt: new Date(),
    updatedAt: new Date()
  }

  describe('GET /api/forms', () => {
    it('should return list of forms', async () => {
      prismaMock.form.findMany.mockResolvedValue([
        { ...mockForm, _count: { fields: 5, responses: 10 } }
      ] as any)

      const res = await request(app).get('/api/forms')

      expect(res.status).toBe(200)
      expect(res.body.forms).toHaveLength(1)
      expect(res.body.forms[0].title).toBe('Test Form')
    })

    it('should return empty array when no forms', async () => {
      prismaMock.form.findMany.mockResolvedValue([])

      const res = await request(app).get('/api/forms')

      expect(res.status).toBe(200)
      expect(res.body.forms).toHaveLength(0)
    })
  })

  describe('POST /api/forms', () => {
    it('should create a new form', async () => {
      // Creating a form now resolves the caller's organization first — see
      // requireOrganizationId in middleware/formOwnership.ts.
      prismaMock.membership.findFirst.mockResolvedValue({ organizationId: 'org-1' } as any)
      prismaMock.form.create.mockResolvedValue(mockForm as any)

      const res = await request(app)
        .post('/api/forms')
        .send({ title: 'Test Form', description: 'Test description' })

      expect(res.status).toBe(201)
      expect(res.body.form.title).toBe('Test Form')
      expect(res.body.form).toHaveProperty('shareId')
    })

    it('should validate required title', async () => {
      const res = await request(app)
        .post('/api/forms')
        .send({ description: 'Missing title' })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('Validation error')
    })
  })

  describe('GET /api/forms/:id', () => {
    it('should return form by id', async () => {
      prismaMock.form.findFirst.mockResolvedValue({
        ...mockForm,
        fields: []
      } as any)

      const res = await request(app).get('/api/forms/form-1')

      expect(res.status).toBe(200)
      expect(res.body.form.id).toBe('form-1')
      expect(res.body.form).toHaveProperty('fields')
    })

    it('should return 404 if form not found', async () => {
      prismaMock.form.findFirst.mockResolvedValue(null)

      const res = await request(app).get('/api/forms/non-existent')

      expect(res.status).toBe(404)
    })
  })

  describe('PUT /api/forms/:id', () => {
    it('should update form', async () => {
      prismaMock.form.findFirst.mockResolvedValue(mockForm as any)
      prismaMock.form.update.mockResolvedValue({
        ...mockForm,
        title: 'Updated Form'
      } as any)

      const res = await request(app)
        .put('/api/forms/form-1')
        .send({ title: 'Updated Form' })

      expect(res.status).toBe(200)
      expect(res.body.form.title).toBe('Updated Form')
    })

    it('should return 404 if form not found', async () => {
      prismaMock.form.findFirst.mockResolvedValue(null)

      const res = await request(app)
        .put('/api/forms/non-existent')
        .send({ title: 'Updated' })

      expect(res.status).toBe(404)
    })

    it('should update form status', async () => {
      prismaMock.form.findFirst.mockResolvedValue(mockForm as any)
      // Publishing checks the plan's published-form limit since features/0012.
      // An organization with room, so this stays a test about the update.
      prismaMock.organization.findUnique.mockResolvedValue({ planKey: 'free' } as any)
      prismaMock.form.count.mockResolvedValue(0)
      prismaMock.form.update.mockResolvedValue({
        ...mockForm,
        status: 'published'
      } as any)

      const res = await request(app)
        .put('/api/forms/form-1')
        .send({ status: 'published' })

      expect(res.status).toBe(200)
      expect(res.body.form.status).toBe('published')
    })
  })

  describe('DELETE /api/forms/:id', () => {
    it('should delete form', async () => {
      prismaMock.form.findFirst.mockResolvedValue(mockForm as any)
      prismaMock.form.delete.mockResolvedValue(mockForm as any)

      const res = await request(app).delete('/api/forms/form-1')

      expect(res.status).toBe(200)
      expect(res.body.message).toBe('Form deleted')
    })

    it('should return 404 if form not found', async () => {
      prismaMock.form.findFirst.mockResolvedValue(null)

      const res = await request(app).delete('/api/forms/non-existent')

      expect(res.status).toBe(404)
    })
  })

  describe('GET /api/forms/public/:shareId', () => {
    it('should return published form by shareId', async () => {
      prismaMock.form.findUnique.mockResolvedValue({
        ...mockForm,
        status: 'published',
        fields: []
      } as any)

      const res = await request(app).get('/api/forms/public/share-123')

      expect(res.status).toBe(200)
      expect(res.body.form).toHaveProperty('title')
      // Neither the creator nor the owning organization reaches an anonymous
      // respondent.
      expect(res.body.form).not.toHaveProperty('createdByUserId')
      expect(res.body.form).not.toHaveProperty('organizationId')
    })

    it('should return 404 if form not published', async () => {
      prismaMock.form.findUnique.mockResolvedValue({
        ...mockForm,
        status: 'draft'
      } as any)

      const res = await request(app).get('/api/forms/public/share-123')

      expect(res.status).toBe(404)
    })

    it('should return 404 if shareId not found', async () => {
      prismaMock.form.findUnique.mockResolvedValue(null)

      const res = await request(app).get('/api/forms/public/invalid')

      expect(res.status).toBe(404)
    })
  })
})
