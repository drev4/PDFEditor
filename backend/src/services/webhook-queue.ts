import crypto from 'crypto'
import type { Job, Queue, Worker } from 'bullmq'
import { envInt } from '../config/env.js'
import { prisma } from './db.js'
import { connectRedis, isRedisConfigured, keyPrefix, type Redis } from './redis.js'
import { assertDeliverableUrl, deliver } from './webhook-egress.js'
import { decryptSecret, isWebhookSigningConfigured, signPayload } from './webhooks.js'
import { assertHasApiAccess } from './entitlements.js'

/**
 * The second job type on the queue features/0017 brought (features/0020).
 *
 * It lives beside `services/embed-queue.ts` rather than inside it because the
 * two share Redis and nothing else: different payloads, different failure
 * modes, different reasons to exist. What they do share is
 * `services/redis.ts`, which owns connections and their per-role options.
 *
 * ## The queue is not optional here, and that is the point
 *
 * The embed falls back to running inline when `REDIS_URL` is unset, and copying
 * that here would be wrong twice over. The event source is
 * `POST /api/responses` — an anonymous respondent submitting a form — so an
 * inline delivery would put a third party's server on the critical path of
 * somebody pressing "submit": a customer whose endpoint takes thirty seconds
 * would make *their own respondents* wait thirty seconds. And retries, which
 * are the entire point of a webhook, cannot exist inside a request handler.
 *
 * So a deployment without the queue cannot have webhooks, and
 * `routes/organizations.ts` refuses to configure one with a `503` that says so.
 * The inverse of features/0017's known hole, where a queue with no worker
 * accepts everything and silently delivers nothing.
 */

const QUEUE_NAME = 'webhook-delivery'

export interface WebhookJobData {
  endpointId: string
  /** Stable across every retry: it is what the customer deduplicates on. */
  eventId: string
  eventType: string
  /**
   * Enough to re-read the event, not the event itself.
   *
   * Same reasoning as the embed job's `formId` (features/0016, trap 2): a
   * payload carried in the job is a payload that was true when it was queued.
   * Here it also keeps respondent answers out of Redis, where they would sit in
   * a datastore nobody has counted as holding personal data.
   */
  responseId: string
}

export function isWebhookQueueEnabled(): boolean {
  return isRedisConfigured() && isWebhookSigningConfigured()
}

let queuePromise: Promise<{ queue: Queue<WebhookJobData>; connection: Redis }> | null = null

async function webhookQueue() {
  if (!queuePromise) {
    queuePromise = (async () => {
      const connection = await connectRedis('producer')
      const { Queue } = await import('bullmq')
      return {
        queue: new Queue<WebhookJobData>(QUEUE_NAME, { connection, prefix: keyPrefix() }),
        connection
      }
    })().catch(error => {
      queuePromise = null
      throw error
    })
  }

  return queuePromise
}

/**
 * Queues `response.created` for every endpoint that wants it.
 *
 * Called **after** the submission transaction commits, and it must never be
 * able to fail the submission: the response is already saved, which is the
 * record that matters, and a respondent must not see an error because a
 * customer's integration is misconfigured
 * (docs/sot/04-backend-patterns.md §5). Every failure here is swallowed and
 * logged, exactly like the PDF embed.
 */
export async function queueResponseCreated(input: {
  organizationId: string
  formId: string
  responseId: string
}): Promise<void> {
  if (!isWebhookQueueEnabled()) return

  try {
    const endpoints = await prisma.webhookEndpoint.findMany({
      where: {
        organizationId: input.organizationId,
        disabledAt: null,
        events: { has: 'response.created' }
      },
      select: { id: true }
    })

    if (endpoints.length === 0) return

    const { queue } = await webhookQueue()

    // One event id per event, **shared by every endpoint and every retry**: a
    // customer with two endpoints sees the same id twice, which is correct - it
    // is the same event - and a customer deduplicating on it gets the behaviour
    // the documentation promises.
    const eventId = crypto.randomUUID()

    await Promise.all(
      endpoints.map(endpoint =>
        queue.add(
          'deliver',
          {
            endpointId: endpoint.id,
            eventId,
            eventType: 'response.created',
            responseId: input.responseId
          },
          {
            attempts: envInt('WEBHOOK_JOB_ATTEMPTS', 5),
            // Tens of seconds, doubling: a customer's endpoint is usually down
            // because somebody is deploying it, and hammering it does not help.
            // Configurable because a test cannot wait out a real backoff, and
            // because a deployment may know its customers better than this
            // default does.
            backoff: { type: 'exponential', delay: envInt('WEBHOOK_BACKOFF_MS', 10_000) },
            removeOnComplete: 1000,
            removeOnFail: 1000
          }
        )
      )
    )
  } catch (error) {
    console.error(`Could not queue response.created for form ${input.formId}:`, error)
  }
}

