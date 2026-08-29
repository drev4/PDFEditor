<template>
  <div class="form-save-panel">
    <!-- Form Info Card -->
    <div v-if="!formFieldsStore.currentFormId" class="tool-card info-card">
      <div class="tool-header">
        <div class="tool-icon bg-limit-soft">
          <i class="pi pi-info-circle text-limit"></i>
        </div>
        <h4 class="tool-title">Save Form</h4>
      </div>
      <div class="tool-body">
        <p class="text-body text-muted mb-4">
          Save this PDF form to the cloud to access it later and share with others.
        </p>

        <InputText
          v-model="formTitle"
          placeholder="Form title..."
          class="w-full mb-3"
        />

        <Textarea
          v-model="formDescription"
          placeholder="Description (optional)..."
          rows="3"
          class="w-full mb-3"
        />

        <div class="flex gap-2 mb-3">
          <Button
            label="Upload PDF"
            icon="pi pi-cloud-upload"
            @click="handleDirectPDFUpload"
            class="flex-1"
            severity="success"
            :loading="isUploadingPDF"
            :disabled="!hasPDFLoaded"
          />
          <Button
            label="Save Form"
            icon="pi pi-save"
            @click="handleSaveForm"
            class="flex-1 save-btn"
            severity="info"
            outlined
            :loading="isUploadingPDF"
            :disabled="!formTitle || !hasPDFLoaded"
          />
        </div>

        <p class="text-meta text-muted">
          <i class="pi pi-info-circle"></i>
          Upload PDF alone or save complete form with fields
        </p>
      </div>
    </div>

    <!-- Already Saved Card -->
    <div v-else class="tool-card success-card">
      <div class="tool-header">
        <div class="tool-icon bg-published-soft">
          <i class="pi pi-check-circle text-published"></i>
        </div>
        <div class="flex-1">
          <h4 class="tool-title">Form Saved</h4>
          <p class="text-meta text-muted">ID: {{ formFieldsStore.currentFormId }}</p>
        </div>
        <Button
          icon="pi pi-times"
          @click="handleNewForm"
          size="small"
          severity="secondary"
          text
          rounded
          v-tooltip.left="'Start new form'"
        />
      </div>
      <div class="tool-body space-y-2">
        <div v-if="currentForm" class="info-box">
          <p class="text-body font-semibold text-ink">{{ currentForm.title }}</p>
          <p v-if="currentForm.description" class="text-meta text-muted">{{ currentForm.description }}</p>
          <p class="text-meta text-muted mt-2">
            {{ currentForm.fields?.length || 0 }} fields • {{ currentForm.status }}
          </p>
        </div>

        <Button
          label="Share Form"
          icon="pi pi-share-alt"
          @click="showShareModal = true"
          class="w-full"
          severity="success"
          :disabled="!currentForm?.pdfUrl"
        />

        <Button
          :label="hasUnsavedWork ? 'Save all (unsaved changes)' : 'Save all'"
          icon="pi pi-save"
          @click="handleUpdateFields"
          class="w-full"
          severity="info"
          :outlined="!hasUnsavedWork"
          :loading="formFieldsStore.loading || isUploadingPDF"
        />

        <!-- The text and image tools change the PDF in the browser and nothing
             is sent until this is pressed, so the editor has to say so. -->
        <p v-if="hasUnsavedWork" class="text-meta text-limit flex items-start gap-1">
          <i class="pi pi-exclamation-circle mt-0.5"></i>
          <span>Your changes are only in this browser. Save all to store them.</span>
        </p>

        <Button
          label="Upload PDF to Server"
          icon="pi pi-cloud-upload"
          @click="handleDirectPDFUpload"
          class="w-full"
          severity="secondary"
          outlined
          :loading="isUploadingPDF"
          :disabled="!hasPDFLoaded"
          v-if="!currentForm?.pdfUrl"
        />

        <p v-if="!currentForm?.pdfUrl" class="text-meta text-limit flex items-center gap-1">
          <i class="pi pi-info-circle"></i>
          Upload PDF first to enable sharing
        </p>

        <div v-else class="info-box bg-accent-soft border-accent">
          <div class="flex items-start gap-2">
            <i class="pi pi-file-pdf text-accent mt-0.5"></i>
            <div class="flex-1 min-w-0">
              <p class="text-meta font-medium text-accent">PDF Uploaded</p>
              <p class="text-meta text-accent truncate">{{ getPDFFilename(currentForm.pdfUrl) }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Share Modal -->
    <ShareFormModal
      v-model:visible="showShareModal"
      :form="currentForm"
      @publish="handlePublish"
      @unpublish="handleUnpublish"
    />

    <!-- Success Toast -->
    <Toast position="top-right" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useToast } from 'primevue/usetoast'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import Toast from 'primevue/toast'
