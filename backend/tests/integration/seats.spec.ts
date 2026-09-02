import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import type Stripe from 'stripe'
import { app } from '../../src/app.js'
import { prisma } from '../../src/services/db.js'
import { createUser } from './helpers.js'
import { stripeClient } from '../../src/services/stripe.js'
import { seatLimitFor } from '../../src/services/entitlements.js'
import { PLANS } from '../../src/services/plans.js'
import {
  subscription,
  subscriptionEvent,
  TEST_PRICE_PRO,
  TEST_PRICE_TEAM
} from '../fixtures/stripe-events.js'

/**
 * The Team plan and seats the customer buys
 * ([`features/0015`](../../../features/0015-team-plan-and-purchased-seats.md)).
 *
 * Against a real PostgreSQL, because the three properties worth having here are
 * all statements about what is *still in the database* after a billing event,
 * and a mocked Prisma client cannot make one of them:
 *
 *   1. **A downgrade removes nobody.** An organization with more members than
 *      the new plan allows keeps every membership and every pending invitation.
 *      This is the sharpest version of the rule features/0013 set for published
 *      forms, and it is the failure this suite exists to catch: a removed
 *      membership loses the record of who was in the organization and when they
 *      joined, and no click brings it back.
 *   2. **The seat limit follows what was bought.** Raising the quantity in
 *      Stripe lifts the refusal with no deploy; lowering it refuses the next
 *      invitation and touches nothing that already exists.
 *   3. **`planKey` and `Subscription.quantity` agree after any sequence.** They
 *      are written by one function in one transaction, and this is what says so.
 *
 * Every event arrives through `POST /api/billing/webhook` with a genuine
 * signature, the same as `billing.spec.ts` — that is what keeps the raw-body
 * mount above `express.json()` under test rather than assumed.
 */
