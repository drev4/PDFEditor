import type { Job, Queue, Worker } from 'bullmq'
import { envInt } from '../config/env.js'
import { connectRedis, isRedisConfigured, keyPrefix, type Redis } from './redis.js'
import { embedFormFields, embedInline } from './pdf-embed.js'
import { logger } from './logger.js'

/**
 * The one module that knows there is a job queue (features/0017).
 *
 * Same rule as `services/stripe.ts` for the Stripe SDK and
 * `services/pdf-storage.ts` for PDF bytes: **nothing else in this repository
 * imports `bullmq`.** Routes ask for an embed and do not learn where it runs;
 * `src/worker.ts` asks for a worker and does not learn what a job looks like.
 *
 * The connections themselves are not this module's business either: they come
 * from `services/redis.ts`, which owns the per-role options and the reason each
 * role differs (features/0018).
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

/** Whether this process has a queue behind it at all. */
export function isEmbedQueueEnabled(): boolean {
  return isRedisConfigured()
}

let queuePromise: Promise<{ queue: Queue<EmbedJobData>; connection: Redis }> | null = null

async function embedQueue() {
  if (!queuePromise) {
    queuePromise = (async () => {
      const connection = await connectRedis('producer')
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
 *
 * Two things make that guarantee real rather than stated, and both exist because
 * the first version of this function had only the `try`/`catch` and would hang
 * for ever on a Redis that neither answered nor refused: the per-role connection
 * options in `services/redis.ts`, and the wall-clock deadline in `withDeadline`
 * below. The
 * test that holds them honest is
 * `tests/integration/pdf-embed-fallback.spec.ts`, which points `REDIS_URL` at
 * an address that black-holes and asserts the save still answers and the PDF is
 * still embedded.
 */
export async function requestEmbed(formId: string): Promise<void> {
  if (isEmbedQueueEnabled()) {
    try {
      await withDeadline(async () => {
        const { queue } = await embedQueue()

        // **No fixed job id, and that is not an oversight** - see `withFormLock`
        // below for the reasoning, and for what serialises these instead.
        await queue.add('embed', { formId }, {
          attempts: envInt('EMBED_JOB_ATTEMPTS', 5),
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: 100,
          // Failures are kept far longer than successes: a job that exhausted
          // its retries is a form whose PDF is behind its database, and it
          // should still be inspectable when somebody comes looking.
          removeOnFail: 1000
        })
      })
      return
    } catch (error) {
      logger.error(
        { err: error, formId },
        `Could not enqueue PDF embed for form ${formId}; running it inline instead`
      )
      // The client this failed on may be wedged rather than merely unlucky, so
      // it is thrown away: the next save reconnects instead of inheriting it.
      dropQueue()
    }
  }

  await embedInline(formId)
}

/** How long the request path will wait on Redis before giving up on it. */
const ENQUEUE_TIMEOUT_MS = 5_000

/**
 * Bounds the enqueue in wall-clock time, on top of the bounded connection
 * options in `connect`.
 *
 * Belt and braces on purpose. The connection options are the fix; this is the
 * guarantee. "The request path never waits more than five seconds on Redis" is
 * a property of this function alone, and it stays true if a future version of
 * ioredis or BullMQ changes when a command settles - which is exactly the sort
 * of assumption that produced the hang this replaces.
 *
 * Losing the race does not lose the embed: the caller falls back to running it
 * inline. It can duplicate one - a slow `add` may still land after the deadline
 * - and that is the deliberate trade, because a duplicate embed is idempotent
 * and a skipped one is a document permanently behind its database.
 */
async function withDeadline<T>(work: () => Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined

  try {
    return await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Redis did not answer within ${ENQUEUE_TIMEOUT_MS}ms`)),
          ENQUEUE_TIMEOUT_MS
        )
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Forgets the memoised queue, closing it in the background.
 *
 * Called when an enqueue fails, because the most likely reason is a client that
 * will not recover on its own. Closing is best-effort and deliberately not
 * awaited: the caller is a request that still has an embed to run.
 */
function dropQueue(): void {
  const pending = queuePromise
  queuePromise = null
  if (!pending) return

  void pending
    .then(async ({ queue, connection }) => {
      await queue.close().catch(() => undefined)
      await connection.quit().catch(() => connection.disconnect())
    })
    .catch(() => undefined)
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

export type EmbedQueueReadiness =
  | { status: 'disabled' }
  | { status: 'unavailable' }
  | {
      status: 'ok' | 'no_workers'
      workers: number
      waiting: number
      active: number
      delayed: number
      failed: number
    }

/**
 * A deployment-facing view of the queue. Counts alone cannot distinguish an
 * idle queue from one with no consumer, so readiness also asks BullMQ how many
 * workers are registered. The existing enqueue deadline bounds this request;
 * a broken Redis must not leave the platform's probe hanging forever.
 */
export async function embedQueueReadiness(): Promise<EmbedQueueReadiness> {
  if (!isEmbedQueueEnabled()) return { status: 'disabled' }

  return withDeadline(async () => {
    const { queue } = await embedQueue()
    const [counts, workers] = await Promise.all([
      queue.getJobCounts('waiting', 'active', 'delayed', 'failed'),
      queue.getWorkersCount()
    ])

    return {
      status: workers > 0 ? 'ok' : 'no_workers',
      workers,
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      delayed: counts.delayed ?? 0,
      failed: counts.failed ?? 0
    }
  })
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
      logger.error({ err: error }, `Could not renew embed lock for form ${formId}`)
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
      logger.error({ err: error }, `Could not release embed lock for form ${formId}`)
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
  const connection = await connectRedis('worker')
  // A second connection for the lock: the worker's own is occupied by blocking
  // commands, and a `SET`/`EVAL` would queue behind them.
  const locks = await connectRedis('locks')
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
    logger.info(`embed job ${job.id} done (form ${job.data.formId})`)
  })

  // The distinction goal 12 asks for. A job that will be retried is noise; a job
  // that has given up is a form whose stored PDF is permanently behind its
  // database, and it is the line an operator greps for
  // (docs/sot/08-operations.md).
  worker.on('failed', (job, error) => {
    if (!job) {
      logger.error({ err: error }, 'embed job failed before it could be read')
      return
    }

    const attempts = job.opts.attempts ?? 1
    if (job.attemptsMade >= attempts) {
      logger.error(
        { err: error, formId: job.data?.formId, jobId: job.id, attempts: job.attemptsMade },
        `EMBED GAVE UP after ${job.attemptsMade} attempts: form ${job.data?.formId} ` +
        `(job ${job.id}). Its stored PDF no longer matches its fields.`
      )
    } else {
      logger.warn(
        { err: error, formId: job.data?.formId, jobId: job.id, attempt: job.attemptsMade },
        `embed job ${job.id} failed (attempt ${job.attemptsMade}/${attempts}), ` +
        `will retry: form ${job.data?.formId}`
      )
    }
  })

  // Connection-level trouble. Without a listener an EventEmitter `error` throws,
  // which is the shape of failure that takes a process down.
  worker.on('error', error => {
    logger.error({ err: error }, 'embed worker error')
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