import { useFormFieldsStore } from '@/stores/formFields.store'
import { useFormsStore } from '@/stores/forms.store'
import { useDocumentStore } from '@/stores/document.store'
import { useFormManagement } from '@/composables/useFormManagement'
import { usePDFUpload } from '@/composables/usePDFUpload'
import { formsService } from '@/services/forms'
import ShareFormModal from './ShareFormModal.vue'

const formFieldsStore = useFormFieldsStore()
const formsStore = useFormsStore()
const documentStore = useDocumentStore()
const formManagement = useFormManagement()
const { isUploading: isUploadingPDF, upload: uploadPDF } = usePDFUpload()
const toast = useToast()

const formTitle = ref('')
const formDescription = ref('')
const showShareModal = ref(false)

const hasFields = computed(() => formFieldsStore.fields.length > 0)
const currentForm = computed(() => formsStore.currentForm)
const hasPDFLoaded = computed(() => !!documentStore.activeDocument?.file)

// One notion of "unsaved" for the whole editor: field geometry and document
// bytes are written by different calls but they are one decision to the user.
const hasUnsavedWork = computed(
  () => documentStore.hasUnsavedEdits || formFieldsStore.hasUnsavedChanges
)

// Auto-populate form title from document name and clear form state
watch(() => documentStore.activeDocument, async (doc, oldDoc) => {
  // If document changed (not just first load)
  if (doc && oldDoc && doc.id !== oldDoc.id) {
    // Check if this document has an associated form
    const associatedForm = formsStore.forms.find(f => {
      const pdfFileName = f.pdfUrl?.split('/').pop()
      return pdfFileName === doc.name
    })

    if (associatedForm) {
      // Load the associated form and its fields
      try {
        await formManagement.loadForm(associatedForm.id)
      } catch (error) {
        console.error('Error loading associated form:', error)
      }
    } else {
      // No associated form - clear state for new form
      formFieldsStore.clearFields()
      formFieldsStore.setCurrentForm(null)
      formsStore.currentForm = null
      formTitle.value = ''
      formDescription.value = ''
    }
  }

  // Auto-populate title from document name if empty
  if (doc && !formTitle.value) {
    formTitle.value = doc.name.replace('.pdf', '')
  }
}, { immediate: true })

function handleNewForm() {
  // Clear form state to start new
  formFieldsStore.clearFields()
  formFieldsStore.setCurrentForm(null)
  formsStore.currentForm = null
  formTitle.value = ''
  formDescription.value = ''

  toast.add({
    severity: 'info',
    summary: 'New Form',
    detail: 'Ready to create a new form',
    life: 2000
  })
}

async function handleSaveForm() {
  if (!formTitle.value || !hasPDFLoaded.value) return

  try {
    // Get the current PDF file from document store
    const pdfFile = getPDFFile()

    if (!pdfFile) {
      toast.add({
        severity: 'error',
        summary: 'No PDF',
        detail: 'No PDF file is currently loaded',
        life: 3000
      })
      return
    }

    // Create form and upload PDF
    const form = await formManagement.createFormForCurrentDocument(
      formTitle.value,
      pdfFile,
      formDescription.value || undefined
    )

    toast.add({
      severity: 'success',
      summary: 'Form Saved',
      detail: `Form "${formTitle.value}" has been saved with PDF`,
      life: 3000
    })

    // Load the created form
    formsStore.currentForm = form
  } catch (error) {
    console.error('Error saving form:', error)
    toast.add({
      severity: 'error',
      summary: 'Save Failed',
      detail: error instanceof Error ? error.message : 'Failed to save form',
      life: 5000
    })
  }
}

