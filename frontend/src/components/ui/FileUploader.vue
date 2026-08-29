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
import { useDocumentStore } from '@/stores/document.store'

const documentStore = useDocumentStore()

// Emitted once the document is in the store. The forms list uses it to move to
// the editor; the editor itself is already there and ignores it.
const emit = defineEmits<{ (e: 'loaded'): void }>()

const handleFileSelect = async (event: any) => {
  const file = event.files[0]
  if (file && file.type === 'application/pdf') {
    try {
      await documentStore.loadPDF(file)
      // Los campos del formulario se cargarán automáticamente en PDFViewer
      emit('loaded')
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

</style>
