<template>
  <div class="pdf-viewer-container h-full flex flex-col bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
    <!-- No PDF Loaded State -->
    <div v-if="!pdfStore.activeDocument" class="flex items-center justify-center h-full">
      <div class="text-center">
        <i class="pi pi-file-pdf text-6xl text-gray-400 mb-4"></i>
        <p class="text-gray-600 text-lg">No PDF loaded</p>
      </div>
    </div>

    <!-- PDF Viewer -->
    <div v-else class="flex flex-col h-full">
      <!-- Toolbar -->
      <PDFToolbar
        :current-page="currentPage"
        :num-pages="numPages"
        :scale="scale"
        @previous-page="previousPage"
        @next-page="nextPage"
        @zoom-in="zoomIn"
        @zoom-out="zoomOut"
        @rotate="rotate"
      />

      <!-- PDF Canvas Container -->
      <div class="flex-1 overflow-auto p-4 flex justify-center" ref="viewportRef">
        <div class="pdf-document-container">
          <!-- Drawing Toolbar Overlay -->
          <DrawingToolbar v-if="pdfStore.activeDocument" />

          <div class="pdf-canvas-wrapper" :style="{ transform: `rotate(${rotation}deg)` }">
            <!-- Grid Overlay -->
            <canvas
              ref="gridCanvasRef"
              class="grid-overlay"
            ></canvas>

            <!-- Main PDF Canvas -->
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
          <ImageControls
            v-if="pdfStore.imagePreview"
            :maintain-aspect-ratio="pdfStore.imagePreview.maintainAspectRatio"
            @toggle-aspect-ratio="pdfStore.toggleMaintainAspectRatio()"
            @reset-size="pdfStore.resetImageSize()"
            @flip-horizontal="toggleFlipHorizontal"
            @flip-vertical="toggleFlipVertical"
            @confirm="confirmImagePlacement"
            @cancel="cancelImagePlacement"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import * as pdfjsLib from 'pdfjs-dist'
import { usePdfStore } from '@/stores/pdfStore'
import { usePDFRendering } from '@/composables/usePDFRendering'
import { usePDFSearch } from '@/composables/usePDFSearch'
import { useImagePlacement } from '@/composables/useImagePlacement'
import { useGridOverlay } from '@/composables/useGridOverlay'
import PDFToolbar from '../toolbars/PDFToolbar.vue'
import ImageControls from '../toolbars/ImageControls.vue'
import DrawingToolbar from '../toolbars/DrawingToolbar.vue'

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).href

const pdfStore = usePdfStore()

// Use composables
const {
  pdfDoc,
  canvasRef,
  gridCanvasRef,
  textLayerRef,
  loadPDF,
  renderPage,
  renderTextLayer,
  cleanup
} = usePDFRendering()

const searchCanvasRef = ref<HTMLCanvasElement | null>(null)
const {
  searchTextInPDF,
  drawSearchHighlights,
  clearSearchHighlights
} = usePDFSearch(pdfDoc, canvasRef, searchCanvasRef)

const {
  flipHorizontal,
  flipVertical,
  toggleFlipHorizontal,
  toggleFlipVertical,
  startDrag,
  startResize,
  confirmImagePlacement,
  cancelImagePlacement
} = useImagePlacement(canvasRef)

const { drawGrid } = useGridOverlay(canvasRef, gridCanvasRef)

// Computed properties
const currentPage = computed(() => pdfStore.activeDocument?.currentPage || 1)
const numPages = computed(() => pdfStore.activeDocument?.numPages || 0)
const scale = computed(() => pdfStore.activeDocument?.scale || 1.5)
const rotation = computed(() => pdfStore.activeDocument?.rotation || 0)

// Navigation methods
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

// Render page with all overlays
const renderPageWithOverlays = async () => {
  const result = await renderPage()
  if (result) {
    // Draw grid after rendering page
    drawGrid()
    // Render text layer for text selection
    await renderTextLayer()
    // Draw search highlights if there are active search results
    if (pdfStore.searchMatches.length > 0) {
      await drawSearchHighlights()
    }
  }
}

// Watchers
watch(() => pdfStore.activeDocument?.id, async (newId, oldId) => {
  if (newId !== oldId) {
    await loadPDF()
  }
})

watch([currentPage, scale, rotation], async () => {
  if (pdfDoc.value) {
    await renderPageWithOverlays()
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
    clearSearchHighlights()
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

// Watch for grid enabled changes to update grid overlay immediately
watch(() => pdfStore.gridEnabled, () => {
  drawGrid()
})

// Watch for snap to grid changes
watch(() => pdfStore.snapToGrid, () => {
  // Grid visibility doesn't need to change, but we might want to provide visual feedback
})

// Expose pdfDoc for parent components (like PageThumbnails)
defineExpose({
  pdfDoc
})

// Lifecycle hooks
onMounted(async () => {
  await loadPDF()
})

onUnmounted(async () => {
  await cleanup()
})
</script>

<style scoped>
.pdf-viewer-container {
  position: relative;
  background: linear-gradient(to bottom, #f8fafc 0%, #f1f5f9 100%);
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
</style>
