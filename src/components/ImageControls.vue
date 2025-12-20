<template>
  <div class="image-controls">
    <div class="image-controls-row">
      <Button
        :label="maintainAspectRatio ? 'Lock Ratio' : 'Free Resize'"
        :icon="maintainAspectRatio ? 'pi pi-lock' : 'pi pi-lock-open'"
        @click="$emit('toggle-aspect-ratio')"
        :severity="maintainAspectRatio ? 'info' : 'secondary'"
        size="small"
        outlined
      />
      <Button
        label="Reset Size"
        icon="pi pi-refresh"
        @click="$emit('reset-size')"
        severity="secondary"
        size="small"
        outlined
      />
      <Button
        label="Flip H"
        icon="pi pi-arrows-h"
        @click="$emit('flip-horizontal')"
        severity="secondary"
        size="small"
        outlined
      />
      <Button
        label="Flip V"
        icon="pi pi-arrows-v"
        @click="$emit('flip-vertical')"
        severity="secondary"
        size="small"
        outlined
      />
    </div>
    <div class="image-controls-row">
      <Button
        label="Confirm"
        icon="pi pi-check"
        @click="$emit('confirm')"
        severity="success"
        size="small"
      />
      <Button
        label="Cancel"
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
import Button from 'primevue/button'

defineProps<{
  maintainAspectRatio: boolean
}>()

defineEmits<{
  'toggle-aspect-ratio': []
  'reset-size': []
  'flip-horizontal': []
  'flip-vertical': []
  'confirm': []
  'cancel': []
}>()
</script>

<style scoped>
.image-controls {
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
}

.image-controls-row {
  display: flex;
  gap: 0.5rem;
  justify-content: center;
  align-items: center;
}
</style>
