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

    <!--
      Archived — the fields the server kept because they hold responses.

      Hidden entirely when there are none, which is the normal state of a form:
      an empty "Archived (0)" heading in every editor would spend permanent
      space on something that is usually nothing. When it does appear it is
      because data exists that has nowhere else to be seen.
    -->
    <template v-if="archivedFields.length > 0">
      <div class="h-px bg-line" />

      <div class="flex items-center justify-between px-3.5 pt-3.5 pb-1">
        <span class="col-label">Archived</span>
        <span class="num text-micro text-faint" data-testid="archived-count">{{ archivedFields.length }}</span>
      </div>
      <p class="px-3.5 pb-2.5 text-mono text-faint leading-snug">
        Removed from the form, kept because they hold responses
      </p>

      <ul class="flex flex-col gap-1 px-3 pb-4" data-testid="archived-fields">
        <li
          v-for="field in archivedFields"
          :key="field.id"
          class="rounded-control border border-line bg-surface px-2.5 py-2"
        >
          <p class="text-body text-ink truncate">{{ field.label || field.name }}</p>
          <div class="flex items-center justify-between gap-2 mt-1">
            <span class="text-mono text-faint">
              {{ field.answerCount }} response{{ field.answerCount === 1 ? '' : 's' }} kept
            </span>
            <button
              type="button"
              class="text-mono text-accent hover:underline"
              :data-testid="`restore-field-${field.id}`"
              :disabled="restoringId !== null"
              @click="askToRestore(field)"
            >
              Restore
            </button>
          </div>
        </li>
      </ul>
    </template>

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

  <Dialog
    :visible="pendingRestore !== null"
    modal
    :closable="false"
    :draggable="false"
    :style="{ width: '420px' }"
    :pt="{ header: { class: 'hidden' } }"
    @update:visible="pendingRestore = null"
  >
    <div class="pt-1" data-testid="restore-field-confirm">
      <div class="flex items-center justify-center w-8 h-8 rounded-input bg-accent-soft text-accent mb-3.5">
        <i class="pi pi-replay text-[15px]" />
      </div>

      <h2 class="text-section">Restore &ldquo;{{ pendingRestore?.label || pendingRestore?.name }}&rdquo;?</h2>

      <p class="mt-2 text-body text-muted">
        It goes back on the form where it was, and new answers join the
        {{ pendingRestore?.answerCount }} already collected under the same column.
        Save the form to put it back in the downloadable PDF.
      </p>

      <!--
        Names are not unique in the schema, so this cannot be an error — refusing
        would strand the answers permanently, which is the outcome this whole
        feature exists to avoid. It is a warning, and the author decides.
      -->
      <p
        v-if="pendingRestore && nameIsTaken(pendingRestore)"
        class="mt-2.5 text-body text-limit"
        data-testid="restore-name-clash"
      >
        A live field is already called <code>{{ pendingRestore.name }}</code>. Restoring
        gives you two columns with the same name in the CSV — rename one afterwards.
      </p>
    </div>

    <template #footer>
      <div class="flex items-center justify-end gap-2">
        <Button label="Cancel" text severity="secondary" @click="pendingRestore = null" />
        <Button
          label="Restore field"
          data-testid="restore-field-confirmed"
          :loading="restoringId !== null"
          @click="confirmRestore"
        />
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useToast } from 'primevue/usetoast'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import { useDocumentStore } from '@/stores/document.store'
import { useFormFieldsStore, type FieldType } from '@/stores/formFields.store'
import { useEditorStore } from '@/stores/editor.store'
import type { ArchivedField } from '@/services/fields'
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
const editorStore = useEditorStore()

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

/* Archived fields (features/0045) */

const toast = useToast()
const archivedFields = computed(() => formFieldsStore.archivedFields)
const pendingRestore = ref<ArchivedField | null>(null)
const restoringId = ref<string | null>(null)

// The list belongs to a form, so it is loaded when the editor has one and
// reloaded when it changes. `immediate` because a form is usually already set
// by the time this rail mounts — the editor loads the form, then draws.
watch(
  () => formFieldsStore.currentFormId,
  formId => {
    if (formId) formFieldsStore.loadArchivedFields()
  },
  { immediate: true }
)

const nameIsTaken = (field: ArchivedField) => formFieldsStore.liveFieldNames.has(field.name)

const askToRestore = (field: ArchivedField) => {
  pendingRestore.value = field
}

const confirmRestore = async () => {
  const field = pendingRestore.value
  if (!field) return

  restoringId.value = field.id
  try {
    const restored = await formFieldsStore.restoreArchivedField(field.id)
    if (!restored) {
      toast.add({
        severity: 'error',
        summary: 'Restore failed',
        detail: formFieldsStore.error ?? 'The field could not be restored.',
        life: 5000
      })
      return
    }

    // History from before the restore does not contain this field, and the bulk
    // save reads a missing live field as a removal — so undoing past this point
    // would re-archive what was just recovered, with a 200 and no error anywhere
    // (features/0045, features/0047). Every entry learns about it instead.
    const restoredField = formFieldsStore.fields.find(f => f.id === restored.id)
    if (restoredField) editorStore.rememberField(restoredField)

    // Says what is still pending on purpose. No individual field write
    // re-embeds the PDF, so the downloadable document does not have this field
    // back until the next save, and promising otherwise would be a lie the user
    // only discovers on download.
    toast.add({
      severity: 'success',
      summary: 'Field restored',
      detail: `"${field.label || field.name}" is back on the form. `
        + 'Save the form to put it back in the PDF.',
      life: 5000
    })
  } finally {
    restoringId.value = null
    pendingRestore.value = null
  }
}
</script>
