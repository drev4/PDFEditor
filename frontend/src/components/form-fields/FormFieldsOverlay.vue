<template>
  <div
    class="form-fields-overlay"
    :class="{ 'adding-mode': formFieldsStore.isAddingField }"
    @click="handleOverlayClick"
    @mousemove="handleMouseMove"
  >
    <!-- Existing Fields -->
    <FormFieldItem
      v-for="field in currentPageFields"
      :key="field.id"
      :field="field"
    />

    <!-- Preview when adding new field -->
    <div
      v-if="formFieldsStore.isAddingField && previewPosition"
      class="field-preview"
      :class="`preview-${formFieldsStore.fieldTypeToAdd}`"
      :style="{
        left: `${previewPosition.x}px`,
        top: `${previewPosition.y}px`,
        width: `${defaultFieldSize.width}px`,
        height: `${defaultFieldSize.height}px`
      }"
    >
      <i :class="getFieldIcon(formFieldsStore.fieldTypeToAdd!)"></i>
      <span>Click para colocar</span>
    </div>

    <!-- Adding mode indicator -->
    <div v-if="formFieldsStore.isAddingField" class="adding-indicator">
      <span>Agregando: {{ getFieldTypeLabel(formFieldsStore.fieldTypeToAdd!) }}</span>
      <button @click.stop="formFieldsStore.cancelAddingField()">
        <i class="pi pi-times"></i>
        Cancelar
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useFormFieldsStore, type FieldType } from '@/stores/formFields.store'
import { useDocumentStore } from '@/stores/document.store'
import { useFormManagement } from '@/composables/useFormManagement'
import { useToast } from 'primevue/usetoast'
import FormFieldItem from './FormFieldItem.vue'

const props = defineProps<{
  canvasWidth: number
  canvasHeight: number
}>()

const formFieldsStore = useFormFieldsStore()
const documentStore = useDocumentStore()
const { autoInitializeForm } = useFormManagement()
const toast = useToast()

const previewPosition = ref<{ x: number; y: number } | null>(null)

const currentPage = computed(() => documentStore.activeDocument?.currentPage || 1)

const currentPageFields = computed(() => {
  return formFieldsStore.getFieldsForPage(currentPage.value)
})

const defaultFieldSize = computed(() => {
  const type = formFieldsStore.fieldTypeToAdd
  switch (type) {
    case 'text':
      return { width: 200, height: 30 }
    case 'textarea':
      return { width: 250, height: 80 }
    case 'checkbox':
      return { width: 20, height: 20 }
    case 'radio':
      return { width: 20, height: 20 }
    case 'dropdown':
      return { width: 200, height: 30 }
    default:
      return { width: 150, height: 30 }
  }
})

const getFieldIcon = (type: FieldType) => {
  const icons: Record<FieldType, string> = {
    text: 'pi pi-pencil',
    textarea: 'pi pi-align-left',
    checkbox: 'pi pi-check-square',
    radio: 'pi pi-circle',
    dropdown: 'pi pi-chevron-down'
  }
  return icons[type]
}

const getFieldTypeLabel = (type: FieldType) => {
  const labels: Record<FieldType, string> = {
    text: 'Campo de texto',
    textarea: 'Área de texto',
    checkbox: 'Casilla',
    radio: 'Opción múltiple',
    dropdown: 'Lista desplegable'
  }
  return labels[type]
}

const handleMouseMove = (e: MouseEvent) => {
  if (!formFieldsStore.isAddingField) {
    previewPosition.value = null
    return
  }

  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const x = e.clientX - rect.left - defaultFieldSize.value.width / 2
  const y = e.clientY - rect.top - defaultFieldSize.value.height / 2

  // Keep within bounds
  previewPosition.value = {
    x: Math.max(0, Math.min(x, props.canvasWidth - defaultFieldSize.value.width)),
    y: Math.max(0, Math.min(y, props.canvasHeight - defaultFieldSize.value.height))
  }
}

const handleOverlayClick = async (e: MouseEvent) => {
  if (!formFieldsStore.isAddingField || !formFieldsStore.fieldTypeToAdd) {
    // If not adding, deselect current field
    formFieldsStore.selectField(null)
    return
  }

  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const x = e.clientX - rect.left - defaultFieldSize.value.width / 2
  const y = e.clientY - rect.top - defaultFieldSize.value.height / 2

  // Create the field
  const fieldType = formFieldsStore.fieldTypeToAdd

  // Generar nombre único para evitar duplicados con campos existentes
  const uniqueName = formFieldsStore.generateUniqueFieldName(fieldType)
  const fieldNumber = uniqueName.split('_')[1] || '1'

  const newField = formFieldsStore.addField({
    type: fieldType,
    name: uniqueName,
    label: `${getFieldTypeLabel(fieldType)} ${fieldNumber}`,
    required: false,
    border: true, // Por defecto, los campos tienen borde
    position: {
      x: Math.max(0, Math.min(x, props.canvasWidth - defaultFieldSize.value.width)),
      y: Math.max(0, Math.min(y, props.canvasHeight - defaultFieldSize.value.height)),
      width: defaultFieldSize.value.width,
      height: defaultFieldSize.value.height,
      page: currentPage.value
    },
    options: (fieldType === 'radio' || fieldType === 'dropdown') ? ['Opción 1', 'Opción 2'] : undefined
  })

  // Auto-initialize form if needed and save to server
  try {
    // Ensure we have a form to save to
    await autoInitializeForm()

    // Save the new field
    await formFieldsStore.saveField(newField.id)

    toast.add({
      severity: 'success',
      summary: 'Campo agregado',
      detail: `${getFieldTypeLabel(fieldType)} agregado exitosamente`,
      life: 2000
    })
  } catch (error) {
    console.error('Failed to save field:', error)

    toast.add({
      severity: 'error',
      summary: 'Error al agregar campo',
      detail: 'No se pudo guardar el campo. Intenta de nuevo.',
      life: 3000
    })
  }

  previewPosition.value = null
}
</script>

<style scoped>
.form-fields-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.form-fields-overlay.adding-mode {
  pointer-events: auto;
  cursor: crosshair;
}

.form-fields-overlay :deep(.form-field-item) {
  pointer-events: auto;
}

.field-preview {
  position: absolute;
  border: 2px dashed #3b82f6;
  background: rgba(59, 130, 246, 0.2);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 12px;
  color: #1e40af;
  pointer-events: none;
  opacity: 0.8;
}

.field-preview i {
  font-size: 14px;
}

.field-preview.preview-checkbox,
.field-preview.preview-radio {
  border-color: #10b981;
  background: rgba(16, 185, 129, 0.2);
  color: #065f46;
}

.field-preview.preview-dropdown {
  border-color: #f59e0b;
  background: rgba(245, 158, 11, 0.2);
  color: #92400e;
}

.adding-indicator {
  position: absolute;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  background: #1e40af;
  color: white;
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  pointer-events: auto;
}

.adding-indicator button {
  background: rgba(255, 255, 255, 0.2);
  border: none;
  padding: 4px 8px;
  border-radius: 4px;
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
}

.adding-indicator button:hover {
  background: rgba(255, 255, 255, 0.3);
}
</style>
