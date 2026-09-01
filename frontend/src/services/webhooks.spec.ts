import { describe, it, expect, vi, beforeEach } from 'vitest'
import { webhookService } from './webhooks'
import { api } from './api'

vi.mock('./api')

/**
 * The webhooks service
 * ([`features/0022`](../../../features/0022-webhooks-screen.md)).
 *
 * Everything here is the session API, deliberately: an API key that could add a
 * new place for customer data to be sent would turn one leaked credential into
 * an exfiltration channel.
 */
describe('webhookService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists endpoints together with whether the deployment can deliver', async () => {
    vi.mocked(api.get).mockResolvedValue({ webhooks: [], deliverable: false } as never)

    const result = await webhookService.list()

    expect(api.get).toHaveBeenCalledWith('/organizations/webhooks')
    // The flag comes with the list rather than from a second call: the list is
    // returned even when nothing can be delivered, on purpose.
    expect(result.deliverable).toBe(false)
  })

  it('creates an endpoint with a url and returns the secret it was given once', async () => {
    vi.mocked(api.post).mockResolvedValue({
      webhook: {
        id: 'w1',
        url: 'https://example.com/hook',
        events: ['response.created'],
        disabledAt: null,
        lastError: null,
        consecutiveFailures: 0,
        createdAt: '2026-09-01T10:00:00.000Z',
        secret: 'whsec_thesecret'
      }
    } as never)

    const created = await webhookService.create('https://example.com/hook')

    // No events array: only one exists, and sending a value the backend would
    // reject is how a picker for imaginary events gets built by accident.
    expect(api.post).toHaveBeenCalledWith('/organizations/webhooks', {
      url: 'https://example.com/hook'
    })
    expect(created.secret).toBe('whsec_thesecret')
  })

  it('re-enables by id and sends no fields', async () => {
    vi.mocked(api.patch).mockResolvedValue({ webhook: { id: 'w1' } } as never)

    await webhookService.reenable('w1')

    // An empty body, and the server ignores one anyway. Re-pointing an endpoint
    // under an existing secret is a different feature.
    expect(api.patch).toHaveBeenCalledWith('/organizations/webhooks/w1', {})
  })

  it('deletes by id', async () => {
    vi.mocked(api.delete).mockResolvedValue(undefined as never)

    await webhookService.remove('w1')

    expect(api.delete).toHaveBeenCalledWith('/organizations/webhooks/w1')
  })

  it('reads the delivery log from the session API, not from /api/v1', async () => {
    vi.mocked(api.get).mockResolvedValue({ deliveries: [] } as never)

    await webhookService.deliveries('w1')

    // `/api/v1/webhooks/deliveries` needs an API key. Asking a customer to mint
    // one in order to see whether their webhook works is what this avoids.
    expect(api.get).toHaveBeenCalledWith('/organizations/webhooks/w1/deliveries')
  })

  it('exposes no way to change an endpoint URL or read a secret back', () => {
    expect(Object.keys(webhookService).sort()).toEqual([
      'create',
      'deliveries',
      'list',
      'reenable',
      'remove'
    ])
  })
})
