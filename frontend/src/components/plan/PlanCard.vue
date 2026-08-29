<template>
  <RouterLink
    v-if="planStore.plan"
    to="/dashboard/settings"
    class="block mx-3 mb-2 p-3 rounded-card border border-line hover:bg-surface-sunken transition-colors"
    data-testid="plan-card"
  >
    <div class="flex items-baseline justify-between gap-2 mb-2.5">
      <span class="text-row font-medium">{{ planStore.plan.name }}</span>
      <span class="text-micro text-faint">Plan</span>
    </div>

    <UsageMeter
      label="Responses"
      :used="planStore.usage?.responsesThisPeriod ?? 0"
      :limit="planStore.plan.maxResponsesPerMonth"
    />
  </RouterLink>
</template>

<script setup lang="ts">
/**
 * The sidebar plan card from the canvas, above the account row.
 *
 * It renders **nothing** until the plan has loaded. A card with placeholder
 * numbers in it is the failure this codebase already has a component about
 * (`NotBuiltYet.vue`): an invented usage figure is the one someone checks
 * before deciding whether they can publish.
 *
 * One meter, not three. The sidebar is 232px wide and the responses allowance
 * is the number that runs out; the other two live on the plan screen this card
 * links to.
 */
import { RouterLink } from 'vue-router'
import { usePlanStore } from '@/stores/plan.store'
import UsageMeter from './UsageMeter.vue'

const planStore = usePlanStore()
</script>
