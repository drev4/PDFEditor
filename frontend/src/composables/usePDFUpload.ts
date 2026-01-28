import { ref } from 'vue'
import { uploadService, UploadError, type UploadProgress } from '@/services/upload'

/**
 * Composable for handling PDF uploads with progress tracking
 */
export function usePDFUpload() {
  const isUploading = ref(false)
  const uploadProgress = ref<UploadProgress | null>(null)
  const error = ref<string | null>(null)
  const uploadedUrl = ref<string | null>(null)

  /**
   * Upload a PDF file
   */
  async function upload(file: File): Promise<string> {
    isUploading.value = true
    uploadProgress.value = null
    error.value = null
    uploadedUrl.value = null

    try {
      const response = await uploadService.uploadPDF(file, (progress) => {
        uploadProgress.value = progress
      })

      uploadedUrl.value = response.url
      return response.url
    } catch (e) {
      if (e instanceof UploadError) {
        error.value = e.message
      } else {
        error.value = 'Failed to upload PDF'
      }
      throw e
    } finally {
      isUploading.value = false
      // Keep progress visible for a moment after completion
      setTimeout(() => {
        uploadProgress.value = null
      }, 2000)
    }
  }

  /**
   * Reset upload state
   */
  function reset() {
    isUploading.value = false
    uploadProgress.value = null
    error.value = null
    uploadedUrl.value = null
  }

  return {
    isUploading,
    uploadProgress,
    error,
    uploadedUrl,
    upload,
    reset
  }
}
