<template>
  <div class="pdf-viewer-container h-full flex flex-col bg-gray-100">
    <div v-if="!pdfStore.activeDocument" class="flex items-center justify-center h-full">
      <div class="text-center">
        <i class="pi pi-file-pdf text-6xl text-gray-400 mb-4"></i>
        <p class="text-gray-600 text-lg">No PDF loaded</p>
      </div>
    </div>

    <div v-else class="flex flex-col h-full">
      <!-- Toolbar -->
      <div class="bg-white shadow-md p-3 flex items-center justify-between border-b">
        <div class="flex items-center gap-3">
          <Button
            icon="pi pi-chevron-left"
            @click="previousPage"
            :disabled="currentPage <= 1"
            size="small"
            outlined
          />
          <span class="text-sm font-medium">
            Page {{ currentPage }} of {{ numPages }}
          </span>
          <Button
            icon="pi pi-chevron-right"
            @click="nextPage"
            :disabled="currentPage >= numPages"
            size="small"
            outlined
          />
        </div>

        <div class="flex items-center gap-3">
          <Button
            icon="pi pi-search-minus"
            @click="zoomOut"
            size="small"
            outlined
          />
          <span class="text-sm font-medium">{{ Math.round(scale * 100) }}%</span>
          <Button
            icon="pi pi-search-plus"
            @click="zoomIn"
            size="small"
            outlined
          />
          <Button
            icon="pi pi-refresh"
            @click="rotate"
            size="small"
            outlined
          />
        </div>
      </div>

      <!-- PDF Canvas Container -->
      <div class="flex-1 overflow-auto p-4 flex justify-center" ref="viewportRef">
        <div class="pdf-document-container">
        <div class="pdf-canvas-wrapper" :style="{ transform: `rotate(${rotation}deg)` }">
          <!-- Grid Overlay -->
          <canvas
            v-if="pdfStore.gridEnabled"
            ref="gridCanvasRef"
            class="grid-overlay"
          ></canvas>

          <canvas
            ref="canvasRef"
            class="shadow-lg bg-white"
          ></canvas>

          <!-- Search Highlights Overlay -->
          <canvas
            ref="searchCanvasRef"
            class="search-overlay"
          ></canvas>

          <!-- Text Selection Layer -->
          <div
            ref="textLayerRef"
            class="text-layer"
          ></div>

          <!-- Image Preview Overlay -->
          <div
            v-if="pdfStore.imagePreview"
            class="image-preview-container"
            :style="{
              left: `${pdfStore.imagePreview.x}px`,
              top: `${pdfStore.imagePreview.y}px`,
              width: `${pdfStore.imagePreview.width}px`,
              height: `${pdfStore.imagePreview.height}px`
            }"
          >
            <img
              :src="pdfStore.imagePreview.dataUrl"
              class="image-preview"
              :style="{
                transform: `scaleX(${flipHorizontal ? -1 : 1}) scaleY(${flipVertical ? -1 : 1})`
              }"
              @mousedown="startDrag"
            />

            <!-- Resize Handles -->
            <div class="resize-handle nw" @mousedown.stop="startResize($event, 'nw')"></div>
            <div class="resize-handle ne" @mousedown.stop="startResize($event, 'ne')"></div>
            <div class="resize-handle sw" @mousedown.stop="startResize($event, 'sw')"></div>
            <div class="resize-handle se" @mousedown.stop="startResize($event, 'se')"></div>
          </div>
        </div>

        <!-- Image Placement Controls -->
        <div v-if="pdfStore.imagePreview" class="image-controls">
          <div class="image-controls-row">
            <Button
              :label="pdfStore.imagePreview.maintainAspectRatio ? 'Lock Ratio' : 'Free Resize'"
              :icon="pdfStore.imagePreview.maintainAspectRatio ? 'pi pi-lock' : 'pi pi-lock-open'"
              @click="pdfStore.toggleMaintainAspectRatio()"
              :severity="pdfStore.imagePreview.maintainAspectRatio ? 'info' : 'secondary'"
              size="small"
              outlined
            />
            <Button
              label="Reset Size"
              icon="pi pi-refresh"
              @click="pdfStore.resetImageSize()"
              severity="secondary"
              size="small"
              outlined
            />
            <Button
              label="Flip H"
              icon="pi pi-arrows-h"
              @click="toggleFlipHorizontal"
              severity="secondary"
              size="small"
              outlined
            />
            <Button
              label="Flip V"
              icon="pi pi-arrows-v"
              @click="toggleFlipVertical"
              severity="secondary"
              size="small"
              outlined
            />
          </div>
          <div class="image-controls-row">
            <Button
              label="Confirm"
              icon="pi pi-check"
              @click="confirmImagePlacement"
              severity="success"
              size="small"
            />
            <Button
              label="Cancel"
              icon="pi pi-times"
              @click="cancelImagePlacement"
              severity="danger"
              size="small"
              outlined
            />
          </div>
        </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed, shallowRef } from 'vue'
