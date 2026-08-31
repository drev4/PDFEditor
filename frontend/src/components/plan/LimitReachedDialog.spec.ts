import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import { flushPromises } from '@/test/helpers/test-utils'
import LimitReachedDialog from './LimitReachedDialog.vue'
import { usePlanStore } from '@/stores/plan.store'
import { useOrganizationStore } from '@/stores/organization.store'
import { planService, type Entitlements } from '@/services/plan'
import { organizationService } from '@/services/organization'
import { billingService } from '@/services/billing'

vi.mock('@/services/plan')
vi.mock('@/services/organization')
vi.mock('@/services/billing')

/**
 * The upgrade control on the limit dialog
 * ([`features/0013`](../../../../features/0013-stripe-subscriptions.md)).
 *
 * The assertion that matters is the negative one: **a non-owner is offered no
 * way to spend money.** `POST /api/billing/checkout` answers `403` to anyone
 * but an owner, and a button that is guaranteed to fail is worse than no
 * button — it tells someone the product is broken when it is enforcing a rule.
 */
describe('LimitReachedDialog', () => {
  const freePlan: Entitlements = {
    plan: {
      key: 'free',
      name: 'Free',
      maxPublishedForms: 1,
      maxResponsesPerMonth: 50,
      seats: 1
    },
    usage: { publishedForms: 1, responsesThisPeriod: 10, seats: 1 },
    subscription: null
  }

  /** Mounts the dialog with the signed-in person holding `role`. */
  async function mountDialog(role: 'owner' | 'admin' | 'member', entitlements = freePlan) {
    vi.mocked(planService.entitlements).mockResolvedValue(entitlements)

    const planStore = usePlanStore()
    await planStore.load()

    const organizationStore = useOrganizationStore()
    // `currentRole` is derived from the members list, exactly as
    // `MembersView.vue` derives it — no second source for "what may I do".
    vi.spyOn(organizationStore, 'currentRole', 'get').mockReturnValue(role)

    const wrapper = mount(LimitReachedDialog, {
      props: { visible: true, formTitle: 'Invoice request' },
      global: {
        plugins: [PrimeVue],
        stubs: {
          // PrimeVue's Dialog teleports its content out of the wrapper, which
          // would put everything this file asserts on out of reach. The stub
          // renders both slots inline instead; the dialog chrome is PrimeVue's
          // and is not what is under test here.
          Dialog: {
            template: '<div><slot /><div class="footer"><slot name="footer" /></div></div>'
          },
          Button: {
            template: '<button :data-label="label" @click="$emit(\'click\', $event)">{{ label }}</button>',
            props: ['label', 'loading', 'severity', 'text', 'outlined', 'size']
          }
        }
      }
    })

    await flushPromises()
    return wrapper
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(organizationService.members).mockResolvedValue([])
    vi.mocked(organizationService.pendingInvitations).mockResolvedValue([])
  })

  it('offers the owner an upgrade', async () => {
    const wrapper = await mountDialog('owner')

    expect(wrapper.find('[data-testid="upgrade-from-limit"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Upgrading publishes as many forms as you need')
  })

  it('offers a member no purchase control at all', async () => {
    const wrapper = await mountDialog('member')

    expect(wrapper.find('[data-testid="upgrade-from-limit"]').exists()).toBe(false)
    // And it says why, rather than leaving a dead end: unpublishing is the
    // thing this person can actually do.
    expect(wrapper.text()).toContain('Only an owner of this organization can change the plan')
  })

  it('offers an admin no purchase control either', async () => {
    const wrapper = await mountDialog('admin')

    // An admin manages forms and members. Spending the organization's money is
    // an owner's decision, and the API agrees.
    expect(wrapper.find('[data-testid="upgrade-from-limit"]').exists()).toBe(false)
  })

  it('offers no upgrade on a plan there is nothing above', async () => {
    const wrapper = await mountDialog('owner', {
      ...freePlan,
      plan: { ...freePlan.plan, key: 'pro', name: 'Pro' }
    })

    // Team is priced per seat and cannot be bought (features/0013 leaves it
    // out), so opening Checkout here would sell the customer what they have.
    expect(wrapper.find('[data-testid="upgrade-from-limit"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('already on the highest plan we sell')
  })

  it('renders no price, anywhere', async () => {
    const wrapper = await mountDialog('owner')

    // The amount lives in Stripe and nowhere else (features/0013, trap 7).
    // Nobody has agreed the numbers on the design canvas, so the product must
    // not quote one.
    expect(wrapper.text()).not.toMatch(/€|\bEUR\b|\$\d/)
  })

  it('starts checkout when the owner accepts', async () => {
    vi.mocked(billingService.checkoutUrl).mockResolvedValue('https://checkout.stripe.test/s')
    const wrapper = await mountDialog('owner')

    await wrapper.find('[data-testid="upgrade-from-limit"]').trigger('click')

    expect(billingService.checkoutUrl).toHaveBeenCalled()
  })
})
