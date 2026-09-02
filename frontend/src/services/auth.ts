import { api, setAccessToken, getAccessToken, refreshSession } from './api'

export interface User {
  id: string
  email: string
  name: string | null
  createdAt: string
}

interface AuthResponse {
  user: User
  token: string
}

interface MeResponse {
  user: User
}

/**
 * Whether this deployment accepts new accounts from anybody, or only from
 * someone holding the private beta's signup code (features/0033).
 */
export type RegistrationMode = 'open' | 'invite_only'

interface RegistrationResponse {
  mode: RegistrationMode
}

export const authService = {
  async register(
    email: string,
    password: string,
    name?: string,
    code?: string
  ): Promise<AuthResponse> {
    const response = await api.post<AuthResponse>('/auth/register', {
      email,
      password,
      name,
      code
    })
    setAccessToken(response.token)
    return response
  },

  /**
   * Reads the registration mode so the signup screen can draw the code field —
   * or not — before anybody has typed anything.
   *
   * Unauthenticated, and it returns the mode alone: never the code, its length,
   * or whether one is configured.
   */
  async getRegistrationMode(): Promise<RegistrationMode> {
    const response = await api.get<RegistrationResponse>('/auth/registration')
    return response.mode
  },

  async login(email: string, password: string): Promise<AuthResponse> {
    const response = await api.post<AuthResponse>('/auth/login', { email, password })
    setAccessToken(response.token)
    return response
  },

  async me(): Promise<User> {
    const response = await api.get<MeResponse>('/auth/me')
    return response.user
  },

  /**
   * Logging out is a server-side act now, not a client-side one.
   *
   * It used to be `localStorage.removeItem('token')`, which ended nothing: the
   * token stayed valid for the rest of its seven days, so anyone holding a copy
   * kept full access. This revokes the refresh-token family, so every token
   * descended from that login stops working.
   *
   * The local state is cleared whatever the request does. A network failure must
   * not leave someone looking logged in on a shared machine.
   */
  async logout(): Promise<void> {
    try {
      await api.post('/auth/logout', {})
    } catch {
      // Deliberately swallowed — see above.
    } finally {
      setAccessToken(null)
    }
  },

  /**
   * Recovers a session after a page load.
   *
   * The access token lives in memory, so a reload always starts without one.
   * The refresh cookie survives, so this exchanges it for a fresh access token.
   * Returns false when there is no usable session — which is the honest answer
   * to "is this person logged in", and the only way to get it now that nothing
   * readable by JavaScript says so.
   */
  async bootstrapSession(): Promise<boolean> {
    if (getAccessToken()) return true
    return refreshSession()
  },

  getToken(): string | null {
    return getAccessToken()
  }
}
