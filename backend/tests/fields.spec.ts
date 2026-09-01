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

describe('Fields Routes', () => {
  beforeEach(() => {
    mockReset(prismaMock)
    mockCallerMembership(prismaMock)
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

  // Mocked level: validation and status codes only. Whether a save destroys
  // answers is a database question - a mock cannot express a cascade, and a
  // green mocked test against the old destructive handler is how this project's
  // data-loss defect shipped. That behaviour is covered in
  // tests/integration/fields-bulk-save.spec.ts, against a real PostgreSQL.
  describe('POST /api/forms/:formId/fields/bulk', () => {
    const serverId = '11111111-1111-4111-8111-111111111111'

    beforeEach(() => {
      prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock))
    })

    it('should bulk save fields', async () => {
      prismaMock.form.findFirst.mockResolvedValue(mockForm as any)
      prismaMock.field.findMany
        .mockResolvedValueOnce([] as any) // live fields before the save
        .mockResolvedValueOnce([
          { id: 'field-1', formId: 'form-1', ...mockFieldData },
          { id: 'field-2', formId: 'form-1', ...mockFieldData, name: 'field2' }
        ] as any)
      prismaMock.field.create.mockResolvedValue({ id: 'field-1' } as any)

      const res = await request(app)
        .post('/api/forms/form-1/fields/bulk')
        .send({
          fields: [mockFieldData, { ...mockFieldData, name: 'field2' }]
        })

      expect(res.status).toBe(200)
      expect(res.body.fields).toHaveLength(2)
      expect(res.body.archived).toEqual([])
      expect(prismaMock.field.deleteMany).not.toHaveBeenCalled()
    })

    it('should return 404 if the form is not the caller\'s', async () => {
      prismaMock.form.findFirst.mockResolvedValue(null)

      const res = await request(app)
        .post('/api/forms/form-1/fields/bulk')
        .send({ fields: [mockFieldData] })

      expect(res.status).toBe(404)
    })

    it('should return 400 for an invalid field payload', async () => {
      prismaMock.form.findFirst.mockResolvedValue(mockForm as any)

      const res = await request(app)
        .post('/api/forms/form-1/fields/bulk')
        .send({ fields: [{ ...mockFieldData, type: 'signature' }] })

      expect(res.status).toBe(400)
      expect(prismaMock.$transaction).not.toHaveBeenCalled()
    })

    it('should return 400 for an id that is not a live field of this form', async () => {
      prismaMock.form.findFirst.mockResolvedValue(mockForm as any)
      prismaMock.field.findMany.mockResolvedValueOnce([] as any)

      const res = await request(app)
        .post('/api/forms/form-1/fields/bulk')
        .send({ fields: [{ ...mockFieldData, id: serverId }] })

      expect(res.status).toBe(400)
      expect(res.body.details.fieldIds).toEqual([serverId])
      expect(prismaMock.$transaction).not.toHaveBeenCalled()
    })

    it('should return 400 when the same id appears twice', async () => {
      prismaMock.form.findFirst.mockResolvedValue(mockForm as any)
      prismaMock.field.findMany.mockResolvedValueOnce([{ id: serverId }] as any)

      const res = await request(app)
        .post('/api/forms/form-1/fields/bulk')
        .send({
          fields: [
            { ...mockFieldData, id: serverId },
            { ...mockFieldData, name: 'field2', id: serverId }
          ]
        })

      expect(res.status).toBe(400)
      expect(prismaMock.$transaction).not.toHaveBeenCalled()
    })

    it('should reject a client-supplied id on the individual create', async () => {
      prismaMock.form.findFirst.mockResolvedValue(mockForm as any)
      prismaMock.field.create.mockResolvedValue({ id: 'generated', ...mockFieldData } as any)

      const res = await request(app)
        .post('/api/forms/form-1/fields')
        .send({ ...mockFieldData, id: serverId })

      expect(res.status).toBe(201)
      // `createFieldSchema` strips it: the server, not the client, decides ids.
      expect(prismaMock.field.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.not.objectContaining({ id: serverId }) })
      )
    })
  })
})
