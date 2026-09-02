import { describe, it, expect, vi } from 'vitest'
import { Request, Response } from 'express'
import { AppError, errorHandler } from '../src/middleware/errorHandler'
import { logger } from '../src/services/logger'
import { ZodError, ZodIssue } from 'zod'

describe('Error Handler Middleware', () => {
  let mockReq: Partial<Request>
  let mockRes: Partial<Response>
  let mockNext: ReturnType<typeof vi.fn>
  let statusMock: ReturnType<typeof vi.fn>
  let jsonMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockReq = {}
    jsonMock = vi.fn()
    statusMock = vi.fn(() => ({ json: jsonMock }))
    mockRes = {
      status: statusMock as any
    }
    mockNext = vi.fn()
    // Asserting on the logger rather than on `console` since features/0025.
    // The `mockReq` here has no `req.log`, which is deliberate: it is the
    // pre-middleware case, and the handler falls back to the root logger.
    vi.spyOn(logger, 'error').mockImplementation(() => {})
    vi.spyOn(logger, 'info').mockImplementation(() => {})
  })

  it('should handle AppError', () => {
    const error = new AppError(400, 'Bad request')

    errorHandler(error, mockReq as any, mockRes as any, mockNext)

    expect(statusMock).toHaveBeenCalledWith(400)
    expect(jsonMock).toHaveBeenCalledWith({ error: 'Bad request' })
  })

  it('should handle ZodError', () => {
    const zodError = new ZodError([
      {
        code: 'invalid_type',
        expected: 'string',
        received: 'number',
        path: ['email'],
        message: 'Expected string, received number'
      } as ZodIssue
    ])

    errorHandler(zodError, mockReq as any, mockRes as any, mockNext)

    expect(statusMock).toHaveBeenCalledWith(400)
    expect(jsonMock).toHaveBeenCalledWith({
      error: 'Validation error',
      details: expect.any(Array)
    })
  })

  it('should handle generic errors as 500', () => {
    const error = new Error('Unexpected error')

    errorHandler(error, mockReq as any, mockRes as any, mockNext)

    expect(statusMock).toHaveBeenCalledWith(500)
    expect(jsonMock).toHaveBeenCalledWith({ error: 'Internal server error' })
  })

  // Regression: opening the login page with no session calls POST
  // /api/auth/refresh, which correctly answers 401 — and used to print a stack
  // trace for it, so a healthy server looked like a broken one. Since
  // features/0025 it is not silent either: it is one `info` line carrying the
  // request id, which is the distinction a bare console could not express.
  describe('what it writes to the log', () => {
    it('records an expected 4xx at info, and never as a fault', () => {
      const asFault = vi.spyOn(logger, 'error').mockImplementation(() => {})
      const asInfo = vi.spyOn(logger, 'info').mockImplementation(() => {})
      asFault.mockClear()
      asInfo.mockClear()

      errorHandler(new AppError(401, 'Not authenticated'), mockReq as any, mockRes as any, mockNext)

      // The distinction the old comment was waiting for: a 4xx is the API
      // answering correctly, so it is no longer a stack trace — but it is no
      // longer thrown away either (features/0025).
      expect(asFault).not.toHaveBeenCalled()
      expect(asInfo).toHaveBeenCalledWith(
        { status: 401, error: 'Not authenticated' },
        'request refused'
      )
      // Still answered, so nothing is swallowed.
      expect(statusMock).toHaveBeenCalledWith(401)
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Not authenticated' })
    })

    it('treats no other client error as a fault either', () => {
      const spy = vi.spyOn(logger, 'error').mockImplementation(() => {})
      spy.mockClear()

      for (const status of [400, 403, 404, 409, 429]) {
        errorHandler(new AppError(status, 'nope'), mockReq as any, mockRes as any, mockNext)
      }

      expect(spy).not.toHaveBeenCalled()
    })

    it('logs an AppError that is a server fault', () => {
      const spy = vi.spyOn(logger, 'error').mockImplementation(() => {})
      spy.mockClear()
      const error = new AppError(503, 'Upstream is down')

      errorHandler(error, mockReq as any, mockRes as any, mockNext)

      // `{ err }` is pino's own key for an error, which is what serialises the
      // stack rather than printing `{}`.
      expect(spy).toHaveBeenCalledWith({ err: error }, 'request failed')
      expect(statusMock).toHaveBeenCalledWith(503)
    })

    it('logs an unexpected error, which is the whole point of the log', () => {
      const spy = vi.spyOn(logger, 'error').mockImplementation(() => {})
      spy.mockClear()
      const error = new Error('Unexpected error')

      errorHandler(error, mockReq as any, mockRes as any, mockNext)

      expect(spy).toHaveBeenCalledWith({ err: error }, 'request failed')
      expect(statusMock).toHaveBeenCalledWith(500)
    })
  })
})
