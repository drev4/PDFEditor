<template>
  <div class="pdf-editor bg-surface border-l border-line">
    <!-- Header -->
    <div class="editor-header sticky top-0 bg-surface px-4 py-3 border-b border-line">
      <div class="flex items-center gap-3">
        <div class="w-7 h-7 bg-surface-sunken rounded-input flex items-center justify-center">
          <i class="pi pi-sliders-h text-white text-section"></i>
        </div>
        <div>
          <h3 class="text-section font-bold text-white">Editor Tools</h3>
          <p class="text-meta text-accent">Customize your PDF</p>
        </div>
      </div>
    </div>

    <div v-if="!documentStore.activeDocument" class="p-6 text-center text-muted">
      <i class="pi pi-info-circle text-display mb-2 block"></i>
      <p class="text-body">No PDF loaded</p>
    </div>

    <div v-else class="editor-content p-6 space-y-6">
      <!-- Form Save Panel -->
      <FormSavePanel v-if="formFieldsStore.fields.length > 0" />

      <!-- Search Section -->
      <div class="tool-card">
        <div class="tool-header">
          <div class="tool-icon bg-accent-soft">
            <i class="pi pi-search text-accent"></i>
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
              :loading="searchStore.isSearching"
            />
            <Button
              icon="pi pi-times"
              @click="clearSearch"
              severity="secondary"
              outlined
              :disabled="searchStore.searchMatches.length === 0"
            />
          </div>
          <div v-if="searchStore.searchMatches.length > 0" class="search-results">
            <span class="text-body font-semibold text-ink">
              {{ searchStore.currentMatchIndex + 1 }} / {{ searchStore.searchMatches.length }} matches
            </span>
            <div class="flex gap-1">
              <Button
                icon="pi pi-chevron-up"
                size="small"
                outlined
                severity="info"
                @click="searchStore.previousSearchMatch()"
              />
              <Button
                icon="pi pi-chevron-down"
                size="small"
                outlined
                severity="info"
                @click="searchStore.nextSearchMatch()"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- Add Text Section -->
      <div class="tool-card">
        <div class="tool-header">
          <div class="tool-icon bg-accent-soft">
            <i class="pi pi-font text-accent"></i>
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
          <div class="tool-icon bg-accent-soft">
            <i class="pi pi-image text-accent"></i>
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
          <p class="text-meta text-muted mt-2">Max size: 5MB</p>
        </div>
      </div>

      <!-- Grid Settings -->
      <div class="tool-card">
        <div class="tool-header">
          <div class="tool-icon bg-accent-soft">
            <i class="pi pi-th-large text-accent"></i>
          </div>
          <h4 class="tool-title">Grid Settings</h4>
        </div>
        <div class="tool-body">
          <div class="flex items-center justify-between mb-3">
            <span class="text-body font-medium text-ink">Show Grid</span>
            <Button
              :icon="drawingStore.gridEnabled ? 'pi pi-eye' : 'pi pi-eye-slash'"
              @click="drawingStore.toggleGrid()"
              :severity="drawingStore.gridEnabled ? 'info' : 'secondary'"
              outlined
              size="small"
            />
          </div>
          <div class="flex items-center justify-between">
            <span class="text-body font-medium text-ink">Snap to Grid</span>
            <Button
              :icon="drawingStore.snapToGrid ? 'pi pi-lock' : 'pi pi-lock-open'"
              @click="drawingStore.toggleSnapToGrid()"
              :severity="drawingStore.snapToGrid ? 'info' : 'secondary'"
              outlined
              size="small"
            />
          </div>
        </div>
      </div>

      <!-- Page Operations -->
      <div class="tool-card">
        <div class="tool-header">
          <div class="tool-icon bg-limit-soft">
            <i class="pi pi-file text-limit"></i>
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
            :disabled="documentStore.activeDocument.numPages <= 1"
          />
        </div>
      </div>

      <!-- Edit History -->
      <div class="tool-card">
        <div class="tool-header">
          <div class="tool-icon bg-surface-sunken">
            <i class="pi pi-history text-muted"></i>
          </div>
          <div class="flex-1">
            <h4 class="tool-title">Edit History</h4>
            <p class="text-meta text-muted">{{ undoDepth }} {{ undoDepth === 1 ? 'step' : 'steps' }}</p>
          </div>
        </div>
        <div class="tool-body">
          <!-- One stack, so this takes back the last thing that happened
               whatever it was — a text, a page, or a field the author moved.
               The label says which, because a button that undoes an invisible
               something is a button people stop pressing. -->
          <Button
            :label="nextUndoLabel ? `Undo ${nextUndoLabel.toLowerCase()}` : 'Undo'"
            icon="pi pi-undo"
            outlined
            @click="undoEdit"
            class="w-full"
            severity="secondary"
            data-testid="undo-button"
            :disabled="!canUndo"
          />
        </div>
      </div>

      <!-- Export Section -->
      <div class="tool-card export-card">
        <div class="tool-header">
          <div class="tool-icon bg-published-soft">
            <i class="pi pi-download text-published"></i>
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
import { useDocumentStore } from '@/stores/document.store'
import { useEditorStore } from '@/stores/editor.store'
import { useDrawingStore } from '@/stores/drawing.store'
import { useSearchStore } from '@/stores/search.store'
import { useFormFieldsStore } from '@/stores/formFields.store'
import { useDownloadPDF } from '@/composables/useDownloadPDF'
import { useEditorUndo } from '@/composables/useEditorUndo'
import FormSavePanel from '@/components/forms/FormSavePanel.vue'

