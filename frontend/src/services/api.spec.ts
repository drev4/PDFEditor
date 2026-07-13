import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { api, ApiError } from './api'

describe('API Service', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('request with token', () => {
    it('should include authorization header when token exists', async () => {
      localStorage.setItem('token', 'test-token')

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
      localStorage.setItem('token', 'invalid-token')
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Unauthorized' })
      } as Response)

      await expect(api.get('/test')).rejects.toThrow(ApiError)
      expect(localStorage.getItem('token')).toBeNull()
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
