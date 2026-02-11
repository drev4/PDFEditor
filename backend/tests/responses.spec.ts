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

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>

describe('Responses Routes', () => {
    beforeEach(() => {
        mockReset(prismaMock)
    })

    const mockForm = {
        id: 'aa4ac445-65bf-4d88-adea-f59fc80e316b', // Using a valid UUID format for Zod validation
        shareId: 'share-123',
        status: 'published',
        fields: [
            { id: 'field-1', name: 'name', type: 'text', required: true, label: 'Name' },
            { id: 'field-2', name: 'age', type: 'text', required: false, label: 'Age' }
        ]
    }

    describe('POST /api/responses', () => {
        it('should submit a valid response', async () => {
            prismaMock.form.findFirst.mockResolvedValue(mockForm as any)
            prismaMock.response.create.mockResolvedValue({ id: 'resp-1' } as any)

            const res = await request(app)
                .post('/api/responses')
                .send({
                    formId: mockForm.id,
                    shareId: 'share-123',
                    answers: {
                        'field-1': 'John Doe'
                    }
                })

            expect(res.status).toBe(201)
            expect(res.body.success).toBe(true)
            expect(prismaMock.response.create).toHaveBeenCalled()
        })

        it('should fail if required field is missing', async () => {
            prismaMock.form.findFirst.mockResolvedValue(mockForm as any)

            const res = await request(app)
                .post('/api/responses')
                .send({
                    formId: mockForm.id,
                    shareId: 'share-123',
                    answers: {}
                })

            expect(res.status).toBe(400)
            expect(res.body.error).toBe('Validation failed')
            expect(res.body.details.message).toBe('Required fields are missing')
        })

        it('should fail if form is not published', async () => {
            prismaMock.form.findFirst.mockResolvedValue({
                ...mockForm,
                status: 'draft'
            } as any)

            const res = await request(app)
                .post('/api/responses')
                .send({
                    formId: mockForm.id,
                    shareId: 'share-123',
                    answers: { 'field-1': 'Test' }
                })

            expect(res.status).toBe(403)
            expect(res.body.error).toBe('Form is not accepting responses')
        })

        it('should fail if shareId mismatch', async () => {
            prismaMock.form.findFirst.mockResolvedValue(null)

            const res = await request(app)
                .post('/api/responses')
                .send({
                    formId: mockForm.id,
                    shareId: 'wrong-share-id',
                    answers: { 'field-1': 'Test' }
                })

            expect(res.status).toBe(404)
            expect(res.body.error).toBe('Form not found or shareId mismatch')
        })
    })
})
