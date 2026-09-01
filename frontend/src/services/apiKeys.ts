import { api } from './api'

/**
 * API keys, as the management screen sees them
 * ([`features/0019`](../../../features/0019-api-keys-and-read-only-public-api.md)
 * built them, [`features/0021`](../../../features/0021-api-keys-screen.md) made
 * them reachable).
 *
 * These endpoints live on `/api/organizations`, the session-authenticated
 * router, and deliberately not on `/api/v1`: a credential that could mint more
 * credentials would turn one leaked key into permanent access. So this service
 * is called by somebody signed in and looking at a screen, which is the only way
 * a key is ever created.
 */

/**
 * A key as it is listed.
 *
 * **There is no secret here and there cannot be.** The server stores
 * `sha256(secret)` and `GET /api/organizations/api-keys` selects no `hash`, so
 * nothing can return the value a second time — see `ApiKeySecret` for the one
 * moment it exists.
 */
export interface ApiKey {
  id: string
  name: string
  /**
   * The first segment of the key, which is public and identifies it in a list.
   * The full credential is `vpk_<prefix>_<secret>`; this is the middle part.
   */
  prefix: string
  /**
   * When the key was last used, or `null` if it never has been.
   *
   * **Deliberately stale by up to a minute** — `touchApiKey` throttles the
   * write, because a public API is mostly reads and updating this row on every
   * one of them would turn each read into a write. It answers *is this
   * credential still in use, or has it been forgotten?* and nothing finer, so
   * nothing should render it as live activity.
   */
  lastUsedAt: string | null
  /**
   * When the key was revoked, or `null` while it works.
   *
   * A revoked key is **not deleted** — the row and this timestamp are the only
   * record of when access stopped, which is the question asked after an
   * integration breaks. The server stamps it once and never re-stamps it.
   */
  revokedAt: string | null
  createdAt: string
}

/**
 * A newly minted key, with the one and only copy of its secret.
 *
 * `secret` is returned by `POST /api/organizations/api-keys` and **by nothing
 * else, ever**. There is no reveal endpoint, and there must never be one: the
 * column holds a hash precisely so that a leaked database is not a set of live
 * credentials. A UI that loses this value has created a key the customer can
 * only revoke.
 */
export interface CreatedApiKey extends ApiKey {
  secret: string
}

export const apiKeyService = {
  async list(): Promise<ApiKey[]> {
    const { apiKeys } = await api.get<{ apiKeys: ApiKey[] }>('/organizations/api-keys')
    return apiKeys
  },

  async create(name: string): Promise<CreatedApiKey> {
    const { apiKey } = await api.post<{ apiKey: CreatedApiKey }>('/organizations/api-keys', {
      name
    })
    return apiKey
  },

  /**
   * Revokes a key. The row stays, with `revokedAt` set.
   *
   * `DELETE` is the verb the route uses; what it does is a revocation. Revoking
   * an already-revoked key is not an error server-side, and the timestamp is not
   * rewritten.
   */
  async revoke(id: string): Promise<void> {
    await api.delete(`/organizations/api-keys/${id}`)
  }
}
