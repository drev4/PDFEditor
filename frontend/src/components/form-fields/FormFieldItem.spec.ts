import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import FormFieldItem from './FormFieldItem.vue'
import { useFormFieldsStore } from '@/stores/formFields.store'
import { useEditorStore } from '@/stores/editor.store'

vi.mock('@/services/fields')

// Built fresh per test: the store keeps the object it is given, so a shared
// literal is mutated by every drag and the next test starts somewhere else.
const makeField = () => ({
  id: 'field-1',
  type: 'text' as const,
  name: 'text_1',
  label: 'Full name',
  required: false,
  position: { x: 100, y: 50, width: 200, height: 30, page: 1 }
})

const mountItem = (overrides: Record<string, unknown> = {}) =>
  mount(FormFieldItem, {
    props: {
      field: useFormFieldsStore().fields[0],
      pageWidth: 600,
      pageHeight: 800,
      rotation: 0,
      scaleFactor: 1,
      ...overrides
    }
  })

describe('FormFieldItem', () => {
  let store: ReturnType<typeof useFormFieldsStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useFormFieldsStore()
    store.setCurrentForm('form-1')
    store.loadFieldsFromForm([makeField()] as any)
    vi.clearAllMocks()
  })

  const drag = async (wrapper: ReturnType<typeof mountItem>) => {
    await wrapper.trigger('mousedown', { clientX: 100, clientY: 100 })
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 140, clientY: 120 }))
    document.dispatchEvent(new MouseEvent('mouseup'))
  }

  // Moving a field used to write straight to the server on mouseup, while text
  // and images waited for `Save all`. Two save models in one screen means the
  // user cannot know what is stored without remembering which tool they used.
  it('does not save to the server when a field is dropped', async () => {
    const saveField = vi.spyOn(store, 'saveField')

    await drag(mountItem())

    expect(saveField).not.toHaveBeenCalled()
  })

  it('marks the form as having unsaved changes instead', async () => {
    expect(store.hasUnsavedChanges).toBe(false)

    await drag(mountItem())

    expect(store.hasUnsavedChanges).toBe(true)
  })

  it('still moves the field locally, so the drag is visible', async () => {
    await drag(mountItem())

    const moved = store.fields.find(f => f.id === 'field-1')
    expect(moved?.position.x).toBe(140)
    expect(moved?.position.y).toBe(70)
  })

  // Drag is refused on a rotated page: a screen delta is not a stored delta
  // there, and applying it unmapped writes a position nobody pointed at.
  it('does not move anything while the page is rotated', async () => {
    await drag(mountItem({ rotation: 90 }))

    const unmoved = store.fields.find(f => f.id === 'field-1')
    expect(unmoved?.position.x).toBe(100)
    expect(store.hasUnsavedChanges).toBe(false)
  })

  // Undo commits on mouseup (features/0047). `moveField` runs on every
  // mousemove, so anything pushing from there turns one drag into a stack of
  // sixty steps.
  describe('undo', () => {
    it('records one step for one drag, however many mousemoves it took', async () => {
      const editorStore = useEditorStore()
      const wrapper = mountItem()

      await wrapper.trigger('mousedown', { clientX: 100, clientY: 100 })
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 110, clientY: 105 }))
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 130, clientY: 115 }))
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 140, clientY: 120 }))
      document.dispatchEvent(new MouseEvent('mouseup'))

      expect(editorStore.undoDepth).toBe(1)
      expect(editorStore.nextUndoLabel).toBe('Field moved')

      editorStore.undoLastEdit()

      const restored = store.fields.find(f => f.id === 'field-1')
      expect(restored?.position.x).toBe(100)
      expect(restored?.position.y).toBe(50)
    })

    it('records nothing for a mouse-down that only selects', async () => {
      const editorStore = useEditorStore()
      const wrapper = mountItem()

      await wrapper.trigger('mousedown', { clientX: 100, clientY: 100 })
      document.dispatchEvent(new MouseEvent('mouseup'))

      expect(editorStore.undoDepth).toBe(0)
      expect(store.hasUnsavedChanges).toBe(false)
    })

    it('records one step for one resize', async () => {
      const editorStore = useEditorStore()
      store.selectField('field-1')
      const wrapper = mountItem()
      await wrapper.vm.$nextTick()

      await wrapper.find('.resize-handle.se').trigger('mousedown', { clientX: 300, clientY: 80 })
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 340, clientY: 100 }))
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 360, clientY: 110 }))
      document.dispatchEvent(new MouseEvent('mouseup'))

      expect(editorStore.undoDepth).toBe(1)
      expect(editorStore.nextUndoLabel).toBe('Field resized')

      editorStore.undoLastEdit()

      const restored = store.fields.find(f => f.id === 'field-1')
      expect(restored?.position.width).toBe(200)
      expect(restored?.position.height).toBe(30)
    })
  })
})
