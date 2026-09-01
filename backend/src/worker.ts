import dotenv from 'dotenv'
import { installProcessGuards } from './process-guards.js'
import { createEmbedWorker, isEmbedQueueEnabled } from './services/embed-queue.js'
import { createWebhookWorker, isWebhookQueueEnabled } from './services/webhook-queue.js'
import { prisma } from './services/db.js'

dotenv.config()

/**
 * The queue worker: the same image as the API with a different entrypoint
 * (features/0017, goal 8).
 *
 * It imports `services/embed-queue.ts`, which imports `services/pdf-embed.ts`,
 * which imports the PDF processor, the storage driver and Prisma - the same
 * modules the API uses, not copies of them. A separate service with its own
 * idea of what a PDF is would drift from the API's within one release.
 *
 * Run it with `npm run worker` (or `npm run worker:dev` while developing). It
 * is needed **only** when `REDIS_URL` is set; without one the API embeds inline
 * and there is nothing for a worker to do, which is why this exits immediately
 * and loudly rather than idling and looking healthy.
 */
installProcessGuards('worker')

async function main() {
  if (!isEmbedQueueEnabled()) {
    console.error(
      '[worker] REDIS_URL is not set. Without it the API embeds PDFs inline and ' +
      'this worker would have nothing to do; refusing to start rather than idle ' +
      'and look healthy.'
    )
    process.exit(1)
  }

  const embed = await createEmbedWorker()

  // The second job type (features/0020), in the same process. It is skipped
  // when `WEBHOOK_SIGNING_KEY` is missing rather than started uselessly - a
  // worker that cannot decrypt an endpoint's secret cannot deliver anything,
  // and saying so at startup is better than one failed job per event.
  const webhooks = isWebhookQueueEnabled() ? await createWebhookWorker() : null
  if (!webhooks) {
    console.warn(
      '[worker] webhook delivery is OFF: WEBHOOK_SIGNING_KEY is not set. ' +
      'PDF embedding still runs.'
    )
  }

  const close = async () => {
    await Promise.all([embed.close(), webhooks?.close()].filter(Boolean) as Promise<void>[])
  }

  // Startup and shutdown are logged distinctly on purpose (goal 10). A worker
  // dying is otherwise invisible - no request fails, nothing 500s - so the two
  // lines an operator greps for are these, and `docs/sot/08-operations.md` says
  // what to do when the second one is missing.
  console.log(
    webhooks
      ? '[worker] started, waiting for jobs (pdf-embed + webhook-delivery)'
      : '[worker] started, waiting for jobs (pdf-embed only)'
  )

  let closing = false
  const shutdown = async (signal: string) => {
    if (closing) return
    closing = true

    // `close()` lets the jobs already running finish (goal 11): a deploy in the
    // middle of an embed must not abandon a half-rewritten document.
    console.log(`[worker] ${signal} received, finishing jobs in flight`)
    await close()
    await prisma.$disconnect()
    console.log('[worker] stopped')

    // **No `process.exit(0)` here**, and that is not tidiness. When stdout is a
    // file or a pipe - which is what it is under any process manager - Node
    // buffers it and `process.exit` discards whatever has not been flushed. The
    // logs lost that way are the only evidence a worker ever ran, and this
    // feature's whole story about a dead worker being visible depends on them
    // (docs/sot/08-operations.md). Every handle is closed above, so the process
    // ends on its own.
    //
    // The timer is the safety net for a handle that does not close. It is
    // `unref`d, so it cannot itself keep the process alive - it only fires if
    // something else already did.
    setTimeout(() => {
      console.error('[worker] still alive 10s after shutdown; forcing exit')
      process.exit(1)
    }, 10_000).unref()
  }

  process.on('SIGTERM', () => { void shutdown('SIGTERM') })
  process.on('SIGINT', () => { void shutdown('SIGINT') })
}

main().catch(error => {
  console.error('[worker] failed to start:', error)
  process.exit(1)
})
