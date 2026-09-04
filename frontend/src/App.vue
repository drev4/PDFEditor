<template>
  <RouterView v-slot="{ Component }">
    <transition name="page" mode="out-in">
      <component :is="Component" />
    </transition>
  </RouterView>
  <!-- Global feedback surfaces: PrimeVue broadcasts every event to every
       mounted instance, so these must exist exactly once. -->
  <Toast position="top-right" />
  <ConfirmDialog />
</template>

<script setup lang="ts">
import { RouterView } from 'vue-router'
import { onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth.store'
import Toast from 'primevue/toast'
import ConfirmDialog from 'primevue/confirmdialog'

const authStore = useAuthStore()

// Recover the session on a cold load. The router guard does this too and the
// store deduplicates, so this only matters for the first paint.
//
// What was here before could never run: it was guarded on
// `isAuthenticated && !user`, and `isAuthenticated` is defined as `!!user`.
onMounted(async () => {
  await authStore.bootstrap()
})
</script>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}
</style>
