<template>
  <div class="pdf-editor bg-white/80 backdrop-blur-lg border-l border-gray-200/50 shadow-xl">
    <!-- Header -->
    <div class="editor-header sticky top-0 bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-4 border-b border-blue-700">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 bg-white/20 backdrop-blur rounded-xl flex items-center justify-center">
          <i class="pi pi-sliders-h text-white text-lg"></i>
        </div>
        <div>
          <h3 class="text-lg font-bold text-white">Editor Tools</h3>
          <p class="text-xs text-blue-100">Customize your PDF</p>
        </div>
      </div>
    </div>

    <div v-if="!pdfStore.activeDocument" class="p-6 text-center text-gray-500">
      <i class="pi pi-info-circle text-4xl mb-2 block"></i>
      <p class="text-sm">No PDF loaded</p>
    </div>

    <div v-else class="editor-content p-6 space-y-6">
      <!-- Search Section -->
      <div class="tool-card">
        <div class="tool-header">
          <div class="tool-icon bg-blue-100">
            <i class="pi pi-search text-blue-600"></i>
          </div>
          <h4 class="tool-title">Search Text</h4>
        </div>
        <div class="tool-body">
          <InputText
            v-model="searchText"
            placeholder="Search in PDF..."
            class="w-full search-input"
            @keyup.enter="performSearch"
          />
          <div class="flex gap-2 mt-3">
            <Button
              label="Search"
              icon="pi pi-search"
              @click="performSearch"
              class="flex-1"
              severity="info"
              :disabled="!searchText"
              :loading="pdfStore.isSearching"
            />
            <Button
              icon="pi pi-times"
              @click="clearSearch"
              severity="secondary"
              outlined
              :disabled="pdfStore.searchMatches.length === 0"
            />
          </div>
          <div v-if="pdfStore.searchMatches.length > 0" class="search-results">
            <span class="text-sm font-semibold text-gray-700">
              {{ pdfStore.currentMatchIndex + 1 }} / {{ pdfStore.searchMatches.length }} matches
            </span>
            <div class="flex gap-1">
              <Button
                icon="pi pi-chevron-up"
                size="small"
                outlined
                severity="info"
                @click="pdfStore.previousSearchMatch()"
              />
              <Button
                icon="pi pi-chevron-down"
                size="small"
                outlined
                severity="info"
                @click="pdfStore.nextSearchMatch()"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- Add Text Section -->
      <div class="tool-card">
        <div class="tool-header">
          <div class="tool-icon bg-indigo-100">
            <i class="pi pi-font text-indigo-600"></i>
          </div>
          <h4 class="tool-title">Add Text</h4>
        </div>
        <div class="tool-body">
          <InputText
            v-model="textInput"
            placeholder="Enter text..."
            class="w-full"
          />
          <div class="flex gap-2 mt-3">
            <InputNumber
              v-model="fontSize"
              :min="8"
              :max="72"
              placeholder="Size"
              class="flex-1"
            />
            <div class="color-picker-wrapper">
              <ColorPicker v-model="textColor" />
            </div>
          </div>
          <Button
            label="Add Text"
            icon="pi pi-plus"
            @click="addText"
            class="w-full mt-3"
            severity="info"
            :disabled="!textInput"
          />
        </div>
      </div>

      <!-- Add Image Section -->
      <div class="tool-card">
        <div class="tool-header">
          <div class="tool-icon bg-purple-100">
            <i class="pi pi-image text-purple-600"></i>
          </div>
          <h4 class="tool-title">Add Image</h4>
        </div>
        <div class="tool-body">
          <FileUpload
            mode="basic"
            accept="image/*"
            :maxFileSize="5000000"
            @select="handleImageUpload"
            :auto="true"
            chooseLabel="Select Image"
            chooseIcon="pi pi-image"
            class="w-full image-upload-btn"
            severity="secondary"
          />
          <p class="text-xs text-gray-500 mt-2">Max size: 5MB</p>
        </div>
      </div>

      <!-- Grid Settings -->
      <div class="tool-card">
        <div class="tool-header">
          <div class="tool-icon bg-teal-100">
            <i class="pi pi-th-large text-teal-600"></i>
          </div>
          <h4 class="tool-title">Grid Settings</h4>
        </div>
        <div class="tool-body">
          <div class="flex items-center justify-between mb-3">
            <span class="text-sm font-medium text-gray-700">Show Grid</span>
            <Button
              :icon="pdfStore.gridEnabled ? 'pi pi-eye' : 'pi pi-eye-slash'"
              @click="pdfStore.toggleGrid()"
              :severity="pdfStore.gridEnabled ? 'info' : 'secondary'"
              outlined
              size="small"
            />
          </div>
          <div class="flex items-center justify-between">
            <span class="text-sm font-medium text-gray-700">Snap to Grid</span>
            <Button
              :icon="pdfStore.snapToGrid ? 'pi pi-lock' : 'pi pi-lock-open'"
              @click="pdfStore.toggleSnapToGrid()"
              :severity="pdfStore.snapToGrid ? 'info' : 'secondary'"
              outlined
              size="small"
            />
          </div>
        </div>
      </div>

      <!-- Page Operations -->
      <div class="tool-card">
        <div class="tool-header">
          <div class="tool-icon bg-orange-100">
            <i class="pi pi-file text-orange-600"></i>
          </div>
          <h4 class="tool-title">Page Operations</h4>
        </div>
        <div class="tool-body space-y-2">
          <Button
            label="Add Blank Page"
            icon="pi pi-plus-circle"
            @click="addBlankPage"
            class="w-full"
            severity="info"
            outlined
          />
          <Button
            label="Delete Current Page"
            icon="pi pi-trash"
            severity="danger"
            outlined
            @click="deleteCurrentPage"
            class="w-full"
            :disabled="pdfStore.activeDocument.numPages <= 1"
          />
        </div>
      </div>

      <!-- Edit History -->
      <div class="tool-card">
        <div class="tool-header">
          <div class="tool-icon bg-gray-100">
            <i class="pi pi-history text-gray-600"></i>
          </div>
          <div class="flex-1">
            <h4 class="tool-title">Edit History</h4>
            <p class="text-xs text-gray-500">{{ pdfStore.editHistory.length }} changes</p>
          </div>
        </div>
        <div class="tool-body">
          <Button
            label="Undo Last Edit"
            icon="pi pi-undo"
            outlined
            @click="pdfStore.undoLastEdit()"
            class="w-full"
            severity="secondary"
            :disabled="pdfStore.editHistory.length === 0"
          />
        </div>
      </div>

      <!-- Export Section -->
      <div class="tool-card export-card">
        <div class="tool-header">
          <div class="tool-icon bg-green-100">
            <i class="pi pi-download text-green-600"></i>
          </div>
          <h4 class="tool-title">Export PDF</h4>
        </div>
        <div class="tool-body">
          <Button
            label="Download PDF"
            icon="pi pi-download"
            @click="downloadPDF"
            class="w-full download-btn"
            severity="success"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import ColorPicker from 'primevue/colorpicker'
