const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api'

/**
 * The access token lives here, in a module variable, and nowhere else.
 *
 * Not `localStorage` (finding S4): anything readable by JavaScript is readable
 * by an XSS, and a token in `localStorage` also survives the tab, so a single
 * successful injection used to yield a week of account access. In memory it dies
 * with the page, and it is short-lived anyway — the refresh token, which is the
 * long-lived credential, is in an `httpOnly` cookie the page cannot read at all.
 *
 * The cost is that a reload starts with no access token. `bootstrapSession()`
 * in `services/auth.ts` is what deals with that.
 */
let accessToken: string | null = null

export function setAccessToken(token: string | null): void {
  accessToken = token
}

export function getAccessToken(): string | null {
  return accessToken
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  body?: unknown
  headers?: Record<string, string>
  /** Internal: set when retrying after a refresh, so one 401 cannot loop. */
  isRetry?: boolean
}

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
    /**
     * The API's own id for the request that failed, read from the
     * `X-Request-Id` response header (features/0034).
     *
     * It is what lets a browser error report be joined to the server log line
     * that explains it. `undefined` when the response carried no header — a
     * network failure, or a response from something that is not this API.
     *
     * The header is only readable cross-origin because `app.ts` names it in
     * the CORS `exposedHeaders`; without that it is on the wire and invisible
     * to script.
     */
    public requestId?: string
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * A single in-flight refresh, shared by every caller.
 *
 * Without this, a page that fires several requests at once answers a burst of
 * 401s with a burst of refreshes — and because refresh tokens rotate, each one
 * invalidates the one before it. The server sees the second as a replay, kills
 * the whole family, and the user is logged out by the very mechanism meant to
 * keep them signed in.
 */
let refreshInFlight: Promise<boolean> | null = null

function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include'
    })
      .then(async response => {
        if (!response.ok) {
          setAccessToken(null)
          return false
        }
        const data = await response.json()
        setAccessToken(data.token)
        return true
      })
      .catch(() => {
        setAccessToken(null)
        return false
      })
      .finally(() => {
        refreshInFlight = null
      })
  }

  return refreshInFlight
}

/** Exposed so `services/auth.ts` can drive the same single-flight on boot. */
export { refreshSession }

function authHeaders(headers: Record<string, string>): Record<string, string> {
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`
  return headers
}

async function request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, headers = {}, isRetry = false } = options

  authHeaders(headers)

  if (body) {
    headers['Content-Type'] = 'application/json'
  }

  const response = await fetch(`${API_URL}${endpoint}`, {
    method,
    headers,
    // Carries the refresh cookie. Its Path scopes it to /api/auth, so ordinary
    // API calls do not actually send it — but the flag has to be set for the
    // browser to accept or send it at all on a cross-origin request.
    credentials: 'include',
    body: body ? JSON.stringify(body) : undefined
  })

  if (response.status === 401 && !isRetry && !endpoint.startsWith('/auth/refresh')) {
    // The access token expired. Get a new one and replay the request once, so a
    // short token lifetime is invisible to the user rather than a logout every
    // fifteen minutes.
    if (await refreshSession()) {
      return request<T>(endpoint, { ...options, isRetry: true })
    }
  }

  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    if (response.status === 401) setAccessToken(null)
    throw new ApiError(
      response.status,
      (data as any).error || 'Request failed',
      (data as any).details,
      // Optional chaining because this runs while *constructing an error*.
      // A throw here would replace the real failure with a TypeError and lose
      // the reason entirely — the same rule the tracking modules follow.
      response.headers?.get('X-Request-Id') ?? undefined
    )
  }

  return data as T
}

export const api = {
  get: <T>(endpoint: string) => request<T>(endpoint),
  post: <T>(endpoint: string, body: unknown) => request<T>(endpoint, { method: 'POST', body }),
  put: <T>(endpoint: string, body: unknown) => request<T>(endpoint, { method: 'PUT', body }),
  patch: <T>(endpoint: string, body: unknown) => request<T>(endpoint, { method: 'PATCH', body }),
  /**
   * The body is optional and almost never used. `DELETE /api/account` is the
   * one caller that sends one, because deleting an account re-verifies the
   * password and that is a credential, not something to put in a URL.
   */
  delete: <T>(endpoint: string, body?: unknown) =>
    request<T>(endpoint, body === undefined ? { method: 'DELETE' } : { method: 'DELETE', body }),

  /**
   * Binary responses cannot go through `request()`, which parses JSON — so the
   * refresh-and-retry has to be repeated here rather than inherited. This is one
   * of the two call sites that bypass `request()`; the other is the
   * `XMLHttpRequest` in `services/upload.ts`.
   */
  async download(endpoint: string, isRetry = false): Promise<Blob> {
    const response = await fetch(`${API_URL}${endpoint}`, {
      headers: authHeaders({}),
      credentials: 'include'
    })

    if (response.status === 401 && !isRetry && (await refreshSession())) {
      return api.download(endpoint, true)
    }

    if (!response.ok) {
      const data = await response.json().catch(() => ({ error: 'Download failed' }))
      throw new ApiError(
        response.status,
        (data as any).error || 'Download failed',
        undefined,
        // See the note on the same call in `request()` above.
        response.headers?.get('X-Request-Id') ?? undefined
      )
    }

    return await response.blob()
  }
}

export { ApiError }
