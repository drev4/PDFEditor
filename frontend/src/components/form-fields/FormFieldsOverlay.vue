<template>
  <!--
    Sized in the canvas's own pixels and scaled as a whole, rather than left at
    100% and every field scaled individually.

    `canvas { max-width: 100% }` means the canvas is usually drawn smaller than
    the pixels it holds, so a field laid out in canvas pixels inside a
    100%-wide overlay drifts further from the page the narrower the window
    gets — and off the page entirely on a small one. One transform on the
    container keeps the overlay and the canvas in the same coordinate space by
    construction, which is a property rather than an arithmetic agreement that
    every call site has to remember.
  -->
  <div
    ref="overlayRef"
    class="form-fields-overlay"
    :class="{
      'adding-mode': formFieldsStore.isAddingField,
      'select-mode': formFieldsStore.isSelectMode
    }"
    :style="overlayStyle"
    @click="handleOverlayClick"
    @mousemove="handleMouseMove"
    @mousedown="startMarquee"
  >
    <!-- Existing Fields -->
    <FormFieldItem
      v-for="field in currentPageFields"
      :key="field.id"
      :field="field"
      :page-width="pageSize.pageWidth"
      :page-height="pageSize.pageHeight"
      :rotation="rotation"
      :scale-factor="scaleFactor"
    />

    <!-- Preview when adding new field -->
    <div
      v-if="formFieldsStore.isAddingField && previewPosition"
      class="field-preview"
      :class="`preview-${formFieldsStore.fieldTypeToAdd}`"
      :style="{
        left: `${previewPosition.x}px`,
        top: `${previewPosition.y}px`,
        width: `${defaultFieldSize.width}px`,
        height: `${defaultFieldSize.height}px`
      }"
    >
      <i :class="getFieldIcon(formFieldsStore.fieldTypeToAdd!)"></i>
      <span>Click to place</span>
    </div>

    <!-- The rubber band itself, drawn in the overlay's own pixels. -->
    <div
      v-if="marquee"
      class="marquee"
      data-testid="marquee-band"
      :style="{
        left: `${marquee.x}px`,
        top: `${marquee.y}px`,
        width: `${marquee.width}px`,
        height: `${marquee.height}px`
      }"
    ></div>

    <!-- Select mode indicator -->
    <div v-if="formFieldsStore.isSelectMode" class="adding-indicator" data-testid="select-mode-indicator">
      <span>Drag to select fields</span>
      <button @click.stop="formFieldsStore.setSelectMode(false)">
        <i class="pi pi-times"></i>
        Done
      </button>
    </div>

    <!-- Adding mode indicator -->
    <div v-if="formFieldsStore.isAddingField" class="adding-indicator">
      <span>Placing: {{ getFieldTypeLabel(formFieldsStore.fieldTypeToAdd!) }}</span>
      <button @click.stop="formFieldsStore.cancelAddingField()">
        <i class="pi pi-times"></i>
        Cancel
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onBeforeUnmount } from 'vue'
import { useFormFieldsStore, cloneFields, type FieldType } from '@/stores/formFields.store'
import { useEditorStore } from '@/stores/editor.store'
import { unrotateFieldPoint, unrotatedPageSize, rotateFieldRect } from '@/utils/pdfCoordinates'
import { bandBetween, idsWithinBand, type Band } from '@/utils/fieldGeometry'
import { useDocumentStore } from '@/stores/document.store'
import { useFormManagement } from '@/composables/useFormManagement'
import { useToast } from 'primevue/usetoast'
import FormFieldItem from './FormFieldItem.vue'

const props = defineProps<{
  canvasWidth: number
  canvasHeight: number
  displayScale?: number
}>()

const formFieldsStore = useFormFieldsStore()
const editorStore = useEditorStore()
const documentStore = useDocumentStore()
const { autoInitializeForm } = useFormManagement()
const toast = useToast()

