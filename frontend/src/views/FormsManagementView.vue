<template>
  <div class="forms-management-view min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 p-6 md:p-8">
    <div class="max-w-7xl mx-auto">
      <!-- Fluid Header -->
      <header class="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
        <div class="flex items-start gap-4">
          <Button 
            icon="pi pi-arrow-left" 
            text 
            rounded 
            @click="router.push('/dashboard')"
            class="text-gray-600 hover:text-blue-600 mt-1"
          />
          <div>
            <h1 class="text-3xl font-black text-gray-900 tracking-tight">My Forms</h1>
            <p class="text-gray-500 text-sm mt-1">
              Manage your professional PDF forms and view results.
            </p>
          </div>
        </div>

        <div class="flex items-center gap-3 sm:self-center pl-14 sm:pl-0">
          <Button 
            icon="pi pi-plus" 
            label="New" 
            severity="primary"
            class="shadow-lg shadow-blue-500/20 px-6"
            @click="router.push('/dashboard')"
          />
          <Button 
            icon="pi pi-refresh" 
            severity="secondary" 
            text 
            rounded
            :loading="formsStore.loading"
            @click="formsStore.fetchForms"
          />
        </div>
      </header>

      <!-- Loading State -->
      <div v-if="formsStore.loading && !formsStore.forms.length" class="flex flex-col items-center justify-center py-20">
        <ProgressSpinner />
        <p class="mt-4 text-gray-500 font-medium tracking-wide">Loading your forms...</p>
      </div>

      <!-- Empty State -->
      <div v-else-if="!formsStore.forms.length" class="bg-white/80 backdrop-blur-md rounded-2xl p-16 text-center shadow-xl border border-white">
        <div class="inline-flex items-center justify-center w-20 h-20 bg-blue-50 rounded-full mb-6 text-blue-500">
          <i class="pi pi-inbox text-5xl"></i>
        </div>
        <h2 class="text-2xl font-bold text-gray-800 mb-2">No forms found</h2>
        <p class="text-gray-600 max-w-sm mx-auto mb-8">
          You haven't created any forms yet. Upload a PDF in the dashboard to get started!
        </p>
        <Button 
          label="Go to Dashboard" 
          icon="pi pi-home" 
          @click="router.push('/dashboard')" 
          outlined
        />
      </div>

      <!-- Forms Grid -->
      <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
        <div 
          v-for="(form, index) in formsStore.forms" 
          :key="form.id"
          class="group bg-white/70 backdrop-blur-sm rounded-2xl border border-white shadow-sm hover:shadow-2xl transition-all duration-500 flex flex-col overflow-hidden animate-slide-up"
          :style="{ animationDelay: `${index * 0.1}s` }"
        >
          <!-- Form Preview / Icon Area -->
          <div class="h-48 bg-gradient-to-br from-blue-500/10 to-indigo-500/10 flex items-center justify-center relative overflow-hidden group-hover:from-blue-500/15 group-hover:to-indigo-500/15 transition-all duration-700">
            <!-- Background Decorative Shape -->
            <div class="absolute -bottom-4 -right-4 w-32 h-32 bg-blue-500/5 rounded-full blur-3xl group-hover:bg-blue-500/10 transition-colors"></div>
            
            <i class="pi pi-file-pdf text-7xl text-blue-600/30 group-hover:text-blue-600/50 group-hover:scale-110 transition-all duration-500 ease-out"></i>
            
            <!-- Status Badge -->
            <div 
              class="absolute top-5 right-5 px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider shadow-sm border border-white/50"
              :class="getStatusClass(form.status)"
            >
              {{ form.status }}
            </div>
          </div>

          <!-- Content -->
          <div class="p-8 flex-1 flex flex-col">
            <h3 class="text-xl font-bold text-gray-900 mb-2 truncate group-hover:text-blue-600 transition-colors" :title="form.title">
              {{ form.title }}
            </h3>
            <p class="text-gray-500 text-sm line-clamp-2 mb-6 flex-1 leading-relaxed">
              {{ form.description || 'Manage and view responses for this professional PDF form.' }}
            </p>

            <!-- Stats -->
            <div class="flex items-center gap-6 py-5 border-y border-gray-100/80 mb-6">
              <div class="flex flex-col gap-1">
                <span class="text-[10px] uppercase font-bold text-gray-400 tracking-widest">Views</span>
                <div class="flex items-center gap-2">
                  <i class="pi pi-eye text-blue-500 text-sm"></i>
                  <span class="font-bold text-gray-800">{{ form.viewCount || 0 }}</span>
                </div>
              </div>
              <div class="flex flex-col gap-1">
                <span class="text-[10px] uppercase font-bold text-gray-400 tracking-widest">Responses</span>
                <div class="flex items-center gap-2">
                  <i class="pi pi-check-circle text-green-500 text-sm"></i>
                  <span class="font-bold text-gray-800">{{ form._count?.responses || 0 }}</span>
                </div>
              </div>
            </div>

            <!-- Actions -->
            <div class="grid grid-cols-2 gap-3">
              <Button 
                label="Edit Fields" 
                icon="pi pi-pencil" 
                size="small" 
                outlined 
                class="hover:bg-blue-50 transition-colors"
                @click="handleEdit(form)"
              />
              <Button 
                label="Responses" 
                icon="pi pi-chart-bar" 
                size="small" 
                severity="success" 
                outlined 
                class="hover:bg-green-50 transition-colors"
                @click="viewResponses(form.id)"
              />
              <Button 
                label="Share" 
                icon="pi pi-share-alt" 
                size="small" 
                severity="info" 
                outlined 
                class="hover:bg-cyan-50 transition-colors"
                @click="handleShare(form)"
              />
              <Button 
                label="Delete" 
                icon="pi pi-trash" 
                size="small" 
                severity="danger" 
                outlined 
                class="hover:bg-red-50 transition-colors"
                @click="handleDelete(form)"
              />
            </div>
          </div>
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

    <ConfirmDialog />
    <Toast position="top-right" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useToast } from 'primevue/usetoast'
