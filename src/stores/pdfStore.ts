import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { PDFDocument, EditAction, SearchMatch } from '@/types/pdf'

export const usePdfStore = defineStore('pdf', () => {
  // State
  const documents = ref<PDFDocument[]>([])
  const activeDocumentId = ref<string | null>(null)
  const editHistory = ref<EditAction[]>([])
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  const pdfReloadTrigger = ref(0) // Used to trigger PDF reload

  // Image preview state
  const imagePreview = ref<{
    dataUrl: string
    file: File
    x: number
    y: number
    width: number
    height: number
    originalWidth: number
    originalHeight: number
    maintainAspectRatio: boolean
  } | null>(null)

  // Grid settings
  const gridEnabled = ref(true)
  const gridSize = ref(20) // Size of each grid cell in pixels (smaller = more precision)
  const snapToGrid = ref(true)

  // Search state
  const searchQuery = ref('')
  const searchMatches = ref<SearchMatch[]>([])
  const currentMatchIndex = ref(-1)
  const isSearching = ref(false)

  // Getters
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
        numPages: 0, // Will be set by the viewer component
        currentPage: 1,
        scale: 1.5,
        rotation: 0,
        snapshots: [] // Initialize empty snapshots array
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
      // Reset to page 1 when switching documents
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

  const addEditAction = (action: EditAction) => {
    editHistory.value.push(action)
  }

  const saveSnapshot = () => {
    if (!activeDocument.value?.arrayBuffer) return

    // Create a copy of the current ArrayBuffer
    const snapshot = activeDocument.value.arrayBuffer.slice(0)

    if (!activeDocument.value.snapshots) {
      activeDocument.value.snapshots = []
    }

    activeDocument.value.snapshots.push(snapshot)

    // Limit snapshots to last 10 to avoid memory issues
    if (activeDocument.value.snapshots.length > 10) {
      activeDocument.value.snapshots.shift()
    }
  }

  const undoLastEdit = () => {
    if (!activeDocument.value) return

    if (editHistory.value.length > 0) {
      editHistory.value.pop()
    }

    // Restore the last snapshot
    if (activeDocument.value.snapshots && activeDocument.value.snapshots.length > 0) {
      const lastSnapshot = activeDocument.value.snapshots.pop()
      if (lastSnapshot) {
        activeDocument.value.arrayBuffer = lastSnapshot.slice(0)
        triggerPDFReload()
      }
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

  const setImagePreview = (preview: typeof imagePreview.value) => {
    imagePreview.value = preview
  }

  const updateImagePreviewPosition = (x: number, y: number) => {
    if (imagePreview.value) {
      imagePreview.value.x = x
      imagePreview.value.y = y
    }
  }

  const updateImagePreviewSize = (width: number, height: number) => {
    if (imagePreview.value) {
      imagePreview.value.width = width
      imagePreview.value.height = height
    }
  }

  const toggleMaintainAspectRatio = () => {
    if (imagePreview.value) {
      imagePreview.value.maintainAspectRatio = !imagePreview.value.maintainAspectRatio
    }
  }

  const resetImageSize = () => {
    if (imagePreview.value) {
      imagePreview.value.width = imagePreview.value.originalWidth
      imagePreview.value.height = imagePreview.value.originalHeight
    }
  }

  const flipImageHorizontal = () => {
    if (imagePreview.value) {
      // This will be handled in the viewer component with CSS transform
      return true
    }
    return false
  }

  const flipImageVertical = () => {
    if (imagePreview.value) {
      // This will be handled in the viewer component with CSS transform
      return true
    }
    return false
  }

  const clearImagePreview = () => {
    imagePreview.value = null
  }

  const setSearchQuery = (query: string) => {
    searchQuery.value = query
  }

  const setSearchMatches = (matches: SearchMatch[]) => {
    searchMatches.value = matches
    currentMatchIndex.value = matches.length > 0 ? 0 : -1
  }

  const nextSearchMatch = () => {
    if (searchMatches.value.length === 0) return
    currentMatchIndex.value = (currentMatchIndex.value + 1) % searchMatches.value.length
  }

  const previousSearchMatch = () => {
    if (searchMatches.value.length === 0) return
    currentMatchIndex.value = currentMatchIndex.value - 1 < 0
      ? searchMatches.value.length - 1
      : currentMatchIndex.value - 1
  }

  const clearSearch = () => {
    searchQuery.value = ''
    searchMatches.value = []
    currentMatchIndex.value = -1
    isSearching.value = false
  }

  const setIsSearching = (value: boolean) => {
    isSearching.value = value
  }

  const toggleGrid = () => {
    gridEnabled.value = !gridEnabled.value
  }

  const toggleSnapToGrid = () => {
    snapToGrid.value = !snapToGrid.value
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
    editHistory,
    isLoading,
    error,
    pdfReloadTrigger,
    imagePreview,
    gridEnabled,
    gridSize,
    snapToGrid,
    searchQuery,
    searchMatches,
    currentMatchIndex,
    isSearching,

    // Getters
    activeDocument,
    hasDocuments,

    // Actions
    loadPDF,
    setActiveDocument,
    updateDocumentPages,
    setCurrentPage,
    setScale,
    setRotation,
    addEditAction,
    saveSnapshot,
    undoLastEdit,
    closeDocument,
    clearError,
    triggerPDFReload,
    setImagePreview,
    updateImagePreviewPosition,
    updateImagePreviewSize,
    toggleMaintainAspectRatio,
    resetImageSize,
    flipImageHorizontal,
    flipImageVertical,
    clearImagePreview,
    setSearchQuery,
    setSearchMatches,
    nextSearchMatch,
    previousSearchMatch,
    clearSearch,
    setIsSearching,
    toggleGrid,
    toggleSnapToGrid,
    updatePageOrder
  }
}, {
  persist: false
})
