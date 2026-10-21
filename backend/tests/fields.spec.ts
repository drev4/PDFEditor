import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import { app } from '../src/app'
import { prisma } from '../src/services/db'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import { mockCallerMembership } from './mock-caller.js'
import { passThroughTransactionOnly } from './mock-transaction.js'
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

  // Mocked level: the two status codes and the shape of the answer. **Whether
  // anything is destroyed is a database question** — `Answer.field` is
  // `onDelete: Cascade`, and a mock cannot express a cascade or the
  // `SELECT … FOR UPDATE` that decides the race. Both are asserted in
  // tests/integration/field-delete-archives.spec.ts against a real PostgreSQL
  // (features/0044).
  describe('DELETE /api/forms/:formId/fields/:fieldId', () => {
    beforeEach(() => {
      passThroughTransactionOnly(prismaMock)
      prismaMock.form.findFirst.mockResolvedValue(mockForm as any)
      prismaMock.field.findFirst.mockResolvedValue({
        id: 'field-1',
        formId: 'form-1',
        ...mockFieldData
      } as any)
      prismaMock.$queryRaw.mockResolvedValue([{ id: 'field-1' }] as any)
    })

    it('deletes a field that holds no answers', async () => {
      prismaMock.answer.count.mockResolvedValue(0)
      prismaMock.field.delete.mockResolvedValue({} as any)

      const res = await request(app)
        .delete('/api/forms/form-1/fields/field-1')

      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ message: 'Field deleted', archived: false, answerCount: 0 })
      expect(prismaMock.field.delete).toHaveBeenCalledWith({ where: { id: 'field-1' } })
    })

    it('archives a field that holds answers, and reports how many', async () => {
      prismaMock.answer.count.mockResolvedValue(4)
      prismaMock.field.update.mockResolvedValue({} as any)

      const res = await request(app)
        .delete('/api/forms/form-1/fields/field-1')

      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ message: 'Field archived', archived: true, answerCount: 4 })
      expect(prismaMock.field.delete).not.toHaveBeenCalled()
      expect(prismaMock.field.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'field-1' } })
      )
    })
  })

  describe('GET /api/forms/:formId/fields/archived', () => {
    beforeEach(() => {
      prismaMock.form.findFirst.mockResolvedValue(mockForm as any)
    })

    it('returns the archived fields with the answers each one keeps', async () => {
      prismaMock.field.findMany.mockResolvedValue([
        { id: 'field-9', formId: 'form-1', label: 'Old question', deletedAt: new Date(), _count: { answers: 3 } }
      ] as any)

      const res = await request(app).get('/api/forms/form-1/fields/archived')

      expect(res.status).toBe(200)
      expect(res.body.fields).toHaveLength(1)
      expect(res.body.fields[0]).toMatchObject({ id: 'field-9', answerCount: 3 })
      // `_count` is an implementation detail of the query, not part of the
      // contract: it is flattened into `answerCount` before it leaves.
      expect(res.body.fields[0]).not.toHaveProperty('_count')
      expect(prismaMock.field.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { formId: 'form-1', deletedAt: { not: null } } })
      )
    })

    it('is 404 when the form is not the callers form', async () => {
      prismaMock.form.findFirst.mockResolvedValue(null)

      const res = await request(app).get('/api/forms/form-1/fields/archived')

      expect(res.status).toBe(404)
    })

    /**
     * `archived` is a static segment sitting under the `/:formId/fields/:fieldId`
     * family. There is no `GET` in that family today, and this is what says so
     * the day somebody adds one — the same guard `check-pattern` carries below.
     */
    it('is not shadowed by the parameterised field routes', async () => {
      prismaMock.field.findMany.mockResolvedValue([] as any)

      const res = await request(app).get('/api/forms/form-1/fields/archived')

      expect(res.status).toBe(200)
      expect(res.body).toHaveProperty('fields')
    })
  })

  describe('POST /api/forms/:formId/fields/:fieldId/restore', () => {
    beforeEach(() => {
      prismaMock.form.findFirst.mockResolvedValue(mockForm as any)
    })

    it('clears deletedAt and returns the whole row', async () => {
      prismaMock.field.findFirst.mockResolvedValue({ id: 'field-9', formId: 'form-1', deletedAt: new Date() } as any)
      prismaMock.field.update.mockResolvedValue({ id: 'field-9', formId: 'form-1', deletedAt: null } as any)

      const res = await request(app).post('/api/forms/form-1/fields/field-9/restore')

      expect(res.status).toBe(200)
      expect(res.body.field).toMatchObject({ id: 'field-9', deletedAt: null })
      expect(prismaMock.field.update).toHaveBeenCalledWith({
        where: { id: 'field-9' },
        data: { deletedAt: null }
      })
    })

    it('looks only for an archived field, never a live one', async () => {
      prismaMock.field.findFirst.mockResolvedValue(null)

      const res = await request(app).post('/api/forms/form-1/fields/field-1/restore')

      expect(res.status).toBe(404)
      expect(prismaMock.field.findFirst).toHaveBeenCalledWith({
        where: { id: 'field-1', formId: 'form-1', deletedAt: { not: null } }
      })
      expect(prismaMock.field.update).not.toHaveBeenCalled()
    })

    it('is 404 when the form is not the callers form', async () => {
      prismaMock.form.findFirst.mockResolvedValue(null)

      const res = await request(app).post('/api/forms/form-1/fields/field-9/restore')

      expect(res.status).toBe(404)
      expect(prismaMock.field.update).not.toHaveBeenCalled()
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

  /**
   * Checking a pattern before it is saved (features/0036).
   *
   * The editor needs an answer to "may this be stored" while somebody is
   * typing, and only the server can give it: RE2's rules are not JavaScript's,
   * and reimplementing them in the browser would be a second source of truth
   * about which patterns are legal.
   *
   * It exists as its own route because the alternative — letting the author
   * find out on save — is worse than it sounds. `pattern` is validated inside
   * `createFieldSchema`, so an invalid one fails the **whole** bulk save and
   * takes every other unsaved edit on the form with it.
   */
  describe('POST /api/forms/fields/check-pattern', () => {
    it('accepts a pattern RE2 can compile', async () => {
      const res = await request(app)
        .post('/api/forms/fields/check-pattern')
        .send({ pattern: '^[0-9]+$' })

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ ok: true })
    })

    it('refuses one it cannot, and says why', async () => {
      const res = await request(app)
        .post('/api/forms/fields/check-pattern')
        .send({ pattern: '(?=.*\d).{8,}' })

      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(false)
      // RE2's own message names the construct, which is what an author needs.
      expect(res.body.reason).toContain('(?=')
    })

    /**
     * The one the server cannot help with, stated here so the asymmetry is
     * recorded in a test rather than only in prose: `^(a+)+$` is **valid** —
     * RE2 runs it in 0.05 ms. It is catastrophic only in a backtracking
     * engine, which is the browser's job to notice (features/0035).
     */
    it('accepts a pattern that is fine here and catastrophic in a browser', async () => {
      const res = await request(app)
        .post('/api/forms/fields/check-pattern')
        .send({ pattern: '^(a+)+$' })

      expect(res.body).toEqual({ ok: true })
    })

    it('rejects a pattern longer than the stored limit', async () => {
      const res = await request(app)
        .post('/api/forms/fields/check-pattern')
        .send({ pattern: 'a'.repeat(201) })

      expect(res.body.ok).toBe(false)
      expect(res.body.reason).toMatch(/200 characters/)
    })

    it('validates its own body', async () => {
      const res = await request(app)
        .post('/api/forms/fields/check-pattern')
        .send({})

      expect(res.status).toBe(400)
    })

    /**
     * `formsRouter` and `formFieldsRouter` both mount on `/api/forms`, and the
     * latter is full of `/:formId` routes. A static path added underneath can
     * be swallowed by one of them and answer something entirely unrelated, so
     * the absence of shadowing is asserted rather than assumed.
     */
    it('is not shadowed by a :formId route', async () => {
      const res = await request(app)
        .post('/api/forms/fields/check-pattern')
        .send({ pattern: '^[0-9]+$' })

      // A form handler would have gone to the database; this must not.
      expect(prismaMock.form.findFirst).not.toHaveBeenCalled()
      expect(res.body).toHaveProperty('ok')
    })
  })
})
