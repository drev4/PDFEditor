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
        aria-label="Menu"
        data-testid="editor-menu-button"
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
        to="/dashboard"
        class="hidden sm:flex items-center gap-1.5 h-control-xs px-3 rounded-control border border-line text-body font-medium text-ink hover:bg-surface-sunken transition-colors"
        data-testid="back-to-forms"
      >
        <i class="pi pi-arrow-left text-[12px]" />
        <span>Forms</span>
      </RouterLink>

      <!-- The one action that gets the work out of the product. It was at the
           bottom of a side panel; this is where the Editor artboard puts the
           document-level actions. -->
      <button
        v-if="documentStore.activeDocument"
        type="button"
        class="flex items-center gap-1.5 h-control-xs px-3 rounded-control border border-line text-body font-medium text-ink hover:bg-surface-sunken transition-colors"
        data-testid="download-pdf-button"
        @click="downloadPDF"
      >
        <i class="pi pi-download text-[13px]" />
        <span class="hidden sm:inline">Download</span>
      </button>

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
    <!--
      The menu button opens the application's navigation — the same four
      destinations as the dashboard sidebar, from a single definition. It used
      to open the editor's own rail, so from inside a form there was no way to
      get anywhere else without going through the back link first.

      Below `lg` the rail cannot sit beside the document either, so it rides
      along underneath. That is the only reason it is ever collapsed.
    -->
    <Drawer
      v-model:visible="mobileMenuVisible"
      class="w-80 app-drawer"
      :showHeader="false"
    >
      <div class="flex flex-col h-full">
        <!-- Its own header, so the panel opens with the product's mark rather
             than the component's default bar. -->
        <div class="flex items-center gap-3 px-1 pb-5">
          <BrandMark />
          <div class="flex-grow" />
          <button
            type="button"
            class="flex items-center justify-center w-8 h-8 rounded-input text-faint hover:text-ink hover:bg-surface-sunken transition-colors"
            aria-label="Close menu"
            @click="mobileMenuVisible = false"
          >
            <i class="pi pi-times text-[13px]" />
          </button>
        </div>

        <nav class="flex flex-col gap-1 pb-5">
          <RouterLink
            v-for="item in navItems"
            :key="item.to"
            :to="item.to"
            class="group flex items-center gap-3 h-11 px-2.5 rounded-card text-row font-medium text-ink hover:bg-accent-soft transition-colors"
            @click="mobileMenuVisible = false"
          >
            <!-- The tinted tile is the one bit of colour in the panel. It reads
                 as a destination rather than a list item, which is what makes
                 this feel like a way out of the editor. -->
            <span
              class="flex items-center justify-center w-8 h-8 rounded-input bg-surface-sunken text-muted
                     group-hover:bg-accent group-hover:text-white transition-colors"
            >
              <i :class="item.icon" class="text-[13px]" />
            </span>
            <span>{{ item.label }}</span>
            <span class="flex-grow" />
            <i class="pi pi-angle-right text-[12px] text-faint group-hover:text-accent transition-colors" />
          </RouterLink>
        </nav>

        <div class="h-px bg-line" />

        <EditorRail
          class="flex flex-1 lg:hidden w-full border-r-0 bg-transparent"
          :pdf-doc="pdfViewerRef?.pdfDoc || null"
        />

        <div class="pt-4 mt-auto border-t border-line">
          <button
            type="button"
            class="flex items-center gap-3 w-full h-11 px-2.5 rounded-card text-row font-medium text-muted hover:text-danger hover:bg-danger-soft transition-colors"
            @click="handleLogout"
          >
            <span class="flex items-center justify-center w-8 h-8 rounded-input bg-surface-sunken">
              <i class="pi pi-sign-out text-[13px]" />
            </span>
            <span>Log out</span>
          </button>
        </div>
      </div>
    </Drawer>

    <main class="flex-1 flex overflow-hidden">
      <!-- The left rail is the editor's own furniture and is always here, the
           way the Editor artboard draws it. It used to appear only once a
           document was open, so the screen you land on had no structure at all
           and no way to reach a document from inside the editor. -->
      <EditorRail
        class="hidden lg:flex"
        :pdf-doc="pdfViewerRef?.pdfDoc || null"
      />

      <!-- Empty state: same restrained language as the Forms dropzone. -->
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

      <div v-else class="flex-1 flex overflow-hidden flex-col md:flex-row min-w-0">
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

    <UnsavedChangesDialog
      :visible="leaveDialog.visible"
      :title="leaveDialogCopy.title"
      :message="leaveDialogCopy.message"
      :saving="leaveDialog.saving"
      @save="handleLeaveSave"
      @discard="handleLeaveDiscard"
      @cancel="handleLeaveCancel"
    />

    <Toast position="top-right" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { RouterLink, useRouter, onBeforeRouteLeave, type RouteLocationRaw } from 'vue-router'
