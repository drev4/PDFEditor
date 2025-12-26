import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { EditAction } from '@/types/pdf'
import { useDocumentStore } from './document.store'

export const useEditorStore = defineStore('editor', () => {
  // State
  const editHistory = ref<EditAction[]>([])
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

  const textPreview = ref<{
    text: string
    x: number
    y: number
    fontSize: number
    color: string
    isBold: boolean
    isItalic: boolean
  } | null>(null)

  // Actions
  const addEditAction = (action: EditAction) => {
    editHistory.value.push(action)
  }

  const saveSnapshot = () => {
    const documentStore = useDocumentStore()
    const activeDocument = documentStore.activeDocument

    if (!activeDocument?.arrayBuffer) return

    const snapshot = activeDocument.arrayBuffer.slice(0)

    if (!activeDocument.snapshots) {
      activeDocument.snapshots = []
    }

    activeDocument.snapshots.push(snapshot)

    if (activeDocument.snapshots.length > 10) {
      activeDocument.snapshots.shift()
    }
  }

  const undoLastEdit = () => {
    const documentStore = useDocumentStore()
    const activeDocument = documentStore.activeDocument

    if (!activeDocument) return

    if (editHistory.value.length > 0) {
      editHistory.value.pop()
    }

    if (activeDocument.snapshots && activeDocument.snapshots.length > 0) {
      const lastSnapshot = activeDocument.snapshots.pop()
      if (lastSnapshot) {
        activeDocument.arrayBuffer = lastSnapshot.slice(0)
        documentStore.triggerPDFReload()
      }
    }
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
      return true
    }
    return false
  }

  const flipImageVertical = () => {
    if (imagePreview.value) {
      return true
    }
    return false
  }

  const clearImagePreview = () => {
    imagePreview.value = null
  }

  // Text preview actions
  const setTextPreview = (preview: typeof textPreview.value) => {
    textPreview.value = preview
  }

  const updateTextPreviewPosition = (x: number, y: number) => {
    if (textPreview.value) {
      textPreview.value.x = x
      textPreview.value.y = y
    }
  }

  const updateTextPreviewText = (text: string) => {
    if (textPreview.value) {
      textPreview.value.text = text
    }
  }

  const updateTextPreviewFontSize = (fontSize: number) => {
    if (textPreview.value) {
      textPreview.value.fontSize = fontSize
    }
  }

  const updateTextPreviewColor = (color: string) => {
    if (textPreview.value) {
      textPreview.value.color = color
    }
  }

  const toggleTextBold = () => {
    if (textPreview.value) {
      textPreview.value.isBold = !textPreview.value.isBold
    }
  }

  const toggleTextItalic = () => {
    if (textPreview.value) {
      textPreview.value.isItalic = !textPreview.value.isItalic
    }
  }

  const clearTextPreview = () => {
    textPreview.value = null
  }

  return {
    // State
    editHistory,
    imagePreview,
    textPreview,

    // Actions
    addEditAction,
    saveSnapshot,
    undoLastEdit,
    setImagePreview,
    updateImagePreviewPosition,
    updateImagePreviewSize,
    toggleMaintainAspectRatio,
    resetImageSize,
    flipImageHorizontal,
    flipImageVertical,
    clearImagePreview,
    setTextPreview,
    updateTextPreviewPosition,
    updateTextPreviewText,
    updateTextPreviewFontSize,
    updateTextPreviewColor,
    toggleTextBold,
    toggleTextItalic,
    clearTextPreview
  }
}, {
  persist: false
})
