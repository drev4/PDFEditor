import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { useFieldKeyboard } from './useFieldKeyboard'
import { useFormFieldsStore, isLocalFieldId, type FormField } from '@/stores/formFields.store'
import { useEditorStore } from '@/stores/editor.store'
import { useDocumentStore } from '@/stores/document.store'

vi.mock('@/services/fields')

/**
 * The editor's keyboard (features/0048).
 *
 * The first test here is the one that matters, and it is a regression rather
 * than a feature: the undo stack is capped at ten entries and evicts from the
 * front, freeing the PDF bytes of any `document` entry it drops. One entry per
 * keypress would therefore not merely fill the stack — key repeat would
 * **destroy every document snapshot the session holds** in well under a second,
 * and the text and image edits behind them would stop being undoable with no
 * error anywhere. A burst of nudges has to be one entry.
 */

const aField = (id: string, x = 100, y = 50): FormField => ({
  id,
  type: 'text',
  name: `name_${id}`,
  label: `Label ${id}`,
  required: false,
  border: false,
  position: { x, y, width: 100, height: 20, page: 1 }
})

const Harness = defineComponent({
  setup() {
    useFieldKeyboard()
    return () => null
  }
})

const press = (key: string, init: KeyboardEventInit = {}) => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
}

/** Waits out the burst window, which is what closes an undo step. */
const pause = () => new Promise(resolve => setTimeout(resolve, 600))

describe('useFieldKeyboard', () => {
  let store: ReturnType<typeof useFormFieldsStore>
  let editorStore: ReturnType<typeof useEditorStore>
  let wrapper: ReturnType<typeof mount>

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useFormFieldsStore()
    editorStore = useEditorStore()
    store.setCurrentForm('form-1')
    store.loadFieldsFromForm([aField('f1'), aField('f2', 300, 90)] as never[])
    wrapper = mount(Harness)
  })

  afterEach(() => {
    wrapper.unmount()
  })

  describe('nudging', () => {
    it('moves the selection by one pixel per press', () => {
      store.selectField('f1')

      press('ArrowRight')
      press('ArrowDown')

      expect(store.fields[0]?.position).toMatchObject({ x: 101, y: 51 })
      expect(store.hasUnsavedChanges).toBe(true)
    })

    it('moves by ten with shift held', () => {
      store.selectField('f1')

      press('ArrowLeft', { shiftKey: true })

      expect(store.fields[0]?.position.x).toBe(90)
    })

    it('moves every field in a multi-selection', () => {
      store.selectFields(['f1', 'f2'])

      press('ArrowRight')

      expect(store.fields[0]?.position.x).toBe(101)
      expect(store.fields[1]?.position.x).toBe(301)
    })

    // The regression. Ten presses is a second of key repeat, or ten taps, and
    // MAX_UNDO_ENTRIES is ten — so one entry per press would push the document
    // snapshot off the stack and free its bytes.
    it('records one undo entry for a burst, and leaves the document history alone', () => {
      editorStore.saveSnapshot('doc-1', new Uint8Array([7]).buffer, 'Text')
      store.selectField('f1')

      for (let i = 0; i < 10; i++) press('ArrowRight')

      expect(editorStore.undoDepth).toBe(2)
      expect(editorStore.snapshotCount('doc-1')).toBe(1)

      editorStore.undoLastEdit()

      expect(store.fields[0]?.position.x).toBe(100)
      expect(editorStore.nextUndoLabel).toBe('Text')
    })

    // Letting go of the key does not end the step, a pause does: ten taps in a
    // row are one act of nudging, and ten entries would evict the document
    // history just as effectively as key repeat would.
    it('keeps one entry across separate presses in the same burst', () => {
      store.selectField('f1')

      press('ArrowRight')
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight' }))
      press('ArrowRight')

      expect(editorStore.undoDepth).toBe(1)
    })

    it('starts a new entry after a pause', async () => {
      store.selectField('f1')

      press('ArrowRight')
      await pause()
      press('ArrowRight')

      expect(editorStore.undoDepth).toBe(2)
    })

    it('starts a new entry when the selection changes mid-burst', () => {
      store.selectField('f1')
      press('ArrowRight')

      store.selectField('f2')
      press('ArrowRight')

      expect(editorStore.undoDepth).toBe(2)
    })

    it('does nothing without a selection', () => {
      press('ArrowRight')

      expect(store.fields[0]?.position.x).toBe(100)
      expect(editorStore.undoDepth).toBe(0)
    })

    // Same rule the drag already follows: a screen direction is not a stored
    // axis on a turned page, and writing one unmapped is silent corruption of
    // the printed PDF.
    it('refuses while the page is rotated', () => {
      const documentStore = useDocumentStore()
      documentStore.documents.push({ id: 'doc-1', rotation: 90 } as never)
      documentStore.activeDocumentId = 'doc-1'
      store.selectField('f1')

      press('ArrowRight')

      expect(store.fields[0]?.position.x).toBe(100)
      expect(store.hasUnsavedChanges).toBe(false)
    })

    it('leaves the arrow keys to the caret while an input has focus', () => {
      store.selectField('f1')
      const input = document.createElement('input')
      document.body.appendChild(input)

      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))

      expect(store.fields[0]?.position.x).toBe(100)
      input.remove()
    })
  })

  describe('duplicating', () => {
    it('copies the selection with Ctrl+D and records one undo entry', () => {
      store.selectFields(['f1', 'f2'])

      press('d', { ctrlKey: true })

      expect(store.fields).toHaveLength(4)
      expect(store.fields.filter(f => isLocalFieldId(f.id))).toHaveLength(2)
      expect(editorStore.undoDepth).toBe(1)

      editorStore.undoLastEdit()

      expect(store.fields).toHaveLength(2)
    })

    it('answers to Cmd+D as well', () => {
      store.selectField('f1')

      press('d', { metaKey: true })

      expect(store.fields).toHaveLength(3)
    })

    it('does nothing without a selection', () => {
      press('d', { ctrlKey: true })

      expect(store.fields).toHaveLength(2)
    })
  })

  describe('escape', () => {
    it('clears the selection', () => {
      store.selectFields(['f1', 'f2'])

      press('Escape')

      expect(store.selectedFieldIds).toEqual([])
      expect(store.selectedFieldId).toBeNull()
    })
  })
})
