import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { EditAction } from '@/types/pdf'
import type { ImagePreview, TextPreview } from '@/types/common'
import { useDocumentSnapshotsStore } from './snapshots.store'

export const useEditorStore = defineStore('editor', () => {
  const editHistory = ref<EditAction[]>([])
  const imagePreview = ref<ImagePreview | null>(null)
  const textPreview = ref<TextPreview | null>(null)

  const snapshotsStore = useDocumentSnapshotsStore()

  const addEditAction = (action: EditAction) => {
    editHistory.value.push(action)
  }

  const saveSnapshot = (documentId: string, arrayBuffer: ArrayBuffer) => {
    snapshotsStore.addSnapshot(documentId, arrayBuffer)
  }

  const undoLastEdit = (documentId: string) => {
    if (editHistory.value.length > 0) {
      editHistory.value.pop()
    }
    return snapshotsStore.getLatestSnapshot(documentId)
  }

  const setImagePreview = (preview: ImagePreview | null) => {
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

  const clearImagePreview = () => {
    imagePreview.value = null
  }

  const setTextPreview = (preview: TextPreview | null) => {
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
    editHistory,
    imagePreview,
    textPreview,
    addEditAction,
    saveSnapshot,
    undoLastEdit,
    setImagePreview,
    updateImagePreviewPosition,
    updateImagePreviewSize,
    toggleMaintainAspectRatio,
    resetImageSize,
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
