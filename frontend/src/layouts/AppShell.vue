<template>
  <div class="flex h-screen bg-surface overflow-hidden">
    <!-- Sidebar. 232px, the width the canvas fixes. -->
    <aside
      class="hidden lg:flex flex-col w-sidebar flex-shrink-0 bg-surface-subtle border-r border-line"
      data-testid="app-sidebar"
    >
      <BrandMark class="px-[18px] pt-5 pb-4" />

      <nav class="flex flex-col gap-0.5 px-3">
        <RouterLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="flex items-center gap-2.5 h-nav px-2.5 rounded-input text-row transition-colors"
          :class="isActive(item)
            ? 'bg-accent-soft text-accent-pressed font-medium'
            : 'text-muted hover:bg-surface-sunken'"
        >
          <i :class="item.icon" class="text-[15px]" />
          <span>{{ item.label }}</span>
        </RouterLink>
      </nav>

      <div class="flex-grow" />

      <!-- Account. The canvas also puts a plan card above this; there are no
           plans yet, so nothing is drawn rather than a number being invented. -->
      <div class="flex items-center gap-2.5 px-[18px] pb-[18px] pt-2.5">
        <div
          class="flex items-center justify-center w-6 h-6 rounded-full bg-surface-track text-muted text-tiny font-semibold flex-shrink-0"
        >
          {{ initials }}
        </div>
        <div class="flex-grow min-w-0 text-meta text-muted truncate" :title="email">
          {{ email }}
        </div>
        <button
          type="button"
          class="flex items-center justify-center w-6 h-6 rounded-input text-faint hover:text-ink hover:bg-surface-sunken transition-colors flex-shrink-0"
          data-testid="logout-button"
          aria-label="Log out"
          @click="handleLogout"
        >
          <i class="pi pi-sign-out text-[13px]" />
        </button>
      </div>
    </aside>

    <!-- Mobile top bar. The sidebar collapses below lg. -->
    <div class="flex flex-col flex-grow min-w-0">
      <div
        class="lg:hidden flex items-center gap-3 h-14 flex-shrink-0 px-4 border-b border-line bg-surface"
      >
        <BrandMark />
        <div class="flex-grow" />
        <RouterLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="flex items-center justify-center w-touch h-touch rounded-input"
          :class="isActive(item) ? 'text-accent' : 'text-muted'"
          :aria-label="item.label"
        >
          <i :class="item.icon" />
        </RouterLink>
        <button
          type="button"
          class="flex items-center justify-center w-touch h-touch rounded-input text-muted"
          aria-label="Log out"
          @click="handleLogout"
        >
          <i class="pi pi-sign-out" />
        </button>
      </div>

      <main class="flex flex-col flex-grow min-w-0 overflow-hidden">
        <slot />
      </main>
    </div>

    <Toast position="top-right" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import Toast from 'primevue/toast'
import { useToast } from 'primevue/usetoast'
import { useAuthStore } from '@/stores/auth.store'
import BrandMark from '@/components/ui/BrandMark.vue'

const authStore = useAuthStore()
const route = useRoute()
const router = useRouter()
const toast = useToast()

/**
 * The four destinations the canvas draws, in its order.
 *
 * `Responses` and `Settings` lead to screens that say what is not built rather
 * than to nothing — the navigation is the shape of the product, and leaving
 * holes in it makes the app harder to read than admitting the gap. Neither
 * renders invented data; see NotBuiltYet.vue.
 *
 * The editor is deliberately absent: it is where a form opens, not a place you
 * navigate to on its own.
 */
const navItems = [
  { to: '/dashboard', label: 'Forms', icon: 'pi pi-file', match: '/dashboard' },
  { to: '/dashboard/responses', label: 'Responses', icon: 'pi pi-inbox', match: '/dashboard/responses' },
  { to: '/dashboard/team', label: 'Members', icon: 'pi pi-users', match: '/dashboard/team' },
  { to: '/dashboard/settings', label: 'Settings', icon: 'pi pi-cog', match: '/dashboard/settings' },
]

// `Forms` owns both /dashboard and /dashboard/forms, and must not also light up
// for every other screen underneath /dashboard.
const isActive = (item: { match: string }) =>
  item.match === '/dashboard'
    ? route.path === '/dashboard' || route.path.startsWith('/dashboard/forms')
    : route.path.startsWith(item.match)

const email = computed(() => authStore.user?.email ?? '')

const initials = computed(() => {
  const source = authStore.user?.name || authStore.user?.email || ''
  const parts = source.split(/[\s@.]+/).filter(Boolean)
  return (parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')
})

const handleLogout = async () => {
  await authStore.logout()
  toast.add({
    severity: 'info',
    summary: 'Logged out',
    detail: 'You have been logged out successfully',
    life: 3000,
  })
  router.push('/login')
}
</script>
