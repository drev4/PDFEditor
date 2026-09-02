import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { app } from '../../src/app.js'
import { prisma } from '../../src/services/db.js'
import { createUser, createForm, createField } from './helpers.js'
import { currentPeriod, assertCanInvite } from '../../src/services/entitlements.js'
import { PLANS } from '../../src/services/plans.js'

/**
 * Plan limits, against a real PostgreSQL
 * ([`features/0012`](../../../features/0012-plan-catalogue-and-entitlements.md)).
 *
 * This is the suite that matters for this change, and a mocked Prisma client
 * could not carry any of it: the meter is a unique-constrained upsert, the
 * refusal is a transaction rollback, and the reason the meter is not just a
 * `count(*)` is a cascade. All three are database behaviour.
 *
 * The free plan's real numbers are used throughout — 1 published form, 50
 * responses a month — rather than a fixture with convenient limits. A test that
 * loosens the limit it is testing proves nothing about the limit.
 */
describe('plan limits', () => {
  const FREE = PLANS.free

  /** Seeds the meter, so the boundary can be reached without 50 HTTP requests. */
  async function setResponseUsage(organizationId: string, responses: number) {
    await prisma.usageCounter.upsert({
      where: { organizationId_period: { organizationId, period: currentPeriod() } },
      create: { organizationId, period: currentPeriod(), responses },
      update: { responses }
    })
  }

  async function submit(form: { id: string; shareId: string }, fieldId: string, value = 'hello') {
    return request(app)
      .post('/api/responses')
      .send({ formId: form.id, shareId: form.shareId, answers: { [fieldId]: value } })
  }

  describe('publishing is what the plan meters, not creating', () => {
    it('lets a free organization publish its first form', async () => {
      const author = await createUser()
      const form = await createForm(author.user.id, { status: 'draft' })

      const res = await request(app)
        .patch(`/api/forms/${form.id}/status`)
        .set('Authorization', author.authHeader)
        .send({ status: 'published' })

      expect(res.status).toBe(200)
      expect(res.body.form.status).toBe('published')
    })

    it('refuses the second published form with 402, and leaves it a draft', async () => {
      const author = await createUser()
      await createForm(author.user.id, { status: 'published' })
      const second = await createForm(author.user.id, { status: 'draft' })

      const res = await request(app)
        .patch(`/api/forms/${second.id}/status`)
        .set('Authorization', author.authHeader)
        .send({ status: 'published' })

      // 402 and not 403: this is a plan limit, not a permission failure, and
      // the frontend has to tell them apart without parsing a message.
      expect(res.status).toBe(402)
      expect(res.body.error).toContain('Free')

      const stored = await prisma.form.findUniqueOrThrow({ where: { id: second.id } })
      expect(stored.status).toBe('draft')
    })

    it('never refuses creating a form, however many exist', async () => {
      const author = await createUser()
      await createForm(author.user.id, { status: 'published' })

      const res = await request(app)
        .post('/api/forms')
        .set('Authorization', author.authHeader)
        .send({ title: 'A draft is always allowed' })

      expect(res.status).toBe(201)
    })

    it('closes the back door: PUT /:id cannot publish past the limit either', async () => {
      const author = await createUser()
      await createForm(author.user.id, { status: 'published' })
      const second = await createForm(author.user.id, { status: 'draft' })

      const res = await request(app)
        .put(`/api/forms/${second.id}`)
        .set('Authorization', author.authHeader)
        .send({ status: 'published' })

      expect(res.status).toBe(402)
    })

    it('does not refuse re-saving a form that is already published', async () => {
      const author = await createUser()
      const form = await createForm(author.user.id, { status: 'published' })

      // The form being published is excluded from its own count. Without that,
      // every save of the one allowed form would start failing.
      const res = await request(app)
        .patch(`/api/forms/${form.id}/status`)
        .set('Authorization', author.authHeader)
        .send({ status: 'published' })

      expect(res.status).toBe(200)
    })

    it('frees the slot when a form is unpublished', async () => {
      const author = await createUser()
      const first = await createForm(author.user.id, { status: 'published' })
      const second = await createForm(author.user.id, { status: 'draft' })

      await request(app)
        .patch(`/api/forms/${first.id}/status`)
        .set('Authorization', author.authHeader)
        .send({ status: 'draft' })

      const res = await request(app)
        .patch(`/api/forms/${second.id}/status`)
        .set('Authorization', author.authHeader)
        .send({ status: 'published' })

      expect(res.status).toBe(200)
    })

    it('does not limit a plan with no published-form limit', async () => {
      const author = await createUser()
      await prisma.organization.update({
        where: { id: author.organization.id },
        data: { planKey: 'pro' }
      })
      await createForm(author.user.id, { status: 'published' })
      const second = await createForm(author.user.id, { status: 'draft' })

      const res = await request(app)
        .patch(`/api/forms/${second.id}/status`)
        .set('Authorization', author.authHeader)
        .send({ status: 'published' })

      expect(res.status).toBe(200)
    })

    it('counts published forms per organization, not across the install', async () => {
      const alice = await createUser('alice@example.com')
      const bob = await createUser('bob@example.com')
      await createForm(alice.user.id, { status: 'published' })
      const bobsFirst = await createForm(bob.user.id, { status: 'draft' })

      const res = await request(app)
        .patch(`/api/forms/${bobsFirst.id}/status`)
        .set('Authorization', bob.authHeader)
        .send({ status: 'published' })

      expect(res.status).toBe(200)
    })
  })

  describe('the response meter', () => {
    it('increments on an accepted submission', async () => {
      const author = await createUser()
      const form = await createForm(author.user.id, { status: 'published' })
      const field = await createField(form.id)

      const res = await submit(form, field.id)
      expect(res.status).toBe(201)

      const counter = await prisma.usageCounter.findUniqueOrThrow({
        where: {
          organizationId_period: {
            organizationId: author.organization.id,
            period: currentPeriod()
          }
        }
      })
      expect(counter.responses).toBe(1)
    })

    it('accepts the last response of the allowance', async () => {
      const author = await createUser()
      const form = await createForm(author.user.id, { status: 'published' })
      const field = await createField(form.id)
      await setResponseUsage(author.organization.id, FREE.maxResponsesPerMonth! - 1)

      const res = await submit(form, field.id)

      expect(res.status).toBe(201)
    })

    it('refuses the one after it, and rolls the whole submission back', async () => {
      const author = await createUser()
      const form = await createForm(author.user.id, { status: 'published' })
      const field = await createField(form.id)
      await setResponseUsage(author.organization.id, FREE.maxResponsesPerMonth!)

      const res = await submit(form, field.id, 'this must not be stored')

      // 403 with the wording a closed form gets. A respondent is not the
      // customer: a 402 would be meaningless to them and would leak the
      // customer's billing state to anyone holding the share link.
      expect(res.status).toBe(403)
      expect(res.body.error).toBe('Form is not accepting responses')

      // The rollback is the point. Neither the response nor the increment.
      expect(await prisma.response.count({ where: { formId: form.id } })).toBe(0)
      expect(await prisma.answer.count()).toBe(0)

      const counter = await prisma.usageCounter.findUniqueOrThrow({
        where: {
          organizationId_period: {
            organizationId: author.organization.id,
            period: currentPeriod()
          }
        }
      })
      expect(counter.responses).toBe(FREE.maxResponsesPerMonth)
    })

    it('does not give the quota back when a form is deleted', async () => {
      const author = await createUser()
      const form = await createForm(author.user.id, { status: 'published' })
      const field = await createField(form.id)
      await submit(form, field.id)

      await request(app)
        .delete(`/api/forms/${form.id}`)
        .set('Authorization', author.authHeader)

      // The responses are gone with the form (see the cascade map), and the
      // meter is not. It counts submissions accepted in the period, not rows
      // that still exist — otherwise deleting data would refund the month.
      expect(await prisma.response.count()).toBe(0)

      const counter = await prisma.usageCounter.findUniqueOrThrow({
        where: {
          organizationId_period: {
            organizationId: author.organization.id,
            period: currentPeriod()
          }
        }
      })
      expect(counter.responses).toBe(1)
    })

    it('meters each organization separately', async () => {
      const alice = await createUser('alice@example.com')
      const bob = await createUser('bob@example.com')
      const aliceForm = await createForm(alice.user.id, { status: 'published' })
      const aliceField = await createField(aliceForm.id)
      await setResponseUsage(bob.organization.id, FREE.maxResponsesPerMonth!)

      const res = await submit(aliceForm, aliceField.id)

      expect(res.status).toBe(201)
    })
  })

  describe('the public form is unavailable before anyone fills it in', () => {
    it('404s the public read once the allowance is spent', async () => {
      const author = await createUser()
      const form = await createForm(author.user.id, { status: 'published' })
      await setResponseUsage(author.organization.id, FREE.maxResponsesPerMonth!)

      const res = await request(app).get(`/api/forms/public/${form.shareId}`)

      // Enforcing only at submit time would let the respondent type everything
      // and then lose it. Same 404 a closed form gets, so nothing about the
      // customer's plan is observable from here.
      expect(res.status).toBe(404)
      expect(res.body.error).toBe('Form not found')
    })

    it('still serves it while there is allowance left', async () => {
      const author = await createUser()
      const form = await createForm(author.user.id, { status: 'published' })
      await setResponseUsage(author.organization.id, FREE.maxResponsesPerMonth! - 1)

      const res = await request(app).get(`/api/forms/public/${form.shareId}`)

      expect(res.status).toBe(200)
    })
  })

  describe('GET /api/organizations/entitlements', () => {
    it('reports the plan and the real usage', async () => {
      const author = await createUser()
      await createForm(author.user.id, { status: 'published' })
      await createForm(author.user.id, { status: 'draft' })
      await setResponseUsage(author.organization.id, 7)

      const res = await request(app)
        .get('/api/organizations/entitlements')
        .set('Authorization', author.authHeader)

      expect(res.status).toBe(200)
      expect(res.body.plan.key).toBe('free')
      expect(res.body.plan.maxResponsesPerMonth).toBe(FREE.maxResponsesPerMonth)
      // The draft does not count against the published-form limit.
      expect(res.body.usage.publishedForms).toBe(1)
      expect(res.body.usage.responsesThisPeriod).toBe(7)
      expect(res.body.usage.seats).toBe(1)
    })

    it('never leaks the organization id', async () => {
      const author = await createUser()

      const res = await request(app)
        .get('/api/organizations/entitlements')
        .set('Authorization', author.authHeader)

      expect(JSON.stringify(res.body)).not.toContain(author.organization.id)
    })

    it('requires a session', async () => {
      const res = await request(app).get('/api/organizations/entitlements')

      expect(res.status).toBe(401)
    })

    /**
     * `hasApiAccess` on the payload (features/0021).
     *
     * It is there so the API keys screen knows whether to draw a create form at
     * all; `assertHasApiAccess` inside `POST /api/organizations/api-keys` is
     * still the only thing that decides. Asserted here rather than in the mocked
     * suite because the value comes from resolving a real organization's plan.
     */
    it('says the plan does not include the API when it does not', async () => {
      const author = await createUser()

      const res = await request(app)
        .get('/api/organizations/entitlements')
        .set('Authorization', author.authHeader)

      expect(res.body.plan.key).toBe('free')
      expect(res.body.plan.hasApiAccess).toBe(false)
    })

    it('says it does on a plan that has it', async () => {
      const author = await createUser()
      await prisma.organization.update({
        where: { id: author.organization.id },
        data: { planKey: 'team' }
      })

      const res = await request(app)
        .get('/api/organizations/entitlements')
        .set('Authorization', author.authHeader)

      expect(res.body.plan.key).toBe('team')
      expect(res.body.plan.hasApiAccess).toBe(true)
    })

    it('falls back to the free plan for an unknown planKey rather than upward', async () => {
      const author = await createUser()
      await prisma.organization.update({
        where: { id: author.organization.id },
        data: { planKey: 'enterprise-that-never-shipped' }
      })

      const res = await request(app)
        .get('/api/organizations/entitlements')
        .set('Authorization', author.authHeader)

      expect(res.status).toBe(200)
      expect(res.body.plan.key).toBe('free')
    })
  })

  /**
   * `assertCanInvite` is written and tested but **not wired into
   * `POST /api/organizations/invitations`** — see the note on the function.
   * Testing it directly is what keeps it honest until step 8 connects it; a
   * seat check that has never been executed is not a seat check.
   */
  describe('assertCanInvite (wired since features/0015)', () => {
    it('counts a pending invitation as a seat in use', async () => {
      const author = await createUser()
      await prisma.invitation.create({
        data: {
          organizationId: author.organization.id,
          email: 'pending@example.com',
          tokenHash: `hash-${Math.random()}`,
          expiresAt: new Date(Date.now() + 60_000)
        }
      })

      // One member plus one outstanding invitation is already two seats on a
      // one-seat plan. Counting memberships alone would let an organization at
      // its limit hand out any number of working keys.
      await expect(
        prisma.$transaction((tx) => assertCanInvite(tx, author.organization.id))
      ).rejects.toMatchObject({ statusCode: 402 })
    })

    it('ignores a revoked invitation', async () => {
      const author = await createUser()
      await prisma.invitation.create({
        data: {
          organizationId: author.organization.id,
          email: 'revoked@example.com',
          tokenHash: `hash-${Math.random()}`,
          expiresAt: new Date(Date.now() + 60_000),
          revokedAt: new Date()
        }
      })
      await prisma.organization.update({
        where: { id: author.organization.id },
        data: { planKey: 'team' }
      })

      await expect(
        prisma.$transaction((tx) => assertCanInvite(tx, author.organization.id))
      ).resolves.toBeUndefined()
    })

    it('is enforced by the invitation endpoint, with 402', async () => {
      const author = await createUser()

      // Free covers one person and the owner is that person, so this is the
      // limit doing its job. It sat unwired from features/0012 until Team
      // existed to make it meaningful; the plan-by-plan behaviour and the
      // purchased-seat cases are in `seats.spec.ts`.
      const res = await request(app)
        .post('/api/organizations/invitations')
        .set('Authorization', author.authHeader)
        .send({ email: 'colleague@example.com', role: 'member' })

      // 402, not 403: this person is allowed to invite, the plan is not paying
      // for it. `403` is what `requireRole` throws and the two are never merged.
      expect(res.status).toBe(402)
      expect(await prisma.invitation.count()).toBe(0)
    })
  })
})
