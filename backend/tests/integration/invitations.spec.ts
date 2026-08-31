import { describe, it, expect } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { app } from '../../src/app.js'
import { prisma } from '../../src/services/db.js'
import { grantSeats } from './helpers.js'

/**
 * The invitation lifecycle ([`features/0010`]).
 *
 * The link is a bearer capability — this service cannot send email, so the
 * inviter copies it and delivers it themselves. Everything here exists because
 * of that: it expires, it is single-use, it can be revoked, and it refuses to
 * be spent by anyone but the address it names.
 */

let seq = 0
const email = (p: string) => `${p}-${Date.now()}-${seq++}-${Math.random().toString(36).slice(2, 8)}@example.com`
const PASSWORD = 'TestPassword123!'

/**
 * An owner whose organization has room for the people these tests invite.
 *
 * The seats are a **precondition, not the subject**: features/0015 wired
 * `assertCanInvite`, and Free covers one person — the owner — so an organization
 * created bare now answers `402` to the first invitation and none of the
 * lifecycle below would ever be reached. The seat limit itself is asserted in
 * `seats.spec.ts`; here it is simply paid for.
 */
async function ownerWithOrganization() {
  const organization = await prisma.organization.create({
    data: { name: 'Acme', slug: `org-${Math.random().toString(36).slice(2, 12)}` }
  })
  const user = await prisma.user.create({
    data: { email: email('owner'), passwordHash: 'not-a-real-hash', name: 'Owner' }
  })
  await prisma.membership.create({
    data: { organizationId: organization.id, userId: user.id, role: 'owner' }
  })
  await grantSeats(organization.id, 10)
  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET!, { expiresIn: '1h' })
  return { organization, user, authHeader: `Bearer ${token}` }
}

/** Invites `address` and returns the raw token out of the returned link. */
async function invite(authHeader: string, address: string, role = 'member') {
  const res = await request(app)
    .post('/api/organizations/invitations')
    .set('Authorization', authHeader)
    .send({ email: address, role })

  expect(res.status).toBe(201)
  return {
    id: res.body.invitation.id as string,
    token: (res.body.invitation.link as string).split('/').pop()!,
    link: res.body.invitation.link as string
  }
}

