import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { fieldsService, type CreateFieldData, type BulkFieldData, type ArchivedField } from '../services/fields'
import { ApiError } from '../services/api'
import type { Field } from '../services/forms'
import { useAsyncAction } from '../composables/useAsyncAction'

export type FieldType = 'text' | 'textarea' | 'checkbox' | 'radio' | 'dropdown'

const LOCAL_ID_PREFIX = 'field-'

export function isLocalFieldId(id: string): boolean {
  return id.startsWith(LOCAL_ID_PREFIX)
}

/**
 * An id for a field that exists only in the browser.
 *
 * Exported because undo mints one too: a field the server hard-deleted may come
 * back, and it must come back as a **new local field** rather than with the id
 * of a row that no longer exists — see `forgetFieldId` in editor.store.ts.
 */
export function createLocalFieldId(): string {
  return `${LOCAL_ID_PREFIX}${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

/**
 * A copy deep enough that editing the original cannot reach it.
 *
 * The undo stack holds field lists, and a shallow copy would share `position`
 * with the live field — so dragging would silently rewrite the history entry
 * that is supposed to undo the drag.
 */
export function cloneFields(fields: FormField[]): FormField[] {
  return fields.map(field => ({
    ...field,
    position: { ...field.position },
    ...(field.options ? { options: [...field.options] } : {}),
    ...(field.validation ? { validation: { ...field.validation } } : {})
  }))
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
  // The archived fields themselves, as the rail lists them (features/0045).
  // Distinct from `archivedFieldIds`, which is the one-shot "this just
  // happened" signal the save toast reads: this one is the standing list of
  // everything this form ever archived, loaded from the server.
  const archivedFields = ref<ArchivedField[]>([])

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
    const id = createLocalFieldId()
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

  /**
   * Puts back a field list the undo stack was holding (features/0047).
   *
   * It marks the form dirty on purpose, and without checking whether the result
   * happens to match what was last saved. That check is not worth its cost: a
   * false positive is one save that writes what is already there, and a false
   * negative is the leave-the-editor prompt staying quiet while the user walks
   * away from work.
   */
  const restoreFieldsSnapshot = (snapshot: FormField[], selection: string | null) => {
    fields.value = cloneFields(snapshot)
    selectedFieldId.value = selection && fields.value.some(f => f.id === selection)
      ? selection
      : null
    markDirty()
  }

  const clearFields = () => {
    fields.value = []
    selectedFieldId.value = null
    isAddingField.value = false
    fieldTypeToAdd.value = null
    hasUnsavedChanges.value = false
    archivedFields.value = []
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
      const id = createLocalFieldId()
      fields.value.push({
        ...field,
        id
      })
    })
  }

  const setCurrentForm = (formId: string | null) => {
    currentFormId.value = formId
  }

  // The server's row shape is not the editor's. Extracted because restoring a
  // field has to produce exactly the same thing `loadFieldsFromForm` does —
  // a field that came back by a different door must be indistinguishable from
  // one that was loaded with the form.
  const toFormField = (field: Field): FormField => ({
    id: field.id,
    type: field.type,
    name: field.name,
    label: field.label,
    required: field.required,
    border: false,
    position: field.position as FormField['position'],
    options: field.options,
    validation: field.validation
  })

  const loadFieldsFromForm = (formFields: Field[]) => {
    fields.value = formFields.map(toFormField)
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
      // Only when this save actually archived something. The rail's list has to
      // grow the moment it happens, and re-reading it on every save would spend
      // a request on the answer "still none".
      if (archived.length > 0) await refreshArchivedFields(formId)
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
      if (result?.archived) await refreshArchivedFields(formId)
      return result
    }, { fallbackMessage: 'Failed to delete field' })
  }

  // Re-reads the archived list, swallowing its own failure: it is called after
  // a save or a delete that already succeeded, and turning "the sidebar is a
  // little stale" into an error toast would report the wrong thing as broken.
  const refreshArchivedFields = async (formId: string) => {
    try {
      archivedFields.value = await fieldsService.listArchived(formId)
    } catch {
      // Left as it was; the next load of the editor corrects it.
    }
  }

  /** The standing list of this form's archived fields, for the editor rail. */
  const loadArchivedFields = async () => {
    const formId = currentFormId.value
    if (!formId) return

    return useAsyncAction({ loading, error }, async () => {
      archivedFields.value = await fieldsService.listArchived(formId)
      return archivedFields.value
    }, { fallbackMessage: 'Failed to load archived fields' })
  }

  /**
   * Brings an archived field back, and **puts it into `fields`**.
   *
   * That second half is not bookkeeping, it is the whole point. The bulk save
   * reads its removals as "a live field of this form whose id is not in the
   * payload" — so a field restored on the server but missing from this list is
   * archived again by the very next `Save all`, with no error anywhere. The
   * user watches what they just recovered disappear.
   *
   * It deliberately does **not** call `markDirty`. The restore is a server
   * write that already happened; claiming there are unsaved changes would make
   * the "you have unsaved work" prompt on the way out of the editor say
   * something untrue.
   */
  const restoreArchivedField = async (fieldId: string) => {
    const formId = currentFormId.value
    if (!formId) {
      error.value = 'No form selected'
      return
    }

    return useAsyncAction({ loading, error }, async () => {
      const restored = await fieldsService.restore(formId, fieldId)
      fields.value.push(toFormField(restored))
      archivedFields.value = archivedFields.value.filter(f => f.id !== fieldId)
      selectedFieldId.value = restored.id
      return restored
    }, { fallbackMessage: 'Failed to restore field' })
  }

  /** Live fields already using a name, so the rail can warn before restoring. */
  const liveFieldNames = computed(() => new Set(fields.value.map(f => f.name)))

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
    archivedFields,
    liveFieldNames,
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
    restoreFieldsSnapshot,
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
    loadArchivedFields,
    restoreArchivedField,
    clearError,
    clearArchivedFieldIds
  }
})
