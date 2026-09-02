import { describe, it, expect } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { app } from '../../src/app.js'
import { prisma } from '../../src/services/db.js'
import type { MembershipRole } from '@prisma/client'
import { grantSeats } from './helpers.js'

/**
 * Roles, enforced ([`features/0010`]).
 *
 * Until this feature `Membership.role` was stored and never read, so anyone
 * inside an organization could do anything to it — including delete it, and
 * with it every response ever collected. These are the tests that make the
 * column mean something.
 *
 * The two rejection codes are the point of half of them: **404** for someone
 * outside the organization, because a 403 would confirm it exists, and **403**
 * for a member who simply lacks the role, because hiding a thing they already
 * know about only makes the product feel broken.
 */

let seq = 0
function email(prefix: string): string {
  return `${prefix}-${Date.now()}-${seq++}-${Math.random().toString(36).slice(2, 8)}@example.com`
}

/** A user in `organizationId` with `role`, plus their auth header. */
async function member(organizationId: string, role: MembershipRole, prefix = role) {
  const user = await prisma.user.create({
    data: { email: email(prefix), passwordHash: 'not-a-real-hash', name: prefix }
  })
  await prisma.membership.create({ data: { organizationId, userId: user.id, role } })
  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET!, { expiresIn: '1h' })
  return { user, authHeader: `Bearer ${token}` }
}

/**
 * An organization with seats already bought, unless `seats` says otherwise.
 *
 * Seats are a **precondition here, not the subject** — features/0015 wired
 * `assertCanInvite`, and Free covers one person, so an organization created bare
 * answers `402` to every invitation and these tests would be asserting a plan
 * limit while claiming to assert a role. `seats: 0` is for the one test that
 * cares which of the two answers comes first.
 */
async function organization(name = 'Acme', seats = 10) {
  const org = await prisma.organization.create({
    data: { name, slug: `org-${Math.random().toString(36).slice(2, 12)}` }
  })
  if (seats > 0) await grantSeats(org.id, seats)
  return org
}