const documentStore = useDocumentStore()
const { downloadPDF } = useDownloadPDF()
const editorStore = useEditorStore()
const drawingStore = useDrawingStore()
const searchStore = useSearchStore()
const formFieldsStore = useFormFieldsStore()

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
  if (result && result[1] && result[2] && result[3]) {
    return {
      r: parseInt(result[1], 16) / 255,
      g: parseInt(result[2], 16) / 255,
      b: parseInt(result[3], 16) / 255
    }
  }
  return { r: 0, g: 0, b: 0 }
}

const addText = async () => {
  if (!textInput.value || !documentStore.activeDocument?.arrayBuffer) return

  try {
    // The document as it is before the edit — which is what makes the edit
    // undoable. Saving a snapshot *is* pushing the undo entry now.
    editorStore.saveSnapshot(documentStore.activeDocument.id, documentStore.activeDocument.arrayBuffer, 'Text')

    const pdfDoc = await PDFDocument.load(documentStore.activeDocument.arrayBuffer, { ignoreEncryption: true })
    const pages = pdfDoc.getPages()
    const currentPageIndex = documentStore.activeDocument.currentPage - 1
    const page = pages[currentPageIndex]

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
    const color = hexToRgb(`#${textColor.value}`)

    if (!page) return
    const { height } = page.getSize()

    page.drawText(textInput.value, {
      x: 50,
      y: height - 100,
      size: fontSize.value,
      font: font,
      color: rgb(color.r, color.g, color.b)
    })

    const pdfBytes = await pdfDoc.save()
    // Create a proper ArrayBuffer copy with exact byte length
    const newArrayBuffer = pdfBytes.buffer.slice(
      pdfBytes.byteOffset,
      pdfBytes.byteOffset + pdfBytes.byteLength
    ) as ArrayBuffer

    documentStore.activeDocument.arrayBuffer = newArrayBuffer

    textInput.value = ''

    // Trigger re-render by reloading the PDF
    documentStore.triggerPDFReload()
  } catch (error) {
    console.error('Error adding text:', error)
  }
}

const handleImageUpload = async (event: { files: File[] }) => {
  const file = event.files[0]
  if (!file || !documentStore.activeDocument?.arrayBuffer) return

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
        editorStore.setImagePreview({
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
  if (!documentStore.activeDocument?.arrayBuffer) return
  if (documentStore.activeDocument.numPages <= 1) return

  try {
    editorStore.saveSnapshot(documentStore.activeDocument.id, documentStore.activeDocument.arrayBuffer, 'Page removed')

    const pdfDoc = await PDFDocument.load(documentStore.activeDocument.arrayBuffer, { ignoreEncryption: true })
    const currentPageIndex = documentStore.activeDocument.currentPage - 1

    pdfDoc.removePage(currentPageIndex)

    const pdfBytes = await pdfDoc.save()
    // Create a proper ArrayBuffer copy with exact byte length
    const newArrayBuffer = pdfBytes.buffer.slice(
      pdfBytes.byteOffset,
      pdfBytes.byteOffset + pdfBytes.byteLength
    ) as ArrayBuffer

    documentStore.activeDocument.arrayBuffer = newArrayBuffer

    if (documentStore.activeDocument.currentPage > 1) {
      documentStore.setCurrentPage(documentStore.activeDocument.currentPage - 1)
    }

    documentStore.triggerPDFReload()
  } catch (error) {
    console.error('Error deleting page:', error)
  }
}

const addBlankPage = async () => {
  if (!documentStore.activeDocument?.arrayBuffer) return

  try {
    // This used to snapshot and push nothing, so adding a page left an
    // undoable change behind a disabled Undo button (features/0047).
    editorStore.saveSnapshot(documentStore.activeDocument.id, documentStore.activeDocument.arrayBuffer, 'Blank page')

    const pdfDoc = await PDFDocument.load(documentStore.activeDocument.arrayBuffer, { ignoreEncryption: true })
    pdfDoc.addPage()

    const pdfBytes = await pdfDoc.save()
    // Create a proper ArrayBuffer copy with exact byte length
    const newArrayBuffer = pdfBytes.buffer.slice(
      pdfBytes.byteOffset,
      pdfBytes.byteOffset + pdfBytes.byteLength
    ) as ArrayBuffer

    documentStore.activeDocument.arrayBuffer = newArrayBuffer

    documentStore.triggerPDFReload()
  } catch (error) {
    console.error('Error adding blank page:', error)
  }
}

const { canUndo, undoDepth, nextUndoLabel, undo: undoEdit } = useEditorUndo()

const performSearch = () => {
  if (!searchText.value.trim()) return

  searchStore.setSearchQuery(searchText.value)
  searchStore.setIsSearching(true)

  // The actual search will be performed in PDFViewer component
  // which has access to the PDF.js document
}

const clearSearch = () => {
  searchText.value = ''
  searchStore.clearSearch()
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
  border: 1px solid #e7e8ec;
  transition: all 0.2s ease;
}

.tool-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  transform: translateY(-2px);
}

.export-card {
  background: linear-gradient(135deg, #e8f4ee 0%, #e8f4ee 100%);
  border-color: #e8f4ee;
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
  color: #191b21;
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
  background: #fbfbfc;
  border-radius: 8px;
  border: 1px solid #e7e8ec;
}

.search-input {
  border-radius: 8px;
  border: 1.5px solid #e7e8ec;
  transition: all 0.2s ease;
}

.search-input:focus {
  border-color: #3554d1;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.color-picker-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  border: 1.5px solid #e7e8ec;
  border-radius: 8px;
  background: white;
  transition: all 0.2s ease;
}

.color-picker-wrapper:hover {
  border-color: #d8dae1;
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
  background: #d8dae1;
  border-radius: 3px;
}

.editor-content::-webkit-scrollbar-thumb:hover {
  background: #9ba1ac;
}
</style>
