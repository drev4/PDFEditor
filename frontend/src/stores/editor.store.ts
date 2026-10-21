import { ref, computed, watch } from 'vue'
import { defineStore } from 'pinia'
import type { ImagePreview, TextPreview } from '@/types/common'
import { useDocumentSnapshotsStore } from './snapshots.store'
import { useFormFieldsStore, cloneFields, type FormField } from './formFields.store'

/**
 * One undo step.
 *
 * A `document` entry owns bytes in `snapshots.store.ts`; a `fields` entry owns
 * a copy of the editor's field list. They live on **one** stack, in the order
 * they happened, because there is one Undo button and one `Ctrl+Z` — two stacks
 * would make the same control do different things depending on state the user
 * cannot see.
 */
export type UndoEntry =
  | { kind: 'document'; label: string; documentId: string; snapshotId: string }
  | { kind: 'fields'; label: string; fields: FormField[]; selectedFieldId: string | null }

export type UndoResult =
  | { kind: 'document'; label: string; documentId: string; arrayBuffer: ArrayBuffer }
  | { kind: 'fields'; label: string }

/**
 * How many steps back the editor remembers.
 *
 * It caps the *stack*, not the snapshot store, so bytes can never outlive the
 * entry that owns them — eviction removes both together.
 */
const MAX_UNDO_ENTRIES = 10

