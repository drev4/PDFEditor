import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore } from './editor.store'
import { useFormFieldsStore, type FormField } from './formFields.store'
import { setupPinia } from '../test/helpers/pinia-setup'

/**
 * The editor's undo stack (features/0047).
 *
 * The first two tests in `document edits` were written against the unfixed code
 * and failed there, each for its own reason:
 *
 *   - `undoLastEdit` popped the history and never the snapshot, so the second
 *     undo handed back the same bytes as the first.
 *   - `addBlankPage` saved a snapshot and pushed no `EditAction`, and the button
 *     read the history's length — so an undoable change left Undo disabled.
 *
 * Both are what one ordered stack fixes by construction.
 */

const bytes = (value: number): ArrayBuffer => new Uint8Array([value]).buffer
const firstByte = (buffer: ArrayBuffer): number => new Uint8Array(buffer)[0] as number

const aField = (id: string, x = 10, y = 10): FormField => ({
  id,
  type: 'text',
  name: `name_${id}`,
  label: `Label ${id}`,
  required: false,
  border: false,
  position: { x, y, width: 100, height: 20, page: 1 }
})

describe('Editor undo stack', () => {
  beforeEach(() => {
    setupPinia()
  })

  describe('document edits', () => {
    it('undoes two document edits, newest first', () => {
      const store = useEditorStore()

      store.saveSnapshot('doc-1', bytes(1), 'Text')
      store.saveSnapshot('doc-1', bytes(2), 'Image')

      const first = store.undoLastEdit()
      const second = store.undoLastEdit()

      expect(first).toEqual(
        expect.objectContaining({ kind: 'document', documentId: 'doc-1' })
      )
      expect(firstByte((first as { arrayBuffer: ArrayBuffer }).arrayBuffer)).toBe(2)
      expect(firstByte((second as { arrayBuffer: ArrayBuffer }).arrayBuffer)).toBe(1)
      expect(store.canUndo).toBe(false)
      expect(store.undoLastEdit()).toBeNull()
    })

    it('counts a snapshot with no further bookkeeping as undoable', () => {
      const store = useEditorStore()

      // What `addBlankPage` does: it snapshots and nothing else.
      store.saveSnapshot('doc-1', bytes(7), 'Blank page')

      expect(store.canUndo).toBe(true)
      expect(store.undoDepth).toBe(1)
      expect(store.nextUndoLabel).toBe('Blank page')
    })

    it('releases the bytes of an entry it evicts', () => {
      const store = useEditorStore()

      for (let i = 0; i < store.maxUndoEntries + 5; i++) {
        store.saveSnapshot('doc-1', bytes(i), `Edit ${i}`)
      }

      expect(store.undoDepth).toBe(store.maxUndoEntries)
      expect(store.snapshotCount('doc-1')).toBe(store.maxUndoEntries)
    })
  })

  describe('field edits', () => {
    it('restores the field list and says the work is unsaved', () => {
      const store = useEditorStore()
      const fieldsStore = useFormFieldsStore()

      fieldsStore.fields = [aField('field-a', 10, 10)]
      store.pushFieldsUndo(fieldsStore.fields, null, 'Field moved')

      fieldsStore.moveField('field-a', 500, 500)
      fieldsStore.hasUnsavedChanges = false

      const result = store.undoLastEdit()

      expect(result).toEqual(expect.objectContaining({ kind: 'fields' }))
      expect(fieldsStore.fields[0]?.position.x).toBe(10)
      expect(fieldsStore.fields[0]?.position.y).toBe(10)
      expect(fieldsStore.hasUnsavedChanges).toBe(true)
    })

    it('copies the list it is given, so later edits do not rewrite history', () => {
      const store = useEditorStore()
      const fieldsStore = useFormFieldsStore()

      fieldsStore.fields = [aField('field-a', 10, 10)]
      store.pushFieldsUndo(fieldsStore.fields, null, 'Field moved')
      fieldsStore.moveField('field-a', 999, 999)

      store.undoLastEdit()

      expect(fieldsStore.fields[0]?.position.x).toBe(10)
    })

    it('interleaves with document entries in one order', () => {
      const store = useEditorStore()
      const fieldsStore = useFormFieldsStore()

      fieldsStore.fields = [aField('field-a', 10, 10)]
      store.pushFieldsUndo(fieldsStore.fields, null, 'Field moved')
      fieldsStore.moveField('field-a', 200, 200)
      store.saveSnapshot('doc-1', bytes(3), 'Text')

      expect(store.undoLastEdit()).toEqual(
        expect.objectContaining({ kind: 'document' })
      )
      expect(store.undoLastEdit()).toEqual(
        expect.objectContaining({ kind: 'fields' })
      )
      expect(fieldsStore.fields[0]?.position.x).toBe(10)
    })
  })

  describe('ids that no longer name a live row', () => {
    /**
     * The bulk save rejects the **whole** payload when it carries an id that is
     * not a live field of the form (backend/src/routes/form-fields.ts). So a
     * deleted field's id must not survive anywhere in the stack — not only in
     * the entry that recorded the deletion.
     */
    it('rewrites a dead server id in every older entry', () => {
      const store = useEditorStore()
      const fieldsStore = useFormFieldsStore()

      const serverId = '11111111-1111-4111-8111-111111111111'
      fieldsStore.fields = [aField(serverId, 10, 10)]
      store.pushFieldsUndo(fieldsStore.fields, null, 'Field moved')

      store.forgetFieldId(serverId, 'field-revived')

      store.undoLastEdit()

      expect(fieldsStore.fields.map(f => f.id)).toEqual(['field-revived'])
    })

    it('drops an archived field from every older entry', () => {
      const store = useEditorStore()
      const fieldsStore = useFormFieldsStore()

      const serverId = '22222222-2222-4222-8222-222222222222'
      fieldsStore.fields = [aField(serverId, 10, 10), aField('field-b', 20, 20)]
      store.pushFieldsUndo(fieldsStore.fields, null, 'Field moved')

      store.forgetFieldId(serverId, null)

      store.undoLastEdit()

      expect(fieldsStore.fields.map(f => f.id)).toEqual(['field-b'])
    })

    it('puts a restored field into every older entry', () => {
      const store = useEditorStore()
      const fieldsStore = useFormFieldsStore()

      fieldsStore.fields = [aField('field-b', 20, 20)]
      store.pushFieldsUndo(fieldsStore.fields, null, 'Field moved')

      const restored = aField('33333333-3333-4333-8333-333333333333', 30, 30)
      store.rememberField(restored)

      store.undoLastEdit()

      expect(fieldsStore.fields.map(f => f.id)).toContain(restored.id)
    })
  })

  describe('lifecycle', () => {
    it('drops field entries once a save has renamed the ids', () => {
      const store = useEditorStore()
      const fieldsStore = useFormFieldsStore()

      fieldsStore.fields = [aField('field-a', 10, 10)]
      store.pushFieldsUndo(fieldsStore.fields, null, 'Field placed')
      store.saveSnapshot('doc-1', bytes(1), 'Text')
      fieldsStore.markDirty()

      // What a successful `saveAllFields` does at the end.
      fieldsStore.hasUnsavedChanges = false

      expect(store.undoDepth).toBe(1)
      expect(store.nextUndoLabel).toBe('Text')
    })

    it('clears everything when the editor lets go of the document', () => {
      const store = useEditorStore()

      store.saveSnapshot('doc-1', bytes(1), 'Text')
      store.clearUndoHistory()

      expect(store.canUndo).toBe(false)
      expect(store.snapshotCount('doc-1')).toBe(0)
    })
  })
})
