<template>
  <div class="text-controls">
    <div class="text-controls-row">
      <div class="text-input-group">
        <label>Texto:</label>
        <input
          type="text"
          v-model="localText"
          @input="$emit('update-text', localText)"
          class="text-input"
          placeholder="Escribe aquí..."
        />
      </div>

      <div class="control-group">
        <label>Tamaño:</label>
        <input
          type="number"
          v-model.number="localFontSize"
          @input="$emit('update-font-size', localFontSize)"
          min="8"
          max="72"
          class="size-input"
        />
      </div>

      <div class="control-group">
        <label>Color:</label>
        <input
          type="color"
          v-model="localColor"
          @input="$emit('update-color', localColor)"
          class="color-input"
        />
      </div>
    </div>

    <div class="text-controls-row">
      <Button
        label="Negrita"
        icon="pi pi-bold"
        @click="$emit('toggle-bold')"
        :severity="isBold ? 'info' : 'secondary'"
        size="small"
        :outlined="!isBold"
      />
      <Button
        label="Cursiva"
        icon="pi pi-italic"
        @click="$emit('toggle-italic')"
        :severity="isItalic ? 'info' : 'secondary'"
        size="small"
        :outlined="!isItalic"
      />
    </div>

    <div class="text-controls-row">
      <Button
        label="Confirmar"
        icon="pi pi-check"
        @click="$emit('confirm')"
        severity="success"
        size="small"
      />
      <Button
        label="Cancelar"
        icon="pi pi-times"
        @click="$emit('cancel')"
        severity="danger"
        size="small"
        outlined
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import Button from 'primevue/button'

const props = defineProps<{
  text: string
  fontSize: number
  color: string
  isBold: boolean
  isItalic: boolean
}>()

const emit = defineEmits<{
  'update-text': [text: string]
  'update-font-size': [size: number]
  'update-color': [color: string]
  'toggle-bold': []
  'toggle-italic': []
  'confirm': []
  'cancel': []
}>()

const localText = ref(props.text)
const localFontSize = ref(props.fontSize)
const localColor = ref(props.color)

watch(() => props.text, (newVal) => {
  localText.value = newVal
})

watch(() => props.fontSize, (newVal) => {
  localFontSize.value = newVal
})

watch(() => props.color, (newVal) => {
  localColor.value = newVal
})
</script>

<style scoped>
.text-controls {
  position: fixed;
  bottom: 2rem;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  z-index: 20;
  background: white;
  padding: 1rem;
  border-radius: 0.5rem;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  min-width: 500px;
}

.text-controls-row {
  display: flex;
  gap: 0.5rem;
  justify-content: center;
  align-items: center;
}

.text-input-group {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  flex: 1;
}

.control-group {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  align-items: flex-start;
}

label {
  font-size: 0.75rem;
  font-weight: 600;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.text-input {
  padding: 0.5rem;
  border: 1px solid #d1d5db;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  outline: none;
  transition: border-color 0.2s ease;
  width: 100%;
}

.text-input:focus {
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.size-input {
  padding: 0.5rem;
  border: 1px solid #d1d5db;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  outline: none;
  transition: border-color 0.2s ease;
  width: 70px;
}

.size-input:focus {
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.color-input {
  width: 50px;
  height: 35px;
  border: 1px solid #d1d5db;
  border-radius: 0.375rem;
  cursor: pointer;
  outline: none;
}

.color-input::-webkit-color-swatch-wrapper {
  padding: 2px;
}

.color-input::-webkit-color-swatch {
  border: none;
  border-radius: 0.25rem;
}
</style>
