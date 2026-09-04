import { onMounted, onBeforeUnmount, ref } from 'vue'
import { useEditorStore } from '@/stores/editor.store'
import { useFormFieldsStore, cloneFields, type FormField } from '@/stores/formFields.store'
import { useFieldEditing } from './useFieldEditing'

/**
 * The editor's keyboard for fields (features/0048).
 *
 * Bound on the window, beside the `Ctrl/Cmd+Z` in `EditorView.vue`, and for the
 * same reason: a field is placed with the mouse and nothing in the editor holds
 * focus afterwards. **Typing is exempt** by the same three checks — inside an
 * input, a textarea or a contenteditable the caret owns the arrow keys, and
 * stealing them there would move a field while the author renames one.
 *
 * Instantiate it **once**, in `EditorView.vue`. The burst state below belongs to
 * one binding site; a second instance would open a second gesture over the same
 * stack.
 */

/** One press, and one press with Shift held. */
const NUDGE_STEP = 1
const NUDGE_STEP_LARGE = 10

/**
 * How long a burst stays open with no key.
 *
 * A pause ends it — **not** letting go of the key. Holding an arrow down and
 * tapping it ten times in a row are the same act of nudging one field into
 * place, and they are equally capable of evicting ten document snapshots; only
 * the first would be caught by a burst that closed on `keyup`. Pressing again
 * after a pause is a new step, which is the granularity somebody nudging by
 * hand expects from Undo.
 */
const BURST_IDLE_MS = 500

export function useFieldKeyboard() {
  const formFieldsStore = useFormFieldsStore()
  const editorStore = useEditorStore()
  const { canEditGeometry, duplicateSelection } = useFieldEditing()

  /**
   * The field list as it was when the current burst of nudges started.
   *
   * This is the whole reason this composable exists rather than a `keydown`
   * that calls `moveFieldsBy`. The undo stack is capped at `MAX_UNDO_ENTRIES`
   * and evicts from the front, **freeing the PDF bytes** of any `document`
   * entry it drops — so one entry per keypress would not merely fill the stack,
   * key repeat would destroy every document snapshot the session holds in under
   * a second, and the text and image edits behind them would stop being
   * undoable with no error anywhere. One entry per burst.
   */
  const burstOpen = ref(false)
  /** Which fields the open burst is moving, so a new selection starts a new step. */
  let burstSelection = ''
  let burstTimer: ReturnType<typeof setTimeout> | null = null

  const endBurst = () => {
    burstOpen.value = false
    burstSelection = ''
    if (burstTimer) {
      clearTimeout(burstTimer)
      burstTimer = null
    }
  }

  const openBurstIfNeeded = (before: FormField[], selection: string) => {
    if (burstOpen.value && selection !== burstSelection) endBurst()

    if (!burstOpen.value) {
      // Pushed at the start, holding the list from before the first press: what
      // Undo has to restore is where the fields were when the burst began.
      editorStore.pushFieldsUndo(before, formFieldsStore.selectedFieldId, 'Fields nudged')
      burstOpen.value = true
      burstSelection = selection
    }

    if (burstTimer) clearTimeout(burstTimer)
    burstTimer = setTimeout(endBurst, BURST_IDLE_MS)
  }

  const nudge = (dx: number, dy: number) => {
    const ids = [...formFieldsStore.selectedFieldIds]
    if (ids.length === 0 || !canEditGeometry.value) return

    openBurstIfNeeded(cloneFields(formFieldsStore.fields), ids.join(','))
    formFieldsStore.moveFieldsBy(ids, dx, dy)
    formFieldsStore.markDirty()
  }

  const ARROWS: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1]
  }

  const isTyping = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null
    const tag = target?.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || !!target?.isContentEditable
  }

  const onKeydown = (event: KeyboardEvent) => {
    if (isTyping(event)) return

    const arrow = ARROWS[event.key]
    if (arrow && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const step = event.shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP
      const [dx, dy] = arrow
      if (formFieldsStore.selectedFieldIds.length === 0) return
      event.preventDefault()
      nudge(dx * step, dy * step)
      return
    }

    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'd') {
      if (formFieldsStore.selectedFieldIds.length === 0) return
      event.preventDefault()
      // A duplication is its own step, so whatever nudging came before it is
      // closed first rather than absorbing the copy.
      endBurst()
      duplicateSelection()
      return
    }

    if (event.key === 'Escape' && formFieldsStore.selectedFieldIds.length > 0) {
      endBurst()
      formFieldsStore.clearSelection()
    }
  }

  onMounted(() => window.addEventListener('keydown', onKeydown))

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeydown)
    endBurst()
  })

  return { nudge }
}
