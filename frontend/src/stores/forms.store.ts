import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { formsService, type Form, type CreateFormData, type UpdateFormData, type FormStatus } from '../services/forms'
import { useAsyncAction } from '../composables/useAsyncAction'

export const useFormsStore = defineStore('forms', () => {
  const forms = ref<Form[]>([])
  const currentForm = ref<Form | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const formsCount = computed(() => forms.value.length)
  const publishedForms = computed(() => forms.value.filter(f => f.status === 'published'))
  const draftForms = computed(() => forms.value.filter(f => f.status === 'draft'))

  async function fetchForms() {
    return useAsyncAction({ loading, error }, async () => {
      forms.value = await formsService.list()
      return forms.value
    }, { fallbackMessage: 'Failed to fetch forms' })
  }

  async function fetchForm(id: string) {
    return useAsyncAction({ loading, error }, async () => {
      currentForm.value = await formsService.get(id)
      return currentForm.value
    }, { fallbackMessage: 'Failed to fetch form' })
  }

  async function createForm(data: CreateFormData) {
    return useAsyncAction({ loading, error }, async () => {
      const form = await formsService.create(data)
      forms.value.unshift(form)
      return form
    }, { fallbackMessage: 'Failed to create form' })
  }

  async function updateForm(id: string, data: UpdateFormData) {
    return useAsyncAction({ loading, error }, async () => {
      const updatedForm = await formsService.update(id, data)
      const index = forms.value.findIndex(f => f.id === id)
      if (index !== -1) {
        forms.value[index] = updatedForm
      }
      if (currentForm.value?.id === id) {
        currentForm.value = updatedForm
      }
      return updatedForm
    }, { fallbackMessage: 'Failed to update form' })
  }

  async function deleteForm(id: string) {
    return useAsyncAction({ loading, error }, async () => {
      await formsService.delete(id)
      forms.value = forms.value.filter(f => f.id !== id)
      if (currentForm.value?.id === id) {
        currentForm.value = null
      }
    }, { fallbackMessage: 'Failed to delete form' })
  }

  async function updateFormStatus(id: string, status: FormStatus) {
    return useAsyncAction({ loading, error }, async () => {
      const updatedForm = await formsService.updateStatus(id, status)
      const index = forms.value.findIndex(f => f.id === id)
      if (index !== -1) {
        forms.value[index] = updatedForm
      }
      if (currentForm.value?.id === id) {
        currentForm.value = updatedForm
      }
      return updatedForm
    }, { fallbackMessage: 'Failed to update form status' })
  }

  function clearCurrentForm() {
    currentForm.value = null
  }

  return {
    forms,
    currentForm,
    loading,
    error,
    formsCount,
    publishedForms,
    draftForms,
    fetchForms,
    fetchForm,
    createForm,
    updateForm,
    updateFormStatus,
    deleteForm,
    clearCurrentForm
  }
})
