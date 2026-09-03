import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import FieldPropertiesPanel from './FieldPropertiesPanel.vue'
import { useFormFieldsStore } from '@/stores/formFields.store'
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
})
})