import * as pdfjsLib from 'pdfjs-dist'
import Button from 'primevue/button'
import { usePdfStore } from '@/stores/pdfStore'

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).href

const pdfStore = usePdfStore()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const gridCanvasRef = ref<HTMLCanvasElement | null>(null)
const searchCanvasRef = ref<HTMLCanvasElement | null>(null)
const textLayerRef = ref<HTMLDivElement | null>(null)
const viewportRef = ref<HTMLDivElement | null>(null)
const pdfDoc = shallowRef<any>(null)
const renderTask = shallowRef<any>(null)

const currentPage = computed(() => pdfStore.activeDocument?.currentPage || 1)
const numPages = computed(() => pdfStore.activeDocument?.numPages || 0)
const scale = computed(() => pdfStore.activeDocument?.scale || 1.5)
const rotation = computed(() => pdfStore.activeDocument?.rotation || 0)

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
    const page = await pdfDoc.value.getPage(currentPage.value)
    const canvas = canvasRef.value
    const context = canvas.getContext('2d')

    if (!context) return

    const viewport = page.getViewport({ scale: scale.value, rotation: rotation.value })

    canvas.height = viewport.height
    canvas.width = viewport.width

    const renderContext = {
      canvasContext: context,
      viewport: viewport
    }

    renderTask.value = page.render(renderContext)
    await renderTask.value.promise
    renderTask.value = null

    // Draw grid after rendering page
    drawGrid()

    // Render text layer for text selection
    await renderTextLayer()

    // Draw search highlights if there are active search results
    if (pdfStore.searchMatches.length > 0) {
      await drawSearchHighlights()
    }
  } catch (error: any) {
    if (error?.name === 'RenderingCancelledException') {
      // Render was cancelled, this is expected
      return
    }
    console.error('Error rendering page:', error)
  }
}

const drawGrid = () => {
  if (!gridCanvasRef.value || !canvasRef.value || !pdfStore.gridEnabled) return

  const gridCanvas = gridCanvasRef.value
  const mainCanvas = canvasRef.value

  // Match grid canvas size to main canvas
  gridCanvas.width = mainCanvas.width
  gridCanvas.height = mainCanvas.height

  const ctx = gridCanvas.getContext('2d')
  if (!ctx) return

  ctx.clearRect(0, 0, gridCanvas.width, gridCanvas.height)

  const gridSize = pdfStore.gridSize

  // Draw grid lines
  ctx.strokeStyle = 'rgba(200, 200, 200, 0.3)'
  ctx.lineWidth = 1

  // Draw vertical lines
  for (let x = 0; x <= gridCanvas.width; x += gridSize) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, gridCanvas.height)
    ctx.stroke()
  }

  // Draw horizontal lines
  for (let y = 0; y <= gridCanvas.height; y += gridSize) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(gridCanvas.width, y)
    ctx.stroke()
  }
}

const searchTextInPDF = async () => {
  if (!pdfDoc.value || !pdfStore.searchQuery) {
    pdfStore.setSearchMatches([])
    pdfStore.setIsSearching(false)
    return
  }

  try {
    const matches: any[] = []
    const query = pdfStore.searchQuery.toLowerCase()

    // Search in all pages - use scale 1.0 to get base coordinates
    for (let pageNum = 1; pageNum <= pdfDoc.value.numPages; pageNum++) {
      const page = await pdfDoc.value.getPage(pageNum)
      const textContent = await page.getTextContent()
      const viewport = page.getViewport({ scale: 1.0 }) // Base scale

      textContent.items.forEach((item: any) => {
        const text = item.str.toLowerCase()
        if (text.includes(query)) {
          // Calculate font size from transform matrix
          const fontSize = Math.sqrt(
            (item.transform[2] * item.transform[2]) +
            (item.transform[3] * item.transform[3])
          )

          // Get width - use the actual width
          const textWidth = item.width

          // Store coordinates at scale 1.0 (base coordinates)
          matches.push({
            pageIndex: pageNum - 1,
            textIndex: matches.length,
            text: item.str,
            bounds: {
              x: item.transform[4],
              y: viewport.height - item.transform[5] - fontSize,
              width: textWidth,
              height: fontSize
            }
          })
        }
      })
    }

    pdfStore.setSearchMatches(matches)
    pdfStore.setIsSearching(false)

    // Draw highlights for current page
    await drawSearchHighlights()
  } catch (error) {
    console.error('Error searching text:', error)
    pdfStore.setIsSearching(false)
  }
}

