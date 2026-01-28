import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { formsService, type Form, type CreateFormData, type UpdateFormData } from '../services/forms'
import { ApiError } from '../services/api'

export const useFormsStore = defineStore('forms', () => {
  const forms = ref<Form[]>([])
  const currentForm = ref<Form | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const formsCount = computed(() => forms.value.length)
  const publishedForms = computed(() => forms.value.filter(f => f.status === 'published'))
  const draftForms = computed(() => forms.value.filter(f => f.status === 'draft'))

  async function fetchForms() {
    loading.value = true
    error.value = null
    try {
      forms.value = await formsService.list()
      return forms.value
    } catch (e) {
      if (e instanceof ApiError) {
        error.value = e.message
      } else {
        error.value = 'Failed to fetch forms'
      }
      throw e
    } finally {
      loading.value = false
    }
  }

  async function fetchForm(id: string) {
    loading.value = true
    error.value = null
    try {
      currentForm.value = await formsService.get(id)
      return currentForm.value
    } catch (e) {
      if (e instanceof ApiError) {
        error.value = e.message
      } else {
        error.value = 'Failed to fetch form'
      }
      throw e
    } finally {
      loading.value = false
    }
  }

  async function createForm(data: CreateFormData) {
    loading.value = true
    error.value = null
    try {
      const form = await formsService.create(data)
      forms.value.unshift(form)
      return form
    } catch (e) {
      if (e instanceof ApiError) {
        error.value = e.message
      } else {
        error.value = 'Failed to create form'
      }
      throw e
    } finally {
      loading.value = false
    }
  }

  async function updateForm(id: string, data: UpdateFormData) {
    loading.value = true
    error.value = null
    try {
      const updatedForm = await formsService.update(id, data)
      const index = forms.value.findIndex(f => f.id === id)
      if (index !== -1) {
        forms.value[index] = updatedForm
      }
      if (currentForm.value?.id === id) {
        currentForm.value = updatedForm
      }
      return updatedForm
    } catch (e) {
      if (e instanceof ApiError) {
        error.value = e.message
      } else {
        error.value = 'Failed to update form'
      }
      throw e
    } finally {
      loading.value = false
    }
  }

  async function deleteForm(id: string) {
    loading.value = true
    error.value = null
    try {
      await formsService.delete(id)
      forms.value = forms.value.filter(f => f.id !== id)
      if (currentForm.value?.id === id) {
        currentForm.value = null
      }
    } catch (e) {
      if (e instanceof ApiError) {
        error.value = e.message
      } else {
        error.value = 'Failed to delete form'
      }
      throw e
    } finally {
      loading.value = false
    }
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
    deleteForm,
    clearCurrentForm
  }
})
