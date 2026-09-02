import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import crypto from 'crypto'
import { app } from '../../src/app.js'
import { prisma } from '../../src/services/db.js'
import { createUser } from './helpers.js'
import { signPayload, decryptSecret } from '../../src/services/webhooks.js'

/**
 * Configuring a webhook endpoint (features/0020).
 *
 * The delivery itself is `webhook-delivery.spec.ts`, which needs Redis. This
 * file is about the two refusals that have to be **loud**, and about the secret.
 *
 * A 32-byte key is set here rather than in the vitest config because most specs
 * must keep seeing a deployment with webhooks switched off — that is the default
 * and it has its own test below.
 */
const TEST_SIGNING_KEY = crypto.randomBytes(32).toString('base64')

describe('webhook endpoint management', () => {
  let owner: Awaited<ReturnType<typeof createUser>>

  async function setPlan(organizationId: string, planKey: string) {
    await prisma.organization.update({ where: { id: organizationId }, data: { planKey } })
  }

  beforeEach(async () => {
    owner = await createUser()
    await setPlan(owner.organization.id, 'team')

    // Webhooks need both: a queue to retry from, and a key to encrypt the
    // endpoint secret with.
    vi.stubEnv('REDIS_URL', 'redis://127.0.0.1:6379')
    vi.stubEnv('WEBHOOK_SIGNING_KEY', TEST_SIGNING_KEY)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  function create(body: unknown, auth = owner.authHeader) {
    return request(app).post('/api/organizations/webhooks').set('Authorization', auth).send(body)
  }

  it('returns the secret once, and stores it encrypted rather than in the clear', async () => {
    const response = await create({ url: 'https://example.com/hooks/vuepdf' })

    expect(response.status).toBe(201)
    const secret = response.body.webhook.secret as string
    expect(secret).toMatch(/^whsec_/)

    const stored = await prisma.webhookEndpoint.findFirstOrThrow({
      where: { organizationId: owner.organization.id }
    })

    // Not plaintext in the row: a leaked backup is the incident this protects
    // against, and it is the common one.
    expect(stored.secret).not.toContain(secret)
    // But recoverable, unlike an API key's hash — this one has to sign.
    expect(decryptSecret(stored.secret)).toBe(secret)

    // And the listing cannot hand it back.
    const listed = await request(app)
      .get('/api/organizations/webhooks')
      .set('Authorization', owner.authHeader)

    expect(listed.status).toBe(200)
    expect(listed.body.webhooks[0]).not.toHaveProperty('secret')
    expect(listed.body.webhooks[0]).toMatchObject({ url: 'https://example.com/hooks/vuepdf' })
  })

  describe('the URLs a customer may not configure', () => {
    it('refuses plain http', async () => {
      const response = await create({ url: 'http://example.com/hook' })
      expect(response.status).toBe(400)
      expect(response.body.error).toMatch(/https/i)
    })

    it('refuses an address inside the deployment', async () => {
      // The whole reason `services/webhook-egress.ts` exists: without it this
      // product is a proxy into its own network, and the cloud metadata service
      // is the first thing anybody points it at.
      for (const url of [
        'https://169.254.169.254/latest/meta-data/',
        'https://127.0.0.1:3000/api/forms',
        'https://10.0.0.5/hook',
        'https://localhost/hook'
      ]) {
        const response = await create({ url })
        expect(response.status).toBe(400)
      }

      expect(await prisma.webhookEndpoint.count()).toBe(0)
    })

    it('refuses credentials in the URL', async () => {
      expect((await create({ url: 'https://user:pass@example.com/hook' })).status).toBe(400)
    })
  })

  describe('the two refusals that must be loud', () => {
    it('answers 503, not silence, when there is no queue', async () => {
      vi.stubEnv('REDIS_URL', '')

      const response = await create({ url: 'https://example.com/hook' })

      // The inverse of features/0017's known hole. Accepting a configuration
      // that can never be delivered is the failure this product already made
      // once, in the feature whose whole purpose was telling somebody something.
      expect(response.status).toBe(503)
      expect(response.body.error).toMatch(/REDIS_URL|queue/i)
      expect(await prisma.webhookEndpoint.count()).toBe(0)
    })

    it('answers 503 when there is no signing key', async () => {
      vi.stubEnv('WEBHOOK_SIGNING_KEY', '')

      const response = await create({ url: 'https://example.com/hook' })

      expect(response.status).toBe(503)
      expect(response.body.error).toMatch(/WEBHOOK_SIGNING_KEY/)
      expect(await prisma.webhookEndpoint.count()).toBe(0)
    })
  })

  describe('who may configure one', () => {
    it('answers 402 when the plan does not include the API', async () => {
      await setPlan(owner.organization.id, 'pro')

      const response = await create({ url: 'https://example.com/hook' })

      expect(response.status).toBe(402)
    })

    it('answers 403 to a member', async () => {
      const member = await createUser()
      await prisma.membership.updateMany({
        where: { userId: member.user.id },
        data: { organizationId: owner.organization.id, role: 'member' }
      })

      expect((await create({ url: 'https://example.com/hook' }, member.authHeader)).status).toBe(403)
    })

    it('does not let one organization delete another\'s endpoint', async () => {
      const created = await create({ url: 'https://example.com/hook' })
      const id = created.body.webhook.id as string

      const stranger = await createUser()
      await setPlan(stranger.organization.id, 'team')

      const response = await request(app)
        .delete(`/api/organizations/webhooks/${id}`)
        .set('Authorization', stranger.authHeader)

      expect(response.status).toBe(404)
      expect(await prisma.webhookEndpoint.count({ where: { id } })).toBe(1)
    })

    it('deletes even when the deployment can no longer deliver', async () => {
      const created = await create({ url: 'https://example.com/hook' })
      const id = created.body.webhook.id as string

      // Turning delivery off must not need the thing that does the delivering.
      vi.stubEnv('REDIS_URL', '')
      vi.stubEnv('WEBHOOK_SIGNING_KEY', '')

      const response = await request(app)
        .delete(`/api/organizations/webhooks/${id}`)
        .set('Authorization', owner.authHeader)

      expect(response.status).toBe(200)
      expect(await prisma.webhookEndpoint.count({ where: { id } })).toBe(0)
    })
  })

  /**
   * Re-enabling a disabled endpoint (features/0022).
   *
   * The queue switches an endpoint off after ten consecutive failures and,
   * before this, nothing could switch it back on: `disabledAt` was written in
   * two places and cleared in none. What these assert is the narrowness — it
   * clears three columns and touches nothing else.
   */
  describe('re-enabling a disabled endpoint', () => {
    async function createDisabled() {
      const created = await create({ url: 'https://example.com/hook' })
      const id = created.body.webhook.id as string

      await prisma.webhookEndpoint.update({
        where: { id },
        data: {
          disabledAt: new Date(),
          consecutiveFailures: 10,
          lastError: 'connect ETIMEDOUT'
        }
      })

      return id
    }

    function reenable(id: string, auth = owner.authHeader) {
      return request(app).patch(`/api/organizations/webhooks/${id}`).set('Authorization', auth)
    }

    it('clears the three failure columns and nothing else', async () => {
      const id = await createDisabled()
      const before = await prisma.webhookEndpoint.findFirstOrThrow({ where: { id } })

      const response = await reenable(id)

      expect(response.status).toBe(200)
      expect(response.body.webhook).toMatchObject({
        id,
        disabledAt: null,
        lastError: null,
        consecutiveFailures: 0
      })

      const after = await prisma.webhookEndpoint.findFirstOrThrow({ where: { id } })
      expect(after.disabledAt).toBeNull()
      expect(after.consecutiveFailures).toBe(0)
      expect(after.lastError).toBeNull()
      // The identity of the endpoint is untouched: same URL, same events, and
      // above all the **same secret** — which is the whole reason this exists
      // rather than delete-and-recreate.
      expect(after.url).toBe(before.url)
      expect(after.events).toEqual(before.events)
      expect(after.secret).toBe(before.secret)
    })

    it('resets the counter even when the endpoint was not disabled', async () => {
      const created = await create({ url: 'https://example.com/hook' })
      const id = created.body.webhook.id as string
      await prisma.webhookEndpoint.update({
        where: { id },
        data: { consecutiveFailures: 3, lastError: 'connect ETIMEDOUT' }
      })

      expect((await reenable(id)).status).toBe(200)

      const after = await prisma.webhookEndpoint.findFirstOrThrow({ where: { id } })
      expect(after.consecutiveFailures).toBe(0)
    })

    it('never returns the secret', async () => {
      const id = await createDisabled()

      const response = await reenable(id)

      expect(response.body.webhook).not.toHaveProperty('secret')
    })

    it('accepts no url and no events', async () => {
      const id = await createDisabled()

      await request(app)
        .patch(`/api/organizations/webhooks/${id}`)
        .set('Authorization', owner.authHeader)
        .send({ url: 'https://attacker.example.com/hook', events: ['response.created'] })

      const after = await prisma.webhookEndpoint.findFirstOrThrow({ where: { id } })
      // A body is ignored rather than applied. Re-pointing an endpoint under an
      // existing secret is a different feature; this one only revives.
      expect(after.url).toBe('https://example.com/hook')
    })

    it('refuses when the stored URL no longer resolves to somewhere public', async () => {
      const id = await createDisabled()
      // DNS moves. A hostname that was public when it was configured can point
      // inside this network today, which is why the check is re-run here and
      // not only at configuration.
      await prisma.webhookEndpoint.update({
        where: { id },
        data: { url: 'https://localhost/hook' }
      })

      const response = await reenable(id)

      expect(response.status).toBe(400)
      const after = await prisma.webhookEndpoint.findFirstOrThrow({ where: { id } })
      expect(after.disabledAt).not.toBeNull()
    })

    it('answers 503 when the deployment cannot deliver', async () => {
      const id = await createDisabled()
      // Unlike DELETE, this turns delivery **on**, so it needs the thing that
      // does the delivering.
      vi.stubEnv('REDIS_URL', '')

      expect((await reenable(id)).status).toBe(503)
    })

    it('answers 402 when the plan no longer includes the API', async () => {
      const id = await createDisabled()
      await setPlan(owner.organization.id, 'free')

      expect((await reenable(id)).status).toBe(402)
    })

    it('answers 403 to a member', async () => {
      const id = await createDisabled()
      const member = await createUser()
      await prisma.membership.updateMany({
        where: { userId: member.user.id },
        data: { organizationId: owner.organization.id, role: 'member' }
      })

      expect((await reenable(id, member.authHeader)).status).toBe(403)
    })

    it('does not let one organization re-enable another\'s endpoint', async () => {
      const id = await createDisabled()
      const stranger = await createUser()
      await setPlan(stranger.organization.id, 'team')

      expect((await reenable(id, stranger.authHeader)).status).toBe(404)

      const after = await prisma.webhookEndpoint.findFirstOrThrow({ where: { id } })
      expect(after.disabledAt).not.toBeNull()
    })
  })

  /**
   * The delivery log on the session API (features/0022) — the same history as
   * `GET /api/v1/webhooks/deliveries`, for somebody looking at a screen instead
   * of an integration holding a key.
   */
  describe('the delivery log a person can read', () => {
    async function createWithDelivery() {
      const created = await create({ url: 'https://example.com/hook' })
      const id = created.body.webhook.id as string

      await prisma.webhookDelivery.create({
        data: {
          endpointId: id,
          eventId: 'evt_1',
          eventType: 'response.created',
          attempt: 1,
          status: 500,
          durationMs: 42,
          succeeded: false,
          error: 'HTTP 500'
        }
      })

      return id
    }

    function deliveries(id: string, auth = owner.authHeader) {
      return request(app)
        .get(`/api/organizations/webhooks/${id}/deliveries`)
        .set('Authorization', auth)
    }

    it('returns the attempts, newest first, and no payload body', async () => {
      const id = await createWithDelivery()

      const response = await deliveries(id)

      expect(response.status).toBe(200)
      expect(response.body.deliveries).toHaveLength(1)
      expect(response.body.deliveries[0]).toMatchObject({
        eventType: 'response.created',
        attempt: 1,
        status: 500,
        succeeded: false
      })
      // There is no body stored and none to return: it carries the answers a
      // member of the public typed, and a log holding them would outlive the
      // form they came from.
      expect(response.body.deliveries[0]).not.toHaveProperty('payload')
      expect(response.body.deliveries[0]).not.toHaveProperty('body')
    })

    it('is readable when the deployment can no longer deliver', async () => {
      const id = await createWithDelivery()
      // Seeing the history is how somebody diagnoses why nothing is arriving,
      // so it must not need the thing that is missing.
      vi.stubEnv('REDIS_URL', '')
      vi.stubEnv('WEBHOOK_SIGNING_KEY', '')

      expect((await deliveries(id)).status).toBe(200)
    })

    it('does not show one organization another\'s deliveries', async () => {
      const id = await createWithDelivery()
      const stranger = await createUser()
      await setPlan(stranger.organization.id, 'team')

      const response = await deliveries(id, stranger.authHeader)

      expect(response.status).toBe(404)
      expect(response.body).not.toHaveProperty('deliveries')
    })

    it('answers 403 to a member', async () => {
      const id = await createWithDelivery()
      const member = await createUser()
      await prisma.membership.updateMany({
        where: { userId: member.user.id },
        data: { organizationId: owner.organization.id, role: 'member' }
      })

      expect((await deliveries(id, member.authHeader)).status).toBe(403)
    })
  })

  describe('the signature a customer verifies', () => {
    it('is an HMAC over `<timestamp>.<raw body>`, verifiable independently', () => {
      const secret = 'whsec_example'
      const signed = signPayload({
        secret,
        eventId: 'evt_1',
        eventType: 'response.created',
        payload: { hello: 'world' },
        timestamp: 1700000000
      })

      const header = signed.headers['X-VuePDF-Signature'] as string
      const [t, v1] = header.split(',')

      expect(t).toBe('t=1700000000')

      // Verified the way a customer's server would, from the raw body and
      // nothing else — the reverse of the lesson features/0013 learned when
      // `express.json()` re-serialised Stripe's bytes and broke every check.
      const expected = crypto
        .createHmac('sha256', secret)
        .update(`1700000000.${signed.body}`)
        .digest('hex')

      expect(v1).toBe(`v1=${expected}`)

      // The timestamp is inside the signed material, so a captured payload
      // cannot be replayed with a fresh `t`.
      const tampered = crypto
        .createHmac('sha256', secret)
        .update(`1700009999.${signed.body}`)
        .digest('hex')
      expect(tampered).not.toBe(expected)
    })

    it('signs exactly the bytes it sends', () => {
      const signed = signPayload({
        secret: 'whsec_example',
        eventId: 'evt_2',
        eventType: 'response.created',
        payload: { a: 1, b: 'two' }
      })

      // One serialisation, used for both. Serialising twice is how a signature
      // comes to cover bytes that were never transmitted.
      expect(JSON.parse(signed.body)).toEqual({ a: 1, b: 'two' })
      expect(signed.headers['X-VuePDF-Event-Id']).toBe('evt_2')
    })
  })
})
