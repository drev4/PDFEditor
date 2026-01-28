<template>
  <div class="field-properties-panel" v-if="formFieldsStore.selectedField">
    <div class="panel-header">
      <div>
        <h3>Propiedades del Campo</h3>
        <!-- Save Status Indicator -->
        <div class="save-status" v-if="saveStatus !== 'idle'">
          <i v-if="saveStatus === 'saving'" class="pi pi-spin pi-spinner"></i>
          <i v-else-if="saveStatus === 'saved'" class="pi pi-check"></i>
          <i v-else-if="saveStatus === 'error'" class="pi pi-exclamation-triangle"></i>
          <span>{{ saveStatusText }}</span>
        </div>
      </div>
      <button class="close-btn" @click="formFieldsStore.selectField(null)">
        <i class="pi pi-times"></i>
      </button>
    </div>

    <div class="panel-content">
      <!-- Field Type (read-only) -->
      <div class="form-group">
        <label>Tipo</label>
        <div class="field-type-badge" :class="`type-${formFieldsStore.selectedField.type}`">
          <i :class="getFieldIcon(formFieldsStore.selectedField.type)"></i>
          {{ getFieldTypeLabel(formFieldsStore.selectedField.type) }}
        </div>
      </div>

      <!-- Name -->
      <div class="form-group">
        <label for="field-name">Nombre (ID)</label>
        <input
          id="field-name"
          type="text"
          v-model="fieldName"
          placeholder="nombre_campo"
          @input="updateField"
        />
        <small>Identificador único del campo</small>
      </div>

      <!-- Label -->
      <div class="form-group">
        <label for="field-label">Etiqueta</label>
        <input
          id="field-label"
          type="text"
          v-model="fieldLabel"
          placeholder="Etiqueta visible"
          @input="updateField"
        />
      </div>

      <!-- Required -->
      <div class="form-group checkbox-group">
        <label>
          <input
            type="checkbox"
            v-model="fieldRequired"
            @change="updateField"
          />
          Campo obligatorio
        </label>
      </div>

      <!-- Border -->
      <div class="form-group checkbox-group">
        <label>
          <input
            type="checkbox"
            v-model="fieldBorder"
            @change="updateField"
          />
          Mostrar borde
        </label>
      </div>

      <!-- Options (for radio/dropdown) -->
      <div class="form-group" v-if="hasOptions">
        <label>Opciones</label>
        <div class="options-list">
          <div
            v-for="(option, index) in fieldOptions"
            :key="index"
            class="option-item"
          >
            <input
              type="text"
              v-model="fieldOptions[index]"
              @input="updateField"
              placeholder="Opción"
            />
            <button class="remove-option-btn" @click="removeOption(index)">
              <i class="pi pi-times"></i>
            </button>
          </div>
        </div>
        <button class="add-option-btn" @click="addOption">
          <i class="pi pi-plus"></i>
          Agregar opción
        </button>
      </div>

      <!-- Position (read-only info) -->
      <div class="form-group position-info">
        <label>Posición</label>
        <div class="position-grid">
          <span>X: {{ Math.round(formFieldsStore.selectedField.position.x) }}</span>
          <span>Y: {{ Math.round(formFieldsStore.selectedField.position.y) }}</span>
          <span>Ancho: {{ Math.round(formFieldsStore.selectedField.position.width) }}</span>
          <span>Alto: {{ Math.round(formFieldsStore.selectedField.position.height) }}</span>
        </div>
      </div>

      <!-- Delete Button -->
      <div class="form-group">
        <button class="delete-btn" @click="deleteField">
          <i class="pi pi-trash"></i>
          Eliminar campo
        </button>
      </div>
    </div>
  </div>

  <!-- Empty State / Export Panel -->
  <div class="field-properties-panel" v-else>
    <div class="panel-header">
      <h3>Campos de Formulario</h3>
    </div>

    <div class="panel-content">
      <!-- Fields Summary -->
      <div class="form-group">
        <label>Resumen</label>
        <div class="fields-summary">
          <span>{{ formFieldsStore.fields.length }} campo(s) agregado(s)</span>
        </div>
      </div>

      <!-- Empty hint -->
      <div class="empty-hint" v-if="formFieldsStore.fields.length === 0">
        <i class="pi pi-info-circle"></i>
        <p>Usa la barra de herramientas para agregar campos al formulario</p>
      </div>

      <!-- Fields list -->
      <div class="form-group" v-if="formFieldsStore.fields.length > 0">
        <label>Campos</label>
        <div class="fields-list">
          <div
            v-for="field in formFieldsStore.fields"
            :key="field.id"
            class="field-list-item"
            @click="formFieldsStore.selectField(field.id)"
          >
            <i :class="getFieldIcon(field.type)"></i>
            <span>{{ field.label || field.name }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useFormFieldsStore, type FieldType } from '@/stores/formFields.store'