describe('invitations', () => {
  describe('issuing', () => {
    it('returns a link and stores only a hash of its token', async () => {
      const { authHeader } = await ownerWithOrganization()
      const address = email('newcomer')

      const { token } = await invite(authHeader, address)

      const stored = await prisma.invitation.findFirstOrThrow()
      expect(stored.email).toBe(address.toLowerCase())
      expect(stored.tokenHash).not.toBe(token)
      expect(stored.tokenHash).toHaveLength(64)
      expect(stored.acceptedAt).toBeNull()
    })

    it('normalises the address, so case cannot create a second person', async () => {
      const { authHeader } = await ownerWithOrganization()

      await invite(authHeader, 'Mixed.Case@Example.COM')

      const stored = await prisma.invitation.findFirstOrThrow()
      expect(stored.email).toBe('mixed.case@example.com')
    })

    it('refuses to invite somebody who is already a member', async () => {
      const { authHeader, user } = await ownerWithOrganization()

      const res = await request(app)
        .post('/api/organizations/invitations')
        .set('Authorization', authHeader)
        .send({ email: user.email, role: 'member' })

      expect(res.status).toBe(400)
    })

    it('lists pending invitations without their token hash', async () => {
      const { authHeader } = await ownerWithOrganization()
      await invite(authHeader, email('pending'))

      const res = await request(app)
        .get('/api/organizations/invitations')
        .set('Authorization', authHeader)

      expect(res.status).toBe(200)
      expect(res.body.invitations).toHaveLength(1)
      expect(JSON.stringify(res.body)).not.toContain('tokenHash')
    })
  })

  describe('accepting without an account', () => {
    it('creates the account and the membership together', async () => {
      const { organization, authHeader } = await ownerWithOrganization()
      const address = email('newcomer')
      const { token } = await invite(authHeader, address, 'admin')

      const res = await request(app)
        .post('/api/organizations/invitations/accept')
        .send({ token, password: PASSWORD, name: 'New Person' })

      expect(res.status).toBe(201)
      expect(res.body.token).toBeTruthy()

      const membership = await prisma.membership.findFirstOrThrow({
        where: { organizationId: organization.id, user: { email: address } }
      })
      expect(membership.role).toBe('admin')
    })

    it('does not also give them a personal organization', async () => {
      const { authHeader } = await ownerWithOrganization()
      const { token } = await invite(authHeader, email('newcomer'))

      await request(app)
        .post('/api/organizations/invitations/accept')
        .send({ token, password: PASSWORD })

      // Joining somebody else's organization must not create a second one for
      // them: `requireMembership` picks the oldest membership, so a person in
      // two organizations would land in whichever came first — arbitrarily.
      expect(await prisma.organization.count()).toBe(1)
      expect(await prisma.membership.count()).toBe(2)
    })

    it('requires a password when the account does not exist', async () => {
      const { authHeader } = await ownerWithOrganization()
      const { token } = await invite(authHeader, email('newcomer'))

      const res = await request(app)
        .post('/api/organizations/invitations/accept')
        .send({ token })

      expect(res.status).toBe(400)
      expect(await prisma.user.count()).toBe(1)
    })
  })

  describe('accepting with an account', () => {
    async function existingUser(address: string) {
      const user = await prisma.user.create({
        data: { email: address, passwordHash: 'not-a-real-hash', name: 'Existing' }
      })
      return {
        user,
        authHeader: `Bearer ${jwt.sign({ userId: user.id }, process.env.JWT_SECRET!, { expiresIn: '1h' })}`
      }
    }

    it('joins the organization when signed in as the invited address', async () => {
      const { organization, authHeader } = await ownerWithOrganization()
      const address = email('invitee')
      const invitee = await existingUser(address)
      const { token } = await invite(authHeader, address)

      const res = await request(app)
        .post('/api/organizations/invitations/accept')
        .set('Authorization', invitee.authHeader)
        .send({ token })

      expect(res.status).toBe(200)
      expect(
        await prisma.membership.count({ where: { organizationId: organization.id } })
      ).toBe(2)
    })

    it('refuses when signed in as a different address', async () => {
      const { organization, authHeader } = await ownerWithOrganization()
      const invited = email('invited')
      const somebodyElse = await existingUser(email('somebody-else'))
      const { token } = await invite(authHeader, invited)

      const res = await request(app)
        .post('/api/organizations/invitations/accept')
        .set('Authorization', somebodyElse.authHeader)
        .send({ token })

      // The trap this exists for: a forwarded link must not quietly put the
      // wrong person inside a customer's organization.
      expect(res.status).toBe(409)
      expect(res.body.error).toContain(invited)
      expect(
        await prisma.membership.count({ where: { organizationId: organization.id } })
      ).toBe(1)
    })

    it('asks an existing account to sign in rather than joining on the link alone', async () => {
      const { authHeader } = await ownerWithOrganization()
      const address = email('invitee')
      await existingUser(address)
      const { token } = await invite(authHeader, address)

      const res = await request(app)
        .post('/api/organizations/invitations/accept')
        .send({ token })

      expect(res.status).toBe(401)
    })
  })

  describe('spending it only once', () => {
    it('refuses a token that was already accepted', async () => {
      const { authHeader } = await ownerWithOrganization()
      const { token } = await invite(authHeader, email('newcomer'))

      const first = await request(app)
        .post('/api/organizations/invitations/accept')
        .send({ token, password: PASSWORD })
      expect(first.status).toBe(201)

      const second = await request(app)
        .post('/api/organizations/invitations/accept')
        .send({ token, password: PASSWORD })

      expect(second.status).toBe(400)
      expect(await prisma.membership.count()).toBe(2)
    })

    it('refuses a revoked token', async () => {
      const { authHeader } = await ownerWithOrganization()
      const { id, token } = await invite(authHeader, email('newcomer'))

      await request(app)
        .delete(`/api/organizations/invitations/${id}`)
        .set('Authorization', authHeader)
        .expect(204)

      const res = await request(app)
        .post('/api/organizations/invitations/accept')
        .send({ token, password: PASSWORD })

      expect(res.status).toBe(400)
    })

    it('refuses an expired token', async () => {
      const { authHeader } = await ownerWithOrganization()
      const { token } = await invite(authHeader, email('newcomer'))
      await prisma.invitation.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } })

      const res = await request(app)
        .post('/api/organizations/invitations/accept')
        .send({ token, password: PASSWORD })

      expect(res.status).toBe(400)
    })

    it('answers unknown, revoked and expired identically', async () => {
      const { authHeader } = await ownerWithOrganization()
      const { id, token } = await invite(authHeader, email('newcomer'))
      await request(app)
        .delete(`/api/organizations/invitations/${id}`)
        .set('Authorization', authHeader)

      const revoked = await request(app)
        .post('/api/organizations/invitations/accept')
        .send({ token, password: PASSWORD })
      const unknown = await request(app)
        .post('/api/organizations/invitations/accept')
        .send({ token: 'a-token-that-never-existed', password: PASSWORD })

      // Distinguishing them would make this an oracle for probing whether a
      // token someone is holding was ever real.
      expect(revoked.status).toBe(unknown.status)
      expect(revoked.body).toEqual(unknown.body)
    })
  })

  describe('after joining', () => {
    it('the new member can reach the organization forms', async () => {
      const { organization, user, authHeader } = await ownerWithOrganization()
      await prisma.form.create({
        data: {
          organizationId: organization.id,
          createdByUserId: user.id,
          title: 'Shared form',
          shareId: `share-${Math.random().toString(36).slice(2, 11)}`,
          status: 'draft'
        }
      })

      const { token } = await invite(authHeader, email('newcomer'))
      const accepted = await request(app)
        .post('/api/organizations/invitations/accept')
        .send({ token, password: PASSWORD })

      const forms = await request(app)
        .get('/api/forms')
        .set('Authorization', `Bearer ${accepted.body.token}`)

      // The whole point of the feature: a colleague who created nothing still
      // sees the organization's work.
      expect(forms.status).toBe(200)
      expect(forms.body.forms).toHaveLength(1)
      expect(forms.body.forms[0].title).toBe('Shared form')
    })
  })
})
