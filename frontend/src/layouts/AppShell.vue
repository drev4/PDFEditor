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

      <!-- The plan card the canvas puts above the account row. It draws itself
           only once the plan has loaded; see PlanCard.vue. -->
      <PlanCard />

      <!-- Account. -->
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
import { computed, onMounted } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import Toast from 'primevue/toast'
import { useToast } from 'primevue/usetoast'
import { useAuthStore } from '@/stores/auth.store'
import { usePlanStore } from '@/stores/plan.store'
import BrandMark from '@/components/ui/BrandMark.vue'
import PlanCard from '@/components/plan/PlanCard.vue'
import { useAppNav } from '@/composables/useAppNav'

const authStore = useAuthStore()
const planStore = usePlanStore()
const router = useRouter()
const toast = useToast()

// The shell wraps every signed-in screen, so this is the one place the plan has
// to be fetched. A failure is silent on purpose: the card simply does not draw,
// and an error toast about the plan on a screen the user opened to do something
// else is noise they cannot act on.
onMounted(() => {
  if (!planStore.plan) planStore.load().catch(() => {})
})

const { navItems, isActive } = useAppNav()

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
