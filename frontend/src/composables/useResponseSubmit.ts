import { ref } from 'vue'
import { responsesService, type SubmitResponseData } from '../services/responses'
import { ApiError } from '../services/api'

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
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 400) {
        const details = err.details
        if (typeof details === 'object' && details !== null && !Array.isArray(details)) {
          const d = details as Record<string, unknown>
          if (d.message && d.fields) {
            error.value = `${d.message}: ${(d.fields as string[]).join(', ')}`
          } else {
            validationErrors.value = details as Record<string, string>
            error.value = 'Please fix the validation errors'
          }
        } else {
          error.value = err.message || 'Validation failed'
        }
      } else if (err instanceof ApiError && err.status === 403) {
        error.value = 'This form is not accepting responses'
      } else if (err instanceof ApiError && err.status === 404) {
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
