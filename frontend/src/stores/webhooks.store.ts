import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  webhookService,
  type WebhookEndpoint,
  type CreatedWebhookEndpoint,
  type WebhookDelivery
} from '../services/webhooks'
import { useAsyncAction } from '../composables/useAsyncAction'

/**
 * The organization's webhook endpoints
 * ([`features/0022`](../../../features/0022-webhooks-screen.md)).
 *
 * A store for the same reason `apiKeys.store.ts` is one: `lastCreatedEndpoint`
 * holds a secret the server will not return again, so it must survive anything
 * that unmounts the panel showing it. `persist: false` for the same reason too —
 * a signing secret in `localStorage` is readable by any script on this origin.
 */
export const useWebhooksStore = defineStore(
  'webhooks',
  () => {
    const endpoints = ref<WebhookEndpoint[]>([])

    /**
     * Whether this deployment can deliver at all — it needs `REDIS_URL` and
     * `WEBHOOK_SIGNING_KEY`.
     *
     * Starts `true` so the screen does not accuse a working deployment of being
     * broken in the moment before the list arrives. It is the server's answer
     * that matters, and it arrives with the list.
     */
    const deliverable = ref(true)

    const loading = ref(false)
    const error = ref<string | null>(null)

    /** The endpoint just created, held until dismissed. The only copy. */
    const lastCreatedEndpoint = ref<CreatedWebhookEndpoint | null>(null)

    /** Which endpoint's history is open, and the history itself. */
    const openDeliveriesFor = ref<string | null>(null)
    const deliveries = ref<WebhookDelivery[]>([])

    async function load() {
      return useAsyncAction(
        { loading, error },
        async () => {
          const result = await webhookService.list()
          endpoints.value = result.webhooks
          deliverable.value = result.deliverable
        },
        { fallbackMessage: 'Could not load the webhook endpoints' }
      )
    }

    /**
     * Configures an endpoint.
     *
     * Re-throws, so the caller can tell the three refusals apart on their status
     * — `503` the deployment, `402` the plan, `403` the person — which is the
     * whole point of them being different codes.
     */
    async function create(url: string) {
      return useAsyncAction(
        { loading, error },
        async () => {
          const created = await webhookService.create(url)
          lastCreatedEndpoint.value = created
          endpoints.value = [created, ...endpoints.value]
          return created
        },
        { fallbackMessage: 'Could not create the webhook endpoint' }
      )
    }

    /**
     * Switches a disabled endpoint back on.
     *
     * Re-reads the list rather than patching the row: the server may have
     * refused to revive it — a stored URL that now resolves inside the network
     * is a `400` — and the row on screen should be the server's, not a guess.
     */
    async function reenable(id: string) {
      return useAsyncAction(
        { loading, error },
        async () => {
          await webhookService.reenable(id)
          const result = await webhookService.list()
          endpoints.value = result.webhooks
          deliverable.value = result.deliverable
        },
        { fallbackMessage: 'Could not re-enable the endpoint' }
      )
    }

    /**
     * Deletes an endpoint and, with it, its delivery history — the rows cascade.
     * The caller is responsible for having asked first.
     */
    async function remove(id: string) {
      return useAsyncAction(
        { loading, error },
        async () => {
          await webhookService.remove(id)
          endpoints.value = endpoints.value.filter(endpoint => endpoint.id !== id)
          if (openDeliveriesFor.value === id) closeDeliveries()
        },
        { fallbackMessage: 'Could not delete the endpoint' }
      )
    }

    /** Opens one endpoint's history, closing whichever was open. */
    async function openDeliveries(id: string) {
      openDeliveriesFor.value = id
      deliveries.value = []

      return useAsyncAction(
        { loading, error },
        async () => {
          deliveries.value = await webhookService.deliveries(id)
        },
        { fallbackMessage: 'Could not load the delivery history' }
      )
    }

    function closeDeliveries() {
      openDeliveriesFor.value = null
      deliveries.value = []
    }

    /** Forgets the secret. After this it is unrecoverable, which is the design. */
    function dismissCreatedEndpoint() {
      lastCreatedEndpoint.value = null
    }

    return {
      endpoints,
      deliverable,
      loading,
      error,
      lastCreatedEndpoint,
      openDeliveriesFor,
      deliveries,
      load,
      create,
      reenable,
      remove,
      openDeliveries,
      closeDeliveries,
      dismissCreatedEndpoint
    }
  },
  { persist: false }
)
