import { Request, Response, NextFunction } from 'express'
import { ZodError } from 'zod'
import { logger } from '../services/logger.js'
import { captureError } from '../services/error-tracking.js'

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public message: string
  ) {
    super(message)
    this.name = 'AppError'
  }
}

/**
 * A 4xx is this API answering correctly — the client asked for something it may
 * not have, or sent something malformed. A 5xx is this API failing.
 *
 * They were logged identically, with a full stack trace, which made the server
 * output unreadable in normal use: opening the login page with no session calls
 * `POST /api/auth/refresh`, which has no cookie to work with and correctly
 * answers `401 Not authenticated` — and printed a stack trace every time, as if
 * something had gone wrong. Anything that logs a fault when nothing is wrong
 * trains you to ignore the log, which is where the real fault will appear.
 *
 * So: 5xx is logged at `error` with its stack; 4xx is logged at `info`, with no
 * stack, because it is not a fault — it is the API answering correctly, and the
 * client already has the answer.
 *
 * **That split is what features/0025 was waiting for.** Until there was a logger
 * with levels and a request id, the only way to stop 4xx drowning the output was
 * to drop it entirely, and this comment said so. It is no longer dropped: it is
 * one `info` line carrying the same request id as everything else that request
 * did, which is what makes "what happened to our submission at 14:32" a question
 * with an answer.
 */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) {
  const isExpectedClientError = err instanceof AppError && err.statusCode < 500
  // `req.log` when the request reached `requestLog` — which is every route, but
  // not an error thrown before the middleware runs.
  const log = req.log ?? logger

  // The response is already on the wire — a stream that failed mid-write, which
  // the PDF route can do. Answering again throws `ERR_HTTP_HEADERS_SENT` and
  // replaces a partial body with a crash; Express's default handler closes the
  // connection instead, which is the honest outcome (features/0026).
  if (res.headersSent) {
    log.error({ err }, 'request failed after the response had started')
    // Reported too: a stream that died mid-write is a fault, and it is one of
    // the few this API can produce where the client sees a truncated body and
    // no status to explain it.
    captureError(err, { requestId: req.requestId, source: 'api-stream' })
    return next(err)
  }

  if (isExpectedClientError) {
    log.info(
      { status: (err as AppError).statusCode, error: err.message },
      'request refused'
    )
  } else {
    // The stack, and only here. A 4xx printing one is what taught everybody to
    // ignore this output.
    log.error({ err }, 'request failed')

    // And the tracker, on exactly the same branch (features/0034). Putting it
    // here rather than above the `if` is the whole decision: a 4xx must not be
    // reported, for the reason this file already argues at length. The context
    // is built one field at a time — no request object is handed over, because
    // a body on this API is answer values typed by a member of the public.
    captureError(err, {
      requestId: req.requestId,
      // The matched pattern, never the URL, so an id or a token in the path
      // never reaches a third party. Same rule as the log line.
      route: req.route?.path ? `${req.baseUrl}${req.route.path}` : req.baseUrl || undefined,
      statusCode: err instanceof AppError ? err.statusCode : 500,
      source: 'api'
    })
  }

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: err.message
    })
  }

  // Check for ZodError both by instanceof and by checking for 'issues' property
  // This handles both real ZodErrors and mocked ones in tests
  if (err instanceof ZodError || (err as any).issues) {
    return res.status(400).json({
      error: 'Validation error',
      details: (err as ZodError).errors || (err as any).issues
    })
  }

  return res.status(500).json({
    error: 'Internal server error'
  })
}
