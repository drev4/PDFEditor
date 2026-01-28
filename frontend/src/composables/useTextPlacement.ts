import { ref } from 'vue'
import { useDocumentStore } from '@/stores/document.store'
import { useEditorStore } from '@/stores/editor.store'
import { useDrawingStore } from '@/stores/drawing.store'

export function useTextPlacement(canvasRef: any) {
  const documentStore = useDocumentStore()
  const editorStore = useEditorStore()
  const drawingStore = useDrawingStore()

  // Text drag functionality
  const isDragging = ref(false)
  const dragStartX = ref(0)
  const dragStartY = ref(0)
  const textStartX = ref(0)
  const textStartY = ref(0)

  const snapToGridValue = (value: number): number => {
    if (!drawingStore.snapToGrid) return value
    return Math.round(value / drawingStore.gridSize) * drawingStore.gridSize
  }

  const startDrag = (event: MouseEvent) => {
    if (!editorStore.textPreview) return

    isDragging.value = true
    dragStartX.value = event.clientX
    dragStartY.value = event.clientY
    textStartX.value = editorStore.textPreview.x
    textStartY.value = editorStore.textPreview.y

    document.addEventListener('mousemove', onDrag)
    document.addEventListener('mouseup', stopDrag)
    event.preventDefault()
  }

  const onDrag = (event: MouseEvent) => {
    if (!isDragging.value || !editorStore.textPreview) return

    const deltaX = event.clientX - dragStartX.value
    const deltaY = event.clientY - dragStartY.value

    let newX = textStartX.value + deltaX
    let newY = textStartY.value + deltaY

    // Apply snap to grid
    if (drawingStore.snapToGrid) {
      newX = snapToGridValue(newX)
      newY = snapToGridValue(newY)
    }

    editorStore.updateTextPreviewPosition(newX, newY)
  }

  const stopDrag = () => {
    isDragging.value = false
    document.removeEventListener('mousemove', onDrag)
    document.removeEventListener('mouseup', stopDrag)
  }

  const confirmTextPlacement = async () => {
    if (!editorStore.textPreview || !documentStore.activeDocument?.arrayBuffer) return

    const textPreview = editorStore.textPreview

    // Validate that there's actual text
    if (!textPreview.text.trim()) {
      editorStore.clearTextPreview()
      return
    }

    try {
      // Save snapshot before making changes
      editorStore.saveSnapshot()

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

      // Convert hex color to RGB
      const hexToRgb = (hex: string) => {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
        return result && result[1] && result[2] && result[3] ? {
          r: parseInt(result[1], 16) / 255,
          g: parseInt(result[2], 16) / 255,
          b: parseInt(result[3], 16) / 255
        } : { r: 0, g: 0, b: 0 }
      }

      const color = hexToRgb(textPreview.color)

      if (!page) return
      // Convert canvas coordinates to PDF coordinates
      const pageHeight = page.getHeight()
      const canvasHeight = canvasRef.value?.height || pageHeight

      // Calculate scale factor
      const scaleFactor = pageHeight / canvasHeight

      // Account for container padding (CSS: padding: 8px 12px)
      // 12px horizontal (left), 8px vertical (top)
      const containerPaddingX = 12
      const containerPaddingY = 8

      // PDF coordinates are from bottom-left, canvas is from top-left
      // Add the padding offset to match the visual position
      const pdfX = (textPreview.x + containerPaddingX) * scaleFactor
      const pdfY = pageHeight - ((textPreview.y + containerPaddingY) * scaleFactor) - (textPreview.fontSize * scaleFactor)

      page.drawText(textPreview.text, {
        x: pdfX,
        y: pdfY,
        size: textPreview.fontSize * scaleFactor,
        font: font,
        color: rgb(color.r, color.g, color.b)
      })

      const pdfBytes = await pdfDoc.save()
      // Create a proper ArrayBuffer copy with exact byte length
      // pdfBytes.buffer may contain extra bytes beyond the actual PDF data
      const newArrayBuffer = pdfBytes.buffer.slice(
        pdfBytes.byteOffset,
        pdfBytes.byteOffset + pdfBytes.byteLength
      ) as ArrayBuffer

      documentStore.activeDocument.arrayBuffer = newArrayBuffer

      editorStore.addEditAction({
        type: 'text',
        page: currentPageIndex + 1,
        data: { text: textPreview.text },
        timestamp: Date.now()
      })

      editorStore.clearTextPreview()
      documentStore.triggerPDFReload()
    } catch (error) {
      console.error('Error adding text:', error)
    }
  }

  const cancelTextPlacement = () => {
    editorStore.clearTextPreview()
  }

  return {
    startDrag,
    confirmTextPlacement,
    cancelTextPlacement
  }
}
