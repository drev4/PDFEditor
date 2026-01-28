<template>
  <form @submit.prevent="handleSubmit" class="space-y-6">
    <div>
      <h2 class="text-2xl font-bold text-gray-800 mb-2">Welcome Back</h2>
      <p class="text-gray-600 text-sm">Sign in to continue to your workspace</p>
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
        placeholder="Enter your password"
        :invalid="!!errors.password"
        :feedback="false"
        toggleMask
        class="w-full"
        inputClass="w-full"
        required
        autocomplete="current-password"
      />
      <small v-if="errors.password" class="text-red-500">{{ errors.password }}</small>
    </div>

    <!-- Error General -->
    <Message v-if="authStore.error" severity="error" :closable="false">
      {{ authStore.error }}
    </Message>

    <!-- Submit Button -->
    <Button
      type="submit"
      label="Sign In"
      icon="pi pi-sign-in"
      :loading="authStore.loading"
      class="w-full"
      size="large"
    />
  </form>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useToast } from 'primevue/usetoast'
import InputText from 'primevue/inputtext'
import Password from 'primevue/password'
import Button from 'primevue/button'
import Message from 'primevue/message'
import { useAuthStore } from '@/stores/auth.store'

const authStore = useAuthStore()
const router = useRouter()
const route = useRoute()
const toast = useToast()

const email = ref('')
const password = ref('')
const errors = ref<{ email?: string; password?: string }>({})

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
  }

  return valid
}

const handleSubmit = async () => {
  if (!validateForm()) return

  try {
    await authStore.login(email.value, password.value)

    toast.add({
      severity: 'success',
      summary: 'Welcome back!',
      detail: 'You have successfully logged in',
      life: 3000
    })

    // Redirigir a la página original o al dashboard
    const redirect = route.query.redirect as string || '/dashboard'
    router.push(redirect)
  } catch (error) {
    // El error ya está en authStore.error
    console.error('Login failed:', error)
  }
}
</script>