import { useToast } from 'primevue/usetoast'
import Button from 'primevue/button'
import Drawer from 'primevue/drawer'
import ProgressSpinner from 'primevue/progressspinner'
import Toast from 'primevue/toast'
import { useAuthStore } from '@/stores/auth.store'
import { useDocumentStore } from '@/stores/document.store'
import { useFormFieldsStore } from '@/stores/formFields.store'
import { useFormsStore } from '@/stores/forms.store'
import { useFormManagement } from '@/composables/useFormManagement'
import { useFieldsErrorHandler } from '@/composables/useFieldsErrorHandler'
import PDFViewer from '@/components/pdf/PDFViewer.vue'
import PDFEditor from '@/components/editor/PDFEditor.vue'
import EditorRail from '@/components/editor/EditorRail.vue'
import FileUploader from '@/components/ui/FileUploader.vue'
import BrandMark from '@/components/ui/BrandMark.vue'
import UnsavedChangesDialog from '@/components/ui/UnsavedChangesDialog.vue'
import { useAppNav } from '@/composables/useAppNav'
import { useDownloadPDF } from '@/composables/useDownloadPDF'
import FieldPropertiesPanel from '@/components/form-fields/FieldPropertiesPanel.vue'

const authStore = useAuthStore()
const documentStore = useDocumentStore()
const formFieldsStore = useFormFieldsStore()
const formsStore = useFormsStore()
const formManagement = useFormManagement()
const { navItems } = useAppNav()
const { downloadPDF } = useDownloadPDF()
const router = useRouter()
const toast = useToast()
const pdfViewerRef = ref<InstanceType<typeof PDFViewer> | null>(null)

const mobileMenuVisible = ref(false)

// Initialize error handler for fields
useFieldsErrorHandler()

/**
 * There are two different ways to lose work here, and both have to be caught.
 *
 *  - Edits from the text and image tools live in the browser until `Save all`.
 *  - A PDF that has been opened but never given a field has no form row at
 *    all, so closing the editor throws the whole document away. Saving it with
 *    no fields is a perfectly reasonable thing to want, and used to be
 *    impossible.
 */
const hasUnsavedWork = computed(
  () => !!documentStore.activeDocument && (
    documentStore.hasUnsavedEdits ||
    formFieldsStore.hasUnsavedChanges ||
    !formFieldsStore.currentFormId
  )
)

const leaveDialog = ref<{ visible: boolean; saving: boolean; to: RouteLocationRaw | null }>({
  visible: false,
  saving: false,
  to: null
})

const leaveDialogCopy = computed(() => {
  if (!formFieldsStore.currentFormId) {
    return {
      title: 'This document is not saved',
      message:
        'It has not been stored yet, so leaving now discards it. Saving keeps the PDF — it does not need any fields.'
    }
  }
  return {
    title: 'You have unsaved changes',
    message:
      'The fields, text and images you changed are only in this browser. Leaving now discards them.'
  }
})

// The browser's own prompt, for closing the tab. It cannot be styled and cannot
// offer to save; it is the last resort, not the main path.
const warnOnUnload = (event: BeforeUnloadEvent) => {
  if (!hasUnsavedWork.value) return
  event.preventDefault()
  event.returnValue = ''
}

onMounted(() => window.addEventListener('beforeunload', warnOnUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', warnOnUnload))

/**
 * Every in-app navigation out of the editor, whichever control started it —
 * the sidebar, the back link, the browser's back button.
 *
 * `leaveConfirmed` is what lets the second pass through go: the guard runs
 * again after the dialog resolves, and without it the dialog would reopen for
 * the navigation it just approved.
 */
const leaveConfirmed = ref(false)

onBeforeRouteLeave((to) => {
  if (leaveConfirmed.value || !hasUnsavedWork.value) return true

  leaveDialog.value = { visible: true, saving: false, to: to.fullPath }
  return false
})

const proceed = () => {
  const to = leaveDialog.value.to
  leaveConfirmed.value = true
  leaveDialog.value = { visible: false, saving: false, to: null }
  if (to) router.push(to)
}

const handleLeaveSave = async () => {
  leaveDialog.value.saving = true
  try {
    await formManagement.saveDocumentToDatabase()
    await formsStore.fetchForms()
    proceed()
  } catch (err) {
    leaveDialog.value.saving = false
    toast.add({
      severity: 'error',
      summary: 'Could not save',
      detail: err instanceof Error ? err.message : 'The document was not saved, so you are still here.',
      life: 6000
    })
  }
}

const handleLeaveDiscard = () => {
  // The document is being abandoned, so it must not be waiting in the store for
  // whatever screen comes next.
  formManagement.resetEditorSession()
  proceed()
}

const handleLeaveCancel = () => {
  leaveDialog.value = { visible: false, saving: false, to: null }
}

onMounted(() => {
  formsStore.fetchForms()
})

const closeDocument = () => {
  if (!documentStore.activeDocumentId) return

  // Closes the fields and the form with it. Closing only the document left the
  // previous form's fields drawn over whatever PDF was opened next.
  formManagement.resetEditorSession()
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
/* A drawer that feels like part of this product rather than a grey panel:
   the sidebar's own tint, and room for the tiles to breathe. */
.app-drawer :deep(.p-drawer-content) {
  background: theme('colors.surface.subtle');
  padding: 18px 14px;
}
</style>
