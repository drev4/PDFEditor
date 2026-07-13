import { ref } from 'vue'
import type { Ref } from 'vue'
import { useDocumentStore } from '@/stores/document.store'
import { useEditorStore } from '@/stores/editor.store'
import { useDragAndDrop } from './useDragAndDrop'
import { canvasToPDF, calculateTransform } from '@/utils/pdfCoordinates'

export function useImagePlacement(canvasRef: Ref<HTMLCanvasElement | null>) {
  const documentStore = useDocumentStore()
  const editorStore = useEditorStore()

  // Image flip state
  const flipHorizontal = ref(false)
  const flipVertical = ref(false)

  const toggleFlipHorizontal = () => {
    flipHorizontal.value = !flipHorizontal.value
  }

  const toggleFlipVertical = () => {
    flipVertical.value = !flipVertical.value
  }

  // Drag and drop functionality
  const dragAndDrop = useDragAndDrop({
    onUpdatePosition: (x: number, y: number) => {
      if (editorStore.imagePreview) {
        editorStore.updateImagePreviewPosition(x, y)
      }
    },
    onUpdateSize: (width: number, height: number, x: number, y: number) => {
      if (editorStore.imagePreview) {
        editorStore.updateImagePreviewSize(width, height)
        editorStore.updateImagePreviewPosition(x, y)
      }
    },
    getElementPosition: () => ({
      x: editorStore.imagePreview?.x || 0,
      y: editorStore.imagePreview?.y || 0
    }),
    getElementSize: () => ({
      width: editorStore.imagePreview?.width || 0,
      height: editorStore.imagePreview?.height || 0
    }),
    getMaintainAspectRatio: () => editorStore.imagePreview?.maintainAspectRatio ?? false
  })

  const confirmImagePlacement = async () => {
    if (!editorStore.imagePreview || !documentStore.activeDocument?.arrayBuffer) return

    try {
      // Save snapshot before making changes
      await editorStore.saveSnapshot(documentStore.activeDocument.id, documentStore.activeDocument.arrayBuffer)

      const { PDFDocument: PDFLib } = await import('pdf-lib')
      const pdfDoc = await PDFLib.load(documentStore.activeDocument.arrayBuffer, { ignoreEncryption: true })
      const pages = pdfDoc.getPages()
      const currentPageIndex = documentStore.activeDocument.currentPage - 1
      const page = pages[currentPageIndex]
      if (!page) return

      // Load the image
      const imageFile = editorStore.imagePreview.file
      let imageBytes = await imageFile.arrayBuffer()

      // If flipped, we need to apply the transformation to the image
      if (flipHorizontal.value || flipVertical.value) {
        // Create a canvas to flip the image
        const img = new Image()
        await new Promise((resolve) => {
          img.onload = resolve
          img.src = editorStore.imagePreview?.dataUrl || ''
        })

        const canvas = document.createElement('canvas')
        canvas.width = img.width
        canvas.height = img.height
        const ctx = canvas.getContext('2d')!

        ctx.save()

        // Apply transformations
        if (flipHorizontal.value && flipVertical.value) {
          ctx.translate(canvas.width, canvas.height)
          ctx.scale(-1, -1)
        } else if (flipHorizontal.value) {
          ctx.translate(canvas.width, 0)
          ctx.scale(-1, 1)
        } else if (flipVertical.value) {
          ctx.translate(0, canvas.height)
          ctx.scale(1, -1)
        }

        ctx.drawImage(img, 0, 0)
        ctx.restore()

        // Convert canvas to blob
        const blob = await new Promise<Blob>((resolve) => {
          canvas.toBlob((b) => resolve(b!), imageFile.type)
        })
        imageBytes = await blob.arrayBuffer()
      }

      let image
      if (imageFile.type === 'image/png') {
        image = await pdfDoc.embedPng(imageBytes)
      } else if (imageFile.type === 'image/jpeg' || imageFile.type === 'image/jpg') {
        image = await pdfDoc.embedJpg(imageBytes)
      } else {
        console.error('Unsupported image type')
        return
      }

      // Convert canvas coordinates to PDF coordinates
      const transform = calculateTransform(
        page.getHeight(),
        canvasRef.value?.height || page.getHeight(),
        12,
        8
      )

      const pdfCoords = canvasToPDF(
        { 
          x: editorStore.imagePreview.x, 
          y: editorStore.imagePreview.y, 
          width: editorStore.imagePreview.width,
          height: editorStore.imagePreview.height
        },
        transform
      )

      page.drawImage(image, {
        x: pdfCoords.x,
        y: pdfCoords.y,
        width: pdfCoords.width,
        height: pdfCoords.height
      })

      const pdfBytes = await pdfDoc.save()
      const newArrayBuffer = pdfBytes.buffer.slice(
        pdfBytes.byteOffset,
        pdfBytes.byteOffset + pdfBytes.byteLength
      ) as ArrayBuffer

      documentStore.activeDocument.arrayBuffer = newArrayBuffer

      editorStore.addEditAction({
        type: 'image',
        page: currentPageIndex + 1,
        data: { fileName: imageFile.name },
        timestamp: Date.now()
      })

      // Reset flip state
      flipHorizontal.value = false
      flipVertical.value = false

      editorStore.clearImagePreview()
      documentStore.triggerPDFReload()
    } catch (error) {
      console.error('Error adding image:', error)
    }
  }

  const cancelImagePlacement = () => {
    // Reset flip state
    flipHorizontal.value = false
    flipVertical.value = false
    editorStore.clearImagePreview()
  }

  return {
    flipHorizontal,
    flipVertical,
    toggleFlipHorizontal,
    toggleFlipVertical,
    startDrag: dragAndDrop.startDrag,
    startResize: dragAndDrop.startResize,
    confirmImagePlacement,
    cancelImagePlacement
  }
}