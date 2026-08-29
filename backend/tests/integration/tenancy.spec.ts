import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { app } from '../../src/app.js'
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
})
