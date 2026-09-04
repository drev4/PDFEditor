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
  /**
   * The field whose properties the panel shows.
   *
   * It is **always** a member of `selectedFieldIds` while that is non-empty,
   * and null exactly when it is empty. Nothing outside this store writes either
   * of them directly: `setSelection` is the one place the two are kept in step,
   * because a primary outside the selection is a panel editing a field the user
   * cannot see is selected.
   */
  const selectedFieldId = ref<string | null>(null)
  /** Every selected field, in the order they were added (features/0048). */
  const selectedFieldIds = ref<string[]>([])
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

  /** Every selected field, in the document's own order. */
  const selectedFields = computed(() =>
    fields.value.filter(f => selectedFieldIds.value.includes(f.id))
  )

  const hasMultiSelection = computed(() => selectedFieldIds.value.length > 1)

  const isFieldSelected = (id: string) => selectedFieldIds.value.includes(id)

  /**
   * The one place a selection is written.
   *
   * Ids that name no field are dropped here rather than at each call site: a
   * selection surviving a delete, a restored snapshot or a reload would leave
   * the panel showing a field that is gone, and a nudge writing to nothing.
   */
  const setSelection = (ids: string[], primary?: string | null) => {
    const live = ids.filter(id => fields.value.some(f => f.id === id))
    selectedFieldIds.value = live
    const wanted = primary === undefined ? selectedFieldId.value : primary
    selectedFieldId.value = wanted && live.includes(wanted)
      ? wanted
      : (live[live.length - 1] ?? null)
  }

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
    setSelection([])
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
    setSelection([id], id)
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
      setSelection(selectedFieldIds.value.filter(selected => selected !== id))
    }
  }

  /** Replaces the whole selection with this one field, or clears it. */
  const selectField = (id: string | null) => {
    setSelection(id ? [id] : [], id)
  }

  const selectFields = (ids: string[]) => {
    setSelection(ids, ids[ids.length - 1] ?? null)
  }

  const clearSelection = () => {
    setSelection([])
  }

  /**
   * Adds a field to the selection, or takes it out again.
   *
   * A selection is confined to one page: aligning a field on page 1 with one on
   * page 3 means nothing, and the canvas only ever renders one page at a time,
   * so a cross-page selection is only reachable from the panel's layer list.
   * Reaching for a field on another page replaces the selection instead of
   * quietly producing a set no operation can act on.
   */
  const toggleFieldSelection = (id: string) => {
    const field = fields.value.find(f => f.id === id)
    if (!field) return

    if (selectedFieldIds.value.includes(id)) {
      setSelection(selectedFieldIds.value.filter(selected => selected !== id))
      return
    }

    const primary = fields.value.find(f => f.id === selectedFieldId.value)
    if (primary && primary.position.page !== field.position.page) {
      setSelection([id], id)
      return
    }

    setSelection([...selectedFieldIds.value, id], id)
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
   * Moves a whole set by one delta (features/0048).
   *
   * The delta is clamped, not the fields. Clamping each field on its own would
   * squash the layout the author built — the one at the edge stops while the
   * rest keep going — so the set moves as a set, or stops as a set.
   */
  const moveFieldsBy = (ids: string[], dx: number, dy: number) => {
    const targets = fields.value.filter(f => ids.includes(f.id))
    if (targets.length === 0) return

    const allowedDx = Math.max(dx, -Math.min(...targets.map(f => f.position.x)))
    const allowedDy = Math.max(dy, -Math.min(...targets.map(f => f.position.y)))

    for (const field of targets) {
      field.position.x += allowedDx
      field.position.y += allowedDy
    }
  }

  /** Writes the corners `utils/fieldGeometry.ts` worked out. */
  const applyPlacements = (placements: Array<{ id: string; x: number; y: number }>) => {
    for (const placement of placements) {
      const field = fields.value.find(f => f.id === placement.id)
      if (!field) continue
      field.position.x = Math.max(0, placement.x)
      field.position.y = Math.max(0, placement.y)
    }
  }

  /**
   * Copies fields, and never their ids.
   *
   * `saveAllFields` sends `id` for every field whose id is not local, so a copy
   * carrying its original's server id is a **second update to one row**: the
   * bulk save applies both, the later one wins, and one of the two fields is
   * simply never created — with a `200` and nothing in any log. The name has to
   * be new for the same class of reason, because an AcroForm identifies a field
   * by name and `addField` does not check for a collision the way `updateField`
   * does.
   */
  const DUPLICATE_OFFSET = 12

  const duplicateFields = (ids: string[]): FormField[] => {
    const originals = fields.value.filter(f => ids.includes(f.id))
    if (originals.length === 0) return []

    const copies = cloneFields(originals).map(original => {
      const copy: FormField = {
        ...original,
        id: createLocalFieldId(),
        name: generateUniqueFieldName(original.type),
        position: {
          ...original.position,
          x: original.position.x + DUPLICATE_OFFSET,
          y: original.position.y + DUPLICATE_OFFSET
        }
      }
      // Pushed one at a time on purpose: `generateUniqueFieldName` reads the
      // live list, so two copies made in one pass would otherwise be handed the
      // same name.
      fields.value.push(copy)
      return copy
    })

    setSelection(copies.map(f => f.id))
    markDirty()
    return copies
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
    // The multi-selection is not restored, only filtered. An `UndoEntry` carries
    // one `selectedFieldId` and `forgetFieldId` scrubs exactly that one when a
    // row dies (features/0047); a second collection inside the entry would have
    // to be scrubbed in both places too, and a stale selection there is a nudge
    // writing to a field that no longer exists.
    setSelection(selectedFieldIds.value, selection)
    markDirty()
  }

  const clearFields = () => {
    fields.value = []
    setSelection([])
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
    setSelection([])

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
    setSelection([])
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
      setSelection([restored.id], restored.id)
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
    selectedFieldIds,
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
    selectedFields,
    hasMultiSelection,
    isFieldSelected,
    fieldsByPage,
    startAddingField,
    cancelAddingField,
    addField,
    updateField,
    deleteField,
    selectField,
    selectFields,
    toggleFieldSelection,
    clearSelection,
    moveField,
    moveFieldsBy,
    applyPlacements,
    duplicateFields,
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
