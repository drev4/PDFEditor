import { ref, computed } from 'vue'
import { formsService, type Form } from '../services/forms'
import { ApiError } from '../services/api'

export function usePublicForm() {
  const form = ref<Form | null>(null)
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  /**
   * Whether to render the "Made with VuePDF" mark (features/0014).
   *
   * Decided by the server from the owner's plan and passed through untouched —
   * nothing here re-derives it, because the client is given no plan to derive
   * it from. Starts `true` so a form that has not loaded, or one whose payload
   * lacks the flag, keeps the mark.
   */
  const showBranding = ref(true)

  const fields = computed(() => form.value?.fields || [])
  const pdfUrl = computed(() => form.value?.pdfUrl || null)
  const title = computed(() => form.value?.title || '')
  const description = computed(() => form.value?.description || null)

  async function loadForm(shareId: string) {
    isLoading.value = true
    error.value = null

    try {
      const published = await formsService.getPublic(shareId)
      form.value = published.form
      showBranding.value = published.showBranding
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 404) {
        error.value = 'Form not found or not published'
      } else if (err instanceof ApiError && err.status === 403) {
        error.value = 'This form is not available for submissions'
      } else {
        error.value = 'Failed to load form. Please try again later.'
      }
      console.error('Error loading public form:', err)
    } finally {
      isLoading.value = false
    }
  }

  function reset() {
    form.value = null
    error.value = null
    isLoading.value = false
    showBranding.value = true
  }

  return {
    form,
    showBranding,
    fields,
    pdfUrl,
    title,
    description,
    isLoading,
    error,
    loadForm,
    reset
  }
}
