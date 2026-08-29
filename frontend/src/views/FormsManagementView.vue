<template>
  <AppShell>
    <div class="forms-management-view flex flex-col flex-grow min-h-0 overflow-y-auto">
      <!-- Page header -->
      <header class="flex items-center gap-4 px-gutter pt-[26px] pb-5">
        <div class="flex-grow min-w-0">
          <h1 class="text-title">Forms</h1>
          <p class="mt-0.5 text-body text-muted">Upload a PDF, place the fields, share the link.</p>
        </div>

        <div class="flex items-center gap-2.5">
          <button
            type="button"
            class="flex items-center justify-center w-control h-control rounded-control border border-line text-muted hover:text-ink hover:bg-surface-sunken transition-colors"
            :disabled="formsStore.loading"
            aria-label="Refresh"
            @click="formsStore.fetchForms()"
          >
            <i class="pi pi-refresh text-[13px]" :class="{ 'pi-spin': formsStore.loading }" />
          </button>

          <!-- The one accent action on this screen. It starts a *new* form:
               going straight to the editor reopened whatever document was
               still in the store, so "New form" showed the last form the user
               had been editing. -->
          <button
            type="button"
            class="flex items-center gap-1.5 h-control px-3.5 rounded-control bg-accent hover:bg-accent-pressed text-white text-row font-medium transition-colors"
            data-testid="new-form-button"
            @click="startNewForm"
          >
            <i class="pi pi-plus text-[12px]" />
            <span>New form</span>
          </button>

          <!-- Owned by `startNewForm`, which opens it. Hidden because the
               button above is the affordance; this is only the file dialog. -->
          <input
            ref="newFormInput"
            type="file"
            accept="application/pdf"
            class="hidden"
            data-testid="new-form-input"
            @change="handleNewFormFile"
          />
        </div>
      </header>

      <!-- Filters -->
      <div class="flex items-center gap-5 px-gutter border-b border-line">
        <div class="flex items-center gap-1">
          <button
            v-for="tab in tabs"
            :key="tab.value"
            type="button"
            class="h-[38px] px-3 flex items-center text-row transition-colors"
            :class="activeTab === tab.value
              ? 'border-b-[1.5px] border-ink font-medium text-ink'
              : 'text-muted hover:text-ink'"
            @click="activeTab = tab.value"
          >
            {{ tab.label }}
          </button>
        </div>
        <div class="flex-grow" />
        <span class="num text-meta text-faint">
          {{ visibleForms.length }} {{ visibleForms.length === 1 ? 'form' : 'forms' }}
        </span>
      </div>

      <!-- Loading -->
      <div v-if="formsStore.loading && !formsStore.forms.length" class="flex flex-col items-center py-20">
        <ProgressSpinner style="width: 30px; height: 30px" strokeWidth="4" />
        <p class="mt-4 text-body text-muted">Loading your forms</p>
      </div>

      <template v-else>
        <!-- Table header -->
        <div
          v-if="visibleForms.length"
          class="grid gap-4 px-gutter py-2.5 border-b border-line-soft forms-row"
        >
          <span class="col-label">Form</span>
          <span class="col-label">Status</span>
          <span class="col-label text-right">Responses</span>
          <span class="col-label">Updated</span>
          <span />
        </div>

        <!-- Rows -->
        <div v-if="visibleForms.length" class="flex flex-col">
          <div
            v-for="form in visibleForms"
            :key="form.id"
            class="grid gap-4 items-center px-gutter py-3 border-b border-line-soft hover:bg-surface-subtle transition-colors forms-row"
            data-testid="form-row"
          >
            <div class="flex items-center gap-2.5 min-w-0">
              <div
                class="flex items-center justify-center w-[30px] h-[30px] rounded-input border border-line text-muted flex-shrink-0"
              >
                <i class="pi pi-file text-[13px]" />
              </div>
              <div class="min-w-0">
                <button
                  type="button"
                  class="block w-full text-left text-row font-medium truncate hover:text-accent transition-colors"
                  :title="form.title"
                  @click="handleEdit(form)"
                >
                  {{ form.title }}
                </button>
                <div class="text-mono text-faint mt-px truncate">
                  <span class="num">{{ form._count?.fields ?? 0 }}</span> fields ·
                  <span class="num">{{ form.viewCount || 0 }}</span> views
                </div>
              </div>
            </div>

            <div>
              <StatusPill :status="form.status" />
            </div>

            <span class="num text-meta text-right" :class="{ 'text-disabled': !form._count?.responses }">
              {{ form._count?.responses || '—' }}
            </span>

            <span class="text-meta text-muted">{{ relativeTime(form.updatedAt) }}</span>

            <div class="flex items-center justify-center">
              <button
                type="button"
                class="flex items-center justify-center w-7 h-7 rounded-input text-faint hover:text-ink hover:bg-surface-sunken transition-colors"
                :aria-label="`Actions for ${form.title}`"
                @click="openMenu($event, form)"
              >
                <i class="pi pi-ellipsis-h text-[13px]" />
              </button>
            </div>
          </div>
        </div>

        <!-- Empty -->
        <div v-else class="px-gutter py-16 text-center">
          <h2 class="text-section">{{ emptyTitle }}</h2>
          <p class="mt-1.5 text-body text-muted max-w-[380px] mx-auto">
            {{ emptyBody }}
          </p>
        </div>
      </template>

      <div class="flex-grow" />

      <!-- Dropzone. Real, not a link to somewhere else that uploads: this is
           the first thing on the screen for someone with no forms yet. -->
      <div class="px-gutter py-6">
        <div
          class="flex flex-col sm:flex-row items-center justify-center gap-3 py-5 px-6 rounded-card border border-dashed border-line-strong bg-surface-subtle"
        >
          <i class="pi pi-cloud-upload text-faint text-[15px]" />
          <span class="text-body text-muted text-center">
            Drop a PDF here. Existing PDF forms keep their fields.
          </span>
          <FileUploader @loaded="router.push('/dashboard/editor')" @before-select="resetEditorState" />
        </div>
      </div>
    </div>

    <Menu ref="menu" :model="menuItems" :popup="true" />

    <ShareFormModal
      v-model:visible="showShareModal"
      :form="selectedForm"
      @publish="handlePublish"
      @unpublish="handleUnpublish"
    />

    <ConfirmDialog />
  </AppShell>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useToast } from 'primevue/usetoast'
