import { describe, it, expect, beforeEach, vi } from 'vitest'
import { authService } from './auth'
import { api, setAccessToken, getAccessToken, refreshSession } from './api'

vi.mock('./api', async () => {
  // The access token is module state in api.ts, so the mock keeps its own and
  // behaves the same way. Testing against a stub that always returns null would
  // make every assertion about token handling vacuous.
  let token: string | null = null
  return {
    api: { post: vi.fn(), get: vi.fn() },
    setAccessToken: vi.fn((t: string | null) => { token = t }),
    getAccessToken: vi.fn(() => token),
    refreshSession: vi.fn(async () => false)
  }
})

describe('Auth Service', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    setAccessToken(null)
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

  /** features/0033 — what the signup screen reads before it draws. */
  describe('getRegistrationMode', () => {
    it('reads the mode from the unauthenticated endpoint', async () => {
      vi.mocked(api.get).mockResolvedValue({ mode: 'invite_only' })

      await expect(authService.getRegistrationMode()).resolves.toBe('invite_only')
      expect(api.get).toHaveBeenCalledWith('/auth/registration')
    })
  })

  describe('register', () => {
    it('sends the signup code when one is given', async () => {
      vi.mocked(api.post).mockResolvedValue(mockAuthResponse)

      await authService.register('test@example.com', 'password123', 'Test User', 'a-code')

      expect(api.post).toHaveBeenCalledWith('/auth/register', {
        email: 'test@example.com',
        password: 'password123',
        name: 'Test User',
        code: 'a-code'
      })
    })

    it('holds the access token in memory, never in localStorage', async () => {
      vi.mocked(api.post).mockResolvedValue(mockAuthResponse)

      const result = await authService.register('test@example.com', 'password123', 'Test User')

      expect(api.post).toHaveBeenCalledWith('/auth/register', {
        email: 'test@example.com',
        password: 'password123',
        name: 'Test User'
      })
      expect(result.token).toBe('test-token')
      expect(getAccessToken()).toBe('test-token')
      // Finding S4: nothing readable by an XSS, and nothing that outlives the
      // page. The refresh token is in an httpOnly cookie this code cannot see.
      expect(localStorage.getItem('token')).toBeNull()
      expect(JSON.stringify(localStorage)).not.toContain('test-token')
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
    it('holds the access token in memory, never in localStorage', async () => {
      vi.mocked(api.post).mockResolvedValue(mockAuthResponse)

      const result = await authService.login('test@example.com', 'password123')

      expect(api.post).toHaveBeenCalledWith('/auth/login', {
        email: 'test@example.com',
        password: 'password123'
      })
      expect(result.user.email).toBe('test@example.com')
      expect(getAccessToken()).toBe('test-token')
      expect(localStorage.getItem('token')).toBeNull()
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
    it('revokes on the server, not just locally', async () => {
      vi.mocked(api.post).mockResolvedValue(mockAuthResponse)
      await authService.login('test@example.com', 'password123')
      vi.mocked(api.post).mockClear()
      vi.mocked(api.post).mockResolvedValue(undefined as never)

      await authService.logout()

      // The defect S4 describes: logout used to be a localStorage delete, and
      // the token stayed valid for the rest of the week.
      expect(api.post).toHaveBeenCalledWith('/auth/logout', {})
      expect(getAccessToken()).toBeNull()
    })

    it('clears local state even when the request fails', async () => {
      vi.mocked(api.post).mockResolvedValue(mockAuthResponse)
      await authService.login('test@example.com', 'password123')
      vi.mocked(api.post).mockRejectedValue(new Error('offline'))

      await expect(authService.logout()).resolves.toBeUndefined()

      // A network failure must not leave someone looking logged in on a shared
      // machine.
      expect(getAccessToken()).toBeNull()
    })
  })

  describe('bootstrapSession', () => {
    it('returns true without a request when a token is already held', async () => {
      setAccessToken('already-here')

      await expect(authService.bootstrapSession()).resolves.toBe(true)

      expect(refreshSession).not.toHaveBeenCalled()
    })

    it('asks the server when there is no token in memory', async () => {
      vi.mocked(refreshSession).mockResolvedValue(true)

      await expect(authService.bootstrapSession()).resolves.toBe(true)

      // After a reload there is nothing local to consult: the access token died
      // with the page and the refresh cookie is unreadable. Only the server knows.
      expect(refreshSession).toHaveBeenCalled()
    })

    it('reports no session when the refresh fails', async () => {
      vi.mocked(refreshSession).mockResolvedValue(false)

      await expect(authService.bootstrapSession()).resolves.toBe(false)
    })
  })

  describe('getToken', () => {
    it('returns the in-memory token', () => {
      setAccessToken('test-token')

      expect(authService.getToken()).toBe('test-token')
    })

    it('should return null if no token', () => {
      expect(authService.getToken()).toBeNull()
    })
  })
})
