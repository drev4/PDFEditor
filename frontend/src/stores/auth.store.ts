import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { authService, type User } from '../services/auth'
import { useAsyncAction } from '../composables/useAsyncAction'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const isAuthenticated = computed(() => !!user.value)

  async function register(email: string, password: string, name?: string, code?: string) {
    return useAsyncAction({ loading, error }, async () => {
      const response = await authService.register(email, password, name, code)
      user.value = response.user
      sessionSettled()
      return response
    }, { fallbackMessage: 'Registration failed' })
  }

  async function login(email: string, password: string) {
    return useAsyncAction({ loading, error }, async () => {
      const response = await authService.login(email, password)
      user.value = response.user
      sessionSettled()
      return response
    }, { fallbackMessage: 'Login failed' })
  }

  /**
   * Recovers a session after a page load, once per app start.
   *
   * There is no longer anything readable by JavaScript that says whether the
   * user is logged in — the access token is in memory and dies with the page,
   * and the refresh token is in an httpOnly cookie. So the only honest answer
   * comes from the server, and the router has to await it before deciding.
   */
  let bootstrapped: Promise<void> | null = null

  /**
   * Marks the session state as already known, so `bootstrap()` stops asking the
   * server. Called after a login, a registration and a logout.
   *
   * The logout case is the one that matters. Without it, a caller that does not
   * await `logout()` navigates immediately, the router guard bootstraps, and the
   * refresh cookie — not yet cleared, because the request is still in flight —
   * hands back a valid session. The user clicks "log out" and lands back on the
   * dashboard.
   */
  function sessionSettled() {
    bootstrapped = Promise.resolve()
  }

  function bootstrap(): Promise<void> {
    if (!bootstrapped) {
      bootstrapped = authService
        .bootstrapSession()
        .then(async ok => {
          if (!ok) {
            user.value = null
            return
          }
          await fetchUser()
        })
        .catch(() => {
          user.value = null
        })
    }
    return bootstrapped
  }

  async function fetchUser() {
    if (!authService.getToken()) {
      user.value = null
      return null
    }

    try {
      loading.value = true
      error.value = null
      user.value = await authService.me()
      return user.value
    } catch {
      authService.logout()
      user.value = null
      return null
    } finally {
      loading.value = false
    }
  }

  async function logout() {
    // Local state goes first and synchronously, so this store is never briefly
    // "logged out but still authenticated" for a caller that does not await —
    // see `sessionSettled`. The awaited part is the server-side revocation,
    // which is what actually ends the session. `authService.logout` never
    // rejects.
    user.value = null
    sessionSettled()
    await authService.logout()
  }

  return {
    user,
    loading,
    error,
    isAuthenticated,
    register,
    login,
    logout,
    fetchUser,
    bootstrap
  }
}, {
  // `user` is persisted so a reload can paint the shell without waiting for the
  // network. It is a hint, never an authorisation: `bootstrap()` asks the server
  // whether the session is real, and every API call is authorised by a token
  // this store does not hold.
  persist: {
    key: 'vuepdf-auth',
    storage: localStorage,
    pick: ['user']
  }
})