const overlayRef = ref<HTMLDivElement | null>(null)
const previewPosition = ref<{ x: number; y: number } | null>(null)

const currentPage = computed(() => documentStore.activeDocument?.currentPage || 1)
const rotation = computed(() => documentStore.activeDocument?.rotation || 0)

/**
 * Positions are stored in canvas pixels at the base scale with the page
 * upright. The canvas we are drawing on is at the current scale and may be
 * turned, so both have to be divided back out before anything is compared to a
 * stored coordinate.
 */
const BASE_SCALE = 1.5

/** Stored units -> canvas pixels. */
const renderScale = computed(() => (documentStore.activeDocument?.scale || BASE_SCALE) / BASE_SCALE)

/**
 * Stored units -> canvas pixels. The overlay is laid out in canvas pixels and
 * scaled as a whole, so nothing below here needs to know about the display
 * ratio.
 */
const scaleFactor = renderScale

const overlayStyle = computed(() => ({
  width: `${props.canvasWidth}px`,
  height: `${props.canvasHeight}px`,
  transform: `scale(${props.displayScale ?? 1})`,
  transformOrigin: 'top left'
}))

// Derived from the canvas's own pixels, not its displayed box: this is the
// page's size in stored units and must not move when the window is resized.
const pageSize = computed(() =>
  unrotatedPageSize(props.canvasWidth, props.canvasHeight, rotation.value, renderScale.value)
)

const currentPageFields = computed(() => {
  return formFieldsStore.getFieldsForPage(currentPage.value)
})

const defaultFieldSize = computed(() => {
  const type = formFieldsStore.fieldTypeToAdd
  switch (type) {
    case 'text':
      return { width: 200, height: 30 }
    case 'textarea':
      return { width: 250, height: 80 }
    case 'checkbox':
      return { width: 20, height: 20 }
    case 'radio':
      return { width: 20, height: 20 }
    case 'dropdown':
      return { width: 200, height: 30 }
    default:
      return { width: 150, height: 30 }
  }
})

const getFieldIcon = (type: FieldType) => {
  const icons: Record<FieldType, string> = {
    text: 'pi pi-pencil',
    textarea: 'pi pi-align-left',
    checkbox: 'pi pi-check-square',
    radio: 'pi pi-circle',
    dropdown: 'pi pi-chevron-down'
  }
  return icons[type]
}

const getFieldTypeLabel = (type: FieldType) => {
  const labels: Record<FieldType, string> = {
    text: 'Text field',
    textarea: 'Paragraph',
    checkbox: 'Checkbox',
    radio: 'Radio group',
    dropdown: 'Dropdown'
  }
  return labels[type]
}

/**
 * The marquee (features/0050).
 *
 * Everything here is in the overlay's **own** pixels — the space the fields are
 * laid out in — never in screen pixels. The overlay is drawn with one
 * `scale(displayScale)` transform, so `getBoundingClientRect` reports a box that
 * is usually smaller than the pixels inside it; dividing the pointer back out is
 * what stops the band drifting further from the cursor the narrower the window
 * gets. `handleOverlayClick` below does the same division for the same reason.
 *
 * The fields are hit-tested where they are **drawn**, through the same
 * `rotateFieldRect` that positions them, which is what makes the marquee work
 * unchanged on a turned page — selecting is safe there even though moving is
 * not (`canEditGeometry`).
 */
const marquee = ref<Band | null>(null)
const marqueeStart = ref<{ x: number; y: number } | null>(null)

const overlayPoint = (e: MouseEvent) => {
  const rect = overlayRef.value!.getBoundingClientRect()
  const display = props.displayScale ?? 1
  return {
    x: (e.clientX - rect.left) / display,
    y: (e.clientY - rect.top) / display
  }
}

