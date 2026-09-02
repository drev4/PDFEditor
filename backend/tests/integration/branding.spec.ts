import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { prisma } from '../../src/services/db.js'
import { app } from '../../src/app.js'
import { createUser, createForm } from './helpers.js'

/**
 * The "Made with VuePDF" mark as a plan entitlement
 * ([`features/0014`](../../../features/0014-close-the-subscription-surface.md)).
 *
 * Database-backed because it depends on `Organization.planKey`, which is what
 * `effectivePlan` resolves — a mocked Prisma would be asserting the mock.
 *
 * The negative assertions here matter as much as the positive ones. This
 * endpoint is **anonymous**: whoever holds a share link gets this payload, and
 * the rule the whole plan design rests on is that a respondent learns nothing
 * about how the owner pays. `toApiForm` already strips the organization; the
 * risk this feature introduced is leaking the plan through a new door.
 */
describe('public form branding', () => {
  /** Publishes a form for an organization pinned to `planKey`. */
  async function publishedFormOn(planKey: string) {
    const { user, organization } = await createUser()
    await prisma.organization.update({ where: { id: organization.id }, data: { planKey } })
    const form = await createForm(user.id, { status: 'published' })
    return { form, organization }
  }

  it('shows the mark for a free organization', async () => {
    const { form } = await publishedFormOn('free')

    const response = await request(app).get(`/api/forms/public/${form.shareId}`)

    expect(response.status).toBe(200)
    // `free` has `hasBranding: false` — it does not get to remove our mark.
    expect(response.body.showBranding).toBe(true)
  })

  it('removes the mark for an organization on Pro', async () => {
    const { form } = await publishedFormOn('pro')

    const response = await request(app).get(`/api/forms/public/${form.shareId}`)

    expect(response.status).toBe(200)
    expect(response.body.showBranding).toBe(false)
  })

  it('shows the mark when the stored plan is one the catalogue does not know', async () => {
    // `resolvePlan` degrades downward to free, deliberately: the failure mode of
    // guessing high is giving the product away. That has to hold here too, or a
    // hand-edited row silently removes our mark.
    const { form } = await publishedFormOn('enterprise-that-never-existed')

    const response = await request(app).get(`/api/forms/public/${form.shareId}`)

    expect(response.body.showBranding).toBe(true)
  })

  it('tells the respondent nothing else about the owner or the plan', async () => {
    const { form, organization } = await publishedFormOn('pro')

    const response = await request(app).get(`/api/forms/public/${form.shareId}`)
    const body = JSON.stringify(response.body)

    // The one boolean, and nothing more. A payload carrying the plan — or the
    // whole entitlements object, which is the tempting implementation — would
    // publish the customer's billing state to anyone with the share link, and
    // would undo the reason the response limit answers 404 here instead of 402.
    expect(response.body.showBranding).toBe(false)
    expect(response.body.plan).toBeUndefined()
    expect(response.body.usage).toBeUndefined()
    expect(response.body.subscription).toBeUndefined()

    expect(body).not.toContain(organization.id)
    expect(body).not.toContain('planKey')
    expect(body).not.toContain('maxResponsesPerMonth')
    expect(body).not.toMatch(/\bpro\b/)
  })

  it('is not reachable at all for an unpublished form, whatever the plan', async () => {
    const { user, organization } = await createUser()
    await prisma.organization.update({ where: { id: organization.id }, data: { planKey: 'pro' } })
    const draft = await createForm(user.id, { status: 'draft' })

    const response = await request(app).get(`/api/forms/public/${draft.shareId}`)

    // The branding read must not have moved the 404 that guards this route.
    expect(response.status).toBe(404)
  })
})
