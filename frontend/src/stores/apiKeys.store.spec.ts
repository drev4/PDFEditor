import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useApiKeysStore } from './apiKeys.store'
import { apiKeyService, type ApiKey, type CreatedApiKey } from '../services/apiKeys'
import { ApiError } from '../services/api'

vi.mock('../services/apiKeys')

const liveKey: ApiKey = {
  id: 'k1',
  name: 'Zapier',
  prefix: 'a1b2c3d4e5f6',
  lastUsedAt: '2026-09-01T09:00:00.000Z',
  revokedAt: null,
  createdAt: '2026-08-01T09:00:00.000Z'
}

const revokedKey: ApiKey = {
  ...liveKey,
  id: 'k2',
  name: 'An old integration',
  lastUsedAt: null,
  revokedAt: '2026-08-20T09:00:00.000Z'
}

const created: CreatedApiKey = {
  id: 'k3',
  name: 'Our CRM',
  prefix: 'ffffffffffff',
  lastUsedAt: null,
  revokedAt: null,
  createdAt: '2026-09-01T10:00:00.000Z',
  secret: 'vpk_ffffffffffff_thesecret'
}

describe('API keys store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(apiKeyService.list).mockResolvedValue([liveKey, revokedKey])
  })

  it('loads the keys, revoked ones included', async () => {
    const store = useApiKeysStore()

    await store.load()

    // A revoked key is not deleted, and hiding it here would throw away the
    // only record of when access stopped - the question asked once an
    // integration breaks.
    expect(store.keys.map(k => k.id)).toEqual(['k1', 'k2'])
  })

  it('holds the created secret so it survives the panel unmounting', async () => {
    vi.mocked(apiKeyService.create).mockResolvedValue(created)
    const store = useApiKeysStore()

    await store.create('Our CRM')

    // This is the only copy that will ever exist on this side: the server keeps
    // `sha256(secret)` and cannot reproduce it. It lives in the store for the
    // same reason `lastCreatedInvitation` does.
    expect(store.lastCreatedKey?.secret).toBe('vpk_ffffffffffff_thesecret')
    expect(store.keys[0]?.id).toBe('k3')
  })

  it('forgets the secret when it is dismissed, and does not fetch it again', async () => {
    vi.mocked(apiKeyService.create).mockResolvedValue(created)
    const store = useApiKeysStore()
    await store.create('Our CRM')

    store.dismissCreatedKey()

    expect(store.lastCreatedKey).toBeNull()
    // Nothing in the service can bring it back; the key stays listed without it.
    expect(store.keys[0]?.id).toBe('k3')
  })

  it('re-throws a 402 so the caller can tell a plan limit from a failure', async () => {
    vi.mocked(apiKeyService.create).mockRejectedValue(
      new ApiError(402, 'Your plan does not include API access')
    )
    const store = useApiKeysStore()

    // `useAsyncAction` re-throws on purpose: the panel branches on the status,
    // never on the message, because 402 (plan) and 403 (permission) lead to
    // different places (features/0012).
    await expect(store.create('Our CRM')).rejects.toBeInstanceOf(ApiError)
    expect(store.lastCreatedKey).toBeNull()
    expect(store.error).toBe('Your plan does not include API access')
  })

  it('re-reads the list after revoking rather than patching the row', async () => {
    vi.mocked(apiKeyService.revoke).mockResolvedValue(undefined)
    const store = useApiKeysStore()
    await store.load()

    vi.mocked(apiKeyService.list).mockResolvedValue([
      { ...liveKey, revokedAt: '2026-09-01T11:00:00.000Z' },
      revokedKey
    ])
    await store.revoke('k1')

    // The timestamp on screen is the server's, which is the one that says when
    // access actually stopped.
    expect(store.keys[0]?.revokedAt).toBe('2026-09-01T11:00:00.000Z')
    expect(apiKeyService.revoke).toHaveBeenCalledWith('k1')
  })

  it('writes the secret to no browser storage', async () => {
    vi.mocked(apiKeyService.create).mockResolvedValue(created)
    const store = useApiKeysStore()

    await store.create('Our CRM')

    // A secret in `localStorage` is readable by any script on this origin and
    // outlives the tab, which is exactly what hashing it server-side was for.
    // The store declares `persist: false`; this asserts the effect rather than
    // the declaration.
    const stored = Object.keys(localStorage).map(key => localStorage.getItem(key) ?? '')
    expect(stored.some(value => value.includes(created.secret))).toBe(false)
  })
})
