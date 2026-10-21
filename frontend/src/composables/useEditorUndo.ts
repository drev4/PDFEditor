import { computed } from 'vue'
import { useDocumentStore } from '@/stores/document.store'
import { useEditorStore } from '@/stores/editor.store'
import type { UndoResult } from '@/stores/editor.store'

/**
 * The editor's one Undo.
 *
 * The stack lives in `editor.store.ts` because it is state; this is the
 * orchestration around it, and it exists so there is exactly **one** place that
 * knows what applying an undo means. The Undo button in `PDFEditor.vue` and the
 * `Ctrl+Z` in `EditorView.vue` are two controls over one behaviour, and two
 * copies of "put the bytes back and reload" is how they would drift apart.
 *
 * Field entries are applied by the store itself — the field list is state, and
 * there is nothing to render. A document entry hands back bytes, and putting
 * them into the document and asking the viewer to redraw is what happens here.
 */
export function useEditorUndo() {
  const documentStore = useDocumentStore()
  const editorStore = useEditorStore()

  const canUndo = computed(() => editorStore.canUndo)
  const undoDepth = computed(() => editorStore.undoDepth)
  const nextUndoLabel = computed(() => editorStore.nextUndoLabel)

  const undo = (): UndoResult | null => {
    const result = editorStore.undoLastEdit()
    if (!result) return null

    if (result.kind === 'document') {
      const target = documentStore.documents.find(d => d.id === result.documentId)
      // The document may have been closed while its entry was still on the
      // stack. Restoring bytes into nothing would be worse than doing nothing.
      if (!target) return null

      target.arrayBuffer = result.arrayBuffer
      documentStore.triggerPDFReload()
    }

    return result
  }

  return { canUndo, undoDepth, nextUndoLabel, undo }
}
