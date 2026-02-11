import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth.store'
import { authService } from '@/services/auth'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      redirect: '/dashboard'
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { requiresGuest: true }
    },
    {
      path: '/register',
      name: 'register',
      component: () => import('@/views/RegisterView.vue'),
      meta: { requiresGuest: true }
    },
    {
      path: '/dashboard',
      name: 'dashboard',
      component: () => import('@/views/DashboardView.vue'),
      meta: { requiresAuth: true }
    },
    {
      path: '/dashboard/forms',
      name: 'forms-management',
      component: () => import('@/views/FormsManagementView.vue'),
      meta: { requiresAuth: true }
    },
    {
      path: '/dashboard/forms/:id/responses',
      name: 'form-responses',
      component: () => import('@/views/ResponsesView.vue'),
      meta: { requiresAuth: true }
    },
    {
      path: '/form/:shareId',
      name: 'public-form',
      component: () => import('@/views/PublicFormView.vue'),
      meta: { public: true }
    },
    {
      path: '/form/:shareId/confirmation',
      name: 'public-form-confirmation',
      component: () => import('@/views/PublicFormConfirmationView.vue'),
      meta: { public: true }
    }
  ]
})

// Navigation Guards
router.beforeEach(async (to, from, next) => {
  const authStore = useAuthStore()

  // Si el usuario no ha sido cargado aún y hay token, cargar usuario
  if (!authStore.user && authService.isAuthenticated()) {
    try {
      await authStore.fetchUser()
    } catch (error) {
      // Token inválido, será redirigido por el guard
      console.error('Failed to fetch user in router guard:', error)
    }
  }

  const requiresAuth = to.matched.some(record => record.meta.requiresAuth)
  const requiresGuest = to.matched.some(record => record.meta.requiresGuest)

  if (requiresAuth && !authStore.isAuthenticated) {
    next({ name: 'login', query: { redirect: to.fullPath } })
  } else if (requiresGuest && authStore.isAuthenticated) {
    next({ name: 'dashboard' })
  } else {
    next()
  }
})

export default router
