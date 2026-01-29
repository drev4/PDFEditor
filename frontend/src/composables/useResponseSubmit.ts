import { ref } from 'vue'
import { responsesService, type SubmitResponseData } from '../services/responses'

export function useResponseSubmit() {
  const isSubmitting = ref(false)
  const error = ref<string | null>(null)
  const validationErrors = ref<Record<string, string>>({})
  const success = ref(false)
  const responseId = ref<string | null>(null)

  async function submit(data: SubmitResponseData) {
    isSubmitting.value = true
    error.value = null
    validationErrors.value = {}
    success.value = false

    try {
      const result = await responsesService.submit(data)
      success.value = true
      responseId.value = result.responseId
      return result
    } catch (err: any) {
      if (err.response?.status === 400) {
        // Validation errors
        const details = err.response?.data?.details
        if (typeof details === 'object' && !Array.isArray(details)) {
          if (details.message && details.fields) {
            // Missing required fields
            error.value = `${details.message}: ${details.fields.join(', ')}`
          } else {
            // Field-specific validation errors
            validationErrors.value = details
            error.value = 'Please fix the validation errors'
          }
        } else {
          error.value = err.response?.data?.error || 'Validation failed'
        }
      } else if (err.response?.status === 403) {
        error.value = 'This form is not accepting responses'
      } else if (err.response?.status === 404) {
        error.value = 'Form not found'
      } else {
        error.value = 'Failed to submit response. Please try again.'
      }
      console.error('Error submitting response:', err)
      throw err
    } finally {
      isSubmitting.value = false
    }
  }

  function reset() {
    isSubmitting.value = false
    error.value = null
    validationErrors.value = {}
    success.value = false
    responseId.value = null
  }

  return {
    isSubmitting,
    error,
    validationErrors,
    success,
    responseId,
    submit,
    reset
  }
}
