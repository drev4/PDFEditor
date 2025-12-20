<template>
  <div class="page-thumbnails-container">
    <div class="thumbnails-header">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-bold text-gray-700 uppercase tracking-wide">
          Pages
        </h3>
        <span class="text-xs bg-indigo-100 text-indigo-700 px-2 py-1 rounded-full font-semibold">
          {{ pdfStore.activeDocument?.numPages || 0 }}
        </span>
      </div>
    </div>

    <div class="thumbnails-content">
      <!-- Loading State -->
      <div v-if="!pdfDoc" class="text-center py-8">
        <ProgressSpinner style="width: 40px; height: 40px" />
        <p class="text-sm text-gray-500 mt-2">Loading pages...</p>
      </div>

      <!-- Thumbnails Grid -->
      <div v-else class="thumbnails-grid space-y-3">
      <div
        v-for="pageNum in pageOrder"
        :key="`page-${pageNum}`"
        draggable="true"
        @dragstart="onDragStart($event, pageNum)"
        @dragover.prevent="onDragOver($event, pageNum)"
        @drop="onDrop($event, pageNum)"
        @dragend="onDragEnd"
        @click="goToPage(pageNum)"
        :class="[
          'thumbnail-card group cursor-move transition-all duration-200',
          pageNum === currentPage
            ? 'ring-2 ring-blue-600 bg-blue-50'
            : 'hover:ring-2 hover:ring-gray-300 bg-white',
          draggedPage === pageNum ? 'opacity-50' : '',
          dropTargetPage === pageNum ? 'ring-2 ring-green-500' : ''
        ]"
      >
        <!-- Page Number Badge -->
        <div class="absolute top-2 right-2 z-10">
          <span :class="[
            'text-xs font-bold px-2 py-1 rounded-full shadow-sm',
            pageNum === currentPage
              ? 'bg-blue-600 text-white'
              : 'bg-white text-gray-700'
          ]">
            {{ pageNum }}
          </span>
        </div>

        <!-- Thumbnail Image -->
        <div class="thumbnail-image-container">
          <img
            v-if="thumbnails.get(pageNum)"
            :src="thumbnails.get(pageNum)"
            :alt="`Page ${pageNum}`"
            class="thumbnail-image"
          />
          <div v-else class="thumbnail-placeholder">
            <i class="pi pi-image text-3xl text-gray-400"></i>
            <p class="text-xs text-gray-500 mt-2">Loading...</p>
          </div>
        </div>

        <!-- Page Info -->
        <div :class="[
          'thumbnail-info',
          pageNum === currentPage
            ? 'bg-blue-600 text-white'
            : 'bg-gray-50 text-gray-700 group-hover:bg-gray-100'
        ]">
          <span class="text-xs font-medium">Page {{ pageNum }}</span>
        </div>
      </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, computed } from 'vue'
import ProgressSpinner from 'primevue/progressspinner'
import { usePdfStore } from '@/stores/pdfStore'
import { useThumbnails } from '@/composables/useThumbnails'

const props = defineProps<{
  pdfDoc: any
}>()

const pdfStore = usePdfStore()
const { generateThumbnail } = useThumbnails()

const thumbnails = ref<Map<number, string>>(new Map())
const isLoading = ref(false)

// Drag and drop state
const draggedPage = ref<number | null>(null)
const dropTargetPage = ref<number | null>(null)

const totalPages = computed(() => pdfStore.activeDocument?.numPages || 0)
const currentPage = computed(() => pdfStore.activeDocument?.currentPage || 1)

// Page order - initially just sequential
const pageOrder = computed(() => {
  if (!pdfStore.activeDocument) return []
  return pdfStore.activeDocument.pageOrder || Array.from({ length: totalPages.value }, (_, i) => i + 1)
})

const goToPage = (pageNum: number) => {
  pdfStore.setCurrentPage(pageNum)
}

// Drag and drop handlers
const onDragStart = (event: DragEvent, pageNum: number) => {
  draggedPage.value = pageNum
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', pageNum.toString())
  }
}

const onDragOver = (event: DragEvent, pageNum: number) => {
  event.preventDefault()
  dropTargetPage.value = pageNum
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
}

