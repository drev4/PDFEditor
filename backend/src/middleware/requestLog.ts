import crypto from 'crypto'
import type { Request, Response, NextFunction } from 'express'
import { logger, type Logger } from '../services/logger.js'

/**
 * A request id on every line, and one completion line per request
 * (features/0025).
 *
 * ## Why this is thirty lines rather than `pino-http`
 *
 * `pino-http` gives all of this for free and, by default, serialises `req` and
 * `res` — **including headers**. On this API that is `Authorization` on every
 * authenticated call and `Cookie` on the two that carry the refresh token.
 * Redaction can strip them, and it is configured; but a design that logs
 * everything and then removes the known-bad paths fails **open**, because the
 * next header or field nobody listed goes straight through. This names the five
 * things it logs and can therefore leak nothing else.
 *
 * ## The id is ours
 *
 * Generated here, always. An inbound `x-request-id` is **not** adopted: it is a
 * value the caller controls, so adopting it would let somebody repeat an id to
 * interleave their requests with another customer's in the log, put unbounded
 * text on every line, and — if the log is ever read as text — put newlines in
 * it. When one is present it is recorded once, truncated, as `upstreamRequestId`
 * on the completion line, which keeps the trace without handing over the key.
 */

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** A child logger carrying this request's id. */
      log: Logger
      requestId: string
    }
  }
}

/** Enough to correlate, short enough not to be a payload. */
const MAX_UPSTREAM_ID = 128

/** Paths that would otherwise fill the log with nothing. */
const IGNORED = new Set(['/health'])

export function requestLog(req: Request, res: Response, next: NextFunction): void {
  const requestId = crypto.randomUUID()
  req.requestId = requestId
  req.log = logger.child({ requestId })

  // The load balancer calls this every few seconds, for ever. It is the one
  // request whose success says nothing.
  if (IGNORED.has(req.path)) return next()

  const startedAt = process.hrtime.bigint()

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6

    const upstream = req.headers['x-request-id']
    const upstreamRequestId =
      typeof upstream === 'string' && upstream.length > 0
        ? upstream.slice(0, MAX_UPSTREAM_ID)
        : undefined

    req.log.info(
      {
        method: req.method,
        // The matched route (`/api/forms/:id`) rather than the URL, so lines
        // group by endpoint instead of by id — and so a path that happens to
        // contain a token never reaches the log.
        route: req.route?.path ? `${req.baseUrl}${req.route.path}` : req.baseUrl || req.path,
        status: res.statusCode,
        durationMs: Math.round(durationMs),
        ...(upstreamRequestId ? { upstreamRequestId } : {})
      },
      'request completed'
    )
  })

  next()
}
