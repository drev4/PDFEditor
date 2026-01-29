<template>
  <RouterView />
  <ConfirmDialog />
</template>

<script setup lang="ts">
import { RouterView } from 'vue-router'
import { onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth.store'
import ConfirmDialog from 'primevue/confirmdialog'

const authStore = useAuthStore()

// Intentar cargar usuario al iniciar la app si hay token
onMounted(async () => {
  if (authStore.isAuthenticated && !authStore.user) {
    try {
      await authStore.fetchUser()
    } catch (error) {
      // Token expirado o inválido, será manejado por el router guard
      console.error('Failed to fetch user on mount:', error)
    }
  }
})
</script>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: system-ui, -apple-system, sans-serif;
}
</style>
