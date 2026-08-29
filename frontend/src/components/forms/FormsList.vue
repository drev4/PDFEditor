<template>
  <div class="forms-list">
    <!-- Header -->
    <div class="flex items-center justify-between mb-4">
      <h3 class="text-sm font-bold text-ink uppercase tracking-wide">
        My Forms
      </h3>
      <span class="text-xs bg-accent-soft text-accent px-2 py-1 rounded-full font-semibold">
        {{ forms.length }}
      </span>
    </div>

    <!-- Loading State -->
    <div v-if="isLoading" class="flex items-center justify-center py-12">
      <ProgressSpinner style="width: 50px; height: 50px" />
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="text-center py-8">
      <i class="pi pi-exclamation-circle text-danger text-4xl mb-3"></i>
      <p class="text-sm text-danger">{{ error }}</p>
      <Button
        label="Retry"
        @click="loadForms"
        size="small"
        severity="secondary"
        class="mt-3"
      />
    </div>

    <!-- Empty State -->
    <div v-else-if="forms.length === 0" class="text-center py-12">
      <i class="pi pi-inbox text-faint text-5xl mb-4"></i>
      <p class="text-sm text-muted mb-2">No forms yet</p>
      <p class="text-xs text-muted">Create a form from your PDF document</p>
    </div>

    <!-- Forms List -->
    <div v-else class="space-y-3">
      <div
        v-for="form in forms"
        :key="form.id"
        class="group p-4 rounded-xl bg-surface-subtle hover:bg-surface-sunken hover:shadow-md transition-all duration-200"
      >
        <!-- Form Header -->
        <div class="flex items-start gap-3 mb-3">
          <div class="w-10 h-10 rounded-lg bg-accent-soft flex items-center justify-center flex-shrink-0">
            <i class="pi pi-file text-accent text-xl"></i>
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-semibold text-ink truncate">
              {{ form.title }}
            </p>
            <p v-if="form.description" class="text-xs text-muted truncate mt-0.5">
              {{ form.description }}
            </p>
          </div>
          <!-- Status Badge -->
          <div
            class="px-2 py-1 rounded-full text-xs font-medium flex-shrink-0"
            :class="statusClass(form.status)"
          >
            {{ form.status }}
          </div>
        </div>

        <!-- Stats -->
        <div class="grid grid-cols-2 gap-2 mb-3">
          <div class="flex items-center gap-2 text-xs text-muted">
            <i class="pi pi-eye text-faint"></i>
            <span>{{ form.viewCount || 0 }} views</span>
          </div>
          <div class="flex items-center gap-2 text-xs text-muted">
            <i class="pi pi-check-circle text-faint"></i>
            <span>{{ form._count?.responses || 0 }} responses</span>
          </div>
        </div>

        <!-- Actions -->
        <div class="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            icon="pi pi-check-circle"
            label="Responses"
            @click="handleViewResponses(form.id)"
            size="small"
            severity="success"
            outlined
            class="flex-1"
          />
          <Button
            icon="pi pi-share-alt"
            @click="handleShare(form)"
            size="small"
            severity="info"
            outlined
          />
          <Button
            icon="pi pi-pencil"
            @click="handleEdit(form)"
            size="small"
            severity="secondary"
            outlined
            text
          />
          <Button
            icon="pi pi-trash"
            @click="handleDelete(form)"
            size="small"
            severity="danger"
            outlined
            text
          />
        </div>
      </div>
    </div>

    <!-- Share Modal -->
    <ShareFormModal
      v-model:visible="showShareModal"
      :form="selectedForm"
      @publish="handlePublish"
      @unpublish="handleUnpublish"
    />

    <!-- Toast -->
    <Toast position="top-right" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useToast } from 'primevue/usetoast'
import { useConfirm } from 'primevue/useconfirm'
import Button from 'primevue/button'
import ProgressSpinner from 'primevue/progressspinner'
import Toast from 'primevue/toast'
import ShareFormModal from './ShareFormModal.vue'
import { type Form } from '@/services/forms'
import { useFormsStore } from '@/stores/forms.store'
import { useDocumentStore } from '@/stores/document.store'
import { useFormManagement } from '@/composables/useFormManagement'

const router = useRouter()
const toast = useToast()
const confirm = useConfirm()
const formsStore = useFormsStore()
const documentStore = useDocumentStore()
const formManagement = useFormManagement()

// Use store directly for real-time updates
const forms = computed(() => formsStore.forms)
const isLoading = computed(() => formsStore.loading)
const error = computed(() => formsStore.error)

const showShareModal = ref(false)
const selectedForm = ref<Form | null>(null)

onMounted(() => {
  loadForms()
})

async function loadForms() {
  try {
    await formsStore.fetchForms()
  } catch (err: any) {
    console.error('Error loading forms:', err)
  }
}

