<template>
  <section class="px-gutter mt-5 mb-8" data-testid="danger-zone">
    <div class="p-4 rounded-card border border-danger/40 max-w-[560px]">
      <h2 class="col-label mb-3 text-danger">Danger zone</h2>

      <p class="text-body text-muted">
        Deleting your account removes it permanently, along with every
        organization where you are the only member — their forms, the responses
        collected through them and the uploaded documents.
      </p>
      <p class="mt-2 text-meta text-faint">
        This happens immediately and cannot be undone.
      </p>

      <Button
        v-if="!confirming"
        label="Delete account"
        severity="danger"
        outlined
        class="mt-4"
        data-testid="delete-account-open"
        @click="open"
      />

      <!--
        The confirmation is inline rather than a dialog. It has two inputs and a
        consequence to read, and a modal that can be dismissed by clicking beside
        it is the wrong container for the one screen in this product with no undo.
      -->
      <div v-else class="mt-4 pt-4 border-t border-line" data-testid="delete-account-confirm">
        <label class="block text-row font-medium mb-1" for="delete-password">
          Your password
        </label>
        <Password
          id="delete-password"
          v-model="password"
          :feedback="false"
          toggle-mask
          fluid
          autocomplete="current-password"
          data-testid="delete-account-password"
        />

        <label class="block text-row font-medium mt-3 mb-1" for="delete-phrase">
          Type <span class="text-mono">DELETE</span> to confirm
        </label>
        <InputText
          id="delete-phrase"
          v-model="phrase"
          fluid
          autocomplete="off"
          data-testid="delete-account-phrase"
        />

        <p
          v-if="error"
          class="mt-3 text-body text-danger"
          role="alert"
          data-testid="delete-account-error"
        >
          {{ error }}
        </p>

        <div class="flex gap-2 mt-4">
          <Button
            label="Delete my account"
            severity="danger"
            :loading="loading"
            :disabled="!canSubmit"
            data-testid="delete-account-submit"
            @click="submit"
          />
          <Button
            label="Cancel"
            text
            :disabled="loading"
            data-testid="delete-account-cancel"
            @click="cancel"
          />
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Password from 'primevue/password'
import { accountService } from '@/services/account'
import { useAsyncAction } from '@/composables/useAsyncAction'
import { useAuthStore } from '@/stores/auth.store'

/**
 * Deleting the account (features/0029).
 *
 * Two gates, and they guard different things. The **password** proves who is at
 * the keyboard — an access token only proves the session, and a borrowed laptop
 * has one. The **typed word** guards against the click itself: it is the one
 * action in this product that destroys collected responses with no undo and no
 * export behind it yet.
 *
 * Server messages are shown verbatim. A `409` names the organizations that block
 * the deletion and says what to do about them; rewriting it into "Could not
 * delete account" would throw away the only useful part.
 */
const router = useRouter()
const authStore = useAuthStore()

const confirming = ref(false)
const password = ref('')
const phrase = ref('')

const loading = ref(false)
const error = ref<string | null>(null)

const canSubmit = computed(() => password.value.length > 0 && phrase.value === 'DELETE')

function open() {
  confirming.value = true
}

function cancel() {
  confirming.value = false
  password.value = ''
  phrase.value = ''
  error.value = null
}

async function submit() {
  if (!canSubmit.value) return

  try {
    await useAsyncAction(
      { loading, error },
      () => accountService.deleteAccount(password.value),
      { fallbackMessage: 'Could not delete the account' }
    )
  } catch {
    // `useAsyncAction` has put the server's message in `error`; the account
    // still exists, so stay on the screen rather than navigating away.
    return
  }

  // The account is gone, so the session is meaningless. `logout` is still the
  // right call: it clears the local state synchronously and its server request
  // never rejects, so the `401` it now gets from a revoked session changes
  // nothing here.
  await authStore.logout()
  router.push('/login')
}
</script>
