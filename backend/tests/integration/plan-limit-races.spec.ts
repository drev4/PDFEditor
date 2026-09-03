import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { app } from '../../src/app.js'
import { prisma } from '../../src/services/db.js'
import { createUser, createForm, grantSeats } from './helpers.js'
import { PLANS } from '../../src/services/plans.js'

/**
 * Two requests must not both pass the same plan limit
 * ([`features/0027`](../../../features/0027-atomic-plan-limits.md)).
 *
 * Every assertion here is about what happens when two requests are **in flight
 * at once**, which makes this suite database-backed by necessity rather than by
 * preference. A mocked Prisma client has no lock, no transaction and no second
 * connection: it would report both requests succeeding and both failing exactly
 * the same way, so a green mocked test would say nothing at all.
 *
 * `Promise.all` is load-bearing, not stylistic. `await invite(a); await
 * invite(b)` is two requests one after the other, and it passes against the
 * unfixed code — the second one counts the row the first one committed. The
 * bug only exists in the window between the count and the write, and the only
 * way to be inside that window is to be there at the same time.
 *
 * The first three were written before the fix and run against it, and all three
 * failed: two `201`s, two `200`s, and four publishes where two organizations
 * should have got one slot each. The fourth is the guard on the fix rather than
 * on the bug — it passes either way today, and it is what stops "serialise
 * everything" from being an acceptable answer tomorrow.
 */
describe('plan limits under concurrency (database-backed)', () => {
  /**
   * Publishing is the cheaper race to set up: fill the plan to one short of its
   * limit, and two drafts are then one too many for the single remaining slot.
   *
   * The fill count is read from the catalogue rather than assuming the free
   * plan keeps one form published (features/0040), so the race is still run on
   * the *last* slot wherever the limit sits.
   */
  async function organizationOnItsLastSlot() {
    const { user, authHeader, organization } = await createUser()

    for (let i = 0; i < PLANS.free.maxPublishedForms! - 1; i++) {
      await createForm(user.id, { status: 'published' })
    }

    const first = await createForm(user.id, { status: 'draft' })
    const second = await createForm(user.id, { status: 'draft' })
    return { authHeader, organization, first, second }
  }

  const publish = (authHeader: string, formId: string) =>
    request(app)
      .patch(`/api/forms/${formId}/status`)
      .set('Authorization', authHeader)
      .send({ status: 'published' })

  function publishedCount(organizationId: string) {
    return prisma.form.count({ where: { organizationId, status: 'published' } })
  }

  it('lets exactly one of two concurrent invitations take the last seat', async () => {
    const owner = await createUser()

    // Team's catalogue floor is three seats, and the owner's own membership is
    // one of them. One pending invitation brings the organization to two of
    // three: one seat left, and two people about to be invited into it.
    await grantSeats(owner.organization.id, 3)
    await prisma.invitation.create({
      data: {
        organizationId: owner.organization.id,
        email: 'pending@example.com',
        role: 'member',
        tokenHash: 'hash-of-a-pending-invitation',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        invitedByUserId: owner.user.id
      }
    })

    const invite = (email: string) =>
      request(app)
        .post('/api/organizations/invitations')
        .set('Authorization', owner.authHeader)
        .send({ email, role: 'member' })

    const [a, b] = await Promise.all([invite('one@example.com'), invite('two@example.com')])

    const statuses = [a.status, b.status].sort()
    expect(statuses).toEqual([201, 402])

    // The status codes are what the client sees; the row count is what the
    // customer paid for. Both, because a handler could answer 402 and insert.
    expect(await prisma.invitation.count({ where: { organizationId: owner.organization.id } }))
      .toBe(2)

    const refused = a.status === 402 ? a : b
    expect(refused.body.error).toMatch(/covers 3 people/)
  })

  it('lets exactly one of two concurrent publishes take the last slot', async () => {
    const { authHeader, organization, first, second } = await organizationOnItsLastSlot()

    // One request through each publish path, because both call the limit and a
    // fix applied to only one of them would still be a bug.
    const [a, b] = await Promise.all([
      request(app)
        .put(`/api/forms/${first.id}`)
        .set('Authorization', authHeader)
        .send({ title: first.title, status: 'published' }),
      request(app)
        .patch(`/api/forms/${second.id}/status`)
        .set('Authorization', authHeader)
        .send({ status: 'published' })
    ])

    const statuses = [a.status, b.status].sort()
    expect(statuses).toEqual([200, 402])
    expect(await publishedCount(organization.id)).toBe(PLANS.free.maxPublishedForms)

    const refused = a.status === 402 ? a : b
    expect(refused.body.error).toMatch(/Free plan keeps/)
  })

  it('does not let one organization block another', async () => {
    const left = await organizationOnItsLastSlot()
    const right = await organizationOnItsLastSlot()

    // Four publishes at once across two organizations. Each organization has
    // one slot, so the answer is one success each — never one overall, which is
    // what a lock taken on something coarser than the organization would give.
    const results = await Promise.all([
      publish(left.authHeader, left.first.id),
      publish(left.authHeader, left.second.id),
      publish(right.authHeader, right.first.id),
      publish(right.authHeader, right.second.id)
    ])

    expect(results.filter((r) => r.status === 200)).toHaveLength(2)
    expect(await publishedCount(left.organization.id)).toBe(PLANS.free.maxPublishedForms)
    expect(await publishedCount(right.organization.id)).toBe(PLANS.free.maxPublishedForms)
  })

  it('does not wait on a lock held for a different organization', async () => {
    const left = await organizationOnItsLastSlot()
    const right = await organizationOnItsLastSlot()

    // The test above says every organization gets its slot, which a single
    // global lock would also satisfy — slowly. This says the scope is the
    // organization row: hold `left`'s row from outside the application, and a
    // publish in `right` must not notice. Anything coarser — a table lock, one
    // advisory lock, a mutex around the check — blocks here until this
    // transaction commits.
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })

    const holding = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${left.organization.id} FOR UPDATE`
        await held
      },
      { timeout: 20_000 }
    )

    try {
      const outcome = await Promise.race([
        publish(right.authHeader, right.first.id).then((res) => res.status),
        new Promise<string>((resolve) => setTimeout(() => resolve('blocked'), 5_000))
      ])

      expect(outcome).toBe(200)
    } finally {
      // Always, so a failed assertion ends the suite rather than leaving a
      // transaction open on a row the next test truncates.
      release()
      await holding
    }
  })
})
