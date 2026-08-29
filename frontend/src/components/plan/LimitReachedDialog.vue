<template>
  <Dialog
    :visible="visible"
    modal
    :closable="false"
    :draggable="false"
    :style="{ width: '440px' }"
    :pt="{ header: { class: 'hidden' } }"
    @update:visible="$emit('close')"
  >
    <div class="pt-1" data-testid="limit-reached">
      <div
        class="flex items-center justify-center w-8 h-8 rounded-input bg-limit-soft text-limit mb-3.5"
      >
        <i class="pi pi-lock text-[15px]" />
      </div>

      <h2 class="text-section">
        You've reached the form limit on {{ planStore.plan?.name ?? 'your plan' }}
      </h2>

      <p class="mt-2 text-body text-muted">
        {{ explanation }}
      </p>

      <div v-if="planStore.plan" class="grid grid-cols-2 gap-5 mt-5">
        <UsageMeter
          label="Published forms"
          :used="planStore.usage?.publishedForms ?? 0"
          :limit="planStore.plan.maxPublishedForms"
        />
        <UsageMeter
          label="Responses this month"
          :used="planStore.usage?.responsesThisPeriod ?? 0"
          :limit="planStore.plan.maxResponsesPerMonth"
        />
      </div>

      <!--
        The canvas puts an "Upgrade to Pro" card here with a price on it. Neither
        is built: there is no billing in this product (step 8 of the build
        order), and docs/BACKLOG.md records that the prices drawn on the canvas
        are not a decision anyone has taken. Naming the gap is the honest move —
        the same rule NotBuiltYet.vue exists for. An upgrade button that does
        nothing, or a price nobody agreed, would both be worse than this.
      -->
      <p class="mt-5 pt-4 border-t border-line text-meta text-faint">
        Paid plans are not available yet, so the way to publish this one is to
        unpublish another form.
      </p>
    </div>

    <template #footer>
      <div class="flex items-center justify-end gap-2">
        <Button label="Not now" text severity="secondary" @click="$emit('close')" />
        <Button label="Manage forms" @click="$emit('close')" />
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import { usePlanStore } from '@/stores/plan.store'
import UsageMeter from './UsageMeter.vue'

/**
 * The `LimitReached` artboard: what a `402` from publishing looks like.
 *
 * It exists because the alternative is a red toast saying "Failed to publish",
 * which tells someone that something broke rather than that they hit a limit
 * they can do something about. The canvas's own wording is kept — the form
 * "stays a draft until you free up a slot or upgrade" — because it says the one
 * thing that matters: nothing was lost.
 *
 * `message` is the server's, and it is preferred over anything assembled here.
 * The backend owns the limit; a second copy of the sentence in the frontend is
 * a second thing to keep in step.
 */
const props = defineProps<{
  visible: boolean
  /** The `402` message from the API. */
  message?: string | null
  /** The form that stayed a draft, named the way the canvas names it. */
  formTitle?: string | null
}>()

defineEmits<{ close: [] }>()

const planStore = usePlanStore()

const explanation = computed(() => {
  if (props.message) {
    return props.formTitle
      ? `${props.message} “${props.formTitle}” stays a draft until then.`
      : props.message
  }

  return props.formTitle
    ? `“${props.formTitle}” stays a draft until you free up a slot.`
    : 'This form stays a draft until you free up a slot.'
})
</script>
