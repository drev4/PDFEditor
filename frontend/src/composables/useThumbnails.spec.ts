import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useThumbnails } from './useThumbnails'
import { createMockPDFDocument } from '@/test/mocks/pdfjs.mock'

// Mock canvas toDataURL
HTMLCanvasElement.prototype.toDataURL = vi.fn().mockReturnValue('data:image/jpeg;base64,mockThumbnail')

describe('useThumbnails', () => {
  let mockPdfDoc: any

  beforeEach(() => {
    mockPdfDoc = createMockPDFDocument(5)
    vi.clearAllMocks()
  })

  describe('generateThumbnail', () => {
    it('genera miniatura para una página válida', async () => {
      const { generateThumbnail } = useThumbnails()

      const thumbnail = await generateThumbnail(mockPdfDoc, 1, 120)

      expect(thumbnail).toBe('data:image/jpeg;base64,mockThumbnail')
      expect(mockPdfDoc.getPage).toHaveBeenCalledWith(1)
    })

    it('cachea las miniaturas generadas', async () => {
      const { generateThumbnail, thumbnailCache } = useThumbnails()

      await generateThumbnail(mockPdfDoc, 1, 120)
      const cacheKey = `${mockPdfDoc._pdfInfo.fingerprints[0]}-1`

      expect(thumbnailCache.value.has(cacheKey)).toBe(true)
      expect(thumbnailCache.value.get(cacheKey)).toBe('data:image/jpeg;base64,mockThumbnail')
    })

    it('retorna miniatura cacheada sin regenerar', async () => {
      const { generateThumbnail } = useThumbnails()

      await generateThumbnail(mockPdfDoc, 1, 120)
      const callCount = mockPdfDoc.getPage.mock.calls.length

      await generateThumbnail(mockPdfDoc, 1, 120)

      expect(mockPdfDoc.getPage).toHaveBeenCalledTimes(callCount)
    })

    it('retorna cadena vacía para PDF inválido', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { generateThumbnail } = useThumbnails()

      const thumbnail = await generateThumbnail(null, 1, 120)

      expect(thumbnail).toBe('')
      expect(consoleSpy).toHaveBeenCalledWith('Invalid pdfDoc provided to generateThumbnail')

      consoleSpy.mockRestore()
    })

    it('retorna cadena vacía para número de página inválido', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { generateThumbnail } = useThumbnails()

      const thumbnail = await generateThumbnail(mockPdfDoc, 10, 120)

      expect(thumbnail).toBe('')
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid page number'))

      consoleSpy.mockRestore()
    })

    it('maneja errores de renderizado', async () => {
      const errorPdfDoc = {
        ...mockPdfDoc,
        getPage: vi.fn().mockResolvedValue({
          getViewport: vi.fn().mockReturnValue({ width: 612, height: 792 }),
          render: vi.fn().mockReturnValue({
            promise: Promise.reject(new Error('Render error'))
          })
        })
      }
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { generateThumbnail } = useThumbnails()

      const thumbnail = await generateThumbnail(errorPdfDoc, 1, 120)

      expect(thumbnail).toBe('')
      expect(consoleSpy).toHaveBeenCalled()

      consoleSpy.mockRestore()
    })

    it('establece isGenerating durante la generación', async () => {
      const { generateThumbnail, isGenerating } = useThumbnails()

      const promise = generateThumbnail(mockPdfDoc, 1, 120)
      expect(isGenerating.value).toBe(true)

      await promise
      expect(isGenerating.value).toBe(false)
    })
  })

  describe('generateBatch', () => {
    it('genera múltiples miniaturas', async () => {
      const { generateBatch } = useThumbnails()

      const results = await generateBatch(mockPdfDoc, [1, 2, 3], 120)

      expect(results.size).toBe(3)
      expect(results.get(1)).toBe('data:image/jpeg;base64,mockThumbnail')
      expect(results.get(2)).toBe('data:image/jpeg;base64,mockThumbnail')
      expect(results.get(3)).toBe('data:image/jpeg;base64,mockThumbnail')
    })
  })

  describe('clearCache', () => {
    it('limpia todo el cache de miniaturas', async () => {
      const { generateThumbnail, clearCache, thumbnailCache } = useThumbnails()

      await generateThumbnail(mockPdfDoc, 1, 120)
      await generateThumbnail(mockPdfDoc, 2, 120)

      expect(thumbnailCache.value.size).toBe(2)

      clearCache()

      expect(thumbnailCache.value.size).toBe(0)
    })
  })

  describe('clearDocumentCache', () => {
    it('limpia cache solo del documento especificado', async () => {
      const { generateThumbnail, clearDocumentCache, thumbnailCache } = useThumbnails()

      await generateThumbnail(mockPdfDoc, 1, 120)
      await generateThumbnail(mockPdfDoc, 2, 120)

      const otherDoc = createMockPDFDocument(3)
      otherDoc._pdfInfo.fingerprints[0] = 'different-fingerprint'
      await generateThumbnail(otherDoc, 1, 120)

      expect(thumbnailCache.value.size).toBe(3)

      clearDocumentCache(mockPdfDoc._pdfInfo.fingerprints[0])

      expect(thumbnailCache.value.size).toBe(1)
      expect(thumbnailCache.value.has('different-fingerprint-1')).toBe(true)
    })
  })
})
