<template>
  <aside
    class="editor-rail flex-col w-rail flex-shrink-0 bg-surface-subtle border-r border-line overflow-y-auto"
    data-testid="editor-rail"
  >
    <!-- Fields -->
    <div class="px-3.5 pt-4 pb-2.5">
      <span class="col-label">Fields</span>
      <p class="mt-1 text-mono text-faint leading-snug">Click a type, then click the page</p>
    </div>

    <div class="flex flex-col gap-1 px-3 pb-4">
      <button
        v-for="type in fieldTypes"
        :key="type.value"
        type="button"
        class="flex items-center gap-2.5 h-control-sm px-2.5 rounded-control border bg-surface text-body transition-colors"
        :class="formFieldsStore.fieldTypeToAdd === type.value
          ? 'border-accent text-accent-pressed bg-accent-soft'
          : 'border-line text-ink hover:border-line-strong'"
        :data-testid="`add-field-${type.value}`"
        :disabled="!hasDocument"
        @click="toggleFieldType(type.value)"
      >
        <i :class="type.icon" class="text-[13px]" />
        <span>{{ type.label }}</span>
      </button>
    </div>

    <div class="h-px bg-line" />

    <!-- Pages -->
    <div class="flex items-center justify-between px-3.5 pt-3.5 pb-2.5">
      <span class="col-label">Pages</span>
      <span class="num text-micro text-faint">{{ pageCount }}</span>
    </div>

    <div class="flex-1 min-h-0 px-1 pb-4">
      <PageThumbnails :pdf-doc="pdfDoc" />
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useDocumentStore } from '@/stores/document.store'
import { useFormFieldsStore, type FieldType } from '@/stores/formFields.store'
import PageThumbnails from '@/components/pdf/PageThumbnails.vue'

/**
 * The editor's one rail — Fields, then Pages — as the `Editor` artboard draws
 * it.
 *
 * It replaces two things that overlapped: a tabbed rail (Documents / Forms /
 * Pages) and a floating toolbar that auto-collapsed on mouseout and also
 * offered the field types. Two places to add a field, one of which moved and
 * hid itself, is why this is a fixed rail with no disclosure of its own. It
 * collapses only when the viewport cannot hold it.
 */
defineProps<{
  pdfDoc: unknown | null
}>()

const documentStore = useDocumentStore()
const formFieldsStore = useFormFieldsStore()

const hasDocument = computed(() => !!documentStore.activeDocument)
const pageCount = computed(() => documentStore.activeDocument?.numPages ?? 0)

const fieldTypes: { value: FieldType; label: string; icon: string }[] = [
  { value: 'text', label: 'Text', icon: 'pi pi-pencil' },
  { value: 'textarea', label: 'Paragraph', icon: 'pi pi-align-left' },
  { value: 'checkbox', label: 'Checkbox', icon: 'pi pi-check-square' },
  { value: 'radio', label: 'Radio group', icon: 'pi pi-circle' },
  { value: 'dropdown', label: 'Dropdown', icon: 'pi pi-chevron-down' },
]

// Clicking the armed type again disarms it, so there is a way out that is not
// "click somewhere on the document and delete what appears".
const toggleFieldType = (type: FieldType) => {
  if (formFieldsStore.fieldTypeToAdd === type) {
    formFieldsStore.cancelAddingField()
    return
  }
  formFieldsStore.startAddingField(type)
}
</script>
