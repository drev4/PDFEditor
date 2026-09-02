import dotenv from 'dotenv'
import { assertEnv } from './config/validate-env.js'
import { installProcessGuards } from './process-guards.js'
import { initErrorTracking } from './services/error-tracking.js'
import { logger } from './services/logger.js'
import { closeEmbedQueue, isEmbedQueueEnabled } from './services/embed-queue.js'

dotenv.config()

/**
 * Before anything else, and before `app.js` is imported (features/0028).
 *
 * The import of `./app.js` is deferred below rather than sitting at the top of
 * this file, and that ordering is the point: `app.ts` builds routers, reads
 * `TRUST_PROXY_HOPS` and throws on a missing `JWT_SECRET` at module scope, so a
 * static import would run all of it before this line and report one problem
 * where there may be five.
 */
assertEnv('api')

const { app } = await import('./app.js')

// Before the guards, so the handlers they install have somewhere to report
// (features/0034). A no-op unless SENTRY_DSN is set and NODE_ENV is neither
// development nor test.
initErrorTracking('api')

installProcessGuards('api')

const PORT = process.env.PORT || 3000

const server = app.listen(PORT, () => {
  logger.info({ port: PORT }, `Server running on http://localhost:${PORT}`)
  logger.info(
    { queued: isEmbedQueueEnabled() },
    isEmbedQueueEnabled()
      ? 'PDF embedding is QUEUED (REDIS_URL is set) - a worker must be running'
      : 'PDF embedding runs INLINE (REDIS_URL is unset)'
  )
})

/**
 * The producer side of the queue holds an open Redis connection, so a `SIGTERM`
 * that only stops the HTTP server leaves the process alive until something
 * kills it harder. Close both.
 */
async function shutdown(signal: string) {
  logger.info({ signal }, `[api] ${signal} received, shutting down`)
  server.close()
  await closeEmbedQueue()
}

process.on('SIGTERM', () => { void shutdown('SIGTERM') })
process.on('SIGINT', () => { void shutdown('SIGINT') })