const onDrop = (event: DragEvent, targetPageNum: number) => {
  event.preventDefault()

  if (draggedPage.value === null || draggedPage.value === targetPageNum) {
    dropTargetPage.value = null
    return
  }

  // Get current page order
  const currentOrder = [...pageOrder.value]

  // Find indices
  const draggedIndex = currentOrder.indexOf(draggedPage.value)
  const targetIndex = currentOrder.indexOf(targetPageNum)

  if (draggedIndex === -1 || targetIndex === -1) return

  // Reorder
  const [removed] = currentOrder.splice(draggedIndex, 1)
  currentOrder.splice(targetIndex, 0, removed)

  // Update store
  pdfStore.updatePageOrder(currentOrder)

  // Clear drop target
  dropTargetPage.value = null
}

const onDragEnd = () => {
  draggedPage.value = null
  dropTargetPage.value = null
}

const loadThumbnails = async () => {
  if (!props.pdfDoc || !totalPages.value) return

  // Validate that the pdfDoc has the correct number of pages
  if (props.pdfDoc.numPages !== totalPages.value) {
    // PDF is not fully loaded yet, skip
    return
  }

  isLoading.value = true

  // Clear previous thumbnails when loading new document
  thumbnails.value.clear()

  try {
    // Load thumbnails progressively
    // First load visible ones (first 5), then load the rest
    const visiblePages = Math.min(5, totalPages.value)

    // Load first batch (visible pages)
    for (let i = 1; i <= visiblePages; i++) {
      // Double check that pdfDoc is still valid
      if (!props.pdfDoc || props.pdfDoc.numPages < i) break

      const thumbnail = await generateThumbnail(props.pdfDoc, i, 150)
      if (thumbnail) {
        thumbnails.value.set(i, thumbnail)
      }
    }

    // Load remaining pages in background
    if (totalPages.value > visiblePages) {
      setTimeout(async () => {
        for (let i = visiblePages + 1; i <= totalPages.value; i++) {
          // Check if pdfDoc is still valid before each request
          if (!props.pdfDoc || props.pdfDoc.numPages < i) break

          const thumbnail = await generateThumbnail(props.pdfDoc, i, 150)
          if (thumbnail) {
            thumbnails.value.set(i, thumbnail)
          }
        }
      }, 100)
    }
  } catch (error) {
    console.error('Error loading thumbnails:', error)
  } finally {
    isLoading.value = false
  }
}

// Watch for active document ID changes AND pdfDoc availability
watch(
  [() => pdfStore.activeDocument?.id, () => props.pdfDoc],
  ([newId, newPdfDoc]) => {
    if (newId && newPdfDoc) {
      // Document changed or PDF loaded, wait a bit for PDF to fully load, then reload thumbnails
      setTimeout(() => {
        loadThumbnails()
      }, 300)
    } else if (!newPdfDoc) {
      // PDF not available, clear thumbnails
      thumbnails.value.clear()
    }
  }
)

onMounted(() => {
  // Initial load if pdfDoc is already available
  if (props.pdfDoc && pdfStore.activeDocument) {
    setTimeout(() => {
      loadThumbnails()
    }, 300)
  }
})
</script>

<style scoped>
.page-thumbnails-container {
  max-height: 90vh;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.thumbnails-header {
  padding: 1.5rem 1.5rem 1rem 1.5rem;
  flex-shrink: 0;
}

.thumbnails-content {
  flex: 1;
  overflow-y: auto;
  padding: 0 1.5rem 1.5rem 1.5rem;
}

.thumbnails-grid {
  display: flex;
  flex-direction: column;
}

.thumbnail-card {
  position: relative;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  transition: all 0.2s ease;
}

.thumbnail-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  transform: translateY(-2px);
}

.thumbnail-card:active {
  cursor: grabbing !important;
}

.thumbnail-image-container {
  width: 100%;
  aspect-ratio: 8.5 / 11; /* Standard letter size ratio */
  background: #f8fafc;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.thumbnail-image {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.thumbnail-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

.thumbnail-info {
  padding: 0.5rem;
  text-align: center;
  transition: all 0.2s ease;
}

/* Custom scrollbar for thumbnails */
.thumbnails-content::-webkit-scrollbar {
  width: 6px;
}

.thumbnails-content::-webkit-scrollbar-track {
  background: transparent;
}

.thumbnails-content::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 3px;
}

.thumbnails-content::-webkit-scrollbar-thumb:hover {
  background: #94a3b8;
}
</style>
