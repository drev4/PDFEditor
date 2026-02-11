import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { fieldsService, type CreateFieldData } from '../services/fields'
import { ApiError } from '../services/api'
import type { Field } from '../services/forms'

export type FieldType = 'text' | 'textarea' | 'checkbox' | 'radio' | 'dropdown'

export interface FormField {
  id: string
  type: FieldType
  name: string
  label: string
  required: boolean
  border: boolean // Si el campo tiene borde visible
  position: {
    x: number
    y: number
    width: number
    height: number
    page: number
  }
  options?: string[] // Para radio/dropdown
  validation?: {
    minLength?: number
    maxLength?: number
    pattern?: string
  }
}

export const useFormFieldsStore = defineStore('formFields', () => {
  // State
  const fields = ref<FormField[]>([])
  const selectedFieldId = ref<string | null>(null)
  const isAddingField = ref(false)
  const fieldTypeToAdd = ref<FieldType | null>(null)
  const currentFormId = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  // Computed
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

  // Actions
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
    const id = `field-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
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
        // Si se está actualizando el nombre, verificar que no exista otro campo con ese nombre
        if (updates.name && updates.name !== current.name) {
          if (fieldExists(updates.name, id)) {
            console.warn(`El campo con nombre "${updates.name}" ya existe`)
            return // No actualizar si el nombre ya existe
          }
        }

        fields.value[index] = {
          ...current,
          ...updates,
          id: current.id // Ensure id is never overwritten
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
    // Limpia los campos existentes antes de cargar
    fields.value = []
    selectedFieldId.value = null

    // Añade los campos del PDF
    pdfFields.forEach(field => {
      const id = `field-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      fields.value.push({
        ...field,
        id
      })
    })
  }

  // ============================================================================
  // SERVER PERSISTENCE METHODS
  // ============================================================================

  const setCurrentForm = (formId: string | null) => {
    currentFormId.value = formId
  }

  const loadFieldsFromForm = (formFields: Field[]) => {
    // Convert backend Field format to FormField format
    fields.value = formFields.map(field => ({
      id: field.id,
      type: field.type,
      name: field.name,
      label: field.label,
      required: field.required,
      border: false, // Default value for UI - transparent without border
      position: field.position as FormField['position'],
      options: field.options,
      validation: field.validation
    }))
    selectedFieldId.value = null
  }

  const saveAllFields = async () => {
    if (!currentFormId.value) {
      error.value = 'No form selected'
      return
    }

    loading.value = true
    error.value = null

    try {
      // Convert FormField format to CreateFieldData format with validation
      const fieldsData: CreateFieldData[] = fields.value.map((field, index) => ({
        type: field.type,
        name: field.name || `field_${Date.now()}_${index}`, // Ensure name is not empty
        label: field.label || field.name || 'Untitled Field', // Ensure label is not empty (min 1 char required)
        required: field.required,
        position: field.position,
        options: field.options && field.options.length > 0 ? field.options : undefined, // Only send if not empty
        validation: field.validation && Object.keys(field.validation).length > 0 ? field.validation : undefined, // Only send if not empty
        order: index
      }))

      const savedFields = await fieldsService.bulkSave(currentFormId.value, fieldsData)

      // Update local fields with server IDs
      loadFieldsFromForm(savedFields)

      return savedFields
    } catch (e) {
      if (e instanceof ApiError) {
        error.value = e.message
      } else {
        error.value = 'Failed to save fields'
      }
      throw e
    } finally {
      loading.value = false
    }
  }

  const saveField = async (fieldId: string) => {
    if (!currentFormId.value) {
      error.value = 'No form selected'
      return
    }

    const field = fields.value.find(f => f.id === fieldId)
    if (!field) {
      error.value = 'Field not found'
      return
    }

    loading.value = true
    error.value = null

    try {
      // Prepare field data and ensure it meets backend validation requirements
      const fieldData: CreateFieldData = {
        type: field.type,
        name: field.name || `field_${Date.now()}`, // Ensure name is not empty
        label: field.label || field.name || 'Untitled Field', // Ensure label is not empty
        required: field.required,
        position: field.position,
        options: field.options && field.options.length > 0 ? field.options : undefined, // Only send if not empty
        validation: field.validation && Object.keys(field.validation).length > 0 ? field.validation : undefined, // Only send if not empty
        order: fields.value.indexOf(field)
      }

      // Check if field has a UUID (server-generated) or temp ID (local only)
      const isServerField = field.id.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)

      let savedField: Field
      if (isServerField) {
        // Update existing field
        savedField = await fieldsService.update(currentFormId.value, fieldId, fieldData)
      } else {
        // Create new field
        savedField = await fieldsService.create(currentFormId.value, fieldData)
      }

      // Update local field with server data
      const index = fields.value.findIndex(f => f.id === fieldId)
      if (index !== -1) {
        fields.value[index] = {
          ...field,
          id: savedField.id // Update with server ID
        }
      }

      return savedField
    } catch (e) {
      if (e instanceof ApiError) {
        error.value = e.message
      } else {
        error.value = 'Failed to save field'
      }
      throw e
    } finally {
      loading.value = false
    }
  }

  const deleteFieldFromServer = async (fieldId: string) => {
    if (!currentFormId.value) {
      error.value = 'No form selected'
      return
    }

    // Check if field exists on server (has UUID)
    const isServerField = fieldId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)

    if (!isServerField) {
      // Field only exists locally, just remove from local state
      deleteField(fieldId)
      return
    }

    loading.value = true
    error.value = null

    try {
      await fieldsService.delete(currentFormId.value, fieldId)

      // Remove from local state
      deleteField(fieldId)
    } catch (e) {
      if (e instanceof ApiError) {
        error.value = e.message
      } else {
        error.value = 'Failed to delete field'
      }
      throw e
    } finally {
      loading.value = false
    }
  }

  const clearError = () => {
    error.value = null
  }

  return {
    // State
    fields,
    selectedFieldId,
    isAddingField,
    fieldTypeToAdd,
    currentFormId,
    loading,
    error,
    // Computed
    selectedField,
    fieldsByPage,
    // Actions - Local (immediate UI updates)
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
    // Actions - Server persistence
    setCurrentForm,
    loadFieldsFromForm,
    saveAllFields,
    saveField,
    deleteFieldFromServer,
    clearError
  }
})