import { useConfirm } from 'primevue/useconfirm'
import Button from 'primevue/button'
import ProgressSpinner from 'primevue/progressspinner'
import ConfirmDialog from 'primevue/confirmdialog'
import Toast from 'primevue/toast'
import ShareFormModal from '@/components/forms/ShareFormModal.vue'
import { useFormsStore } from '@/stores/forms.store'
import { useDocumentStore } from '@/stores/document.store'
import { useFormManagement } from '@/composables/useFormManagement'
import { type Form } from '@/services/forms'

const router = useRouter()
const toast = useToast()
const confirm = useConfirm()
const formsStore = useFormsStore()
const documentStore = useDocumentStore()
const formManagement = useFormManagement()

const showShareModal = ref(false)
const selectedForm = ref<Form | null>(null)

onMounted(() => {
  formsStore.fetchForms()
})

function getStatusClass(status: string) {
  switch (status) {
    case 'published': return 'bg-green-100 text-green-700'
    case 'closed': return 'bg-red-100 text-red-700'
    default: return 'bg-gray-100 text-gray-700'
  }
}

function viewResponses(id: string) {
  router.push({ name: 'form-responses', params: { id } })
}

async function handleEdit(form: Form) {
  if (!form.pdfUrl) {
    toast.add({ severity: 'warn', summary: 'Error', detail: 'This form has no PDF', life: 3000 })
    return
  }

  try {
    const pdfFileName = form.pdfUrl.split('/').pop() || `${form.title}.pdf`
    const response = await fetch(form.pdfUrl)
    if (!response.ok) throw new Error('Failed to download PDF')

    const blob = await response.blob()
    const file = new File([blob], pdfFileName, { type: 'application/pdf' })

    await documentStore.loadPDF(file)
    await formManagement.loadForm(form.id)
    
    router.push('/dashboard')
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
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  line-clamp: 2;
  overflow: hidden;
}
</style>