import { useToast } from 'primevue/usetoast'

const formFieldsStore = useFormFieldsStore()
const toast = useToast()

// Local form state
const fieldName = ref('')
const fieldLabel = ref('')
const fieldRequired = ref(false)
const fieldBorder = ref(true)
const fieldOptions = ref<string[]>([])

// Save status tracking
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'
const saveStatus = ref<SaveStatus>('idle')
let statusTimeout: ReturnType<typeof setTimeout> | null = null

const saveStatusText = computed(() => {
  switch (saveStatus.value) {
    case 'saving': return 'Guardando...'
    case 'saved': return 'Guardado'
    case 'error': return 'Error al guardar'
    default: return ''
  }
})

// Debounce timer for auto-save
let saveTimeout: ReturnType<typeof setTimeout> | null = null

// Watch for selected field changes
watch(() => formFieldsStore.selectedField, (field) => {
  // Cancel pending save when switching fields
  if (saveTimeout) {
    clearTimeout(saveTimeout)
    saveTimeout = null
  }

  if (field) {
    fieldName.value = field.name
    fieldLabel.value = field.label
    fieldRequired.value = field.required
    fieldBorder.value = field.border
    fieldOptions.value = field.options ? [...field.options] : []
  }
}, { immediate: true })

const hasOptions = computed(() => {
  const type = formFieldsStore.selectedField?.type
  return type === 'radio' || type === 'dropdown'
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
    text: 'Texto',
    textarea: 'Área de texto',
    checkbox: 'Casilla',
    radio: 'Opción múltiple',
    dropdown: 'Lista desplegable'
  }
  return labels[type]
}

const updateField = () => {
  if (!formFieldsStore.selectedField) return

  const fieldId = formFieldsStore.selectedField.id

  // Update local state immediately for responsive UI
  formFieldsStore.updateField(fieldId, {
    name: fieldName.value,
    label: fieldLabel.value,
    required: fieldRequired.value,
    border: fieldBorder.value,
    options: hasOptions.value ? fieldOptions.value.filter(o => o.trim()) : undefined
  })

  // Clear previous status timeout
  if (statusTimeout) {
    clearTimeout(statusTimeout)
    statusTimeout = null
  }

  // Show saving status immediately
  saveStatus.value = 'saving'

  // Debounce server save (wait 1 second after last change)
  if (saveTimeout) {
    clearTimeout(saveTimeout)
  }

  saveTimeout = setTimeout(async () => {
    try {
      await formFieldsStore.saveField(fieldId)
      saveStatus.value = 'saved'

      // Hide "saved" message after 2 seconds
      statusTimeout = setTimeout(() => {
        saveStatus.value = 'idle'
      }, 2000)
    } catch (error) {
      console.error('Failed to save field:', error)
      saveStatus.value = 'error'

      toast.add({
        severity: 'error',
        summary: 'Error al guardar',
        detail: 'No se pudo guardar el campo. Intenta de nuevo.',
        life: 3000
      })

      // Hide error status after 3 seconds
      statusTimeout = setTimeout(() => {
        saveStatus.value = 'idle'
      }, 3000)
    }
  }, 1000)
}

const addOption = () => {
  fieldOptions.value.push('')
  updateField()
}

const removeOption = (index: number) => {
  fieldOptions.value.splice(index, 1)
  updateField()
}

const deleteField = async () => {
  if (!formFieldsStore.selectedField) return

  // Confirm deletion
  const fieldName = formFieldsStore.selectedField.label || formFieldsStore.selectedField.name
  if (!confirm(`¿Eliminar el campo "${fieldName}"?`)) {
    return
  }

  try {
    await formFieldsStore.deleteFieldFromServer(formFieldsStore.selectedField.id)

    toast.add({
      severity: 'success',
      summary: 'Campo eliminado',
      detail: `El campo "${fieldName}" ha sido eliminado`,
      life: 3000
    })
  } catch (error) {
    console.error('Failed to delete field:', error)

    toast.add({
      severity: 'error',
      summary: 'Error al eliminar',
      detail: 'No se pudo eliminar el campo. Intenta de nuevo.',
      life: 3000
    })
  }
}
</script>

