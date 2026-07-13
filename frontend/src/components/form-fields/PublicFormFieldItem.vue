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

const props = defineProps<{
  field: Field
  modelValue: any
  errorMessage?: string
  scale: number
  baseScale?: number
}>()

defineEmits<{
  (e: 'update:modelValue', value: any): void
}>()

// Default base scale if fields were saved at 1.5 (as per PDFViewer defaults)
const BASE_SCALE = props.baseScale || 1.5

const fieldStyle = computed(() => {
  const scaleFactor = props.scale / BASE_SCALE
  const { x, y, width, height } = props.field.position

  return {
    left: `${x * scaleFactor}px`,
    top: `${y * scaleFactor}px`,
    width: `${width * scaleFactor}px`,
    height: `${height * scaleFactor}px`
  }
})
</script>

<style scoped>
.public-field-item {
  position: absolute;
  pointer-events: auto;
  z-index: 20;
}

.field-input {
  width: 100%;
  height: 100%;
  border: 1px solid rgba(59, 130, 246, 0.5);
  background-color: rgba(255, 255, 255, 0.7);
  padding: 4px;
  font-size: 14px;
  border-radius: 4px;
  transition: all 0.2s;
}

.field-input:focus {
  outline: none;
  border-color: #2563eb;
  background-color: rgba(255, 255, 255, 0.95);
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.2);
}

.textarea-input {
  resize: none;
}

.checkbox-input {
  cursor: pointer;
  accent-color: #2563eb;
  width: 100%;
  height: 100%;
  margin: 0;
}

.radio-group {
  display: flex;
  flex-direction: column;
  background-color: rgba(255, 255, 255, 0.9);
  border-radius: 4px;
  padding: 4px;
  border: 1px solid rgba(59, 130, 246, 0.3);
  font-size: 12px;
}

.radio-option {
  display: flex;
  align-items: center;
  gap: 4px;
}

.has-error .field-input,
.has-error .radio-group {
  border-color: #ef4444;
  background-color: rgba(254, 226, 226, 0.3);
}

.error-tooltip {
  position: absolute;
  bottom: -24px;
  left: 0;
  background-color: #ef4444;
  color: white;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 10px;
  white-space: nowrap;
  z-index: 30;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}
</style>
