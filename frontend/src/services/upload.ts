import { authService } from './auth'
import { ApiError } from './api'
import type { FieldType } from '@/stores/formFields.store'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api'

export interface ExtractedField {
  type: FieldType
  name: string
  label: string
  required: boolean
  position: {
    x: number
    y: number
    width: number
    height: number
    page: number
  }
  options?: string[]
  validation?: {
    minLength?: number
    maxLength?: number
    pattern?: string
  }
}

export interface UploadResponse {
  url: string
  filename: string
  size: number
  fields: ExtractedField[]
}

export interface UploadProgress {
  loaded: number
  total: number
  percentage: number
}

export const uploadService = {
  async uploadPDF(
    file: File,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<UploadResponse> {
    if (file.type !== 'application/pdf') {
      throw new ApiError(400, 'Only PDF files are allowed')
    }

    const maxSize = 10 * 1024 * 1024
    if (file.size > maxSize) {
      throw new ApiError(400, 'File size must be less than 10MB')
    }

    const formData = new FormData()
    formData.append('pdf', file)

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()

      if (onProgress) {
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            onProgress({
              loaded: e.loaded,
              total: e.total,
              percentage: Math.round((e.loaded / e.total) * 100)
            })
          }
        })
      }

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const response = JSON.parse(xhr.responseText)
            resolve(response)
          } catch {
            reject(new ApiError(xhr.status, 'Invalid response from server'))
          }
        } else {
          try {
            const errorData = JSON.parse(xhr.responseText)
            reject(new ApiError(xhr.status, errorData.error || 'Upload failed', errorData.details))
          } catch {
            reject(new ApiError(xhr.status, 'Upload failed'))
          }
        }
      })

      xhr.addEventListener('error', () => {
        reject(new ApiError(0, 'Network error during upload'))
      })

      xhr.addEventListener('abort', () => {
        reject(new ApiError(0, 'Upload aborted'))
      })

      xhr.open('POST', `${API_URL}/upload`)

      // One of the two paths that do not go through `request()` in api.ts — the
      // other is `api.download`. It reads the same in-memory access token, so a
      // session refreshed elsewhere is picked up here; what it does not do is
      // refresh and retry on a 401, because an upload body is a stream that
      // cannot be replayed. The caller sees the 401.
      const token = authService.getToken()
      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`)
      }

      // Cross-origin request, so the refresh cookie needs this to travel at all.
      xhr.withCredentials = true

      xhr.send(formData)
    })
  }
}
