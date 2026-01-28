import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { ref } from 'vue'
import { usePDFSearch } from './usePDFSearch'
import { useDocumentStore } from '@/stores/document.store'
import { useSearchStore } from '@/stores/search.store'
import { setupPinia } from '@/test/helpers/pinia-setup'
import { createMockPDFDocument } from '@/test/mocks/pdfjs.mock'
import { createMockCanvas, createMockPDFFile } from '@/test/helpers/test-utils'

describe('usePDFSearch', () => {
  let mockPdfDoc: any
  let canvasRef: any
  let searchCanvasRef: any
  let documentStore: ReturnType<typeof useDocumentStore>
  let searchStore: ReturnType<typeof useSearchStore>

  beforeEach(async () => {
    setupPinia()
    documentStore = useDocumentStore()
    searchStore = useSearchStore()

    // Create mock PDF document
    mockPdfDoc = ref(createMockPDFDocument(3))

    // Create mock canvas refs
    canvasRef = ref(createMockCanvas())
    searchCanvasRef = ref(createMockCanvas())

    // Setup active document
    const file = createMockPDFFile('test.pdf', 2048)
    await documentStore.loadPDF(file)
    if (documentStore.activeDocument) {
      documentStore.activeDocument.currentPage = 1
      documentStore.activeDocument.scale = 1.5
    }
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('searchTextInPDF', () => {
    it('busca texto en todas las páginas del PDF', async () => {
      const { searchTextInPDF } = usePDFSearch(mockPdfDoc, canvasRef, searchCanvasRef)

      searchStore.setSearchQuery('sample')
      searchStore.setIsSearching(true)

      await searchTextInPDF()

      expect(searchStore.searchMatches.length).toBeGreaterThan(0)
      expect(searchStore.isSearching).toBe(false)
    })

    it('limpia los resultados si no hay query', async () => {
      const { searchTextInPDF } = usePDFSearch(mockPdfDoc, canvasRef, searchCanvasRef)

      searchStore.setSearchQuery('')
      searchStore.setSearchMatches([{ pageIndex: 0, textIndex: 0, text: 'old', bounds: { x: 0, y: 0, width: 10, height: 10 } }])

      await searchTextInPDF()

      expect(searchStore.searchMatches).toHaveLength(0)
      expect(searchStore.isSearching).toBe(false)
    })

    it('limpia resultados si no hay PDF cargado', async () => {
      const noPdfDoc = ref(null)
      const { searchTextInPDF } = usePDFSearch(noPdfDoc, canvasRef, searchCanvasRef)

      searchStore.setSearchQuery('test')

      await searchTextInPDF()

      expect(searchStore.searchMatches).toHaveLength(0)
    })

    it('busca texto case-insensitive', async () => {
      const { searchTextInPDF } = usePDFSearch(mockPdfDoc, canvasRef, searchCanvasRef)

      searchStore.setSearchQuery('SAMPLE')

      await searchTextInPDF()

      expect(searchStore.searchMatches.length).toBeGreaterThan(0)
      expect(searchStore.searchMatches.some(m => m.text.toLowerCase().includes('sample'))).toBe(true)
    })

    it('calcula correctamente las coordenadas de búsqueda', async () => {
      const { searchTextInPDF } = usePDFSearch(mockPdfDoc, canvasRef, searchCanvasRef)

      searchStore.setSearchQuery('text')

      await searchTextInPDF()

      const match = searchStore.searchMatches[0]
      expect(match.bounds).toHaveProperty('x')
      expect(match.bounds).toHaveProperty('y')
      expect(match.bounds).toHaveProperty('width')
      expect(match.bounds).toHaveProperty('height')
      expect(match.bounds.width).toBeGreaterThan(0)
      expect(match.bounds.height).toBeGreaterThan(0)
    })

    it('maneja errores durante la búsqueda', async () => {
      const errorPdfDoc = ref({
        ...createMockPDFDocument(),
        getPage: vi.fn().mockRejectedValue(new Error('Failed to get page'))
      })
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const { searchTextInPDF } = usePDFSearch(errorPdfDoc, canvasRef, searchCanvasRef)
      searchStore.setSearchQuery('test')

      await searchTextInPDF()

      expect(consoleSpy).toHaveBeenCalledWith('Error searching text:', expect.any(Error))
      expect(searchStore.isSearching).toBe(false)

      consoleSpy.mockRestore()
    })
  })

  describe('drawSearchHighlights', () => {
    it('dibuja highlights en el canvas de búsqueda', async () => {
      const mockCtx = searchCanvasRef.value.getContext('2d')
      const { searchTextInPDF, drawSearchHighlights } = usePDFSearch(mockPdfDoc, canvasRef, searchCanvasRef)

      searchStore.setSearchQuery('text')
      await searchTextInPDF()

      vi.clearAllMocks() // Clear previous calls
      await drawSearchHighlights()

      expect(mockCtx.fillRect).toHaveBeenCalled()
    })

    it('ajusta tamaño del canvas de búsqueda al canvas principal', async () => {
      const mainCanvas = canvasRef.value
      const searchCanvas = searchCanvasRef.value

      mainCanvas.width = 1024
      mainCanvas.height = 768

      const { drawSearchHighlights } = usePDFSearch(mockPdfDoc, canvasRef, searchCanvasRef)

      await drawSearchHighlights()

      expect(searchCanvas.width).toBe(1024)
      expect(searchCanvas.height).toBe(768)
    })
  })

  describe('clearSearchHighlights', () => {
    it('limpia el canvas de búsqueda', () => {
      const mockCtx = searchCanvasRef.value.getContext('2d')
      const { clearSearchHighlights } = usePDFSearch(mockPdfDoc, canvasRef, searchCanvasRef)

      clearSearchHighlights()

      expect(mockCtx.clearRect).toHaveBeenCalledWith(0, 0, searchCanvasRef.value.width, searchCanvasRef.value.height)
    })
  })
})
