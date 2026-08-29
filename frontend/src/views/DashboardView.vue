<template>
  <div class="dashboard-view h-screen flex flex-col bg-surface">
    <!-- Top bar. The Editor artboard gives this 54px, a quiet document title
         and controls that stay neutral so the page itself is the loud thing. -->
    <header
      class="flex items-center gap-3.5 h-[54px] flex-shrink-0 px-4 border-b border-line bg-surface"
    >
      <Button
        icon="pi pi-bars"
        text
        rounded
        size="small"
        class="lg:hidden"
        aria-label="Menu"
        @click="mobileMenuVisible = true"
      />

      <BrandMark class="hidden sm:flex" />

      <div v-if="documentStore.activeDocument" class="flex items-center gap-2.5 min-w-0">
        <div class="w-px h-[22px] bg-line hidden sm:block" />
        <span class="text-base font-medium truncate max-w-[280px]">
          {{ documentStore.activeDocument.name }}
        </span>
      </div>

      <div class="flex-grow" />

      <RouterLink
        to="/dashboard/forms"
        class="hidden sm:flex items-center gap-1.5 h-control-xs px-3 rounded-control border border-line text-body font-medium text-ink hover:bg-surface-sunken transition-colors"
      >
        <i class="pi pi-file text-[13px]" />
        <span>Forms</span>
      </RouterLink>

      <RouterLink
        to="/dashboard/team"
        class="hidden sm:flex items-center gap-1.5 h-control-xs px-3 rounded-control border border-line text-body font-medium text-ink hover:bg-surface-sunken transition-colors"
        data-testid="team-link"
      >
        <i class="pi pi-users text-[13px]" />
        <span>Members</span>
      </RouterLink>

      <FileUploader v-if="!documentStore.activeDocument" />
      <button
        v-else
        type="button"
        class="flex items-center justify-center w-control-xs h-control-xs rounded-control border border-line text-muted hover:text-ink hover:bg-surface-sunken transition-colors"
        aria-label="Close document"
        v-tooltip.bottom="'Close document'"
        @click="closeDocument"
      >
        <i class="pi pi-times text-[13px]" />
      </button>

      <div class="w-px h-[22px] bg-line" />

      <div class="hidden md:block text-right">
        <p class="text-meta text-muted truncate max-w-[180px]">
          {{ authStore.user?.email }}
        </p>
      </div>

      <button
        type="button"
        class="flex items-center justify-center w-control-xs h-control-xs rounded-control border border-line text-muted hover:text-danger hover:border-danger transition-colors"
        data-testid="logout-button"
        aria-label="Logout"
        v-tooltip.bottom="'Log out'"
        @click="handleLogout"
      >
        <i class="pi pi-sign-out text-[13px]" />
      </button>
    </header>

    <!-- Mobile rail -->
    <Drawer v-model:visible="mobileMenuVisible" header="Document" class="w-80">
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

        <div class="p-4 border-t border-line">
          <Button
            label="Log out"
            icon="pi pi-sign-out"
            severity="danger"
            text
            class="w-full justify-start"
            @click="handleLogout"
          />
        </div>
      </div>
    </Drawer>

    <main class="flex-1 flex overflow-hidden">
      <!-- Empty state. The canvas draws this as a dashed dropzone on the Forms
           screen, in the same restrained language: no hero, no gradient. -->
      <div
        v-if="!documentStore.hasDocuments"
        class="flex-1 flex items-center justify-center p-6 bg-surface-sunken overflow-y-auto"
      >
        <div class="w-full max-w-[520px]">
          <h1 class="text-title">Start a form</h1>
          <p class="mt-1 text-body text-muted">
            Upload a PDF, place the fields, share the link.
          </p>

          <div
            class="mt-6 flex flex-col items-center justify-center gap-3 py-10 px-6 rounded-card border border-dashed border-line-strong bg-surface text-center"
          >
            <i class="pi pi-cloud-upload text-[22px] text-faint" />
            <p class="text-body text-muted">
              Drop a PDF here, or browse. Existing PDF forms keep their fields.
            </p>
            <FileUploader class="inline-block" />
          </div>
        </div>
      </div>

      <template v-else>
        <aside
          class="hidden lg:flex w-rail flex-shrink-0 bg-surface-subtle border-r border-line overflow-hidden flex-col"
        >
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

        <div class="flex-1 flex overflow-hidden flex-col md:flex-row min-w-0">
          <div class="flex-1 relative bg-surface-sunken min-w-0">
            <PDFViewer ref="pdfViewerRef" />
          </div>

          <aside v-if="documentStore.activeDocument" class="flex">
            <PDFEditor />
            <FieldPropertiesPanel
              v-if="formFieldsStore.fields.length > 0 || formFieldsStore.selectedField"
              class="hidden xl:flex"
            />
          </aside>
        </div>
      </template>
    </main>

    <div
      v-if="documentStore.isLoading"
      class="fixed inset-0 bg-ink/40 flex items-center justify-center z-50"
    >
      <div class="bg-surface rounded-card border border-line shadow-menu px-8 py-7 text-center">
        <ProgressSpinner style="width: 34px; height: 34px" strokeWidth="4" />
        <p class="mt-5 text-body font-medium">Loading your PDF</p>
        <p class="text-meta text-muted mt-1">This takes a moment for a large file.</p>
      </div>
    </div>

    <Toast position="top-right" />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
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
import BrandMark from '@/components/ui/BrandMark.vue'
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

<style scoped>
.sidebar-tabs {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.sidebar-tabs :deep(.p-tabview-nav-container) {
  background: transparent;
  border-bottom: 1px solid theme('colors.line.DEFAULT');
  padding: 0 0.75rem;
}

.sidebar-tabs :deep(.p-tabview-nav) {
  background: transparent;
  border: none;
  gap: 0.25rem;
}

.sidebar-tabs :deep(.p-tabview-nav-link) {
  background: transparent;
  border: none;
  color: theme('colors.muted');
  padding: 0.6rem 0.5rem;
  font-weight: 500;
  font-size: 12.5px;
}

.sidebar-tabs :deep(.p-highlight .p-tabview-nav-link) {
  color: theme('colors.ink');
  border-bottom: 1.5px solid theme('colors.ink');
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
