import type { Job, Queue, Worker } from 'bullmq'
import type { Redis } from 'ioredis'
import { envInt } from '../config/env.js'
import { embedFormFields, embedInline } from './pdf-embed.js'

/**
 * The one module that knows there is a job queue (features/0017).
 *
 * Same rule as `services/stripe.ts` for the Stripe SDK and
 * `services/pdf-storage.ts` for PDF bytes: **nothing else in this repository
 * imports `bullmq` or `ioredis`.** Routes ask for an embed and do not learn
 * where it runs; `src/worker.ts` asks for a worker and does not learn what a
 * job looks like.
 *
 * ## Redis is optional, and that is the whole shape of this feature
 *
 * `REDIS_URL` unset means there is no queue, no connection is attempted, and
 * the embed runs inline exactly as it did before - lock and all
 * (`pdf-embed.ts`, `embedInline`). The pattern is the one Stripe and the PDF
 * storage driver already established: optional infrastructure must not be a
 * boot requirement.
 *
 * It is not politeness. `npm run test:backend`, `test:integration` and
 * `test:e2e` all drive bulk save and therefore the embed; a mandatory queue
 * would put a Redis in front of every suite and take `npm test` away from
 * anyone without one (docs/sot/09-quality-and-testing.md). It also makes this
 * deployable in stages and makes the rollback an environment variable rather
 * than a revert.
 *
 * The cost is deliberate and must not be "simplified" away: **there are two
 * code paths for the same operation and both have to work.** The inline one is
 * what every suite exercises, so the queued one carries its own
 * `tests/integration/pdf-embed-queue.spec.ts`, run against a real Redis.
 */

const QUEUE_NAME = 'pdf-embed'

/**
 * Every key this feature writes lives under one prefix, so a Redis shared with
 * something else stays legible - and so a developer pointing `REDIS_URL` at a
 * Redis another project is already using cannot collide with it.
 *
 * Read per call rather than memoised into a constant, for the same reason the
 * rate limits and `DEV_PLAN_KEY` are: a constant is fixed at import, which is
 * before any test can set it, and `tests/integration/pdf-embed-queue.spec.ts`
 * uses this to keep its keys out of whatever else the developer's Redis holds.
 */
function keyPrefix(): string {
  return process.env.REDIS_KEY_PREFIX?.trim() || 'vuepdf'
}

export interface EmbedJobData {
  /**
   * The only thing in the payload, and deliberately so.
   *
   * A payload carrying the field list is a payload that was stale before the
   * worker picked it up: the job may run seconds after the save that queued it,
   * and after two more saves have landed. `embedFormFields` re-reads everything
   * from this id when it runs (features/0016, trap 2).
   */
  formId: string
}

function redisUrl(): string | undefined {
  return process.env.REDIS_URL?.trim() || undefined
}

/** Whether this process has a queue behind it at all. */
export function isEmbedQueueEnabled(): boolean {
  return redisUrl() !== undefined
}

/**
 * `bullmq` and `ioredis` are imported **only** once a queue is actually wanted.
 *
 * Same reasoning as the lazy S3 client and the lazy Stripe client: a deployment
 * without Redis - which includes every test run - should not pay for, or fail
 * on, a dependency it never uses.
 */
async function connect(): Promise<Redis> {
  const url = redisUrl()
  if (!url) throw new Error('REDIS_URL is not set')

  const { default: IORedis } = await import('ioredis')

  // `maxRetriesPerRequest: null` is required by BullMQ: its blocking commands
  // sit on a connection for minutes at a time, and ioredis' default would kill
  // them as failed requests.
  return new IORedis(url, { maxRetriesPerRequest: null })
}

let queuePromise: Promise<{ queue: Queue<EmbedJobData>; connection: Redis }> | null = null

async function embedQueue() {
  if (!queuePromise) {
    queuePromise = (async () => {
      const connection = await connect()
      const { Queue } = await import('bullmq')
      return {
        queue: new Queue<EmbedJobData>(QUEUE_NAME, { connection, prefix: keyPrefix() }),
        connection
      }
    })().catch(error => {
      // A failed construction must not be memoised, or one bad moment at boot
      // turns into a process that can never enqueue again.
      queuePromise = null
      throw error
    })
  }

  return queuePromise
}

