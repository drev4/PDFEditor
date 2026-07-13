import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

const STORAGE_PREFIX = 'vuepdf_draft_'

export const usePublicResponsesStore = defineStore('publicResponses', () => {
  const responses = ref<Record<string, any>>({})
  const formId = ref<string | null>(null)
  const isSaving = ref(false)
  const lastSaved = ref<number | null>(null)
  const saveTimeout = ref<number | null>(null)

  function getStorageKey(id: string) {
    return `${STORAGE_PREFIX}${id}`
  }

  // Load from localStorage on init
  function loadFormDraft(currentFormId: string) {
    formId.value = currentFormId
    try {
      const stored = localStorage.getItem(getStorageKey(currentFormId))
      if (stored) {
        const data = JSON.parse(stored)
        responses.value = data.responses || {}
        lastSaved.value = data.timestamp || null
      } else {
        responses.value = {}
        lastSaved.value = null
      }
    } catch (error) {
      console.error('Error loading responses from local storage:', error)
      responses.value = {}
    }
  }

  // Save to localStorage
  function saveToStorage() {
    if (!formId.value) return

    isSaving.value = true
    try {
      localStorage.setItem(
        getStorageKey(formId.value),
        JSON.stringify({
          formId: formId.value,
          responses: responses.value,
          timestamp: Date.now()
        })
      )
      lastSaved.value = Date.now()
    } catch (error) {
      console.error('Error saving responses to local storage:', error)
    } finally {
      isSaving.value = false
    }
  }

  function setResponse(fieldId: string, value: any) {
    responses.value[fieldId] = value

    // Debounce save (1s)
    if (saveTimeout.value) {
      clearTimeout(saveTimeout.value)
    }

    saveTimeout.value = window.setTimeout(() => {
      saveToStorage()
      saveTimeout.value = null
    }, 1000)
  }

  function getResponse(fieldId: string): any {
    return responses.value[fieldId]
  }

  function getAllResponses(): Record<string, any> {
    return { ...responses.value }
  }

  function clearDraft() {
    if (formId.value) {
      try {
        localStorage.removeItem(getStorageKey(formId.value))
      } catch (error) {
        console.error('Error clearing local storage:', error)
      }
    }
    responses.value = {}
    // Don't reset formId here necessarily, or maybe yes?
    // Usually keep formId but empty responses.
    lastSaved.value = null
  }

  const totalFields = computed(() => Object.keys(responses.value).length)
  const hasUnsavedChanges = computed(() => totalFields.value > 0)

  return {
    responses,
    formId,
    totalFields,
    hasUnsavedChanges,
    isSaving,
    lastSaved,
    loadFormDraft,
    setResponse,
    getResponse,
    getAllResponses,
    clearDraft
  }
})
