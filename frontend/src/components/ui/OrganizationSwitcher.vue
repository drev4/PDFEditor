<template>
  <!--
    Nothing at all for an account with one organization, which is almost every
    account. A switcher with a single entry is furniture: it implies a choice
    that does not exist and takes the eye at the top of the sidebar.
  -->
  <div v-if="store.hasMultipleOrganizations" class="relative px-3 pb-3" data-testid="org-switcher">
    <button
      type="button"
      class="flex items-center gap-2 w-full h-nav px-2.5 rounded-input text-row text-left transition-colors hover:bg-surface-sunken"
      :class="open ? 'bg-surface-sunken' : ''"
      data-testid="org-switcher-button"
      :aria-expanded="open"
      @click="open = !open"
    >
      <span
        class="flex items-center justify-center w-5 h-5 rounded-input bg-accent-soft text-accent text-tiny font-semibold flex-shrink-0"
      >
        {{ initials }}
      </span>
      <span class="flex-grow min-w-0 truncate font-medium">
        {{ store.activeOrganization?.name ?? 'Organization' }}
      </span>
      <i class="pi pi-angle-down text-faint text-[12px] flex-shrink-0" />
    </button>

    <ul
      v-if="open"
      class="absolute left-3 right-3 mt-1 py-1 rounded-card border border-line bg-surface shadow-menu z-20"
      data-testid="org-switcher-menu"
    >
      <li v-for="organization in store.organizations" :key="organization.id">
        <button
          type="button"
          class="flex items-center gap-2 w-full px-2.5 py-2 text-left text-row transition-colors hover:bg-surface-sunken"
          :class="organization.id === store.activeOrganizationId ? 'text-accent-pressed font-medium' : 'text-ink'"
          :data-testid="`org-option-${organization.id}`"
          @click="choose(organization.id)"
        >
          <span class="flex-grow min-w-0 truncate">{{ organization.name }}</span>
          <span class="text-meta text-faint capitalize flex-shrink-0">{{ organization.role }}</span>
          <i
            v-if="organization.id === store.activeOrganizationId"
            class="pi pi-check text-accent text-[11px] flex-shrink-0"
          />
        </button>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useOrganizationStore } from '@/stores/organization.store'
import { usePlanStore } from '@/stores/plan.store'
import { useFormsStore } from '@/stores/forms.store'

/**
 * The organization switcher the canvas draws at the top of the sidebar
 * ([`features/0023`](../../../../features/0023-active-organization.md)).
 *
 * The switch is a **server-side, per-account** change: everything the API
 * answers afterwards is about a different tenant, on this device and on any
 * other. So this does not merely re-render — it reloads the things on screen
 * that are now about somebody else's organization. Leaving the forms list and
 * the plan meter showing the previous tenant's numbers under a new name is worse
 * than a moment of loading.
 */
const store = useOrganizationStore()
const planStore = usePlanStore()
const formsStore = useFormsStore()

const open = ref(false)

const initials = computed(() => {
  const source = store.activeOrganization?.name ?? ''
  const parts = source.split(/[\s-]+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase()
})

async function choose(organizationId: string) {
  open.value = false
  if (organizationId === store.activeOrganizationId) return

  await store.setActiveOrganization(organizationId)
  // Both are per organization: the plan card and every count in it, and the
  // forms list, which is now a different tenant's.
  await Promise.all([planStore.load().catch(() => {}), formsStore.fetchForms().catch(() => {})])
}
</script>
