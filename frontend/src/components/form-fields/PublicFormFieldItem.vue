<template>
  <div
    class="public-field-item"
    :style="fieldStyle"
    :class="{ 
      'has-error': !!errorMessage,
      'field-checkbox': field.type === 'checkbox',
      'field-radio': field.type === 'radio'
    }"
  >
    <!-- Text Input -->
    <input
      v-if="field.type === 'text'"
      type="text"
      :value="modelValue"
      @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      class="field-input text-input"
      :placeholder="field.label"
      :required="field.required"
    />

    <!-- Textarea -->
    <textarea
      v-else-if="field.type === 'textarea'"
      :value="modelValue"
      @input="$emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
      class="field-input textarea-input"
      :placeholder="field.label"
      :required="field.required"
    ></textarea>

    <!-- Checkbox -->
    <input
      v-else-if="field.type === 'checkbox'"
      type="checkbox"
      :checked="modelValue === true"
      @change="$emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
      class="field-input checkbox-input"
      :required="field.required"
    />

    <!-- Radio Group -->
    <div v-else-if="field.type === 'radio'" class="radio-group">
      <div v-for="option in field.options" :key="option" class="radio-option">
        <input
          type="radio"
          :name="field.id"
          :value="option"
          :checked="modelValue === option"
          @change="$emit('update:modelValue', option)"
          class="radio-input"
        />
        <span class="radio-label">{{ option }}</span>
      </div>
    </div>

    <!-- Dropdown -->
    <select
      v-else-if="field.type === 'dropdown'"
      :value="modelValue"
      @change="$emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
      class="field-input dropdown-input"
      :required="field.required"
    >
      <option value="" disabled selected>Select {{ field.label }}</option>
      <option v-for="option in field.options" :key="option" :value="option">
        {{ option }}
      </option>
    </select>

    <!-- Validation Tooltip -->
    <div v-if="errorMessage" class="error-tooltip">
      {{ errorMessage }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Field } from '@/services/forms'
import { rotateFieldRect } from '@/utils/pdfCoordinates'

const props = defineProps<{
  field: Field
  modelValue: any
  errorMessage?: string
  scale: number
  baseScale?: number
  rotation?: number
  pageWidth?: number
  pageHeight?: number
}>()

defineEmits<{
  (e: 'update:modelValue', value: any): void
}>()

// Default base scale if fields were saved at 1.5 (as per PDFViewer defaults)
const BASE_SCALE = props.baseScale || 1.5

const fieldStyle = computed(() => {
  const scaleFactor = props.scale / BASE_SCALE
  const { x, y, width, height } = props.field.position

  // The page's upright size in stored units, which rotation is measured
  // against. With no page size there is nothing to mirror against, so fall back
  // to the upright placement rather than guessing and putting the field
  // somewhere arbitrary.
  const pageWidth = props.pageWidth ?? 0
  const pageHeight = props.pageHeight ?? 0
  const rotation = pageWidth && pageHeight ? (props.rotation ?? 0) : 0

  const rect = rotateFieldRect(
    { x, y, width, height },
    pageWidth,
    pageHeight,
    rotation,
    scaleFactor
  )

  return {
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`
  }
})
</script>

<style scoped>
/*
 * A field on the public form.
 *
 * The rule this implements is stated on the System artboard: in the editor a
 * field is a bordered rectangle with a type tag, because the author is
 * manipulating geometry; here the border drops to a single underline so the
 * document still reads as a document. That is why there is no box, no radius
 * and no shadow in the resting state — only a rule under the answer and the
 * faintest accent tint to say the space is fillable.
 *
 * Positioning stays in the :style binding in the template. It is the
 * canvas-to-PDF scale coupling, not styling, and changing it moves fields on
 * the printed page.
 */
.public-field-item {
  position: absolute;
  pointer-events: auto;
  z-index: 20;
}

.field-input {
  width: 100%;
  height: 100%;
  padding: 0 8px;
  font-family: inherit;
  font-size: 12.5px;
  color: theme('colors.ink');
  border: 0;
  border-bottom: 1.5px solid theme('colors.field.underline');
  border-radius: 0;
  background-color: rgba(53, 84, 209, 0.03);
  transition: border-color 0.15s, box-shadow 0.15s, background-color 0.15s;
}

.field-input::placeholder {
  color: theme('colors.faint');
}

/* Focus is the one moment a field becomes a control: it takes a full border,
   the control radius and the 3px accent ring from the System artboard. */
.field-input:focus {
  outline: none;
  border: 1.5px solid theme('colors.accent.DEFAULT');
  border-radius: 5px;
  background-color: theme('colors.surface.DEFAULT');
  box-shadow: theme('boxShadow.focus');
}

.textarea-input {
  resize: none;
  padding: 6px 8px;
  line-height: 1.45;
}

.dropdown-input {
  appearance: none;
  cursor: pointer;
}

.checkbox-input {
  cursor: pointer;
  accent-color: theme('colors.accent.DEFAULT');
  width: 100%;
  height: 100%;
  margin: 0;
  border-radius: 4px;
}

.radio-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 6px;
  font-size: 12px;
  background-color: rgba(53, 84, 209, 0.03);
  border-bottom: 1.5px solid theme('colors.field.underline');
}

.radio-option {
  display: flex;
  align-items: center;
  gap: 5px;
}

.radio-input {
  accent-color: theme('colors.accent.DEFAULT');
}

.has-error .field-input,
.has-error .radio-group {
  border-bottom-color: theme('colors.danger.DEFAULT');
  background-color: rgba(176, 42, 48, 0.04);
}

.has-error .field-input::placeholder {
  color: #c68a8d;
}

.has-error .field-input:focus {
  border: 1.5px solid theme('colors.danger.DEFAULT');
  box-shadow: theme('boxShadow.focus-danger');
}

/* Set beside the field rather than under it, as the artboard draws it: a red
   box under a line of a printed form reads as part of the document. */
.error-tooltip {
  position: absolute;
  top: 50%;
  left: calc(100% + 8px);
  transform: translateY(-50%);
  color: theme('colors.danger.DEFAULT');
  font-size: 11.5px;
  white-space: nowrap;
  z-index: 30;
}
</style>