/** Where each field of this page is drawn, in overlay pixels. */
const drawnRects = () =>
  currentPageFields.value.map(field => {
    const rect = rotateFieldRect(
      field.position,
      pageSize.value.pageWidth,
      pageSize.value.pageHeight,
      rotation.value,
      scaleFactor.value
    )
    return { id: field.id, x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  })

const startMarquee = (e: MouseEvent) => {
  // Only in select mode, only the primary button, and never over a field — the
  // field's own `mousedown` stops the event before it reaches here, which is
  // what keeps dragging a field working while the mode is on.
  if (!formFieldsStore.isSelectMode || e.button !== 0 || !overlayRef.value) return

  e.preventDefault()
  marqueeStart.value = overlayPoint(e)
  marquee.value = bandBetween(marqueeStart.value, marqueeStart.value)

  // Bound on the window rather than the overlay: a band dragged past the edge of
  // the page must keep tracking, and it must end even if the button comes up
  // somewhere else entirely — otherwise the band is left painted on screen.
  window.addEventListener('mousemove', onMarqueeMove)
  window.addEventListener('mouseup', endMarquee, { once: true })
}

const onMarqueeMove = (e: MouseEvent) => {
  if (!marqueeStart.value || !overlayRef.value) return
  marquee.value = bandBetween(marqueeStart.value, overlayPoint(e))
}

const endMarquee = () => {
  window.removeEventListener('mousemove', onMarqueeMove)

  const band = marquee.value
  marquee.value = null
  marqueeStart.value = null
  if (!band) return

  // A band that caught nothing clears the selection: it is the same gesture as
  // clicking empty page, and leaving the previous selection standing would make
  // the next align or delete act on fields the author had just tried to
  // deselect.
  formFieldsStore.selectFields(idsWithinBand(band, drawnRects()))
}

onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onMarqueeMove)
})

const handleMouseMove = (e: MouseEvent) => {
  if (!formFieldsStore.isAddingField || !overlayRef.value) {
    previewPosition.value = null
    return
  }

  const rect = overlayRef.value.getBoundingClientRect()
  const display = props.displayScale ?? 1
  const x = (e.clientX - rect.left) / display - defaultFieldSize.value.width / 2
  const y = (e.clientY - rect.top) / display - defaultFieldSize.value.height / 2

  // Bounded by the overlay's own pixels, not its visual box.
  previewPosition.value = {
    x: Math.max(0, Math.min(x, props.canvasWidth - defaultFieldSize.value.width)),
    y: Math.max(0, Math.min(y, props.canvasHeight - defaultFieldSize.value.height))
  }
}