describe('role enforcement', () => {
  describe('inviting', () => {
    it('an owner may invite', async () => {
      const org = await organization()
      const owner = await member(org.id, 'owner')

      const res = await request(app)
        .post('/api/organizations/invitations')
        .set('Authorization', owner.authHeader)
        .send({ email: 'newcomer@example.com', role: 'member' })

      expect(res.status).toBe(201)
    })

    it('a member may not invite, and is told why', async () => {
      const org = await organization()
      const plain = await member(org.id, 'member')

      const res = await request(app)
        .post('/api/organizations/invitations')
        .set('Authorization', plain.authHeader)
        .send({ email: 'newcomer@example.com', role: 'member' })

      // 403, not 404: they are inside the organization and know it exists.
      expect(res.status).toBe(403)
      expect(res.body.error).toMatch(/role/i)
    })

    it('answers 403 before 402 — a permission failure is not a billing problem', async () => {
      // The order of the two checks in the handler, asserted (features/0015).
      // This organization has no seats *and* the caller lacks the role. Telling
      // a member to go and buy seats they cannot buy — only an owner may — sends
      // them to a screen that will not help, and it says something about the
      // organization's billing state to somebody who was not allowed to ask.
      const org = await organization('Acme', 0)
      const plain = await member(org.id, 'member')

      const res = await request(app)
        .post('/api/organizations/invitations')
        .set('Authorization', plain.authHeader)
        .send({ email: 'newcomer@example.com', role: 'member' })

      expect(res.status).toBe(403)
    })

    it('an admin may invite a member but not an owner', async () => {
      const org = await organization()
      const admin = await member(org.id, 'admin')

      const allowed = await request(app)
        .post('/api/organizations/invitations')
        .set('Authorization', admin.authHeader)
        .send({ email: 'newcomer@example.com', role: 'member' })
      expect(allowed.status).toBe(201)

      const refused = await request(app)
        .post('/api/organizations/invitations')
        .set('Authorization', admin.authHeader)
        .send({ email: 'another@example.com', role: 'owner' })
      expect(refused.status).toBe(403)
    })

    it('someone with no organization at all gets 404, not 403', async () => {
      const stranger = await prisma.user.create({
        data: { email: email('stranger'), passwordHash: 'not-a-real-hash' }
      })
      const token = jwt.sign({ userId: stranger.id }, process.env.JWT_SECRET!, { expiresIn: '1h' })

      const res = await request(app)
        .post('/api/organizations/invitations')
        .set('Authorization', `Bearer ${token}`)
        .send({ email: 'newcomer@example.com', role: 'member' })

      // The distinction this whole file exists to protect: outside → 404,
      // inside-but-not-permitted → 403.
      expect(res.status).toBe(404)
    })
  })

  describe('managing members', () => {
    it('an owner may change a role', async () => {
      const org = await organization()
      const owner = await member(org.id, 'owner')
      const target = await member(org.id, 'member')

      const res = await request(app)
        .patch(`/api/organizations/members/${target.user.id}`)
        .set('Authorization', owner.authHeader)
        .send({ role: 'admin' })

      expect(res.status).toBe(200)
      const updated = await prisma.membership.findFirstOrThrow({
        where: { organizationId: org.id, userId: target.user.id }
      })
      expect(updated.role).toBe('admin')
    })

    it('an admin may not change a role', async () => {
      const org = await organization()
      const admin = await member(org.id, 'admin')
      const target = await member(org.id, 'member')

      const res = await request(app)
        .patch(`/api/organizations/members/${target.user.id}`)
        .set('Authorization', admin.authHeader)
        .send({ role: 'owner' })

      expect(res.status).toBe(403)
    })

    it('an owner may remove a member', async () => {
      const org = await organization()
      const owner = await member(org.id, 'owner')
      const target = await member(org.id, 'member')

      const res = await request(app)
        .delete(`/api/organizations/members/${target.user.id}`)
        .set('Authorization', owner.authHeader)

      expect(res.status).toBe(204)
      expect(await prisma.membership.count({ where: { organizationId: org.id } })).toBe(1)
    })

    it('a member may not remove anyone', async () => {
      const org = await organization()
      await member(org.id, 'owner')
      const plain = await member(org.id, 'member')
      const target = await member(org.id, 'member', 'victim')

      const res = await request(app)
        .delete(`/api/organizations/members/${target.user.id}`)
        .set('Authorization', plain.authHeader)

      expect(res.status).toBe(403)
    })

    it('cannot touch a member of another organization', async () => {
      const mine = await organization('Mine')
      const theirs = await organization('Theirs')
      const owner = await member(mine.id, 'owner')
      const outsider = await member(theirs.id, 'member', 'outsider')

      const res = await request(app)
        .delete(`/api/organizations/members/${outsider.user.id}`)
        .set('Authorization', owner.authHeader)

      // 404: from this organization's point of view that person does not exist.
      expect(res.status).toBe(404)
      expect(await prisma.membership.count({ where: { organizationId: theirs.id } })).toBe(1)
    })
  })

  describe('the last owner', () => {
    it('cannot demote themselves', async () => {
      const org = await organization()
      const owner = await member(org.id, 'owner')

      const res = await request(app)
        .patch(`/api/organizations/members/${owner.user.id}`)
        .set('Authorization', owner.authHeader)
        .send({ role: 'admin' })

      // An organization with no owner cannot be administered, billed or
      // deleted, and nothing in this product can repair one.
      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/only owner/i)
    })

    it('cannot remove themselves', async () => {
      const org = await organization()
      const owner = await member(org.id, 'owner')

      const res = await request(app)
        .delete(`/api/organizations/members/${owner.user.id}`)
        .set('Authorization', owner.authHeader)

      expect(res.status).toBe(400)
      expect(await prisma.membership.count({ where: { organizationId: org.id } })).toBe(1)
    })

    it('may step down once someone else is an owner', async () => {
      const org = await organization()
      const first = await member(org.id, 'owner')
      const second = await member(org.id, 'owner', 'coowner')

      const res = await request(app)
        .patch(`/api/organizations/members/${first.user.id}`)
        .set('Authorization', first.authHeader)
        .send({ role: 'member' })

      expect(res.status).toBe(200)
      const remaining = await prisma.membership.findFirstOrThrow({
        where: { organizationId: org.id, userId: second.user.id }
      })
      expect(remaining.role).toBe('owner')
    })
  })

  describe('listing members', () => {
    it('any member may see who is in the organization', async () => {
      const org = await organization()
      await member(org.id, 'owner')
      const plain = await member(org.id, 'member')

      const res = await request(app)
        .get('/api/organizations/members')
        .set('Authorization', plain.authHeader)

      expect(res.status).toBe(200)
      expect(res.body.members).toHaveLength(2)
      expect(res.body.members.map((m: any) => m.role).sort()).toEqual(['member', 'owner'])
    })

    it('never exposes a password hash', async () => {
      const org = await organization()
      const owner = await member(org.id, 'owner')

      const res = await request(app)
        .get('/api/organizations/members')
        .set('Authorization', owner.authHeader)

      expect(JSON.stringify(res.body)).not.toContain('passwordHash')
      expect(JSON.stringify(res.body)).not.toContain('not-a-real-hash')
    })
  })
})
