import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import WebhooksPanel from './WebhooksPanel.vue'
import { usePlanStore } from '@/stores/plan.store'
import { useOrganizationStore } from '@/stores/organization.store'
import { planService, type Entitlements } from '@/services/plan'
import { organizationService } from '@/services/organization'
import { billingService } from '@/services/billing'
import { webhookService, type WebhookEndpoint, type WebhookDelivery } from '@/services/webhooks'
import { ApiError } from '@/services/api'

vi.mock('@/services/plan')
vi.mock('@/services/organization')
vi.mock('@/services/billing')
vi.mock('@/services/webhooks')

/**
 * The webhooks tab ([`features/0022`](../../../../features/0022-webhooks-screen.md)).
 *
 * What is asserted here is mostly *which of three refusals* the screen shows,
 * because collapsing them is the mistake this feature is most likely to make:
 * the deployment cannot deliver, the plan does not include it, and the person
 * may not manage it are three different answers leading to three different
 * places.
 */
describe('WebhooksPanel', () => {
  const teamPlan: Entitlements = {
    plan: {
      key: 'team',
      name: 'Team',
      maxPublishedForms: null,
      maxResponsesPerMonth: 25000,
      seats: 4,
      hasApiAccess: true
    },
    usage: { publishedForms: 2, responsesThisPeriod: 10, seats: 2 },
    subscription: { status: 'active', currentPeriodEnd: null, cancelAtPeriodEnd: false }
  }

  const freePlan: Entitlements = {
    plan: {
      key: 'free',
      name: 'Free',
      maxPublishedForms: 1,
      maxResponsesPerMonth: 50,
      seats: 1,
      hasApiAccess: false
    },
    usage: { publishedForms: 1, responsesThisPeriod: 10, seats: 1 },
    subscription: null
  }

  const active: WebhookEndpoint = {
    id: 'w1',
    url: 'https://example.com/hook',
    events: ['response.created'],
    disabledAt: null,
    lastError: null,
    consecutiveFailures: 0,
    createdAt: '2026-08-01T09:00:00.000Z'
  }

  const disabled: WebhookEndpoint = {
    ...active,
    id: 'w2',
    url: 'https://broken.example.com/hook',
    disabledAt: '2026-08-20T09:00:00.000Z',
    lastError: 'connect ETIMEDOUT',
    consecutiveFailures: 10
  }

  const delivery: WebhookDelivery = {
    id: 'd1',
    eventId: 'evt_1',
    eventType: 'response.created',
    attempt: 2,
    status: 500,
    durationMs: 42,
    succeeded: false,
    error: 'HTTP 500',
    createdAt: '2026-08-20T09:00:00.000Z'
  }

  async function mountPanel(
    role: 'owner' | 'admin' | 'member',
    entitlements = teamPlan,
    list: { webhooks: WebhookEndpoint[]; deliverable: boolean } = {
      webhooks: [active],
      deliverable: true
    }
  ) {
    vi.mocked(planService.entitlements).mockResolvedValue(entitlements)
    vi.mocked(webhookService.list).mockResolvedValue(list)

    const planStore = usePlanStore()
    await planStore.load()

    const organizationStore = useOrganizationStore()
    vi.spyOn(organizationStore, 'currentRole', 'get').mockReturnValue(role)

    const wrapper = mount(WebhooksPanel, {
      global: {
        plugins: [PrimeVue],
        stubs: {
          // Honours `visible`, because whether the limit dialog is up at all is
          // one of the things under test.
          Dialog: {
            props: ['visible'],
            template:
              '<div v-if="visible"><slot /><div class="footer"><slot name="footer" /></div></div>'
          },
          Button: {
            template:
              '<button :data-label="label" @click="$emit(\'click\', $event)">{{ label }}</button>',
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
    vi.mocked(billingService.checkoutUrl).mockResolvedValue('https://checkout.stripe.test/s')
  })

  describe('the three refusals, kept apart', () => {
    it('says the deployment cannot deliver, and still lists what is configured', async () => {
      const wrapper = await mountPanel('owner', teamPlan, {
        webhooks: [active],
        deliverable: false
      })

      expect(wrapper.find('[data-testid="webhooks-undeliverable"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="create-webhook-form"]').exists()).toBe(false)
      // The list is how somebody works out why nothing is arriving.
      expect(wrapper.find('[data-testid="webhook-w1"]').exists()).toBe(true)
      // Not a plan problem and not a permission problem.
      expect(wrapper.find('[data-testid="webhooks-upgrade"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="webhooks-forbidden"]').exists()).toBe(false)
    })

    it('says so with no endpoints configured either', async () => {
      const wrapper = await mountPanel('owner', teamPlan, { webhooks: [], deliverable: false })

      // This is exactly the moment somebody is about to configure an endpoint
      // that would never fire.
      expect(wrapper.find('[data-testid="webhooks-undeliverable"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="webhooks-empty"]').exists()).toBe(true)
    })

    it('says the plan does not include webhooks, and offers the owner the upgrade', async () => {
      const wrapper = await mountPanel('owner', freePlan)

      expect(wrapper.find('[data-testid="webhooks-upgrade"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="webhooks-upgrade-team"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="create-webhook-form"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="webhooks-undeliverable"]').exists()).toBe(false)
    })

    it('still lists endpoints on a plan that has lost the API', async () => {
      const wrapper = await mountPanel('owner', freePlan)

      // A downgraded organization may still have live endpoints, and DELETE
      // keeps working without the plan precisely so they can be turned off.
      expect(webhookService.list).toHaveBeenCalled()
      expect(wrapper.find('[data-testid="webhook-w1"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="delete-w1"]').exists()).toBe(true)
    })

    it('tells a member to ask an owner, and asks the server for nothing', async () => {
      const wrapper = await mountPanel('member')

      expect(wrapper.find('[data-testid="webhooks-forbidden"]').exists()).toBe(true)
      expect(wrapper.text()).toContain('Only an owner or an admin')
      expect(wrapper.find('[data-testid="webhooks-upgrade"]').exists()).toBe(false)
      expect(webhookService.list).not.toHaveBeenCalled()
    })

    it('renders no price in any of them', async () => {
      const wrapper = await mountPanel('owner', freePlan)

      expect(wrapper.text()).not.toMatch(/[€$£]\s?\d/)
    })
  })

  describe('configuring an endpoint', () => {
    it('shows the signing secret once, and loses it on dismissal', async () => {
      vi.mocked(webhookService.create).mockResolvedValue({
        ...active,
        id: 'w3',
        url: 'https://new.example.com/hook',
        secret: 'whsec_thesecret'
      })
      const wrapper = await mountPanel('admin')

      await wrapper.find('[data-testid="webhook-url"]').setValue('https://new.example.com/hook')
      await wrapper.find('[data-testid="create-webhook-form"]').trigger('submit')
      await flushPromises()

      const secret = wrapper.find('[data-testid="webhook-secret"]')
      expect(secret.exists()).toBe(true)
      expect((secret.element as HTMLInputElement).value).toBe('whsec_thesecret')
      expect(wrapper.text()).toContain('only time it is shown')

      await wrapper.find('[data-testid="dismiss-webhook-secret"]').trigger('click')
      await flushPromises()

      expect(wrapper.find('[data-testid="webhook-secret"]').exists()).toBe(false)
      expect(wrapper.html()).not.toContain('whsec_thesecret')
    })

    it('treats a 402 as a limit and a 503 as an error', async () => {
      vi.mocked(webhookService.create).mockRejectedValue(
        new ApiError(402, 'Your plan does not include API access')
      )
      const wrapper = await mountPanel('admin')

      await wrapper.find('[data-testid="webhook-url"]').setValue('https://new.example.com/hook')
      await wrapper.find('[data-testid="create-webhook-form"]').trigger('submit')
      await flushPromises()

      expect(wrapper.find('[data-testid="limit-reached"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="webhooks-error"]').exists()).toBe(false)

      vi.mocked(webhookService.create).mockRejectedValue(
        new ApiError(503, 'Webhooks require the job queue')
      )
      const other = await mountPanel('admin')
      await other.find('[data-testid="webhook-url"]').setValue('https://new.example.com/hook')
      await other.find('[data-testid="create-webhook-form"]').trigger('submit')
      await flushPromises()

      // An installation that cannot deliver is not a plan limit: no dialog, and
      // the server's sentence in the banner.
      expect(other.find('[data-testid="limit-reached"]').exists()).toBe(false)
      expect(other.find('[data-testid="webhooks-error"]').text()).toContain('job queue')
    })
  })

  describe('a disabled endpoint', () => {
    it('shows why it stopped and offers to re-enable it', async () => {
      const wrapper = await mountPanel('owner', teamPlan, {
        webhooks: [active, disabled],
        deliverable: true
      })

      expect(wrapper.find('[data-testid="webhook-error-w2"]').text()).toContain('ETIMEDOUT')
      expect(wrapper.text()).toContain('Disabled')
      // Without this the screen reports a dead end: nothing else can clear
      // `disabledAt`, and delete-and-recreate rotates the secret.
      expect(wrapper.find('[data-testid="reenable-w2"]').exists()).toBe(true)
      // An active endpoint has nothing to re-enable.
      expect(wrapper.find('[data-testid="reenable-w1"]').exists()).toBe(false)
    })

    it('re-enables through the store', async () => {
      vi.mocked(webhookService.reenable).mockResolvedValue({ ...disabled, disabledAt: null })
      const wrapper = await mountPanel('owner', teamPlan, {
        webhooks: [disabled],
        deliverable: true
      })

      await wrapper.find('[data-testid="reenable-w2"]').trigger('click')
      await flushPromises()

      expect(webhookService.reenable).toHaveBeenCalledWith('w2')
    })
  })

  describe('deleting', () => {
    it('says what is destroyed before doing it', async () => {
      vi.mocked(webhookService.remove).mockResolvedValue(undefined)
      const wrapper = await mountPanel('owner')

      await wrapper.find('[data-testid="delete-w1"]').trigger('click')

      // Nothing is gone yet.
      expect(webhookService.remove).not.toHaveBeenCalled()
      const confirm = wrapper.find('[data-testid="confirm-delete-w1"]')
      expect(confirm.exists()).toBe(true)
      expect(confirm.text()).toContain('delivery history goes with it')

      await wrapper.find('[data-testid="confirm-delete-yes-w1"]').trigger('click')
      await flushPromises()

      expect(webhookService.remove).toHaveBeenCalledWith('w1')
    })
  })

  describe('the delivery history', () => {
    it('opens it and shows attempts without any payload', async () => {
      vi.mocked(webhookService.deliveries).mockResolvedValue([delivery])
      const wrapper = await mountPanel('owner')

      await wrapper.find('[data-testid="deliveries-w1"]').trigger('click')
      await flushPromises()

      const row = wrapper.find('[data-testid="delivery-d1"]')
      expect(row.exists()).toBe(true)
      expect(row.text()).toContain('response.created')
      expect(row.text()).toContain('500')
      // There is no body stored and none rendered: it would be a second copy of
      // respondent answers, outliving the form they came from.
      expect(wrapper.text()).toContain('We keep what happened, not what was sent')
    })

    it('says plainly when nothing has been sent yet', async () => {
      vi.mocked(webhookService.deliveries).mockResolvedValue([])
      const wrapper = await mountPanel('owner')

      await wrapper.find('[data-testid="deliveries-w1"]').trigger('click')
      await flushPromises()

      expect(wrapper.find('[data-testid="no-deliveries-w1"]').exists()).toBe(true)
    })

    it('is readable on a deployment that cannot deliver', async () => {
      vi.mocked(webhookService.deliveries).mockResolvedValue([delivery])
      const wrapper = await mountPanel('owner', teamPlan, {
        webhooks: [active],
        deliverable: false
      })

      await wrapper.find('[data-testid="deliveries-w1"]').trigger('click')
      await flushPromises()

      // The queue being off does not make the past untrue, and this is when
      // somebody most wants to read it.
      expect(wrapper.find('[data-testid="delivery-d1"]').exists()).toBe(true)
    })
  })
})
