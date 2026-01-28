<template>
  <div
    class="form-field-item"
    :class="{
      'selected': isSelected,
      'field-text': field.type === 'text',
      'field-textarea': field.type === 'textarea',
      'field-checkbox': field.type === 'checkbox',
      'field-radio': field.type === 'radio',
      'field-dropdown': field.type === 'dropdown'
    }"
    :style="fieldStyle"
    @mousedown.stop="onMouseDown"
    @click.stop="onClick"
  >
    <!-- Radio buttons options preview -->
    <div v-if="field.type === 'radio' && field.options" class="radio-options-preview">
      <div
        v-for="(option, index) in field.options"
        :key="index"
        class="radio-option-item"
        :style="{ marginBottom: index < field.options.length - 1 ? '5px' : '0' }"
      >
        <div class="radio-circle"></div>
        <span class="radio-option-label">{{ option }}</span>
      </div>
    </div>

    <!-- Field Label for non-radio fields (shown when not too small) -->
    <template v-if="field.type !== 'radio'">
      <span v-if="field.position.width > 60" class="field-label">
        {{ field.label || field.name }}
        <span v-if="field.required" class="required-indicator">*</span>
      </span>

      <!-- Field Type Icon -->
      <i :class="fieldIcon" class="field-type-icon"></i>
    </template>

    <!-- Resize Handles (only when selected) -->
    <template v-if="isSelected">
      <div class="resize-handle nw" @mousedown.stop="startResize($event, 'nw')"></div>
      <div class="resize-handle ne" @mousedown.stop="startResize($event, 'ne')"></div>
      <div class="resize-handle sw" @mousedown.stop="startResize($event, 'sw')"></div>
      <div class="resize-handle se" @mousedown.stop="startResize($event, 'se')"></div>
      <div class="resize-handle n" @mousedown.stop="startResize($event, 'n')"></div>
      <div class="resize-handle s" @mousedown.stop="startResize($event, 's')"></div>
      <div class="resize-handle e" @mousedown.stop="startResize($event, 'e')"></div>
      <div class="resize-handle w" @mousedown.stop="startResize($event, 'w')"></div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useFormFieldsStore, type FormField } from '@/stores/formFields.store'
import { useToast } from 'primevue/usetoast'

const props = defineProps<{
  field: FormField
}>()

const formFieldsStore = useFormFieldsStore()
const toast = useToast()

const isSelected = computed(() => formFieldsStore.selectedFieldId === props.field.id)

const fieldStyle = computed(() => ({
  left: `${props.field.position.x}px`,
  top: `${props.field.position.y}px`,
  width: `${props.field.position.width}px`,
  height: `${props.field.position.height}px`
}))

const fieldIcon = computed(() => {
  const icons: Record<string, string> = {
    text: 'pi pi-pencil',
    textarea: 'pi pi-align-left',
    checkbox: 'pi pi-check-square',
    radio: 'pi pi-circle',
    dropdown: 'pi pi-chevron-down'
  }
  return icons[props.field.type] || 'pi pi-pencil'
})

// Drag state
const isDragging = ref(false)
const dragStart = ref({ x: 0, y: 0 })
const fieldStart = ref({ x: 0, y: 0 })

// Resize state
const isResizing = ref(false)
const resizeHandle = ref<string | null>(null)
const resizeStart = ref({ x: 0, y: 0, width: 0, height: 0, fieldX: 0, fieldY: 0 })

const onClick = () => {
  formFieldsStore.selectField(props.field.id)
}

const onMouseDown = (e: MouseEvent) => {
  if (isResizing.value) return

  formFieldsStore.selectField(props.field.id)
  isDragging.value = true
  dragStart.value = { x: e.clientX, y: e.clientY }
  fieldStart.value = { x: props.field.position.x, y: props.field.position.y }

  document.addEventListener('mousemove', onDrag)
  document.addEventListener('mouseup', stopDrag)
}

const onDrag = (e: MouseEvent) => {
  if (!isDragging.value) return

  const dx = e.clientX - dragStart.value.x
  const dy = e.clientY - dragStart.value.y

  const newX = Math.max(0, fieldStart.value.x + dx)
  const newY = Math.max(0, fieldStart.value.y + dy)

  formFieldsStore.moveField(props.field.id, newX, newY)
}

const stopDrag = async () => {
  isDragging.value = false
  document.removeEventListener('mousemove', onDrag)
  document.removeEventListener('mouseup', stopDrag)

  // Save field position to server after drag
  try {
    await formFieldsStore.saveField(props.field.id)
  } catch (error) {
    console.error('Failed to save field position:', error)

    toast.add({
      severity: 'error',
      summary: 'Error al guardar posición',
      detail: 'No se pudo guardar la nueva posición del campo',
      life: 3000
    })
  }
}

const startResize = (e: MouseEvent, handle: string) => {
  isResizing.value = true
  resizeHandle.value = handle
  resizeStart.value = {
    x: e.clientX,
    y: e.clientY,
    width: props.field.position.width,
    height: props.field.position.height,
    fieldX: props.field.position.x,
    fieldY: props.field.position.y
  }

  document.addEventListener('mousemove', onResize)
  document.addEventListener('mouseup', stopResize)
}

