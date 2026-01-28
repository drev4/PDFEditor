import { authService } from './auth'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api'

export interface UploadResponse {
  url: string
  filename: string
  size: number
}

export interface UploadProgress {
  loaded: number
  total: number
  percentage: number
}

class UploadError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown
  ) {
    super(message)
    this.name = 'UploadError'
  }
}

export const uploadService = {
  /**
   * Upload a PDF file to the server
   * @param file - The PDF file to upload
   * @param onProgress - Optional callback for upload progress
   * @returns Promise with upload response
   */
  async uploadPDF(
    file: File,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<UploadResponse> {
    // Validate file type
    if (file.type !== 'application/pdf') {
      throw new UploadError(400, 'Only PDF files are allowed')
    }

    // Validate file size (10MB)
    const maxSize = 10 * 1024 * 1024
    if (file.size > maxSize) {
      throw new UploadError(400, 'File size must be less than 10MB')
    }

    const formData = new FormData()
    formData.append('pdf', file)

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()

      // Track upload progress
      if (onProgress) {
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const progress: UploadProgress = {
              loaded: e.loaded,
              total: e.total,
              percentage: Math.round((e.loaded / e.total) * 100)
            }
            onProgress(progress)
          }
        })
      }

      // Handle completion
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const response = JSON.parse(xhr.responseText)
            resolve(response)
          } catch (e) {
            reject(new UploadError(xhr.status, 'Invalid response from server'))
          }
        } else {
          try {
            const errorData = JSON.parse(xhr.responseText)
            reject(new UploadError(xhr.status, errorData.error || 'Upload failed', errorData.details))
          } catch (e) {
            reject(new UploadError(xhr.status, 'Upload failed'))
          }
        }
      })

      // Handle errors
      xhr.addEventListener('error', () => {
        reject(new UploadError(0, 'Network error during upload'))
      })

      xhr.addEventListener('abort', () => {
        reject(new UploadError(0, 'Upload aborted'))
      })

      // Open and send request
      xhr.open('POST', `${API_URL}/upload`)

      // Add auth token
      const token = authService.getToken()
      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`)
      }

      xhr.send(formData)
    })
  }
}

export { UploadError }
