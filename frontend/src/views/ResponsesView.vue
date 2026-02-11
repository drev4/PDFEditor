<template>
  <div class="responses-view min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 p-6 md:p-8">
    <div class="max-w-7xl mx-auto">
      <!-- Header -->
      <header class="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div class="flex items-center gap-2 mb-2">
            <Button 
              icon="pi pi-arrow-left" 
              text 
              rounded 
              @click="router.push('/dashboard')"
              class="text-gray-600 hover:text-blue-600"
            />
            <h1 class="text-3xl font-bold text-gray-900">
              {{ form?.title || 'Loading Form...' }}
            </h1>
          </div>
          <p class="text-gray-600 ml-12">
            {{ responses.length > 0 ? `Viewing ${totalResponses} responses` : 'No responses yet' }}
          </p>
        </div>

        <div class="flex items-center gap-3 ml-12 md:ml-0">
          <Button 
            icon="pi pi-download" 
            label="Export CSV" 
            severity="secondary" 
            outlined
            :disabled="!responses.length"
            :loading="exporting"
            @click="handleExport"
          />
          <Button 
            icon="pi pi-refresh" 
            severity="secondary" 
            text 
            rounded
            :loading="loading"
            @click="loadData"
          />
        </div>
      </header>

      <!-- Main Content -->
      <div class="bg-white/80 backdrop-blur-md rounded-2xl shadow-xl border border-white overflow-hidden">
        <DataTable
          :value="formattedResponses"
          :loading="loading"
          :lazy="true"
          :paginator="true"
          :rows="rows"
          :totalRecords="totalResponses"
          @page="onPage($event)"
          class="p-datatable-sm responses-table"
          stripedRows
          scrollable
          scrollHeight="calc(100vh - 350px)"
          responsiveLayout="scroll"
        >
          <template #empty>
            <div class="flex flex-col items-center justify-center py-20 text-gray-500">
              <i class="pi pi-inbox text-6xl mb-4 opacity-20"></i>
              <p class="text-xl font-medium">No responses found</p>
              <p class="text-sm">Share your form to start collecting data!</p>
            </div>
          </template>

          <Column field="submittedAt" header="Date Submitted" sortable style="min-width: 180px">
            <template #body="{ data }">
              <span class="font-medium text-gray-700">
                {{ formatDate(data.submittedAt) }}
              </span>
            </template>
          </Column>

          <Column 
            v-for="col in dynamicColumns" 
            :key="col.fieldId" 
            :field="col.fieldId" 
            :header="col.header"
            style="min-width: 150px"
          >
            <template #body="{ data, field }">
              <div class="truncate max-w-xs" v-tooltip.top="String(data[field] || '')">
                {{ data[field] || '-' }}
              </div>
            </template>
          </Column>

          <Column field="ipAddress" header="IP Address" style="min-width: 130px">
            <template #body="{ data }">
              <span class="text-xs font-mono text-gray-500">{{ data.ipAddress || 'unknown' }}</span>
            </template>
          </Column>

          <Column header="Actions" alignFrozen="right" frozen style="min-width: 80px">
            <template #body="{ data }">
              <Button 
                icon="pi pi-eye" 
                text 
                rounded 
                severity="info" 
                @click="viewDetails(data)"
              />
            </template>
          </Column>
        </DataTable>
      </div>
    </div>

    <!-- Detail Modal -->
    <Dialog 
      v-model:visible="showDetails" 
      :header="`Response Detail - ${formattedDate}`" 
      modal 
      :style="{ width: '50vw' }" 
      :breakpoints="{ '960px': '75vw', '641px': '100vw' }"
    >
      <div v-if="selectedResponse" class="space-y-6 py-4">
        <!-- Metadata -->
        <div class="grid grid-cols-2 gap-4 bg-gray-50 p-4 rounded-xl border border-gray-100 mb-6">
          <div>
            <p class="text-xs uppercase tracking-wider text-gray-500 font-bold mb-1">Submitted At</p>
            <p class="text-sm font-medium">{{ formatDate(selectedResponse.submittedAt) }}</p>
          </div>
          <div>
            <p class="text-xs uppercase tracking-wider text-gray-500 font-bold mb-1">IP Address</p>
            <p class="text-sm font-medium">{{ selectedResponse.ipAddress || 'N/A' }}</p>
          </div>
        </div>

        <!-- Answers -->
        <div class="space-y-4">
          <h3 class="text-lg font-bold text-gray-800 flex items-center gap-2">
            <i class="pi pi-list text-blue-600"></i>
            Responses
          </h3>
          <div class="grid grid-cols-1 gap-y-4">
            <div 
              v-for="field in form?.fields" 
              :key="field.id"
              class="border-b border-gray-100 pb-4"
            >
              <p class="text-sm font-bold text-gray-700 mb-1">{{ field.label || field.name }}</p>
              <div class="text-gray-600 text-sm whitespace-pre-wrap leading-relaxed">
                {{ getAnswerValue(field.id) }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Dialog>

    <Toast position="top-right" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, type Directive } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useToast } from 'primevue/usetoast'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import Toast from 'primevue/toast'
