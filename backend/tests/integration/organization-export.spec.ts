import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { app } from '../../src/app.js'
import { prisma } from '../../src/services/db.js'
import { resetRateLimitStores } from '../../src/middleware/rateLimit.js'
import { createUser, createForm, createField, createResponse } from './helpers.js'

/**
 * The organization data export (features/0030).
 *
 * Database-backed because the questions are all about what a real query returns
 * across five tables — an archived field that still explains an answer, a second
 * organization that must not appear, more responses than one page holds. A
 * mocked Prisma would be asserting the mock.
 *
 * Every test parses the body rather than matching strings: the point of the
 * format is that it is machine-readable, and a test that accepted a truncated
 * document would defeat the marker the whole design turns on.
 */
describe('GET /api/organizations/export', () => {
  beforeEach(async () => {
    await resetRateLimitStores()
  })

  /** Parses the response body, failing loudly if the stream was truncated. */
  function parse(text: string): any {
    try {
      return JSON.parse(text)
    } catch (error) {
      throw new Error(`Export did not parse as JSON (${(error as Error).message}). Body starts: ${text.slice(0, 200)}`)
    }
  }

  it('refuses a member, and answers 403 rather than 404', async () => {
    const owner = await createUser()
    const member = await createUser()
    await prisma.membership.create({
      data: { organizationId: owner.organization.id, userId: member.user.id, role: 'member' }
    })
    await prisma.user.update({
      where: { id: member.user.id },
      data: { activeOrganizationId: owner.organization.id }
    })

    const res = await request(app).get('/api/organizations/export').set('Authorization', member.authHeader)

    // 403, not 404: they *are* a member, the role is what is insufficient.
    expect(res.status).toBe(403)
  })

  it('lets an admin export', async () => {
    const owner = await createUser()
    const admin = await createUser()
    await prisma.membership.create({
      data: { organizationId: owner.organization.id, userId: admin.user.id, role: 'admin' }
    })
    await prisma.user.update({
      where: { id: admin.user.id },
      data: { activeOrganizationId: owner.organization.id }
    })

    const res = await request(app).get('/api/organizations/export').set('Authorization', admin.authHeader)

    expect(res.status).toBe(200)
    expect(parse(res.text).organization.id).toBe(owner.organization.id)
  })

  it('requires authentication', async () => {
    await request(app).get('/api/organizations/export').expect(401)
  })

  it('is served as a downloadable JSON file named after the organization', async () => {
    const owner = await createUser()

    const res = await request(app).get('/api/organizations/export').set('Authorization', owner.authHeader)

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/application\/json/)
    expect(res.headers['content-disposition']).toContain(`vuepdf-export-${owner.organization.slug}-`)
    expect(res.headers['content-disposition']).toContain('.json')
  })

  it('carries the forms, their fields, the responses and their answers', async () => {
    const owner = await createUser()
    const form = await createForm(owner.user.id, { title: 'Inspection' })
    const field = await createField(form.id, { label: 'Site name' })
    await createResponse(form.id, { [field.id]: 'Bristol depot' })

    const res = await request(app).get('/api/organizations/export').set('Authorization', owner.authHeader)
    const body = parse(res.text)

    expect(body.forms).toHaveLength(1)
    expect(body.forms[0].title).toBe('Inspection')
    expect(body.forms[0].fields[0].label).toBe('Site name')

    expect(body.responses).toHaveLength(1)
    expect(body.responses[0].formId).toBe(form.id)
    expect(body.responses[0].answers).toEqual([{ fieldId: field.id, value: 'Bristol depot' }])
  })

  /**
   * An archived field is the only thing that explains an answer collected before
   * the question was removed. Dropping it would hand the customer values keyed
   * to a field id appearing nowhere in their own file.
   */
  it('keeps an archived field, and says when it was archived', async () => {
    const owner = await createUser()
    const form = await createForm(owner.user.id)
    const field = await createField(form.id, { label: 'Removed question' })
    await createResponse(form.id, { [field.id]: 'an answer that outlived its question' })
    await prisma.field.update({ where: { id: field.id }, data: { deletedAt: new Date() } })

    const res = await request(app).get('/api/organizations/export').set('Authorization', owner.authHeader)
    const body = parse(res.text)

    const exported = body.forms[0].fields.find((f: any) => f.id === field.id)
    expect(exported).toBeDefined()
    expect(exported.label).toBe('Removed question')
    expect(exported.archivedAt).not.toBeNull()
    expect(body.responses[0].answers[0].fieldId).toBe(field.id)
  })

  it('carries the members and the usage counters', async () => {
    const owner = await createUser()
    const colleague = await createUser()
    await prisma.membership.create({
      data: { organizationId: owner.organization.id, userId: colleague.user.id, role: 'admin' }
    })
    await prisma.usageCounter.create({
      data: { organizationId: owner.organization.id, period: '2026-09', responses: 7 }
    })

    const res = await request(app).get('/api/organizations/export').set('Authorization', owner.authHeader)
    const body = parse(res.text)

    expect(body.members).toHaveLength(2)
    expect(body.members.map((m: any) => m.role).sort()).toEqual(['admin', 'owner'])
    expect(body.usage).toEqual([
      expect.objectContaining({ period: '2026-09', responses: 7 })
    ])
  })

  /**
   * The tenancy assertion. A caller in two organizations exports the one they
   * are acting in — merging them would put another tenant's respondent data in
   * this customer's file (features/0023).
   */
  it('never reaches beyond the active organization', async () => {
    const mine = await createUser()
    const theirs = await createUser()

    await prisma.membership.create({
      data: { organizationId: theirs.organization.id, userId: mine.user.id, role: 'owner' }
    })

    const myForm = await createForm(mine.user.id, { title: 'Mine' })
    await prisma.form.create({
      data: {
        organizationId: theirs.organization.id,
        createdByUserId: theirs.user.id,
        title: 'Theirs',
        shareId: `share-${Math.random().toString(36).slice(2, 11)}`,
        status: 'draft'
      }
    })

    const res = await request(app).get('/api/organizations/export').set('Authorization', mine.authHeader)
    const body = parse(res.text)

    expect(body.organization.id).toBe(mine.organization.id)
    expect(body.forms.map((f: any) => f.id)).toEqual([myForm.id])
    expect(res.text).not.toContain('Theirs')
  })

  it('never contains a password hash or a token hash', async () => {
    const owner = await createUser()
    await prisma.user.update({
      where: { id: owner.user.id },
      data: { passwordHash: 'a-very-recognisable-hash-value' }
    })
    await createForm(owner.user.id)

    const res = await request(app).get('/api/organizations/export').set('Authorization', owner.authHeader)

    expect(res.text).not.toContain('a-very-recognisable-hash-value')
    expect(res.text).not.toContain('passwordHash')
    expect(res.text).not.toContain('tokenHash')
    expect(parse(res.text).exportedBy.email).toBe(owner.user.email)
  })

  /**
   * More responses than `RESPONSE_PAGE_SIZE` (200), so the cursor paging runs at
   * least twice. Without it the test would pass against an implementation that
   * loads everything at once — which is the implementation this feature exists
   * to avoid.
   */
  it('returns every response when there is more than one page of them', async () => {
    const owner = await createUser()
    const form = await createForm(owner.user.id)
    const field = await createField(form.id)

    const total = 205
    await prisma.response.createMany({
      data: Array.from({ length: total }, () => ({ formId: form.id, ipAddress: '127.0.0.1' }))
    })
    const created = await prisma.response.findMany({ where: { formId: form.id }, select: { id: true } })
    await prisma.answer.createMany({
      data: created.map(r => ({ responseId: r.id, fieldId: field.id, value: 'v' }))
    })

    const res = await request(app).get('/api/organizations/export').set('Authorization', owner.authHeader)
    const body = parse(res.text)

    expect(body.responses).toHaveLength(total)
    expect(new Set(body.responses.map((r: any) => r.id)).size).toBe(total)
    expect(body.complete).toBe(true)
  })

  /**
   * The marker is the reader's only proof that the writer reached the end, and
   * it must be the **last** thing in the document — emitted at the top it would
   * appear in a truncated file too, which is the whole failure it exists to
   * catch.
   */
  it('ends with the completion marker, and ends with it last', async () => {
    const owner = await createUser()
    await createForm(owner.user.id)

    const res = await request(app).get('/api/organizations/export').set('Authorization', owner.authHeader)

    expect(parse(res.text).complete).toBe(true)
    expect(res.text.trimEnd().endsWith('"complete": true\n}')).toBe(true)
  })

  it('exports an empty organization as a valid, complete document', async () => {
    const owner = await createUser()

    const res = await request(app).get('/api/organizations/export').set('Authorization', owner.authHeader)
    const body = parse(res.text)

    expect(body.forms).toEqual([])
    expect(body.responses).toEqual([])
    expect(body.usage).toEqual([])
    expect(body.version).toBe(1)
    expect(body.complete).toBe(true)
  })
})
