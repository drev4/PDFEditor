<template>
  <Dialog
    :visible="visible"
    @update:visible="$emit('update:visible', $event)"
    modal
    header="Review Your Responses"
    class="submit-preview-modal p-fluid"
    :style="{ width: '50rem' }"
    :breakpoints="{ '1199px': '75vw', '575px': '90vw' }"
  >
    <div class="preview-content py-2">
      <p class="text-body text-muted mb-6">
        Please review your answers below before submitting. You won't be able to change them after submission.
      </p>

      <div class="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
        <div v-for="field in fields" :key="field.id" class="field-preview-item pb-3 border-b border-line last:border-b-0">
          <h4 class="text-body font-semibold text-ink mb-1 flex items-center">
            {{ field.label }}
            <span v-if="field.required" class="text-danger ml-1 italic font-normal text-meta">(Required)</span>
          </h4>
          
          <div class="answer-box">
            <template v-if="hasAnswer(field.id)">
              <div v-if="field.type === 'checkbox'" class="flex items-center text-accent">
                <i class="pi pi-check-circle mr-2 text-published"></i>
                <span>Checked / Yes</span>
              </div>
              
              <div v-else-if="field.type === 'radio' || field.type === 'dropdown'" class="text-ink bg-surface-subtle px-3 py-2 rounded border border-line">
                {{ answers[field.id] }}
              </div>
              
              <div v-else-if="field.type === 'textarea'" class="text-ink bg-surface-subtle px-3 py-2 rounded border border-line whitespace-pre-wrap">
                {{ answers[field.id] }}
              </div>
              
              <div v-else class="text-ink bg-surface-subtle px-3 py-2 rounded border border-line">
                {{ answers[field.id] }}
              </div>
            </template>
            
            <template v-else>
              <div class="text-faint italic bg-surface-subtle px-3 py-2 rounded border border-line">
                Not answered
              </div>
            </template>
          </div>
        </div>
      </div>

      <!-- The declared name (features/0054). Labelled as what it is: the name
           the respondent gives, which nobody checks. Held in the parent's
           state only, never in the saved draft. -->
      <div v-if="asksName" class="space-y-2 pt-5 mt-2 border-t border-line">
        <label for="respondent-name" class="block text-body font-medium text-ink">
          Your name
        </label>
        <InputText
          id="respondent-name"
          :model-value="respondentName"
          :invalid="!!shownNameError"
          :maxlength="RESPONDENT_NAME_MAX_LENGTH + 20"
          class="w-full"
          autocomplete="name"
          data-testid="respondent-name-input"
          @update:model-value="onNameInput"
          @blur="nameTouched = true"
        />
        <small v-if="shownNameError" class="text-danger" data-testid="respondent-name-error">
          {{ shownNameError }}
        </small>
        <small v-else class="text-meta text-muted">
          Sent with your answers as you type it. It is not verified.
        </small>
      </div>
    </div>

    <template #footer>
      <div class="flex justify-end gap-3 pt-4 border-t border-line">
        <Button 
          label="Back to Edit" 
          icon="pi pi-arrow-left" 
          text 
          class="p-button-secondary"
          @click="$emit('update:visible', false)" 
        />
        <Button 
          label="Confirm and Submit" 
          icon="pi pi-check" 
          severity="success" 
          class="px-6"
          :loading="isSubmitting"
          :disabled="asksName && !!clientNameError"
          data-testid="confirm-submit-button"
          @click="$emit('confirm')" 
        />
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import { computed, ref, watch } from 'vue'
import type { Field } from '@/services/forms'
import { RESPONDENT_NAME_MAX_LENGTH, respondentNameError } from '@/utils/respondentName'

const props = defineProps<{
  visible: boolean
  fields: Field[]
  answers: Record<string, any>
  isSubmitting?: boolean
  /** Whether the form asks for a declared name (features/0054). */
  asksName?: boolean
  respondentName?: string
  /** The server's verdict on the name, from a `400`. Wins over the local one. */
  nameError?: string | null
}>()

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'update:respondentName', value: string): void
  (e: 'confirm'): void
}>()

// The local check only speaks once the respondent has left the input, so an
// empty field does not open with an error; the confirm button is disabled
// either way.
const nameTouched = ref(false)
const clientNameError = computed(() => respondentNameError(props.respondentName ?? ''))
const shownNameError = computed(() =>
  props.nameError || (nameTouched.value ? clientNameError.value : null)
)

watch(() => props.visible, visible => {
  if (visible) nameTouched.value = false
})

function onNameInput(value: string | undefined) {
  emit('update:respondentName', value ?? '')
}

function hasAnswer(fieldId: string) {
  const val = props.answers[fieldId]
  if (val === null || val === undefined || val === '') return false
  if (typeof val === 'boolean') return val === true
  return true
}
</script>

<style scoped>
.submit-preview-modal :deep(.p-dialog-header) {
  padding-bottom: 1rem;
  border-bottom: 1px solid #f4f5f7;
}

.submit-preview-modal :deep(.p-dialog-content) {
  padding-top: 1.5rem;
}

.answer-box {
  min-height: 2.5rem;
  display: flex;
  align-items: center;
}

.field-preview-item:hover {
  background-color: #fbfbfc;
}
</style>
