import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { authService, type User } from '../services/auth'
import { useAsyncAction } from '../composables/useAsyncAction'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const isAuthenticated = computed(() => !!user.value)

  async function register(email: string, password: string, name?: string) {
    return useAsyncAction({ loading, error }, async () => {
      const response = await authService.register(email, password, name)
      user.value = response.user
      return response
    }, { fallbackMessage: 'Registration failed' })
  }

  async function login(email: string, password: string) {
    return useAsyncAction({ loading, error }, async () => {
      const response = await authService.login(email, password)
      user.value = response.user
      return response
    }, { fallbackMessage: 'Login failed' })
  }

  async function fetchUser() {
    if (!authService.isAuthenticated()) {
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

  function logout() {
    authService.logout()
    user.value = null
  }

  return {
    user,
    loading,
    error,
    isAuthenticated,
    register,
    login,
    logout,
    fetchUser
  }
}, {
  persist: {
    key: 'vuepdf-auth',
    storage: localStorage,
    pick: ['user']
  }
})
