import { computed } from 'vue'
import { useDocumentStore } from '@/stores/document.store'
import { useEditorStore } from '@/stores/editor.store'
import { useFormFieldsStore, cloneFields } from '@/stores/formFields.store'
import { alignRects, distributeRects, type AlignMode, type DistributeAxis, type Rect } from '@/utils/fieldGeometry'

/**
 * What can be done to a selection of fields, in one place (features/0048).
 *
 * It exists for the same reason `useEditorUndo` does: duplicate, align and
 * distribute are each reachable from two controls — the properties panel and
 * the keyboard — and two copies of "capture the list, change it, push one undo
 * entry" is how they drift apart.
 *
 * The undo push lives **here and not in the store** by necessity, not taste:
 * `editor.store.ts` imports `formFields.store.ts`, so the field store cannot
 * import the editor store back without a cycle. The store mutates; the
 * composable records.
 */
export function useFieldEditing() {
  const formFieldsStore = useFormFieldsStore()
  const editorStore = useEditorStore()
  const documentStore = useDocumentStore()

  /**
   * Geometry is refused while the page is turned, exactly as dragging is
   * (`FormFieldItem.vue`). Arrow keys, align and distribute all name a *screen*
   * direction and write a *stored* axis, and on a page turned 90° those are not
   * the same thing — the field would move somewhere the author did not point,
   * silently and permanently, on the printed PDF.
   */
  const isRotated = computed(() => ((documentStore.activeDocument?.rotation ?? 0) % 360) !== 0)
  const canEditGeometry = computed(() => !isRotated.value)

  const selectionRects = (): Rect[] =>
    formFieldsStore.selectedFields.map(field => ({
      id: field.id,
      x: field.position.x,
      y: field.position.y,
      width: field.position.width,
      height: field.position.height
    }))

  /** Runs `change` between a capture and one undo entry. */
  const asOneEdit = (label: string, change: () => boolean) => {
    const before = cloneFields(formFieldsStore.fields)
    const selectionBefore = formFieldsStore.selectedFieldId

    if (!change()) return

    editorStore.pushFieldsUndo(before, selectionBefore, label)
    formFieldsStore.markDirty()
  }

  const duplicateSelection = () => {
    if (formFieldsStore.selectedFieldIds.length === 0) return

    const ids = [...formFieldsStore.selectedFieldIds]
    asOneEdit(
      ids.length > 1 ? `${ids.length} fields duplicated` : 'Field duplicated',
      () => formFieldsStore.duplicateFields(ids).length > 0
    )
  }

  const alignSelection = (mode: AlignMode) => {
    if (!canEditGeometry.value) return

    asOneEdit('Fields aligned', () => {
      const placements = alignRects(selectionRects(), mode)
      if (placements.length === 0) return false
      formFieldsStore.applyPlacements(placements)
      return true
    })
  }

  const distributeSelection = (axis: DistributeAxis) => {
    if (!canEditGeometry.value) return

    asOneEdit('Fields distributed', () => {
      const placements = distributeRects(selectionRects(), axis)
      if (placements.length === 0) return false
      formFieldsStore.applyPlacements(placements)
      return true
    })
  }

  return {
    canEditGeometry,
    duplicateSelection,
    alignSelection,
    distributeSelection
  }
}
