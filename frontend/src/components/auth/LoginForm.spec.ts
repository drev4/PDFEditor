import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import LoginForm from './LoginForm.vue'
import { useAuthStore } from '@/stores/auth.store'
import PrimeVue from 'primevue/config'
import { flushPromises } from '@/test/helpers/test-utils'

// Mock router
const mockPush = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useRoute: () => ({ query: {} })
}))

// Mock toast
const mockToast = { add: vi.fn() }
vi.mock('primevue/usetoast', () => ({
  useToast: () => mockToast
}))

describe('LoginForm', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  const mountComponent = () => {
    return mount(LoginForm, {
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

    expect(wrapper.find('input[type="email"]').exists()).toBe(true)
    expect(wrapper.find('input[type="password"]').exists()).toBe(true)
    expect(wrapper.find('button').exists()).toBe(true)
  })

  it('should validate email format', async () => {
    const wrapper = mountComponent()

    await wrapper.find('input[type="email"]').setValue('invalid-email')
    await wrapper.find('form').trigger('submit.prevent')
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('Email is invalid')
  })

  it('should validate required fields', async () => {
    const wrapper = mountComponent()

    await wrapper.find('form').trigger('submit.prevent')
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('Email is required')
    expect(wrapper.text()).toContain('Password is required')
  })

  it('should submit login with valid credentials', async () => {
    const authStore = useAuthStore()
    authStore.login = vi.fn().mockResolvedValue({})

    const wrapper = mountComponent()

    await wrapper.find('input[type="email"]').setValue('test@example.com')
    await wrapper.find('input[type="password"]').setValue('password123')
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    expect(authStore.login).toHaveBeenCalledWith('test@example.com', 'password123')
  })

  it('should redirect after successful login', async () => {
    const authStore = useAuthStore()
    authStore.login = vi.fn().mockResolvedValue({})

    const wrapper = mountComponent()

    await wrapper.find('input[type="email"]').setValue('test@example.com')
    await wrapper.find('input[type="password"]').setValue('password123')
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()
    await wrapper.vm.$nextTick()

    expect(mockPush).toHaveBeenCalledWith('/dashboard')
    expect(mockToast.add).toHaveBeenCalled()
  })

  it('should display error on login failure', async () => {
    const authStore = useAuthStore()
    authStore.login = vi.fn().mockRejectedValue(new Error('Login failed'))
    authStore.error = 'Invalid credentials'

    const wrapper = mountComponent()

    await wrapper.find('input[type="email"]').setValue('test@example.com')
    await wrapper.find('input[type="password"]').setValue('wrong')
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('Invalid credentials')
  })
})
