import { Request, Response, NextFunction } from 'express'
import { ZodError } from 'zod'

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
 * So: 5xx is logged with its stack; 4xx is not logged at all. It is not lost
 * information — it is in the response the client received. When structured
 * logging arrives (S9 in docs/BACKLOG.md) 4xx belongs at `info` with a request
 * id, which is a thing this console cannot express.
 */
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  const isExpectedClientError = err instanceof AppError && err.statusCode < 500

  if (!isExpectedClientError) {
    console.error('Error:', err)
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