import FileUpload from 'primevue/fileupload'
import { usePdfStore } from '@/stores/pdfStore'

const pdfStore = usePdfStore()

// Text editing state
const textInput = ref('')
const fontSize = ref(16)
const textColor = ref('000000')

// Image state
const selectedImage = ref<string | null>(null)

// Search state
const searchText = ref('')

const hexToRgb = (hex: string) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (result) {
    return {
      r: parseInt(result[1], 16) / 255,
      g: parseInt(result[2], 16) / 255,
      b: parseInt(result[3], 16) / 255
    }
  }
  return { r: 0, g: 0, b: 0 }
}

const addText = async () => {
  if (!textInput.value || !pdfStore.activeDocument?.arrayBuffer) return

  try {
    // Save snapshot before making changes
    pdfStore.saveSnapshot()

    const pdfDoc = await PDFDocument.load(pdfStore.activeDocument.arrayBuffer)
    const pages = pdfDoc.getPages()
    const currentPageIndex = pdfStore.activeDocument.currentPage - 1
    const page = pages[currentPageIndex]

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
    const color = hexToRgb(`#${textColor.value}`)

    const { height } = page.getSize()

    page.drawText(textInput.value, {
      x: 50,
      y: height - 100,
      size: fontSize.value,
      font: font,
      color: rgb(color.r, color.g, color.b)
    })

    const pdfBytes = await pdfDoc.save()
    const newArrayBuffer = pdfBytes.buffer

    pdfStore.activeDocument.arrayBuffer = newArrayBuffer

    pdfStore.addEditAction({
      type: 'text',
      page: currentPageIndex + 1,
      data: { text: textInput.value, fontSize: fontSize.value },
      timestamp: Date.now()
    })

    textInput.value = ''

    // Trigger re-render by reloading the PDF
    pdfStore.triggerPDFReload()
  } catch (error) {
    console.error('Error adding text:', error)
  }
}

