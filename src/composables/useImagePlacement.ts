import { ref } from 'vue'
import { usePdfStore } from '@/stores/pdfStore'

export function useImagePlacement(canvasRef: any) {
  const pdfStore = usePdfStore()

  // Image drag and drop functionality
  const isDragging = ref(false)
  const dragStartX = ref(0)
  const dragStartY = ref(0)
  const imageStartX = ref(0)
  const imageStartY = ref(0)

  // Image resize functionality
  const isResizing = ref(false)
  const resizeHandle = ref<'nw' | 'ne' | 'sw' | 'se' | null>(null)
  const resizeStartX = ref(0)
  const resizeStartY = ref(0)
  const imageStartWidth = ref(0)
  const imageStartHeight = ref(0)

  // Image flip state
  const flipHorizontal = ref(false)
  const flipVertical = ref(false)

  const toggleFlipHorizontal = () => {
    flipHorizontal.value = !flipHorizontal.value
  }

  const toggleFlipVertical = () => {
    flipVertical.value = !flipVertical.value
  }

  const snapToGridValue = (value: number): number => {
    if (!pdfStore.snapToGrid) return value
    return Math.round(value / pdfStore.gridSize) * pdfStore.gridSize
  }

  const startDrag = (event: MouseEvent) => {
    if (!pdfStore.imagePreview) return

    isDragging.value = true
    dragStartX.value = event.clientX
    dragStartY.value = event.clientY
    imageStartX.value = pdfStore.imagePreview.x
    imageStartY.value = pdfStore.imagePreview.y

    document.addEventListener('mousemove', onDrag)
    document.addEventListener('mouseup', stopDrag)
    event.preventDefault()
  }

  const onDrag = (event: MouseEvent) => {
    if (!isDragging.value || !pdfStore.imagePreview) return

    const deltaX = event.clientX - dragStartX.value
    const deltaY = event.clientY - dragStartY.value

    let newX = imageStartX.value + deltaX
    let newY = imageStartY.value + deltaY

    // Apply snap to grid
    if (pdfStore.snapToGrid) {
      newX = snapToGridValue(newX)
      newY = snapToGridValue(newY)
    }

    pdfStore.updateImagePreviewPosition(newX, newY)
  }

  const stopDrag = () => {
    isDragging.value = false
    document.removeEventListener('mousemove', onDrag)
    document.removeEventListener('mouseup', stopDrag)
  }

  const startResize = (event: MouseEvent, handle: 'nw' | 'ne' | 'sw' | 'se') => {
    if (!pdfStore.imagePreview) return

    isResizing.value = true
    resizeHandle.value = handle
    resizeStartX.value = event.clientX
    resizeStartY.value = event.clientY
    imageStartX.value = pdfStore.imagePreview.x
    imageStartY.value = pdfStore.imagePreview.y
    imageStartWidth.value = pdfStore.imagePreview.width
    imageStartHeight.value = pdfStore.imagePreview.height

    document.addEventListener('mousemove', onResize)
    document.addEventListener('mouseup', stopResize)
    event.preventDefault()
  }

  const onResize = (event: MouseEvent) => {
    if (!isResizing.value || !pdfStore.imagePreview) return

    const deltaX = event.clientX - resizeStartX.value
    const deltaY = event.clientY - resizeStartY.value

    let newWidth = imageStartWidth.value
    let newHeight = imageStartHeight.value
    let newX = imageStartX.value
    let newY = imageStartY.value

    // Calculate aspect ratio
    const aspectRatio = imageStartWidth.value / imageStartHeight.value

    if (pdfStore.imagePreview.maintainAspectRatio) {
      // Maintain aspect ratio - use the larger delta
      switch (resizeHandle.value) {
        case 'se': // Bottom-right corner
          const seNewWidth = Math.max(50, imageStartWidth.value + deltaX)
          newWidth = seNewWidth
          newHeight = seNewWidth / aspectRatio
          break
        case 'sw': // Bottom-left corner
          const swNewWidth = Math.max(50, imageStartWidth.value - deltaX)
          newWidth = swNewWidth
          newHeight = swNewWidth / aspectRatio
          newX = imageStartX.value + (imageStartWidth.value - newWidth)
          break
        case 'ne': // Top-right corner
          const neNewWidth = Math.max(50, imageStartWidth.value + deltaX)
          newWidth = neNewWidth
          newHeight = neNewWidth / aspectRatio
          newY = imageStartY.value + (imageStartHeight.value - newHeight)
          break
        case 'nw': // Top-left corner
          const nwNewWidth = Math.max(50, imageStartWidth.value - deltaX)
          newWidth = nwNewWidth
          newHeight = nwNewWidth / aspectRatio
          newX = imageStartX.value + (imageStartWidth.value - newWidth)
          newY = imageStartY.value + (imageStartHeight.value - newHeight)
          break
      }
    } else {
      // Free resize
      switch (resizeHandle.value) {
        case 'se': // Bottom-right corner
          newWidth = Math.max(50, imageStartWidth.value + deltaX)
          newHeight = Math.max(50, imageStartHeight.value + deltaY)
          break
        case 'sw': // Bottom-left corner
          newWidth = Math.max(50, imageStartWidth.value - deltaX)
          newHeight = Math.max(50, imageStartHeight.value + deltaY)
          newX = imageStartX.value + (imageStartWidth.value - newWidth)
          break
        case 'ne': // Top-right corner
          newWidth = Math.max(50, imageStartWidth.value + deltaX)
          newHeight = Math.max(50, imageStartHeight.value - deltaY)
          newY = imageStartY.value + (imageStartHeight.value - newHeight)
          break
        case 'nw': // Top-left corner
          newWidth = Math.max(50, imageStartWidth.value - deltaX)
          newHeight = Math.max(50, imageStartHeight.value - deltaY)
          newX = imageStartX.value + (imageStartWidth.value - newWidth)
          newY = imageStartY.value + (imageStartHeight.value - newHeight)
          break
      }
    }

    // Apply snap to grid
    if (pdfStore.snapToGrid) {
      newWidth = snapToGridValue(newWidth)
      newHeight = snapToGridValue(newHeight)
      newX = snapToGridValue(newX)
      newY = snapToGridValue(newY)
    }

    pdfStore.updateImagePreviewSize(newWidth, newHeight)
    pdfStore.updateImagePreviewPosition(newX, newY)
  }

  const stopResize = () => {
    isResizing.value = false
    resizeHandle.value = null
    document.removeEventListener('mousemove', onResize)
    document.removeEventListener('mouseup', stopResize)
  }

  const confirmImagePlacement = async () => {
    if (!pdfStore.imagePreview || !pdfStore.activeDocument?.arrayBuffer) return

    try {
      // Save snapshot before making changes
      pdfStore.saveSnapshot()

      const { PDFDocument: PDFLib } = await import('pdf-lib')
      const pdfDoc = await PDFLib.load(pdfStore.activeDocument.arrayBuffer)
      const pages = pdfDoc.getPages()
      const currentPageIndex = pdfStore.activeDocument.currentPage - 1
      const page = pages[currentPageIndex]

      // Load the image
      const imageFile = pdfStore.imagePreview.file
      let imageBytes = await imageFile.arrayBuffer()

      // If flipped, we need to apply the transformation to the image
      if (flipHorizontal.value || flipVertical.value) {
        // Create a canvas to flip the image
        const img = new Image()
        await new Promise((resolve) => {
          img.onload = resolve
          img.src = pdfStore.imagePreview?.dataUrl || ''
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
      const pageHeight = page.getHeight()
      const canvasHeight = canvasRef.value?.height || pageHeight

      // Calculate scale factor
      const scaleFactor = pageHeight / canvasHeight

      // PDF coordinates are from bottom-left, canvas is from top-left
      const pdfX = pdfStore.imagePreview.x * scaleFactor
      const pdfY = pageHeight - (pdfStore.imagePreview.y * scaleFactor) - (pdfStore.imagePreview.height * scaleFactor)

      page.drawImage(image, {
        x: pdfX,
        y: pdfY,
        width: pdfStore.imagePreview.width * scaleFactor,
        height: pdfStore.imagePreview.height * scaleFactor
      })

      const pdfBytes = await pdfDoc.save()
      const newArrayBuffer = pdfBytes.buffer as ArrayBuffer

      pdfStore.activeDocument.arrayBuffer = newArrayBuffer

      pdfStore.addEditAction({
        type: 'image',
        page: currentPageIndex + 1,
        data: { fileName: imageFile.name },
        timestamp: Date.now()
      })

      // Reset flip state
      flipHorizontal.value = false
      flipVertical.value = false

      pdfStore.clearImagePreview()
      pdfStore.triggerPDFReload()
    } catch (error) {
      console.error('Error adding image:', error)
    }
  }

  const cancelImagePlacement = () => {
    // Reset flip state
    flipHorizontal.value = false
    flipVertical.value = false
    pdfStore.clearImagePreview()
  }

  return {
    flipHorizontal,
    flipVertical,
    toggleFlipHorizontal,
    toggleFlipVertical,
    startDrag,
    startResize,
    confirmImagePlacement,
    cancelImagePlacement
  }
}
