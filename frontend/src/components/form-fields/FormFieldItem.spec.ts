import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import FormFieldItem from './FormFieldItem.vue'
import { useFormFieldsStore } from '@/stores/formFields.store'
import { useEditorStore } from '@/stores/editor.store'
import { useDrawingStore } from '@/stores/drawing.store'

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

  /**
   * Snap to grid (features/0051).
   *
   * The toggle existed and did nothing to a field: the magnet lives in
   * `useDragAndDrop`, which `FormFieldItem.vue` has never used. These were
   * written before the fix and the first one failed against `develop` with the
   * field left exactly where the mouse dropped it.
   */
  describe('snap to grid', () => {
    const dragTo = async (
      wrapper: ReturnType<typeof mountItem>,
      to: { x: number; y: number }
    ) => {
      await wrapper.trigger('mousedown', { clientX: 100, clientY: 100 })
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: to.x, clientY: to.y }))
      document.dispatchEvent(new MouseEvent('mouseup'))
    }

    it('drops the field on the grid when the magnet is on', async () => {
      const drawing = useDrawingStore()
      drawing.snapToGrid = true

      // From (100, 50) by (+47, +13) lands on (147, 63), between the lines at
      // 140/160 and 60/80.
      await dragTo(mountItem(), { x: 147, y: 113 })

      const moved = store.fields.find(f => f.id === 'field-1')
      expect(moved?.position.x).toBe(140)
      expect(moved?.position.y).toBe(60)
    })

    it('leaves the field exactly where it was dropped when the magnet is off', async () => {
      await dragTo(mountItem(), { x: 147, y: 113 })

      const moved = store.fields.find(f => f.id === 'field-1')
      expect(moved?.position.x).toBe(147)
      expect(moved?.position.y).toBe(63)
    })

    /**
     * The grid is drawn every `gridSize` **canvas** pixels and the field is
     * stored in base-scale units, so the step in stored units is
     * `gridSize / scaleFactor`. Snapping the stored value to `gridSize` itself
     * — the one-line version — puts the field on a grid that is not the one on
     * the screen at any zoom but this one.
     */
    it('snaps to the grid the author can see, not to the stored units', async () => {
      const drawing = useDrawingStore()
      drawing.snapToGrid = true

      // At twice the base scale a visible line is every 10 stored units, so
      // (147, 63) rounds to (150, 60) rather than to (140, 60).
      await dragTo(mountItem({ scaleFactor: 2 }), { x: 147, y: 113 })

      const moved = store.fields.find(f => f.id === 'field-1')
      expect(moved?.position.x).toBe(150)
      expect(moved?.position.y).toBe(60)
    })

    /**
     * The delta is snapped, not each field. Snapping them one by one is the
     * bug the delta clamp already avoids: six fields the author lined up 7px
     * apart would all land on the same line.
     */
    it('keeps the arrangement of a multi-selection', async () => {
      const drawing = useDrawingStore()
      drawing.snapToGrid = true
      store.loadFieldsFromForm([
        makeField(),
        { ...makeField(), id: 'field-2', name: 'text_2', position: { x: 107, y: 57, width: 200, height: 30, page: 1 } }
      ] as any)
      store.selectFields(['field-1', 'field-2'])

      await dragTo(mountItem({ field: store.fields[0] }), { x: 147, y: 113 })

      const [first, second] = store.fields
      expect(first?.position.x).toBe(140)
      // Seven pixels apart before, seven pixels apart after.
      expect(second!.position.x - first!.position.x).toBe(7)
      expect(second!.position.y - first!.position.y).toBe(7)
    })
  })

  // Multi-selection (features/0048). A marquee would have to take `mousedown`
  // on empty page area away from the text layer underneath, so the gesture is a
  // modifier-click on the field itself.
  describe('multi-selection', () => {
    beforeEach(() => {
      store.loadFieldsFromForm([makeField(), { ...makeField(), id: 'field-2', name: 'text_2' }] as any)
    })

    it('adds a field to the selection on shift-click without dragging it', async () => {
      store.selectField('field-1')
      const wrapper = mountItem({ field: store.fields[1] })

      await wrapper.trigger('mousedown', { clientX: 100, clientY: 100, shiftKey: true })
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 200 }))
      document.dispatchEvent(new MouseEvent('mouseup'))

      expect(store.selectedFieldIds).toEqual(['field-1', 'field-2'])
      expect(store.fields[1]?.position.x).toBe(100)
    })

    it('takes a field back out of the selection on a second modifier click', async () => {
      store.selectFields(['field-1', 'field-2'])
      const wrapper = mountItem({ field: store.fields[1] })

      await wrapper.trigger('mousedown', { clientX: 100, clientY: 100, ctrlKey: true })
      document.dispatchEvent(new MouseEvent('mouseup'))

      expect(store.selectedFieldIds).toEqual(['field-1'])
    })

    it('replaces the selection on a plain click', async () => {
      store.selectFields(['field-1', 'field-2'])
      const wrapper = mountItem({ field: store.fields[1] })

      await wrapper.trigger('mousedown', { clientX: 100, clientY: 100 })
      document.dispatchEvent(new MouseEvent('mouseup'))

      expect(store.selectedFieldIds).toEqual(['field-2'])
    })
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

    // Six fields moved by one drag is one gesture, so it is one entry. The
    // capture is of the whole list, which is what makes that possible at all
    // (features/0048).
    it('records one step for a drag that moves a whole selection', async () => {
      const editorStore = useEditorStore()
      store.loadFieldsFromForm([makeField(), { ...makeField(), id: 'field-2', name: 'text_2' }] as any)
      store.selectFields(['field-1', 'field-2'])
      const wrapper = mountItem({ field: store.fields[0] })

      await drag(wrapper)

      expect(editorStore.undoDepth).toBe(1)
      expect(store.fields[0]?.position.x).toBe(140)
      expect(store.fields[1]?.position.x).toBe(140)

      editorStore.undoLastEdit()

      expect(store.fields[0]?.position.x).toBe(100)
      expect(store.fields[1]?.position.x).toBe(100)
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
