<template>
  <div class="pdf-viewer-container h-full flex flex-col bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
    <!-- No PDF Loaded State -->
    <div v-if="!documentStore.activeDocument" class="flex items-center justify-center h-full">
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
          <DrawingToolbar
            v-if="documentStore.activeDocument"
            @select-tool="handleToolSelection"
          />

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

            <!-- Form Fields Overlay -->
            <FormFieldsOverlay
              v-if="canvasRef"
              :canvas-width="canvasRef?.width || 0"
              :canvas-height="canvasRef?.height || 0"
            />

            <!-- Image Preview Overlay -->
            <div
              v-if="editorStore.imagePreview"
              class="image-preview-container"
              :style="{
                left: `${editorStore.imagePreview.x}px`,
                top: `${editorStore.imagePreview.y}px`,
                width: `${editorStore.imagePreview.width}px`,
                height: `${editorStore.imagePreview.height}px`
              }"
            >
              <img
                :src="editorStore.imagePreview.dataUrl"
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

            <!-- Text Preview Overlay (inside pdf-canvas-wrapper for correct coordinates) -->
            <div
              v-if="editorStore.textPreview"
              class="text-preview-container"
              :style="{
                left: `${editorStore.textPreview.x}px`,
                top: `${editorStore.textPreview.y}px`
              }"
              @mousedown="startTextDrag"
            >
              <input
                ref="textPreviewInput"
                type="text"
                class="text-preview-input"
                :value="editorStore.textPreview.text"
                @input="handleTextInput"
                @mousedown.stop
                @click.stop
                placeholder="Escribe aquí..."
                :style="{
                  fontSize: `${editorStore.textPreview.fontSize}px`,
                  color: editorStore.textPreview.color,
                  fontWeight: editorStore.textPreview.isBold ? 'bold' : 'normal',
                  fontStyle: editorStore.textPreview.isItalic ? 'italic' : 'normal'
                }"
              />
            </div>
          </div>

          <!-- Image Placement Controls -->
          <ImageControls
            v-if="editorStore.imagePreview"
            :maintain-aspect-ratio="editorStore.imagePreview.maintainAspectRatio"
            @toggle-aspect-ratio="editorStore.toggleMaintainAspectRatio()"
            @reset-size="editorStore.resetImageSize()"
            @flip-horizontal="toggleFlipHorizontal"
            @flip-vertical="toggleFlipVertical"
            @confirm="confirmImagePlacement"
            @cancel="cancelImagePlacement"
          />

          <!-- Text Placement Controls -->
          <TextControls
            v-if="editorStore.textPreview"
            :text="editorStore.textPreview.text"
            :font-size="editorStore.textPreview.fontSize"
            :color="editorStore.textPreview.color"
            :is-bold="editorStore.textPreview.isBold"
            :is-italic="editorStore.textPreview.isItalic"
            @update-text="editorStore.updateTextPreviewText($event)"
            @update-font-size="editorStore.updateTextPreviewFontSize($event)"
            @update-color="editorStore.updateTextPreviewColor($event)"
            @toggle-bold="editorStore.toggleTextBold()"
            @toggle-italic="editorStore.toggleTextItalic()"
            @confirm="confirmTextPlacement"
            @cancel="cancelTextPlacement"
          />
        </div>
      </div>

      <!-- Search Spotlight -->
      <SearchSpotlight
        :is-visible="showSearchSpotlight"
        @close="showSearchSpotlight = false"
        @search="performSpotlightSearch"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import * as pdfjsLib from 'pdfjs-dist'
import { useDocumentStore } from '@/stores/document.store'
import { useDrawingStore } from '@/stores/drawing.store'
import { useEditorStore } from '@/stores/editor.store'
import { useSearchStore } from '@/stores/search.store'
import { usePDFRendering } from '@/composables/usePDFRendering'
import { usePDFSearch } from '@/composables/usePDFSearch'
import { useImagePlacement } from '@/composables/useImagePlacement'
import { useTextPlacement } from '@/composables/useTextPlacement'
import { useGridOverlay } from '@/composables/useGridOverlay'
import PDFToolbar from '../toolbars/PDFToolbar.vue'
import ImageControls from '../toolbars/ImageControls.vue'
import TextControls from '../toolbars/TextControls.vue'
import DrawingToolbar from '../toolbars/DrawingToolbar.vue'
import SearchSpotlight from '../search/SearchSpotlight.vue'
import FormFieldsOverlay from '../form-fields/FormFieldsOverlay.vue'
import { useFormFieldsStore } from '@/stores/formFields.store'
import { usePDFFieldsLoader } from '@/composables/usePDFFieldsLoader'

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).href

const documentStore = useDocumentStore()
const drawingStore = useDrawingStore()
const editorStore = useEditorStore()
const searchStore = useSearchStore()
const formFieldsStore = useFormFieldsStore()

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

const {
  startDrag: startTextDrag,
  confirmTextPlacement,
  cancelTextPlacement
} = useTextPlacement(canvasRef)

const { loadFieldsFromPDF } = usePDFFieldsLoader()

const { drawGrid } = useGridOverlay(canvasRef, gridCanvasRef)

// Search spotlight state
const showSearchSpotlight = ref(false)

// Text preview input ref
const textPreviewInput = ref<HTMLInputElement | null>(null)

// Handle text input
const handleTextInput = (event: Event) => {
  const target = event.target as HTMLInputElement
  editorStore.updateTextPreviewText(target.value)
}

// Computed properties
const currentPage = computed(() => documentStore.activeDocument?.currentPage || 1)
const numPages = computed(() => documentStore.activeDocument?.numPages || 0)
const scale = computed(() => documentStore.activeDocument?.scale || 1.5)
const rotation = computed(() => documentStore.activeDocument?.rotation || 0)

