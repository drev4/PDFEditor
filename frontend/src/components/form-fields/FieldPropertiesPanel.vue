<template>
  <div class="field-properties-panel font-sans" v-if="formFieldsStore.selectedField">
    <div class="panel-header bg-surface border-b border-line px-4 h-11 flex items-center">
      <div class="flex flex-col gap-1">
        <h3 class="text-meta font-semibold text-faint uppercase tracking-widest">Field Settings</h3>
        <!-- Save Status Indicator -->
        <div class="save-status flex items-center gap-2" v-if="saveStatus !== 'idle'">
          <i v-if="saveStatus === 'saving'" class="pi pi-spin pi-spinner text-accent text-[10px]"></i>
          <i v-else-if="saveStatus === 'saved'" class="pi pi-check text-published text-[10px]"></i>
          <i v-else-if="saveStatus === 'error'" class="pi pi-exclamation-triangle text-danger text-[10px]"></i>
          <span class="text-[10px] font-bold uppercase tracking-tight text-muted">{{ saveStatusText }}</span>
        </div>
      </div>
      <button class="close-btn p-2 hover:bg-surface-sunken rounded-xl transition-colors text-faint" @click="formFieldsStore.selectField(null)">
        <i class="pi pi-times text-meta"></i>
      </button>
    </div>

    <div class="panel-content p-6 space-y-8">
      <!-- Field Type Indicator -->
      <div class="form-group">
        <label class="text-[10px] font-semibold text-faint uppercase tracking-widest mb-3 block">Component Type</label>
        <div class="field-type-badge flex items-center gap-3 px-4 py-3 rounded-2xl border transition-all shadow-sm" :class="getTypeBadgeClass(formFieldsStore.selectedField.type)">
          <i :class="getFieldIcon(formFieldsStore.selectedField.type)" class="text-section"></i>
          <span class="text-body font-semibold">{{ getFieldTypeLabel(formFieldsStore.selectedField.type) }}</span>
        </div>
      </div>

      <!-- General Settings Section -->
      <div class="space-y-6 pt-2">
        <div class="form-group">
          <label for="field-name" class="text-[10px] font-semibold text-faint uppercase tracking-widest mb-2 block">System Identifier (ID)</label>
          <input
            id="field-name"
            type="text"
            v-model="fieldName"
            placeholder="Field ID..."
            class="w-full bg-surface-subtle border border-line-strong rounded-xl px-4 py-2.5 text-body font-medium focus:border-accent focus:shadow-focus outline-none transition-all"
            @input="updateField"
          />
        </div>

        <div class="form-group">
          <label for="field-label" class="text-[10px] font-semibold text-faint uppercase tracking-widest mb-2 block">Public Label</label>
          <input
            id="field-label"
            type="text"
            v-model="fieldLabel"
            placeholder="Visual heading..."
            class="w-full bg-surface-subtle border border-line-strong rounded-xl px-4 py-2.5 text-body font-medium focus:border-accent focus:shadow-focus outline-none transition-all"
            @input="updateField"
          />
        </div>
      </div>

      <!-- Validation & Appearance -->
      <div class="grid grid-cols-1 gap-4 pt-4 border-t border-line">
        <label class="flex items-center gap-3 p-4 bg-surface-subtle rounded-card border border-line hover:border-accent transition-colors cursor-pointer group">
          <input
            type="checkbox"
            v-model="fieldRequired"
            class="w-5 h-5 rounded-lg border-line-strong text-accent focus:shadow-focus"
            @change="updateField"
          />
          <span class="text-body font-bold text-ink group-hover:text-accent transition-colors">Mandatory Field</span>
        </label>

        <label class="flex items-center gap-3 p-4 bg-surface-subtle rounded-card border border-line hover:border-accent transition-colors cursor-pointer group">
          <input
            type="checkbox"
            v-model="fieldBorder"
            class="w-5 h-5 rounded-lg border-line-strong text-accent focus:shadow-focus"
            @change="updateField"
          />
          <span class="text-body font-bold text-ink group-hover:text-accent transition-colors">Visible Border</span>
        </label>
      </div>

      <!-- Dynamic Options -->
      <div class="form-group pt-4 border-t border-line" v-if="hasOptions">
        <label class="text-[10px] font-semibold text-faint uppercase tracking-widest mb-4 block">Selectable Options</label>
        <div class="space-y-3 mb-4">
          <div
            v-for="(option, index) in fieldOptions"
            :key="index"
            class="flex gap-2 group animate-fade-in"
          >
            <input
              type="text"
              v-model="fieldOptions[index]"
              @input="updateField"
              placeholder="Enter value..."
              class="flex-1 bg-white border border-line rounded-xl px-4 py-2 text-body focus:border-accent focus:shadow-focus outline-none transition-all"
            />
            <button class="p-2 text-faint hover:text-danger hover:bg-danger-soft rounded-xl transition-all" @click="removeOption(index)">
              <i class="pi pi-trash text-body"></i>
            </button>
          </div>
        </div>
        <button @click="addOption" class="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-line hover:border-accent hover:bg-accent-soft rounded-2xl text-muted hover:text-accent transition-all font-bold text-meta">
          <i class="pi pi-plus-circle text-body"></i>
          ADD NEW OPTION
        </button>
      </div>

      <!-- Geometry Info -->
      <div class="form-group pt-6 border-t border-line">
        <label class="text-[10px] font-semibold text-faint uppercase tracking-widest mb-3 block">Spatial Coordinates</label>
        <div class="grid grid-cols-2 gap-3 p-4 bg-ink rounded-2xl shadow-inner">
          <div class="flex flex-col">
             <span class="text-[9px] font-semibold text-muted uppercase tracking-widest">X-Pos</span>
             <span class="text-white font-mono font-bold">{{ Math.round(formFieldsStore.selectedField.position.x) }}px</span>
          </div>
          <div class="flex flex-col">
             <span class="text-[9px] font-semibold text-muted uppercase tracking-widest">Y-Pos</span>
             <span class="text-white font-mono font-bold">{{ Math.round(formFieldsStore.selectedField.position.y) }}px</span>
          </div>
          <div class="flex flex-col">
             <span class="text-[9px] font-semibold text-muted uppercase tracking-widest">Width</span>
             <span class="text-white font-mono font-bold">{{ Math.round(formFieldsStore.selectedField.position.width) }}px</span>
          </div>
          <div class="flex flex-col">
             <span class="text-[9px] font-semibold text-muted uppercase tracking-widest">Height</span>
             <span class="text-white font-mono font-bold">{{ Math.round(formFieldsStore.selectedField.position.height) }}px</span>
          </div>
        </div>
      </div>

      <!-- Danger Zone -->
      <div class="pt-10">
        <button @click="deleteField" class="w-full flex items-center justify-center gap-3 py-4 bg-danger-soft hover:bg-danger text-danger hover:text-white rounded-2xl transition-all duration-300 font-semibold text-meta border border-danger group">
          <i class="pi pi-trash group-hover:scale-110 transition-transform"></i>
          ARCHIVE FIELD
        </button>
      </div>
    </div>
  </div>

  <!-- Empty State / Selection Hint -->
  <div class="field-properties-panel font-sans" v-else>
    <div class="panel-header bg-surface border-b border-line px-4 h-11 flex items-center">
      <h3 class="text-meta font-semibold text-faint uppercase tracking-widest">Configuration</h3>
    </div>

    <div class="panel-content p-8 flex flex-col items-center justify-center text-center h-full">
      <div class="w-20 h-20 bg-surface-sunken rounded-3xl flex items-center justify-center mb-6 text-faint">
        <i class="pi pi-sliders-h text-title"></i>
      </div>
      <h4 class="text-section font-semibold text-ink mb-2">Editor Ready</h4>
      <p class="text-body text-faint leading-relaxed mb-8">
        Select any field on the document to adjust its properties and validation rules.
      </p>

      <!-- Active fields list -->
      <div class="w-full space-y-3" v-if="formFieldsStore.fields.length > 0">
        <label class="text-[10px] font-semibold text-faint uppercase tracking-widest mb-4 block text-left">Active Layers</label>
        <div
          v-for="field in formFieldsStore.fields"
          :key="field.id"
          class="flex items-center gap-3 p-4 bg-surface-subtle hover:bg-white border border-line hover:border-accent rounded-2xl cursor-pointer transition-all hover:shadow-md group"
          @click="formFieldsStore.selectField(field.id)"
        >
          <div class="w-8 h-8 rounded-lg flex items-center justify-center text-faint group-hover:text-accent transition-colors" :class="getTypeIconBg(field.type)">
             <i :class="getFieldIcon(field.type)" class="text-body"></i>
          </div>
          <span class="text-body font-bold text-muted truncate flex-1 text-left">{{ field.label || field.name }}</span>
          <i class="pi pi-chevron-right text-[10px] text-faint group-hover:translate-x-1 transition-transform"></i>
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
    text: 'Text Input',
    textarea: 'Large Text',
    checkbox: 'Checkbox',
    radio: 'Radio Group',
    dropdown: 'Select Menu'
  }
  return labels[type]
}