<style scoped>
.field-properties-panel {
  width: 280px;
  background: white;
  border-left: 1px solid #e5e7eb;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid #e5e7eb;
  background: #f9fafb;
}

.panel-header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #374151;
}

.save-status {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  font-size: 11px;
  color: #6b7280;
}

.save-status i {
  font-size: 10px;
}

.save-status i.pi-check {
  color: #10b981;
}

.save-status i.pi-exclamation-triangle {
  color: #ef4444;
}

.save-status i.pi-spinner {
  color: #3b82f6;
}

.close-btn {
  background: none;
  border: none;
  padding: 4px;
  cursor: pointer;
  color: #6b7280;
  border-radius: 4px;
}

.close-btn:hover {
  background: #e5e7eb;
  color: #374151;
}

.panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  font-size: 12px;
  font-weight: 500;
  color: #374151;
  margin-bottom: 6px;
}

.form-group input[type="text"] {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
}

.form-group input[type="text"]:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.form-group small {
  display: block;
  margin-top: 4px;
  font-size: 11px;
  color: #6b7280;
}

.checkbox-group label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 14px;
}

.checkbox-group input[type="checkbox"] {
  width: 16px;
  height: 16px;
  cursor: pointer;
}

.field-type-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
}

.field-type-badge.type-text {
  background: #dbeafe;
  color: #1e40af;
}

.field-type-badge.type-textarea {
  background: #dbeafe;
  color: #1e40af;
}

.field-type-badge.type-checkbox {
  background: #d1fae5;
  color: #065f46;
}

.field-type-badge.type-radio {
  background: #ede9fe;
  color: #5b21b6;
}

.field-type-badge.type-dropdown {
  background: #fef3c7;
  color: #92400e;
}

.options-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 8px;
}

.option-item {
  display: flex;
  gap: 8px;
}

.option-item input {
  flex: 1;
}

.remove-option-btn {
  padding: 8px;
  background: none;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  cursor: pointer;
  color: #6b7280;
}

.remove-option-btn:hover {
  background: #fee2e2;
  border-color: #fecaca;
  color: #dc2626;
}

.add-option-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: #f3f4f6;
  border: 1px dashed #d1d5db;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  color: #4b5563;
  width: 100%;
  justify-content: center;
}

.add-option-btn:hover {
  background: #e5e7eb;
  border-color: #9ca3af;
}

.position-info .position-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  font-size: 12px;
  color: #6b7280;
  background: #f3f4f6;
  padding: 8px;
  border-radius: 6px;
}

.delete-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding: 10px;
  background: #fee2e2;
  border: 1px solid #fecaca;
  border-radius: 6px;
  color: #dc2626;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}

.delete-btn:hover {
  background: #fecaca;
}

/* Empty State */
.field-properties-panel.empty {
  justify-content: center;
  align-items: center;
}

.empty-state {
  text-align: center;
  padding: 24px;
  color: #6b7280;
}

.empty-state i {
  font-size: 32px;
  margin-bottom: 12px;
  opacity: 0.5;
}

.empty-state p {
  font-size: 13px;
  margin: 0;
}

/* Export Button */
.export-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding: 12px;
  background: #2563eb;
  border: none;
  border-radius: 6px;
  color: white;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s;
}

.export-btn:hover {
  background: #1d4ed8;
}

/* Fields Summary */
.fields-summary {
  background: #f3f4f6;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  color: #4b5563;
}

/* Empty Hint */
.empty-hint {
  text-align: center;
  padding: 16px;
  color: #6b7280;
}

.empty-hint i {
  font-size: 24px;
  margin-bottom: 8px;
  display: block;
  opacity: 0.5;
}

.empty-hint p {
  font-size: 12px;
  margin: 0;
}

/* Fields List */
.fields-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field-list-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s;
}

.field-list-item:hover {
  background: #f3f4f6;
  border-color: #d1d5db;
}

.field-list-item i {
  color: #6b7280;
}
</style>
