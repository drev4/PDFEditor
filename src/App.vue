<template>
  <div class="app-container h-screen flex flex-col bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
    <!-- Modern Header -->
    <header class="bg-white/80 backdrop-blur-lg border-b border-gray-200/50 shadow-sm sticky top-0 z-40">
      <div class="container mx-auto px-6 py-4">
        <div class="flex items-center justify-between">
          <!-- Logo and Brand -->
          <div class="flex items-center gap-3">
            <div class="bg-gradient-to-br from-blue-600 to-indigo-600 p-2.5 rounded-xl shadow-lg">
              <i class="pi pi-file-pdf text-white text-2xl"></i>
            </div>
            <div>
              <h1 class="text-2xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                PDF Editor Pro
              </h1>
              <p class="text-xs text-gray-500 font-medium">Professional PDF Editing Suite</p>
            </div>
          </div>

          <!-- Actions -->
          <div class="flex items-center gap-3">
            <FileUploader v-if="!pdfStore.activeDocument" />
            <template v-else>
              <FileUploader />
              <Button
                icon="pi pi-times"
                label="Close Document"
                @click="closeDocument"
                severity="secondary"
                outlined
                size="small"
              />
            </template>
          </div>
        </div>
      </div>
    </header>

    <!-- Main Content -->
    <main class="flex-1 flex overflow-hidden">
      <!-- Welcome Screen - Show when no documents -->
      <div
        v-if="!pdfStore.hasDocuments"
        class="flex-1 flex items-center justify-center p-8"
      >
        <div class="max-w-2xl w-full">
          <!-- Hero Section -->
          <div class="text-center mb-12 animate-fade-in">
            <div class="inline-flex items-center justify-center w-24 h-24 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-3xl shadow-2xl mb-6 animate-float">
              <i class="pi pi-file-pdf text-white text-5xl"></i>
            </div>
            <h2 class="text-4xl font-bold text-gray-800 mb-4">
              Welcome to PDF Editor Pro
            </h2>
            <p class="text-lg text-gray-600 max-w-xl mx-auto leading-relaxed">
              Your all-in-one solution for viewing, editing, and managing PDF documents with professional-grade tools
            </p>
          </div>

          <!-- Upload Area -->
          <div class="bg-white rounded-2xl shadow-xl border border-gray-200 p-8 mb-8 hover:shadow-2xl transition-shadow">
            <div class="border-3 border-dashed border-blue-300 rounded-xl p-12 text-center bg-gradient-to-br from-blue-50 to-indigo-50 hover:border-blue-400 transition-colors">
              <i class="pi pi-cloud-upload text-6xl text-blue-600 mb-4 block"></i>
              <h3 class="text-xl font-semibold text-gray-800 mb-2">
                Upload Your PDF
              </h3>
              <p class="text-gray-600 mb-6">
                Drag and drop or click to select a PDF file
              </p>
              <FileUploader class="inline-block" />
              <p class="text-sm text-gray-500 mt-4">
                Maximum file size: 50MB
              </p>
            </div>
          </div>

          <!-- Features Grid -->
          <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div class="bg-white rounded-xl p-6 shadow-lg border border-gray-100 hover:shadow-xl transition-all hover:-translate-y-1">
              <div class="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mb-4">
                <i class="pi pi-eye text-blue-600 text-2xl"></i>
              </div>
              <h4 class="font-semibold text-gray-800 mb-2">View & Navigate</h4>
              <p class="text-sm text-gray-600">
                Smooth PDF viewing with zoom, rotation, and page navigation
              </p>
            </div>

            <div class="bg-white rounded-xl p-6 shadow-lg border border-gray-100 hover:shadow-xl transition-all hover:-translate-y-1">
              <div class="w-12 h-12 bg-indigo-100 rounded-lg flex items-center justify-center mb-4">
                <i class="pi pi-pencil text-indigo-600 text-2xl"></i>
              </div>
              <h4 class="font-semibold text-gray-800 mb-2">Edit Content</h4>
              <p class="text-sm text-gray-600">
                Add text, images, and annotations with precision tools
              </p>
            </div>

            <div class="bg-white rounded-xl p-6 shadow-lg border border-gray-100 hover:shadow-xl transition-all hover:-translate-y-1">
              <div class="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mb-4">
                <i class="pi pi-download text-purple-600 text-2xl"></i>
              </div>
              <h4 class="font-semibold text-gray-800 mb-2">Export & Save</h4>
              <p class="text-sm text-gray-600">
                Download your edited PDFs with all changes preserved
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- Document Workspace - Show when documents are loaded -->
      <template v-else>
        <!-- Left Sidebar - Document List -->
        <aside class="w-72 bg-white/80 backdrop-blur-lg border-r border-gray-200/50 overflow-y-auto">
          <div class="p-6">
            <div class="flex items-center justify-between mb-4">
              <h3 class="text-sm font-bold text-gray-700 uppercase tracking-wide">
                Documents
              </h3>
              <span class="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full font-semibold">
                {{ pdfStore.documents.length }}
              </span>
            </div>
            <div class="space-y-3">
              <div
                v-for="doc in pdfStore.documents"
                :key="doc.id"
                @click="pdfStore.setActiveDocument(doc.id)"
                :class="[
                  'group p-4 rounded-xl cursor-pointer transition-all duration-200',
                  doc.id === pdfStore.activeDocumentId
                    ? 'bg-gradient-to-r from-blue-600 to-indigo-600 shadow-lg scale-105'
                    : 'bg-gray-50 hover:bg-gray-100 hover:shadow-md'
                ]"
              >
                <div class="flex items-start gap-3">
                  <div :class="[
                    'w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0',
                    doc.id === pdfStore.activeDocumentId
                      ? 'bg-white/20'
                      : 'bg-red-100'
                  ]">
                    <i :class="[
                      'pi pi-file-pdf text-xl',
                      doc.id === pdfStore.activeDocumentId
                        ? 'text-white'
                        : 'text-red-500'
                    ]"></i>
                  </div>
                  <div class="flex-1 min-w-0">
                    <p :class="[
                      'text-sm font-semibold truncate',
                      doc.id === pdfStore.activeDocumentId
                        ? 'text-white'
                        : 'text-gray-900'
                    ]">
                      {{ doc.name }}
                    </p>
                    <p :class="[
                      'text-xs mt-1',
                      doc.id === pdfStore.activeDocumentId
                        ? 'text-blue-100'
                        : 'text-gray-500'
                    ]">
                      {{ doc.numPages }} pages
                    </p>
                  </div>
                  <Button
                    v-if="doc.id === pdfStore.activeDocumentId"
                    icon="pi pi-times"
                    @click.stop="pdfStore.closeDocument(doc.id)"
                    text
                    rounded
                    severity="secondary"
                    size="small"
                    class="opacity-0 group-hover:opacity-100 transition-opacity"
                  />
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
      </template>
    </main>

    <!-- Loading Overlay -->
    <div
      v-if="pdfStore.isLoading"
      class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
    >
      <div class="bg-white rounded-2xl p-8 shadow-2xl max-w-sm text-center">
        <ProgressSpinner />
        <p class="mt-6 text-gray-700 font-medium">Loading your PDF...</p>
        <p class="text-sm text-gray-500 mt-2">Please wait a moment</p>
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
