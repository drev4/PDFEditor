<template>
  <div class="page-thumbnails-container">
    <div class="thumbnails-header">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-bold text-ink uppercase tracking-wide">
          Pages
        </h3>
        <span class="text-xs bg-accent-soft text-accent px-2 py-1 rounded-full font-semibold">
          {{ documentStore.activeDocument?.numPages || 0 }}
        </span>
      </div>
    </div>

    <div class="thumbnails-content">
      <!-- Loading State -->
      <div v-if="!pdfDoc" class="text-center py-8">
        <ProgressSpinner style="width: 40px; height: 40px" />
        <p class="text-sm text-muted mt-2">Loading pages...</p>
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
            ? 'ring-2 ring-accent bg-accent-soft'
            : 'hover:ring-2 hover:ring-line bg-white',
          draggedPage === pageNum ? 'opacity-50' : '',
          dropTargetPage === pageNum ? 'ring-2 ring-published' : ''
        ]"
      >
        <!-- Page Number Badge -->
        <div class="absolute top-2 right-2 z-10">
          <span :class="[
            'text-xs font-bold px-2 py-1 rounded-full shadow-sm',
            pageNum === currentPage
              ? 'bg-accent text-white'
              : 'bg-white text-ink'
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
            <i class="pi pi-image text-3xl text-faint"></i>
            <p class="text-xs text-muted mt-2">Loading...</p>
          </div>
        </div>

        <!-- Page Info -->
        <div :class="[
          'thumbnail-info',
          pageNum === currentPage
            ? 'bg-accent text-white'
            : 'bg-surface-subtle text-ink group-hover:bg-surface-sunken'
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
import { useDocumentStore } from '@/stores/document.store'
import { useThumbnails } from '@/composables/useThumbnails'

const props = defineProps<{
  pdfDoc: any
}>()

const documentStore = useDocumentStore()
const { generateThumbnail } = useThumbnails()

const thumbnails = ref<Map<number, string>>(new Map())
const isLoading = ref(false)

// Drag and drop state
const draggedPage = ref<number | null>(null)
const dropTargetPage = ref<number | null>(null)

const totalPages = computed(() => documentStore.activeDocument?.numPages || 0)
const currentPage = computed(() => documentStore.activeDocument?.currentPage || 1)

// Page order - initially just sequential
const pageOrder = computed(() => {
  if (!documentStore.activeDocument) return []
  return documentStore.activeDocument.pageOrder || Array.from({ length: totalPages.value }, (_, i) => i + 1)
})

const goToPage = (pageNum: number) => {
  documentStore.setCurrentPage(pageNum)
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
  if (removed !== undefined) {
    currentOrder.splice(targetIndex, 0, removed)
  }

  // Update store
  documentStore.updatePageOrder(currentOrder)

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
  [() => documentStore.activeDocument?.id, () => props.pdfDoc],
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
  if (props.pdfDoc && documentStore.activeDocument) {
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
  background: #fbfbfc;
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
  background: #d8dae1;
  border-radius: 3px;
}

.thumbnails-content::-webkit-scrollbar-thumb:hover {
  background: #9ba1ac;
}
</style>
