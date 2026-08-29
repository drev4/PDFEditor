<template>
  <div class="dashboard-view h-screen flex flex-col bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
    <!-- Modern Header -->
    <header class="bg-white/80 backdrop-blur-lg border-b border-gray-200/50 shadow-sm sticky top-0 z-40">
      <div class="container mx-auto px-6 py-4">
        <div class="flex items-center justify-between">
          <!-- Logo and Brand -->
          <div class="flex items-center gap-3">
            <!-- Mobile Menu Toggle -->
            <Button
              icon="pi pi-bars"
              text
              rounded
              class="lg:hidden text-gray-600"
              @click="mobileMenuVisible = true"
            />

            <div class="bg-gradient-to-br from-blue-600 to-indigo-600 p-2.5 rounded-xl shadow-lg">
              <i class="pi pi-file-pdf text-white text-2xl"></i>
            </div>
            <div class="hidden sm:block">
              <h1 class="text-2xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                PDF Editor Pro
              </h1>
              <p class="text-xs text-gray-500 font-medium">Professional PDF Editing Suite</p>
            </div>
          </div>

          <!-- User Actions -->
          <div class="flex items-center gap-2 sm:gap-3">
            <!-- User Info (Hidden on very small screens) -->
            <div class="text-right mr-2 hidden md:block">
              <p class="text-sm font-medium text-gray-800">{{ authStore.user?.name || authStore.user?.email }}</p>
              <p class="text-xs text-gray-500">{{ authStore.user?.email }}</p>
            </div>

            <!-- Separator -->
            <div class="h-8 w-px bg-gray-300 hidden sm:block"></div>

            <!-- My Forms Button -->
            <Button
              icon="pi pi-list"
              v-tooltip.bottom="'My Forms'"
              @click="router.push('/dashboard/forms')"
              severity="primary"
              outlined
              size="small"
              class="hidden sm:flex"
            />

            <!-- Upload & Close buttons -->
            <FileUploader v-if="!documentStore.activeDocument" />
            <template v-else>
              <!-- Show close button on all screens if doc active -->
              <Button
                icon="pi pi-times"
                @click="closeDocument"
                severity="secondary"
                outlined
                size="small"
                v-tooltip.bottom="'Close Document'"
              />
            </template>

            <router-link to="/dashboard/team">
              <Button
                icon="pi pi-users"
                severity="secondary"
                outlined
                size="small"
                v-tooltip.bottom="'Team'"
                data-testid="team-link"
              />
            </router-link>

            <!-- Logout Button -->
            <Button
              icon="pi pi-sign-out"
              @click="handleLogout"
              severity="danger"
              outlined
              size="small"
              v-tooltip.bottom="'Logout'"
              class="hidden sm:flex"
              data-testid="logout-button"
              aria-label="Logout"
            />
          </div>
        </div>
      </div>
    </header>

    <!-- Drawer for Mobile Sidebar -->
    <Drawer v-model:visible="mobileMenuVisible" header="Dashboard Menu" class="w-80">
      <div class="flex flex-col h-full">
        <TabView class="flex-1 flex flex-col sidebar-tabs">
          <TabPanel value="0" header="Docs">
            <DocumentsList @select="mobileMenuVisible = false" />
          </TabPanel>
          <TabPanel value="1" header="Forms">
            <FormsList @select="mobileMenuVisible = false" />
          </TabPanel>
          <TabPanel value="2" header="Pages">
            <PageThumbnails :pdf-doc="pdfViewerRef?.pdfDoc || null" />
          </TabPanel>
        </TabView>
        
        <div class="p-4 border-t border-gray-100 flex flex-col gap-2">
            <Button 
                label="Logout" 
                icon="pi pi-sign-out" 
                severity="danger" 
                text 
                @click="handleLogout" 
                class="w-full justify-start"
            />
        </div>
      </div>
    </Drawer>

    <!-- Main Content -->
    <main class="flex-1 flex overflow-hidden">
      <!-- Welcome Screen - Show when no documents are loaded -->
      <div
        v-if="!documentStore.hasDocuments"
        class="flex-1 flex items-center justify-center p-4 sm:p-8 overflow-y-auto"
      >
        <div class="max-w-2xl w-full">
          <!-- Hero Section -->
          <div class="text-center mb-8 sm:mb-12 animate-fade-in">
            <div class="inline-flex items-center justify-center w-20 h-20 sm:w-24 sm:h-24 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-3xl shadow-2xl mb-6 animate-float">
              <i class="pi pi-file-pdf text-white text-4xl sm:text-5xl"></i>
            </div>
            <h2 class="text-3xl sm:text-4xl font-bold text-gray-800 mb-4">
              Welcome back
            </h2>
            <p class="text-base sm:text-lg text-gray-600 max-w-xl mx-auto leading-relaxed">
              Continue editing your PDF documents or manage your active forms.
            </p>
          </div>

          <!-- Upload Area -->
          <div class="bg-white rounded-2xl shadow-xl border border-gray-200 p-6 sm:p-8 mb-8 hover:shadow-2xl transition-shadow">
            <div class="border-3 border-dashed border-blue-300 rounded-xl p-8 sm:p-12 text-center bg-gradient-to-br from-blue-50 to-indigo-50 hover:border-blue-400 transition-colors">
              <i class="pi pi-cloud-upload text-5xl sm:text-6xl text-blue-600 mb-4 block"></i>
              <h3 class="text-lg sm:text-xl font-semibold text-gray-800 mb-2">
                Upload New PDF
              </h3>
              <p class="text-sm text-gray-600 mb-6">
                Select a file to start editing
              </p>
              <FileUploader class="inline-block" />
            </div>
          </div>
        </div>
      </div>

      <!-- Document Workspace - Show when documents are loaded -->
      <template v-else>
        <!-- Left Sidebar - Tabbed View (Hidden on mobile, using Drawer instead) -->
        <aside class="hidden lg:flex w-72 bg-white/80 backdrop-blur-lg border-r border-gray-200/50 overflow-hidden flex-col">
          <TabView class="flex-1 flex flex-col sidebar-tabs">
            <TabPanel value="0" header="Documents" class="flex-1">
              <DocumentsList />
            </TabPanel>
            <TabPanel value="1" header="Forms" class="flex-1">
              <FormsList />
            </TabPanel>
            <TabPanel value="2" header="Pages" class="flex-1">
              <PageThumbnails :pdf-doc="pdfViewerRef?.pdfDoc || null" />
            </TabPanel>
          </TabView>
        </aside>

        <!-- Center - PDF Viewer -->
        <div class="flex-1 flex overflow-hidden flex-col md:flex-row">
          <div class="flex-1 relative">
            <PDFViewer ref="pdfViewerRef" />
          </div>

          <!-- Right Sidebar - Editor Tools (Stack on smaller screens if needed, or hide) -->
          <aside v-if="documentStore.activeDocument" class="flex">
            <PDFEditor />
            <!-- Field Properties Panel (shows when a field is selected or fields exist) -->
            <FieldPropertiesPanel 
                v-if="formFieldsStore.fields.length > 0 || formFieldsStore.selectedField" 
                class="hidden xl:flex"
            />
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

    <!-- Toast -->
    <Toast position="top-right" />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useToast } from 'primevue/usetoast'
