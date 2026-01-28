import { watch } from 'vue'
import { useFormFieldsStore } from '@/stores/formFields.store'
import { useToast } from 'primevue/usetoast'

/**
 * Composable para manejar errores globales del store de campos
 * Muestra toasts automáticamente cuando hay errores
 */
export function useFieldsErrorHandler() {
  const formFieldsStore = useFormFieldsStore()
  const toast = useToast()

  // Watch for errors in the store
  watch(() => formFieldsStore.error, (error) => {
    if (error) {
      toast.add({
        severity: 'error',
        summary: 'Error',
        detail: error,
        life: 4000
      })

      // Clear the error after showing it
      setTimeout(() => {
        formFieldsStore.clearError()
      }, 100)
    }
  })

  return {
    // Could expose additional error handling utilities here if needed
  }
}