const handleImageUpload = async (event: any) => {
  const file = event.files[0]
  if (!file || !pdfStore.activeDocument?.arrayBuffer) return

  try {
    const reader = new FileReader()
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string

      // Load image to get original dimensions
      const img = new Image()
      img.onload = () => {
        // Calculate a reasonable size (max 300px on longest side)
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

        // Set up image preview with calculated size and position
        pdfStore.setImagePreview({
          dataUrl,
          file,
          x: 100, // Default starting position
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
  } catch (error) {
    console.error('Error loading image:', error)
  }
}

const deleteCurrentPage = async () => {
  if (!pdfStore.activeDocument?.arrayBuffer) return
  if (pdfStore.activeDocument.numPages <= 1) return

  try {
    // Save snapshot before making changes
    pdfStore.saveSnapshot()

    const pdfDoc = await PDFDocument.load(pdfStore.activeDocument.arrayBuffer)
    const currentPageIndex = pdfStore.activeDocument.currentPage - 1

    pdfDoc.removePage(currentPageIndex)

    const pdfBytes = await pdfDoc.save()
    const newArrayBuffer = pdfBytes.buffer

    pdfStore.activeDocument.arrayBuffer = newArrayBuffer

    pdfStore.addEditAction({
      type: 'delete',
      page: currentPageIndex + 1,
      data: {},
      timestamp: Date.now()
    })

    if (pdfStore.activeDocument.currentPage > 1) {
      pdfStore.setCurrentPage(pdfStore.activeDocument.currentPage - 1)
    }

    pdfStore.triggerPDFReload()
  } catch (error) {
    console.error('Error deleting page:', error)
  }
}

const addBlankPage = async () => {
  if (!pdfStore.activeDocument?.arrayBuffer) return

  try {
    // Save snapshot before making changes
    pdfStore.saveSnapshot()

    const pdfDoc = await PDFDocument.load(pdfStore.activeDocument.arrayBuffer)
    pdfDoc.addPage()

    const pdfBytes = await pdfDoc.save()
    const newArrayBuffer = pdfBytes.buffer

    pdfStore.activeDocument.arrayBuffer = newArrayBuffer

    pdfStore.triggerPDFReload()
  } catch (error) {
    console.error('Error adding blank page:', error)
  }
}

const downloadPDF = async () => {
  if (!pdfStore.activeDocument?.arrayBuffer) return

  try {
    let blobData: ArrayBuffer | Uint8Array

    // If pages have been reordered, create a new PDF with the correct order
    if (pdfStore.activeDocument.pageOrder && pdfStore.activeDocument.pageOrder.length > 0) {
      const pdfDoc = await PDFDocument.load(pdfStore.activeDocument.arrayBuffer)
      const newPdfDoc = await PDFDocument.create()

      // Copy pages in the new order
      for (const pageNum of pdfStore.activeDocument.pageOrder) {
        const [copiedPage] = await newPdfDoc.copyPages(pdfDoc, [pageNum - 1])
        newPdfDoc.addPage(copiedPage)
      }

      blobData = await newPdfDoc.save()
    } else {
      blobData = pdfStore.activeDocument.arrayBuffer
    }

    const blob = new Blob([blobData as any], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `edited_${pdfStore.activeDocument.name}`
    link.click()
    URL.revokeObjectURL(url)
  } catch (error) {
    console.error('Error downloading PDF:', error)
  }
}

const performSearch = () => {
  if (!searchText.value.trim()) return

  pdfStore.setSearchQuery(searchText.value)
  pdfStore.setIsSearching(true)

  // The actual search will be performed in PDFViewer component
  // which has access to the PDF.js document
}

const clearSearch = () => {
  searchText.value = ''
  pdfStore.clearSearch()
}
</script>

<style scoped>
.pdf-editor {
  width: 380px;
  overflow-y: auto;
  max-height: 100vh;
}

.editor-header {
  z-index: 10;
}

.editor-content {
  overflow-y: auto;
  max-height: 88vh;
}

.tool-card {
  background: white;
  border-radius: 16px;
  padding: 20px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  border: 1px solid #e5e7eb;
  transition: all 0.2s ease;
}

.tool-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  transform: translateY(-2px);
}

.export-card {
  background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%);
  border-color: #bbf7d0;
}

.tool-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.tool-icon {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  flex-shrink: 0;
}

.tool-title {
  font-size: 15px;
  font-weight: 600;
  color: #1f2937;
  margin: 0;
}

.tool-body {
  display: flex;
  flex-direction: column;
}

.search-results {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 12px;
  padding: 10px 12px;
  background: #f8fafc;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
}

.search-input {
  border-radius: 8px;
  border: 1.5px solid #e2e8f0;
  transition: all 0.2s ease;
}

.search-input:focus {
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.color-picker-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  border: 1.5px solid #e2e8f0;
  border-radius: 8px;
  background: white;
  transition: all 0.2s ease;
}

.color-picker-wrapper:hover {
  border-color: #cbd5e1;
}

.image-upload-btn {
  width: 100%;
}

.download-btn {
  font-weight: 600;
  transition: all 0.2s ease;
}

.download-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(34, 197, 94, 0.3);
}

/* Smooth scrollbar for editor */
.editor-content::-webkit-scrollbar {
  width: 6px;
}

.editor-content::-webkit-scrollbar-track {
  background: transparent;
}

.editor-content::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 3px;
}

.editor-content::-webkit-scrollbar-thumb:hover {
  background: #94a3b8;
}
</style>
