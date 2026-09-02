import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import RegisterForm from './RegisterForm.vue'
import { useAuthStore } from '@/stores/auth.store'
import PrimeVue from 'primevue/config'
import { flushPromises } from '@/test/helpers/test-utils'
import { authService } from '@/services/auth'

// The form asks the server whether registration is open before it draws
// (features/0033). Mocked here so no spec depends on the network, and defaulted
// to `open` in `beforeEach` so the cases written before this feature keep
// rendering the form they were written against.
vi.mock('@/services/auth', () => ({
  authService: { getRegistrationMode: vi.fn() }
}))

// Mock router
const mockPush = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mockPush })
}))

// Mock toast
const mockToast = { add: vi.fn() }
vi.mock('primevue/usetoast', () => ({
  useToast: () => mockToast
}))

describe('RegisterForm', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(authService.getRegistrationMode).mockResolvedValue('open')
  })

  const mountComponent = () => {
    return mount(RegisterForm, {
      global: {
        plugins: [PrimeVue],
        stubs: {
          InputText: {
            template: '<input :type="type" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
            props: ['modelValue', 'type', 'invalid', 'placeholder', 'required', 'autocomplete']
          },
          Password: {
            template: '<input type="password" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
            props: ['modelValue', 'invalid', 'placeholder', 'required', 'autocomplete', 'feedback', 'toggleMask', 'inputClass']
          },
          Button: { template: '<button type="submit"><slot /></button>' },
          Message: { template: '<div><slot /></div>' }
        }
      }
    })
  }

  it('should render form fields', () => {
    const wrapper = mountComponent()

    expect(wrapper.findAll('input')).toHaveLength(4) // name, email, password, confirmPassword
    expect(wrapper.find('button').exists()).toBe(true)
  })

  it('should validate email format', async () => {
    const wrapper = mountComponent()
    const inputs = wrapper.findAll('input')

    await inputs[1].setValue('invalid')
    await wrapper.find('form').trigger('submit.prevent')
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('Email is invalid')
  })

  it('should validate password length', async () => {
    const wrapper = mountComponent()
    const inputs = wrapper.findAll('input')

    await inputs[1].setValue('test@test.com')
    await inputs[2].setValue('123')
    await wrapper.find('form').trigger('submit.prevent')
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('at least 6 characters')
  })

  it('should validate password confirmation', async () => {
    const wrapper = mountComponent()
    const inputs = wrapper.findAll('input')

    await inputs[1].setValue('test@test.com')
    await inputs[2].setValue('password123')
    await inputs[3].setValue('different')
    await wrapper.find('form').trigger('submit.prevent')
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('do not match')
  })

  it('should submit registration with valid data', async () => {
    const authStore = useAuthStore()
    authStore.register = vi.fn().mockResolvedValue({})

    const wrapper = mountComponent()
    const inputs = wrapper.findAll('input')

    await inputs[0].setValue('Test User')
    await inputs[1].setValue('test@example.com')
    await inputs[2].setValue('password123')
    await inputs[3].setValue('password123')
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    expect(authStore.register).toHaveBeenCalledWith('test@example.com', 'password123', 'Test User', undefined)
  })

  it('should redirect after successful registration', async () => {
    const authStore = useAuthStore()
    authStore.register = vi.fn().mockResolvedValue({})

    const wrapper = mountComponent()
    const inputs = wrapper.findAll('input')

    await inputs[1].setValue('test@example.com')
    await inputs[2].setValue('password123')
    await inputs[3].setValue('password123')
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()
    await wrapper.vm.$nextTick()

    expect(mockPush).toHaveBeenCalledWith('/dashboard')
    expect(mockToast.add).toHaveBeenCalled()
  })

  it('should register without name', async () => {
    const authStore = useAuthStore()
    authStore.register = vi.fn().mockResolvedValue({})

    const wrapper = mountComponent()
    const inputs = wrapper.findAll('input')

    await inputs[1].setValue('test@example.com')
    await inputs[2].setValue('password123')
    await inputs[3].setValue('password123')
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    expect(authStore.register).toHaveBeenCalledWith('test@example.com', 'password123', undefined, undefined)
  })

  /**
   * The private beta's signup code (features/0033).
   *
   * The server is the authority on whether a code is required — everything
   * here is about what the screen draws before anybody has typed anything, so
   * a visitor is not asked to fill in a whole form and then told from a 403.
   */
  describe('registration mode', () => {
    async function mountWithMode(mode: 'open' | 'invite_only') {
      vi.mocked(authService.getRegistrationMode).mockResolvedValue(mode)
      const wrapper = mountComponent()
      await flushPromises()
      return wrapper
    }

    it('draws no code field when registration is open', async () => {
      const wrapper = await mountWithMode('open')

      expect(wrapper.find('[data-testid="register-code-input"]').exists()).toBe(false)
      expect(wrapper.findAll('input')).toHaveLength(4)
    })

    it('draws the code field and explains the beta when invite_only', async () => {
      const wrapper = await mountWithMode('invite_only')

      expect(wrapper.find('[data-testid="register-code-input"]').exists()).toBe(true)
      expect(wrapper.text()).toContain('invitation-only')
    })

    it('sends the code with the registration', async () => {
      const authStore = useAuthStore()
      authStore.register = vi.fn().mockResolvedValue({})

      const wrapper = await mountWithMode('invite_only')
      // The code field is drawn directly under the heading, so the inputs are
      // code, name, email, password, confirm.
      const inputs = wrapper.findAll('input')

      await inputs[0].setValue('the-beta-code')
      await inputs[2].setValue('test@example.com')
      await inputs[3].setValue('password123')
      await inputs[4].setValue('password123')
      await wrapper.find('form').trigger('submit.prevent')
      await flushPromises()

      expect(authStore.register).toHaveBeenCalledWith(
        'test@example.com',
        'password123',
        undefined,
        'the-beta-code'
      )
    })

    it('refuses to submit an empty code rather than spending a round trip', async () => {
      const authStore = useAuthStore()
      authStore.register = vi.fn().mockResolvedValue({})

      const wrapper = await mountWithMode('invite_only')
      // Everything filled in except the code: code, name, email, password,
      // confirm.
      const inputs = wrapper.findAll('input')

      await inputs[2].setValue('test@example.com')
      await inputs[3].setValue('password123')
      await inputs[4].setValue('password123')
      await wrapper.find('form').trigger('submit.prevent')
      await flushPromises()

      expect(authStore.register).not.toHaveBeenCalled()
      expect(wrapper.text()).toContain('An invitation code is required')
    })

    /**
     * The property that makes the fetch safe to do at all: a failed GET must
     * not become an outage on the signup screen. The form stays usable and the
     * server still refuses with a 403 the form surfaces.
     */
    it('stays usable when the mode cannot be read', async () => {
      const authStore = useAuthStore()
      authStore.register = vi.fn().mockResolvedValue({})
      vi.mocked(authService.getRegistrationMode).mockRejectedValue(new Error('offline'))

      const wrapper = mountComponent()
      await flushPromises()

      expect(wrapper.find('[data-testid="register-code-input"]').exists()).toBe(false)

      const inputs = wrapper.findAll('input')
      await inputs[1].setValue('test@example.com')
      await inputs[2].setValue('password123')
      await inputs[3].setValue('password123')
      await wrapper.find('form').trigger('submit.prevent')
      await flushPromises()

      expect(authStore.register).toHaveBeenCalled()
    })
  })
})
