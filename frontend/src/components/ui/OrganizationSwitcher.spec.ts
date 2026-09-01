import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import OrganizationSwitcher from './OrganizationSwitcher.vue'
import { useOrganizationStore } from '@/stores/organization.store'
import { usePlanStore } from '@/stores/plan.store'
import { useFormsStore } from '@/stores/forms.store'
import { organizationService } from '@/services/organization'
import { planService } from '@/services/plan'
import { formsService } from '@/services/forms'

vi.mock('@/services/organization')
vi.mock('@/services/plan')
vi.mock('@/services/forms')

/**
 * The organization switcher
 * ([`features/0023`](../../../../features/0023-active-organization.md)).
 *
 * Two things are worth asserting and the rest is markup: that it does not exist
 * for the accounts that have one organization, and that switching reloads the
 * things on screen that now belong to a different tenant.
 */
describe('OrganizationSwitcher', () => {
  const organizations = [
    { id: 'org-1', name: 'Personal', slug: 'personal', role: 'owner' as const },
    { id: 'org-2', name: 'Acme', slug: 'acme', role: 'member' as const }
  ]

  async function mountSwitcher(list = organizations) {
    vi.mocked(organizationService.list).mockResolvedValue({
      organizations: list,
      activeOrganizationId: 'org-1'
    })
    vi.mocked(organizationService.setActive).mockResolvedValue(undefined)
    vi.mocked(organizationService.members).mockResolvedValue([])
    vi.mocked(organizationService.pendingInvitations).mockResolvedValue([])

    const store = useOrganizationStore()
    await store.loadOrganizations()

    const wrapper = mount(OrganizationSwitcher)
    await flushPromises()
    return wrapper
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(planService.entitlements).mockResolvedValue({
      plan: {
        key: 'free',
        name: 'Free',
        maxPublishedForms: 1,
        maxResponsesPerMonth: 50,
        seats: 1,
        hasApiAccess: false
      },
      usage: { publishedForms: 0, responsesThisPeriod: 0, seats: 1 },
      subscription: null
    })
    vi.mocked(formsService.list).mockResolvedValue([])
  })

  it('renders nothing for an account with one organization', async () => {
    const wrapper = await mountSwitcher([organizations[0]!])

    // Furniture implying a choice that does not exist.
    expect(wrapper.find('[data-testid="org-switcher"]').exists()).toBe(false)
  })

  it('names the organization the API is acting in', async () => {
    const wrapper = await mountSwitcher()

    expect(wrapper.find('[data-testid="org-switcher-button"]').text()).toContain('Personal')
  })

  it('lists the others with the role held in each', async () => {
    const wrapper = await mountSwitcher()

    await wrapper.find('[data-testid="org-switcher-button"]').trigger('click')

    const menu = wrapper.find('[data-testid="org-switcher-menu"]')
    expect(menu.text()).toContain('Acme')
    expect(menu.text()).toContain('member')
  })

  it('switches, and reloads what now belongs to another tenant', async () => {
    const wrapper = await mountSwitcher()
    const planStore = usePlanStore()
    const formsStore = useFormsStore()
    const planSpy = vi.spyOn(planStore, 'load')
    const formsSpy = vi.spyOn(formsStore, 'fetchForms')

    await wrapper.find('[data-testid="org-switcher-button"]').trigger('click')
    await wrapper.find('[data-testid="org-option-org-2"]').trigger('click')
    await flushPromises()

    expect(organizationService.setActive).toHaveBeenCalledWith('org-2')
    // Stale numbers under a new organization name are worse than a moment of
    // loading: every count and limit in this product is per organization.
    expect(planSpy).toHaveBeenCalled()
    expect(formsSpy).toHaveBeenCalled()
  })

  it('does not re-switch to the organization already active', async () => {
    const wrapper = await mountSwitcher()

    await wrapper.find('[data-testid="org-switcher-button"]').trigger('click')
    await wrapper.find('[data-testid="org-option-org-1"]').trigger('click')
    await flushPromises()

    expect(organizationService.setActive).not.toHaveBeenCalled()
  })
})
