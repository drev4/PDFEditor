<template>
  <div class="pdf-editor bg-white border-l shadow-lg p-4">
    <h3 class="text-lg font-semibold mb-4 flex items-center gap-2">
      <i class="pi pi-pencil"></i>
      PDF Editor
    </h3>

    <div v-if="!pdfStore.activeDocument" class="text-center text-gray-500">
      <p>No PDF loaded</p>
    </div>

    <div v-else class="space-y-4">
      <!-- Search Section -->
      <div class="editor-section">
        <h4 class="font-medium mb-2 flex items-center gap-2">
          <i class="pi pi-search"></i>
          Search Text
        </h4>
        <div class="space-y-2">
          <InputText
            v-model="searchText"
            placeholder="Search in PDF..."
            class="w-full"
            @keyup.enter="performSearch"
          />
          <div class="flex gap-2">
            <Button
              label="Search"
              icon="pi pi-search"
              @click="performSearch"
              class="flex-1"
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
          <div v-if="pdfStore.searchMatches.length > 0" class="flex items-center gap-2 text-sm">
            <span>{{ pdfStore.currentMatchIndex + 1 }} / {{ pdfStore.searchMatches.length }}</span>
            <div class="flex gap-1 ml-auto">
              <Button
                icon="pi pi-chevron-up"
                size="small"
                outlined
                @click="pdfStore.previousSearchMatch()"
              />
              <Button
                icon="pi pi-chevron-down"
                size="small"
                outlined
                @click="pdfStore.nextSearchMatch()"
              />
            </div>
          </div>
        </div>
      </div>

      <Divider />

      <!-- Add Text Section -->
      <div class="editor-section">
        <h4 class="font-medium mb-2 flex items-center gap-2">
          <i class="pi pi-font"></i>
          Add Text
        </h4>
        <div class="space-y-2">
          <InputText
            v-model="textInput"
            placeholder="Enter text..."
            class="w-full"
          />
          <div class="flex gap-2">
            <InputNumber
              v-model="fontSize"
              :min="8"
              :max="72"
              placeholder="Size"
              class="flex-1"
            />
            <ColorPicker v-model="textColor" />
          </div>
          <Button
            label="Add Text to PDF"
            icon="pi pi-plus"
            @click="addText"
            class="w-full"
            :disabled="!textInput"
          />
        </div>
      </div>

      <Divider />

      <!-- Add Image Section -->
      <div class="editor-section">
        <h4 class="font-medium mb-2 flex items-center gap-2">
          <i class="pi pi-image"></i>
          Add Image
        </h4>
        <FileUpload
          mode="basic"
          accept="image/*"
          :maxFileSize="5000000"
          @select="handleImageUpload"
          :auto="true"
          chooseLabel="Select Image"
          class="w-full"
        />
      </div>

      <Divider />

      <!-- Page Operations -->
      <div class="editor-section">
        <h4 class="font-medium mb-2 flex items-center gap-2">
          <i class="pi pi-file"></i>
          Page Operations
        </h4>
        <div class="space-y-2">
          <Button
            label="Delete Current Page"
            icon="pi pi-trash"
            severity="danger"
            outlined
            @click="deleteCurrentPage"
            class="w-full"
            :disabled="pdfStore.activeDocument.numPages <= 1"
          />
          <Button
            label="Add Blank Page"
            icon="pi pi-plus-circle"
            outlined
            @click="addBlankPage"
            class="w-full"
          />
        </div>
      </div>

      <Divider />

      <!-- Export Section -->
      <div class="editor-section">
        <h4 class="font-medium mb-2 flex items-center gap-2">
          <i class="pi pi-download"></i>
          Export
        </h4>
        <Button
          label="Download Modified PDF"
          icon="pi pi-download"
          @click="downloadPDF"
          class="w-full"
          severity="success"
        />
      </div>

      <Divider />

      <!-- Edit History -->
      <div class="editor-section">
        <h4 class="font-medium mb-2 flex items-center gap-2">
          <i class="pi pi-history"></i>
          History ({{ pdfStore.editHistory.length }})
        </h4>
        <Button
          label="Undo Last Edit"
          icon="pi pi-undo"
          outlined
          @click="pdfStore.undoLastEdit()"
          class="w-full"
          :disabled="pdfStore.editHistory.length === 0"
        />
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
import Divider from 'primevue/divider'
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
    const blob = new Blob([pdfStore.activeDocument.arrayBuffer], { type: 'application/pdf' })
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
  width: 320px;
  overflow-y: auto;
  max-height: 100vh;
}

.editor-section {
  margin-bottom: 1rem;
}
</style>
