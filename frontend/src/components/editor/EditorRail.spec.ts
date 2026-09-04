import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import EditorRail from './EditorRail.vue'
import { useFormFieldsStore } from '@/stores/formFields.store'
import { fieldsService } from '@/services/fields'
import { flushPromises } from '@/test/helpers/test-utils'

/**
 * The archived section of the rail (features/0045).
 *
 * Before this, a field the server kept because it holds responses was visible
 * for eight seconds in a toast and then in no screen at all. What is asserted
 * here is what an author can see and click — and, above all, that restoring
 * puts the field back into the editor's own list, because a restored field
 * missing from that list is archived again by the very next save with no error
 * anywhere.
 */
vi.mock('@/services/fields', () => ({
  fieldsService: { listArchived: vi.fn(), restore: vi.fn() }
}))
vi.mock('primevue/usetoast', () => ({ useToast: () => ({ add: vi.fn() }) }))

const archivedRow = {
  id: 'field-9',
  formId: 'form-1',
  type: 'text' as const,
  name: 'old_question',
  label: 'Old question',
  required: false,
  position: { x: 5, y: 6, width: 80, height: 20, page: 2 },
  order: 3,
  createdAt: '2026-01-01T00:00:00.000Z',
  deletedAt: '2026-02-01T00:00:00.000Z',
  answerCount: 4
}

function mountRail() {
  return mount(EditorRail, {
    props: { pdfDoc: null },
    global: {
      stubs: {
        PageThumbnails: true,
        // Same reason as FieldPropertiesPanel.spec.ts: PrimeVue's Dialog and
        // Button need the app-wide plugin. Rendering the slots in place keeps
        // the spec about what the author can click.
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

async function railWithAnArchivedField() {
  const store = useFormFieldsStore()
  store.setCurrentForm('form-1')
  vi.mocked(fieldsService.listArchived).mockResolvedValue([archivedRow] as never)

  const wrapper = mountRail()
  await flushPromises()
  await wrapper.vm.$nextTick()
  return { store, wrapper }
}

describe('EditorRail — archived fields', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('shows nothing at all when the form has archived nothing', async () => {
    const store = useFormFieldsStore()
    store.setCurrentForm('form-1')
    vi.mocked(fieldsService.listArchived).mockResolvedValue([] as never)

    const wrapper = mountRail()
    await flushPromises()

    expect(wrapper.find('[data-testid="archived-fields"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Archived')
  })

  it('lists each archived field with how many responses it keeps', async () => {
    const { wrapper } = await railWithAnArchivedField()

    expect(wrapper.find('[data-testid="archived-fields"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="archived-count"]').text()).toBe('1')
    expect(wrapper.text()).toContain('Old question')
    expect(wrapper.text()).toContain('4 responses kept')
  })

  it('asks before restoring, rather than restoring on click', async () => {
    const { wrapper } = await railWithAnArchivedField()

    await wrapper.find('[data-testid="restore-field-field-9"]').trigger('click')

    expect(wrapper.find('[data-testid="restore-field-confirm"]').exists()).toBe(true)
    expect(fieldsService.restore).not.toHaveBeenCalled()
  })

  it('puts the restored field back into the editor list', async () => {
    const { store, wrapper } = await railWithAnArchivedField()
    vi.mocked(fieldsService.restore).mockResolvedValue({ ...archivedRow, deletedAt: null } as never)

    await wrapper.find('[data-testid="restore-field-field-9"]').trigger('click')
    await wrapper.find('[data-testid="restore-field-confirmed"]').trigger('click')
    await flushPromises()

    expect(fieldsService.restore).toHaveBeenCalledWith('form-1', 'field-9')
    expect(store.fields.map(f => f.id)).toContain('field-9')
    expect(store.archivedFields).toEqual([])
    // And the restore is not pending work: it already reached the server.
    expect(store.hasUnsavedChanges).toBe(false)
  })

  it('warns when a live field already uses the same name', async () => {
    const { store, wrapper } = await railWithAnArchivedField()
    store.fields = [{ ...archivedRow, border: false }] as never

    await wrapper.find('[data-testid="restore-field-field-9"]').trigger('click')

    expect(wrapper.find('[data-testid="restore-name-clash"]').exists()).toBe(true)
  })

  it('does not warn when the name is free', async () => {
    const { wrapper } = await railWithAnArchivedField()

    await wrapper.find('[data-testid="restore-field-field-9"]').trigger('click')

    expect(wrapper.find('[data-testid="restore-name-clash"]').exists()).toBe(false)
  })
})