/**
 * How an embed is asked for. The only entry point routes use.
 *
 * With a queue: the job is added and the request returns. Without one: the
 * embed runs inline, awaited, exactly as before. Either way the caller learns
 * nothing and the response is unchanged - the embed has always been
 * best-effort and nothing in the response depends on it.
 *
 * **A Redis that is configured but unreachable falls back to inline** rather
 * than dropping the embed. It is the less-correct path (an in-process lock does
 * not span replicas) but it is the one that still updates the document, and a
 * silently skipped embed is exactly the failure this feature exists to stop.
 */
export async function requestEmbed(formId: string): Promise<void> {
  if (isEmbedQueueEnabled()) {
    try {
      const { queue } = await embedQueue()

      // **No fixed job id, and that is not an oversight** - see `withFormLock`
      // below for the reasoning, and for what serialises these instead.
      await queue.add('embed', { formId }, {
        attempts: envInt('EMBED_JOB_ATTEMPTS', 5),
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 100,
        // Failures are kept far longer than successes: a job that exhausted its
        // retries is a form whose PDF is behind its database, and it should
        // still be inspectable when somebody comes looking.
        removeOnFail: 1000
      })
      return
    } catch (error) {
      console.error(
        `Could not enqueue PDF embed for form ${formId}; running it inline instead:`,
        error
      )
    }
  }

  await embedInline(formId)
}

/**
 * How much work is outstanding, or `null` when there is no queue.
 *
 * The number an operator wants: a backlog that only grows is what a dead worker
 * looks like from the API's side, since nothing else about it fails
 * (docs/sot/08-operations.md). Also what the queued-path spec waits on, so it
 * asserts against a drained queue rather than against a timer.
 */
export async function embedQueueStatus(): Promise<{
  waiting: number
  active: number
  delayed: number
  failed: number
} | null> {
  if (!isEmbedQueueEnabled()) return null

  const { queue } = await embedQueue()
  const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed')

  return {
    waiting: counts.waiting ?? 0,
    active: counts.active ?? 0,
    delayed: counts.delayed ?? 0,
    failed: counts.failed ?? 0
  }
}

/* -------------------------------- the worker ------------------------------- */

const LOCK_TTL_MS = 60_000
const LOCK_POLL_MS = 100
const LOCK_WAIT_MS = 120_000

/** Releases the lock only if we still hold it - never somebody else's. */
const RELEASE = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  else
    return 0
  end
`

/** Extends the lock only if we still hold it. */
const RENEW = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("pexpire", KEYS[1], ARGV[2])
  else
    return 0
  end
`

/**
 * At most one embed per form in flight, across every worker process.
 *
 * ## Why not BullMQ's job-id deduplication
 *
 * The obvious implementation is a stable job id per form, so a second save
 * collapses into the first. It is wrong here, and wrong in a way that is hard to
 * see: BullMQ ignores an `add` whose id belongs to a job that is **already
 * running**. A save made during an in-flight embed would therefore be silently
 * discarded, its fields would never reach the PDF, and the document would be
 * permanently behind the database - the same lost-update bug features/0016
 * closed, arrived at from the other direction and with no error anywhere.
 *
 * So every save gets its own job, and the *serialisation* is this lock. Extra
 * jobs are harmless: the embed is idempotent, it re-reads the fields when it
 * runs, and two jobs queued for one form simply mean the second one rewrites the
 * same document from the same truth. Correctness first; the wasted work is a
 * rewrite of one small PDF.
 *
 * ## Why a Redis lock rather than the in-process one
 *
 * `services/organization-lock.ts` serialises one Node process. Workers are a
 * fleet - that is the point of moving this off the request path - so the lock
 * has to live where all of them can see it. It is a `SET NX PX` with a random
 * token, released by a compare-and-delete script so a slow holder can never
 * delete the lock of whoever took it next, and renewed while the work runs so a
 * genuinely slow embed does not lose the lock it is still using.
 *
 * A waiter polls rather than failing: a busy form is the normal case this exists
 * for, and turning it into a job failure would burn the retry budget that
 * belongs to real errors. It gives up after `LOCK_WAIT_MS` - far longer than any
 * embed of a document this application accepts (10 MB, `middleware/upload.ts`) -
 * and *then* fails, so a lock leaked by a hard-killed worker surfaces as a
 * retried job rather than a wedged queue.
 */