import { useConfirm } from 'primevue/useconfirm'
import Menu from 'primevue/menu'
import ProgressSpinner from 'primevue/progressspinner'
import ConfirmDialog from 'primevue/confirmdialog'
import AppShell from '@/layouts/AppShell.vue'
import StatusPill from '@/components/ui/StatusPill.vue'
import ShareFormModal from '@/components/forms/ShareFormModal.vue'
import FileUploader from '@/components/ui/FileUploader.vue'
import { useFormsStore } from '@/stores/forms.store'
import { useFormFieldsStore } from '@/stores/formFields.store'
import { useDocumentStore } from '@/stores/document.store'
import { useFormManagement } from '@/composables/useFormManagement'
import { relativeTime } from '@/utils/formatDate'
import { type Form, type FormStatus } from '@/services/forms'

const router = useRouter()
const toast = useToast()
const confirm = useConfirm()
const formsStore = useFormsStore()
const documentStore = useDocumentStore()
const formFieldsStore = useFormFieldsStore()
const formManagement = useFormManagement()

const showShareModal = ref(false)
const selectedForm = ref<Form | null>(null)
const newFormInput = ref<HTMLInputElement | null>(null)

/**
 * Everything the editor holds about the form being worked on.
 *
 * The editor reads its document and its fields from stores that outlive the
 * route, so opening it without clearing them shows the previous form. That is
 * what made "New form" open an existing one.
 */
function resetEditorState() {
  documentStore.documents.forEach(doc => documentStore.closeDocument(doc.id))
  formFieldsStore.clearFields()
  formFieldsStore.setCurrentForm(null)
  documentStore.markSaved()
}

function startNewForm() {
  resetEditorState()
  newFormInput.value?.click()
}

async function handleNewFormFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  // Reset the input so picking the same file twice still fires `change`.
  input.value = ''

  if (!file || file.type !== 'application/pdf') return

  try {
    await documentStore.loadPDF(file)
    router.push('/dashboard/editor')
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Could not open that PDF',
      detail: err instanceof Error ? err.message : 'The file could not be read',
      life: 5000
    })
  }
}

type Tab = 'all' | FormStatus
const tabs: { value: Tab; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'published', label: 'Published' },
  { value: 'draft', label: 'Drafts' },
  { value: 'closed', label: 'Closed' },
]
const activeTab = ref<Tab>('all')

