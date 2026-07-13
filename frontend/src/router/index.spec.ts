import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createRouter, createMemoryHistory } from 'vue-router'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '@/stores/auth.store'
import { authService } from '@/services/auth'

vi.mock('@/services/auth')

// Create a test router with the same routes
const createTestRouter = () => {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/',
        redirect: '/dashboard'
      },
      {
        path: '/login',
        name: 'login',
        component: { template: '<div>Login</div>' },
        meta: { requiresGuest: true }
      },
      {
        path: '/register',
        name: 'register',
        component: { template: '<div>Register</div>' },
        meta: { requiresGuest: true }
      },
      {
        path: '/dashboard',
        name: 'dashboard',
        component: { template: '<div>Dashboard</div>' },
        meta: { requiresAuth: true }
      }
    ]
  })
}

describe('Router', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('should redirect to dashboard from root', async () => {
    const router = createTestRouter()
    const authStore = useAuthStore()
    authStore.user = { id: '1', email: 'test@test.com', name: 'Test', createdAt: '2024-01-01' }

    await router.push('/')
    await router.isReady()

    expect(router.currentRoute.value.path).toBe('/dashboard')
  })

  it('should redirect to login when accessing protected route without auth', async () => {
    const router = createTestRouter()
    vi.mocked(authService.isAuthenticated).mockReturnValue(false)

    // Add navigation guard
    router.beforeEach(async (to, from, next) => {
      const authStore = useAuthStore()
      const requiresAuth = to.matched.some(record => record.meta.requiresAuth)

      if (requiresAuth && !authStore.isAuthenticated) {
        next({ name: 'login', query: { redirect: to.fullPath } })
      } else {
        next()
      }
    })

    await router.push('/dashboard')
    await router.isReady()

    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.redirect).toBe('/dashboard')
  })

  it('should redirect authenticated users from guest pages', async () => {
    const router = createTestRouter()
    const authStore = useAuthStore()
    authStore.user = { id: '1', email: 'test@test.com', name: 'Test', createdAt: '2024-01-01' }

    // Add navigation guard
    router.beforeEach(async (to, from, next) => {
      const authStore = useAuthStore()
      const requiresGuest = to.matched.some(record => record.meta.requiresGuest)

      if (requiresGuest && authStore.isAuthenticated) {
        next({ name: 'dashboard' })
      } else {
        next()
      }
    })

    await router.push('/login')
    await router.isReady()

    expect(router.currentRoute.value.name).toBe('dashboard')
  })

  it('should allow access to public routes', async () => {
    const router = createTestRouter()

    await router.push('/login')
    await router.isReady()

    expect(router.currentRoute.value.name).toBe('login')
  })

  it('should load user if token exists', async () => {
    const router = createTestRouter()
    const authStore = useAuthStore()
    vi.mocked(authService.isAuthenticated).mockReturnValue(true)
    authStore.fetchUser = vi.fn().mockResolvedValue({})

    // Add navigation guard
    router.beforeEach(async (to, from, next) => {
      const authStore = useAuthStore()

      if (!authStore.user && authService.isAuthenticated()) {
        try {
          await authStore.fetchUser()
        } catch (error) {
          console.error('Failed to fetch user:', error)
        }
      }

      next()
    })

    await router.push('/dashboard')
    await router.isReady()

    expect(authStore.fetchUser).toHaveBeenCalled()
  })
})
