import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

const SESSION_STORAGE_KEY = 'vuepdf_public_responses'

export const usePublicResponsesStore = defineStore('publicResponses', () => {
  const responses = ref<Record<string, any>>({})
  const formId = ref<string | null>(null)

  // Load from sessionStorage on init
  function loadFromSession(currentFormId: string) {
    try {
      const stored = sessionStorage.getItem(SESSION_STORAGE_KEY)
      if (stored) {
        const data = JSON.parse(stored)
        if (data.formId === currentFormId) {
          responses.value = data.responses || {}
          formId.value = currentFormId
        } else {
          // Different form, clear storage
          clearResponses()
          formId.value = currentFormId
        }
      } else {
        formId.value = currentFormId
      }
    } catch (error) {
      console.error('Error loading responses from session storage:', error)
      formId.value = currentFormId
    }
  }

  // Save to sessionStorage
  function saveToSession() {
    try {
      sessionStorage.setItem(
        SESSION_STORAGE_KEY,
        JSON.stringify({
          formId: formId.value,
          responses: responses.value
        })
      )
    } catch (error) {
      console.error('Error saving responses to session storage:', error)
    }
  }

  function setResponse(fieldId: string, value: any) {
    responses.value[fieldId] = value
    saveToSession()
  }

  function getResponse(fieldId: string): any {
    return responses.value[fieldId]
  }

  function getAllResponses(): Record<string, any> {
    return { ...responses.value }
  }

  function clearResponses() {
    responses.value = {}
    formId.value = null
    try {
      sessionStorage.removeItem(SESSION_STORAGE_KEY)
    } catch (error) {
      console.error('Error clearing session storage:', error)
    }
  }

  const totalFields = computed(() => Object.keys(responses.value).length)

  const hasUnsavedChanges = computed(() => totalFields.value > 0)

  return {
    responses,
    formId,
    totalFields,
    hasUnsavedChanges,
    loadFromSession,
    setResponse,
    getResponse,
    getAllResponses,
    clearResponses
  }
})
