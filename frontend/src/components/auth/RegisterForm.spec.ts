import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import RegisterForm from './RegisterForm.vue'
import { useAuthStore } from '@/stores/auth.store'
import PrimeVue from 'primevue/config'
import { flushPromises } from '@/test/helpers/test-utils'

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

    expect(authStore.register).toHaveBeenCalledWith('test@example.com', 'password123', 'Test User')
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

    expect(authStore.register).toHaveBeenCalledWith('test@example.com', 'password123', undefined)
  })
})