const onResize = (e: MouseEvent) => {
  if (!isResizing.value || !resizeHandle.value) return

  const dx = e.clientX - resizeStart.value.x
  const dy = e.clientY - resizeStart.value.y

  let newWidth = resizeStart.value.width
  let newHeight = resizeStart.value.height
  let newX = resizeStart.value.fieldX
  let newY = resizeStart.value.fieldY

  const minSize = 30

  // Handle resize based on which handle is being dragged
  if (resizeHandle.value.includes('e')) {
    newWidth = Math.max(minSize, resizeStart.value.width + dx)
  }
  if (resizeHandle.value.includes('w')) {
    const widthChange = Math.min(dx, resizeStart.value.width - minSize)
    newWidth = resizeStart.value.width - widthChange
    newX = resizeStart.value.fieldX + widthChange
  }
  if (resizeHandle.value.includes('s')) {
    newHeight = Math.max(minSize, resizeStart.value.height + dy)
  }
  if (resizeHandle.value.includes('n')) {
    const heightChange = Math.min(dy, resizeStart.value.height - minSize)
    newHeight = resizeStart.value.height - heightChange
    newY = resizeStart.value.fieldY + heightChange
  }

  formFieldsStore.moveField(props.field.id, newX, newY)
  formFieldsStore.resizeField(props.field.id, newWidth, newHeight)
}

const stopResize = async () => {
  isResizing.value = false
  resizeHandle.value = null
  document.removeEventListener('mousemove', onResize)
  document.removeEventListener('mouseup', stopResize)

  // Save field size to server after resize
  try {
    await formFieldsStore.saveField(props.field.id)
  } catch (error) {
    console.error('Failed to save field size:', error)

    toast.add({
      severity: 'error',
      summary: 'Error al guardar tamaño',
      detail: 'No se pudo guardar el nuevo tamaño del campo',
      life: 3000
    })
  }
}
</script>

<style scoped>
.form-field-item {
  position: absolute;
  border: 2px dashed #3b82f6;
  background: rgba(59, 130, 246, 0.1);
  border-radius: 4px;
  cursor: move;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: border-color 0.2s, background-color 0.2s;
  user-select: none;
}

.form-field-item:hover {
  border-color: #2563eb;
  background: rgba(59, 130, 246, 0.15);
}

.form-field-item.selected {
  border-style: solid;
  border-color: #2563eb;
  background: rgba(59, 130, 246, 0.2);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.3);
}

.field-label {
  font-size: 11px;
  color: #1e40af;
  font-weight: 500;
  max-width: 80%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.required-indicator {
  color: #dc2626;
  margin-left: 2px;
}

.field-type-icon {
  font-size: 14px;
  color: #3b82f6;
  opacity: 0.8;
}

/* Resize Handles */
.resize-handle {
  position: absolute;
  width: 10px;
  height: 10px;
  background: #2563eb;
  border: 2px solid white;
  border-radius: 2px;
  z-index: 10;
}

.resize-handle.nw { top: -5px; left: -5px; cursor: nw-resize; }
.resize-handle.ne { top: -5px; right: -5px; cursor: ne-resize; }
.resize-handle.sw { bottom: -5px; left: -5px; cursor: sw-resize; }
.resize-handle.se { bottom: -5px; right: -5px; cursor: se-resize; }
.resize-handle.n { top: -5px; left: 50%; transform: translateX(-50%); cursor: n-resize; }
.resize-handle.s { bottom: -5px; left: 50%; transform: translateX(-50%); cursor: s-resize; }
.resize-handle.e { right: -5px; top: 50%; transform: translateY(-50%); cursor: e-resize; }
.resize-handle.w { left: -5px; top: 50%; transform: translateY(-50%); cursor: w-resize; }

/* Field Type Colors */
.field-checkbox {
  border-color: #10b981;
  background: rgba(16, 185, 129, 0.1);
}
.field-checkbox:hover,
.field-checkbox.selected {
  border-color: #059669;
  background: rgba(16, 185, 129, 0.2);
}
.field-checkbox .field-type-icon,
.field-checkbox .field-label {
  color: #059669;
}

.field-radio {
  border-color: #8b5cf6;
  background: rgba(139, 92, 246, 0.1);
}
.field-radio:hover,
.field-radio.selected {
  border-color: #7c3aed;
  background: rgba(139, 92, 246, 0.2);
}
.field-radio .field-type-icon,
.field-radio .field-label {
  color: #7c3aed;
}

.field-dropdown {
  border-color: #f59e0b;
  background: rgba(245, 158, 11, 0.1);
}
.field-dropdown:hover,
.field-dropdown.selected {
  border-color: #d97706;
  background: rgba(245, 158, 11, 0.2);
}
.field-dropdown .field-type-icon,
.field-dropdown .field-label {
  color: #d97706;
}

/* Radio Options Preview */
.radio-options-preview {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: flex-start;
  width: 100%;
  height: 100%;
  padding: 8px;
  gap: 5px;
  overflow: hidden;
}

.radio-option-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  color: #7c3aed;
  white-space: nowrap;
}

.radio-circle {
  width: 12px;
  height: 12px;
  border: 2px solid #7c3aed;
  border-radius: 50%;
  flex-shrink: 0;
  background: rgba(139, 92, 246, 0.1);
}

.radio-option-label {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 150px;
}
</style>
