<template>
  <div class="viewer-toolbar bg-white/90 backdrop-blur-lg shadow-sm p-3 flex items-center justify-between border-b border-gray-200/50">
    <div class="flex items-center gap-2">
      <div class="bg-gray-50 rounded-lg p-1 flex items-center gap-1">
        <Button
          icon="pi pi-chevron-left"
          @click="$emit('previous-page')"
          :disabled="currentPage <= 1"
          size="small"
          text
          :severity="currentPage <= 1 ? 'secondary' : 'info'"
        />
        <div class="px-3 py-1 bg-white rounded-md border border-gray-200 min-w-[120px] text-center">
          <span class="text-sm font-semibold text-gray-700">
            {{ currentPage }} / {{ numPages }}
          </span>
        </div>
        <Button
          icon="pi pi-chevron-right"
          @click="$emit('next-page')"
          :disabled="currentPage >= numPages"
          size="small"
          text
          :severity="currentPage >= numPages ? 'secondary' : 'info'"
        />
      </div>
    </div>

    <div class="flex items-center gap-2">
      <div class="bg-gray-50 rounded-lg p-1 flex items-center gap-1">
        <Button
          icon="pi pi-search-minus"
          @click="$emit('zoom-out')"
          size="small"
          text
          severity="info"
        />
        <div class="px-3 py-1 bg-white rounded-md border border-gray-200 min-w-[70px] text-center">
          <span class="text-sm font-semibold text-gray-700">{{ Math.round(scale * 100) }}%</span>
        </div>
        <Button
          icon="pi pi-search-plus"
          @click="$emit('zoom-in')"
          size="small"
          text
          severity="info"
        />
      </div>
      <div class="h-6 w-px bg-gray-300"></div>
      <Button
        icon="pi pi-refresh"
        @click="$emit('rotate')"
        size="small"
        outlined
        severity="info"
        label="Rotate"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import Button from 'primevue/button'

defineProps<{
  currentPage: number
  numPages: number
  scale: number
}>()

defineEmits<{
  'previous-page': []
  'next-page': []
  'zoom-in': []
  'zoom-out': []
  'rotate': []
}>()
</script>

<style scoped>
.viewer-toolbar {
  z-index: 10;
  transition: all 0.2s ease;
}
</style>
