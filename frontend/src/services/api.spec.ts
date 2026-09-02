import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { api, ApiError, setAccessToken, getAccessToken } from './api'

describe('API Service', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
    localStorage.clear()
    setAccessToken(null)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('request with token', () => {
    it('should include authorization header when token exists', async () => {
      setAccessToken('test-token')

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ data: 'success' })
      } as Response)

      await api.get('/test')

      const fetchCall = vi.mocked(fetch).mock.calls[0]
      const headers = fetchCall[1]?.headers as Record<string, string>

      expect(headers.Authorization).toBe('Bearer test-token')
    })

    it('should not include authorization when no token', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ data: 'success' })
      } as Response)

      await api.get('/test')

      const fetchCall = vi.mocked(fetch).mock.calls[0]
      const headers = fetchCall[1]?.headers as Record<string, string>

      expect(headers.Authorization).toBeUndefined()
    })
  })

  describe('HTTP methods', () => {
    it('should make GET request', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ data: 'test' })
      } as Response)

      const result = await api.get('/test')

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/test'),
        expect.objectContaining({ method: 'GET' })
      )
      expect(result).toEqual({ data: 'test' })
    })

    it('should make POST request with body', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ success: true })
      } as Response)

      await api.post('/test', { name: 'test' })

      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'test' }),
          headers: expect.objectContaining({
            'Content-Type': 'application/json'
          })
        })
      )
    })

    it('should make PUT request', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ updated: true })
      } as Response)

      await api.put('/test', { id: 1 })

      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: 'PUT' })
      )
    })

    it('should make DELETE request', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ deleted: true })
      } as Response)

      await api.delete('/test')

      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: 'DELETE' })
      )
    })
  })

  describe('Error handling', () => {
    it('should throw ApiError on failed request', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: 'Bad request' })
      } as Response)

      await expect(api.get('/test')).rejects.toThrow(ApiError)
      await expect(api.get('/test')).rejects.toThrow('Bad request')
    })

    it('should clear token on 401 error', async () => {
      setAccessToken('invalid-token')
      // Two 401s: the request, then the refresh attempt it triggers. Without
      // the second the retry would loop.
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Unauthorized' })
      } as Response)

      await expect(api.get('/test')).rejects.toThrow(ApiError)
      expect(getAccessToken()).toBeNull()
    })

    it('refreshes once and replays the request when the access token expired', async () => {
      setAccessToken('expired-token')

      vi.mocked(fetch)
        .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: 'Unauthorized' }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'fresh-token' }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => ({ data: 'success' }) } as Response)

      await expect(api.get('/test')).resolves.toEqual({ data: 'success' })

      // A 15-minute access token must be invisible to the user, not a logout
      // every fifteen minutes.
      expect(getAccessToken()).toBe('fresh-token')
      const replay = vi.mocked(fetch).mock.calls[2]
      expect((replay[1]?.headers as Record<string, string>).Authorization).toBe('Bearer fresh-token')
    })

    it('fires a single refresh for a burst of parallel 401s', async () => {
      setAccessToken('expired-token')

      vi.mocked(fetch).mockImplementation(async (url: any) => {
        const path = String(url)
        if (path.includes('/auth/refresh')) {
          return { ok: true, json: async () => ({ token: 'fresh-token' }) } as Response
        }
        if (getAccessToken() === 'expired-token') {
          return { ok: false, status: 401, json: async () => ({ error: 'Unauthorized' }) } as Response
        }
        return { ok: true, json: async () => ({ data: 'success' }) } as Response
      })

      await Promise.all([api.get('/a'), api.get('/b'), api.get('/c')])

      // Refresh tokens rotate, so a second concurrent refresh would present an
      // already-exchanged token, the server would read it as a replay, and the
      // whole family would be revoked — logging the user out via the mechanism
      // meant to keep them signed in.
      const refreshCalls = vi.mocked(fetch).mock.calls.filter(c => String(c[0]).includes('/auth/refresh'))
      expect(refreshCalls).toHaveLength(1)
    })

    it('should include error details in ApiError', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: 'Validation error', details: ['field required'] })
      } as Response)

      try {
        await api.get('/test')
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError)
        expect((error as ApiError).details).toEqual(['field required'])
      }
    })
  })
})
