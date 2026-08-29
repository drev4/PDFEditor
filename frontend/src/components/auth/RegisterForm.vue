<template>
  <form @submit.prevent="handleSubmit" class="space-y-6">
    <div>
      <h2 class="text-2xl font-bold text-gray-800 mb-2">Create Account</h2>
      <p class="text-gray-600 text-sm">Start editing PDFs professionally</p>
    </div>

    <!-- Name Field (Optional) -->
    <div class="space-y-2">
      <label for="name" class="block text-sm font-medium text-gray-700">
        Full Name <span class="text-gray-400">(optional)</span>
      </label>
      <InputText
        id="name"
        v-model="name"
        type="text"
        placeholder="John Doe"
        class="w-full"
        autocomplete="name"
        data-testid="register-name-input"
      />
    </div>

    <!-- Email Field -->
    <div class="space-y-2">
      <label for="email" class="block text-sm font-medium text-gray-700">
        Email Address
      </label>
      <InputText
        id="email"
        v-model="email"
        type="email"
        placeholder="you@example.com"
        :invalid="!!errors.email"
        class="w-full"
        required
        autocomplete="email"
        data-testid="register-email-input"
      />
      <small v-if="errors.email" class="text-red-500">{{ errors.email }}</small>
    </div>

    <!-- Password Field -->
    <div class="space-y-2">
      <label for="password" class="block text-sm font-medium text-gray-700">
        Password
      </label>
      <Password
        id="password"
        v-model="password"
        placeholder="At least 6 characters"
        :invalid="!!errors.password"
        toggleMask
        :feedback="true"
        class="w-full"
        inputClass="w-full"
        required
        autocomplete="new-password"
        inputId="register-password-input"
        data-testid="register-password-input"
      >
        <template #footer>
          <p class="text-xs text-gray-600 mt-2">
            Password must be at least 6 characters long
          </p>
        </template>
      </Password>
      <small v-if="errors.password" class="text-red-500">{{ errors.password }}</small>
    </div>

    <!-- Confirm Password Field -->
    <div class="space-y-2">
      <label for="confirmPassword" class="block text-sm font-medium text-gray-700">
        Confirm Password
      </label>
      <Password
        id="confirmPassword"
        v-model="confirmPassword"
        placeholder="Re-enter your password"
        :invalid="!!errors.confirmPassword"
        :feedback="false"
        toggleMask
        class="w-full"
        inputClass="w-full"
        required
        autocomplete="new-password"
        inputId="register-confirm-password-input"
        data-testid="register-confirm-password-input"
      />
      <small v-if="errors.confirmPassword" class="text-red-500">{{ errors.confirmPassword }}</small>
    </div>

    <!-- Error General -->
    <Message v-if="authStore.error" severity="error" :closable="false">
      {{ authStore.error }}
    </Message>

    <!-- Submit Button -->
    <Button
      type="submit"
      label="Create Account"
      icon="pi pi-user-plus"
      :loading="authStore.loading"
      class="w-full"
      size="large"
      data-testid="register-submit-button"
    />
  </form>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useToast } from 'primevue/usetoast'
import InputText from 'primevue/inputtext'
import Password from 'primevue/password'
import Button from 'primevue/button'
import Message from 'primevue/message'
import { useAuthStore } from '@/stores/auth.store'

const authStore = useAuthStore()
const router = useRouter()
const toast = useToast()

const name = ref('')
const email = ref('')
const password = ref('')
const confirmPassword = ref('')
const errors = ref<{
  email?: string
  password?: string
  confirmPassword?: string
}>({})

const validateForm = () => {
  errors.value = {}
  let valid = true

  if (!email.value) {
    errors.value.email = 'Email is required'
    valid = false
  } else if (!/\S+@\S+\.\S+/.test(email.value)) {
    errors.value.email = 'Email is invalid'
    valid = false
  }

  if (!password.value) {
    errors.value.password = 'Password is required'
    valid = false
  } else if (password.value.length < 6) {
    errors.value.password = 'Password must be at least 6 characters'
    valid = false
  }

  if (!confirmPassword.value) {
    errors.value.confirmPassword = 'Please confirm your password'
    valid = false
  } else if (password.value !== confirmPassword.value) {
    errors.value.confirmPassword = 'Passwords do not match'
    valid = false
  }

  return valid
}

const handleSubmit = async () => {
  if (!validateForm()) return

  try {
    await authStore.register(email.value, password.value, name.value || undefined)

    toast.add({
      severity: 'success',
      summary: 'Account created!',
      detail: 'Welcome to VuePDF Forms',
      life: 3000
    })

    router.push('/dashboard')
  } catch (error) {
    // El error ya está en authStore.error
    console.error('Registration failed:', error)
  }
}
</script>