const getTypeBadgeClass = (type: FieldType) => {
  const classes: Record<FieldType, string> = {
    text: 'bg-accent-soft border-accent text-accent',
    textarea: 'bg-accent-soft border-accent text-accent',
    checkbox: 'bg-published-soft border-published text-published',
    radio: 'bg-accent-soft border-accent text-accent',
    dropdown: 'bg-limit-soft border-limit text-limit'
  }
  return classes[type]
}

const getTypeIconBg = (type: FieldType) => {
  const bgs: Record<FieldType, string> = {
    text: 'bg-accent-soft',
    textarea: 'bg-accent-soft',
    checkbox: 'bg-published-soft',
    radio: 'bg-accent-soft',
    dropdown: 'bg-limit-soft'
  }
  return bgs[type]
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
  border-left: 1px solid #e7e8ec;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid #e7e8ec;
  background: #fbfbfc;
}

.panel-header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #191b21;
}

.save-status {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  font-size: 11px;
  color: #6a6f7b;
}

.save-status i {
  font-size: 10px;
}

.save-status i.pi-check {
  color: #12704f;
}

.save-status i.pi-exclamation-triangle {
  color: #b02a30;
}

.save-status i.pi-spinner {
  color: #3554d1;
}

.close-btn {
  background: none;
  border: none;
  padding: 4px;
  cursor: pointer;
  color: #6a6f7b;
  border-radius: 4px;
}

