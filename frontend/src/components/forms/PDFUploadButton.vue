<template>
  <div class="pdf-upload-button">
    <input
      ref="fileInput"
      type="file"
      accept="application/pdf"
      @change="handleFileSelect"
      class="pdf-upload-input"
    />

    <button
      @click="triggerFileInput"
      :disabled="isUploading || disabled"
      class="upload-button"
      :class="{ 'uploading': isUploading }"
    >
      <span v-if="!isUploading" class="button-content">
        <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>
        {{ buttonText }}
      </span>
      <span v-else class="button-content">
        <svg class="icon spinner" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        Uploading {{ uploadProgress?.percentage || 0 }}%
      </span>
    </button>

    <!-- Upload Progress Toast -->
    <UploadProgress
      v-if="uploadProgress"
      :show="isUploading"
      :filename="currentFileName"
      :loaded="uploadProgress.loaded"
      :total="uploadProgress.total"
      :percentage="uploadProgress.percentage"
    />

    <!-- Error Message -->
    <div v-if="error" class="error-message">
      {{ error }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { usePDFUpload } from '@/composables/usePDFUpload'
import UploadProgress from '@/components/ui/UploadProgress.vue'

interface Props {
  buttonText?: string
  disabled?: boolean
  autoUpload?: boolean
}

interface Emits {
  (e: 'upload-start', file: File): void
  (e: 'upload-success', url: string): void
  (e: 'upload-error', error: string): void
  (e: 'file-selected', file: File): void
}

const props = withDefaults(defineProps<Props>(), {
  buttonText: 'Upload PDF',
  disabled: false,
  autoUpload: true
})

const emit = defineEmits<Emits>()

const fileInput = ref<HTMLInputElement | null>(null)
const currentFileName = ref('')

const { isUploading, uploadProgress, error, upload } = usePDFUpload()

function triggerFileInput() {
  fileInput.value?.click()
}

async function handleFileSelect(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]

  if (!file) return

  currentFileName.value = file.name
  emit('file-selected', file)

  if (props.autoUpload) {
    await uploadFile(file)
  }

  // Reset input
  if (fileInput.value) {
    fileInput.value.value = ''
  }
}

async function uploadFile(file: File) {
  try {
    emit('upload-start', file)
    const url = await upload(file)
    emit('upload-success', url)
  } catch (e) {
    const errorMessage = error.value || 'Failed to upload PDF'
    emit('upload-error', errorMessage)
  }
}

// Expose upload method for manual uploads
defineExpose({
  uploadFile
})
</script>

<style scoped>
.pdf-upload-button {
  position: relative;
}

.pdf-upload-input {
  display: none;
}

.upload-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 10px 20px;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s;
}

.upload-button:hover:not(:disabled) {
  background: #2563eb;
}

.upload-button:disabled {
  background: #9ca3af;
  cursor: not-allowed;
}

.upload-button.uploading {
  background: #2563eb;
}

.button-content {
  display: flex;
  align-items: center;
  gap: 8px;
}

.icon {
  width: 20px;
  height: 20px;
}

.spinner {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.error-message {
  margin-top: 8px;
  padding: 8px 12px;
  background: #fee2e2;
  color: #991b1b;
  border-radius: 4px;
  font-size: 13px;
}
</style>
