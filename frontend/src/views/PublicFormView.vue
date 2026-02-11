<template>
  <div class="min-h-screen bg-gray-50 flex flex-col">
    <!-- Loading State -->
    <div v-if="isLoading" class="flex items-center justify-center min-h-screen">
      <div class="text-center">
        <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
        <p class="mt-4 text-gray-600">Loading form...</p>
      </div>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="flex items-center justify-center min-h-screen">
      <div class="text-center max-w-md mx-auto px-4">
        <div class="text-red-500 mb-4">
          <svg class="h-16 w-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
        </div>
        <h2 class="text-2xl font-bold text-gray-900 mb-2">Form Not Available</h2>
        <p class="text-gray-600">{{ error }}</p>
      </div>
    </div>

    <!-- Form Content -->
    <div v-else-if="form" class="flex-1 flex flex-col h-screen">
      <!-- Header -->
      <header class="bg-white shadow-sm z-10">
        <div class="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8 flex justify-between items-center">
          <div>
            <h1 class="text-xl font-bold text-gray-900">{{ title }}</h1>
            <p v-if="description" class="text-sm text-gray-500 mt-1">{{ description }}</p>
          </div>
          <div class="flex items-center space-x-4">
            <!-- Draft Status -->
            <span class="text-xs text-gray-400 hidden sm:inline-block transition-opacity duration-500" v-if="responsesStore.hasUnsavedChanges || responsesStore.lastSaved">
               {{ responsesStore.isSaving ? 'Saving draft...' : 'Draft saved' }}
            </span>
            
            <span class="text-sm text-gray-500">
              {{ responsesStore.totalFields }} field{{ responsesStore.totalFields !== 1 ? 's' : '' }} filled
            </span>
            <button
              @click="handleSubmit"
              :disabled="isSubmitting"
              class="px-4 py-2 bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <span v-if="isSubmitting" class="flex items-center">
                <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Sending...
              </span>
              <span v-else>Submit</span>
            </button>
          </div>
        </div>
      </header>

      <!-- Submit Error Alert -->
      <div v-if="submitError" class="bg-red-50 border-b border-red-200">
        <div class="max-w-7xl mx-auto px-4 py-3 sm:px-6 lg:px-8">
          <div class="flex">
            <div class="flex-shrink-0">
              <svg class="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" />
              </svg>
            </div>
            <div class="ml-3">
              <h3 class="text-sm font-medium text-red-800">Error submitting response</h3>
              <p class="text-sm text-red-700 mt-1">{{ submitError }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Main Content (PDF Viewer) -->
      <main class="flex-1 overflow-hidden relative">
        <div v-if="loadingPdf" class="absolute inset-0 flex items-center justify-center bg-gray-50 z-20">
          <div class="text-center">
            <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
            <p class="mt-2 text-sm text-gray-500">Loading document...</p>
          </div>
        </div>
        
        <PDFViewer :read-only="true">
          <template #fields-overlay="{ scale }">
            <PublicFormFieldsOverlay
              :fields="fields"
              :scale="scale"
              :validation-errors="validationErrors"
              @field-change="handleFieldChange"
            />
          </template>
        </PDFViewer>
      </main>

      <!-- Submit Preview Modal -->
      <SubmitPreviewModal
        v-model:visible="showPreview"
        :fields="fields"
        :answers="responsesStore.getAllResponses()"
        :is-submitting="isSubmitting"
        @confirm="handleConfirmSubmit"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { usePublicForm } from '../composables/usePublicForm'
import { useResponseSubmit } from '../composables/useResponseSubmit'
import { useFormValidation } from '../composables/useFormValidation'
import { usePublicResponsesStore } from '../stores/publicResponses.store'
import { useDocumentStore } from '@/stores/document.store'
import PDFViewer from '@/components/pdf/PDFViewer.vue'
import PublicFormFieldsOverlay from '@/components/form-fields/PublicFormFieldsOverlay.vue'
import SubmitPreviewModal from '@/components/forms/SubmitPreviewModal.vue'

const route = useRoute()
const router = useRouter()
const documentStore = useDocumentStore()

const { form, fields, pdfUrl, title, description, isLoading, error, loadForm } = usePublicForm()
const { isSubmitting, error: submitError, validationErrors: submitValidationErrors, submit } = useResponseSubmit()
const { errors: clientErrors, validateField, validate } = useFormValidation()
const responsesStore = usePublicResponsesStore()

const shareId = computed(() => route.params.shareId as string)
const loadingPdf = ref(false)
const showPreview = ref(false)

const validationErrors = computed(() => ({
  ...clientErrors.value,
  ...submitValidationErrors.value
}))

const loadPdfDocument = async (url: string) => {
  if (!url) return
  
  loadingPdf.value = true
  try {
    // Check if URL is relative (from our backend)
    const fullUrl = url.startsWith('http') 
      ? url 
      : `${import.meta.env.VITE_API_URL || 'http://localhost:3000'}${url}`
      
    const response = await fetch(fullUrl)
    if (!response.ok) throw new Error('Failed to fetch PDF')
    
    const blob = await response.blob()
    const file = new File([blob], 'form.pdf', { type: 'application/pdf' })
    
    await documentStore.loadPDF(file)
  } catch (e) {
    console.error('Error loading PDF:', e)
  } finally {
    loadingPdf.value = false
  }
}

onMounted(async () => {
  if (shareId.value) {
    await loadForm(shareId.value)
    if (form.value) {
      responsesStore.loadFormDraft(form.value.id)
      
      // Load PDF
      if (pdfUrl.value) {
        await loadPdfDocument(pdfUrl.value)
      }
    }
  }
})

// Validation Debounce
const validationTimeouts = new Map<string, number>()

// Clean up
onUnmounted(() => {
  if (documentStore.activeDocumentId) {
    documentStore.closeDocument(documentStore.activeDocumentId)
  }
  validationTimeouts.forEach(t => clearTimeout(t))
  validationTimeouts.clear()
})

function handleFieldChange(payload: { fieldId: string, value: any }) {
  const { fieldId, value } = payload
  responsesStore.setResponse(fieldId, value)
  
  const field = fields.value.find(f => f.id === fieldId)
  if (field) {
    if (validationTimeouts.has(fieldId)) {
      clearTimeout(validationTimeouts.get(fieldId))
    }

    const timeout = window.setTimeout(() => {
      validateField(field, value)
      
      // Clear server error only if client validation passes or if we want to reset it on input
      if (submitValidationErrors.value && submitValidationErrors.value[field.name]) {
         const newErrors = { ...submitValidationErrors.value }
         delete newErrors[field.name]
         submitValidationErrors.value = newErrors
      }
      validationTimeouts.delete(fieldId)
    }, 500) // 500ms debounce
    
    validationTimeouts.set(fieldId, timeout)
  }
}

async function handleSubmit() {
  if (!form.value) return

  const answers = responsesStore.getAllResponses()

  // Client validation
  if (!validate(fields.value, answers)) {
    // Optional: Scroll to first error or show toast
    return
  }

  // Open preview modal instead of submitting directly
  showPreview.value = true
}

async function handleConfirmSubmit() {
  if (!form.value) return

  const allAnswers = responsesStore.getAllResponses()
  // Filter answers to only include fields that exist in the current form
  const answers: Record<string, any> = {}
  fields.value.forEach(field => {
    if (allAnswers[field.id] !== undefined) {
      answers[field.id] = allAnswers[field.id]
    }
  })

  try {
    await submit({
      formId: form.value.id,
      shareId: shareId.value,
      answers
    })

    // Clear responses and redirect to confirmation
    showPreview.value = false
    responsesStore.clearDraft()
    router.push(`/form/${shareId.value}/confirmation`)
  } catch (err) {
    // Error is handled by the composable
    showPreview.value = false
    console.error('Submit failed:', err)
  }
}
</script>
