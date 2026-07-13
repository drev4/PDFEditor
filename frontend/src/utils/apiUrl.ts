const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api'

export function buildApiUrl(path: string): string {
  if (path.startsWith('http')) return path
  if (path.startsWith('/')) return `${API_URL}${path}`
  return `${API_URL}/${path}`
}
