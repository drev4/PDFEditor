<template>
  <div v-if="show" class="upload-progress">
    <div class="upload-progress-header">
      <span class="upload-progress-icon">📄</span>
      <div class="upload-progress-info">
        <p class="upload-progress-filename">{{ filename }}</p>
        <p class="upload-progress-status">{{ statusText }}</p>
      </div>
    </div>
    <div class="upload-progress-bar-container">
      <div
        class="upload-progress-bar"
        :style="{ width: `${percentage}%` }"
      ></div>
    </div>
    <div class="upload-progress-details">
      <span>{{ percentage }}%</span>
      <span>{{ formatBytes(loaded) }} / {{ formatBytes(total) }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  show: boolean
  filename: string
  loaded: number
  total: number
  percentage: number
}

const props = defineProps<Props>()

const statusText = computed(() => {
  if (props.percentage === 100) {
    return 'Upload complete'
  } else if (props.percentage > 0) {
    return 'Uploading...'
  }
  return 'Preparing upload...'
})

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i]
}
</script>

<style scoped>
.upload-progress {
  position: fixed;
  bottom: 20px;
  right: 20px;
  width: 350px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  padding: 16px;
  z-index: 1000;
  animation: slideIn 0.3s ease-out;
}

@keyframes slideIn {
  from {
    transform: translateX(100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

.upload-progress-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.upload-progress-icon {
  font-size: 32px;
  line-height: 1;
}

.upload-progress-info {
  flex: 1;
  min-width: 0;
}

.upload-progress-filename {
  font-weight: 600;
  font-size: 14px;
  color: #1f2937;
  margin: 0 0 4px 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.upload-progress-status {
  font-size: 12px;
  color: #6b7280;
  margin: 0;
}

.upload-progress-bar-container {
  height: 6px;
  background: #e5e7eb;
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 8px;
}

.upload-progress-bar {
  height: 100%;
  background: linear-gradient(90deg, #3b82f6, #2563eb);
  border-radius: 3px;
  transition: width 0.3s ease;
}

.upload-progress-details {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #6b7280;
}
</style>
