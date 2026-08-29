import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from './auth.store'
import { authService } from '../services/auth'

// Mock AuthService
vi.mock('../services/auth', () => ({
    authService: {
        login: vi.fn(),
        register: vi.fn(),
        logout: vi.fn(),
        me: vi.fn(),
        isAuthenticated: vi.fn()
    }
}))

describe('Auth Store', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        vi.clearAllMocks()
    })

    it('initializes with null user', () => {
        const store = useAuthStore()
        expect(store.user).toBeNull()
        expect(store.isAuthenticated).toBe(false)
    })

    it('login updates user state on success', async () => {
        const store = useAuthStore()
        const mockUser = { id: '1', email: 'test@example.com', name: 'Test', createdAt: '2023-01-01' }

        // Mock successful login
        vi.mocked(authService.login).mockResolvedValue({
            user: mockUser,
            token: 'token'
        })

        await store.login('test@example.com', 'password')

        expect(authService.login).toHaveBeenCalledWith('test@example.com', 'password')
        expect(store.user).toEqual(mockUser)
        expect(store.isAuthenticated).toBe(true)
        expect(store.error).toBeNull()
    })

    it('login handles errors', async () => {
        const store = useAuthStore()

        // Mock failed login
        vi.mocked(authService.login).mockRejectedValue(new Error('Login failed'))

        await expect(store.login('test@example.com', 'wrong')).rejects.toThrow('Login failed')

        expect(store.user).toBeNull()
        expect(store.loading).toBe(false)
    })

    it('logout revokes on the server and clears user state', async () => {
        const store = useAuthStore()
        store.user = { id: '1', email: 'test@example.com', name: 'Test', createdAt: '2023-01-01' }
        vi.mocked(authService.logout).mockResolvedValue(undefined)

        // Awaited now: logout performs a server-side revocation, and the caller
        // navigates away once it resolves.
        await store.logout()

        expect(authService.logout).toHaveBeenCalled()
        expect(store.user).toBeNull()
    })
})
