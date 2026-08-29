import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { app } from '../../src/app.js'
import { prisma } from '../../src/services/db.js'
import { createUser, createForm, createField, createResponse } from './helpers.js'

/**
 * Organizations as the unit of ownership ([`features/0009`]).
 *
 * The cascade assertions are the important ones. This change rewrote what
 * deleting a user destroys, and the cascade map in docs/sot/03-domain-model.md
 * is only as trustworthy as the tests underneath it.
 */
describe('organizations', () => {
  const password = 'TestPassword123!'
  const email = () => `org-${Date.now()}-${Math.random().toString(36).slice(2, 10)}@example.com`

  describe('registration', () => {
    it('creates the account, its organization and an owner membership', async () => {
      const address = email()

      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: address, password, name: 'Ada Lovelace' })

      expect(res.status).toBe(201)

      const memberships = await prisma.membership.findMany({ include: { organization: true } })
      expect(memberships).toHaveLength(1)
      expect(memberships[0].role).toBe('owner')
      expect(memberships[0].userId).toBe(res.body.user.id)
      expect(memberships[0].organization.name).toBe('Ada Lovelace')
      expect(memberships[0].organization.slug).toMatch(/^ada-lovelace-/)
    })

    it('names the organization after the email when no name is given', async () => {
      const address = email()

      await request(app).post('/api/auth/register').send({ email: address, password })

      const organization = await prisma.organization.findFirstOrThrow()
      expect(organization.name).toBe(address.split('@')[0])
    })

    it('gives two accounts with the same name different slugs', async () => {
      await request(app).post('/api/auth/register').send({ email: email(), password, name: 'Acme' })
      await request(app).post('/api/auth/register').send({ email: email(), password, name: 'Acme' })

      const slugs = (await prisma.organization.findMany()).map(o => o.slug)
      expect(slugs).toHaveLength(2)
      expect(new Set(slugs).size).toBe(2)
    })

    it('leaves no organization behind when registration fails', async () => {
      const address = email()
      await request(app).post('/api/auth/register').send({ email: address, password })

      const rejected = await request(app).post('/api/auth/register').send({ email: address, password })

      expect(rejected.status).toBe(400)
      // One user, one organization. The invariant this protects is that these
      // two counts never diverge — an account with no organization cannot
      // create a form and has no way to repair itself.
      expect(await prisma.user.count()).toBe(1)
      expect(await prisma.organization.count()).toBe(1)
    })
  })

  describe('creating a form', () => {
    it('attaches it to the caller organization and records the creator', async () => {
      const { user, organization, authHeader } = await createUser()

      const res = await request(app)
        .post('/api/forms')
        .set('Authorization', authHeader)
        .send({ title: 'A form' })

      expect(res.status).toBe(201)
      const stored = await prisma.form.findUniqueOrThrow({ where: { id: res.body.form.id } })
      expect(stored.organizationId).toBe(organization.id)
      expect(stored.createdByUserId).toBe(user.id)
    })

    it('does not leak the owner to an anonymous respondent', async () => {
      const { user, organization } = await createUser()
      const form = await createForm(user.id)

      const res = await request(app).get(`/api/forms/public/${form.shareId}`)

      expect(res.status).toBe(200)
      const body = JSON.stringify(res.body)
      expect(body).not.toContain(organization.id)
      expect(body).not.toContain(user.id)
    })
  })

  describe('cascades', () => {
    it('deleting a user no longer destroys the organization forms', async () => {
      const { user, organization } = await createUser()
      const form = await createForm(user.id)
      const field = await createField(form.id)
      await createResponse(form.id, { [field.id]: 'an answer' })

      await prisma.user.delete({ where: { id: user.id } })

      // Before this feature Form.user was onDelete: Cascade, so this deleted
      // the form, its fields and every response collected through it. The
      // organization owns them now, and colleagues may depend on them.
      const surviving = await prisma.form.findUnique({ where: { id: form.id } })
      expect(surviving).not.toBeNull()
      expect(surviving!.organizationId).toBe(organization.id)
      // Provenance is lost rather than the data. That is the deliberate trade.
      expect(surviving!.createdByUserId).toBeNull()
      expect(await prisma.answer.count()).toBe(1)
    })

    it('deleting a user removes their memberships', async () => {
      const { user } = await createUser()

      await prisma.user.delete({ where: { id: user.id } })

      expect(await prisma.membership.count()).toBe(0)
      // The organization outlives its last member. Nothing deletes it, and
      // nothing can reach its forms any more — filed in docs/BACKLOG.md.
      expect(await prisma.organization.count()).toBe(1)
    })

    it('deleting an organization destroys its forms and responses', async () => {
      const { user, organization } = await createUser()
      const form = await createForm(user.id)
      const field = await createField(form.id)
      await createResponse(form.id, { [field.id]: 'an answer' })

      // The largest blast radius in the schema, and deliberate: an organization
      // is the tenant, so deleting it deletes the tenant's data. No endpoint
      // does this; it fires only from the database.
      await prisma.organization.delete({ where: { id: organization.id } })

      expect(await prisma.form.count()).toBe(0)
      expect(await prisma.response.count()).toBe(0)
      expect(await prisma.answer.count()).toBe(0)
    })
  })

  describe('membership', () => {
    it('cannot be duplicated for the same user and organization', async () => {
      const { user, organization } = await createUser()

      await expect(
        prisma.membership.create({
          data: { organizationId: organization.id, userId: user.id, role: 'admin' }
        })
      ).rejects.toThrow()
    })
  })
})