const handleOverlayClick = async (e: MouseEvent) => {
  if (!formFieldsStore.isAddingField || !formFieldsStore.fieldTypeToAdd || !overlayRef.value) {
    // In select mode the marquee has already decided what is selected, and a
    // mouseup produces a click: clearing here would undo every band the moment
    // the button came back up (features/0050). A band that caught nothing has
    // cleared the selection itself.
    if (formFieldsStore.isSelectMode) return

    // If not adding, deselect current field
    formFieldsStore.selectField(null)
    return
  }

  // Placing a field selects it, and the wrapper behind this overlay clears the
  // selection on any click that reaches it — so this one must not.
  e.stopPropagation()

  // `getBoundingClientRect` reports the *visual* box, so a click inside a
  // scaled element has to be divided back out to element-local pixels.
  const rect = overlayRef.value.getBoundingClientRect()
  const display = props.displayScale ?? 1
  const size = defaultFieldSize.value

  // The click arrives in screen space on a page that may be turned. What gets
  // stored has to be in the upright, base-scale space the backend embeds
  // against, so the point goes back through the inverse of the transform the
  // field is drawn with. Storing the raw click is how a field placed on a
  // rotated page ends up somewhere else on the printed PDF.
  const screenX = (e.clientX - rect.left) / display - size.width / 2
  const screenY = (e.clientY - rect.top) / display - size.height / 2

  const canvasW = props.canvasWidth
  const canvasH = props.canvasHeight

  const stored = unrotateFieldPoint(
    {
      x: Math.max(0, Math.min(screenX, canvasW - size.width)),
      y: Math.max(0, Math.min(screenY, canvasH - size.height))
    },
    pageSize.value.pageWidth,
    pageSize.value.pageHeight,
    rotation.value,
    scaleFactor.value
  )

  // A quarter turn maps the top-left corner of the drawn box to a different
  // corner of the stored box, so clamp after mapping rather than before.
  const x = Math.max(0, Math.min(stored.x, pageSize.value.pageWidth - size.width))
  const y = Math.max(0, Math.min(stored.y, pageSize.value.pageHeight - size.height))

  // Create the field
  const fieldType = formFieldsStore.fieldTypeToAdd

  // Generar nombre único para evitar duplicados con campos existentes
  const uniqueName = formFieldsStore.generateUniqueFieldName(fieldType)
  const fieldNumber = uniqueName.split('_')[1] || '1'

  // Captured before the field exists, so undo takes the placement back.
  const fieldsBeforePlacement = cloneFields(formFieldsStore.fields)

  const newField = formFieldsStore.addField({
    type: fieldType,
    name: uniqueName,
    label: `${getFieldTypeLabel(fieldType)} ${fieldNumber}`,
    required: false,
    border: false, // Por defecto, los campos son transparentes sin borde
    position: {
      x,
      y,
      width: size.width,
      height: size.height,
      page: currentPage.value
    },
    options: (fieldType === 'radio' || fieldType === 'dropdown') ? ['Option 1', 'Option 2'] : undefined
  })

  // Placing a field does not write to the server either. What it does do is
  // make sure there is a form to belong to, because the document itself has to
  // be stored for any of this to mean anything — see useFormManagement.
  try {
    await autoInitializeForm()
    editorStore.pushFieldsUndo(fieldsBeforePlacement, null, 'Field placed')
    formFieldsStore.markDirty()
  } catch (error) {
    console.error('Failed to prepare the form:', error)

    toast.add({
      severity: 'error',
      summary: 'Could not add the field',
      detail: 'The form could not be prepared. Try again.',
      life: 3000
    })
  }
}
</script>

<style scoped>
.form-fields-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 8; /* Above text-layer (z-index: 7) but below image/text previews (z-index: 10) */
}

.form-fields-overlay.adding-mode {
  pointer-events: auto;
  cursor: crosshair;
}

/*
  The one state in which this overlay takes the pointer for selection, and it
  has to be given back: `.text-layer` underneath owns the PDF's selectable text
  and everything the search highlights, and an overlay that took the pointer
  permanently would take both away from the whole canvas for everybody who never
  draws a marquee (features/0050).
*/
.form-fields-overlay.select-mode {
  pointer-events: auto;
  cursor: crosshair;
}

.marquee {
  position: absolute;
  border: 1px solid var(--p-primary-color, #2a45b8);
  background: rgba(42, 69, 184, 0.12);
  pointer-events: none;
}

.form-fields-overlay :deep(.form-field-item) {
  pointer-events: auto;
}

.field-preview {
  position: absolute;
  border: 2px dashed #3554d1;
  background: rgba(59, 130, 246, 0.2);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 12px;
  color: #2a45b8;
  pointer-events: none;
  opacity: 0.8;
}

.field-preview i {
  font-size: 14px;
}

.field-preview.preview-checkbox,
.field-preview.preview-radio {
  border-color: #12704f;
  background: rgba(16, 185, 129, 0.2);
  color: #12704f;
}

.field-preview.preview-dropdown {
  border-color: #8a5c0a;
  background: rgba(245, 158, 11, 0.2);
  color: #8a5c0a;
}

.adding-indicator {
  position: absolute;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  background: #2a45b8;
  color: white;
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  pointer-events: auto;
}

.adding-indicator button {
  background: rgba(255, 255, 255, 0.2);
  border: none;
  padding: 4px 8px;
  border-radius: 4px;
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
}

.adding-indicator button:hover {
  background: rgba(255, 255, 255, 0.3);
}
</style>
