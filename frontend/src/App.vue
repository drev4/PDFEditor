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
            <FileUploader v-if="!documentStore.activeDocument" />
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
        v-if="!documentStore.hasDocuments"
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
        <!-- Left Sidebar - Tabbed View -->
        <aside class="w-72 bg-white/80 backdrop-blur-lg border-r border-gray-200/50 overflow-hidden flex flex-col">
          <TabView class="flex-1 flex flex-col sidebar-tabs">
            <TabPanel value="0" header="Documents" class="flex-1">
              <DocumentsList />
            </TabPanel>
            <TabPanel value="1" header="Pages" class="flex-1">
              <PageThumbnails :pdf-doc="pdfViewerRef?.pdfDoc || null" />
            </TabPanel>
          </TabView>
        </aside>

        <!-- Center - PDF Viewer -->
        <div class="flex-1 flex">
          <div class="flex-1">
            <PDFViewer ref="pdfViewerRef" />
          </div>

          <!-- Right Sidebar - Editor Tools -->
          <aside v-if="documentStore.activeDocument" class="flex">
            <PDFEditor />
            <!-- Field Properties Panel (shows when a field is selected or fields exist) -->
            <FieldPropertiesPanel v-if="formFieldsStore.fields.length > 0 || formFieldsStore.selectedField" />
          </aside>
        </div>
      </template>
    </main>

    <!-- Loading Overlay -->
    <div
      v-if="documentStore.isLoading"
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
import { ref, watch } from 'vue'
import { useToast } from 'primevue/usetoast'
import Button from 'primevue/button'
import ProgressSpinner from 'primevue/progressspinner'
import Toast from 'primevue/toast'
import TabView from 'primevue/tabview'
import TabPanel from 'primevue/tabpanel'
import { useDocumentStore } from '@/stores/document.store'
import { useFormFieldsStore } from '@/stores/formFields.store'
import PDFViewer from '@/components/pdf/PDFViewer.vue'
import PDFEditor from '@/components/editor/PDFEditor.vue'
import FileUploader from '@/components/ui/FileUploader.vue'
import DocumentsList from '@/components/pdf/DocumentsList.vue'
import PageThumbnails from '@/components/pdf/PageThumbnails.vue'
import FieldPropertiesPanel from '@/components/form-fields/FieldPropertiesPanel.vue'

const documentStore = useDocumentStore()
const formFieldsStore = useFormFieldsStore()
const toast = useToast()
const pdfViewerRef = ref<InstanceType<typeof PDFViewer> | null>(null)

const closeDocument = () => {
  if (documentStore.activeDocumentId) {
    documentStore.closeDocument(documentStore.activeDocumentId)
  }
}

// Watch for errors
watch(() => documentStore.error, (error) => {
  if (error) {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: error,
      life: 3000
    })
    documentStore.clearError()
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

/* Custom styles for sidebar tabs */
.sidebar-tabs {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.sidebar-tabs :deep(.p-tabview-nav-container) {
  background: transparent;
  border-bottom: 1px solid rgba(229, 231, 235, 0.5);
  padding: 0 1rem;
}

.sidebar-tabs :deep(.p-tabview-nav) {
  background: transparent;
  border: none;
  gap: 0.5rem;
}

.sidebar-tabs :deep(.p-tabview-nav-link) {
  background: transparent;
  border: none;
  color: #6b7280;
  padding: 0.75rem 1rem;
  transition: all 0.2s;
  font-weight: 500;
  font-size: 0.875rem;
}

.sidebar-tabs :deep(.p-tabview-nav-link:hover) {
  color: #2563eb;
  background: rgba(37, 99, 235, 0.05);
  border-radius: 0.5rem;
}

.sidebar-tabs :deep(.p-highlight .p-tabview-nav-link) {
  color: #2563eb;
  border-bottom: 2px solid #2563eb;
  background: transparent;
}

.sidebar-tabs :deep(.p-tabview-panels) {
  background: transparent;
  padding: 0;
  flex: 1;
  overflow: hidden;
  border: none;
  display: flex;
  flex-direction: column;
}

.sidebar-tabs :deep(.p-tabview-panel) {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
</style>
