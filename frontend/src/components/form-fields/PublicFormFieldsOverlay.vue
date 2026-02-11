<template>
  <div class="public-form-fields-overlay">
    <PublicFormFieldItem
      v-for="field in pageFields"
      :key="field.id"
      :field="field"
      :model-value="responsesStore.getResponse(field.id)"
      @update:model-value="updateResponse(field.id, $event)"
      :error-message="validationErrors?.[field.name]"
      :scale="scale"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useDocumentStore } from '@/stores/document.store'
import { usePublicResponsesStore } from '@/stores/publicResponses.store'
import type { Field } from '@/services/forms'
import PublicFormFieldItem from './PublicFormFieldItem.vue'

const props = defineProps<{
  fields: Field[]
  scale: number
  validationErrors?: Record<string, string>
}>()

const documentStore = useDocumentStore()
const responsesStore = usePublicResponsesStore()

const currentPage = computed(() => documentStore.activeDocument?.currentPage || 1)

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
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 10;
}
</style>
