import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Request, Response } from 'express'
import { authenticate } from '../src/middleware/auth'
import jwt from 'jsonwebtoken'

// Mock jwt
vi.mock('jsonwebtoken')

describe('Auth Middleware', () => {
  let mockReq: Partial<Request>
  let mockRes: Partial<Response>
  let mockNext: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockReq = {
      headers: {}
    }
    mockRes = {}
    mockNext = vi.fn()
    vi.clearAllMocks()
  })

  it('should authenticate with valid token', () => {
    mockReq.headers = {
      authorization: 'Bearer valid-token'
    }

    vi.mocked(jwt.verify).mockReturnValue({ userId: 'user-123' } as any)

    authenticate(mockReq as any, mockRes as any, mockNext)

    expect((mockReq as any).userId).toBe('user-123')
    expect(mockNext).toHaveBeenCalledWith()
  })

  it('should throw error when no token provided', () => {
    mockReq.headers = {}

    expect(() => {
      authenticate(mockReq as any, mockRes as any, mockNext)
    }).toThrow('No token provided')
  })

  it('should throw error when token is invalid', () => {
    mockReq.headers = {
      authorization: 'Bearer invalid-token'
    }

    vi.mocked(jwt.verify).mockImplementation(() => {
      throw new Error('Invalid token')
    })

    expect(() => {
      authenticate(mockReq as any, mockRes as any, mockNext)
    }).toThrow('Invalid token')
  })

  it('should throw error when authorization header malformed', () => {
    mockReq.headers = {
      authorization: 'InvalidFormat token'
    }

    expect(() => {
      authenticate(mockReq as any, mockRes as any, mockNext)
    }).toThrow('No token provided')
  })
})
