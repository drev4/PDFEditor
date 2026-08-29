<template>
  <Dialog
    :visible="visible"
    modal
    :closable="false"
    :draggable="false"
    :style="{ width: '30rem' }"
    :breakpoints="{ '640px': '92vw' }"
    data-testid="unsaved-changes-dialog"
    @update:visible="$emit('cancel')"
  >
    <template #header>
      <span class="text-section">{{ title }}</span>
    </template>

    <p class="text-body text-muted">
      {{ message }}
    </p>

    <template #footer>
      <div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 w-full">
        <button
          type="button"
          class="h-control-sm px-3.5 rounded-control text-body font-medium text-muted hover:text-ink hover:bg-surface-sunken transition-colors"
          data-testid="unsaved-cancel"
          :disabled="saving"
          @click="$emit('cancel')"
        >
          Stay here
        </button>

        <button
          type="button"
          class="h-control-sm px-3.5 rounded-control border border-line-strong text-body font-medium text-ink hover:bg-surface-sunken transition-colors disabled:text-disabled"
          data-testid="unsaved-discard"
          :disabled="saving"
          @click="$emit('discard')"
        >
          Leave without saving
        </button>

        <!-- The accent action is the one that keeps the user's work. -->
        <button
          type="button"
          class="flex items-center justify-center gap-2 h-control-sm px-3.5 rounded-control bg-accent hover:bg-accent-pressed disabled:bg-surface-control disabled:text-disabled text-white text-body font-medium transition-colors"
          data-testid="unsaved-save"
          :disabled="saving"
          @click="$emit('save')"
        >
          <i v-if="saving" class="pi pi-spin pi-spinner text-[12px]" />
          <span>{{ saving ? 'Saving' : 'Save and leave' }}</span>
        </button>
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import Dialog from 'primevue/dialog'

/**
 * The "you have unsaved work" prompt.
 *
 * It exists because this was a `window.confirm`, which is the browser's dialog
 * rather than the product's, and — more to the point — it only ever offered two
 * answers: lose the work, or stay. The third is the one people actually want,
 * so `Save and leave` is the accent action here.
 *
 * `closable` is off deliberately. An X in the corner is a fourth answer with no
 * stated meaning, and the safe reading of it (cancel) is not what a user
 * dismissing a dialog expects.
 */
defineProps<{
  visible: boolean
  title: string
  message: string
  saving?: boolean
}>()

defineEmits<{
  (e: 'save'): void
  (e: 'discard'): void
  (e: 'cancel'): void
}>()
</script>