function statusClass(status: string) {
  switch (status) {
    case 'published':
      return 'bg-published-soft text-published'
    case 'draft':
      return 'bg-surface-track text-ink'
    case 'closed':
      return 'bg-danger-soft text-danger'
    default:
      return 'bg-surface-sunken text-muted'
  }
}

function handleShare(form: Form) {
  selectedForm.value = form
  showShareModal.value = true
}

function handleViewResponses(formId: string) {
  router.push({ name: 'form-responses', params: { id: formId } })
}

async function handleEdit(form: Form) {
  if (!form.pdfUrl) {
    toast.add({
      severity: 'warn',
      summary: 'No PDF',
      detail: 'This form has no PDF uploaded',
      life: 3000
    })
    return
  }

  try {
    // Check if we're already viewing this form
    const isAlreadyLoaded = formsStore.currentForm?.id === form.id

    if (isAlreadyLoaded) {
      toast.add({
        severity: 'info',
        summary: 'Form Active',
        detail: `"${form.title}" is already open`,
        life: 2000
      })
      return
    }

    // Check if PDF is already loaded in documents
    const pdfFileName = form.pdfUrl.split('/').pop() || `${form.title}.pdf`
    const existingDoc = documentStore.documents.find(doc => doc.name === pdfFileName)

    if (existingDoc) {
      // PDF already loaded, just switch to it
      toast.add({
        severity: 'info',
        summary: 'Loading Form',
        detail: 'Loading fields...',
        life: 2000
      })

      documentStore.setActiveDocument(existingDoc.id)
      await formManagement.loadForm(form.id)

      toast.add({
        severity: 'success',
        summary: 'Form Loaded',
        detail: `"${form.title}" is ready to edit`,
        life: 3000
      })
    } else {
      // Download and load PDF
      toast.add({
        severity: 'info',
        summary: 'Loading Form',
        detail: 'Downloading PDF and loading fields...',
        life: 2000
      })

      // The PDF URL is signed and short-lived, so the one on this cached list
      // row may already have expired — the dashboard can sit open for hours.
      // Re-read the form to mint a fresh link before downloading.
      const fresh = await formsStore.fetchForm(form.id)
      if (!fresh.pdfUrl) throw new Error('This form has no PDF')

      const response = await fetch(fresh.pdfUrl)
      if (!response.ok) throw new Error('Failed to download PDF')

      const blob = await response.blob()
      const file = new File([blob], pdfFileName, { type: 'application/pdf' })

      await documentStore.loadPDF(file)
      await formManagement.loadForm(form.id)

      toast.add({
        severity: 'success',
        summary: 'Form Loaded',
        detail: `"${form.title}" is ready to edit`,
        life: 3000
      })
    }
  } catch (err) {
    console.error('Error loading form:', err)
    toast.add({
      severity: 'error',
      summary: 'Load Failed',
      detail: err instanceof Error ? err.message : 'Failed to load form',
      life: 5000
    })
  }
}

function handleDelete(form: Form) {
  confirm.require({
    message: `Are you sure you want to delete "${form.title}"? This action cannot be undone.`,
    header: 'Confirm Delete',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Delete',
    rejectLabel: 'Cancel',
    acceptClass: 'p-button-danger',
    accept: async () => {
      try {
        await formsStore.deleteForm(form.id)
        toast.add({
          severity: 'success',
          summary: 'Deleted',
          detail: 'Form deleted successfully',
          life: 3000
        })
      } catch (err) {
        toast.add({
          severity: 'error',
          summary: 'Error',
          detail: 'Failed to delete form',
          life: 3000
        })
      }
    }
  })
}

async function handlePublish(formId: string) {
  try {
    await formsStore.updateFormStatus(formId, 'published')
    toast.add({
      severity: 'success',
      summary: 'Published',
      detail: 'Form is now accepting responses',
      life: 3000
    })
    // Update selected form
    if (selectedForm.value) {
      selectedForm.value = forms.value.find(f => f.id === formId) || null
    }
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Failed to publish form',
      life: 3000
    })
  }
}

async function handleUnpublish(formId: string) {
  try {
    await formsStore.updateFormStatus(formId, 'draft')
    toast.add({
      severity: 'success',
      summary: 'Unpublished',
      detail: 'Form is no longer accepting responses',
      life: 3000
    })
    // Update selected form
    if (selectedForm.value) {
      selectedForm.value = forms.value.find(f => f.id === formId) || null
    }
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Failed to unpublish form',
      life: 3000
    })
  }
}
</script>

<style scoped>
.forms-list {
  padding: 1.5rem;
  height: 100%;
  overflow-y: auto;
}

/* Custom scrollbar */
.forms-list::-webkit-scrollbar {
  width: 6px;
}

.forms-list::-webkit-scrollbar-track {
  background: transparent;
}

.forms-list::-webkit-scrollbar-thumb {
  background: #d8dae1;
  border-radius: 3px;
}

.forms-list::-webkit-scrollbar-thumb:hover {
  background: #9ba1ac;
}
</style>
