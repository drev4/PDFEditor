import { Request, Response, NextFunction } from 'express'
import { ZodError } from 'zod'
import { logger } from '../services/logger.js'

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
  _next: NextFunction
) {
  const isExpectedClientError = err instanceof AppError && err.statusCode < 500
  // `req.log` when the request reached `requestLog` — which is every route, but
  // not an error thrown before the middleware runs.
  const log = req.log ?? logger

  if (isExpectedClientError) {
    log.info(
      { status: (err as AppError).statusCode, error: err.message },
      'request refused'
    )
  } else {
    // The stack, and only here. A 4xx printing one is what taught everybody to
    // ignore this output.
    log.error({ err }, 'request failed')
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
