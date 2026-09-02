<template>
  <form @submit.prevent="handleSubmit" class="space-y-6">
    <div>
      <h2 class="text-title font-bold text-ink mb-2">Create Account</h2>
      <p class="text-muted text-body">Start editing PDFs professionally</p>
    </div>

    <!-- Private beta (features/0033). Shown before anything is typed, so a
         visitor learns the beta is closed here rather than from a 403 after
         filling in the whole form. -->
    <Message v-if="showCodeField" severity="info" :closable="false">
      Sign-ups are invitation-only while we run the private beta. Enter the code
      from your invitation email below.
    </Message>

    <!-- Invitation Code -->
    <div v-if="showCodeField" class="space-y-2">
      <label for="code" class="block text-body font-medium text-ink">
        Invitation Code
      </label>
      <InputText
        id="code"
        v-model="code"
        type="text"
        placeholder="From your invitation email"
        :invalid="!!errors.code"
        class="w-full"
        autocomplete="off"
        data-testid="register-code-input"
      />
      <small v-if="errors.code" class="text-danger">{{ errors.code }}</small>
    </div>

    <!-- Name Field (Optional) -->
    <div class="space-y-2">
      <label for="name" class="block text-body font-medium text-ink">
        Full Name <span class="text-faint">(optional)</span>
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
      <label for="email" class="block text-body font-medium text-ink">
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
      <small v-if="errors.email" class="text-danger">{{ errors.email }}</small>
    </div>

    <!-- Password Field -->
    <div class="space-y-2">
      <label for="password" class="block text-body font-medium text-ink">
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
          <p class="text-meta text-muted mt-2">
            Password must be at least 6 characters long
          </p>
        </template>
      </Password>
      <small v-if="errors.password" class="text-danger">{{ errors.password }}</small>
    </div>

    <!-- Confirm Password Field -->
    <div class="space-y-2">
      <label for="confirmPassword" class="block text-body font-medium text-ink">
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
      <small v-if="errors.confirmPassword" class="text-danger">{{ errors.confirmPassword }}</small>
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
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useToast } from 'primevue/usetoast'
import InputText from 'primevue/inputtext'
import Password from 'primevue/password'
import Button from 'primevue/button'
import Message from 'primevue/message'
import { useAuthStore } from '@/stores/auth.store'
import { authService } from '@/services/auth'

const authStore = useAuthStore()
const router = useRouter()
const toast = useToast()

const name = ref('')
const email = ref('')
const password = ref('')
const confirmPassword = ref('')
const code = ref('')
const errors = ref<{
  email?: string
  password?: string
  confirmPassword?: string
  code?: string
}>({})

/**
 * Whether to draw the invitation-code field (features/0033).
 *
 * **It starts false and is only ever turned on**, which is what makes the
 * failure of the request below harmless: if `GET /auth/registration` is
 * unreachable the screen renders exactly as it does today and the server
 * decides, answering 403 with a message this form surfaces. Blocking the form
 * on a request that returned nothing would turn one flaky GET into an outage
 * on the signup screen, which is not a trade the beta is worth.
 */
const showCodeField = ref(false)

onMounted(async () => {
  try {
    showCodeField.value = (await authService.getRegistrationMode()) === 'invite_only'
  } catch {
    // Deliberately silent: see `showCodeField`. The form stays usable and the
    // server remains the authority on whether registration is open.
  }
})

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

  // Only when the field is drawn. The server is the authority on whether a
  // code is required — this check exists so an empty one is caught here
  // instead of costing a round trip and a 403.
  if (showCodeField.value && !code.value.trim()) {
    errors.value.code = 'An invitation code is required'
    valid = false
  }

  return valid
}

const handleSubmit = async () => {
  if (!validateForm()) return

  try {
    await authStore.register(
      email.value,
      password.value,
      name.value || undefined,
      code.value.trim() || undefined
    )

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
