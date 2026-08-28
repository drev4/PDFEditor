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
      <p class="text-sm text-gray-500 mb-6">
        Please review your answers below before submitting. You won't be able to change them after submission.
      </p>

      <div class="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
        <div v-for="field in fields" :key="field.id" class="field-preview-item pb-3 border-b border-gray-100 last:border-b-0">
          <h4 class="text-sm font-semibold text-gray-700 mb-1 flex items-center">
            {{ field.label }}
            <span v-if="field.required" class="text-red-500 ml-1 italic font-normal text-xs">(Required)</span>
          </h4>
          
          <div class="answer-box">
            <template v-if="hasAnswer(field.id)">
              <div v-if="field.type === 'checkbox'" class="flex items-center text-blue-700">
                <i class="pi pi-check-circle mr-2 text-green-500"></i>
                <span>Checked / Yes</span>
              </div>
              
              <div v-else-if="field.type === 'radio' || field.type === 'dropdown'" class="text-gray-900 bg-gray-50 px-3 py-2 rounded border border-gray-200">
                {{ answers[field.id] }}
              </div>
              
              <div v-else-if="field.type === 'textarea'" class="text-gray-900 bg-gray-50 px-3 py-2 rounded border border-gray-200 whitespace-pre-wrap">
                {{ answers[field.id] }}
              </div>
              
              <div v-else class="text-gray-900 bg-gray-50 px-3 py-2 rounded border border-gray-200">
                {{ answers[field.id] }}
              </div>
            </template>
            
            <template v-else>
              <div class="text-gray-400 italic bg-gray-50 px-3 py-2 rounded border border-gray-200">
                Not answered
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="flex justify-end gap-3 pt-4 border-t border-gray-100">
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
import type { Field } from '@/services/forms'

const props = defineProps<{
  visible: boolean
  fields: Field[]
  answers: Record<string, any>
  isSubmitting?: boolean
}>()

defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'confirm'): void
}>()

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
  border-bottom: 1px solid #f3f4f6;
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
  background-color: #f9fafb;
}
</style>
