<template>
  <div class="form-save-panel">
    <!-- Form Info Card -->
    <div v-if="!formFieldsStore.currentFormId" class="tool-card info-card">
      <div class="tool-header">
        <div class="tool-icon bg-yellow-100">
          <i class="pi pi-info-circle text-yellow-600"></i>
        </div>
        <h4 class="tool-title">Save Form</h4>
      </div>
      <div class="tool-body">
        <p class="text-sm text-gray-600 mb-4">
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

        <Button
          label="Save Form to Cloud"
          icon="pi pi-cloud-upload"
          @click="handleSaveForm"
          class="w-full save-btn"
          severity="success"
          :loading="formManagement.isInitializing || formManagement.isUploading"
          :disabled="!formTitle || !hasFields"
        />

        <p v-if="!hasFields" class="text-xs text-amber-600 mt-2 flex items-center gap-1">
          <i class="pi pi-exclamation-triangle"></i>
          Add at least one field before saving
        </p>
      </div>
    </div>

    <!-- Already Saved Card -->
    <div v-else class="tool-card success-card">
      <div class="tool-header">
        <div class="tool-icon bg-green-100">
          <i class="pi pi-check-circle text-green-600"></i>
        </div>
        <div class="flex-1">
          <h4 class="tool-title">Form Saved</h4>
          <p class="text-xs text-gray-500">ID: {{ formFieldsStore.currentFormId }}</p>
        </div>
      </div>
      <div class="tool-body space-y-2">
        <div v-if="currentForm" class="info-box">
          <p class="text-sm font-semibold text-gray-800">{{ currentForm.title }}</p>
          <p v-if="currentForm.description" class="text-xs text-gray-600">{{ currentForm.description }}</p>
          <p class="text-xs text-gray-500 mt-2">
            {{ currentForm.fields?.length || 0 }} fields • {{ currentForm.status }}
          </p>
        </div>

        <Button
          label="Update Fields"
          icon="pi pi-save"
          @click="handleUpdateFields"
          class="w-full"
          severity="info"
          outlined
          :loading="formFieldsStore.loading"
        />

        <Button
          label="Upload PDF"
          icon="pi pi-cloud-upload"
          @click="showPDFUpload = true"
          class="w-full"
          severity="secondary"
          outlined
          v-if="!currentForm?.pdfUrl"
        />

        <div v-else class="info-box bg-blue-50 border-blue-200">
          <div class="flex items-start gap-2">
            <i class="pi pi-file-pdf text-blue-600 mt-0.5"></i>
            <div class="flex-1 min-w-0">
              <p class="text-xs font-medium text-blue-900">PDF Uploaded</p>
              <p class="text-xs text-blue-700 truncate">{{ getPDFFilename(currentForm.pdfUrl) }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- PDF Upload Dialog -->
    <Dialog
      v-model:visible="showPDFUpload"
      header="Upload PDF to Server"
      :modal="true"
      :style="{ width: '400px' }"
    >
      <div class="p-4">
        <p class="text-sm text-gray-600 mb-4">
          Upload the current PDF file to the server to make it accessible online.
        </p>

        <PDFUploadButton
          button-text="Upload Current PDF"
          @upload-success="handlePDFUploadSuccess"
          @upload-error="handlePDFUploadError"
          @file-selected="handleFileSelected"
          :auto-upload="false"
          ref="uploadButtonRef"
        />

        <div class="flex gap-2 mt-4">
          <Button
            label="Upload"
            icon="pi pi-upload"
            @click="triggerPDFUpload"
            class="flex-1"
            severity="success"
            :loading="formManagement.isUploading"
            :disabled="!selectedPDFFile"
          />
          <Button
            label="Cancel"
            @click="showPDFUpload = false"
            outlined
            severity="secondary"
          />
        </div>
      </div>
    </Dialog>

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
import Dialog from 'primevue/dialog'
import Toast from 'primevue/toast'
import { useFormFieldsStore } from '@/stores/formFields.store'
import { useFormsStore } from '@/stores/forms.store'
import { useDocumentStore } from '@/stores/document.store'
import { useFormManagement } from '@/composables/useFormManagement'
import PDFUploadButton from './PDFUploadButton.vue'

const formFieldsStore = useFormFieldsStore()
const formsStore = useFormsStore()
const documentStore = useDocumentStore()
const formManagement = useFormManagement()
const toast = useToast()

const formTitle = ref('')
const formDescription = ref('')
const showPDFUpload = ref(false)
const selectedPDFFile = ref<File | null>(null)
const uploadButtonRef = ref<InstanceType<typeof PDFUploadButton> | null>(null)

const hasFields = computed(() => formFieldsStore.fields.length > 0)
const currentForm = computed(() => formsStore.currentForm)

// Auto-populate form title from document name
watch(() => documentStore.activeDocument, (doc) => {
  if (doc && !formTitle.value) {
    formTitle.value = doc.name.replace('.pdf', '')
  }
}, { immediate: true })

async function handleSaveForm() {
  if (!formTitle.value || !hasFields.value) return

  try {
    // Get the current PDF file from document store
    const pdfFile = getPDFFile()

    // Create form (with PDF upload if file exists)
    const form = await formManagement.createFormForCurrentDocument(
      formTitle.value,
      pdfFile || undefined
    )

    toast.add({
      severity: 'success',
      summary: 'Form Saved',
      detail: `Form "${formTitle.value}" has been saved successfully`,
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
    await formFieldsStore.saveAllFields()

    toast.add({
      severity: 'success',
      summary: 'Fields Updated',
      detail: 'All form fields have been saved',
      life: 3000
    })
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

function handleFileSelected(file: File) {
  selectedPDFFile.value = file
}

async function triggerPDFUpload() {
  if (!selectedPDFFile.value || !uploadButtonRef.value) return

  try {
    await uploadButtonRef.value.uploadFile(selectedPDFFile.value)
  } catch (error) {
    console.error('Error uploading PDF:', error)
  }
}

async function handlePDFUploadSuccess(url: string) {
  showPDFUpload.value = false
  selectedPDFFile.value = null

  toast.add({
    severity: 'success',
    summary: 'PDF Uploaded',
    detail: 'PDF has been uploaded to the server',
    life: 3000
  })

  // Refresh current form to show updated pdfUrl
  if (formFieldsStore.currentFormId) {
    await formsStore.fetchForm(formFieldsStore.currentFormId)
  }
}

function handlePDFUploadError(error: string) {
  toast.add({
    severity: 'error',
    summary: 'Upload Failed',
    detail: error,
    life: 5000
  })
}

function getPDFFile(): File | null {
  const doc = documentStore.activeDocument
  if (!doc?.file) return null
  return doc.file
}

function getPDFFilename(url: string): string {
  return url.split('/').pop() || 'file.pdf'
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
  border: 1px solid #e5e7eb;
  transition: all 0.2s ease;
}

.info-card {
  background: linear-gradient(135deg, #fefce8 0%, #fef3c7 100%);
  border-color: #fde68a;
}

.success-card {
  background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%);
  border-color: #bbf7d0;
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
  color: #1f2937;
  margin: 0;
}

.tool-body {
  display: flex;
  flex-direction: column;
}

.info-box {
  padding: 12px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
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