.close-btn:hover {
  background: #e7e8ec;
  color: #191b21;
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
  color: #191b21;
  margin-bottom: 6px;
}

.form-group input[type="text"] {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #d8dae1;
  border-radius: 6px;
  font-size: 14px;
}

.form-group input[type="text"]:focus {
  outline: none;
  border-color: #3554d1;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.form-group small {
  display: block;
  margin-top: 4px;
  font-size: 11px;
  color: #6a6f7b;
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
  background: #eef1fd;
  color: #2a45b8;
}

.field-type-badge.type-textarea {
  background: #eef1fd;
  color: #2a45b8;
}

.field-type-badge.type-checkbox {
  background: #e8f4ee;
  color: #12704f;
}

.field-type-badge.type-radio {
  background: #eef1fd;
  color: #5b21b6;
}

.field-type-badge.type-dropdown {
  background: #fbf2e0;
  color: #8a5c0a;
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
  border: 1px solid #e7e8ec;
  border-radius: 6px;
  cursor: pointer;
  color: #6a6f7b;
}

.remove-option-btn:hover {
  background: #f7ecec;
  border-color: #f7ecec;
  color: #b02a30;
}

.add-option-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: #f4f5f7;
  border: 1px dashed #d8dae1;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  color: #6a6f7b;
  width: 100%;
  justify-content: center;
}

.add-option-btn:hover {
  background: #e7e8ec;
  border-color: #9ba1ac;
}

.position-info .position-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  font-size: 12px;
  color: #6a6f7b;
  background: #f4f5f7;
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
  background: #f7ecec;
  border: 1px solid #f7ecec;
  border-radius: 6px;
  color: #b02a30;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}

.delete-btn:hover {
  background: #f7ecec;
}

/* Empty State */
.field-properties-panel.empty {
  justify-content: center;
  align-items: center;
}

.empty-state {
  text-align: center;
  padding: 24px;
  color: #6a6f7b;
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
  background: #3554d1;
  border: none;
  border-radius: 6px;
  color: white;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s;
}

.export-btn:hover {
  background: #2a45b8;
}

/* Fields Summary */
.fields-summary {
  background: #f4f5f7;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  color: #6a6f7b;
}

/* Empty Hint */
.empty-hint {
  text-align: center;
  padding: 16px;
  color: #6a6f7b;
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
  background: #fbfbfc;
  border: 1px solid #e7e8ec;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s;
}

.field-list-item:hover {
  background: #f4f5f7;
  border-color: #d8dae1;
}

.field-list-item i {
  color: #6a6f7b;
}
</style>
