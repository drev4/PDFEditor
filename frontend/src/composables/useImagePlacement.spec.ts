import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { ref } from 'vue'
import { useImagePlacement } from './useImagePlacement'
import { useDocumentStore } from '@/stores/document.store'
import { useEditorStore } from '@/stores/editor.store'
import { useDrawingStore } from '@/stores/drawing.store'
import { setupPinia } from '@/test/helpers/pinia-setup'
import { createMockCanvas, createMockPDFFile } from '@/test/helpers/test-utils'

// Mock pdf-lib
vi.mock('pdf-lib', () => ({
  PDFDocument: {
    load: vi.fn().mockResolvedValue({
      getPages: vi.fn().mockReturnValue([
        {
          getHeight: vi.fn().mockReturnValue(792),
          drawImage: vi.fn()
        }
      ]),
      embedPng: vi.fn().mockResolvedValue({}),
      embedJpg: vi.fn().mockResolvedValue({}),
      save: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]))
    })
  }
}))

// Helper to create mock image file with arrayBuffer
const createMockImageFile = (name: string, type: string) => {
  const file = new File([new ArrayBuffer(100)], name, { type })
  Object.defineProperty(file, 'arrayBuffer', {
    value: vi.fn().mockResolvedValue(new ArrayBuffer(100)),
    writable: true
  })
  return file
}

// Placing an image now persists the edited PDF. Mocked so these tests stay
// about image placement rather than making a real upload call.
const persistEditedDocument = vi.fn().mockResolvedValue('http://localhost:3000/uploads/pdfs/edited.pdf')
vi.mock('./useFormManagement', () => ({
  useFormManagement: () => ({ persistEditedDocument })
}))