import Button from 'primevue/button'
import Drawer from 'primevue/drawer'
import ProgressSpinner from 'primevue/progressspinner'
import Toast from 'primevue/toast'
import TabView from 'primevue/tabview'
import TabPanel from 'primevue/tabpanel'
import { useAuthStore } from '@/stores/auth.store'
import { useDocumentStore } from '@/stores/document.store'
import { useFormFieldsStore } from '@/stores/formFields.store'
import { useFormsStore } from '@/stores/forms.store'
import { useFieldsErrorHandler } from '@/composables/useFieldsErrorHandler'
import PDFViewer from '@/components/pdf/PDFViewer.vue'
import PDFEditor from '@/components/editor/PDFEditor.vue'
import FileUploader from '@/components/ui/FileUploader.vue'
import DocumentsList from '@/components/pdf/DocumentsList.vue'
import FormsList from '@/components/forms/FormsList.vue'
import PageThumbnails from '@/components/pdf/PageThumbnails.vue'
import FieldPropertiesPanel from '@/components/form-fields/FieldPropertiesPanel.vue'

const authStore = useAuthStore()
const documentStore = useDocumentStore()
const formFieldsStore = useFormFieldsStore()
const formsStore = useFormsStore()
const router = useRouter()
const toast = useToast()
const pdfViewerRef = ref<InstanceType<typeof PDFViewer> | null>(null)

const mobileMenuVisible = ref(false)

// Initialize error handler for fields
useFieldsErrorHandler()

const showSidebar = computed(() => {
  return documentStore.hasDocuments || formsStore.formsCount > 0 || formsStore.loading
})

onMounted(() => {
  formsStore.fetchForms()
})

const closeDocument = () => {
  if (documentStore.activeDocumentId) {
    documentStore.closeDocument(documentStore.activeDocumentId)
  }
}

const handleLogout = async () => {
  // Awaited so the session is revoked server-side before navigating. The store
  // clears local state synchronously either way, but the toast should not claim
  // a logout that has not been asked for yet.
  await authStore.logout()
  toast.add({
    severity: 'info',
    summary: 'Logged out',
    detail: 'You have been logged out successfully',
    life: 3000
  })
  router.push('/login')
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
