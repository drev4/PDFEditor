import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { authService, type User } from '../services/auth'
import { ApiError } from '../services/api'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const isAuthenticated = computed(() => !!user.value)

  async function register(email: string, password: string, name?: string) {
    loading.value = true
    error.value = null
    try {
      const response = await authService.register(email, password, name)
      user.value = response.user
      return response
    } catch (e) {
      if (e instanceof ApiError) {
        error.value = e.message
      } else {
        error.value = 'Registration failed'
      }
      throw e
    } finally {
      loading.value = false
    }
  }

  async function login(email: string, password: string) {
    loading.value = true
    error.value = null
    try {
      const response = await authService.login(email, password)
      user.value = response.user
      return response
    } catch (e) {
      if (e instanceof ApiError) {
        error.value = e.message
      } else {
        error.value = 'Login failed'
      }
      throw e
    } finally {
      loading.value = false
    }
  }

  async function fetchUser() {
    if (!authService.isAuthenticated()) {
      return null
    }

    loading.value = true
    error.value = null
    try {
      user.value = await authService.me()
      return user.value
    } catch (e) {
      // Token inválido, limpiar
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
    paths: ['user']
  }
})
