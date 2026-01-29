<template>
  <div class="forms-list">
    <!-- Header -->
    <div class="flex items-center justify-between mb-4">
      <h3 class="text-sm font-bold text-gray-700 uppercase tracking-wide">
        My Forms
      </h3>
      <span class="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full font-semibold">
        {{ forms.length }}
      </span>
    </div>

    <!-- Loading State -->
    <div v-if="isLoading" class="flex items-center justify-center py-12">
      <ProgressSpinner style="width: 50px; height: 50px" />
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="text-center py-8">
      <i class="pi pi-exclamation-circle text-red-500 text-4xl mb-3"></i>
      <p class="text-sm text-red-600">{{ error }}</p>
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
      <i class="pi pi-inbox text-gray-400 text-5xl mb-4"></i>
      <p class="text-sm text-gray-600 mb-2">No forms yet</p>
      <p class="text-xs text-gray-500">Create a form from your PDF document</p>
    </div>

    <!-- Forms List -->
    <div v-else class="space-y-3">
      <div
        v-for="form in forms"
        :key="form.id"
        class="group p-4 rounded-xl bg-gray-50 hover:bg-gray-100 hover:shadow-md transition-all duration-200"
      >
        <!-- Form Header -->
        <div class="flex items-start gap-3 mb-3">
          <div class="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
            <i class="pi pi-file text-blue-600 text-xl"></i>
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-semibold text-gray-900 truncate">
              {{ form.title }}
            </p>
            <p v-if="form.description" class="text-xs text-gray-500 truncate mt-0.5">
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
          <div class="flex items-center gap-2 text-xs text-gray-600">
            <i class="pi pi-eye text-gray-400"></i>
            <span>{{ form.viewCount || 0 }} views</span>
          </div>
          <div class="flex items-center gap-2 text-xs text-gray-600">
            <i class="pi pi-check-circle text-gray-400"></i>
            <span>{{ form._count?.responses || 0 }} responses</span>
          </div>
        </div>

        <!-- Actions -->
        <div class="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            icon="pi pi-share-alt"
            label="Share"
            @click="handleShare(form)"
            size="small"
            severity="info"
            outlined
            class="flex-1"
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
import { ref, onMounted } from 'vue'
import { useToast } from 'primevue/usetoast'
import { useConfirm } from 'primevue/useconfirm'
import Button from 'primevue/button'
import ProgressSpinner from 'primevue/progressspinner'
import Toast from 'primevue/toast'
import ShareFormModal from './ShareFormModal.vue'
import { formsService, type Form } from '@/services/forms'

const toast = useToast()
const confirm = useConfirm()

const forms = ref<Form[]>([])
const isLoading = ref(false)
const error = ref<string | null>(null)
const showShareModal = ref(false)
const selectedForm = ref<Form | null>(null)

onMounted(() => {
  loadForms()
})

async function loadForms() {
  isLoading.value = true
  error.value = null
  try {
    forms.value = await formsService.list()
  } catch (err: any) {
    console.error('Error loading forms:', err)
    error.value = err.message || 'Failed to load forms'
  } finally {
    isLoading.value = false
  }
}

function statusClass(status: string) {
  switch (status) {
    case 'published':
      return 'bg-green-100 text-green-700'
    case 'draft':
      return 'bg-gray-200 text-gray-700'
    case 'closed':
      return 'bg-red-100 text-red-700'
    default:
      return 'bg-gray-100 text-gray-600'
  }
}

function handleShare(form: Form) {
  selectedForm.value = form
  showShareModal.value = true
}

function handleEdit(form: Form) {
  // TODO: Implement edit functionality
  toast.add({
    severity: 'info',
    summary: 'Coming Soon',
    detail: 'Form editing will be available soon',
    life: 3000
  })
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
        await formsService.delete(form.id)
        toast.add({
          severity: 'success',
          summary: 'Deleted',
          detail: 'Form deleted successfully',
          life: 3000
        })
        await loadForms()
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
    await formsService.update(formId, { status: 'published' })
    toast.add({
      severity: 'success',
      summary: 'Published',
      detail: 'Form is now accepting responses',
      life: 3000
    })
    await loadForms()
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
    await formsService.update(formId, { status: 'draft' })
    toast.add({
      severity: 'success',
      summary: 'Unpublished',
      detail: 'Form is no longer accepting responses',
      life: 3000
    })
    await loadForms()
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
  background: #cbd5e1;
  border-radius: 3px;
}

.forms-list::-webkit-scrollbar-thumb:hover {
  background: #94a3b8;
}
</style>
