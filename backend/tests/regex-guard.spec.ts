import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import { app } from '../src/app'
import { prisma } from '../src/services/db'
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import { mockCallerMembership } from './mock-caller.js'
import { PrismaClient } from '@prisma/client'
import { passThroughTransaction } from './mock-transaction'

vi.mock('../src/services/db', async () => {
  const { mockDeep } = await import('vitest-mock-extended')
  return { prisma: mockDeep<PrismaClient>() }
})

vi.mock('../src/middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = 'user-1'
    next()
  }
}))

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>

const FORM_ID = 'aa4ac445-65bf-4d88-adea-f59fc80e316b'

/** A published form with one text field carrying the given `pattern`. */
function formWithPattern(pattern: string) {
  return {
    id: FORM_ID,
    shareId: 'share-123',
    status: 'published',
    userId: 'user-1',
    fields: [
      {
        id: 'field-1',
        name: 'answer',
        type: 'text',
        required: false,
        label: 'Answer',
        validation: { pattern }
      }
    ]
  }
}

function submit(value: string) {
  return request(app)
    .post('/api/responses')
    .send({ formId: FORM_ID, shareId: 'share-123', answers: { 'field-1': value } })
}

describe('Author-supplied regex is bounded and cannot break the service', () => {
  beforeEach(() => {
    mockReset(prismaMock)
    mockCallerMembership(prismaMock)
    prismaMock.response.create.mockResolvedValue({ id: 'resp-1', answers: [] } as any)
    // Submitting writes inside a transaction since features/0012. This spec is
    // about the regex engine, not about plan limits.
    passThroughTransaction(prismaMock)
  })

  describe('a stored pattern that is not a valid regex', () => {
    it('does not return 500', async () => {
      // `new RegExp('[')` throws SyntaxError. Unguarded, that reaches the error
      // handler as a non-AppError and becomes a 500 - permanently, for every
      // respondent, from a single typo by the author.
      prismaMock.form.findFirst.mockResolvedValue(formWithPattern('[') as any)

      const res = await submit('hello')

      expect(res.status).not.toBe(500)
    })

    it('accepts the submission, treating the broken pattern as no constraint', async () => {
      prismaMock.form.findFirst.mockResolvedValue(formWithPattern('[') as any)

      const res = await submit('hello')

      // Degrading to "unconstrained" keeps the form working. Rejecting would
      // punish the respondent for the author's mistake; throwing is the 500.
      expect(res.status).toBe(201)
    })
  })

  describe('a catastrophically backtracking pattern', () => {
    it('completes well within a time bound', async () => {
      // /^(a+)+$/ against a non-matching input is the textbook ReDoS case. On a
      // native RegExp this is ~3s at 28 characters and doubles every 2 more, so
      // an unguarded implementation blows this bound by orders of magnitude.
      // The input is kept small on purpose: a longer one would hang this test
      // run for hours rather than failing it.
      prismaMock.form.findFirst.mockResolvedValue(formWithPattern('^(a+)+$') as any)

      const started = Date.now()
      const res = await submit('a'.repeat(32) + '!')
      const elapsed = Date.now() - started

      expect(res.status).not.toBe(500)
      expect(elapsed).toBeLessThan(500)
    })
  })

  describe('a legitimate pattern still works', () => {
    it('accepts a value that matches', async () => {
      prismaMock.form.findFirst.mockResolvedValue(formWithPattern('^[0-9]+$') as any)

      const res = await submit('12345')

      expect(res.status).toBe(201)
    })

    it('rejects a value that does not match', async () => {
      prismaMock.form.findFirst.mockResolvedValue(formWithPattern('^[0-9]+$') as any)

      const res = await submit('not-a-number')

      expect(res.status).toBe(400)
      expect(res.body.details.answer).toBe('Invalid format')
    })
  })

  describe('length checks short-circuit the pattern', () => {
    it('does not run the regex on a value that already failed maxLength', async () => {
      const form = {
        ...formWithPattern('^(a+)+$'),
        fields: [
          {
            id: 'field-1',
            name: 'answer',
            type: 'text',
            required: false,
            label: 'Answer',
            validation: { maxLength: 5, pattern: '^(a+)+$' }
          }
        ]
      }
      prismaMock.form.findFirst.mockResolvedValue(form as any)

      const started = Date.now()
      const res = await submit('a'.repeat(32) + '!')
      const elapsed = Date.now() - started

      expect(res.status).toBe(400)
      expect(res.body.details.answer).toContain('Maximum length')
      expect(elapsed).toBeLessThan(500)
    })
  })
})

describe('Author-supplied regex is validated when it is stored', () => {
  beforeEach(() => {
    mockReset(prismaMock)
    mockCallerMembership(prismaMock)
    prismaMock.form.findFirst.mockResolvedValue({ id: FORM_ID, userId: 'user-1' } as any)
    prismaMock.field.create.mockResolvedValue({ id: 'field-1' } as any)
  })

  function createField(pattern: string) {
    return request(app)
      .post(`/api/forms/${FORM_ID}/fields`)
      .send({
        type: 'text',
        name: 'answer',
        label: 'Answer',
        required: false,
        position: { x: 1, y: 1, width: 10, height: 10, page: 1 },
        order: 0,
        validation: { pattern }
      })
  }

  it('rejects a pattern that is not a valid regex', async () => {
    const res = await createField('[')

    expect(res.status).toBe(400)
    expect(prismaMock.field.create).not.toHaveBeenCalled()
  })

  it('rejects an over-long pattern', async () => {
    const res = await createField('a'.repeat(1000))

    expect(res.status).toBe(400)
    expect(prismaMock.field.create).not.toHaveBeenCalled()
  })

  it('rejects a pattern the engine cannot support, naming what is unsupported', async () => {
    // RE2 does not backtrack, so it has no lookahead/lookbehind/backreferences.
    // The author needs to be told which construct is the problem.
    const res = await createField('^(?=.*[A-Z]).+$')

    expect(res.status).toBe(400)
    expect(JSON.stringify(res.body.details)).toMatch(/\(\?=/)
    expect(prismaMock.field.create).not.toHaveBeenCalled()
  })

  it('rejects an invalid pattern sent to the individual update', async () => {
    prismaMock.field.findFirst.mockResolvedValue({ id: 'field-1', formId: FORM_ID } as any)

    const res = await request(app)
      .put(`/api/forms/${FORM_ID}/fields/field-1`)
      .send({ validation: { pattern: '[' } })

    expect(res.status).toBe(400)
    expect(prismaMock.field.update).not.toHaveBeenCalled()
  })

  it('accepts a legitimate pattern', async () => {
    const res = await createField('^[0-9]{3}-[0-9]{4}$')

    expect(res.status).toBe(201)
  })

  it('rejects an invalid pattern sent to the bulk save', async () => {
    prismaMock.field.findMany.mockResolvedValue([] as any)

    const res = await request(app)
      .post(`/api/forms/${FORM_ID}/fields/bulk`)
      .send({
        fields: [
          {
            type: 'text',
            name: 'answer',
            label: 'Answer',
            required: false,
            position: { x: 1, y: 1, width: 10, height: 10, page: 1 },
            order: 0,
            validation: { pattern: '(' }
          }
        ]
      })

    expect(res.status).toBe(400)
  })
})
