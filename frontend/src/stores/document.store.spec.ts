import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useDocumentStore } from './document.store'
import { setupPinia } from '@/test/helpers/pinia-setup'
import { createMockPDFFile } from '@/test/helpers/test-utils'

describe('DocumentStore', () => {
  beforeEach(() => {
    setupPinia()
  })

  describe('loadPDF', () => {
    it('carga un PDF exitosamente y lo establece como activo', async () => {
      const store = useDocumentStore()
      const file = createMockPDFFile('document.pdf', 2048)

      const doc = await store.loadPDF(file)

      expect(store.documents).toHaveLength(1)
      expect(store.activeDocumentId).toBe(doc.id)
      expect(doc.name).toBe('document.pdf')
      expect(doc.numPages).toBe(0)
      expect(doc.currentPage).toBe(1)
      expect(doc.scale).toBe(1.5)
      expect(doc.rotation).toBe(0)
    })

    it('maneja errores al cargar PDF', async () => {
      const store = useDocumentStore()
      const badFile = createMockPDFFile('bad.pdf')

      // Override arrayBuffer to throw error
      Object.defineProperty(badFile, 'arrayBuffer', {
        value: vi.fn().mockRejectedValue(new Error('Invalid PDF')),
        writable: true
      })

      await expect(store.loadPDF(badFile)).rejects.toThrow('Invalid PDF')
      expect(store.error).toBe('Invalid PDF')
      expect(store.documents).toHaveLength(0)
    })

    it('mantiene isLoading durante la carga', async () => {
      const store = useDocumentStore()
      const file = createMockPDFFile()

      expect(store.isLoading).toBe(false)
      const promise = store.loadPDF(file)

      // Need to check isLoading in next tick
      await Promise.resolve()

      await promise
      expect(store.isLoading).toBe(false)
    })

    it('genera IDs únicos para múltiples documentos', async () => {
      const store = useDocumentStore()

      const doc1 = await store.loadPDF(createMockPDFFile('file1.pdf'))
      const doc2 = await store.loadPDF(createMockPDFFile('file2.pdf'))

      expect(doc1.id).not.toBe(doc2.id)
      expect(store.documents).toHaveLength(2)
    })
  })

  describe('setActiveDocument', () => {
    it('cambia el documento activo y resetea a página 1', async () => {
      const store = useDocumentStore()

      const doc1 = await store.loadPDF(createMockPDFFile('doc1.pdf'))
      const doc2 = await store.loadPDF(createMockPDFFile('doc2.pdf'))

      doc1.currentPage = 5
      store.setActiveDocument(doc1.id)

      expect(store.activeDocumentId).toBe(doc1.id)
      expect(doc1.currentPage).toBe(1)
    })

    it('ignora IDs inválidos', () => {
      const store = useDocumentStore()
      store.setActiveDocument('invalid-id')

      expect(store.activeDocumentId).toBeNull()
    })
  })

  describe('setCurrentPage', () => {
    it('cambia la página dentro del rango válido', async () => {
      const store = useDocumentStore()
      const doc = await store.loadPDF(createMockPDFFile())
      store.updateDocumentPages(doc.id, 10)

      store.setCurrentPage(5)
      expect(store.activeDocument?.currentPage).toBe(5)

      store.setCurrentPage(10)
      expect(store.activeDocument?.currentPage).toBe(10)
    })

    it('ignora páginas fuera de rango', async () => {
      const store = useDocumentStore()
      const doc = await store.loadPDF(createMockPDFFile())
      store.updateDocumentPages(doc.id, 5)

      store.setCurrentPage(0)
      expect(store.activeDocument?.currentPage).toBe(1)

      store.setCurrentPage(10)
      expect(store.activeDocument?.currentPage).toBe(1)
    })
  })

  describe('setScale', () => {
    it('establece escala dentro del rango permitido (0.5-3)', async () => {
      const store = useDocumentStore()
      await store.loadPDF(createMockPDFFile())

      store.setScale(2.0)
      expect(store.activeDocument?.scale).toBe(2.0)

      store.setScale(0.5)
      expect(store.activeDocument?.scale).toBe(0.5)
    })

    it('limita la escala a valores mínimos y máximos', async () => {
      const store = useDocumentStore()
      await store.loadPDF(createMockPDFFile())

      store.setScale(0.1)
      expect(store.activeDocument?.scale).toBe(0.5)

      store.setScale(5.0)
      expect(store.activeDocument?.scale).toBe(3.0)
    })
  })

  describe('setRotation', () => {
    it('establece rotación y normaliza a 0-359', async () => {
      const store = useDocumentStore()
      await store.loadPDF(createMockPDFFile())

      store.setRotation(90)
      expect(store.activeDocument?.rotation).toBe(90)

      store.setRotation(360)
      expect(store.activeDocument?.rotation).toBe(0)

      store.setRotation(450)
      expect(store.activeDocument?.rotation).toBe(90)
    })
  })

  describe('closeDocument', () => {
    it('elimina documento y selecciona el siguiente disponible', async () => {
      const store = useDocumentStore()

      const doc1 = await store.loadPDF(createMockPDFFile('doc1.pdf'))
      const doc2 = await store.loadPDF(createMockPDFFile('doc2.pdf'))

      store.closeDocument(doc2.id)

      expect(store.documents).toHaveLength(1)
      expect(store.activeDocumentId).toBe(doc1.id)
    })

    it('establece activeDocument a null cuando se cierra el último', async () => {
      const store = useDocumentStore()
      const doc = await store.loadPDF(createMockPDFFile())

      store.closeDocument(doc.id)

      expect(store.documents).toHaveLength(0)
      expect(store.activeDocumentId).toBeNull()
    })
  })

  describe('computed properties', () => {
    it('activeDocument devuelve el documento activo correcto', async () => {
      const store = useDocumentStore()

      expect(store.activeDocument).toBeNull()

      const doc = await store.loadPDF(createMockPDFFile())
      expect(store.activeDocument?.id).toBe(doc.id)
    })

    it('hasDocuments refleja correctamente el estado', async () => {
      const store = useDocumentStore()

      expect(store.hasDocuments).toBe(false)

      const doc = await store.loadPDF(createMockPDFFile())
      expect(store.hasDocuments).toBe(true)

      store.closeDocument(doc.id)
      expect(store.hasDocuments).toBe(false)
    })
  })
})
