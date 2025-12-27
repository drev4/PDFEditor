import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore } from './editor.store'
import { useDocumentStore } from './document.store'
import { setupPinia } from '@/test/helpers/pinia-setup'
import { createMockPDFFile, createMockEditAction } from '@/test/helpers/test-utils'

describe('EditorStore', () => {
  beforeEach(() => {
    setupPinia()
  })

  describe('Image Preview', () => {
    it('establece y limpia preview de imagen', () => {
      const store = useEditorStore()

      const imagePreview = {
        dataUrl: 'data:image/png;base64,mock',
        file: new File([''], 'test.png', { type: 'image/png' }),
        x: 100,
        y: 200,
        width: 150,
        height: 100,
        originalWidth: 150,
        originalHeight: 100,
        maintainAspectRatio: true
      }

      store.setImagePreview(imagePreview)
      expect(store.imagePreview).toEqual(imagePreview)

      store.clearImagePreview()
      expect(store.imagePreview).toBeNull()
    })

    it('actualiza posición de imagen preview', () => {
      const store = useEditorStore()

      store.setImagePreview({
        dataUrl: 'data:image/png;base64,mock',
        file: new File([''], 'test.png', { type: 'image/png' }),
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        originalWidth: 100,
        originalHeight: 100,
        maintainAspectRatio: true
      })

      store.updateImagePreviewPosition(250, 350)

      expect(store.imagePreview?.x).toBe(250)
      expect(store.imagePreview?.y).toBe(350)
    })

    it('actualiza tamaño de imagen preview', () => {
      const store = useEditorStore()

      store.setImagePreview({
        dataUrl: 'data:image/png;base64,mock',
        file: new File([''], 'test.png', { type: 'image/png' }),
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        originalWidth: 100,
        originalHeight: 100,
        maintainAspectRatio: true
      })

      store.updateImagePreviewSize(200, 150)

      expect(store.imagePreview?.width).toBe(200)
      expect(store.imagePreview?.height).toBe(150)
    })

    it('alterna mantener proporción de aspecto', () => {
      const store = useEditorStore()

      store.setImagePreview({
        dataUrl: 'data:image/png;base64,mock',
        file: new File([''], 'test.png', { type: 'image/png' }),
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        originalWidth: 100,
        originalHeight: 100,
        maintainAspectRatio: true
      })

      expect(store.imagePreview?.maintainAspectRatio).toBe(true)
      store.toggleMaintainAspectRatio()
      expect(store.imagePreview?.maintainAspectRatio).toBe(false)
      store.toggleMaintainAspectRatio()
      expect(store.imagePreview?.maintainAspectRatio).toBe(true)
    })

    it('resetea tamaño de imagen a original', () => {
      const store = useEditorStore()

      store.setImagePreview({
        dataUrl: 'data:image/png;base64,mock',
        file: new File([''], 'test.png', { type: 'image/png' }),
        x: 0,
        y: 0,
        width: 200,
        height: 150,
        originalWidth: 100,
        originalHeight: 100,
        maintainAspectRatio: true
      })

      store.resetImageSize()

      expect(store.imagePreview?.width).toBe(100)
      expect(store.imagePreview?.height).toBe(100)
    })
  })

  describe('Text Preview', () => {
    it('establece y limpia preview de texto', () => {
      const store = useEditorStore()

      const textPreview = {
        text: 'Hello World',
        x: 100,
        y: 200,
        fontSize: 16,
        color: '#000000',
        isBold: false,
        isItalic: false
      }

      store.setTextPreview(textPreview)
      expect(store.textPreview).toEqual(textPreview)

      store.clearTextPreview()
      expect(store.textPreview).toBeNull()
    })

    it('actualiza posición de texto preview', () => {
      const store = useEditorStore()

      store.setTextPreview({
        text: 'Test',
        x: 0,
        y: 0,
        fontSize: 16,
        color: '#000000',
        isBold: false,
        isItalic: false
      })

      store.updateTextPreviewPosition(150, 250)

      expect(store.textPreview?.x).toBe(150)
      expect(store.textPreview?.y).toBe(250)
    })

    it('actualiza contenido del texto', () => {
      const store = useEditorStore()

      store.setTextPreview({
        text: 'Original',
        x: 0,
        y: 0,
        fontSize: 16,
        color: '#000000',
        isBold: false,
        isItalic: false
      })

      store.updateTextPreviewText('Updated')
      expect(store.textPreview?.text).toBe('Updated')
    })

    it('actualiza tamaño de fuente', () => {
      const store = useEditorStore()

      store.setTextPreview({
        text: 'Test',
        x: 0,
        y: 0,
        fontSize: 16,
        color: '#000000',
        isBold: false,
        isItalic: false
      })

      store.updateTextPreviewFontSize(24)
      expect(store.textPreview?.fontSize).toBe(24)
    })

    it('actualiza color de texto', () => {
      const store = useEditorStore()

      store.setTextPreview({
        text: 'Test',
        x: 0,
        y: 0,
        fontSize: 16,
        color: '#000000',
        isBold: false,
        isItalic: false
      })

      store.updateTextPreviewColor('#FF0000')
      expect(store.textPreview?.color).toBe('#FF0000')
    })

    it('alterna estilos de texto (bold e italic)', () => {
      const store = useEditorStore()

      store.setTextPreview({
        text: 'Test',
        x: 0,
        y: 0,
        fontSize: 16,
        color: '#000000',
        isBold: false,
        isItalic: false
      })

      store.toggleTextBold()
      expect(store.textPreview?.isBold).toBe(true)
      store.toggleTextBold()
      expect(store.textPreview?.isBold).toBe(false)

      store.toggleTextItalic()
      expect(store.textPreview?.isItalic).toBe(true)
      store.toggleTextItalic()
      expect(store.textPreview?.isItalic).toBe(false)
    })
  })

  describe('Edit History', () => {
    it('agrega acciones al historial', () => {
      const store = useEditorStore()

      expect(store.editHistory).toHaveLength(0)

      store.addEditAction(createMockEditAction('text'))
      expect(store.editHistory).toHaveLength(1)

      store.addEditAction(createMockEditAction('image'))
      expect(store.editHistory).toHaveLength(2)
    })
  })

  describe('Snapshots', () => {
    it('guarda snapshot del documento activo', async () => {
      const documentStore = useDocumentStore()
      const editorStore = useEditorStore()

      const doc = await documentStore.loadPDF(createMockPDFFile())

      editorStore.saveSnapshot()

      expect(doc.snapshots).toHaveLength(1)
    })

    it('limita snapshots a máximo 10', async () => {
      const documentStore = useDocumentStore()
      const editorStore = useEditorStore()

      const doc = await documentStore.loadPDF(createMockPDFFile())

      // Crear 12 snapshots
      for (let i = 0; i < 12; i++) {
        editorStore.saveSnapshot()
      }

      expect(doc.snapshots).toHaveLength(10)
    })

    it('deshace última edición restaurando snapshot', async () => {
      const documentStore = useDocumentStore()
      const editorStore = useEditorStore()

      const doc = await documentStore.loadPDF(createMockPDFFile())
      const originalArrayBuffer = doc.arrayBuffer

      editorStore.addEditAction(createMockEditAction('text'))
      editorStore.saveSnapshot()

      editorStore.undoLastEdit()

      expect(editorStore.editHistory).toHaveLength(0)
      expect(doc.snapshots).toHaveLength(0)
    })
  })
})
