import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises, RouterLinkStub } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import ResponsesIndexView from './ResponsesIndexView.vue'
import { responsesService, type OrganizationResponse } from '@/services/responses'
import { formsService } from '@/services/forms'

vi.mock('@/services/responses')
vi.mock('@/services/forms')
vi.mock('@/services/plan')
vi.mock('@/services/organization')

/**
 * The `Responses` destination
 * ([`features/0024`](../../../features/0024-organization-responses.md)).
 *
 * What is worth asserting: that a row leads to the form whose answers it is, that
 * an organization with nothing collected is told so rather than shown an empty
 * table, and — the negative one that matters — that no export control appears
 * here, because a combined CSV across forms that share no fields is not a thing
 * this product can honestly offer.
 */
describe('ResponsesIndexView', () => {
  const rows: OrganizationResponse[] = [
    {
      id: 'r1',
      formId: 'form-1',
      formTitle: 'Invoice request',
      submittedAt: '2026-08-02T10:00:00.000Z',
      answerCount: 4
    },
    {
      id: 'r2',
      formId: 'form-2',
      formTitle: 'Holiday form',
      submittedAt: '2026-08-01T10:00:00.000Z',
      answerCount: 2
    }
  ]

  async function mountView(responses: OrganizationResponse[] = rows, total = responses.length) {
    vi.mocked(responsesService.listForOrganization).mockResolvedValue({
      responses,
      pagination: { total, limit: 20, offset: 0 }
    })

    const wrapper = mount(ResponsesIndexView, {
      global: {
        stubs: {
          RouterLink: RouterLinkStub,
          // The shell is chrome: it fetches the plan and the organizations, and
          // none of that is what this screen is.
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
    vi.mocked(formsService.list).mockResolvedValue([])
  })

  it('lists what came in, with the form it came from', async () => {
    const wrapper = await mountView()

    expect(wrapper.find('[data-testid="organization-responses-table"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Invoice request')
    expect(wrapper.text()).toContain('Holiday form')
  })

  it('links a row to that form own responses screen', async () => {
    const wrapper = await mountView()

    const link = wrapper.findAllComponents(RouterLinkStub).find(l => l.props('to') === '/dashboard/forms/form-1/responses')

    // The answers are there, on the screen that has columns to render them in.
    expect(link).toBeTruthy()
  })

  it('renders no respondent detail, because it receives none', async () => {
    const wrapper = await mountView()

    // The endpoint sends no answers, no IP and no user agent; the screen must
    // not imply otherwise by drawing columns for them.
    expect(wrapper.text()).not.toMatch(/IP address/i)
    expect(wrapper.text()).not.toMatch(/user agent/i)
  })

  it('offers no export, because a combined CSV has no columns', async () => {
    const wrapper = await mountView()

    expect(wrapper.text()).not.toMatch(/csv|export|download/i)
  })

  it('says nothing has been submitted rather than drawing an empty table', async () => {
    const wrapper = await mountView([], 0)

    expect(wrapper.find('[data-testid="organization-responses-table"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="responses-empty"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Nothing has been submitted yet')
  })

  it('shows no paging controls when everything fits on one page', async () => {
    const wrapper = await mountView()

    expect(wrapper.find('[data-testid="responses-next"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-testid="responses-previous"]').attributes('disabled')).toBeDefined()
  })
})
