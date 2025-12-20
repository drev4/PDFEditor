import { ref, shallowRef } from 'vue'
import * as pdfjsLib from 'pdfjs-dist'
import { usePdfStore } from '@/stores/pdfStore'

export function usePDFRendering() {
  const pdfStore = usePdfStore()

  const pdfDoc = shallowRef<any>(null)
  const renderTask = shallowRef<any>(null)
  const canvasRef = ref<HTMLCanvasElement | null>(null)
  const gridCanvasRef = ref<HTMLCanvasElement | null>(null)
  const textLayerRef = ref<HTMLDivElement | null>(null)

  const loadPDF = async () => {
    if (!pdfStore.activeDocument?.arrayBuffer) return

    // Clean up previous document
    if (pdfDoc.value) {
      try {
        await pdfDoc.value.destroy()
      } catch (error) {
        // Ignore cleanup errors
      }
      pdfDoc.value = null
    }

    // Cancel any ongoing render
    if (renderTask.value) {
      try {
        await renderTask.value.cancel()
      } catch (error) {
        // Ignore cancellation errors
      }
      renderTask.value = null
    }

    try {
      // Create a copy of the ArrayBuffer to avoid detached buffer issues
      const originalBuffer = pdfStore.activeDocument.arrayBuffer
      const bufferCopy = originalBuffer.slice(0)

      const loadingTask = pdfjsLib.getDocument({
        data: bufferCopy
      })

      const pdf = await loadingTask.promise
      pdfDoc.value = pdf
      pdfStore.updateDocumentPages(pdfStore.activeDocument.id, pdf.numPages)

      await renderPage()
    } catch (error) {
      console.error('Error loading PDF:', error)
      pdfDoc.value = null
    }
  }

  const renderPage = async () => {
    if (!pdfDoc.value || !canvasRef.value) return
    if (!pdfStore.activeDocument) return

    // Cancel previous render task if exists
    if (renderTask.value) {
      try {
        await renderTask.value.cancel()
      } catch (error) {
        // Ignore cancellation errors
      }
      renderTask.value = null
    }

    try {
      const currentPage = pdfStore.activeDocument.currentPage
      const scale = pdfStore.activeDocument.scale
      const rotation = pdfStore.activeDocument.rotation

      const page = await pdfDoc.value.getPage(currentPage)
      const canvas = canvasRef.value
      const context = canvas.getContext('2d')

      if (!context) return

      const viewport = page.getViewport({ scale, rotation })

      canvas.height = viewport.height
      canvas.width = viewport.width

      const renderContext = {
        canvasContext: context,
        viewport: viewport
      }

      renderTask.value = page.render(renderContext)
      await renderTask.value.promise
      renderTask.value = null

      return { page, viewport }
    } catch (error: any) {
      if (error?.name === 'RenderingCancelledException') {
        return null
      }
      console.error('Error rendering page:', error)
      return null
    }
  }

  const renderTextLayer = async () => {
    if (!textLayerRef.value || !pdfDoc.value || !canvasRef.value) return
    if (!pdfStore.activeDocument) return

    const textLayerDiv = textLayerRef.value
    const mainCanvas = canvasRef.value

    // Clear previous text layer
    textLayerDiv.innerHTML = ''

    try {
      const page = await pdfDoc.value.getPage(pdfStore.activeDocument.currentPage)
      const textContent = await page.getTextContent()

      // Get viewport at base scale to get correct height
      const baseViewport = page.getViewport({ scale: 1.0 })
      const currentScale = pdfStore.activeDocument.scale

      // Set text layer dimensions to match canvas exactly
      textLayerDiv.style.width = `${mainCanvas.width}px`
      textLayerDiv.style.height = `${mainCanvas.height}px`
      textLayerDiv.style.position = 'absolute'
      textLayerDiv.style.top = '0'
      textLayerDiv.style.left = '0'

      // Render each text item
      textContent.items.forEach((item: any) => {
        const span = document.createElement('span')
        span.textContent = item.str

        // Get text item position and dimensions from transform matrix (base scale)
        const tx = item.transform[4]
        const ty = item.transform[5]

        // Calculate font size and height from transform matrix
        const fontHeight = Math.sqrt((item.transform[2] * item.transform[2]) + (item.transform[3] * item.transform[3]))
        const fontWidth = Math.sqrt((item.transform[0] * item.transform[0]) + (item.transform[1] * item.transform[1]))

        // Get text width from item
        const textWidth = item.width

        // Calculate position - ty is the baseline position
        const baseY = baseViewport.height - ty

        // Apply positioning with current scale
        span.style.position = 'absolute'
        span.style.left = `${tx * currentScale}px`
        span.style.top = `${(baseY - fontHeight) * currentScale}px`
        span.style.fontSize = `${fontHeight * currentScale}px`
        span.style.fontFamily = item.fontName || 'sans-serif'
        span.style.whiteSpace = 'pre'
        span.style.transformOrigin = '0% 0%'
        span.style.width = `${textWidth * currentScale}px`
        span.style.height = `${fontHeight * currentScale}px`

        // Handle font stretching if needed
        if (Math.abs(fontWidth - fontHeight) > 0.1) {
          span.style.transform = `scaleX(${fontWidth / fontHeight})`
        }

        textLayerDiv.appendChild(span)
      })
    } catch (error) {
      console.error('Error rendering text layer:', error)
    }
  }

  const cleanup = async () => {
    if (renderTask.value) {
      try {
        await renderTask.value.cancel()
      } catch (error) {
        // Ignore cancellation errors on unmount
      }
      renderTask.value = null
    }

    if (pdfDoc.value) {
      try {
        await pdfDoc.value.destroy()
      } catch (error) {
        // Ignore cleanup errors
      }
      pdfDoc.value = null
    }
  }

  return {
    pdfDoc,
    canvasRef,
    gridCanvasRef,
    textLayerRef,
    loadPDF,
    renderPage,
    renderTextLayer,
    cleanup
  }
}
