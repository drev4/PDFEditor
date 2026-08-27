import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import { app } from '../src/app'
import { prisma } from '../src/services/db'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
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

describe('Fields Routes', () => {
  beforeEach(() => {
    mockReset(prismaMock)
  })

  const mockForm = {
    id: 'form-1',
    userId: 'user-1',
    title: 'Test Form',
    shareId: 'share-123'
  }

  const mockFieldData = {
    type: 'text' as const,
    name: 'field1',
    label: 'Field 1',
    required: true,
    position: { x: 10, y: 20, width: 100, height: 30, page: 1 },
    order: 0
  }

  describe('POST /api/forms/:formId/fields', () => {
    it('should create a new field', async () => {
      prismaMock.form.findFirst.mockResolvedValue(mockForm as any)
      prismaMock.field.create.mockResolvedValue({
        id: 'field-1',
        formId: 'form-1',
        ...mockFieldData
      } as any)

      const res = await request(app)
        .post('/api/forms/form-1/fields')
        .send(mockFieldData)

      expect(res.status).toBe(201)
      expect(res.body.field).toHaveProperty('id')
      expect(res.body.field.name).toBe('field1')
    })

    it('should return 404 if form not found', async () => {
      prismaMock.form.findFirst.mockResolvedValue(null)

      const res = await request(app)
        .post('/api/forms/form-1/fields')
        .send(mockFieldData)

      expect(res.status).toBe(404)
    })
  })

  describe('PUT /api/forms/:formId/fields/:fieldId', () => {
    it('should update a field', async () => {
      prismaMock.form.findFirst.mockResolvedValue(mockForm as any)
      prismaMock.field.findFirst.mockResolvedValue({
        id: 'field-1',
        formId: 'form-1',
        ...mockFieldData
      } as any)
      prismaMock.field.update.mockResolvedValue({
        id: 'field-1',
        formId: 'form-1',
        ...mockFieldData,
        label: 'Updated Field'
      } as any)

      const res = await request(app)
        .put('/api/forms/form-1/fields/field-1')
        .send({ label: 'Updated Field' })

      expect(res.status).toBe(200)
      expect(res.body.field.label).toBe('Updated Field')
    })

    it('should return 404 if field not found', async () => {
      prismaMock.form.findFirst.mockResolvedValue(mockForm as any)
      prismaMock.field.findFirst.mockResolvedValue(null)

      const res = await request(app)
        .put('/api/forms/form-1/fields/field-1')
        .send({ label: 'Updated' })

      expect(res.status).toBe(404)
    })
  })

  describe('DELETE /api/forms/:formId/fields/:fieldId', () => {
    it('should delete a field', async () => {
      prismaMock.form.findFirst.mockResolvedValue(mockForm as any)
      prismaMock.field.findFirst.mockResolvedValue({
        id: 'field-1',
        formId: 'form-1',
        ...mockFieldData
      } as any)
      prismaMock.field.delete.mockResolvedValue({} as any)

      const res = await request(app)
        .delete('/api/forms/form-1/fields/field-1')

      expect(res.status).toBe(200)
      expect(res.body.message).toBe('Field deleted')
    })
  })

  describe('POST /api/forms/:formId/fields/bulk', () => {
    it('should bulk save fields', async () => {
      prismaMock.form.findFirst.mockResolvedValue(mockForm as any)
      prismaMock.field.deleteMany.mockResolvedValue({ count: 0 } as any)
      prismaMock.field.createMany.mockResolvedValue({ count: 2 } as any)
      prismaMock.field.findMany.mockResolvedValue([
        { id: 'field-1', formId: 'form-1', ...mockFieldData },
        { id: 'field-2', formId: 'form-1', ...mockFieldData, name: 'field2' }
      ] as any)

      const res = await request(app)
        .post('/api/forms/form-1/fields/bulk')
        .send({
          fields: [mockFieldData, { ...mockFieldData, name: 'field2' }]
        })

      expect(res.status).toBe(200)
      expect(res.body.fields).toHaveLength(2)
    })
  })
})
