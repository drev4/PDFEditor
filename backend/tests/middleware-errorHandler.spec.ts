import { describe, it, expect, vi } from 'vitest'
import { Request, Response } from 'express'
import { AppError, errorHandler } from '../src/middleware/errorHandler'
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
    vi.spyOn(console, 'error').mockImplementation(() => {})
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
  // trace for it, so a healthy server looked like a broken one.
  describe('what it writes to the log', () => {
    it('does not log an expected 4xx', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      spy.mockClear()

      errorHandler(new AppError(401, 'Not authenticated'), mockReq as any, mockRes as any, mockNext)

      expect(spy).not.toHaveBeenCalled()
      // Still answered, so nothing is swallowed.
      expect(statusMock).toHaveBeenCalledWith(401)
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Not authenticated' })
    })

    it('does not log any other client error either', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      spy.mockClear()

      for (const status of [400, 403, 404, 409, 429]) {
        errorHandler(new AppError(status, 'nope'), mockReq as any, mockRes as any, mockNext)
      }

      expect(spy).not.toHaveBeenCalled()
    })

    it('logs an AppError that is a server fault', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      spy.mockClear()
      const error = new AppError(503, 'Upstream is down')

      errorHandler(error, mockReq as any, mockRes as any, mockNext)

      expect(spy).toHaveBeenCalledWith('Error:', error)
      expect(statusMock).toHaveBeenCalledWith(503)
    })

    it('logs an unexpected error, which is the whole point of the log', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      spy.mockClear()
      const error = new Error('Unexpected error')

      errorHandler(error, mockReq as any, mockRes as any, mockNext)

      expect(spy).toHaveBeenCalledWith('Error:', error)
      expect(statusMock).toHaveBeenCalledWith(500)
    })
  })
})