/** The body a customer receives. Built explicitly, like every `/api/v1` body. */
async function renderEvent(responseId: string) {
  const response = await prisma.response.findUnique({
    where: { id: responseId },
    include: {
      answers: true,
      form: { include: { fields: { orderBy: { order: 'asc' } } } }
    }
  })

  if (!response) return null

  const fieldNames = new Map(response.form.fields.map(field => [field.id, field.name]))
  const answers: Record<string, string> = {}
  for (const answer of response.answers) {
    const name = fieldNames.get(answer.fieldId)
    if (name) answers[name] = answer.value
  }

  return {
    form: { id: response.form.id, title: response.form.title, shareId: response.form.shareId },
    response: { id: response.id, submittedAt: response.submittedAt, answers }
  }
}

/** After this many consecutive failures the endpoint is switched off. */
const DISABLE_AFTER = 10

async function processDelivery(job: Job<WebhookJobData>): Promise<void> {
  const { endpointId, eventId, eventType, responseId } = job.data

  const endpoint = await prisma.webhookEndpoint.findUnique({ where: { id: endpointId } })

  // Deleted or switched off between queueing and running. Not an error: the
  // customer asked for this to stop.
  if (!endpoint || endpoint.disabledAt) return

  // The entitlement, re-checked on every delivery rather than only when the
  // endpoint was configured — otherwise one month of Team buys a subscription
  // to respondent data for ever. Same fix features/0019 needed after review.
  //
  // Through `assertHasApiAccess` rather than by reading the plan directly, so
  // there is still exactly one place that answers "may this organization use
  // the API?" (features/0012). A downgrade **disables** the endpoint rather
  // than retrying it: the failure is not transient, and retrying for days would
  // fill the queue with jobs that cannot succeed.
  try {
    await assertHasApiAccess(endpoint.organizationId)
  } catch (error) {
    await disable(endpointId, error instanceof Error ? error.message : 'Plan does not include webhooks')
    return
  }

  const payload = await renderEvent(responseId)

  // The response was deleted before this ran - by the customer, or with its
  // form. There is nothing to send and nothing to retry.
  if (!payload) return

  // Re-validated every time, not trusted from configuration: a hostname that
  // was public when it was saved can point at 10.0.0.5 today, and this is the
  // only defence against that.
  let target
  try {
    target = await assertDeliverableUrl(endpoint.url)
  } catch (error) {
    await record({
      endpointId,
      eventId,
      eventType,
      attempt: job.attemptsMade + 1,
      status: null,
      durationMs: 0,
      succeeded: false,
      error: error instanceof Error ? error.message : 'Endpoint URL is not deliverable'
    })
    await disable(endpointId, 'The endpoint URL is no longer deliverable')
    return
  }

  const signed = signPayload({
    secret: decryptSecret(endpoint.secret),
    eventId,
    eventType,
    payload: { id: eventId, type: eventType, createdAt: new Date().toISOString(), data: payload }
  })

  const result = await deliver({ target, body: signed.body, headers: signed.headers })

  await record({
    endpointId,
    eventId,
    eventType,
    attempt: job.attemptsMade + 1,
    status: result.status,
    durationMs: result.durationMs,
    succeeded: result.ok,
    error: result.error
  })

  if (result.ok) {
    if (endpoint.consecutiveFailures > 0) {
      await prisma.webhookEndpoint.update({
        where: { id: endpointId },
        data: { consecutiveFailures: 0, lastError: null }
      })
    }
    return
  }

  const failures = endpoint.consecutiveFailures + 1
  await prisma.webhookEndpoint.update({
    where: { id: endpointId },
    data: {
      consecutiveFailures: failures,
      lastError: result.error,
      // An endpoint whose owner deleted it is otherwise a queue slowly filling
      // with doomed jobs. **Nothing tells the customer this happened** - there
      // is no email service in this product - so `disabledAt` and `lastError`
      // are returned by the management API, and that is the only way they find
      // out. Filed in docs/BACKLOG.md.
      ...(failures >= DISABLE_AFTER ? { disabledAt: new Date() } : {})
    }
  })

  // Thrown so BullMQ retries it. The delivery is already recorded either way,
  // which is what makes the log a log rather than a summary of successes.
  throw new Error(result.error ?? 'Delivery failed')
}

