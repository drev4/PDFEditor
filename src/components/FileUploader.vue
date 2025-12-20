<template>
  <div class="file-uploader">
    <FileUpload
      mode="basic"
      accept="application/pdf"
      :maxFileSize="50000000"
      @select="handleFileSelect"
      :auto="true"
      chooseLabel="Open PDF"
      chooseIcon="pi pi-folder-open"
      class="p-button-outlined"
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
</style>
