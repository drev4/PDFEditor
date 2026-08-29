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
    <!-- The type tag. In the editor a field says what it is, because the author
         is placing geometry and needs to tell a checkbox from a dropdown at a
         glance. It is what replaces the old per-type colour coding: five hues
         competing with the page defeats the rule that accent is rationed. -->
    <div class="field-tag">{{ typeTag }}</div>

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
      </span>
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

// What the tag above a placed field says. `Dropdown · required` is the shape
// the Editor artboard draws: the type, and the one property an author needs to
// see without opening the panel.
const typeTag = computed(() => {
  const names: Record<string, string> = {
    text: 'Text',
    textarea: 'Paragraph',
    checkbox: 'Checkbox',
    radio: 'Radio group',
    dropdown: 'Dropdown'
  }
  const name = names[props.field.type] || props.field.type
  return props.field.required ? `${name} · required` : name
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
/*
 * A field in the editor.
 *
 * The System artboard draws this as a bordered rectangle with a type tag —
 * the author is manipulating geometry here, so the field is allowed to look
 * like an object. Its counterpart on the public form is a single underline
 * (PublicFormFieldItem.vue), and the two are deliberately not the same.
 *
 * One field colour, not five. The previous version gave checkbox, radio and
 * dropdown their own hue, which put three saturated colours on top of a
 * document and left nothing for the selection to say with.
 */
.form-field-item {
  position: absolute;
  border: 1px solid theme('colors.field.idle');
  background: rgba(53, 84, 209, 0.05);
  border-radius: 3px;
  cursor: move;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: border-color 0.15s, background-color 0.15s, box-shadow 0.15s;
  user-select: none;
}

.form-field-item:hover {
  border-color: theme('colors.accent.DEFAULT');
}

/* Selection is one of the three things accent is spent on. */
.form-field-item.selected {
  border: 1.5px solid theme('colors.accent.DEFAULT');
  background: rgba(53, 84, 209, 0.08);
  box-shadow: theme('boxShadow.focus-field');
}

.field-tag {
  position: absolute;
  left: -1px;
  top: -18px;
  height: 17px;
  padding: 0 5px;
  display: flex;
  align-items: center;
  border-radius: 3px;
  background: theme('colors.field.idle');
  color: #ffffff;
  font-size: 9.5px;
  font-weight: 500;
  letter-spacing: 0.01em;
  white-space: nowrap;
  pointer-events: none;
}

.form-field-item.selected .field-tag {
  left: -1.5px;
  top: -19px;
  background: theme('colors.accent.DEFAULT');
}

.field-label {
  font-size: 11px;
  color: theme('colors.muted');
  font-weight: 500;
  max-width: 88%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 7px squares with a white fill, as drawn on the artboard. */
.resize-handle {
  position: absolute;
  width: 7px;
  height: 7px;
  background: #ffffff;
  border: 1.5px solid theme('colors.accent.DEFAULT');
  border-radius: 1px;
  z-index: 10;
}

.resize-handle.nw { top: -3.5px; left: -3.5px; cursor: nw-resize; }
.resize-handle.ne { top: -3.5px; right: -3.5px; cursor: ne-resize; }
.resize-handle.sw { bottom: -3.5px; left: -3.5px; cursor: sw-resize; }
.resize-handle.se { bottom: -3.5px; right: -3.5px; cursor: se-resize; }
.resize-handle.n { top: -3.5px; left: 50%; transform: translateX(-50%); cursor: n-resize; }
.resize-handle.s { bottom: -3.5px; left: 50%; transform: translateX(-50%); cursor: s-resize; }
.resize-handle.e { right: -3.5px; top: 50%; transform: translateY(-50%); cursor: e-resize; }
.resize-handle.w { left: -3.5px; top: 50%; transform: translateY(-50%); cursor: w-resize; }

/* Radio Options Preview */
.radio-options-preview {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: flex-start;
  width: 100%;
  height: 100%;
  padding: 6px 8px;
  gap: 5px;
  overflow: hidden;
}

.radio-option-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  color: theme('colors.muted');
  white-space: nowrap;
}

.radio-circle {
  width: 11px;
  height: 11px;
  border: 1.5px solid theme('colors.field.idle');
  border-radius: 50%;
  flex-shrink: 0;
  background: #ffffff;
}

.radio-option-label {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 150px;
}
</style>
