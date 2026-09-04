import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import FieldPropertiesPanel from './FieldPropertiesPanel.vue'
import { useFormFieldsStore, isLocalFieldId } from '@/stores/formFields.store'
import { useEditorStore } from '@/stores/editor.store'
import { useDocumentStore } from '@/stores/document.store'
import { fieldsService } from '@/services/fields'
import { describePattern } from '@/services/pattern-check'
import { flushPromises } from '@/test/helpers/test-utils'

/**
 * Authoring a `pattern` from the editor (features/0036).
 *
 * The two checks are mocked; each is proven where it lives (the server's rules
 * in `backend/tests/fields.spec.ts`, the deadline and the kill in
 * `services/pattern-check.spec.ts`). What is asserted here is the behaviour
 * that only exists once they meet a real panel — above all that **an invalid
 * pattern never reaches the store**, because `pattern` is validated inside
 * `createFieldSchema` and an invalid one fails the whole bulk save, taking
 * every other unsaved edit on the form with it.
 */
vi.mock('@/services/fields', () => ({
  fieldsService: { checkPattern: vi.fn(), delete: vi.fn() }
}))
vi.mock('@/services/pattern-check', () => ({
  describePattern: vi.fn()
}))
vi.mock('primevue/usetoast', () => ({ useToast: () => ({ add: vi.fn() }) }))

const serverSays = vi.mocked(fieldsService.checkPattern)
const browserSays = vi.mocked(describePattern)

function selectField(type: 'text' | 'checkbox' = 'text') {
  const store = useFormFieldsStore()
  const field = {
    id: 'field-1',
    formId: 'form-1',
    type,
    name: 'postcode',
    label: 'Postcode',
    required: false,
    border: true,
    position: { x: 0, y: 0, width: 100, height: 20, page: 1 },
    order: 0,
    createdAt: new Date().toISOString()
  }
  store.fields = [field as never]
  store.selectedFieldId = 'field-1'
  return store
}

function mountPanel() {
  return mount(FieldPropertiesPanel, {
    global: {
      stubs: {
        Message: { template: '<div><slot /></div>' },
        // PrimeVue's Dialog and Button read `$primevue.config`, which only
        // exists once the plugin is installed app-wide. Stubbing them keeps
        // this spec about the panel: the dialog renders its slots in place, so
        // what is asserted is what the author can click.
        Dialog: {
          props: ['visible'],
          template: '<div v-if="visible"><slot /><slot name="footer" /></div>'
        },
        Button: {
          props: ['label'],
          template: `<button type="button" @click="$emit('click')">{{ label }}</button>`
        }
      }
    }
  })
}

/**
 * Types into the pattern box and lets the 400 ms debounce elapse.
 *
 * Real timers, deliberately. `flushPromises` in the shared helpers is a real
 * `setTimeout(0)`, which fake timers freeze — the two together deadlock, and
 * every test here times out at 5 s. Waiting 450 ms for real costs under half a
 * second per case and keeps the helper usable.
 */
async function typePattern(wrapper: ReturnType<typeof mountPanel>, value: string) {
  const input = wrapper.find('[data-testid="field-pattern-input"]')
  await input.setValue(value)
  await new Promise(resolve => setTimeout(resolve, 450))
  await flushPromises()
  await wrapper.vm.$nextTick()
}

