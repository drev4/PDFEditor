import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth.store'

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
      // The home screen is the list of forms — the canvas's `Main` artboard.
      // It used to be the PDF editor, which meant signing in dropped you into a
      // workspace with no document instead of into your work.
      path: '/dashboard',
      name: 'dashboard',
      component: () => import('@/views/FormsManagementView.vue'),
      meta: { requiresAuth: true }
    },
    {
      // Kept as a second path to the same screen rather than a redirect: it is
      // a URL people already have, and e2e/session.spec.ts asserts on it.
      path: '/dashboard/forms',
      name: 'forms-management',
      component: () => import('@/views/FormsManagementView.vue'),
      meta: { requiresAuth: true }
    },
    {
      // The editor is its own screen now, and its own route. In the canvas it
      // is full-bleed with no app sidebar — the author is working on one
      // document and the chrome gets out of the way.
      path: '/dashboard/editor',
      name: 'editor',
      component: () => import('@/views/EditorView.vue'),
      meta: { requiresAuth: true }
    },
    {
      path: '/dashboard/responses',
      name: 'responses-index',
      component: () => import('@/views/ResponsesIndexView.vue'),
      meta: { requiresAuth: true }
    },
    {
      path: '/dashboard/settings',
      name: 'settings',
      component: () => import('@/views/SettingsView.vue'),
      meta: { requiresAuth: true }
    },
    {
      path: '/dashboard/forms/:id/responses',
      name: 'form-responses',
      component: () => import('@/views/ResponsesView.vue'),
      meta: { requiresAuth: true }
    },
    {
      path: '/dashboard/team',
      name: 'members',
      component: () => import('@/views/MembersView.vue'),
      meta: { requiresAuth: true }
    },
    {
      // Where an invitation link lands. Public: the invited person may not have
      // an account yet, which is the whole reason the route exists.
      path: '/invitations/:token',
      name: 'accept-invitation',
      component: () => import('@/views/AcceptInvitationView.vue'),
      meta: { public: true }
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

  const requiresAuth = to.matched.some(record => record.meta.requiresAuth)
  const requiresGuest = to.matched.some(record => record.meta.requiresGuest)
  const isPublic = to.matched.some(record => record.meta.public)

  // Whether there is a session can no longer be read locally: the access token
  // is in memory and gone after a reload, and the refresh token is in an
  // httpOnly cookie. Only the server knows, so the guard awaits the answer —
  // once per app start, deduplicated inside the store.
  //
  // Skipped for public routes. A respondent filling in a shared form has no
  // session, and asking for one on every visit is a guaranteed 401 per page
  // load for the majority of this product's traffic.
  if (!isPublic) {
    await authStore.bootstrap()
  }

  if (requiresAuth && !authStore.isAuthenticated) {
    next({ name: 'login', query: { redirect: to.fullPath } })
  } else if (requiresGuest && authStore.isAuthenticated) {
    next({ name: 'dashboard' })
  } else {
    next()
  }
})

export default router