import Tooltip from 'primevue/tooltip'
import { formsService, type Form } from '@/services/forms'
import { responsesService, type FormResponse } from '@/services/responses'

// Directive registration for local use
const vTooltip = Tooltip as unknown as Directive

const route = useRoute()
const router = useRouter()
const toast = useToast()

const formId = route.params.id as string
const form = ref<Form | null>(null)
const responses = ref<FormResponse[]>([])
const loading = ref(true)
const exporting = ref(false)
const totalResponses = ref(0)
const rows = ref(20)
const offset = ref(0)

const showDetails = ref(false)
const selectedResponse = ref<FormResponse | null>(null)

onMounted(async () => {
  await loadData()
})

async function loadData() {
  loading.value = true
  try {
    // 1. Fetch Form Details (to get fields)
    if (!form.value) {
      const fetchedForm = await formsService.get(formId)
      form.value = fetchedForm
    }

    // 2. Fetch Responses
    const result = await responsesService.listByForm(formId, rows.value, offset.value)
    responses.value = result.responses
    totalResponses.value = result.pagination.total
  } catch (error) {
    console.error('Failed to load data:', error)
    toast.add({
      severity: 'error',
      summary: 'Load Error',
      detail: 'Could not fetch responses. Please try again.',
      life: 5000
    })
  } finally {
    loading.value = false
  }
}

function onPage(event: any) {
  rows.value = event.rows
  offset.value = event.first
  loadData()
}

// Dynamic columns based on form fields
const dynamicColumns = computed(() => {
  if (!form.value?.fields) return []
  return form.value.fields.map(field => ({
    fieldId: (field.id as string),
    header: (field.label || field.name)
  }))
})

// Flatten responses for DataTable
const formattedResponses = computed(() => {
  return responses.value.map(resp => {
    const row: Record<string, any> = {
      id: resp.id,
      submittedAt: resp.submittedAt,
      ipAddress: resp.ipAddress,
      userAgent: resp.userAgent
    }

    // Map each answer to its fieldId key
    resp.answers.forEach(ans => {
      row[ans.fieldId] = ans.value
    })

    return row
  })
})

function formatDate(dateStr: string) {
  const date = new Date(dateStr)
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date)
}

const formattedDate = computed(() => {
  if (!selectedResponse.value) return ''
  return formatDate(selectedResponse.value.submittedAt)
})

function viewDetails(data: any) {
  selectedResponse.value = responses.value.find(r => r.id === data.id) || null
  showDetails.value = true
}

function getAnswerValue(fieldId: string) {
  if (!selectedResponse.value) return '-'
  const answer = selectedResponse.value.answers.find(a => a.fieldId === fieldId)
  return answer ? answer.value : '-'
}

async function handleExport() {
  exporting.value = true
  try {
    const blob = await responsesService.export(formId)
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    
    const fileName = `responses-${form.value?.title.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'form'}.csv`
    link.setAttribute('download', fileName)
    
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.URL.revokeObjectURL(url)
    
    toast.add({
      severity: 'success',
      summary: 'Export Successful',
      detail: 'Your CSV file has been downloaded.',
      life: 3000
    })
  } catch (error) {
    console.error('Export failed:', error)
    toast.add({
      severity: 'error',
      summary: 'Export Failed',
      detail: 'Could not generate CSV. Please try again.',
      life: 5000
    })
  } finally {
    exporting.value = false
  }
}
</script>

<style scoped>
.responses-view {
  min-height: 100vh;
}

.responses-table :deep(.p-datatable-thead > tr > th) {
  background: white;
  color: #334155;
  font-weight: 700;
  text-transform: uppercase;
  font-size: 0.75rem;
  letter-spacing: 0.05em;
  padding: 1rem;
}

.responses-table :deep(.p-datatable-tbody > tr) {
  background: rgba(255, 255, 255, 0.4);
  transition: background-color 0.2s;
}

.responses-table :deep(.p-datatable-tbody > tr:hover) {
  background: rgba(255, 255, 255, 0.9) !important;
}

.responses-table :deep(.p-datatable-tbody > tr > td) {
  padding: 0.75rem 1rem;
  border-bottom: 1px solid rgba(229, 231, 235, 0.5);
  font-size: 0.875rem;
}

/* Custom Paginator */
:deep(.p-paginator) {
  background: transparent;
  border: none;
  padding: 1rem;
}

:deep(.p-paginator .p-paginator-pages .p-paginator-page) {
  min-width: 2.5rem;
  height: 2.5rem;
  border-radius: 0.75rem;
}

:deep(.p-paginator .p-paginator-pages .p-paginator-page.p-highlight) {
  background: #2563eb;
  color: white;
}
</style>
