<template>
  <!-- Same transform as the editor overlay, for the same reason: the canvas is
       drawn smaller than its pixels, and on a phone it is drawn much smaller.
       See FormFieldsOverlay.vue. -->
  <div class="public-form-fields-overlay" :style="overlayStyle">
    <PublicFormFieldItem
      v-for="field in pageFields"
      :key="field.id"
      :field="field"
      :model-value="responsesStore.getResponse(field.id)"
      @update:model-value="updateResponse(field.id, $event)"
      :error-message="validationErrors?.[field.name]"
      :scale="scale"
      :rotation="rotation"
      :page-width="pageSize.pageWidth"
      :page-height="pageSize.pageHeight"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useDocumentStore } from '@/stores/document.store'
import { usePublicResponsesStore } from '@/stores/publicResponses.store'
import type { Field } from '@/services/forms'
import { unrotatedPageSize } from '@/utils/pdfCoordinates'
import PublicFormFieldItem from './PublicFormFieldItem.vue'

const props = defineProps<{
  fields: Field[]
  scale: number
  canvasWidth?: number
  canvasHeight?: number
  displayScale?: number
  validationErrors?: Record<string, string>
}>()

const documentStore = useDocumentStore()
const responsesStore = usePublicResponsesStore()

const currentPage = computed(() => documentStore.activeDocument?.currentPage || 1)

// A respondent can turn the page too, and the field has to follow the document
// when they do — see rotateFieldRect in utils/pdfCoordinates.ts.
const rotation = computed(() => documentStore.activeDocument?.rotation || 0)

const pageSize = computed(() =>
  unrotatedPageSize(props.canvasWidth || 0, props.canvasHeight || 0, rotation.value, props.scale / 1.5)
)

const overlayStyle = computed(() => ({
  width: `${props.canvasWidth || 0}px`,
  height: `${props.canvasHeight || 0}px`,
  transform: `scale(${props.displayScale ?? 1})`,
  transformOrigin: 'top left'
}))

const pageFields = computed(() => {
  return props.fields.filter(field => (field.position?.page || 1) === currentPage.value)
})

const emit = defineEmits<{
  (e: 'field-change', payload: { fieldId: string, value: any }): void
}>()

const updateResponse = (fieldId: string, value: any) => {
  emit('field-change', { fieldId, value })
}
</script>

<style scoped>
.public-form-fields-overlay {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  z-index: 10;
}
</style>
