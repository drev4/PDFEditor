import { ref, shallowRef } from 'vue'
import * as pdfjsLib from 'pdfjs-dist'
import { useDocumentStore } from '@/stores/document.store'
import type { PDFDocumentProxy, PDFRenderTask, PDFPage, PDFPageViewport, PDFPageTextItem } from '@/types/pdfjs'

export function usePDFRendering() {
  const documentStore = useDocumentStore()

  const pdfDoc = shallowRef<PDFDocumentProxy | null>(null)
  const renderTask = shallowRef<PDFRenderTask | null>(null)
  const canvasRef = ref<HTMLCanvasElement | null>(null)
  const gridCanvasRef = ref<HTMLCanvasElement | null>(null)
  const textLayerRef = ref<HTMLDivElement | null>(null)

  const loadPDF = async () => {
    if (!documentStore.activeDocument?.arrayBuffer) return

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
      const originalBuffer = documentStore.activeDocument.arrayBuffer
      const bufferCopy = originalBuffer.slice(0)

      const loadingTask = pdfjsLib.getDocument({
        data: bufferCopy,
        // pdf.js compiles font programs with `Function`/`eval` when it is allowed
        // to, which would force `script-src 'unsafe-eval'` into the CSP in
        // `index.html` and give back most of what that policy is for. This is the
        // supported way to turn it off; the cost is a slower path for some
        // embedded fonts, not a rendering failure.
        isEvalSupported: false
      })

      const pdf = await loadingTask.promise
      // pdfjs-dist's official types are broader than what this app uses (e.g. text items
      // can include marked-content markers); we only ever call getTextContent() with
      // default options, so items are always TextItem. Assert against our minimal surface.
      pdfDoc.value = pdf as unknown as PDFDocumentProxy
      documentStore.updateDocumentPages(documentStore.activeDocument.id, pdf.numPages)

      await renderPage()
    } catch (error) {
      console.error('Error loading PDF:', error)
      pdfDoc.value = null
    }
  }

  const renderPage = async () => {
    if (!pdfDoc.value || !canvasRef.value) return
    if (!documentStore.activeDocument) return

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
      const currentPage = documentStore.activeDocument.currentPage
      const scale = documentStore.activeDocument.scale
      const rotation = documentStore.activeDocument.rotation

      const page = await pdfDoc.value.getPage(currentPage)
      const mainCanvas = canvasRef.value

      // CREATE OFFSCREEN CANVAS for smoother rendering (no flicker)
      const offscreenCanvas = document.createElement('canvas')
      const offscreenContext = offscreenCanvas.getContext('2d', { alpha: false })

      if (!offscreenContext) return

      const viewport = page.getViewport({ scale, rotation })

      offscreenCanvas.height = viewport.height
      offscreenCanvas.width = viewport.width

      // Set background to white to avoid transparent gaps
      offscreenContext.fillStyle = '#ffffff'
      offscreenContext.fillRect(0, 0, viewport.width, viewport.height)

      const renderContext = {
        canvasContext: offscreenContext,
        viewport: viewport,
        enableWebGL: true // Try to enable WebGL for faster rendering if available
      }

      renderTask.value = page.render(renderContext)
      await renderTask.value.promise

      // Update main canvas only AFTER offscreen is ready
      mainCanvas.height = viewport.height
      mainCanvas.width = viewport.width

      const mainContext = mainCanvas.getContext('2d')
      if (mainContext) {
        mainContext.drawImage(offscreenCanvas, 0, 0)
      }

      renderTask.value = null
      return { page, viewport } as { page: PDFPage; viewport: PDFPageViewport }
    } catch (error: unknown) {
      const err = error as { name?: string }
      if (err?.name === 'RenderingCancelledException') {
        return null
      }
      console.error('Error rendering page:', error)
      return null
    }
  }

  const renderTextLayer = async () => {
    if (!textLayerRef.value || !pdfDoc.value || !canvasRef.value) return
    if (!documentStore.activeDocument) return

    const textLayerDiv = textLayerRef.value
    const mainCanvas = canvasRef.value

    // Clear previous text layer
    textLayerDiv.innerHTML = ''

    try {
      const page = await pdfDoc.value.getPage(documentStore.activeDocument.currentPage)
      const textContent = await page.getTextContent()

      // Get viewport at base scale to get correct height
      const baseViewport = page.getViewport({ scale: 1.0 })
      const currentScale = documentStore.activeDocument.scale

      // Set text layer dimensions to match canvas exactly
      textLayerDiv.style.width = `${mainCanvas.width}px`
      textLayerDiv.style.height = `${mainCanvas.height}px`
      textLayerDiv.style.position = 'absolute'
      textLayerDiv.style.top = '0'
      textLayerDiv.style.left = '0'

      // Render each text item
      textContent.items.forEach((item: PDFPageTextItem) => {
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
