import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

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

  return {
    // State
    fields,
    selectedFieldId,
    isAddingField,
    fieldTypeToAdd,
    // Computed
    selectedField,
    fieldsByPage,
    // Actions
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
    loadFieldsFromPDF
  }
})
