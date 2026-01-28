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
})
