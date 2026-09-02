import { Router } from 'express'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { checkDatabaseReadiness, checkQueueReadiness } from '../services/readiness.js'

export const healthRouter = Router()

function livePayload() {
  return { status: 'ok', timestamp: new Date().toISOString() }
}

/**
 * Public by design: these are bounded, input-free machine probes for the
 * process manager. They expose states and queue counts, never exception text,
 * connection strings or customer identifiers.
 */
healthRouter.get('/', (_req, res) => res.json(livePayload()))
healthRouter.get('/live', (_req, res) => res.json(livePayload()))

healthRouter.get('/ready', asyncHandler(async (_req, res) => {
  const [database, queue] = await Promise.all([
    checkDatabaseReadiness(),
    checkQueueReadiness()
  ])

  const ready = database.status === 'ok' &&
    (queue.status === 'disabled' || queue.status === 'ok')

  return res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'not_ready',
    timestamp: new Date().toISOString(),
    checks: { database, queue }
  })
}))

