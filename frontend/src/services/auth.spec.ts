import { describe, it, expect, beforeEach, vi } from 'vitest'
import { authService } from './auth'
import { api } from './api'

vi.mock('./api')

describe('Auth Service', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  const mockAuthResponse = {
    user: {
      id: 'user-1',
      email: 'test@example.com',
      name: 'Test User',
      createdAt: '2024-01-01'
    },
    token: 'test-token'
  }

  describe('register', () => {
    it('should register user and store token', async () => {
      vi.mocked(api.post).mockResolvedValue(mockAuthResponse)

      const result = await authService.register('test@example.com', 'password123', 'Test User')

      expect(api.post).toHaveBeenCalledWith('/auth/register', {
        email: 'test@example.com',
        password: 'password123',
        name: 'Test User'
      })
      expect(result.token).toBe('test-token')
      expect(localStorage.getItem('token')).toBe('test-token')
    })

    it('should register without name', async () => {
      vi.mocked(api.post).mockResolvedValue(mockAuthResponse)

      await authService.register('test@example.com', 'password123')

      expect(api.post).toHaveBeenCalledWith('/auth/register', {
        email: 'test@example.com',
        password: 'password123',
        name: undefined
      })
    })
  })

  describe('login', () => {
    it('should login user and store token', async () => {
      vi.mocked(api.post).mockResolvedValue(mockAuthResponse)

      const result = await authService.login('test@example.com', 'password123')

      expect(api.post).toHaveBeenCalledWith('/auth/login', {
        email: 'test@example.com',
        password: 'password123'
      })
      expect(result.user.email).toBe('test@example.com')
      expect(localStorage.getItem('token')).toBe('test-token')
    })
  })

  describe('me', () => {
    it('should fetch current user', async () => {
      vi.mocked(api.get).mockResolvedValue({ user: mockAuthResponse.user })

      const user = await authService.me()

      expect(api.get).toHaveBeenCalledWith('/auth/me')
      expect(user.email).toBe('test@example.com')
    })
  })

  describe('logout', () => {
    it('should remove token from localStorage', () => {
      localStorage.setItem('token', 'test-token')

      authService.logout()

      expect(localStorage.getItem('token')).toBeNull()
    })
  })

  describe('isAuthenticated', () => {
    it('should return true when token exists', () => {
      localStorage.setItem('token', 'test-token')

      const result = authService.isAuthenticated()

      expect(result).toBe(true)
    })

    it('should return false when no token', () => {
      const result = authService.isAuthenticated()

      expect(result).toBe(false)
    })
  })

  describe('getToken', () => {
    it('should return token if exists', () => {
      localStorage.setItem('token', 'test-token')

      const token = authService.getToken()

      expect(token).toBe('test-token')
    })

    it('should return null if no token', () => {
      const token = authService.getToken()

      expect(token).toBeNull()
    })
  })
})
