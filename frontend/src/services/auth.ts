import { api } from './api'

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

export const authService = {
  async register(email: string, password: string, name?: string): Promise<AuthResponse> {
    const response = await api.post<AuthResponse>('/auth/register', { email, password, name })
    localStorage.setItem('token', response.token)
    return response
  },

  async login(email: string, password: string): Promise<AuthResponse> {
    const response = await api.post<AuthResponse>('/auth/login', { email, password })
    localStorage.setItem('token', response.token)
    return response
  },

  async me(): Promise<User> {
    const response = await api.get<MeResponse>('/auth/me')
    return response.user
  },

  logout(): void {
    localStorage.removeItem('token')
  },

  isAuthenticated(): boolean {
    return !!localStorage.getItem('token')
  },

  getToken(): string | null {
    return localStorage.getItem('token')
  }
}