const drawSearchHighlights = async () => {
  if (!searchCanvasRef.value || !canvasRef.value) return

  const searchCanvas = searchCanvasRef.value
  const mainCanvas = canvasRef.value

  // Match search canvas size to main canvas
  searchCanvas.width = mainCanvas.width
  searchCanvas.height = mainCanvas.height

  const ctx = searchCanvas.getContext('2d')
  if (!ctx) return

  ctx.clearRect(0, 0, searchCanvas.width, searchCanvas.height)

  // Draw highlights for matches on current page
  const currentPageMatches = pdfStore.searchMatches.filter(
    (match: any) => match.pageIndex === currentPage.value - 1
  )

  if (!pdfDoc.value) return

  // Get the current scale to apply to base coordinates
  const currentScale = scale.value

  currentPageMatches.forEach((match: any) => {
    const isCurrentMatch = pdfStore.searchMatches.indexOf(match) === pdfStore.currentMatchIndex

    // Highlight color: yellow for all matches, orange for current match
    ctx.fillStyle = isCurrentMatch ? 'rgba(255, 165, 0, 0.4)' : 'rgba(255, 255, 0, 0.3)'

    // Apply current scale to base coordinates
    ctx.fillRect(
      match.bounds.x * currentScale,
      match.bounds.y * currentScale,
      match.bounds.width * currentScale,
      match.bounds.height * currentScale
    )
  })
}

