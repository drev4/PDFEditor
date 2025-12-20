import { ref } from 'vue'
import * as pdfjsLib from 'pdfjs-dist'

export function useThumbnails() {
  const thumbnailCache = ref<Map<string, string>>(new Map())
  const isGenerating = ref(false)

  /**
   * Generate thumbnail for a specific page
   * @param pdfDoc - PDF.js document
   * @param pageNumber - Page number (1-based)
   * @param width - Thumbnail width in pixels (default 120)
   * @returns Data URL of the thumbnail
   */
  const generateThumbnail = async (
    pdfDoc: any,
    pageNumber: number,
    width: number = 120
  ): Promise<string> => {
    // Validate inputs
    if (!pdfDoc || !pdfDoc._pdfInfo.fingerprints[0]) {
      console.warn('Invalid pdfDoc provided to generateThumbnail')
      return ''
    }

    if (pageNumber < 1 || pageNumber > pdfDoc.numPages) {
      console.warn(`Invalid page number ${pageNumber} (PDF has ${pdfDoc.numPages} pages)`)
      return ''
    }

    const cacheKey = `${pdfDoc._pdfInfo.fingerprints[0]}-${pageNumber}`

    // Return cached thumbnail if exists
    if (thumbnailCache.value.has(cacheKey)) {
      return thumbnailCache.value.get(cacheKey)!
    }

    try {
      isGenerating.value = true

      // Get the page
      const page = await pdfDoc.getPage(pageNumber)

      // Calculate scale to fit width
      const viewport = page.getViewport({ scale: 1.0 })
      const scale = width / viewport.width

      // Get viewport with calculated scale
      const scaledViewport = page.getViewport({ scale })

      // Create canvas
      const canvas = document.createElement('canvas')
      const context = canvas.getContext('2d')

      if (!context) {
        throw new Error('Could not get canvas context')
      }

      canvas.width = scaledViewport.width
      canvas.height = scaledViewport.height

      // Render page to canvas
      const renderContext = {
        canvasContext: context,
        viewport: scaledViewport
      }

      await page.render(renderContext).promise

      // Convert to data URL
      const dataUrl = canvas.toDataURL('image/jpeg', 0.7) // Use JPEG with 70% quality for smaller size

      // Cache the thumbnail
      thumbnailCache.value.set(cacheKey, dataUrl)

      return dataUrl
    } catch (error: any) {
      // Only log non-cancelled errors
      if (error?.name !== 'RenderingCancelledException') {
        console.error('Error generating thumbnail:', error)
      }
      return ''
    } finally {
      isGenerating.value = false
    }
  }

  /**
   * Generate thumbnails for multiple pages
   * @param pdfDoc - PDF.js document
   * @param pageNumbers - Array of page numbers to generate
   * @param width - Thumbnail width in pixels
   */
  const generateBatch = async (
    pdfDoc: any,
    pageNumbers: number[],
    width: number = 120
  ): Promise<Map<number, string>> => {
    const results = new Map<number, string>()

    for (const pageNum of pageNumbers) {
      const thumbnail = await generateThumbnail(pdfDoc, pageNum, width)
      results.set(pageNum, thumbnail)
    }

    return results
  }

  /**
   * Clear thumbnail cache
   */
  const clearCache = () => {
    thumbnailCache.value.clear()
  }

  /**
   * Clear cache for specific document
   */
  const clearDocumentCache = (fingerprint: string) => {
    const keysToDelete: string[] = []
    thumbnailCache.value.forEach((_, key) => {
      if (key.startsWith(fingerprint)) {
        keysToDelete.push(key)
      }
    })
    keysToDelete.forEach(key => thumbnailCache.value.delete(key))
  }

  return {
    thumbnailCache,
    isGenerating,
    generateThumbnail,
    generateBatch,
    clearCache,
    clearDocumentCache
  }
}