describe('team seats', () => {
  const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET!

  async function deliver(event: Stripe.Event) {
    const payload = JSON.stringify(event)
    const signature = stripeClient().webhooks.generateTestHeaderString({
      payload,
      secret: WEBHOOK_SECRET
    })

    return request(app)
      .post('/api/billing/webhook')
      .set('stripe-signature', signature)
      .set('Content-Type', 'application/json')
      .send(payload)
  }

  /** Puts an organization on a plan the way the only supported path does: Stripe said so. */
  async function activate(
    organizationId: string,
    options: { priceId?: string; quantity?: number | undefined; status?: Stripe.Subscription.Status } = {}
  ) {
    const { priceId = TEST_PRICE_TEAM, quantity = 1, status = 'active' } = options

    const response = await deliver(
      subscriptionEvent(
        'customer.subscription.updated',
        subscription({ organizationId, priceId, quantity, status })
      )
    )

    expect(response.status).toBe(200)
  }

  /** An accepted invitation, so the organization really holds N memberships. */
  async function addMember(organizationId: string, email: string) {
    const user = await prisma.user.create({
      data: { email, passwordHash: 'not-a-real-hash', name: email }
    })
    await prisma.membership.create({
      data: { organizationId, userId: user.id, role: 'member' }
    })
    return user
  }

  function invite(token: string, email: string) {
    return request(app)
      .post('/api/organizations/invitations')
      .set('Authorization', `Bearer ${token}`)
      .send({ email, role: 'member' })
  }

  let owner: Awaited<ReturnType<typeof createUser>>

  beforeEach(async () => {
    owner = await createUser(`owner-${Math.random().toString(36).slice(2)}@example.com`)
  })

  describe('the trap-4 decision: seats count total people', () => {
    // The decision this feature had to take in writing, asserted rather than
    // described. Free includes one seat and the organization's own owner is a
    // membership, so a brand-new account is already using it: "one seat" means
    // "you, alone", and inviting a colleague from Free is refused. That is the
    // product working. The alternative reading — seats *beyond* the owner —
    // would make every number here one less than the number the customer counts
    // on the Members screen.
    it('refuses a fresh Free account its first invitation, with 402', async () => {
      const response = await invite(owner.token, 'colleague@example.com')

      expect(response.status).toBe(402)
      expect(response.body.error).toContain(PLANS.free.name)

      // Nothing was created on the way to the refusal.
      expect(await prisma.invitation.count()).toBe(0)
    })

    it('refuses on Pro too — Pro is a single member, Team is the plan that adds people', async () => {
      await activate(owner.organization.id, { priceId: TEST_PRICE_PRO })

      const response = await invite(owner.token, 'colleague@example.com')

      expect(response.status).toBe(402)
      expect(await prisma.invitation.count()).toBe(0)
    })

    it('counts a pending invitation as a seat, so seats cannot be issued twice', async () => {
      // Three seats bought, and the owner is one of them: two invitations fit
      // and the third does not — because an invitation that has not been
      // accepted still holds a seat. Counting memberships alone would let an
      // organization on its limit hand out any number of working keys.
      await activate(owner.organization.id, { quantity: 3 })

      expect((await invite(owner.token, 'a@example.com')).status).toBe(201)
      expect((await invite(owner.token, 'b@example.com')).status).toBe(201)
      expect((await invite(owner.token, 'c@example.com')).status).toBe(402)

      expect(await prisma.membership.count({ where: { organizationId: owner.organization.id } })).toBe(1)
      expect(await prisma.invitation.count({ where: { organizationId: owner.organization.id } })).toBe(2)
    })
  })

  describe('the seat limit comes from what was bought', () => {
    it('uses the purchased quantity when it is above the catalogue floor', async () => {
      await activate(owner.organization.id, { quantity: 8 })

      expect(await seatLimitFor(prisma, owner.organization.id)).toBe(8)
    })

    it.each([
      ['no quantity at all', undefined],
      ['a quantity of zero', 0],
      ['a quantity below the floor', 1]
    ])('degrades to the Team floor on %s — never to unlimited', async (_label, quantity) => {
      await activate(owner.organization.id, { quantity: quantity as number | undefined })

      const limit = await seatLimitFor(prisma, owner.organization.id)

      expect(limit).toBe(PLANS.team.seats)
      // The bug this guards against is `null`, which `isWithin` treats as
      // unlimited: an unreadable quantity must not give away the product.
      expect(limit).not.toBeNull()
    })

    it('leaves every other plan reading the catalogue', async () => {
      await activate(owner.organization.id, { priceId: TEST_PRICE_PRO, quantity: 50 })

      // A quantity on a plan whose seats are declared is not a limit. Only
      // `PER_SEAT_PLANS` reads it, which is the containment that keeps this
      // exception from becoming a general one.
      expect(await seatLimitFor(prisma, owner.organization.id)).toBe(PLANS.pro.seats)
    })

    it('lifts a refusal when the customer buys another seat, with no deploy', async () => {
      await activate(owner.organization.id, { quantity: 3 })
      await addMember(owner.organization.id, 'one@example.com')
      await addMember(owner.organization.id, 'two@example.com')

      expect((await invite(owner.token, 'three@example.com')).status).toBe(402)

      // The customer raises the quantity in Stripe's portal; the only thing that
      // reaches this application is the webhook.
      await activate(owner.organization.id, { quantity: 4 })

      expect((await invite(owner.token, 'three@example.com')).status).toBe(201)
    })

    it('reports the effective limit on the entitlements endpoint', async () => {
      await activate(owner.organization.id, { quantity: 8 })

      const response = await request(app)
        .get('/api/organizations/entitlements')
        .set('Authorization', `Bearer ${owner.token}`)

      expect(response.status).toBe(200)
      expect(response.body.plan.key).toBe('team')
      // The bought number, not the catalogue floor — otherwise the Members meter
      // tells a customer who paid for eight that they have three.
      expect(response.body.plan.seats).toBe(8)
      expect(response.body.usage.seats).toBe(1)
    })
  })

  describe('a downgrade refuses new state and destroys none', () => {
    it('keeps every membership and every pending invitation when Team drops to Pro', async () => {
      await activate(owner.organization.id, { quantity: 8 })

      await addMember(owner.organization.id, 'one@example.com')
      await addMember(owner.organization.id, 'two@example.com')
      await addMember(owner.organization.id, 'three@example.com')
      expect((await invite(owner.token, 'pending@example.com')).status).toBe(201)

      const membershipsBefore = await prisma.membership.findMany({
        where: { organizationId: owner.organization.id },
        orderBy: { createdAt: 'asc' }
      })
      const invitationsBefore = await prisma.invitation.findMany({
        where: { organizationId: owner.organization.id }
      })
      expect(membershipsBefore).toHaveLength(4)
      expect(invitationsBefore).toHaveLength(1)

      // Team → Pro. Pro allows one person; this organization has five.
      await activate(owner.organization.id, { priceId: TEST_PRICE_PRO, quantity: 1 })

      const organization = await prisma.organization.findUnique({
        where: { id: owner.organization.id }
      })
      expect(organization?.planKey).toBe('pro')

      // The whole point of the suite. Not a count — the same rows, with the same
      // ids and the same `createdAt`, because "who was here and since when" is
      // the record a removal would destroy.
      const membershipsAfter = await prisma.membership.findMany({
        where: { organizationId: owner.organization.id },
        orderBy: { createdAt: 'asc' }
      })
      expect(membershipsAfter).toEqual(membershipsBefore)

      const invitationsAfter = await prisma.invitation.findMany({
        where: { organizationId: owner.organization.id }
      })
      expect(invitationsAfter).toEqual(invitationsBefore)

      // What a downgrade *does* do: refuse the next one.
      expect((await invite(owner.token, 'nope@example.com')).status).toBe(402)
    })

    it('keeps everyone when the quantity is lowered below the number of people', async () => {
      await activate(owner.organization.id, { quantity: 5 })
      await addMember(owner.organization.id, 'one@example.com')
      await addMember(owner.organization.id, 'two@example.com')

      // Stripe lets a customer set a quantity under what they already use. The
      // product's answer is to stop issuing seats, not to reclaim them.
      await activate(owner.organization.id, { quantity: 1 })

      expect(
        await prisma.membership.count({ where: { organizationId: owner.organization.id } })
      ).toBe(3)
      expect((await invite(owner.token, 'four@example.com')).status).toBe(402)
    })

    it('keeps everyone when the subscription is cancelled outright', async () => {
      await activate(owner.organization.id, { quantity: 5 })
      await addMember(owner.organization.id, 'one@example.com')

      await deliver(
        subscriptionEvent(
          'customer.subscription.deleted',
          subscription({
            organizationId: owner.organization.id,
            priceId: TEST_PRICE_TEAM,
            quantity: 5,
            status: 'canceled'
          })
        )
      )

      const organization = await prisma.organization.findUnique({
        where: { id: owner.organization.id }
      })
      expect(organization?.planKey).toBe('free')
      expect(
        await prisma.membership.count({ where: { organizationId: owner.organization.id } })
      ).toBe(2)
    })
  })

  describe('planKey and quantity never disagree', () => {
    it('holds after a sequence of purchases, changes and a cancellation', async () => {
      const sequence: Array<{ priceId: string; quantity: number | undefined; status: Stripe.Subscription.Status }> = [
        { priceId: TEST_PRICE_PRO, quantity: 1, status: 'active' },
        { priceId: TEST_PRICE_TEAM, quantity: 4, status: 'active' },
        { priceId: TEST_PRICE_TEAM, quantity: 9, status: 'past_due' },
        { priceId: TEST_PRICE_TEAM, quantity: 9, status: 'canceled' }
      ]

      for (const step of sequence) {
        await activate(owner.organization.id, step)

        const [organization, sub] = await Promise.all([
          prisma.organization.findUnique({ where: { id: owner.organization.id } }),
          prisma.subscription.findUnique({ where: { organizationId: owner.organization.id } })
        ])

        // `past_due` keeps the paid plan; only a status outside the allowlist
        // falls to free. Whatever the answer, the two rows were written in one
        // transaction and say the same thing about the same event.
        const expectedPlan =
          step.status === 'canceled' ? 'free' : step.priceId === TEST_PRICE_TEAM ? 'team' : 'pro'

        expect(organization?.planKey).toBe(expectedPlan)
        expect(sub?.quantity).toBe(step.quantity)
        expect(sub?.priceId).toBe(step.priceId)
        expect(sub?.status).toBe(step.status)
      }
    })
  })
})
