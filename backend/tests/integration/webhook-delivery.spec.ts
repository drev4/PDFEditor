import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import crypto from 'crypto'
import https from 'https'
import type { AddressInfo } from 'net'
import { app } from '../../src/app.js'
import { prisma } from '../../src/services/db.js'
import { createUser, createForm, createField } from './helpers.js'
import { mintWebhookSecret } from '../../src/services/webhooks.js'
import {
  createWebhookWorker,
  closeWebhookQueue,
  clearWebhookQueue,
  webhookQueueStatus,
  type WebhookWorkerHandle
} from '../../src/services/webhook-queue.js'

/**
 * A webhook delivered end to end (features/0020): a real submission, a real
 * queue, a real worker, and a real HTTPS server standing in for the customer.
 *
 * **It skips itself unless `TEST_REDIS_URL` is set**, like the other Redis-backed
 * specs — the queue is not optional for webhooks, so there is no inline path to
 * fall back on and no way to test this offline.
 *
 * The receiver is a genuine TLS server on `127.0.0.1`, which collides with the
 * egress guard on purpose: loopback is exactly what that guard exists to refuse.
 * So the endpoint row is written directly with a `127.0.0.1` URL — bypassing the
 * validation a customer goes through — and `assertDeliverableUrl` is stubbed for
 * the worker's own re-check. That is a deliberate, narrow hole opened by the
 * test and never by the product, and `webhooks.spec.ts` asserts the same URL is
 * refused through the API.
 */
const TEST_REDIS_URL = process.env.TEST_REDIS_URL?.trim()

/**
 * The **only** thing stubbed in this file, and narrowly.
 *
 * The receiver is a real TLS server on `127.0.0.1`, and loopback is exactly
 * what the egress guard exists to refuse — so the guard's *URL check* is
 * replaced here while the delivery client itself, signature and all, stays
 * real. The guard has its own unit spec (`tests/webhook-egress.spec.ts`) and
 * `webhooks.spec.ts` asserts the API refuses this very URL, so nothing about
 * the protection goes untested; what this file exercises is everything after
 * it.
 */
vi.mock('../../src/services/webhook-egress.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/services/webhook-egress.js')>()
  return {
    ...actual,
    assertDeliverableUrl: async (raw: string) => ({
      url: new URL(raw),
      addresses: [{ address: '127.0.0.1', family: 4 }]
    })
  }
})

