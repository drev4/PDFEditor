import { ref, computed } from 'vue'
import { formsService, type Form } from '../services/forms'

export function usePublicForm() {
  const form = ref<Form | null>(null)
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  const fields = computed(() => form.value?.fields || [])
  const pdfUrl = computed(() => form.value?.pdfUrl || null)
  const title = computed(() => form.value?.title || '')
  const description = computed(() => form.value?.description || null)

  async function loadForm(shareId: string) {
    isLoading.value = true
    error.value = null

    try {
      form.value = await formsService.getPublic(shareId)
    } catch (err: any) {
      if (err.response?.status === 404) {
        error.value = 'Form not found or not published'
      } else if (err.response?.status === 403) {
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
  }

  return {
    form,
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
