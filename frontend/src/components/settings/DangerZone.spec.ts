import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import DangerZone from './DangerZone.vue'
import { accountService } from '@/services/account'
import { ApiError } from '@/services/api'

vi.mock('@/services/account')

const push = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push })
}))

const logout = vi.fn()
vi.mock('@/stores/auth.store', () => ({
  useAuthStore: () => ({ logout })
}))

/**
 * Deleting the account (features/0029).
 *
 * The behaviours asserted here are the ones the obvious implementation gets
 * wrong: the destructive button is not reachable in one click, the typed
 * confirmation actually gates the request, and a refusal from the server is
 * shown as the server wrote it — a `409` names the organizations blocking the
 * deletion, and a generic "could not delete" would throw that away.
 */
describe('DangerZone', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  function render() {
    return mount(DangerZone, { global: { plugins: [PrimeVue] } })
  }

  async function openConfirmation(wrapper: ReturnType<typeof render>) {
    await wrapper.find('[data-testid="delete-account-open"]').trigger('click')
  }

  async function fill(wrapper: ReturnType<typeof render>, password: string, phrase: string) {
    await wrapper.find('[data-testid="delete-account-password"] input').setValue(password)
    await wrapper.find('[data-testid="delete-account-phrase"]').setValue(phrase)
  }

  it('does not show the confirmation until it is asked for', () => {
    const wrapper = render()

    expect(wrapper.find('[data-testid="delete-account-confirm"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="delete-account-open"]').exists()).toBe(true)
  })

  it('keeps the delete button disabled until the password and the exact word are present', async () => {
    const wrapper = render()
    await openConfirmation(wrapper)

    await fill(wrapper, '', '')
    expect(wrapper.find('[data-testid="delete-account-submit"]').attributes('disabled')).toBeDefined()

    await fill(wrapper, 'TestPassword123!', 'delete')
    expect(wrapper.find('[data-testid="delete-account-submit"]').attributes('disabled')).toBeDefined()

    await fill(wrapper, 'TestPassword123!', 'DELETE')
    expect(wrapper.find('[data-testid="delete-account-submit"]').attributes('disabled')).toBeUndefined()
  })

  it('deletes, ends the session and leaves for the login screen', async () => {
    vi.mocked(accountService.deleteAccount).mockResolvedValue(undefined)

    const wrapper = render()
    await openConfirmation(wrapper)
    await fill(wrapper, 'TestPassword123!', 'DELETE')

    await wrapper.find('[data-testid="delete-account-submit"]').trigger('click')
    await flushPromises()

    expect(accountService.deleteAccount).toHaveBeenCalledWith('TestPassword123!')
    expect(logout).toHaveBeenCalled()
    expect(push).toHaveBeenCalledWith('/login')
  })

  it('shows the server refusal verbatim and stays put', async () => {
    const message =
      'You are the last owner of "Acme". Make somebody else an owner, or remove the ' +
      'remaining members and pending invitations, before deleting your account.'
    vi.mocked(accountService.deleteAccount).mockRejectedValue(new ApiError(409, message))

    const wrapper = render()
    await openConfirmation(wrapper)
    await fill(wrapper, 'TestPassword123!', 'DELETE')

    await wrapper.find('[data-testid="delete-account-submit"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="delete-account-error"]').text()).toBe(message)
    expect(logout).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it('reports a wrong password without ending the session', async () => {
    vi.mocked(accountService.deleteAccount).mockRejectedValue(new ApiError(401, 'Incorrect password'))

    const wrapper = render()
    await openConfirmation(wrapper)
    await fill(wrapper, 'wrong', 'DELETE')

    await wrapper.find('[data-testid="delete-account-submit"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="delete-account-error"]').text()).toBe('Incorrect password')
    expect(push).not.toHaveBeenCalled()
  })

  it('cancelling clears what was typed', async () => {
    const wrapper = render()
    await openConfirmation(wrapper)
    await fill(wrapper, 'TestPassword123!', 'DELETE')

    await wrapper.find('[data-testid="delete-account-cancel"]').trigger('click')
    expect(wrapper.find('[data-testid="delete-account-confirm"]').exists()).toBe(false)

    await openConfirmation(wrapper)
    expect(
      (wrapper.find('[data-testid="delete-account-phrase"]').element as HTMLInputElement).value
    ).toBe('')
  })
})
