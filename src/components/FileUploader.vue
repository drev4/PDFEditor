<template>
  <div class="file-uploader">
    <FileUpload
      mode="basic"
      accept="application/pdf"
      :maxFileSize="50000000"
      @select="handleFileSelect"
      :auto="true"
      chooseLabel="Upload PDF"
      chooseIcon="pi pi-upload"
      severity="info"
      class="upload-button"
    />
  </div>
</template>

<script setup lang="ts">
import FileUpload from 'primevue/fileupload'
import { usePdfStore } from '@/stores/pdfStore'

const pdfStore = usePdfStore()

const handleFileSelect = async (event: any) => {
  const file = event.files[0]
  if (file && file.type === 'application/pdf') {
    try {
      await pdfStore.loadPDF(file)
    } catch (error) {
      console.error('Error loading PDF:', error)
    }
  }
}
</script>

<style scoped>
.file-uploader {
  display: inline-block;
}

.upload-button {
  font-weight: 600;
  transition: all 0.2s ease;
}

.upload-button:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
}
</style>