describe.skipIf(!TEST_REDIS_URL)('webhook delivery', { timeout: 90_000 }, () => {
  let workerHandle: WebhookWorkerHandle
  let server: https.Server
  let receiverPort: number
  let owner: Awaited<ReturnType<typeof createUser>>
  let formId: string
  let shareId: string
  let fieldId: string
  let secret: string

  /** Every request the fake customer endpoint received. */
  let received: { body: string; headers: Record<string, string | string[] | undefined> }[] = []
  /** What the fake customer endpoint answers next. */
  let answerWith = 200

  beforeAll(async () => {
    process.env.REDIS_URL = TEST_REDIS_URL
    process.env.REDIS_KEY_PREFIX = `vuepdf-test-${process.pid}-wh`
    process.env.WEBHOOK_SIGNING_KEY = crypto.randomBytes(32).toString('base64')
    // The real backoff is tens of seconds. A test cannot wait that out, and
    // waiting is not what is under test — that retries happen at all is.
    process.env.WEBHOOK_BACKOFF_MS = '100'

    // A self-signed TLS server: the delivery client speaks https and nothing
    // else, so the test has to as well.
    const { key, cert } = await selfSigned()
    server = https.createServer({ key, cert }, (req, res) => {
      let body = ''
      req.on('data', chunk => { body += chunk })
      req.on('end', () => {
        received.push({ body, headers: req.headers })
        res.writeHead(answerWith).end('ok')
      })
    })

    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    receiverPort = (server.address() as AddressInfo).port

    // The delivery client verifies certificates, as it must in production.
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

    workerHandle = await createWebhookWorker()
  })

  afterAll(async () => {
    await workerHandle?.close()
    await closeWebhookQueue()
    await new Promise<void>(resolve => server.close(() => resolve()))
    delete process.env.REDIS_URL
    delete process.env.REDIS_KEY_PREFIX
    delete process.env.WEBHOOK_SIGNING_KEY
    delete process.env.WEBHOOK_BACKOFF_MS
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
  })

  beforeEach(async () => {
    received = []
    answerWith = 200

    owner = await createUser()
    await prisma.organization.update({
      where: { id: owner.organization.id },
      data: { planKey: 'team' }
    })

    const form = await createForm(owner.user.id, { status: 'published', title: 'Signup' })
    formId = form.id
    shareId = form.shareId
    fieldId = (await createField(formId, { name: 'email', label: 'Email' })).id

    const minted = mintWebhookSecret()
    secret = minted.secret
    await prisma.webhookEndpoint.create({
      data: {
        organizationId: owner.organization.id,
        // Loopback, written straight to the row: see the file comment.
        url: `https://127.0.0.1:${receiverPort}/hook`,
        secret: minted.stored,
        events: ['response.created']
      }
    })
  })

  afterEach(async () => {
    // Switched off first, so nothing new is queued while the queue is cleared,
    // and then cleared rather than drained: a test that leaves a failing
    // delivery behind would otherwise make the next one wait out its retries.
    await prisma.webhookEndpoint.updateMany({ data: { disabledAt: new Date() } })
    await clearWebhookQueue()
  })

  function submit() {
    return request(app)
      .post('/api/responses')
      .send({ formId, shareId, answers: { [fieldId]: 'ada@example.com' } })
  }

  /** Waits until the queue has nothing left to do. */
  async function drain(timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const status = await webhookQueueStatus()
      if (status && status.waiting + status.active + status.delayed === 0) return
      if (Date.now() > deadline) throw new Error(`Queue did not drain: ${JSON.stringify(status)}`)
      await new Promise(resolve => setTimeout(resolve, 50))
    }
  }

  async function waitFor(condition: () => boolean, timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs
    while (!condition()) {
      if (Date.now() > deadline) throw new Error('Timed out waiting')
      await new Promise(resolve => setTimeout(resolve, 50))
    }
  }

  it('delivers a signed response.created that the customer can verify', async () => {
    const submitted = await submit()
    expect(submitted.status).toBe(201)

    await waitFor(() => received.length > 0)
    const delivery = received[0]!

    // Verified exactly as a customer's server would: HMAC over
    // `<timestamp>.<raw body>`, from the bytes as they arrived.
    const header = String(delivery.headers['x-vuepdf-signature'])
    const timestamp = /t=(\d+)/.exec(header)?.[1]
    const signature = /v1=([0-9a-f]+)/.exec(header)?.[1]

    expect(timestamp).toBeTruthy()
    expect(signature).toBe(
      crypto.createHmac('sha256', secret).update(`${timestamp}.${delivery.body}`).digest('hex')
    )

    const payload = JSON.parse(delivery.body)
    expect(payload.type).toBe('response.created')
    expect(payload.data.form.id).toBe(formId)
    // Answers are keyed by field name, like the read API.
    expect(payload.data.response.answers.email).toBe('ada@example.com')

    // The event id is in the header too, and it is the deduplication key.
    expect(delivery.headers['x-vuepdf-event-id']).toBe(payload.id)

    await drain()
    const logged = await prisma.webhookDelivery.findFirstOrThrow({})
    expect(logged).toMatchObject({ succeeded: true, status: 200, attempt: 1 })
    // The log holds metadata and no payload: the body carries respondent
    // answers, and a second copy of those would outlive the form they came from.
    expect(Object.keys(logged)).not.toContain('body')
    expect(Object.keys(logged)).not.toContain('payload')
  })

  it('does not fail the submission when the customer endpoint is down', async () => {
    answerWith = 500

    const submitted = await submit()

    // The respondent is not the customer's integration's keeper. Their
    // submission succeeded and is saved.
    expect(submitted.status).toBe(201)
    expect(await prisma.response.count({ where: { formId } })).toBe(1)

    await waitFor(() => received.length >= 2, 40_000)

    // Retried, and every attempt recorded — the log is a log, not a list of
    // successes.
    const failures = await prisma.webhookDelivery.findMany({ orderBy: { createdAt: 'asc' } })
    expect(failures.length).toBeGreaterThanOrEqual(2)
    expect(failures[0]).toMatchObject({ succeeded: false, status: 500 })
    expect(failures[1]!.attempt).toBeGreaterThan(failures[0]!.attempt)
  })

  it('sends nothing for an organization with no endpoint, and nothing when disabled', async () => {
    await prisma.webhookEndpoint.updateMany({ data: { disabledAt: new Date() } })

    const submitted = await submit()
    expect(submitted.status).toBe(201)

    await drain()
    // A disabled endpoint is silent: nothing queued, nothing delivered, nothing
    // logged.
    expect(received).toHaveLength(0)
    expect(await prisma.webhookDelivery.count()).toBe(0)
  })

  it('exposes the delivery log to the organization, and to nobody else', async () => {
    await submit()
    await waitFor(() => received.length > 0)
    await drain()

    const { mintApiKey } = await import('../../src/services/api-key.js')
    const ownKey = (await mintApiKey({ organizationId: owner.organization.id, name: 'k' })).secret

    const mine = await request(app)
      .get('/api/v1/webhooks/deliveries')
      .set('Authorization', `Bearer ${ownKey}`)

    expect(mine.status).toBe(200)
    expect(mine.body.data.length).toBeGreaterThan(0)
    expect(mine.body.data[0]).toMatchObject({ eventType: 'response.created', succeeded: true })

    const stranger = await createUser()
    await prisma.organization.update({
      where: { id: stranger.organization.id },
      data: { planKey: 'team' }
    })
    const strangerKey = (await mintApiKey({
      organizationId: stranger.organization.id,
      name: 'k'
    })).secret

    const theirs = await request(app)
      .get('/api/v1/webhooks/deliveries')
      .set('Authorization', `Bearer ${strangerKey}`)

    expect(theirs.status).toBe(200)
    // Scoped through the endpoint's organization: another tenant sees an empty
    // list, not somebody else's delivery history.
    expect(theirs.body.data).toHaveLength(0)
  })
})

/**
 * A throwaway certificate for the receiver, generated per run.
 *
 * Per run rather than committed: a private key in a repository is a private key
 * in a repository, even a worthless one, and the next person to find it has to
 * work out that it is worthless.
 */
async function selfSigned(): Promise<{ key: string; cert: string }> {
  const selfsigned = await import('selfsigned')
  const pems = await selfsigned.default.generate(
    [{ name: 'commonName', value: '127.0.0.1' }],
    { days: 1 }
  )

  return { key: pems.private, cert: pems.cert }
}
