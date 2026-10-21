import type { Ref } from 'vue'
import { useDocumentStore } from '@/stores/document.store'
import { useEditorStore } from '@/stores/editor.store'
import { useDragAndDrop } from './useDragAndDrop'
import { hexToRgb, canvasToPDF, calculateTransform } from '@/utils/pdfCoordinates'

export function useTextPlacement(canvasRef: Ref<HTMLCanvasElement | null>) {
  const documentStore = useDocumentStore()
  const editorStore = useEditorStore()

  // Drag and drop functionality
  const dragAndDrop = useDragAndDrop({
    onUpdatePosition: (x: number, y: number) => {
      if (editorStore.textPreview) {
        editorStore.updateTextPreviewPosition(x, y)
      }
    },
    getElementPosition: () => ({
      x: editorStore.textPreview?.x || 0,
      y: editorStore.textPreview?.y || 0
    })
  })

  const confirmTextPlacement = async () => {
    if (!editorStore.textPreview || !documentStore.activeDocument?.arrayBuffer) return

    const textPreview = editorStore.textPreview

    // Validate that there's actual text
    if (!textPreview.text.trim()) {
      editorStore.clearTextPreview()
      return
    }

    try {
      // The document as it is before the edit. Saving a snapshot *is* pushing
      // the undo entry (features/0047).
      editorStore.saveSnapshot(documentStore.activeDocument.id, documentStore.activeDocument.arrayBuffer, 'Text')

      const { PDFDocument: PDFLib, rgb, StandardFonts } = await import('pdf-lib')
      const pdfDoc = await PDFLib.load(documentStore.activeDocument.arrayBuffer, { ignoreEncryption: true })
      const pages = pdfDoc.getPages()
      const currentPageIndex = documentStore.activeDocument.currentPage - 1
      const page = pages[currentPageIndex]

      // Embed font based on style
      let font
      if (textPreview.isBold && textPreview.isItalic) {
        font = await pdfDoc.embedFont(StandardFonts.HelveticaBoldOblique)
      } else if (textPreview.isBold) {
        font = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
      } else if (textPreview.isItalic) {
        font = await pdfDoc.embedFont(StandardFonts.HelveticaOblique)
      } else {
        font = await pdfDoc.embedFont(StandardFonts.Helvetica)
      }

      const color = hexToRgb(textPreview.color)

      if (!page) return
      
      // Convert canvas coordinates to PDF coordinates
      const transform = calculateTransform(
        page.getHeight(),
        canvasRef.value?.height || page.getHeight(),
        12,
        8
      )

      const pdfCoords = canvasToPDF(
        { x: textPreview.x, y: textPreview.y, height: textPreview.fontSize },
        transform
      )

      page.drawText(textPreview.text, {
        x: pdfCoords.x,
        y: pdfCoords.y,
        size: textPreview.fontSize * transform.scaleFactor,
        font: font,
        color: rgb(color.r, color.g, color.b)
      })

      const pdfBytes = await pdfDoc.save()
      const newArrayBuffer = pdfBytes.buffer.slice(
        pdfBytes.byteOffset,
        pdfBytes.byteOffset + pdfBytes.byteLength
      ) as ArrayBuffer

      documentStore.activeDocument.arrayBuffer = newArrayBuffer

      editorStore.clearTextPreview()
      documentStore.triggerPDFReload()

      // The text is in the in-memory buffer and nowhere else. It is not
      // uploaded here on purpose: an edit is not a decision until the user says
      // so, and writing every placement straight to the server gave someone
      // trying something out no way back. `Save all` in the editor panel is
      // what commits it; this only records that there is something to commit.
      documentStore.markEdited()
    } catch (error) {
      console.error('Error adding text:', error)
    }
  }

  const cancelTextPlacement = () => {
    editorStore.clearTextPreview()
  }

  return {
    startDrag: dragAndDrop.startDrag,
    confirmTextPlacement,
    cancelTextPlacement
  }
}