async function withFormLock<T>(
  connection: Redis,
  formId: string,
  work: () => Promise<T>
): Promise<T> {
  const key = `${keyPrefix()}:embed-lock:${formId}`
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const deadline = Date.now() + LOCK_WAIT_MS

  while ((await connection.set(key, token, 'PX', LOCK_TTL_MS, 'NX')) !== 'OK') {
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out waiting to embed form ${formId}: another embed holds the lock`
      )
    }
    await new Promise(resolve => setTimeout(resolve, LOCK_POLL_MS))
  }

  const renewal = setInterval(() => {
    connection.eval(RENEW, 1, key, token, String(LOCK_TTL_MS)).catch(error => {
      console.error(`Could not renew embed lock for form ${formId}:`, error)
    })
  }, Math.floor(LOCK_TTL_MS / 3))
  // Never let the renewal alone keep the process alive.
  renewal.unref?.()

  try {
    return await work()
  } finally {
    clearInterval(renewal)
    await connection.eval(RELEASE, 1, key, token).catch(error => {
      // The lock expires by itself, so a failed release costs a delay, not
      // correctness.
      console.error(`Could not release embed lock for form ${formId}:`, error)
    })
  }
}

export interface EmbedWorkerHandle {
  worker: Worker<EmbedJobData>
  /** Finishes the jobs in flight, then closes every connection. */
  close: () => Promise<void>
}

/**
 * Builds the worker. Called by `src/worker.ts` and by nothing else.
 */
export async function createEmbedWorker(): Promise<EmbedWorkerHandle> {
  const connection = await connect()
  // A second connection for the lock: the worker's own is occupied by blocking
  // commands, and a `SET`/`EVAL` would queue behind them.
  const locks = await connect()
  const { Worker } = await import('bullmq')

  const worker = new Worker<EmbedJobData>(
    QUEUE_NAME,
    async (job: Job<EmbedJobData>) => {
      const { formId } = job.data
      if (!formId) throw new Error(`Embed job ${job.id} has no formId`)

      await withFormLock(locks, formId, () => embedFormFields(formId))
    },
    {
      connection,
      prefix: keyPrefix(),
      concurrency: envInt('EMBED_WORKER_CONCURRENCY', 5)
    }
  )

  worker.on('completed', job => {
    console.log(`embed job ${job.id} done (form ${job.data.formId})`)
  })

  // The distinction goal 12 asks for. A job that will be retried is noise; a job
  // that has given up is a form whose stored PDF is permanently behind its
  // database, and it is the line an operator greps for
  // (docs/sot/08-operations.md).
  worker.on('failed', (job, error) => {
    if (!job) {
      console.error('embed job failed before it could be read:', error)
      return
    }

    const attempts = job.opts.attempts ?? 1
    if (job.attemptsMade >= attempts) {
      console.error(
        `EMBED GAVE UP after ${job.attemptsMade} attempts: form ${job.data?.formId} ` +
        `(job ${job.id}). Its stored PDF no longer matches its fields.`,
        error
      )
    } else {
      console.warn(
        `embed job ${job.id} failed (attempt ${job.attemptsMade}/${attempts}), ` +
        `will retry: form ${job.data?.formId}`,
        error
      )
    }
  })

  // Connection-level trouble. Without a listener an EventEmitter `error` throws,
  // which is the shape of failure that takes a process down.
  worker.on('error', error => {
    console.error('embed worker error:', error)
  })

  return {
    worker,
    close: async () => {
      // `close()` waits for the jobs currently running to finish (goal 11).
      await worker.close()
      await Promise.all(
        [connection.quit(), locks.quit()].map(p => p.catch(() => undefined))
      )
    }
  }
}

/**
 * Shuts the producer side down. For the API's own exit, and for tests, which
 * would otherwise leave an open connection holding the run open.
 */
export async function closeEmbedQueue(): Promise<void> {
  const pending = queuePromise
  queuePromise = null
  if (!pending) return

  try {
    const { queue, connection } = await pending
    await queue.close()
    await connection.quit().catch(() => undefined)
  } catch {
    // Nothing to close if it never connected.
  }
}
