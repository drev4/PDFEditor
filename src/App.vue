<template>
  <div class="app-container h-screen flex flex-col bg-gray-50">
    <!-- Header -->
    <header class="bg-gradient-to-r from-blue-600 to-blue-800 text-white shadow-lg">
      <div class="container mx-auto px-4 py-4">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <i class="pi pi-file-pdf text-3xl"></i>
            <div>
              <h1 class="text-2xl font-bold">VuePDF Editor</h1>
              <p class="text-sm text-blue-100">View and Edit PDFs with ease</p>
            </div>
          </div>

          <div class="flex items-center gap-3">
            <FileUploader />
            <Button
              v-if="pdfStore.activeDocument"
              icon="pi pi-times"
              label="Close"
              @click="closeDocument"
              severity="secondary"
              outlined
            />
          </div>
        </div>
      </div>
    </header>

    <!-- Main Content -->
    <main class="flex-1 flex overflow-hidden">
      <!-- Left Sidebar - Document List -->
      <aside
        v-if="pdfStore.hasDocuments"
        class="w-64 bg-white border-r shadow-sm overflow-y-auto"
      >
        <div class="p-4">
          <h3 class="text-sm font-semibold text-gray-600 uppercase mb-3">
            Open Documents
          </h3>
          <div class="space-y-2">
            <div
              v-for="doc in pdfStore.documents"
              :key="doc.id"
              @click="pdfStore.setActiveDocument(doc.id)"
              :class="[
                'p-3 rounded-lg cursor-pointer transition-all',
                doc.id === pdfStore.activeDocumentId
                  ? 'bg-blue-50 border-2 border-blue-500'
                  : 'bg-gray-50 border-2 border-transparent hover:border-gray-300'
              ]"
            >
              <div class="flex items-start gap-2">
                <i class="pi pi-file-pdf text-red-500 text-xl"></i>
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium text-gray-900 truncate">
                    {{ doc.name }}
                  </p>
                  <p class="text-xs text-gray-500">
                    {{ doc.numPages }} pages
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <!-- Center - PDF Viewer -->
      <div class="flex-1 flex">
        <div class="flex-1">
          <PDFViewer />
        </div>

        <!-- Right Sidebar - Editor Tools -->
        <aside v-if="pdfStore.activeDocument">
          <PDFEditor />
        </aside>
      </div>
    </main>

    <!-- Loading Overlay -->
    <div
      v-if="pdfStore.isLoading"
      class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
    >
      <div class="bg-white rounded-lg p-6 shadow-xl">
        <ProgressSpinner />
        <p class="mt-4 text-gray-700">Loading PDF...</p>
      </div>
    </div>

    <!-- Error Toast -->
    <Toast position="top-right" />
  </div>
</template>

<script setup lang="ts">
import { watch } from 'vue'
import { useToast } from 'primevue/usetoast'
import Button from 'primevue/button'
import ProgressSpinner from 'primevue/progressspinner'
import Toast from 'primevue/toast'
import { usePdfStore } from '@/stores/pdfStore'
import PDFViewer from '@/components/PDFViewer.vue'
import PDFEditor from '@/components/PDFEditor.vue'
import FileUploader from '@/components/FileUploader.vue'

const pdfStore = usePdfStore()
const toast = useToast()

const closeDocument = () => {
  if (pdfStore.activeDocumentId) {
    pdfStore.closeDocument(pdfStore.activeDocumentId)
  }
}

// Watch for errors
watch(() => pdfStore.error, (error) => {
  if (error) {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: error,
      life: 3000
    })
    pdfStore.clearError()
  }
})
</script>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

.app-container {
  font-family: system-ui, -apple-system, sans-serif;
}
</style>
