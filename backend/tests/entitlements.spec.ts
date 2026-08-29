import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { app } from '../src/app'
import { prisma } from '../src/services/db'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import { PrismaClient } from '@prisma/client'
import { PLANS, DEV_PLAN, resolvePlan, effectivePlan, isWithin } from '../src/services/plans'
import { currentPeriod } from '../src/services/entitlements'

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

/**
 * Plan limits at the route level, over a mocked Prisma
 * ([`features/0012`](../../features/0012-plan-catalogue-and-entitlements.md)).
 *
 * What this level can prove: the status code, the wording, and that the catalogue
 * is read the way the routes think it is. What it **cannot** prove is any of the
 * behaviour that makes the meter correct — the atomic upsert, the rollback, the
 * cascade. That is `tests/integration/entitlements.spec.ts`, and a green run here
 * says nothing about it.
 */
describe('plan limits', () => {
  beforeEach(() => {
    mockReset(prismaMock)
  })

  const membership = { organizationId: 'org-1', role: 'owner' as const }

  const form = {
    id: 'form-1',
    organizationId: 'org-1',
    createdByUserId: 'user-1',
    title: 'Test Form',
    description: null,
    shareId: 'share-123',
    status: 'draft',
    pdfUrl: null,
    settings: null,
    viewCount: 0,
    createdAt: new Date(),
    updatedAt: new Date()
  }

  /** The organization row `planFor` reads. */
  function onPlan(planKey: string) {
    prismaMock.organization.findUnique.mockResolvedValue({ planKey } as any)
  }

  describe('the catalogue', () => {
    it('takes the free plan straight from the design canvas', () => {
      // These numbers are the contract with the `Plans` artboard. If the canvas
      // changes, this fails first — which is the point.
      expect(PLANS.free.maxPublishedForms).toBe(1)
      expect(PLANS.free.maxResponsesPerMonth).toBe(50)
      expect(PLANS.free.seats).toBe(1)
    })

    it('gives paid plans unlimited published forms', () => {
      expect(PLANS.pro.maxPublishedForms).toBeNull()
      expect(PLANS.team.maxPublishedForms).toBeNull()
      expect(PLANS.pro.maxResponsesPerMonth).toBe(2000)
      expect(PLANS.team.maxResponsesPerMonth).toBe(25000)
    })

    it('resolves an unknown plan downward, never upward', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

      expect(resolvePlan('enterprise').key).toBe('free')
      expect(warn).toHaveBeenCalled()

      warn.mockRestore()
    })

    it('treats a null limit as unlimited', () => {
      expect(isWithin(10_000, null)).toBe(true)
      expect(isWithin(0, 0)).toBe(false)
      expect(isWithin(0, 1)).toBe(true)
    })

    it('is frozen, so no request can edit the plan it is checked against', () => {
      expect(Object.isFrozen(PLANS)).toBe(true)
      expect(Object.isFrozen(PLANS.free)).toBe(true)
    })
  })

  describe('currentPeriod', () => {
    it('formats YYYY-MM in UTC', () => {
      expect(currentPeriod(new Date('2026-08-29T12:00:00Z'))).toBe('2026-08')
      expect(currentPeriod(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01')
    })

    it('does not drift across a month boundary in a negative offset', () => {
      // 23:30 UTC on the 31st is still August, whatever the server's timezone
      // thinks. A period computed locally would bill this to September.
      expect(currentPeriod(new Date('2026-08-31T23:30:00Z'))).toBe('2026-08')
    })
  })

  describe('publishing past the plan', () => {
    it('answers 402, not 403', async () => {
      prismaMock.form.findFirst.mockResolvedValue(form as any)
      onPlan('free')
      prismaMock.form.count.mockResolvedValue(1)

      const res = await request(app)
        .patch('/api/forms/form-1/status')
        .send({ status: 'published' })

      // 402 is a plan limit; 403 is a permission failure. The frontend shows
      // "upgrade" for one and "you do not have access" for the other, and it
      // must not have to parse a message to tell them apart.
      expect(res.status).toBe(402)
      expect(res.body.error).toMatch(/Free/)
      expect(prismaMock.form.update).not.toHaveBeenCalled()
    })

    it('publishes when there is room', async () => {
      prismaMock.form.findFirst.mockResolvedValue(form as any)
      onPlan('free')
      prismaMock.form.count.mockResolvedValue(0)
      prismaMock.form.update.mockResolvedValue({ ...form, status: 'published' } as any)

      const res = await request(app)
        .patch('/api/forms/form-1/status')
        .send({ status: 'published' })

      expect(res.status).toBe(200)
    })

    it('never checks the limit when moving back to draft', async () => {
      prismaMock.form.findFirst.mockResolvedValue({ ...form, status: 'published' } as any)
      prismaMock.form.update.mockResolvedValue({ ...form, status: 'draft' } as any)

      const res = await request(app)
        .patch('/api/forms/form-1/status')
        .send({ status: 'draft' })

      expect(res.status).toBe(200)
      // Unpublishing is how you free a slot. Reading the plan here would be a
      // pointless query at best and a refusal to unpublish at worst.
      expect(prismaMock.organization.findUnique).not.toHaveBeenCalled()
    })

    it('excludes the form being published from its own count', async () => {
      prismaMock.form.findFirst.mockResolvedValue(form as any)
      onPlan('free')
      prismaMock.form.count.mockResolvedValue(0)
      prismaMock.form.update.mockResolvedValue({ ...form, status: 'published' } as any)

      await request(app).patch('/api/forms/form-1/status').send({ status: 'published' })

      expect(prismaMock.form.count).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', status: 'published', id: { not: 'form-1' } }
      })
    })

    it('does not gate creating a form', async () => {
      prismaMock.membership.findFirst.mockResolvedValue(membership as any)
      prismaMock.form.create.mockResolvedValue(form as any)

      const res = await request(app).post('/api/forms').send({ title: 'A draft' })

      expect(res.status).toBe(201)
      // Drafting is free. Only publishing is metered, per the `LimitReached`
      // artboard: the form "stays a draft until you free up a slot or upgrade".
      expect(prismaMock.organization.findUnique).not.toHaveBeenCalled()
    })
  })

  describe('the public surface never says 402', () => {
    it('404s the public read when the allowance is spent', async () => {
      prismaMock.form.findUnique.mockResolvedValue({ ...form, status: 'published' } as any)
      onPlan('free')
      prismaMock.usageCounter.findUnique.mockResolvedValue({ responses: 50 } as any)

      const res = await request(app).get('/api/forms/public/share-123')

      expect(res.status).toBe(404)
      expect(res.body.error).toBe('Form not found')
      expect(JSON.stringify(res.body)).not.toMatch(/plan|limit|upgrade/i)
    })

    it('403s the submission with the wording a closed form gets', async () => {
      prismaMock.form.findFirst.mockResolvedValue({
        ...form,
        status: 'published',
        fields: []
      } as any)
      prismaMock.$transaction.mockImplementation(async (fn: any) => {
        const tx = {
          organization: { findUnique: async () => ({ planKey: 'free' }) },
          usageCounter: { upsert: async () => ({ responses: 51 }) },
          response: { create: async () => form }
        }
        return fn(tx)
      })

      const res = await request(app)
        .post('/api/responses')
        .send({
          formId: '11111111-1111-4111-8111-111111111111',
          shareId: 'share-123',
          answers: {}
        })

      // Indistinguishable from a closed form. A respondent is not the customer:
      // a 402 would be meaningless to them and would publish the customer's
      // billing state to anyone holding the share link.
      expect(res.status).toBe(403)
      expect(res.body.error).toBe('Form is not accepting responses')
    })

    it('accepts the submission while there is allowance', async () => {
      prismaMock.form.findFirst.mockResolvedValue({
        ...form,
        status: 'published',
        fields: []
      } as any)
      prismaMock.$transaction.mockImplementation(async (fn: any) => {
        const tx = {
          organization: { findUnique: async () => ({ planKey: 'free' }) },
          usageCounter: { upsert: async () => ({ responses: 1 }) },
          response: { create: async () => ({ id: 'response-1', answers: [] }) }
        }
        return fn(tx)
      })

      const res = await request(app)
        .post('/api/responses')
        .send({
          formId: '11111111-1111-4111-8111-111111111111',
          shareId: 'share-123',
          answers: {}
        })

      expect(res.status).toBe(201)
      expect(res.body.responseId).toBe('response-1')
    })
  })

  describe('GET /api/organizations/entitlements', () => {
    it('returns the plan and the usage', async () => {
      prismaMock.membership.findFirst.mockResolvedValue(membership as any)
      onPlan('free')
      prismaMock.form.count.mockResolvedValue(1)
      prismaMock.usageCounter.findUnique.mockResolvedValue({ responses: 12 } as any)
      prismaMock.membership.count.mockResolvedValue(1)
      prismaMock.invitation.count.mockResolvedValue(0)

      const res = await request(app).get('/api/organizations/entitlements')

      expect(res.status).toBe(200)
      expect(res.body).toEqual({
        plan: {
          key: 'free',
          name: 'Free',
          maxPublishedForms: 1,
          maxResponsesPerMonth: 50,
          seats: 1
        },
        usage: { publishedForms: 1, responsesThisPeriod: 12, seats: 1 }
      })
    })

    it('reports no usage when the meter has never been written', async () => {
      prismaMock.membership.findFirst.mockResolvedValue(membership as any)
      onPlan('free')
      prismaMock.form.count.mockResolvedValue(0)
      prismaMock.usageCounter.findUnique.mockResolvedValue(null)
      prismaMock.membership.count.mockResolvedValue(1)
      prismaMock.invitation.count.mockResolvedValue(0)

      const res = await request(app).get('/api/organizations/entitlements')

      expect(res.status).toBe(200)
      expect(res.body.usage.responsesThisPeriod).toBe(0)
    })

    it('exposes no billing-shaped field', async () => {
      prismaMock.membership.findFirst.mockResolvedValue(membership as any)
      onPlan('free')
      prismaMock.form.count.mockResolvedValue(0)
      prismaMock.usageCounter.findUnique.mockResolvedValue(null)
      prismaMock.membership.count.mockResolvedValue(1)
      prismaMock.invitation.count.mockResolvedValue(0)

      const res = await request(app).get('/api/organizations/entitlements')

      const body = JSON.stringify(res.body)
      expect(body).not.toMatch(/stripe|customer|price|subscription/i)
    })

    it('404s a caller who is in no organization', async () => {
      prismaMock.membership.findFirst.mockResolvedValue(null)

      const res = await request(app).get('/api/organizations/entitlements')

      expect(res.status).toBe(404)
    })
  })
  /**
   * The development override (`DEV_PLAN_KEY`) — temporary, and the reason this
   * suite tests it at all is that it can switch enforcement off.
   *
   * The property that matters is not "it works", it is **"it cannot come on by
   * accident"**. Every negative case below is a way a real deployment loses or
   * mangles `NODE_ENV`, and each one must leave limits enforced.
   */
  describe('DEV_PLAN_KEY', () => {
    const originalEnv = process.env.NODE_ENV
    const originalKey = process.env.DEV_PLAN_KEY

    function environment(nodeEnv: string | undefined, devPlanKey: string | undefined) {
      if (nodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = nodeEnv
      if (devPlanKey === undefined) delete process.env.DEV_PLAN_KEY
      else process.env.DEV_PLAN_KEY = devPlanKey
    }

    afterEach(() => {
      environment(originalEnv, originalKey)
    })

    it('is off unless it is set', () => {
      environment('development', undefined)

      expect(effectivePlan('free')).toBe(PLANS.free)
    })

    it('lifts every limit when set to dev', () => {
      environment('development', 'dev')

      const plan = effectivePlan('free')
      expect(plan).toBe(DEV_PLAN)
      expect(plan.maxPublishedForms).toBeNull()
      expect(plan.maxResponsesPerMonth).toBeNull()
    })

    it('pins every organization to a named plan, so the limit screens can be driven', () => {
      // The other half of the point: `free` forces the limits *on* for an
      // account that would otherwise be on something roomier.
      environment('development', 'free')

      expect(effectivePlan('team')).toBe(PLANS.free)
    })

    it('is ignored in production', () => {
      environment('production', 'dev')

      expect(effectivePlan('free')).toBe(PLANS.free)
    })

    it('is ignored when NODE_ENV is unset', () => {
      // The failure this guards. `NODE_ENV !== "production"` — the obvious
      // check — would honour the override here, and a process manager that
      // does not pass NODE_ENV through is an ordinary way to end up in this
      // state with no error anywhere.
      environment(undefined, 'dev')

      expect(effectivePlan('free')).toBe(PLANS.free)
    })

    it('is ignored when NODE_ENV is something unexpected', () => {
      environment('staging', 'dev')

      expect(effectivePlan('free')).toBe(PLANS.free)
    })

    it('is ignored when it names a plan that does not exist', () => {
      environment('development', 'unlimited')

      expect(effectivePlan('free')).toBe(PLANS.free)
    })

    it('does not leak the pseudo-plan into the product catalogue', () => {
      // `PLANS` is what the canvas describes and what a customer could be sold.
      // A fake tier inside it would eventually be offered to somebody.
      expect(Object.keys(PLANS)).toEqual(['free', 'pro', 'team'])
      expect(Object.values(PLANS)).not.toContain(DEV_PLAN)
    })

    it('lets a route publish past the limit while it is on', async () => {
      environment('development', 'dev')
      prismaMock.form.findFirst.mockResolvedValue(form as any)
      onPlan('free')
      prismaMock.form.count.mockResolvedValue(99)
      prismaMock.form.update.mockResolvedValue({ ...form, status: 'published' } as any)

      const res = await request(app)
        .patch('/api/forms/form-1/status')
        .send({ status: 'published' })

      expect(res.status).toBe(200)
    })

    it('still refuses that publish in production', async () => {
      environment('production', 'dev')
      prismaMock.form.findFirst.mockResolvedValue(form as any)
      onPlan('free')
      prismaMock.form.count.mockResolvedValue(99)

      const res = await request(app)
        .patch('/api/forms/form-1/status')
        .send({ status: 'published' })

      expect(res.status).toBe(402)
    })
  })
})