const visibleForms = computed(() =>
  activeTab.value === 'all'
    ? formsStore.forms
    : formsStore.forms.filter(f => f.status === activeTab.value)
)

const emptyTitle = computed(() =>
  formsStore.forms.length ? 'Nothing in this view' : 'No forms yet'
)
const emptyBody = computed(() =>
  formsStore.forms.length
    ? 'No form has this status. Try another filter.'
    : 'Drop a PDF below to turn it into a form.'
)

// The row's overflow menu. Held as a ref so the actions know which form was
// clicked; PrimeVue's Menu is a single popup instance, not one per row.
const menu = ref<InstanceType<typeof Menu> | null>(null)
const menuForm = ref<Form | null>(null)

const menuItems = computed(() => [
  { label: 'Edit fields', icon: 'pi pi-pencil', command: () => menuForm.value && handleEdit(menuForm.value) },
  { label: 'Responses', icon: 'pi pi-list', command: () => menuForm.value && viewResponses(menuForm.value.id) },
  { label: 'Share', icon: 'pi pi-share-alt', command: () => menuForm.value && handleShare(menuForm.value) },
  { separator: true },
  { label: 'Delete', icon: 'pi pi-trash', command: () => menuForm.value && handleDelete(menuForm.value) },
])

function openMenu(event: Event, form: Form) {
  menuForm.value = form
  menu.value?.toggle(event)
}

onMounted(() => {
  formsStore.fetchForms()
})

function viewResponses(id: string) {
  router.push({ name: 'form-responses', params: { id } })
}

async function handleEdit(form: Form) {
  if (!form.pdfUrl) {
    toast.add({ severity: 'warn', summary: 'Error', detail: 'This form has no PDF', life: 3000 })
    return
  }

  try {
    // Same reason as `startNewForm`: whatever is already open would otherwise
    // still be there underneath the form being opened.
    resetEditorState()

    const pdfFileName = form.pdfUrl.split('/').pop() || `${form.title}.pdf`

    // Signed PDF URLs expire; the one on this cached row may be stale. Re-read
    // the form so the download uses a freshly minted link.
    const fresh = await formsStore.fetchForm(form.id)
    if (!fresh.pdfUrl) throw new Error('This form has no PDF')

    const response = await fetch(fresh.pdfUrl)
    if (!response.ok) throw new Error('Failed to download PDF')

    const blob = await response.blob()
    const file = new File([blob], pdfFileName, { type: 'application/pdf' })

    await documentStore.loadPDF(file)
    await formManagement.loadForm(form.id)

    router.push('/dashboard/editor')
    toast.add({ severity: 'success', summary: 'Loaded', detail: 'Form loaded for editing', life: 3000 })
  } catch (err: any) {
    toast.add({ severity: 'error', summary: 'Error', detail: err.message, life: 3000 })
  }
}

function handleShare(form: Form) {
  selectedForm.value = form
  showShareModal.value = true
}

async function handlePublish(formId: string) {
  try {
    await formsStore.updateFormStatus(formId, 'published')
    toast.add({ severity: 'success', summary: 'Published', detail: 'Form is now public', life: 3000 })
  } catch (error) {
    toast.add({ severity: 'error', summary: 'Error', detail: 'Failed to publish', life: 3000 })
  }
}

async function handleUnpublish(formId: string) {
  try {
    await formsStore.updateFormStatus(formId, 'draft')
    toast.add({ severity: 'success', summary: 'Unpublished', detail: 'Form is now draft', life: 3000 })
  } catch (error) {
    toast.add({ severity: 'error', summary: 'Error', detail: 'Failed to unpublish', life: 3000 })
  }
}

function handleDelete(form: Form) {
  confirm.require({
    message: `Are you sure you want to delete "${form.title}"?`,
    header: 'Confirmation',
    icon: 'pi pi-exclamation-triangle',
    acceptClass: 'p-button-danger',
    accept: async () => {
      try {
        await formsStore.deleteForm(form.id)
        toast.add({ severity: 'success', summary: 'Deleted', detail: 'Form deleted successfully', life: 3000 })
      } catch (error) {
        toast.add({ severity: 'error', summary: 'Error', detail: 'Failed to delete', life: 3000 })
      }
    }
  })
}
</script>

<style scoped>
/* The Main artboard's column widths. A grid rather than a <table> because the
   first column has to be able to shrink and truncate. */
.forms-row {
  grid-template-columns: minmax(0, 1fr) 116px 116px 132px 40px;
}
</style>
