<template>
  <div class="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 flex flex-col font-sans">
    <!-- Loading State -->
    <div v-if="isLoading" class="flex flex-col items-center justify-center min-h-screen animate-fade-in">
      <div class="relative w-20 h-20 mb-8">
        <div class="absolute inset-0 border-4 border-blue-100 rounded-2xl"></div>
        <div class="absolute inset-0 border-4 border-blue-600 rounded-2xl border-t-transparent animate-spin"></div>
        <i class="pi pi-file-pdf absolute inset-0 flex items-center justify-center text-3xl text-blue-600 animate-pulse"></i>
      </div>
      <p class="text-xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent tracking-wide">
        PREPARING FORM
      </p>
      <div class="mt-4 flex gap-1">
        <div class="w-1.5 h-1.5 bg-blue-600 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
        <div class="w-1.5 h-1.5 bg-blue-600 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
        <div class="w-1.5 h-1.5 bg-blue-600 rounded-full animate-bounce"></div>
      </div>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="flex items-center justify-center min-h-screen px-4 animate-scale-in">
      <div class="text-center max-w-md w-full bg-white/70 backdrop-blur-xl p-10 rounded-3xl shadow-2xl border border-white">
        <div class="w-20 h-20 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-6 text-red-500 shadow-inner">
          <i class="pi pi-exclamation-circle text-4xl"></i>
        </div>
        <h2 class="text-2xl font-black text-gray-900 mb-3">Something went wrong</h2>
        <p class="text-gray-600 leading-relaxed mb-8">{{ error }}</p>
        <button 
          @click="router.go(0)"
          class="w-full py-4 bg-gray-900 text-white rounded-2xl font-bold hover:bg-black transition-all shadow-lg hover:shadow-black/20"
        >
          Try Again
        </button>
      </div>
    </div>

    <!-- Form Content -->
    <div v-else-if="form" class="flex-1 flex flex-col h-screen overflow-hidden">
      <!-- Premium Glass Header -->
      <header class="bg-white/70 backdrop-blur-xl border-b border-white z-30 shadow-sm">
        <div class="max-w-screen-2xl mx-auto px-6 py-4 flex justify-between items-center gap-4">
          <div class="flex items-center gap-4 animate-fade-in">
            <div class="bg-gradient-to-br from-blue-600 to-indigo-600 p-2 rounded-xl shadow-lg shadow-blue-500/20">
              <i class="pi pi-file-pdf text-white text-xl"></i>
            </div>
            <div class="overflow-hidden">
              <h1 class="text-lg font-black text-gray-900 truncate tracking-tight">{{ title }}</h1>
              <div class="flex items-center gap-2 mt-0.5">
                <span class="flex h-2 w-2 rounded-full bg-green-500 animate-pulse"></span>
                <p class="text-[10px] uppercase font-bold text-gray-500 tracking-widest truncate">Live Form</p>
              </div>
            </div>
          </div>

          <div class="flex items-center gap-4">
            <!-- Save Status Indicator -->
            <div class="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-slate-100/50 rounded-lg border border-slate-200/50 transition-all" v-if="responsesStore.hasUnsavedChanges || responsesStore.lastSaved">
               <i class="pi text-[10px]" :class="responsesStore.isSaving ? 'pi-spin pi-spinner text-blue-500' : 'pi-check text-green-500'"></i>
               <span class="text-[10px] font-bold uppercase tracking-wider text-gray-500">
                  {{ responsesStore.isSaving ? 'Syncing...' : 'Encrypted & Saved' }}
               </span>
            </div>
            
            <div class="h-6 w-px bg-slate-200 mx-1 hidden md:block"></div>

            <button
              @click="handleSubmit"
              :disabled="isSubmitting"
              data-testid="public-submit-button"
              class="relative group px-6 py-2.5 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 disabled:opacity-50 transition-all shadow-lg shadow-blue-600/20 active:scale-95"
            >
              <div v-if="isSubmitting" class="flex items-center gap-2">
                <i class="pi pi-spin pi-spinner text-sm"></i>
                <span class="tracking-tight">SENDING...</span>
              </div>
              <div v-else class="flex items-center gap-2">
                <span class="tracking-tight">SUBMIT FORM</span>
                <i class="pi pi-arrow-right text-xs group-hover:translate-x-1 transition-transform"></i>
              </div>
            </button>
          </div>
        </div>
      </header>

      <!-- Main Visual Workspace -->
      <main class="flex-1 overflow-hidden relative bg-slate-200/30">
        <div v-if="loadingPdf" class="absolute inset-0 flex flex-col items-center justify-center bg-slate-50/80 backdrop-blur-sm z-20 animate-fade-in">
          <ProgressSpinner style="width: 40px; height: 40px" strokeWidth="4" />
          <p class="mt-4 text-[10px] font-black tracking-[0.2em] text-blue-600 uppercase">Generating Document</p>
        </div>
        
        <div class="h-full w-full animate-scale-in">
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
        </div>
      </main>

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
import ProgressSpinner from 'primevue/progressspinner'
import { usePublicForm } from '../composables/usePublicForm'
import { useResponseSubmit } from '../composables/useResponseSubmit'
import { useFormValidation } from '../composables/useFormValidation'
import { usePublicResponsesStore } from '../stores/publicResponses.store'
import { useDocumentStore } from '@/stores/document.store'
import { buildApiUrl } from '@/utils/apiUrl'
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
    const fullUrl = buildApiUrl(url)
      
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
