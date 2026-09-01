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
