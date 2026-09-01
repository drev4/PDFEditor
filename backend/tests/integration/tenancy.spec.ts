import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { app } from '../../src/app.js'
import { prisma } from '../../src/services/db.js'
import { createUser, createForm } from './helpers.js'

/**
 * The tenancy boundary: one account must not reach another's forms.
 *
 * A note on what this suite is and is not. It is **not** a bug reproduction —
 * the boundary already held before organizations existed, through
 * `where: { userId: req.userId }`. It is a regression guard around the rewrite
 * that replaces that comparison with a membership lookup
 * ([`features/0009`](../../../features/0009-organizations-own-resources.md)),
 * which is the kind of change that leaks quietly if it is wrong.
 *
 * Every assertion is `404` rather than `403` on purpose. A `403` confirms the
 * row exists and turns each of these endpoints into an existence oracle for
 * form ids. Nothing asserted this before.
 */
describe('tenancy boundary', () => {
  async function twoAccountsWithAForm() {
    const alice = await createUser('alice@example.com')
    const bob = await createUser('bob@example.com')
    const aliceForm = await createForm(alice.user.id, { title: "Alice's form" })
    return { alice, bob, aliceForm }
  }

  it('a stranger cannot read another account form', async () => {
    const { bob, aliceForm } = await twoAccountsWithAForm()

    const res = await request(app)
      .get(`/api/forms/${aliceForm.id}`)
      .set('Authorization', bob.authHeader)

    expect(res.status).toBe(404)
  })

  it('a stranger cannot update another account form', async () => {
    const { bob, aliceForm } = await twoAccountsWithAForm()

    const res = await request(app)
      .put(`/api/forms/${aliceForm.id}`)
      .set('Authorization', bob.authHeader)
      .send({ title: 'Taken over' })

    expect(res.status).toBe(404)
  })

  it('a stranger cannot change another account form status', async () => {
    const { bob, aliceForm } = await twoAccountsWithAForm()

    const res = await request(app)
      .patch(`/api/forms/${aliceForm.id}/status`)
      .set('Authorization', bob.authHeader)
      .send({ status: 'closed' })

    expect(res.status).toBe(404)
  })

  it('a stranger cannot delete another account form', async () => {
    const { bob, aliceForm } = await twoAccountsWithAForm()

    const res = await request(app)
      .delete(`/api/forms/${aliceForm.id}`)
      .set('Authorization', bob.authHeader)

    expect(res.status).toBe(404)
  })

  it('a stranger cannot read another account responses', async () => {
    const { bob, aliceForm } = await twoAccountsWithAForm()

    const res = await request(app)
      .get(`/api/forms/${aliceForm.id}/responses`)
      .set('Authorization', bob.authHeader)

    expect(res.status).toBe(404)
  })

  it('a stranger cannot export another account responses', async () => {
    const { bob, aliceForm } = await twoAccountsWithAForm()

    const res = await request(app)
      .get(`/api/forms/${aliceForm.id}/responses/export`)
      .set('Authorization', bob.authHeader)

    expect(res.status).toBe(404)
  })

  it('a stranger cannot read or write another account fields', async () => {
    const { bob, aliceForm } = await twoAccountsWithAForm()

    const bulk = await request(app)
      .post(`/api/forms/${aliceForm.id}/fields/bulk`)
      .set('Authorization', bob.authHeader)
      .send({ fields: [] })

    expect(bulk.status).toBe(404)
  })

  it('the list endpoint shows only the caller own forms', async () => {
    const { bob, alice } = await twoAccountsWithAForm()
    await createForm(bob.user.id, { title: "Bob's form" })

    const res = await request(app).get('/api/forms').set('Authorization', bob.authHeader)

    expect(res.status).toBe(200)
    expect(res.body.forms).toHaveLength(1)
    expect(res.body.forms[0].title).toBe("Bob's form")
    expect(JSON.stringify(res.body)).not.toContain(alice.user.id)
  })

  /**
   * The active organization is a **choice among memberships, never a grant**
   * (features/0023).
   *
   * These are the assertions that keep `User.activeOrganizationId` from becoming
   * an authorization input. It can only select something the caller already has;
   * anything else falls back, and nothing about it widens what they reach.
   */
  describe('the active organization cannot widen what a caller reaches', () => {
    it('ignores a column pointing at an organization the caller is not in', async () => {
      const { alice, bob, aliceForm } = await twoAccountsWithAForm()
      await createForm(bob.user.id, { title: "Bob's form" })

      // Written directly, as a stale value or a hand-edited row would be. There
      // is no endpoint that would accept this.
      await prisma.user.update({
        where: { id: bob.user.id },
        data: { activeOrganizationId: alice.organization.id }
      })

      const list = await request(app).get('/api/forms').set('Authorization', bob.authHeader)
      const direct = await request(app)
        .get(`/api/forms/${aliceForm.id}`)
        .set('Authorization', bob.authHeader)

      // Falls back to his own membership. The column selected nothing, because
      // there was nothing of Alice's to select.
      expect(list.body.forms).toHaveLength(1)
      expect(list.body.forms[0].title).toBe("Bob's form")
      expect(direct.status).toBe(404)
    })

    it('stops acting in an organization the moment the membership goes', async () => {
      const alice = await createUser('alice-removed@example.com')
      const second = await prisma.organization.create({
        data: { name: 'Second', slug: `org-${Math.random().toString(36).slice(2, 12)}` }
      })
      const membership = await prisma.membership.create({
        data: { organizationId: second.id, userId: alice.user.id, role: 'member' }
      })
      await prisma.form.create({
        data: {
          organizationId: second.id,
          createdByUserId: alice.user.id,
          title: 'A form of the second organization',
          shareId: `share-${Math.random().toString(36).slice(2, 11)}`,
          status: 'draft'
        }
      })
      await request(app)
        .post('/api/organizations/active')
        .set('Authorization', alice.authHeader)
        .send({ organizationId: second.id })

      const before = await request(app).get('/api/forms').set('Authorization', alice.authHeader)
      expect(before.body.forms).toHaveLength(1)

      // Removed, with the column still naming that organization. No session to
      // expire and no cleanup job: the next request must simply stop.
      await prisma.membership.delete({ where: { id: membership.id } })

      const after = await request(app).get('/api/forms').set('Authorization', alice.authHeader)
      expect(after.status).toBe(200)
      expect(after.body.forms).toHaveLength(0)
    })

    it('refuses to switch into an organization the caller does not belong to', async () => {
      const { alice, bob } = await twoAccountsWithAForm()

      const res = await request(app)
        .post('/api/organizations/active')
        .set('Authorization', bob.authHeader)
        .send({ organizationId: alice.organization.id })

      // 404, not 403: a 403 confirms the organization exists.
      expect(res.status).toBe(404)
      const stored = await prisma.user.findUniqueOrThrow({ where: { id: bob.user.id } })
      expect(stored.activeOrganizationId).toBeNull()
    })
  })
})
