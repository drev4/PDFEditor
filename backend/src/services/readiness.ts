import { prisma } from './db.js'
import { embedQueueReadiness, type EmbedQueueReadiness } from './embed-queue.js'
import { logger } from './logger.js'

export type DependencyStatus = { status: 'ok' | 'unavailable' }

/** A real query, so a connected process with an unavailable database is not ready. */
export async function checkDatabaseReadiness(): Promise<DependencyStatus> {
  try {
    await prisma.$queryRaw`SELECT 1`
    return { status: 'ok' }
  } catch (error) {
    logger.error({ err: error }, '[readiness] database check failed')
    return { status: 'unavailable' }
  }
}

/**
 * Redis is optional. Once configured it is no longer optional for readiness:
 * the API queues embeds successfully even when no worker exists to consume
 * them, so accepting traffic in that state would silently leave PDFs stale.
 */
export async function checkQueueReadiness(): Promise<EmbedQueueReadiness> {
  try {
    return await embedQueueReadiness()
  } catch (error) {
    logger.error({ err: error }, '[readiness] queue check failed')
    return { status: 'unavailable' }
  }
}