export const useEditorStore = defineStore('editor', () => {
  const undoStack = ref<UndoEntry[]>([])
  const imagePreview = ref<ImagePreview | null>(null)
  const textPreview = ref<TextPreview | null>(null)

  const snapshotsStore = useDocumentSnapshotsStore()
  const formFieldsStore = useFormFieldsStore()

  const canUndo = computed(() => undoStack.value.length > 0)
  const undoDepth = computed(() => undoStack.value.length)
  const nextUndoLabel = computed(() => undoStack.value[undoStack.value.length - 1]?.label ?? null)

  const push = (entry: UndoEntry) => {
    undoStack.value.push(entry)

    while (undoStack.value.length > MAX_UNDO_ENTRIES) {
      const evicted = undoStack.value.shift()
      if (evicted?.kind === 'document') {
        snapshotsStore.removeSnapshotById(evicted.snapshotId)
      }
    }
  }

  /**
   * Records the document as it is *before* an edit, which is what makes that
   * edit undoable. Every tool that rewrites the PDF already called this; it now
   * pushes the undo entry too, so a tool cannot store bytes and forget to make
   * them reachable — which is exactly what `addBlankPage` used to do.
   */
  const saveSnapshot = (documentId: string, arrayBuffer: ArrayBuffer, label: string) => {
    const snapshotId = snapshotsStore.addSnapshot(documentId, arrayBuffer)
    push({ kind: 'document', label, documentId, snapshotId })
  }

  /**
   * Records the field list as it is *before* a change.
   *
   * The list is copied on the way in, so a caller may hand over the live array
   * without a later drag rewriting history behind it.
   */
  const pushFieldsUndo = (fields: FormField[], selectedFieldId: string | null, label: string) => {
    push({ kind: 'fields', label, fields: cloneFields(fields), selectedFieldId })
  }

  /**
   * Takes one step back, whatever kind it is.
   *
   * A `fields` entry is applied here, because the field list is state. A
   * `document` entry only *returns* its bytes: reloading the PDF is the caller's
   * job, and `composables/useEditorUndo.ts` is the one place that does it.
   */
  const undoLastEdit = (): UndoResult | null => {
    while (undoStack.value.length > 0) {
      const entry = undoStack.value.pop()
      if (!entry) return null

      if (entry.kind === 'fields') {
        formFieldsStore.restoreFieldsSnapshot(entry.fields, entry.selectedFieldId)
        return { kind: 'fields', label: entry.label }
      }

      const arrayBuffer = snapshotsStore.getSnapshotById(entry.snapshotId)
      snapshotsStore.removeSnapshotById(entry.snapshotId)

      // Bytes that are no longer there cannot restore anything. Skipping to the
      // older entry beats handing the caller a document it did not ask for.
      if (!arrayBuffer) continue

      return { kind: 'document', label: entry.label, documentId: entry.documentId, arrayBuffer }
    }

    return null
  }

  /**
   * Erases a field id from history, because the row it named is gone.
   *
   * This is the sharp edge of undo in this product. `POST /forms/:id/fields/bulk`
   * rejects the **whole** payload when it carries an id that is not a live field
   * of the form, so one dead id in one old entry breaks every subsequent
   * `Save all` — not just that field — until the page is reloaded. Deleting a
   * field therefore has to reach backwards through the stack:
   *
   * - `replacementId` set — the server hard-deleted a field that held no
   *   answers, and it may come back as a **new local field**. There are no
   *   answers to orphan, so a new id costs nothing.
   * - `replacementId` null — the server archived it, because it holds answers.
   *   Undo must not resurrect it at all: the way back is the rail's Restore
   *   (features/0045), which returns the row with its own id and its answers
   *   still attached.
   */
  const forgetFieldId = (deadId: string, replacementId: string | null) => {
    for (const entry of undoStack.value) {
      if (entry.kind !== 'fields') continue

      if (entry.selectedFieldId === deadId) {
        entry.selectedFieldId = replacementId
      }

      entry.fields = replacementId === null
        ? entry.fields.filter(f => f.id !== deadId)
        : entry.fields.map(f => (f.id === deadId ? { ...f, id: replacementId } : f))
    }
  }

  /**
   * Puts a field back into history, because it is live again.
   *
   * The mirror of `forgetFieldId`, for `restoreArchivedField`. Without it,
   * undoing past a restore drops the field from the list again — and the next
   * save reads that absence as a removal and re-archives what the user just
   * recovered, with a `200` and no error anywhere (features/0045).
   */
  const rememberField = (field: FormField) => {
    for (const entry of undoStack.value) {
      if (entry.kind !== 'fields') continue
      if (entry.fields.some(f => f.id === field.id)) continue
      entry.fields = [...entry.fields, ...cloneFields([field])]
    }
  }

  /** Drops field entries and keeps document ones. See the watcher below. */
  const clearFieldUndoEntries = () => {
    undoStack.value = undoStack.value.filter(entry => entry.kind !== 'fields')
  }

  const clearUndoHistory = (documentId?: string) => {
    for (const entry of undoStack.value) {
      if (entry.kind === 'document' && (!documentId || entry.documentId === documentId)) {
        snapshotsStore.removeSnapshotById(entry.snapshotId)
      }
    }

    undoStack.value = documentId
      ? undoStack.value.filter(e => e.kind === 'document' && e.documentId !== documentId)
      : []
  }

  /**
   * A save renames things, so history from before it is a lie.
   *
   * `saveAllFields` returns rows with **server** ids for fields that were local
   * a moment ago. An older entry still holds the local ids, and restoring it
   * would send a payload with no id for a field that now has a row — which the
   * bulk save reads as "create", quietly duplicating it. Watching the dirty flag
   * fall is how this store learns a save happened without importing the fields
   * store's actions and creating a cycle.
   */
  watch(
    () => formFieldsStore.hasUnsavedChanges,
    (isDirty, wasDirty) => {
      if (wasDirty && !isDirty) clearFieldUndoEntries()
    },
    // Synchronous on purpose: between the save landing and the next tick there
    // must be no window in which Undo offers an entry built on ids the save has
    // just replaced.
    { flush: 'sync' }
  )

  const setImagePreview = (preview: ImagePreview | null) => {
    imagePreview.value = preview
  }

  const updateImagePreviewPosition = (x: number, y: number) => {
    if (imagePreview.value) {
      imagePreview.value.x = x
      imagePreview.value.y = y
    }
  }

  const updateImagePreviewSize = (width: number, height: number) => {
    if (imagePreview.value) {
      imagePreview.value.width = width
      imagePreview.value.height = height
    }
  }

  const toggleMaintainAspectRatio = () => {
    if (imagePreview.value) {
      imagePreview.value.maintainAspectRatio = !imagePreview.value.maintainAspectRatio
    }
  }

  const resetImageSize = () => {
    if (imagePreview.value) {
      imagePreview.value.width = imagePreview.value.originalWidth
      imagePreview.value.height = imagePreview.value.originalHeight
    }
  }

  const clearImagePreview = () => {
    imagePreview.value = null
  }

  const setTextPreview = (preview: TextPreview | null) => {
    textPreview.value = preview
  }

  const updateTextPreviewPosition = (x: number, y: number) => {
    if (textPreview.value) {
      textPreview.value.x = x
      textPreview.value.y = y
    }
  }

  const updateTextPreviewText = (text: string) => {
    if (textPreview.value) {
      textPreview.value.text = text
    }
  }

  const updateTextPreviewFontSize = (fontSize: number) => {
    if (textPreview.value) {
      textPreview.value.fontSize = fontSize
    }
  }

  const updateTextPreviewColor = (color: string) => {
    if (textPreview.value) {
      textPreview.value.color = color
    }
  }

  const toggleTextBold = () => {
    if (textPreview.value) {
      textPreview.value.isBold = !textPreview.value.isBold
    }
  }

  const toggleTextItalic = () => {
    if (textPreview.value) {
      textPreview.value.isItalic = !textPreview.value.isItalic
    }
  }

  const clearTextPreview = () => {
    textPreview.value = null
  }

  /** Test seam: how many snapshots this document still holds. */
  const snapshotCount = (documentId: string) => snapshotsStore.getSnapshotsCount(documentId)

  return {
    undoStack,
    imagePreview,
    textPreview,
    canUndo,
    undoDepth,
    nextUndoLabel,
    maxUndoEntries: MAX_UNDO_ENTRIES,
    saveSnapshot,
    pushFieldsUndo,
    undoLastEdit,
    forgetFieldId,
    rememberField,
    clearFieldUndoEntries,
    clearUndoHistory,
    snapshotCount,
    setImagePreview,
    updateImagePreviewPosition,
    updateImagePreviewSize,
    toggleMaintainAspectRatio,
    resetImageSize,
    clearImagePreview,
    setTextPreview,
    updateTextPreviewPosition,
    updateTextPreviewText,
    updateTextPreviewFontSize,
    updateTextPreviewColor,
    toggleTextBold,
    toggleTextItalic,
    clearTextPreview
  }
}, {
  persist: false
})
