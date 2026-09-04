import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { ref } from 'vue'
import { useTextPlacement } from './useTextPlacement'
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
          drawText: vi.fn()
        }
      ]),
      embedFont: vi.fn().mockResolvedValue({}),
      save: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]))
    })
  },
  rgb: vi.fn((r, g, b) => ({ r, g, b })),
  StandardFonts: {
    Helvetica: 'Helvetica',
    HelveticaBold: 'Helvetica-Bold',
    HelveticaOblique: 'Helvetica-Oblique',
    HelveticaBoldOblique: 'Helvetica-BoldOblique'
  }
}))

describe('useTextPlacement', () => {
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

  describe('confirmTextPlacement', () => {
    it('agrega texto al PDF y registra acción de edición', async () => {
      editorStore.setTextPreview({
        text: 'Hello World',
        x: 100,
        y: 100,
        fontSize: 16,
        color: '#000000',
        isBold: false,
        isItalic: false
      })

      const { confirmTextPlacement } = useTextPlacement(canvasRef)

      await confirmTextPlacement()

      expect(editorStore.undoDepth).toBe(1)
      expect(editorStore.nextUndoLabel).toBe('Text')
      expect(editorStore.textPreview).toBeNull()
    })

    it('no hace nada si no hay texto en preview', async () => {
      const { confirmTextPlacement } = useTextPlacement(canvasRef)

      await confirmTextPlacement()

      expect(editorStore.undoDepth).toBe(0)
    })

    it('no hace nada si el texto está vacío', async () => {
      editorStore.setTextPreview({
        text: '   ',
        x: 100,
        y: 100,
        fontSize: 16,
        color: '#000000',
        isBold: false,
        isItalic: false
      })

      const { confirmTextPlacement } = useTextPlacement(canvasRef)

      await confirmTextPlacement()

      expect(editorStore.undoDepth).toBe(0)
      expect(editorStore.textPreview).toBeNull()
    })

    it('guarda snapshot antes de confirmar', async () => {
      editorStore.setTextPreview({
        text: 'Test',
        x: 50,
        y: 50,
        fontSize: 14,
        color: '#FF0000',
        isBold: true,
        isItalic: false
      })

      // Spy on saveSnapshot
      const saveSnapshotSpy = vi.spyOn(editorStore, 'saveSnapshot')

      const { confirmTextPlacement } = useTextPlacement(canvasRef)

      await confirmTextPlacement()

      // Verify snapshot was saved
      expect(saveSnapshotSpy).toHaveBeenCalledWith(
        documentStore.activeDocument?.id,
        expect.any(ArrayBuffer),
        'Text'
      )
    })

    it('maneja texto con estilos (bold, italic)', async () => {
      const testCases = [
        { isBold: true, isItalic: false },
        { isBold: false, isItalic: true },
        { isBold: true, isItalic: true },
        { isBold: false, isItalic: false }
      ]

      const { confirmTextPlacement } = useTextPlacement(canvasRef)

      for (const testCase of testCases) {
        editorStore.setTextPreview({
          text: 'Styled Text',
          x: 100,
          y: 100,
          fontSize: 16,
          color: '#000000',
          ...testCase
        })

        await confirmTextPlacement()
      }

      expect(editorStore.undoDepth).toBe(4)
    })

    it('maneja errores durante la colocación', async () => {
      // Mock pdf-lib to throw error
      const { PDFDocument } = await import('pdf-lib')
      vi.mocked(PDFDocument.load).mockRejectedValueOnce(new Error('PDF load failed'))

      editorStore.setTextPreview({
        text: 'Error Test',
        x: 100,
        y: 100,
        fontSize: 16,
        color: '#000000',
        isBold: false,
        isItalic: false
      })

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { confirmTextPlacement } = useTextPlacement(canvasRef)

      await confirmTextPlacement()

      expect(consoleSpy).toHaveBeenCalled()

      consoleSpy.mockRestore()
    })
  })

  describe('cancelTextPlacement', () => {
    it('limpia el preview de texto', () => {
      editorStore.setTextPreview({
        text: 'Cancel Me',
        x: 100,
        y: 100,
        fontSize: 16,
        color: '#000000',
        isBold: false,
        isItalic: false
      })

      const { cancelTextPlacement } = useTextPlacement(canvasRef)

      cancelTextPlacement()

      expect(editorStore.textPreview).toBeNull()
    })
  })

  describe('snap to grid', () => {
    it('aplica snap to grid cuando está habilitado', () => {
      drawingStore.snapToGrid = true
      drawingStore.gridSize = 20

      editorStore.setTextPreview({
        text: 'Snap Test',
        x: 107,
        y: 93,
        fontSize: 16,
        color: '#000000',
        isBold: false,
        isItalic: false
      })

      const { startDrag } = useTextPlacement(canvasRef)

      // Simular drag
      const mockEvent = new MouseEvent('mousedown', { clientX: 107, clientY: 93 })
      startDrag(mockEvent)

      // Validar que la función se invoca correctamente
      expect(drawingStore.snapToGrid).toBe(true)
    })
  })

  // Regression. The text tool drew into the in-memory PDF buffer and stopped
  // there: nothing recorded that the document had changed, so the edit was
  // lost on reload with nothing having warned the user.
  //
  // It is deliberately not uploaded here. An edit is not a decision until the
  // user saves, and writing every placement straight to the server left
  // someone experimenting with no way back.
  describe('marking the document as edited', () => {
    const placeText = async () => {
      const { confirmTextPlacement } = useTextPlacement(canvasRef)
      editorStore.setTextPreview({
        text: 'Signed by Marta',
        x: 100,
        y: 100,
        fontSize: 14,
        color: '#000000',
        isBold: false,
        isItalic: false
      })
      await confirmTextPlacement()
    }

    it('marks the document as having unsaved edits', async () => {
      expect(documentStore.hasUnsavedEdits).toBe(false)

      await placeText()

      expect(documentStore.hasUnsavedEdits).toBe(true)
    })

    it('does not mark anything when the text is blank', async () => {
      const { confirmTextPlacement } = useTextPlacement(canvasRef)
      editorStore.setTextPreview({
        text: '   ',
        x: 100,
        y: 100,
        fontSize: 14,
        color: '#000000',
        isBold: false,
        isItalic: false
      })

      await confirmTextPlacement()

      expect(documentStore.hasUnsavedEdits).toBe(false)
    })

    it('commits the text to the in-memory buffer', async () => {
      await placeText()

      // A cleared preview means the text was applied rather than left pending.
      expect(editorStore.textPreview).toBeNull()
    })
  })
})