describe('FieldPropertiesPanel — pattern', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    serverSays.mockResolvedValue({ ok: true })
    browserSays.mockResolvedValue({ verdict: 'no-match' })
  })

  it('offers a pattern box for a text field', () => {
    selectField('text')

    expect(mountPanel().find('[data-testid="field-pattern-input"]').exists()).toBe(true)
  })

  it('offers none for a checkbox, where a pattern would be inert', () => {
    selectField('checkbox')

    expect(mountPanel().find('[data-testid="field-pattern-input"]').exists()).toBe(false)
  })

  it('shows the existing pattern when a field is selected', () => {
    const store = selectField('text')
    store.fields[0]!.validation = { pattern: '^[0-9]{5}$' }
    store.selectedFieldId = null
    store.selectedFieldId = 'field-1'

    const wrapper = mountPanel()

    expect(
      (wrapper.find('[data-testid="field-pattern-input"]').element as HTMLInputElement).value
    ).toBe('^[0-9]{5}$')
  })

  describe('a pattern the server refuses', () => {
    beforeEach(() => {
      serverSays.mockResolvedValue({
        ok: false,
        reason: 'Invalid pattern: invalid perl operator: (?='
      })
    })

    it('shows the server’s own reason', async () => {
      selectField('text')
      const wrapper = mountPanel()

      await typePattern(wrapper, '(?=.*\\d).{8,}')

      expect(wrapper.find('[data-testid="field-pattern-invalid"]').text()).toContain('(?=')
    })

    /**
     * The one that protects the author's other work. An invalid pattern in the
     * store reaches `saveFields`, and the bulk save then fails **entirely**.
     */
    it('never writes it to the store', async () => {
      const store = selectField('text')
      const spy = vi.spyOn(store, 'updateField')
      const wrapper = mountPanel()

      await typePattern(wrapper, '(?=.*\\d).{8,}')

      expect(spy).not.toHaveBeenCalled()
      expect(store.fields[0]!.validation?.pattern).toBeUndefined()
    })
  })

  describe('a pattern the server accepts', () => {
    it('writes it to the store', async () => {
      const store = selectField('text')
      const wrapper = mountPanel()

      await typePattern(wrapper, '^[0-9]{5}$')

      expect(store.fields[0]!.validation?.pattern).toBe('^[0-9]{5}$')
    })

    it('shows no warning for an ordinary one', async () => {
      selectField('text')
      const wrapper = mountPanel()

      await typePattern(wrapper, '^[0-9]{5}$')

      expect(wrapper.find('[data-testid="field-pattern-slow"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="field-pattern-invalid"]').exists()).toBe(false)
    })

    /**
     * The pair that is the whole feature: RE2 accepts `^(a+)+$` and runs it in
     * 0.05 ms, and it is catastrophic in a browser. Valid **and** warned about.
     */
    it('warns when it is too slow for a respondent’s browser, and still saves it', async () => {
      browserSays.mockResolvedValue({ verdict: 'no-verdict', reason: 'timeout' })
      const store = selectField('text')
      const wrapper = mountPanel()

      await typePattern(wrapper, '^(a+)+$')

      expect(wrapper.find('[data-testid="field-pattern-slow"]').exists()).toBe(true)
      // A warning, not a refusal — the author decides.
      expect(store.fields[0]!.validation?.pattern).toBe('^(a+)+$')
    })

    it('does not warn about a pattern this engine merely cannot read', async () => {
      // `(?P<n>a)` is valid RE2 and a SyntaxError in JavaScript. Not slow.
      browserSays.mockResolvedValue({ verdict: 'no-verdict', reason: 'uncompilable' })
      selectField('text')
      const wrapper = mountPanel()

      await typePattern(wrapper, '(?P<n>a)')

      expect(wrapper.find('[data-testid="field-pattern-slow"]').exists()).toBe(false)
    })
  })

  it('clearing the box removes the pattern rather than storing an empty one', async () => {
    const store = selectField('text')
    const wrapper = mountPanel()

    await typePattern(wrapper, '^[0-9]+$')
    expect(store.fields[0]!.validation?.pattern).toBe('^[0-9]+$')

    await typePattern(wrapper, '')

    expect(store.fields[0]!.validation).toBeUndefined()
  })

  it('keeps minLength and maxLength when the pattern changes', async () => {
    const store = selectField('text')
    store.fields[0]!.validation = { minLength: 3, maxLength: 10 }
    const wrapper = mountPanel()

    await typePattern(wrapper, '^[0-9]+$')

    expect(store.fields[0]!.validation).toEqual({
      minLength: 3,
      maxLength: 10,
      pattern: '^[0-9]+$'
    })
  })

/**
 * Removing a field (features/0044).
 *
 * The panel used to call `window.confirm`, which cannot say anything about the
 * responses the field holds — and jsdom's `confirm` returns undefined, so the
 * old flow could not be tested at this level at all. What matters here is that
 * the click **asks** rather than acting, and that what the author is told
 * afterwards comes from the server rather than from a guess in the browser.
 */