async function disable(endpointId: string, reason: string): Promise<void> {
  await prisma.webhookEndpoint.update({
    where: { id: endpointId },
    data: { disabledAt: new Date(), lastError: reason }
  })
}

async function record(delivery: {
  endpointId: string
  eventId: string
  eventType: string
  attempt: number
  status: number | null
  durationMs: number | null
  succeeded: boolean
  error: string | null
}): Promise<void> {
  try {
    await prisma.webhookDelivery.create({ data: delivery })
  } catch (error) {
    // The log is evidence, not control flow: failing to write it must not turn
    // a delivered webhook into a retried one.
    console.error('Could not record webhook delivery:', error)
  }
}

export interface WebhookWorkerHandle {
  worker: Worker<WebhookJobData>
  close: () => Promise<void>
}

/** Built by `src/worker.ts`, beside the embed worker, on the same Redis. */
export async function createWebhookWorker(): Promise<WebhookWorkerHandle> {
  const connection = await connectRedis('worker')
  const { Worker } = await import('bullmq')

  const worker = new Worker<WebhookJobData>(QUEUE_NAME, processDelivery, {
    connection,
    prefix: keyPrefix(),
    // Lower than the embed's: every job here is a request to somebody else's
    // server, held for up to ten seconds, and a burst of submissions must not
    // turn into a burst of sockets.
    concurrency: envInt('WEBHOOK_WORKER_CONCURRENCY', 3)
  })

  worker.on('failed', (job, error) => {
    if (!job) {
      console.error('webhook delivery failed before it could be read:', error)
      return
    }

    const attempts = job.opts.attempts ?? 1
    if (job.attemptsMade >= attempts) {
      // The line an operator greps for, distinct from a failure that will be
      // retried — the same distinction the embed queue draws.
      console.error(
        `WEBHOOK GAVE UP after ${job.attemptsMade} attempts: endpoint ${job.data?.endpointId}, ` +
        `event ${job.data?.eventId}. The customer was not told about this event.`,
        error
      )
    } else {
      console.warn(
        `webhook delivery ${job.id} failed (attempt ${job.attemptsMade}/${attempts}), will retry`,
        error
      )
    }
  })

  worker.on('error', error => {
    console.error('webhook worker error:', error)
  })

  return {
    worker,
    close: async () => {
      await worker.close()
      await connection.quit().catch(() => undefined)
    }
  }
}

/**
 * Removes every job, delivered or not. **Tests only.**
 *
 * The retry backoff is measured in tens of seconds, so a spec that leaves a
 * failed delivery behind would otherwise hold the next one up for minutes -
 * and jobs from one test arriving during another is how a suite starts lying.
 * Named for what it does rather than dressed up as an operator tool: nothing in
 * production should ever throw away undelivered events.
 */
export async function clearWebhookQueue(): Promise<void> {
  if (!isWebhookQueueEnabled()) return

  const { queue } = await webhookQueue()
  await queue.obliterate({ force: true })
}

export async function closeWebhookQueue(): Promise<void> {
  const pending = queuePromise
  queuePromise = null
  if (!pending) return

  try {
    const { queue, connection } = await pending
    await queue.close()
    await connection.quit().catch(() => undefined)
  } catch {
    // It never connected.
  }
}

/** Outstanding work, or `null` when there is no queue. For operators and tests. */
export async function webhookQueueStatus(): Promise<{
  waiting: number
  active: number
  delayed: number
  failed: number
} | null> {
  if (!isWebhookQueueEnabled()) return null

  const { queue } = await webhookQueue()
  const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed')

  return {
    waiting: counts.waiting ?? 0,
    active: counts.active ?? 0,
    delayed: counts.delayed ?? 0,
    failed: counts.failed ?? 0
  }
}
