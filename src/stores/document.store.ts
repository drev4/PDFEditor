import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { PDFDocument } from '@/types/pdf'

export const useDocumentStore = defineStore('document', () => {
  // State
  const documents = ref<PDFDocument[]>([])
  const activeDocumentId = ref<string | null>(null)
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  const pdfReloadTrigger = ref(0)

  // Computed
  const activeDocument = computed(() => {
    return documents.value.find(doc => doc.id === activeDocumentId.value) || null
  })

  const hasDocuments = computed(() => documents.value.length > 0)

  // Actions
  const loadPDF = async (file: File) => {
    isLoading.value = true
    error.value = null

    try {
      const arrayBuffer = await file.arrayBuffer()

      const newDocument: PDFDocument = {
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
        name: file.name,
        file,
        arrayBuffer,
        numPages: 0,
        currentPage: 1,
        scale: 1.5,
        rotation: 0,
        snapshots: []
      }

      documents.value.push(newDocument)
      activeDocumentId.value = newDocument.id

      return newDocument
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Error loading PDF'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  const setActiveDocument = (documentId: string) => {
    const doc = documents.value.find(d => d.id === documentId)
    if (doc) {
      activeDocumentId.value = documentId
      doc.currentPage = 1
    }
  }

  const updateDocumentPages = (documentId: string, numPages: number) => {
    const doc = documents.value.find(d => d.id === documentId)
    if (doc) {
      doc.numPages = numPages
    }
  }

  const setCurrentPage = (page: number) => {
    if (activeDocument.value && page >= 1 && page <= activeDocument.value.numPages) {
      activeDocument.value.currentPage = page
    }
  }

  const setScale = (scale: number) => {
    if (activeDocument.value) {
      activeDocument.value.scale = Math.max(0.5, Math.min(3, scale))
    }
  }

  const setRotation = (rotation: number) => {
    if (activeDocument.value) {
      activeDocument.value.rotation = rotation % 360
    }
  }

  const closeDocument = (documentId: string) => {
    const index = documents.value.findIndex(d => d.id === documentId)
    if (index !== -1) {
      documents.value.splice(index, 1)

      if (activeDocumentId.value === documentId) {
        activeDocumentId.value = documents.value.length > 0 && documents.value[0] ? documents.value[0].id : null
      }
    }
  }

  const clearError = () => {
    error.value = null
  }

  const triggerPDFReload = () => {
    pdfReloadTrigger.value++
  }

  const updatePageOrder = (newOrder: number[]) => {
    if (activeDocument.value) {
      activeDocument.value.pageOrder = newOrder
    }
  }

  return {
    // State
    documents,
    activeDocumentId,
    isLoading,
    error,
    pdfReloadTrigger,

    // Computed
    activeDocument,
    hasDocuments,

    // Actions
    loadPDF,
    setActiveDocument,
    updateDocumentPages,
    setCurrentPage,
    setScale,
    setRotation,
    closeDocument,
    clearError,
    triggerPDFReload,
    updatePageOrder
  }
}, {
  persist: false
})
