import { describe, it, expect, vi, beforeEach } from 'vitest'
import { apiKeyService } from './apiKeys'
import { api } from './api'

vi.mock('./api')

/**
 * The API keys service
 * ([`features/0021`](../../../features/0021-api-keys-screen.md)).
 *
 * The assertions that matter here are the negative ones. This service talks to
 * the **session-authenticated** router and never to `/api/v1` — a credential
 * that could mint more credentials would turn one leaked key into permanent
 * access — and it has no way to ask for a secret a second time, because the
 * server keeps only a hash of it.
 */
describe('apiKeyService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists the organization keys from the session API, sending no organization', async () => {
    vi.mocked(api.get).mockResolvedValue({ apiKeys: [] } as never)

    await apiKeyService.list()

    // The organization comes from the caller's membership, server-side. A
    // client-supplied one would be an authorization decision made in a browser.
    expect(api.get).toHaveBeenCalledWith('/organizations/api-keys')
  })

  it('creates a key with a name and returns the secret it was given once', async () => {
    vi.mocked(api.post).mockResolvedValue({
      apiKey: {
        id: 'k1',
        name: 'Zapier',
        prefix: 'a1b2c3d4e5f6',
        lastUsedAt: null,
        revokedAt: null,
        createdAt: '2026-09-01T10:00:00.000Z',
        secret: 'vpk_a1b2c3d4e5f6_thesecret'
      }
    } as never)

    const created = await apiKeyService.create('Zapier')

    expect(api.post).toHaveBeenCalledWith('/organizations/api-keys', { name: 'Zapier' })
    expect(created.secret).toBe('vpk_a1b2c3d4e5f6_thesecret')
  })

  it('revokes by id', async () => {
    vi.mocked(api.delete).mockResolvedValue(undefined as never)

    await apiKeyService.revoke('k1')

    expect(api.delete).toHaveBeenCalledWith('/organizations/api-keys/k1')
  })

  it('exposes no way to read a secret back', () => {
    // `GET /api/organizations/api-keys` selects no `hash` and there is no
    // reveal endpoint: the column holds `sha256(secret)` precisely so that a
    // leaked database is not a set of live credentials (features/0019). If a
    // `reveal()` ever appears here, that guarantee is gone.
    expect(Object.keys(apiKeyService).sort()).toEqual(['create', 'list', 'revoke'])
  })
})
