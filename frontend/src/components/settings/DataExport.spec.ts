import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import DataExport from './DataExport.vue'
import { organizationService } from '@/services/organization'
import { ApiError } from '@/services/api'

vi.mock('@/services/organization')

let role: string | null = 'owner'
let activeOrganization: { slug: string } | null = { slug: 'acme' }

vi.mock('@/stores/organization.store', () => ({
  useOrganizationStore: () => ({
    get currentRole() { return role },
    get activeOrganization() { return activeOrganization }
  })
}))

/**
 * Downloading everything (features/0030).
 *
 * Three behaviours, and each is one the obvious implementation gets wrong: the
 * control is not drawn for somebody the endpoint would refuse, a failure is
 * reported rather than saving a broken file, and the copy tells the reader how
 * to recognise a truncated export — which is the only thing that makes the
 * server's completion marker useful to a person.
 */
describe('DataExport', () => {
  const anchorClick = vi.fn()

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    role = 'owner'
    activeOrganization = { slug: 'acme' }

    window.URL.createObjectURL = vi.fn(() => 'blob:fake')
    window.URL.revokeObjectURL = vi.fn()
    // Saving is the browser's job; intercepting the click keeps jsdom from
    // trying to navigate to a blob URL it cannot fetch.
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(anchorClick)
  })

  function render() {
    return mount(DataExport, { global: { plugins: [PrimeVue] } })
  }

  it('is not drawn for a member, whose request the endpoint would refuse', () => {
    role = 'member'
    expect(render().find('[data-testid="data-export"]').exists()).toBe(false)
  })

  it.each(['owner', 'admin'])('is drawn for an %s', current => {
    role = current
    expect(render().find('[data-testid="data-export"]').exists()).toBe(true)
  })

  it('says how to recognise a file that was cut short', () => {
    expect(render().text()).toContain('"complete": true')
  })

  it('downloads the file and names it after the organization', async () => {
    vi.mocked(organizationService.exportData).mockResolvedValue(new Blob(['{}']))

    const wrapper = render()
    await wrapper.find('[data-testid="data-export-download"]').trigger('click')
    await flushPromises()

    expect(organizationService.exportData).toHaveBeenCalled()
    expect(anchorClick).toHaveBeenCalled()
    expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake')
  })

  it('reports a failure instead of saving something broken', async () => {
    vi.mocked(organizationService.exportData).mockRejectedValue(
      new ApiError(403, 'This action requires the owner or admin role')
    )

    const wrapper = render()
    await wrapper.find('[data-testid="data-export-download"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="data-export-error"]').text())
      .toBe('This action requires the owner or admin role')
    expect(anchorClick).not.toHaveBeenCalled()
  })
})
