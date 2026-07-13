<template>
  <div class="viewer-toolbar bg-white/80 backdrop-blur-xl shadow-md px-6 py-2.5 flex items-center justify-between border-b border-white z-40">
    <div class="flex items-center gap-3">
      <div class="bg-slate-100/80 rounded-xl p-1 flex items-center gap-1 border border-slate-200/50">
        <Button
          icon="pi pi-chevron-left"
          @click="$emit('previous-page')"
          :disabled="currentPage <= 1"
          v-tooltip.bottom="'Previous Page'"
          size="small"
          text
          rounded
          :severity="currentPage <= 1 ? 'secondary' : 'info'"
        />
        <div class="px-4 py-1.5 bg-white rounded-lg border border-slate-200 shadow-sm min-w-[100px] text-center">
          <span class="text-xs font-black text-slate-700 tracking-tighter">
            PAGE {{ currentPage }} / {{ numPages }}
          </span>
        </div>
        <Button
          icon="pi pi-chevron-right"
          @click="$emit('next-page')"
          :disabled="currentPage >= numPages"
          v-tooltip.bottom="'Next Page'"
          size="small"
          text
          rounded
          :severity="currentPage >= numPages ? 'secondary' : 'info'"
        />
      </div>
    </div>

    <div class="flex items-center gap-4">
      <div class="bg-slate-100/80 rounded-xl p-1 flex items-center gap-1 border border-slate-200/50">
        <Button
          icon="pi pi-minus"
          @click="$emit('zoom-out')"
          v-tooltip.bottom="'Zoom Out'"
          size="small"
          text
          rounded
          severity="secondary"
        />
        <div class="px-3 py-1.5 bg-white rounded-lg border border-slate-200 shadow-sm min-w-[65px] text-center">
          <span class="text-[10px] font-black text-slate-700">{{ Math.round(scale * 100) }}%</span>
        </div>
        <Button
          icon="pi pi-plus"
          @click="$emit('zoom-in')"
          v-tooltip.bottom="'Zoom In'"
          size="small"
          text
          rounded
          severity="secondary"
        />
      </div>
      
      <div class="h-8 w-px bg-slate-200 mx-1"></div>
      
      <Button
        icon="pi pi-refresh"
        @click="$emit('rotate')"
        v-tooltip.bottom="'Rotate 90°'"
        size="small"
        text
        rounded
        severity="info"
        class="bg-blue-50/50 border border-blue-100"
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
