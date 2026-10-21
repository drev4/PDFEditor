import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises, RouterLinkStub } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import ResponsesView from './ResponsesView.vue'
import { responsesService } from '@/services/responses'
import { formsService, type Field } from '@/services/forms'

vi.mock('@/services/responses')
vi.mock('@/services/forms')
vi.mock('@/services/plan')
vi.mock('@/services/organization')
vi.mock('primevue/usetoast', () => ({ useToast: () => ({ add: vi.fn() }) }))
vi.mock('vue-router', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('vue-router')
  return { ...actual, useRoute: () => ({ params: { id: 'form-1' } }) }
})

/**
 * An archived column on the responses screen (features/0045).
 *
 * `GET /forms/:id/responses` has always returned archived fields — that is what
 * keeps an answer to a removed question in a labelled column — and the flag
 * saying which ones they are arrived and was thrown away. So a column nobody
 * collects any more looked exactly like a live one, and the person reading the
 * table had no way to know the form stopped asking.
 */
describe('ResponsesView — archived columns', () => {
  const live: Field = {
    id: 'field-live',
    formId: 'form-1',
    type: 'text',
    name: 'email',
    label: 'Email',
    required: false,
    position: { x: 0, y: 0, width: 10, height: 10, page: 1 },
    order: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null
  }

  const archived: Field = {
    ...live,
    id: 'field-archived',
    name: 'old_question',
    label: 'Old question',
    order: 1,
    deletedAt: '2026-02-01T00:00:00.000Z'
  }

  async function mountView(fields: Field[]) {
    vi.mocked(formsService.get).mockResolvedValue({
      id: 'form-1',
      title: 'Test form',
      fields
    } as never)
    vi.mocked(responsesService.listByForm).mockResolvedValue({
      responses: [
        {
          id: 'r1',
          formId: 'form-1',
          submittedAt: '2026-03-01T10:00:00.000Z',
          ipAddress: null,
          userAgent: null,
          answers: [
            { id: 'a1', responseId: 'r1', fieldId: 'field-live', value: 'a@b.com' },
            { id: 'a2', responseId: 'r1', fieldId: 'field-archived', value: 'historical' }
          ]
        }
      ],
      fields,
      pagination: { total: 1, limit: 20, offset: 0 }
    })

    const wrapper = mount(ResponsesView, {
      global: {
        // The real DataTable, not a stub: the mark lives in a `#header` slot of
        // a `<Column>`, so stubbing the table away would assert nothing about
        // what a reader of the table actually sees.
        plugins: [PrimeVue],
        stubs: {
          RouterLink: RouterLinkStub,
          AppShell: { template: '<div><slot /></div>' }
        }
      }
    })

    await flushPromises()
    return wrapper
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('marks the column of a field that is no longer collected', async () => {
    const wrapper = await mountView([live, archived])

    expect(wrapper.find('[data-testid="archived-column-field-archived"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="archived-column-field-live"]').exists()).toBe(false)
  })

  it('keeps the archived column, its original label and its answers', async () => {
    const wrapper = await mountView([live, archived])

    // The point of archiving: the historical answer is still readable under the
    // label the question had when it was asked.
    expect(wrapper.text()).toContain('Old question')
    expect(wrapper.text()).toContain('historical')
  })

  it('marks nothing when every field is live', async () => {
    const wrapper = await mountView([live])

    expect(wrapper.find('[data-testid="archived-column-field-live"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('archived')
  })
})
