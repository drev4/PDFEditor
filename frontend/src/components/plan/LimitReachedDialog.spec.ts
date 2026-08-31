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

  /** A Team organization with seats bought and every one of them in use. */
  const teamPlanOutOfSeats: Entitlements = {
    plan: {
      key: 'team',
      name: 'Team',
      maxPublishedForms: null,
      maxResponsesPerMonth: 25000,
      // The **effective** limit the server resolved from what was bought — not
      // the catalogue floor (features/0015).
      seats: 4
    },
    usage: { publishedForms: 2, responsesThisPeriod: 10, seats: 4 },
    subscription: { status: 'active', currentPeriodEnd: null, cancelAtPeriodEnd: false }
  }

  /** Mounts the dialog with the signed-in person holding `role`. */
  async function mountDialog(
    role: 'owner' | 'admin' | 'member',
    entitlements = freePlan,
    props: Record<string, unknown> = {}
  ) {
    vi.mocked(planService.entitlements).mockResolvedValue(entitlements)

    const planStore = usePlanStore()
    await planStore.load()

    const organizationStore = useOrganizationStore()
    // `currentRole` is derived from the members list, exactly as
    // `MembersView.vue` derives it — no second source for "what may I do".
    vi.spyOn(organizationStore, 'currentRole', 'get').mockReturnValue(role)

    const wrapper = mount(LimitReachedDialog, {
      props: { visible: true, formTitle: 'Invoice request', ...props },
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

    // Team is buyable since features/0015, but it publishes no more forms than
    // Pro does — both are unlimited — so an upgrade would sell the customer
    // nothing they need, and switching an existing subscription is the portal's
    // job in any case.
    expect(wrapper.find('[data-testid="upgrade-from-limit"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('already on the highest plan we sell')
  })

  describe('the seat limit (features/0015)', () => {
    it('says a seat is missing, not that the invitation failed', async () => {
      const wrapper = await mountDialog('owner', teamPlanOutOfSeats, {
        limit: 'seats',
        message: 'The Team plan covers 4 people, and this organization already has 4.'
      })

      // The server's own sentence, and a heading about seats rather than forms.
      // A 402 is a limit the customer can act on, not a broken request.
      expect(wrapper.text()).toContain("doesn't have a seat for this person yet")
      expect(wrapper.text()).toContain('The Team plan covers 4 people')
      expect(wrapper.text()).not.toContain('form limit')
    })

    it('shows the members meter against the bought limit', async () => {
      const wrapper = await mountDialog('owner', teamPlanOutOfSeats, { limit: 'seats' })

      expect(wrapper.text()).toContain('Members')
      // The effective limit, so a customer who paid for four is not told three.
      expect(wrapper.text()).toContain('4')
      expect(wrapper.text()).not.toContain('Published forms')
    })

    it('sends an owner with a subscription to the portal, because seats are bought there', async () => {
      const wrapper = await mountDialog('owner', teamPlanOutOfSeats, { limit: 'seats' })

      const addSeats = wrapper.find('[data-testid="add-seats-from-limit"]')
      expect(addSeats.exists()).toBe(true)
      // Not Checkout: this organization already has a live subscription, and a
      // second one would be a customer paying twice. The API refuses it too.
      expect(wrapper.find('[data-testid="upgrade-from-limit"]').exists()).toBe(false)

      await addSeats.trigger('click')
      expect(billingService.portalUrl).toHaveBeenCalled()
      expect(billingService.checkoutUrl).not.toHaveBeenCalled()
    })

    it('offers a free owner the upgrade instead, since there is nothing to manage yet', async () => {
      const wrapper = await mountDialog('owner', freePlan, { limit: 'seats' })

      expect(wrapper.find('[data-testid="upgrade-from-limit"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="add-seats-from-limit"]').exists()).toBe(false)
    })

    it('offers a non-owner no way to buy a seat, and says who can', async () => {
      const wrapper = await mountDialog('admin', teamPlanOutOfSeats, { limit: 'seats' })

      // An admin may invite but may not spend money — `POST /api/billing/*`
      // answers 403 to anyone but an owner, and the UI agrees rather than
      // offering a button that fails.
      expect(wrapper.find('[data-testid="add-seats-from-limit"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="upgrade-from-limit"]').exists()).toBe(false)
      expect(wrapper.text()).toContain('Only an owner of this organization can buy seats')
    })

    it('renders no price and no per-seat amount', async () => {
      const wrapper = await mountDialog('owner', teamPlanOutOfSeats, { limit: 'seats' })

      // The amount lives in Stripe and nowhere else. A per-seat figure rendered
      // from a constant here would be wrong the first time there is a promotion.
      expect(wrapper.text()).not.toMatch(/[€$£]/)
    })
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