// Navigation methods
const nextPage = () => {
  if (currentPage.value < numPages.value) {
    documentStore.setCurrentPage(currentPage.value + 1)
  }
}

const previousPage = () => {
  if (currentPage.value > 1) {
    documentStore.setCurrentPage(currentPage.value - 1)
  }
}

const zoomIn = () => {
  documentStore.setScale(scale.value + 0.25)
}

const zoomOut = () => {
  documentStore.setScale(scale.value - 0.25)
}

const rotate = () => {
  documentStore.setRotation(rotation.value + 90)
}

// Handle toolbar tool selection
const handleToolSelection = (toolId: string) => {
  switch (toolId) {
    case 'search':
      showSearchSpotlight.value = true
      break
    case 'text':
      // Create a default text preview at center of canvas
      const canvasWidth = canvasRef.value?.width || 800
      const canvasHeight = canvasRef.value?.height || 1000
      editorStore.setTextPreview({
        text: '',
        x: canvasWidth / 2 - 100,
        y: canvasHeight / 2,
        fontSize: 16,
        color: '#000000',
        isBold: false,
        isItalic: false
      })
      break
    case 'image':
      // Trigger file input for image selection
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/*'
      input.onchange = async (e: Event) => {
        const target = e.target as HTMLInputElement
        const file = target.files?.[0]
        if (!file) return

        const reader = new FileReader()
        reader.onload = (event) => {
          const dataUrl = event.target?.result as string
          const img = new Image()
          img.onload = () => {
            const maxSize = 300
            let width = img.width
            let height = img.height

            if (width > maxSize || height > maxSize) {
              if (width > height) {
                height = (height / width) * maxSize
                width = maxSize
              } else {
                width = (width / height) * maxSize
                height = maxSize
              }
            }

            editorStore.setImagePreview({
              dataUrl,
              file,
              x: 100,
              y: 100,
              width,
              height,
              originalWidth: width,
              originalHeight: height,
              maintainAspectRatio: true
            })
          }
          img.src = dataUrl
        }
        reader.readAsDataURL(file)
      }
      input.click()
      break
  }
}

// Handle search from spotlight
const performSpotlightSearch = async () => {
  if (pdfDoc.value) {
    await searchTextInPDF()
  }
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
    if (searchStore.searchMatches.length > 0) {
      await drawSearchHighlights()
    }
  }
}

// Variable para rastrear el último documento para el que cargamos campos
const lastLoadedDocId = ref<string | null>(null)

// Watchers
watch(() => documentStore.activeDocument?.id, async (newId, oldId) => {
  if (newId !== oldId && newId) {
    await loadPDF()

    // Solo cargar campos si es un documento diferente al último
    if (newId !== lastLoadedDocId.value) {
      lastLoadedDocId.value = newId
      // Esperamos un poco para asegurar que el documento está completamente cargado
      await nextTick()
      setTimeout(async () => {
        await loadFieldsFromPDF()
      }, 500)
    }
  }
}, { immediate: false })

watch([currentPage, scale, rotation], async () => {
  if (pdfDoc.value) {
    await renderPageWithOverlays()
  }
})

// Watch for PDF reload trigger (when PDF is edited)
watch(() => documentStore.pdfReloadTrigger, async () => {
  await loadPDF()
})

// Watch for search query changes
watch(() => searchStore.searchQuery, async (newQuery) => {
  if (newQuery && pdfDoc.value) {
    await searchTextInPDF()
  } else {
    clearSearchHighlights()
  }
})

// Watch for current match index changes to update highlights
watch(() => searchStore.currentMatchIndex, async () => {
  if (searchStore.searchMatches.length > 0) {
    await drawSearchHighlights()

    // Navigate to page if current match is on different page
    const currentMatch = searchStore.searchMatches[searchStore.currentMatchIndex]
    if (currentMatch && currentMatch.pageIndex !== currentPage.value - 1) {
      documentStore.setCurrentPage(currentMatch.pageIndex + 1)
    }
  }
})

// Watch for grid enabled changes to update grid overlay immediately
watch(() => drawingStore.gridEnabled, () => {
  drawGrid()
})

// Watch for snap to grid changes
watch(() => drawingStore.snapToGrid, () => {
  // Grid visibility doesn't need to change, but we might want to provide visual feedback
})

// Watch for text preview creation to focus input
watch(() => editorStore.textPreview, async (newValue) => {
  if (newValue) {
    await nextTick()
    textPreviewInput.value?.focus()
  }
})

// Expose pdfDoc for parent components (like PageThumbnails)
defineExpose({
  pdfDoc
})

// Lifecycle hooks
onMounted(async () => {
  await loadPDF()

  // Si ya hay un documento activo al montar, cargar sus campos
  if (documentStore.activeDocument?.id) {
    lastLoadedDocId.value = documentStore.activeDocument.id
    await nextTick()
    setTimeout(async () => {
      await loadFieldsFromPDF()
    }, 500)
  }
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

.text-preview-container {
  position: absolute;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.2);
  border: 2px dashed #6366f1;
  border-radius: 4px;
  z-index: 10;
  cursor: move;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  min-width: 150px;
  font-family: Helvetica, Arial, sans-serif;
}

.text-preview-container:hover {
  border-color: #4f46e5;
  background: rgba(255, 255, 255, 0.5);
}

.text-preview-input {
  width: 100%;
  border: none;
  outline: none;
  background: transparent;
  font-family: inherit;
  cursor: text;
  padding: 0;
}

.text-preview-input::placeholder {
  color: #9ca3af;
}
</style>
