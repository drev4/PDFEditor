import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useWebhooksStore } from './webhooks.store'
import {
  webhookService,
  type WebhookEndpoint,
  type CreatedWebhookEndpoint,
  type WebhookDelivery
} from '../services/webhooks'
import { ApiError } from '../services/api'

vi.mock('../services/webhooks')

const active: WebhookEndpoint = {
  id: 'w1',
  url: 'https://example.com/hook',
  events: ['response.created'],
  disabledAt: null,
  lastError: null,
  consecutiveFailures: 0,
  createdAt: '2026-08-01T09:00:00.000Z'
}

const disabled: WebhookEndpoint = {
  ...active,
  id: 'w2',
  url: 'https://broken.example.com/hook',
  disabledAt: '2026-08-20T09:00:00.000Z',
  lastError: 'connect ETIMEDOUT',
  consecutiveFailures: 10
}

const created: CreatedWebhookEndpoint = {
  ...active,
  id: 'w3',
  url: 'https://new.example.com/hook',
  secret: 'whsec_thesecret'
}

const delivery: WebhookDelivery = {
  id: 'd1',
  eventId: 'evt_1',
  eventType: 'response.created',
  attempt: 1,
  status: 500,
  durationMs: 42,
  succeeded: false,
  error: 'HTTP 500',
  createdAt: '2026-08-20T09:00:00.000Z'
}

describe('Webhooks store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(webhookService.list).mockResolvedValue({
      webhooks: [active, disabled],
      deliverable: true
    })
  })

  it('loads the endpoints and whether the deployment can deliver', async () => {
    vi.mocked(webhookService.list).mockResolvedValue({
      webhooks: [active],
      deliverable: false
    })
    const store = useWebhooksStore()

    await store.load()

    expect(store.endpoints).toHaveLength(1)
    // The list arrives even when nothing can be delivered — seeing what is
    // configured is how somebody diagnoses why nothing is arriving.
    expect(store.deliverable).toBe(false)
  })

  it('assumes the deployment works until the server says otherwise', () => {
    const store = useWebhooksStore()

    // Otherwise the screen accuses a working installation of being broken in
    // the moment before the first response arrives.
    expect(store.deliverable).toBe(true)
  })

  it('holds the created secret so it survives the panel unmounting', async () => {
    vi.mocked(webhookService.create).mockResolvedValue(created)
    const store = useWebhooksStore()

    await store.create('https://new.example.com/hook')

    expect(store.lastCreatedEndpoint?.secret).toBe('whsec_thesecret')
    expect(store.endpoints[0]?.id).toBe('w3')
  })

  it('forgets the secret when dismissed', async () => {
    vi.mocked(webhookService.create).mockResolvedValue(created)
    const store = useWebhooksStore()
    await store.create('https://new.example.com/hook')

    store.dismissCreatedEndpoint()

    expect(store.lastCreatedEndpoint).toBeNull()
  })

  it('re-throws a 402 so the caller can tell a plan limit from a failure', async () => {
    vi.mocked(webhookService.create).mockRejectedValue(
      new ApiError(402, 'Your plan does not include API access')
    )
    const store = useWebhooksStore()

    await expect(store.create('https://new.example.com/hook')).rejects.toBeInstanceOf(ApiError)
    expect(store.lastCreatedEndpoint).toBeNull()
  })

  it('surfaces a 503 as an error rather than swallowing it', async () => {
    vi.mocked(webhookService.create).mockRejectedValue(
      new ApiError(503, 'Webhooks require the job queue')
    )
    const store = useWebhooksStore()

    await expect(store.create('https://new.example.com/hook')).rejects.toBeInstanceOf(ApiError)
    // A deployment that cannot deliver is a different thing from a plan that
    // does not include delivery, and the message is the server's.
    expect(store.error).toBe('Webhooks require the job queue')
  })

  it('re-reads the list after re-enabling rather than patching the row', async () => {
    vi.mocked(webhookService.reenable).mockResolvedValue({ ...disabled, disabledAt: null })
    const store = useWebhooksStore()
    await store.load()

    vi.mocked(webhookService.list).mockResolvedValue({
      webhooks: [active, { ...disabled, disabledAt: null, lastError: null, consecutiveFailures: 0 }],
      deliverable: true
    })
    await store.reenable('w2')

    // The server may refuse to revive it — a stored URL that now resolves
    // inside the network is a 400 — so the row on screen is the server's.
    expect(store.endpoints[1]?.disabledAt).toBeNull()
    expect(webhookService.reenable).toHaveBeenCalledWith('w2')
  })

  it('drops the endpoint and its open history when it is deleted', async () => {
    vi.mocked(webhookService.remove).mockResolvedValue(undefined)
    vi.mocked(webhookService.deliveries).mockResolvedValue([delivery])
    const store = useWebhooksStore()
    await store.load()
    await store.openDeliveries('w1')

    await store.remove('w1')

    expect(store.endpoints.map(e => e.id)).toEqual(['w2'])
    // The history cascades server-side; leaving it on screen would show rows
    // for an endpoint that no longer exists.
    expect(store.openDeliveriesFor).toBeNull()
    expect(store.deliveries).toEqual([])
  })

  it('opens one history at a time', async () => {
    vi.mocked(webhookService.deliveries).mockResolvedValue([delivery])
    const store = useWebhooksStore()

    await store.openDeliveries('w1')
    expect(store.openDeliveriesFor).toBe('w1')
    expect(store.deliveries).toHaveLength(1)

    await store.openDeliveries('w2')
    expect(store.openDeliveriesFor).toBe('w2')
    expect(webhookService.deliveries).toHaveBeenLastCalledWith('w2')
  })

  it('writes the secret to no browser storage', async () => {
    vi.mocked(webhookService.create).mockResolvedValue(created)
    const store = useWebhooksStore()

    await store.create('https://new.example.com/hook')

    const stored = Object.keys(localStorage).map(key => localStorage.getItem(key) ?? '')
    expect(stored.some(value => value.includes(created.secret))).toBe(false)
  })
})