const renderTextLayer = async () => {
  if (!textLayerRef.value || !pdfDoc.value || !canvasRef.value) return

  const textLayerDiv = textLayerRef.value
  const mainCanvas = canvasRef.value

  // Clear previous text layer
  textLayerDiv.innerHTML = ''

  try {
    const page = await pdfDoc.value.getPage(currentPage.value)
    const textContent = await page.getTextContent()

    // Get viewport at base scale to get correct height
    const baseViewport = page.getViewport({ scale: 1.0 })
    const currentScale = scale.value

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

const nextPage = () => {
  if (currentPage.value < numPages.value) {
    pdfStore.setCurrentPage(currentPage.value + 1)
  }
}

const previousPage = () => {
  if (currentPage.value > 1) {
    pdfStore.setCurrentPage(currentPage.value - 1)
  }
}

const zoomIn = () => {
  pdfStore.setScale(scale.value + 0.25)
}

const zoomOut = () => {
  pdfStore.setScale(scale.value - 0.25)
}

const rotate = () => {
  pdfStore.setRotation(rotation.value + 90)
}

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

const snapToGridValue = (value: number): number => {
  if (!pdfStore.snapToGrid) return value
  return Math.round(value / pdfStore.gridSize) * pdfStore.gridSize
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

// Watch for changes
watch(() => pdfStore.activeDocument?.id, async (newId, oldId) => {
  if (newId !== oldId) {
    await loadPDF()
  }
})

watch([currentPage, scale, rotation], async () => {
  if (pdfDoc.value) {
    await renderPage()
  }
})

// Watch for PDF reload trigger (when PDF is edited)
watch(() => pdfStore.pdfReloadTrigger, async () => {
  await loadPDF()
})

// Watch for search query changes
watch(() => pdfStore.searchQuery, async (newQuery) => {
  if (newQuery && pdfDoc.value) {
    await searchTextInPDF()
  } else {
    // Clear highlights when search is cleared
    if (searchCanvasRef.value) {
      const ctx = searchCanvasRef.value.getContext('2d')
      if (ctx) {
        ctx.clearRect(0, 0, searchCanvasRef.value.width, searchCanvasRef.value.height)
      }
    }
  }
})

// Watch for current match index changes to update highlights
watch(() => pdfStore.currentMatchIndex, async () => {
  if (pdfStore.searchMatches.length > 0) {
    await drawSearchHighlights()

    // Navigate to page if current match is on different page
    const currentMatch = pdfStore.searchMatches[pdfStore.currentMatchIndex]
    if (currentMatch && currentMatch.pageIndex !== currentPage.value - 1) {
      pdfStore.setCurrentPage(currentMatch.pageIndex + 1)
    }
  }
})

onMounted(async () => {
  await loadPDF()
})

onUnmounted(async () => {
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
})
</script>

<style scoped>
.pdf-viewer-container {
  position: relative;
}

.pdf-canvas-wrapper {
  position: relative;
  transition: transform 0.3s ease;
}

canvas {
  display: block;
  max-width: 100%;
  height: auto;
}

.pdf-document-container {
  position: relative;
  display: inline-block;
}

.grid-overlay {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  z-index: 5;
}

.ruler-corner {
  position: absolute;
  top: -25px;
  left: -25px;
  width: 25px;
  height: 25px;
  background: #e8e8e8;
  border-right: 1px solid #d0d0d0;
  border-bottom: 1px solid #d0d0d0;
  z-index: 20;
}

.ruler-horizontal {
  position: absolute;
  top: -25px;
  left: 0;
  width: 100%;
  height: 25px;
  background: linear-gradient(to bottom, #f8f8f8 0%, #e8e8e8 100%);
  border-bottom: 1px solid #d0d0d0;
  z-index: 15;
  overflow: hidden;
}

.ruler-vertical {
  position: absolute;
  top: 0;
  left: -25px;
  height: 100%;
  width: 25px;
  background: linear-gradient(to right, #f8f8f8 0%, #e8e8e8 100%);
  border-right: 1px solid #d0d0d0;
  z-index: 15;
  overflow: hidden;
}

.ruler-horizontal .ruler-mark {
  position: absolute;
  height: 100%;
}

.ruler-vertical .ruler-mark {
  position: absolute;
  width: 100%;
}

.ruler-tick {
  background: #888;
}

.ruler-horizontal .ruler-tick {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 1px;
  height: 8px;
}

.ruler-vertical .ruler-tick {
  position: absolute;
  right: 0;
  top: 0;
  height: 1px;
  width: 8px;
}

.ruler-label {
  position: absolute;
  font-size: 9px;
  font-family: monospace;
  color: #444;
  user-select: none;
  font-weight: 500;
}

.ruler-horizontal .ruler-label {
  bottom: 2px;
  left: 2px;
  transform: translateX(-50%);
}

.ruler-vertical .ruler-label {
  right: 2px;
  top: 2px;
  transform: translateY(-50%) rotate(-90deg);
  transform-origin: right center;
}

.image-preview-container {
  position: absolute;
  border: 2px dashed #3b82f6;
  z-index: 10;
  user-select: none;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

.image-preview-container:hover {
  border-color: #2563eb;
}

.image-preview {
  width: 100%;
  height: 100%;
  object-fit: fill;
  cursor: move;
  opacity: 0.8;
  pointer-events: auto;
}

.image-preview:hover {
  opacity: 0.9;
}

.resize-handle {
  position: absolute;
  width: 12px;
  height: 12px;
  background: #3b82f6;
  border: 2px solid white;
  border-radius: 50%;
  z-index: 11;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.resize-handle:hover {
  background: #2563eb;
  transform: scale(1.2);
}

.resize-handle.nw {
  top: -6px;
  left: -6px;
  cursor: nw-resize;
}

.resize-handle.ne {
  top: -6px;
  right: -6px;
  cursor: ne-resize;
}

.resize-handle.sw {
  bottom: -6px;
  left: -6px;
  cursor: sw-resize;
}

.resize-handle.se {
  bottom: -6px;
  right: -6px;
  cursor: se-resize;
}

.image-controls {
  position: fixed;
  bottom: 2rem;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  z-index: 20;
  background: white;
  padding: 1rem;
  border-radius: 0.5rem;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.image-controls-row {
  display: flex;
  gap: 0.5rem;
  justify-content: center;
  align-items: center;
}

.search-overlay {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  z-index: 6;
  display: block;
}

.text-layer {
  position: absolute;
  top: 0;
  left: 0;
  overflow: hidden;
  line-height: 1;
  z-index: 7;
  pointer-events: auto;
  user-select: text;
  opacity: .4;
  color: transparent;
}

.text-layer > span {
  color: transparent;
  position: absolute;
  white-space: pre;
  cursor: text;
  transform-origin: 0% 0%;
  user-select: text;
}

.text-layer ::selection {
  background: rgba(0, 123, 255, 0.4);
  color: transparent;
}
</style>
