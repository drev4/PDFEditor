import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { fieldsService, type CreateFieldData, type BulkFieldData } from '../services/fields'
import { ApiError } from '../services/api'
import type { Field } from '../services/forms'
import { useAsyncAction } from '../composables/useAsyncAction'

export type FieldType = 'text' | 'textarea' | 'checkbox' | 'radio' | 'dropdown'

const LOCAL_ID_PREFIX = 'field-'

function isLocalFieldId(id: string): boolean {
  return id.startsWith(LOCAL_ID_PREFIX)
}

export interface FormField {
  id: string
  type: FieldType
  name: string
  label: string
  required: boolean
  border: boolean
  position: {
    x: number
    y: number
    width: number
    height: number
    page: number
  }
  options?: string[]
  validation?: {
    minLength?: number
    maxLength?: number
    pattern?: string
  }
}

export const useFormFieldsStore = defineStore('formFields', () => {
  const fields = ref<FormField[]>([])
  const selectedFieldId = ref<string | null>(null)
  /**
   * Field changes that are only in the browser.
   *
   * Placing, moving and resizing a field used to write to the server the moment
   * the mouse came up. That is a different model from the one the rest of the
   * editor uses — text and images wait for `Save all` — and two save models in
   * one screen means the user cannot know what is stored without remembering
   * which tool they used. Everything waits now.
   */
  const hasUnsavedChanges = ref(false)
  const markDirty = () => { hasUnsavedChanges.value = true }

  const isAddingField = ref(false)
  const fieldTypeToAdd = ref<FieldType | null>(null)
  const currentFormId = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  // Ids of fields the user removed in the editor that the server kept because
  // they hold responses. Surfaced to the user after a save, then cleared.
  const archivedFieldIds = ref<string[]>([])

  const selectedField = computed(() => {
    return fields.value.find(f => f.id === selectedFieldId.value) || null
  })

  const fieldsByPage = computed(() => {
    const byPage: Record<number, FormField[]> = {}
    for (const field of fields.value) {
      const page = field.position.page
      if (!byPage[page]) {
        byPage[page] = []
      }
      byPage[page].push(field)
    }
    return byPage
  })

  const startAddingField = (type: FieldType) => {
    isAddingField.value = true
    fieldTypeToAdd.value = type
    selectedFieldId.value = null
  }

  const cancelAddingField = () => {
    isAddingField.value = false
    fieldTypeToAdd.value = null
  }

  const addField = (field: Omit<FormField, 'id'>) => {
    const id = `${LOCAL_ID_PREFIX}${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const newField: FormField = {
      ...field,
      id
    }
    fields.value.push(newField)
    selectedFieldId.value = id
    isAddingField.value = false
    fieldTypeToAdd.value = null
    return newField
  }

  const updateField = (id: string, updates: Partial<Omit<FormField, 'id'>>) => {
    const index = fields.value.findIndex(f => f.id === id)
    if (index !== -1) {
      const current = fields.value[index]
      if (current) {
        if (updates.name && updates.name !== current.name) {
          if (fieldExists(updates.name, id)) {
            console.warn(`Field with name "${updates.name}" already exists`)
            return
          }
        }

        fields.value[index] = {
          ...current,
          ...updates,
          id: current.id
        }
      }
    }
  }

  const deleteField = (id: string) => {
    const index = fields.value.findIndex(f => f.id === id)
    if (index !== -1) {
      fields.value.splice(index, 1)
      if (selectedFieldId.value === id) {
        selectedFieldId.value = null
      }
    }
  }

  const selectField = (id: string | null) => {
    selectedFieldId.value = id
  }

  const moveField = (id: string, x: number, y: number) => {
    const field = fields.value.find(f => f.id === id)
    if (field) {
      field.position.x = x
      field.position.y = y
    }
  }

  const resizeField = (id: string, width: number, height: number) => {
    const field = fields.value.find(f => f.id === id)
    if (field) {
      field.position.width = width
      field.position.height = height
    }
  }

  const clearFields = () => {
    fields.value = []
    selectedFieldId.value = null
    isAddingField.value = false
    fieldTypeToAdd.value = null
    hasUnsavedChanges.value = false
  }

  const getFieldsForPage = (page: number) => {
    return fields.value.filter(f => f.position.page === page)
  }

  const generateUniqueFieldName = (baseType: FieldType): string => {
    const existingNames = new Set(fields.value.map(f => f.name))
    let counter = 1
    let candidateName = `${baseType}_${counter}`

    while (existingNames.has(candidateName)) {
      counter++
      candidateName = `${baseType}_${counter}`
    }

    return candidateName
  }

  const fieldExists = (name: string, excludeId?: string): boolean => {
    return fields.value.some(f => f.name === name && f.id !== excludeId)
  }

  const loadFieldsFromPDF = (pdfFields: Omit<FormField, 'id'>[]) => {
    fields.value = []
    selectedFieldId.value = null

    pdfFields.forEach(field => {
      const id = `${LOCAL_ID_PREFIX}${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      fields.value.push({
        ...field,
        id
      })
    })
  }

  const setCurrentForm = (formId: string | null) => {
    currentFormId.value = formId
  }

  const loadFieldsFromForm = (formFields: Field[]) => {
    fields.value = formFields.map(field => ({
      id: field.id,
      type: field.type,
      name: field.name,
      label: field.label,
      required: field.required,
      border: false,
      position: field.position as FormField['position'],
      options: field.options,
      validation: field.validation
    }))
    selectedFieldId.value = null
  }

  const saveAllFields = async () => {
    const formId = currentFormId.value
    if (!formId) {
      error.value = 'No form selected'
      return
    }

    return useAsyncAction({ loading, error }, async () => {
      const fieldsData: BulkFieldData[] = fields.value.map((field, index) => ({
        // A server id identifies an existing row, so the save is a diff and the
        // answers attached to it survive. Locally-created fields have no row
        // yet, so their id is omitted and the server creates one.
        ...(isLocalFieldId(field.id) ? {} : { id: field.id }),
        type: field.type,
        name: field.name || `field_${Date.now()}_${index}`,
        label: field.label || field.name || 'Untitled Field',
        required: field.required,
        position: field.position,
        options: field.options && field.options.length > 0 ? field.options : undefined,
        validation: field.validation && Object.keys(field.validation).length > 0 ? field.validation : undefined,
        order: index
      }))

      const { fields: savedFields, archived } = await fieldsService.bulkSave(formId, fieldsData)
      loadFieldsFromForm(savedFields)
      archivedFieldIds.value = archived
      hasUnsavedChanges.value = false
      return savedFields
    }, { fallbackMessage: 'Failed to save fields' })
  }

  const saveField = async (fieldId: string) => {
    const formId = currentFormId.value
    if (!formId) {
      error.value = 'No form selected'
      return
    }

    const field = fields.value.find(f => f.id === fieldId)
    if (!field) {
      error.value = 'Field not found'
      return
    }

    const fieldData: CreateFieldData = {
      type: field.type,
      name: field.name || `field_${Date.now()}`,
      label: field.label || field.name || 'Untitled Field',
      required: field.required,
      position: field.position,
      options: field.options && field.options.length > 0 ? field.options : undefined,
      validation: field.validation && Object.keys(field.validation).length > 0 ? field.validation : undefined,
      order: fields.value.indexOf(field)
    }

    return useAsyncAction({ loading, error }, async () => {
      const savedField = isLocalFieldId(fieldId)
        ? await fieldsService.create(formId, fieldData)
        : await fieldsService.update(formId, fieldId, fieldData)

      const index = fields.value.findIndex(f => f.id === fieldId)
      if (index !== -1) {
        fields.value[index] = {
          ...field,
          id: savedField.id
        }
      }

      return savedField
    }, { fallbackMessage: 'Failed to save field' })
  }

  const deleteFieldFromServer = async (fieldId: string) => {
    const formId = currentFormId.value
    if (!formId) {
      error.value = 'No form selected'
      return
    }

    if (isLocalFieldId(fieldId)) {
      deleteField(fieldId)
      return
    }

    // The server's answer is returned rather than swallowed: it is the only
    // thing that knows whether the field was archived and how many responses
    // that kept (features/0044). The field leaves the local list either way —
    // an archived field is not visible in the editor.
    return useAsyncAction({ loading, error }, async () => {
      const result = await fieldsService.delete(formId, fieldId)
      deleteField(fieldId)
      return result
    }, { fallbackMessage: 'Failed to delete field' })
  }

  const clearError = () => {
    error.value = null
  }

  const clearArchivedFieldIds = () => {
    archivedFieldIds.value = []
  }

  return {
    fields,
    selectedFieldId,
    isAddingField,
    hasUnsavedChanges,
    markDirty,
    fieldTypeToAdd,
    currentFormId,
    loading,
    error,
    archivedFieldIds,
    selectedField,
    fieldsByPage,
    startAddingField,
    cancelAddingField,
    addField,
    updateField,
    deleteField,
    selectField,
    moveField,
    resizeField,
    clearFields,
    getFieldsForPage,
    generateUniqueFieldName,
    fieldExists,
    loadFieldsFromPDF,
    setCurrentForm,
    loadFieldsFromForm,
    saveAllFields,
    saveField,
    deleteFieldFromServer,
    clearError,
    clearArchivedFieldIds
  }
})
