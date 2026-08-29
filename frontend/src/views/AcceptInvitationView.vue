<template>
  <div class="accept-view">
    <h1>Join the team</h1>

    <p v-if="error" class="error" role="alert" data-testid="accept-error">{{ error }}</p>

    <form v-if="!done" data-testid="accept-form" @submit.prevent="submit">
      <p class="explain">
        You have been invited to an organization. Set a password to create your account, or
        <router-link to="/login">sign in</router-link> if you already have one.
      </p>

      <label>
        Your name (optional)
        <input v-model="name" type="text" data-testid="accept-name" />
      </label>

      <label>
        Password
        <input v-model="password" type="password" minlength="6" data-testid="accept-password" />
      </label>

      <button type="submit" :disabled="loading" data-testid="accept-submit">
        {{ loading ? 'Joining…' : 'Accept invitation' }}
      </button>
    </form>

    <p v-else data-testid="accept-done">You are in. Taking you to the dashboard…</p>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { organizationService } from '@/services/organization'
import { setAccessToken } from '@/services/api'
import { useAuthStore } from '@/stores/auth.store'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const name = ref('')
const password = ref('')
const loading = ref(false)
const error = ref<string | null>(null)
const done = ref(false)

async function submit() {
  loading.value = true
  error.value = null

  try {
    const token = route.params.token as string
    const result = await organizationService.acceptInvitation(token, password.value, name.value)

    // Accepting as a brand new account signs them straight in: they have just
    // proved they hold the invitation and chosen their own password. An
    // already-signed-in user gets no token back and is already authenticated.
    if (result.token && result.user) {
      setAccessToken(result.token)
      authStore.user = result.user
    }

    done.value = true
    await router.push('/dashboard')
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not accept the invitation'
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.accept-view { max-width: 420px; margin: 4rem auto; padding: 0 1rem; }
.explain { color: #6a6f7b; }
form { display: flex; flex-direction: column; gap: 1rem; margin-top: 1.5rem; }
label { display: flex; flex-direction: column; gap: 0.35rem; font-weight: 600; }
input { padding: 0.6rem; border: 1px solid #d8dae1; border-radius: 4px; font-weight: 400; }
button { padding: 0.7rem; border: none; border-radius: 4px; background: #3554d1; color: white; font-weight: 600; cursor: pointer; }
button:disabled { opacity: 0.6; cursor: default; }
.error { color: #b02a30; background: #f7ecec; padding: 0.75rem 1rem; border-radius: 6px; }
</style>
