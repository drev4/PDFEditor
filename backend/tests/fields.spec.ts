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
    it('should replace all fields when the form has no responses', async () => {
      prismaMock.form.findFirst.mockResolvedValue(mockForm as any)
      prismaMock.response.count.mockResolvedValue(0)
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
      expect(prismaMock.field.deleteMany).toHaveBeenCalledWith({ where: { formId: 'form-1' } })
      expect(prismaMock.field.createMany).toHaveBeenCalled()
      expect(prismaMock.$transaction).not.toHaveBeenCalled()
    })

    it('should update existing fields in place when the form has responses', async () => {
      const fieldId = '11111111-1111-1111-1111-111111111111'
      prismaMock.form.findFirst.mockResolvedValue(mockForm as any)
      prismaMock.response.count.mockResolvedValue(1)
      prismaMock.field.findMany
        .mockResolvedValueOnce([
          { id: fieldId, formId: 'form-1', ...mockFieldData }
        ] as any)
        .mockResolvedValueOnce([
          { id: fieldId, formId: 'form-1', ...mockFieldData, label: 'Updated Field' }
        ] as any)
      prismaMock.field.update.mockResolvedValue({} as any)
      prismaMock.$transaction.mockImplementation((callback: any) => callback(prismaMock))

      const res = await request(app)
        .post('/api/forms/form-1/fields/bulk')
        .send({
          fields: [{ id: fieldId, ...mockFieldData, label: 'Updated Field' }]
        })

      expect(res.status).toBe(200)
      expect(prismaMock.field.update).toHaveBeenCalledWith({
        where: { id: fieldId },
        data: expect.objectContaining({ label: 'Updated Field' })
      })
      expect(prismaMock.field.deleteMany).not.toHaveBeenCalled()
      expect(prismaMock.field.createMany).not.toHaveBeenCalled()
    })

    it('should preserve an existing field with answers that is missing from the payload', async () => {
      prismaMock.form.findFirst.mockResolvedValue(mockForm as any)
      prismaMock.response.count.mockResolvedValue(1)
      prismaMock.field.findMany
        .mockResolvedValueOnce([
          { id: 'field-1', formId: 'form-1', ...mockFieldData }
        ] as any)
        .mockResolvedValueOnce([
          { id: 'field-1', formId: 'form-1', ...mockFieldData }
        ] as any)
      prismaMock.answer.count.mockResolvedValue(2)
      prismaMock.$transaction.mockImplementation((callback: any) => callback(prismaMock))

      const res = await request(app)
        .post('/api/forms/form-1/fields/bulk')
        .send({ fields: [] })

      expect(res.status).toBe(200)
      expect(prismaMock.field.delete).not.toHaveBeenCalled()
      expect(res.body.preserved).toContain('field-1')
    })

    it('should create a new field without an id when the form has responses', async () => {
      prismaMock.form.findFirst.mockResolvedValue(mockForm as any)
      prismaMock.response.count.mockResolvedValue(1)
      prismaMock.field.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { id: 'field-new', formId: 'form-1', ...mockFieldData, name: 'field2' }
        ] as any)
      prismaMock.field.create.mockResolvedValue({
        id: 'field-new',
        formId: 'form-1',
        ...mockFieldData,
        name: 'field2'
      } as any)
      prismaMock.$transaction.mockImplementation((callback: any) => callback(prismaMock))

      const res = await request(app)
        .post('/api/forms/form-1/fields/bulk')
        .send({ fields: [{ ...mockFieldData, name: 'field2' }] })

      expect(res.status).toBe(200)
      expect(prismaMock.field.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ formId: 'form-1', name: 'field2' })
      })
      expect(res.body.fields).toHaveLength(1)
    })
  })
})