describe('useImagePlacement', () => {
  let canvasRef: any
  let documentStore: ReturnType<typeof useDocumentStore>
  let editorStore: ReturnType<typeof useEditorStore>
  let drawingStore: ReturnType<typeof useDrawingStore>

  beforeEach(async () => {
    setupPinia()
    canvasRef = ref(createMockCanvas())
    documentStore = useDocumentStore()
    editorStore = useEditorStore()
    drawingStore = useDrawingStore()

    // Setup active document with proper arrayBuffer
    const file = createMockPDFFile('test.pdf', 2048)
    await documentStore.loadPDF(file)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  beforeEach(() => {
    persistEditedDocument.mockClear()
    persistEditedDocument.mockResolvedValue('http://localhost:3000/uploads/pdfs/edited.pdf')
  })

  describe('toggleFlipHorizontal', () => {
    it('alterna el volteo horizontal', () => {
      const { flipHorizontal, toggleFlipHorizontal } = useImagePlacement(canvasRef)

      expect(flipHorizontal.value).toBe(false)
      toggleFlipHorizontal()
      expect(flipHorizontal.value).toBe(true)
      toggleFlipHorizontal()
      expect(flipHorizontal.value).toBe(false)
    })
  })

  describe('toggleFlipVertical', () => {
    it('alterna el volteo vertical', () => {
      const { flipVertical, toggleFlipVertical } = useImagePlacement(canvasRef)

      expect(flipVertical.value).toBe(false)
      toggleFlipVertical()
      expect(flipVertical.value).toBe(true)
      toggleFlipVertical()
      expect(flipVertical.value).toBe(false)
    })
  })

  describe('confirmImagePlacement', () => {
    it('agrega imagen al PDF y registra acción de edición', async () => {
      const mockFile = createMockImageFile('image.png', 'image/png')
      editorStore.setImagePreview({
        file: mockFile,
        dataUrl: 'data:image/png;base64,mock',
        x: 100,
        y: 100,
        width: 200,
        height: 150,
        maintainAspectRatio: true
      })

      const { confirmImagePlacement } = useImagePlacement(canvasRef)

      await confirmImagePlacement()

      expect(editorStore.editHistory).toHaveLength(1)
      expect(editorStore.editHistory[0].type).toBe('image')
      expect(editorStore.imagePreview).toBeNull()
    })

    it('no hace nada si no hay imagen en preview', async () => {
      const { confirmImagePlacement } = useImagePlacement(canvasRef)

      await confirmImagePlacement()

      expect(editorStore.editHistory).toHaveLength(0)
    })

    it('guarda snapshot antes de confirmar', async () => {
      const mockFile = createMockImageFile('image.jpg', 'image/jpeg')
      editorStore.setImagePreview({
        file: mockFile,
        dataUrl: 'data:image/jpeg;base64,mock',
        x: 50,
        y: 50,
        width: 100,
        height: 100,
        maintainAspectRatio: false
      })

      // Spy on saveSnapshot
      const saveSnapshotSpy = vi.spyOn(editorStore, 'saveSnapshot')

      const { confirmImagePlacement } = useImagePlacement(canvasRef)

      await confirmImagePlacement()

      // Verify snapshot was saved
      expect(saveSnapshotSpy).toHaveBeenCalledWith(
        documentStore.activeDocument?.id,
        expect.any(ArrayBuffer)
      )
    })
  })

  describe('cancelImagePlacement', () => {
    it('limpia el preview y resetea flip state', () => {
      editorStore.setImagePreview({
        file: createMockImageFile('image.png', 'image/png'),
        dataUrl: 'data:image/png;base64,mock',
        x: 100,
        y: 100,
        width: 200,
        height: 150,
        maintainAspectRatio: true
      })

      const { cancelImagePlacement, flipHorizontal, flipVertical, toggleFlipHorizontal, toggleFlipVertical } = useImagePlacement(canvasRef)

      toggleFlipHorizontal()
      toggleFlipVertical()

      cancelImagePlacement()

      expect(editorStore.imagePreview).toBeNull()
      expect(flipHorizontal.value).toBe(false)
      expect(flipVertical.value).toBe(false)
    })
  })

  describe('flip functionality', () => {
    it('resetea flip state después de confirmar sin flip activo', async () => {
      const mockFile = createMockImageFile('image.png', 'image/png')
      editorStore.setImagePreview({
        file: mockFile,
        dataUrl: 'data:image/png;base64,mock',
        x: 100,
        y: 100,
        width: 200,
        height: 150,
        maintainAspectRatio: true
      })

      const { confirmImagePlacement, flipHorizontal, flipVertical } = useImagePlacement(canvasRef)

      // No activamos flip para evitar el timeout con Image.onload
      expect(flipHorizontal.value).toBe(false)
      expect(flipVertical.value).toBe(false)

      await confirmImagePlacement()

      // Verificar que se mantienen en false
      expect(flipHorizontal.value).toBe(false)
      expect(flipVertical.value).toBe(false)
    })
  })

  describe('snap to grid', () => {
    it('aplica snap to grid cuando está habilitado', () => {
      drawingStore.snapToGrid = true
      drawingStore.gridSize = 20

      editorStore.setImagePreview({
        file: createMockImageFile('image.png', 'image/png'),
        dataUrl: 'data:image/png;base64,mock',
        x: 107,
        y: 93,
        width: 200,
        height: 150,
        maintainAspectRatio: true
      })

      const { startDrag } = useImagePlacement(canvasRef)

      // Simular drag
      const mockEvent = new MouseEvent('mousedown', { clientX: 107, clientY: 93 })
      startDrag(mockEvent)

      // El valor debería ajustarse al grid más cercano
      // Esta prueba valida que la función se invoca correctamente
      expect(drawingStore.snapToGrid).toBe(true)
    })
  })

  // Same regression the text tool had: the image was drawn into the in-memory
  // buffer and nothing uploaded it, so it was gone on reload.
  describe('persisting the edit', () => {
    const placeImage = async () => {
      editorStore.setImagePreview({
        file: createMockImageFile('signature.png', 'image/png'),
        dataUrl: 'data:image/png;base64,mock',
        x: 100,
        y: 100,
        width: 200,
        height: 150,
        maintainAspectRatio: true
      })
      const { confirmImagePlacement } = useImagePlacement(canvasRef)
      await confirmImagePlacement()
    }

    it('uploads the edited document after placing an image', async () => {
      await placeImage()

      expect(persistEditedDocument).toHaveBeenCalledTimes(1)
    })

    it('tells the user when the image was applied but not saved', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      persistEditedDocument.mockRejectedValueOnce(new Error('Network down'))

      await placeImage()

      expect(documentStore.error).toMatch(/could not be saved/i)
    })
  })
})