describe('removing a field', () => {
  function removeButton(wrapper: ReturnType<typeof mountPanel>) {
    return wrapper.find('[data-testid="remove-field"]')
  }

  it('asks before touching anything', async () => {
    selectField('text')
    const wrapper = mountPanel()

    await removeButton(wrapper).trigger('click')

    expect(fieldsService.delete).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="remove-field-confirm"]').exists()).toBe(true)
  })

  it('removes the field once confirmed, and keeps the store in step', async () => {
    const store = selectField('text')
    store.setCurrentForm('form-1')
    // A field the server knows about: an id starting with `field-` is one the
    // editor invented locally, and the store deletes those without a request.
    const serverFieldId = '550e8400-e29b-41d4-a716-446655440000'
    store.fields[0]!.id = serverFieldId
    store.selectedFieldId = serverFieldId
    vi.mocked(fieldsService.delete).mockResolvedValue({
      message: 'Field archived',
      archived: true,
      answerCount: 2
    })

    const wrapper = mountPanel()
    await removeButton(wrapper).trigger('click')

    const confirmButton = wrapper.find('[data-testid="remove-field-confirmed"]')
    expect(confirmButton.exists()).toBe(true)
    await confirmButton.trigger('click')
    await flushPromises()

    expect(fieldsService.delete).toHaveBeenCalledWith('form-1', serverFieldId)
    expect(store.fields).toHaveLength(0)
  })

  /**
   * What may go back on the undo stack is the server's answer, not a guess
   * (features/0047). The bulk save rejects the **whole** payload when it
   * carries an id that is not a live field of the form, so an entry holding a
   * dead id would break every later save of that form, not just that field.
   */
  describe('undo', () => {
    const serverFieldId = '550e8400-e29b-41d4-a716-446655440000'

    async function removeAndConfirm() {
      const wrapper = mountPanel()
      await removeButton(wrapper).trigger('click')
      await wrapper.find('[data-testid="remove-field-confirmed"]').trigger('click')
      await flushPromises()
      return wrapper
    }

    it('brings a hard-deleted field back under a new local id', async () => {
      const store = selectField('text')
      const editorStore = useEditorStore()
      store.setCurrentForm('form-1')
      store.fields[0]!.id = serverFieldId
      store.selectedFieldId = serverFieldId
      vi.mocked(fieldsService.delete).mockResolvedValue({
        message: 'Field removed',
        archived: false,
        answerCount: 0
      })

      await removeAndConfirm()

      expect(editorStore.nextUndoLabel).toBe('Field removed')

      editorStore.undoLastEdit()

      expect(store.fields).toHaveLength(1)
      // The row is gone, so its id must not come back with it. Sending it in
      // the next `Save all` would 400 the whole form.
      expect(store.fields[0]!.id).not.toBe(serverFieldId)
      expect(isLocalFieldId(store.fields[0]!.id)).toBe(true)
      expect(store.fields[0]!.label).toBe('Postcode')
    })

    it('records nothing for a field the server archived', async () => {
      const store = selectField('text')
      const editorStore = useEditorStore()
      store.setCurrentForm('form-1')
      store.fields[0]!.id = serverFieldId
      store.selectedFieldId = serverFieldId
      vi.mocked(fieldsService.delete).mockResolvedValue({
        message: 'Field archived',
        archived: true,
        answerCount: 2
      })

      await removeAndConfirm()

      // Restore in the rail is the way back, because it returns the row with
      // its own id and its answers still attached (features/0045).
      expect(editorStore.canUndo).toBe(false)
    })

    it('keeps its own id for a field that was never saved', async () => {
      const store = selectField('text')
      const editorStore = useEditorStore()
      store.setCurrentForm('form-1')

      await removeAndConfirm()

      expect(fieldsService.delete).not.toHaveBeenCalled()

      editorStore.undoLastEdit()

      expect(store.fields).toHaveLength(1)
      expect(store.fields[0]!.id).toBe('field-1')
    })
  })
})
})

/**
 * The panel when more than one field is selected (features/0048).
 *
 * What is asserted here is the boundary: the set gets geometry and duplication
 * and **no per-field inputs**, because a name typed into six fields at once is
 * the properties-panel undo problem this repository deliberately has not
 * solved.
 */
describe('FieldPropertiesPanel — a selection of fields', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  const selectThree = () => {
    const store = useFormFieldsStore()
    store.fields = [
      { id: 'f1', type: 'text', name: 'a', label: 'A', required: false, border: false, position: { x: 0, y: 0, width: 100, height: 20, page: 1 } },
      { id: 'f2', type: 'text', name: 'b', label: 'B', required: false, border: false, position: { x: 140, y: 60, width: 100, height: 20, page: 1 } },
      { id: 'f3', type: 'text', name: 'c', label: 'C', required: false, border: false, position: { x: 400, y: 90, width: 100, height: 20, page: 1 } }
    ] as never[]
    store.selectFields(['f1', 'f2', 'f3'])
    return store
  }

  it('says how many fields are selected and offers no name box', () => {
    selectThree()
    const wrapper = mountPanel()

    expect(wrapper.find('[data-testid="selection-count"]').text()).toContain('3 fields')
    expect(wrapper.find('#field-name').exists()).toBe(false)
    expect(wrapper.find('[data-testid="remove-field"]').exists()).toBe(false)
  })

  it('aligns the selection in one undo step', async () => {
    const store = selectThree()
    const editorStore = useEditorStore()
    const wrapper = mountPanel()

    await wrapper.find('[data-testid="align-left"]').trigger('click')

    expect(store.fields.map(f => f.position.x)).toEqual([0, 0, 0])
    expect(editorStore.undoDepth).toBe(1)

    editorStore.undoLastEdit()

    expect(store.fields.map(f => f.position.x)).toEqual([0, 140, 400])
  })

  it('distributes the selection in one undo step', async () => {
    const store = selectThree()
    const editorStore = useEditorStore()
    const wrapper = mountPanel()

    await wrapper.find('[data-testid="distribute-horizontal"]').trigger('click')

    expect(store.fields[1]?.position.x).toBe(200)
    expect(editorStore.undoDepth).toBe(1)
  })

  it('duplicates every selected field', async () => {
    const store = selectThree()
    const wrapper = mountPanel()

    await wrapper.find('[data-testid="duplicate-selection"]').trigger('click')

    expect(store.fields).toHaveLength(6)
    expect(store.fields.filter(f => isLocalFieldId(f.id))).toHaveLength(3)
    expect(store.hasUnsavedChanges).toBe(true)
  })

  // Same refusal the drag already makes: a screen direction is not a stored
  // axis on a turned page.
  it('disables the geometry buttons while the page is rotated', () => {
    selectThree()
    const documentStore = useDocumentStore()
    documentStore.documents.push({ id: 'doc-1', rotation: 90 } as never)
    documentStore.activeDocumentId = 'doc-1'

    const wrapper = mountPanel()

    expect(wrapper.find('[data-testid="align-left"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-testid="duplicate-selection"]').attributes('disabled')).toBeUndefined()
  })
})