async function handleUpdateFields() {
  try {
    const fieldCount = formFieldsStore.fields.length
    const hadDocumentEdits = documentStore.hasUnsavedEdits

    await formFieldsStore.saveAllFields()

    // The order matters. Saving the fields embeds them into the PDF on the
    // server, so the document bytes have to go up afterwards or the upload
    // would overwrite that with the browser's copy, which has no AcroForm.
    if (hadDocumentEdits) {
      isUploadingPDF.value = true
      try {
        await formManagement.persistEditedDocument()
        toast.add({
          severity: 'success',
          summary: 'Document saved',
          detail: 'The text and images you added are now stored.',
          life: 3000
        })
      } finally {
        isUploadingPDF.value = false
      }
    }

    // Show enhanced message indicating fields are embedded in PDF
    toast.add({
      severity: 'success',
      summary: 'Fields Saved & Embedded',
      detail: `${fieldCount} field${fieldCount !== 1 ? 's' : ''} saved and embedded in PDF`,
      life: 3000
    })

    // A deleted field that already held responses is archived rather than
    // destroyed. Say so, instead of leaving the user to wonder where the data
    // went or why the field vanished from the editor but not the export.
    const archivedCount = formFieldsStore.archivedFieldIds.length
    if (archivedCount > 0) {
      toast.add({
        severity: 'info',
        summary: 'Responses kept',
        detail: `${archivedCount} deleted field${archivedCount !== 1 ? 's' : ''} had responses. `
          + 'They were removed from the form but their answers are still in your responses and CSV export.',
        life: 8000
      })
      formFieldsStore.clearArchivedFieldIds()
    }
  } catch (error) {
    console.error('Error updating fields:', error)
    toast.add({
      severity: 'error',
      summary: 'Update Failed',
      detail: 'Failed to update fields',
      life: 5000
    })
  }
}

function getPDFFile(): File | null {
  const doc = documentStore.activeDocument
  if (!doc?.file) return null
  return doc.file
}

function getPDFFilename(url: string): string {
  return url.split('/').pop() || 'file.pdf'
}

async function handleDirectPDFUpload() {
  const pdfFile = getPDFFile()

  if (!pdfFile) {
    toast.add({
      severity: 'error',
      summary: 'No PDF',
      detail: 'No PDF file is currently loaded',
      life: 3000
    })
    return
  }

  try {
    // If no form exists, create one automatically
    if (!formFieldsStore.currentFormId) {
      const autoTitle = formTitle.value || documentStore.activeDocument?.name.replace('.pdf', '') || 'Untitled Form'

      const form = await formManagement.createFormForCurrentDocument(
        autoTitle,
        undefined  // Don't upload PDF yet, we'll do it separately
      )

      formsStore.currentForm = form
      formTitle.value = autoTitle
    }

    // Upload PDF
    const url = await uploadPDF(pdfFile)

    // Update form with PDF URL
    await formsService.update(formFieldsStore.currentFormId!, { pdfUrl: url })

    toast.add({
      severity: 'success',
      summary: 'PDF Uploaded',
      detail: 'PDF has been uploaded successfully',
      life: 3000
    })

    // Refresh current form
    await formsStore.fetchForm(formFieldsStore.currentFormId!)
  } catch (error) {
    console.error('Error uploading PDF:', error)
    toast.add({
      severity: 'error',
      summary: 'Upload Failed',
      detail: error instanceof Error ? error.message : 'Failed to upload PDF',
      life: 5000
    })
  }
}

async function handlePublish(formId: string) {
  try {
    await formsStore.updateFormStatus(formId, 'published')

    toast.add({
      severity: 'success',
      summary: 'Form Published',
      detail: 'Form is now accepting responses',
      life: 3000
    })
  } catch (error) {
    console.error('Error publishing form:', error)
    toast.add({
      severity: 'error',
      summary: 'Publish Failed',
      detail: 'Failed to publish form',
      life: 5000
    })
  }
}

async function handleUnpublish(formId: string) {
  try {
    await formsStore.updateFormStatus(formId, 'draft')

    toast.add({
      severity: 'success',
      summary: 'Form Unpublished',
      detail: 'Form is no longer accepting responses',
      life: 3000
    })
  } catch (error) {
    console.error('Error unpublishing form:', error)
    toast.add({
      severity: 'error',
      summary: 'Unpublish Failed',
      detail: 'Failed to unpublish form',
      life: 5000
    })
  }
}
</script>

<style scoped>
.form-save-panel {
  margin-bottom: 16px;
}

.tool-card {
  background: white;
  border-radius: 16px;
  padding: 20px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  border: 1px solid #e7e8ec;
  transition: all 0.2s ease;
}

.info-card {
  background: linear-gradient(135deg, #fbf2e0 0%, #fbf2e0 100%);
  border-color: #fbf2e0;
}

.success-card {
  background: linear-gradient(135deg, #e8f4ee 0%, #e8f4ee 100%);
  border-color: #e8f4ee;
}

.tool-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.tool-icon {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  flex-shrink: 0;
}

.tool-title {
  font-size: 15px;
  font-weight: 600;
  color: #191b21;
  margin: 0;
}

.tool-body {
  display: flex;
  flex-direction: column;
}

.info-box {
  padding: 12px;
  background: #fbfbfc;
  border: 1px solid #e7e8ec;
  border-radius: 8px;
}

.save-btn {
  font-weight: 600;
  transition: all 0.2s ease;
}

.save-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(34, 197, 94, 0.3);
}
</style>
