<template>
  <div class="min-h-screen bg-surface-sunken flex flex-col">
    <!-- Loading -->
    <div v-if="isLoading" class="flex flex-col items-center justify-center min-h-screen">
      <ProgressSpinner style="width: 30px; height: 30px" strokeWidth="4" />
      <p class="mt-4 text-body text-muted">Preparing the form</p>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="flex items-center justify-center min-h-screen px-4">
      <div class="text-center max-w-[400px] w-full bg-surface p-8 rounded-card border border-line shadow-paper">
        <h2 class="text-section">This form could not be opened</h2>
        <p class="text-body text-muted mt-2 mb-7">{{ error }}</p>
        <button
          type="button"
          class="w-full h-control rounded-control bg-accent hover:bg-accent-pressed text-white text-row font-medium transition-colors"
          @click="router.go(0)"
        >
          Try again
        </button>
      </div>
    </div>

    <!-- Form -->
    <div v-else-if="form" class="flex-1 flex flex-col h-screen overflow-hidden">
      <header
        class="flex items-center gap-4 h-14 flex-shrink-0 px-6 bg-surface border-b border-line z-30"
      >
        <div class="min-w-0">
          <div class="text-base font-medium truncate">{{ title }}</div>
          <div v-if="description" class="text-micro text-faint truncate">{{ description }}</div>
        </div>

        <div class="flex-grow" />

        <!-- Progress. Mono, because it is a count. -->
        <div class="hidden md:flex items-center gap-2.5">
          <span class="text-meta text-muted">
            <span class="num">{{ filledCount }}</span> of
            <span class="num">{{ fields.length }}</span> fields
          </span>
          <div class="w-[116px] h-1 rounded-pill bg-surface-track overflow-hidden">
            <div class="h-1 rounded-pill bg-accent transition-all" :style="{ width: progressWidth }" />
          </div>
        </div>

        <!-- Says what actually happened: the draft is in this browser. It does
             not claim encryption, which the old copy did and nothing does. -->
        <div
          v-if="responsesStore.hasUnsavedChanges || responsesStore.lastSaved"
          class="hidden sm:flex items-center gap-1.5 h-[26px] px-2.5 rounded-pill bg-neutral-soft"
        >
          <i
            class="pi text-[10px]"
            :class="responsesStore.isSaving ? 'pi-spin pi-spinner text-faint' : 'pi-check text-published'"
          />
          <span class="text-micro text-muted">
            {{ responsesStore.isSaving ? 'Saving' : 'Progress saved' }}
          </span>
        </div>

        <div class="w-px h-[22px] bg-line hidden sm:block" />

        <button
          type="button"
          :disabled="isSubmitting"
          data-testid="public-submit-button"
          class="flex items-center gap-2 h-control-sm min-h-touch sm:min-h-0 px-4 rounded-control bg-accent hover:bg-accent-pressed disabled:bg-surface-control disabled:text-disabled text-white text-row font-medium transition-colors"
          @click="handleSubmit"
        >
          <i v-if="isSubmitting" class="pi pi-spin pi-spinner text-[12px]" />
          <span>{{ isSubmitting ? 'Sending' : 'Submit form' }}</span>
        </button>
      </header>

      <!-- The PublicForm artboard sets the page on a grey ground as a sheet of
           paper with its own border and shadow. `.public-paper` gives the
           rendered canvas that treatment; elevation is for paper and menus
           only, and this is the paper. -->
      <main class="flex-1 overflow-hidden relative bg-surface-sunken public-paper">
        <div
          v-if="loadingPdf"
          class="absolute inset-0 flex flex-col items-center justify-center bg-surface-sunken/80 z-20"
        >
          <ProgressSpinner style="width: 30px; height: 30px" strokeWidth="4" />
          <p class="mt-4 text-body text-muted">Loading the document</p>
        </div>

        <div class="h-full w-full">
          <PDFViewer :read-only="true">
            <template #fields-overlay="{ scale, width, height, displayScale }">
              <PublicFormFieldsOverlay
                :fields="fields"
                :scale="scale"
                :canvas-width="width"
                :canvas-height="height"
                :display-scale="displayScale"
                :validation-errors="validationErrors"
                @field-change="handleFieldChange"
              />
            </template>
          </PDFViewer>
        </div>
      </main>

      <!-- The mark. A plan entitlement (Plan.hasBranding) once plans exist;
           until then every form is on the free tier, so it is always shown. -->
      <footer
        class="flex items-center h-[52px] flex-shrink-0 px-6 bg-surface border-t border-line"
      >
        <span v-if="requiredLeft" class="text-meta text-muted">
          <span class="num">{{ requiredLeft }}</span>
          required {{ requiredLeft === 1 ? 'field' : 'fields' }} left
        </span>
        <div class="flex-grow" />
        <div class="flex items-center gap-1.5 h-[26px] px-2.5 rounded-pill border border-line">
          <div class="flex items-center justify-center w-3.5 h-3.5 rounded-chip bg-ink text-white flex-shrink-0">
            <i class="pi pi-file text-[8px]" />
          </div>
          <span class="text-micro text-muted">Made with VuePDF</span>
        </div>
      </footer>

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

// Progress, as the PublicForm artboard shows it. An answer counts as given if
// it is a non-empty string or a ticked checkbox; `false` on an unticked
// checkbox is a value the store holds but not something the respondent did.
const isAnswered = (value: unknown) =>
  typeof value === 'string' ? value.trim().length > 0 : value === true

const filledCount = computed(() => {
  const answers = responsesStore.getAllResponses()
  return fields.value.filter(f => isAnswered(answers[f.id])).length
})

const progressWidth = computed(() =>
  fields.value.length ? `${Math.round((filledCount.value / fields.value.length) * 100)}%` : '0%'
)

const requiredLeft = computed(() => {
  const answers = responsesStore.getAllResponses()
  return fields.value.filter(f => f.required && !isAnswered(answers[f.id])).length
})

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

<style scoped>
.public-paper :deep(.pdf-canvas-wrapper) {
  background: theme('colors.surface.DEFAULT');
  border: 1px solid theme('colors.line.paper');
  box-shadow: theme('boxShadow.paper');
}

/* The respondent's page is a document, not a workspace: no grid, no drawing
   chrome, and room around the sheet the way the artboard frames it. */
.public-paper :deep(.grid-overlay) {
  display: none;
}
</style>

