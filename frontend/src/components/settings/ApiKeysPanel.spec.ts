import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import { flushPromises } from '@vue/test-utils'
import ApiKeysPanel from './ApiKeysPanel.vue'
import { usePlanStore } from '@/stores/plan.store'
import { useOrganizationStore } from '@/stores/organization.store'
import { planService, type Entitlements } from '@/services/plan'
import { organizationService } from '@/services/organization'
import { billingService } from '@/services/billing'
import { apiKeyService, type ApiKey } from '@/services/apiKeys'
import { ApiError } from '@/services/api'

vi.mock('@/services/plan')
vi.mock('@/services/organization')
vi.mock('@/services/billing')
vi.mock('@/services/apiKeys')

/**
 * The API keys tab ([`features/0021`](../../../../features/0021-api-keys-screen.md)).
 *
 * Four behaviours are asserted here because they are the ones that are wrong in
 * the obvious implementation: the secret is shown once and then gone; a `402`
 * and a `403` say different things and lead to different places; a revoked key
 * keeps its row; and no create control is offered on a plan that would refuse
 * it.
 */
describe('ApiKeysPanel', () => {
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

  const liveKey: ApiKey = {
    id: 'k1',
    name: 'Zapier',
    prefix: 'a1b2c3d4e5f6',
    lastUsedAt: null,
    revokedAt: null,
    createdAt: '2026-08-01T09:00:00.000Z'
  }

  const revokedKey: ApiKey = {
    id: 'k2',
    name: 'An old integration',
    prefix: 'bbbbbbbbbbbb',
    lastUsedAt: null,
    revokedAt: '2026-08-20T09:00:00.000Z',
    createdAt: '2026-07-01T09:00:00.000Z'
  }

  async function mountPanel(
    role: 'owner' | 'admin' | 'member',
    entitlements = teamPlan,
    keys: ApiKey[] = [liveKey]
  ) {
    vi.mocked(planService.entitlements).mockResolvedValue(entitlements)
    vi.mocked(apiKeyService.list).mockResolvedValue(keys)

    const planStore = usePlanStore()
    await planStore.load()

    const organizationStore = useOrganizationStore()
    // Derived from the members list exactly as `MembersView.vue` derives it —
    // no second source for "what may I do".
    vi.spyOn(organizationStore, 'currentRole', 'get').mockReturnValue(role)

    const wrapper = mount(ApiKeysPanel, {
      global: {
        plugins: [PrimeVue],
        stubs: {
          // PrimeVue's Dialog teleports its content out of the wrapper, which
          // would put it out of reach of these assertions. The stub renders it
          // inline — and honours `visible`, because whether the dialog is up at
          // all is one of the things under test here.
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

  describe('the plan does not include the API', () => {
    it('offers no create form at all', async () => {
      const wrapper = await mountPanel('owner', freePlan)

      // A button whose only possible answer is 402 tells somebody the product
      // is broken when it is enforcing a rule (05-frontend-patterns §8).
      expect(wrapper.find('[data-testid="create-key-form"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="api-keys-upgrade"]').exists()).toBe(true)
    })

    it('does not even ask the server for a list it may not have', async () => {
      await mountPanel('owner', freePlan)

      expect(apiKeyService.list).not.toHaveBeenCalled()
    })

    it('offers the owner the upgrade, and a member none', async () => {
      const asOwner = await mountPanel('owner', freePlan)
      expect(asOwner.find('[data-testid="api-keys-upgrade-team"]').exists()).toBe(true)

      const asMember = await mountPanel('member', freePlan)
      expect(asMember.find('[data-testid="api-keys-upgrade-team"]').exists()).toBe(false)
      expect(asMember.text()).toContain('Only an owner of this organization can change the plan')
    })

    it('renders no price anywhere', async () => {
      const wrapper = await mountPanel('owner', freePlan)

      // The amount lives in Stripe and the customer sees the real one on
      // Stripe's own page (features/0013, trap 7).
      expect(wrapper.text()).not.toMatch(/[€$£]\s?\d/)
    })
  })

  describe('a member of an organization that does have the API', () => {
    it('is told to ask an owner, not to upgrade', async () => {
      const wrapper = await mountPanel('member')

      // `403` and `402` are different answers and lead to different places:
      // ask a person, versus buy something (features/0012). Collapsing them
      // sends the customer to the wrong one.
      expect(wrapper.find('[data-testid="api-keys-forbidden"]').exists()).toBe(true)
      expect(wrapper.text()).toContain('Only an owner or an admin')
      expect(wrapper.find('[data-testid="api-keys-upgrade"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="create-key-form"]').exists()).toBe(false)
    })

    it('does not request a list the server would refuse', async () => {
      await mountPanel('member')

      expect(apiKeyService.list).not.toHaveBeenCalled()
    })
  })

  describe('an admin on a plan with the API', () => {
    it('lists the keys and can create one', async () => {
      const wrapper = await mountPanel('admin')

      expect(apiKeyService.list).toHaveBeenCalled()
      expect(wrapper.find('[data-testid="create-key-form"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="api-key-k1"]').exists()).toBe(true)
      // The prefix identifies the row and authenticates nothing on its own.
      expect(wrapper.text()).toContain('vpk_a1b2c3d4e5f6')
    })

    it('shows the secret once, and loses it on dismissal', async () => {
      vi.mocked(apiKeyService.create).mockResolvedValue({
        ...liveKey,
        id: 'k3',
        name: 'Our CRM',
        prefix: 'ffffffffffff',
        secret: 'vpk_ffffffffffff_thesecret'
      })
      const wrapper = await mountPanel('admin')

      await wrapper.find('[data-testid="api-key-name"]').setValue('Our CRM')
      await wrapper.find('[data-testid="create-key-form"]').trigger('submit')
      await flushPromises()

      const secret = wrapper.find('[data-testid="api-key-secret"]')
      expect(secret.exists()).toBe(true)
      expect((secret.element as HTMLInputElement).value).toBe('vpk_ffffffffffff_thesecret')
      expect(wrapper.text()).toContain('only time this key is shown')

      await wrapper.find('[data-testid="dismiss-api-key"]').trigger('click')
      await flushPromises()

      // Gone, and unrecoverable: the server keeps only a hash of it.
      expect(wrapper.find('[data-testid="api-key-secret"]').exists()).toBe(false)
      expect(wrapper.html()).not.toContain('vpk_ffffffffffff_thesecret')
    })

    it('treats a 402 as a limit rather than a failure', async () => {
      vi.mocked(apiKeyService.create).mockRejectedValue(
        new ApiError(402, 'Your plan does not include API access')
      )
      const wrapper = await mountPanel('admin')

      await wrapper.find('[data-testid="api-key-name"]').setValue('Our CRM')
      await wrapper.find('[data-testid="create-key-form"]').trigger('submit')
      await flushPromises()

      // The plan can change between this page loading and the button being
      // pressed, so this path stays even though `hasApiAccess` hid the form for
      // everyone it could. Branching is on the status, never the message.
      expect(wrapper.find('[data-testid="limit-reached"]').exists()).toBe(true)
      expect(wrapper.text()).toContain('Your plan does not include API access')
      expect(wrapper.find('[data-testid="api-keys-error"]').exists()).toBe(false)
    })

    it('shows any other failure as an error, not as a limit', async () => {
      vi.mocked(apiKeyService.create).mockRejectedValue(new ApiError(500, 'Request failed'))
      const wrapper = await mountPanel('admin')

      await wrapper.find('[data-testid="api-key-name"]').setValue('Our CRM')
      await wrapper.find('[data-testid="create-key-form"]').trigger('submit')
      await flushPromises()

      expect(wrapper.find('[data-testid="limit-reached"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="api-keys-error"]').text()).toContain('Request failed')
    })
  })

  describe('revoked keys', () => {
    it('keeps the row and offers no second revocation', async () => {
      const wrapper = await mountPanel('owner', teamPlan, [liveKey, revokedKey])

      // The row and its timestamp are the only record of when access stopped.
      expect(wrapper.find('[data-testid="api-key-k2"]').exists()).toBe(true)
      expect(wrapper.text()).toContain('Revoked')
      expect(wrapper.find('[data-testid="revoke-key-k2"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="revoke-key-k1"]').exists()).toBe(true)
    })

    it('says a key has never been used rather than inventing activity', async () => {
      const wrapper = await mountPanel('owner')

      // `lastUsedAt` is written at most once a minute and its failures are
      // swallowed, so it answers "is this still in use?" and nothing finer.
      expect(wrapper.text()).toContain('Never used')
    })
  })
})
