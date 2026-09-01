import { defineStore } from 'pinia'
import { ref } from 'vue'
import { apiKeyService, type ApiKey, type CreatedApiKey } from '../services/apiKeys'
import { useAsyncAction } from '../composables/useAsyncAction'

/**
 * The organization's API keys
 * ([`features/0021`](../../../features/0021-api-keys-screen.md)).
 *
 * A store rather than component state for one reason, and it is `lastCreatedKey`:
 * the secret is returned exactly once and the server cannot reproduce it, so it
 * has to survive anything that unmounts the panel showing it. This is the same
 * decision, for the same reason, as `lastCreatedInvitation` in
 * `organization.store.ts`.
 *
 * **Nothing here is persisted.** `persist: false` is not the default being taken
 * silently — it is the point: a secret written to `localStorage` is readable by
 * any script on this origin and would outlive the tab, which is exactly what
 * hashing it server-side was meant to prevent.
 */
export const useApiKeysStore = defineStore(
  'apiKeys',
  () => {
    const keys = ref<ApiKey[]>([])
    const loading = ref(false)
    const error = ref<string | null>(null)

    /**
     * The key just created, held until the customer dismisses it.
     *
     * This is the only copy of `secret` that will ever exist on this side. If it
     * is lost, the key still exists and is still billed for, and the only thing
     * left to do with it is revoke it.
     */
    const lastCreatedKey = ref<CreatedApiKey | null>(null)

    async function load() {
      return useAsyncAction(
        { loading, error },
        async () => {
          keys.value = await apiKeyService.list()
        },
        { fallbackMessage: 'Could not load the API keys' }
      )
    }

    /**
     * Mints a key.
     *
     * Re-throws, like every `useAsyncAction` call: the caller has to be able to
     * tell a `402` (the plan does not include the API) from a `403` (you are not
     * an owner or admin) and from everything else, and it does that on the
     * status rather than on the message.
     */
    async function create(name: string) {
      return useAsyncAction(
        { loading, error },
        async () => {
          const created = await apiKeyService.create(name)
          lastCreatedKey.value = created
          // Prepended rather than refetched: the list is ordered newest first
          // server-side, and a refetch here would race the panel that is about
          // to render the secret.
          keys.value = [created, ...keys.value]
          return created
        },
        { fallbackMessage: 'Could not create the API key' }
      )
    }

    /**
     * Revokes a key and re-reads the list.
     *
     * The row does not disappear — the server keeps it with `revokedAt` set, and
     * this screen keeps showing it. Re-reading rather than patching the local
     * row means the timestamp on screen is the server's, which is the one that
     * says when access actually stopped.
     */
    async function revoke(id: string) {
      return useAsyncAction(
        { loading, error },
        async () => {
          await apiKeyService.revoke(id)
          keys.value = await apiKeyService.list()
        },
        { fallbackMessage: 'Could not revoke the API key' }
      )
    }

    /** Forgets the secret. After this it is unrecoverable, which is the design. */
    function dismissCreatedKey() {
      lastCreatedKey.value = null
    }

    return {
      keys,
      loading,
      error,
      lastCreatedKey,
      load,
      create,
      revoke,
      dismissCreatedKey
    }
  },
  { persist: false }
)
