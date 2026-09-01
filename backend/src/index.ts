import dotenv from 'dotenv'
import { app } from './app.js'
import { installProcessGuards } from './process-guards.js'
import { logger } from './services/logger.js'
import { closeEmbedQueue, isEmbedQueueEnabled } from './services/embed-queue.js'

dotenv.config()

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
