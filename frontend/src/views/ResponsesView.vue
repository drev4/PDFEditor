<template>
  <AppShell>
    <div class="responses-view flex flex-col flex-grow min-h-0">
      <!-- Header -->
      <header class="px-gutter pt-[26px]">
        <nav class="flex items-center gap-1.5 text-meta text-faint mb-2">
          <RouterLink to="/dashboard/forms" class="text-muted">Forms</RouterLink>
          <i class="pi pi-angle-right text-[11px]" />
          <span class="truncate max-w-[420px]">{{ form?.title || 'Loading' }}</span>
        </nav>

        <div class="flex items-end gap-4">
          <h1 class="text-title flex-grow">Responses</h1>

          <div class="flex items-center gap-2.5">
            <button
              type="button"
              class="flex items-center justify-center w-control-sm h-control-sm rounded-control border border-line text-muted hover:text-ink hover:bg-surface-sunken transition-colors"
              :disabled="loading"
              aria-label="Refresh"
              @click="loadData"
            >
              <i class="pi pi-refresh text-[13px]" :class="{ 'pi-spin': loading }" />
            </button>
            <button
              type="button"
              class="flex items-center gap-1.5 h-control-sm px-3.5 rounded-control border border-line text-body font-medium text-ink hover:bg-surface-sunken transition-colors disabled:text-disabled disabled:hover:bg-surface"
              :disabled="!responses.length || exporting"
              @click="handleExport"
            >
              <i class="pi text-[13px]" :class="exporting ? 'pi-spin pi-spinner' : 'pi-download'" />
              <span>Export CSV</span>
            </button>
          </div>
        </div>
      </header>

      <!-- Count strip. Numbers are mono, so a reader can compare them down the
           page rather than reading them as prose. -->
      <div class="flex items-center px-gutter pt-4 pb-2.5 border-b border-line">
        <div class="flex-grow" />
        <span class="text-meta text-faint">
          <strong class="num font-medium text-ink">{{ totalResponses }}</strong>
          total
        </span>
      </div>

      <div class="flex-grow min-h-0 overflow-hidden">
        <DataTable
          :value="formattedResponses"
          :loading="loading"
          :lazy="true"
          :paginator="true"
          :rows="rows"
          :totalRecords="totalResponses"
          @page="onPage($event)"
          class="responses-table"
          scrollable
          scrollHeight="flex"
          responsiveLayout="scroll"
        >
          <template #empty>
            <div class="flex flex-col items-center justify-center py-20 text-center">
              <p class="text-section">No responses yet</p>
              <p class="text-body text-muted mt-1.5">
                Share the form's link and answers appear here as they arrive.
              </p>
            </div>
          </template>

          <Column field="submittedAt" header="Submitted" sortable style="min-width: 148px">
            <template #body="{ data }">
              <span class="num text-mono text-muted">{{ submittedAt(data.submittedAt) }}</span>
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
              <div class="truncate max-w-xs text-row" v-tooltip.top="String(data[field as string] || '')">
                {{ data[field as string] || '—' }}
              </div>
            </template>
          </Column>

          <Column field="ipAddress" header="IP address" style="min-width: 130px">
            <template #body="{ data }">
              <span class="num text-mono text-faint">{{ data.ipAddress || 'unknown' }}</span>
            </template>
          </Column>

          <Column header="" alignFrozen="right" frozen style="min-width: 56px">
            <template #body="{ data }">
              <button
                type="button"
                class="flex items-center justify-center w-7 h-7 rounded-input text-faint hover:text-ink hover:bg-surface-sunken transition-colors"
                aria-label="View response"
                @click="viewDetails(data)"
              >
                <i class="pi pi-arrow-up-right text-[12px]" />
              </button>
            </template>
          </Column>
        </DataTable>
      </div>
    </div>

    <!-- Detail -->
    <Dialog
      v-model:visible="showDetails"
      :header="`Response · ${formattedDate}`"
      modal
      :style="{ width: '46rem' }"
      :breakpoints="{ '960px': '75vw', '641px': '100vw' }"
    >
      <div v-if="selectedResponse" class="py-1">
        <div class="grid grid-cols-2 gap-4 p-4 rounded-card border border-line bg-surface-subtle mb-6">
          <div>
            <p class="col-label mb-1">Submitted</p>
            <p class="num text-mono">{{ submittedAt(selectedResponse.submittedAt) }}</p>
          </div>
          <div>
            <p class="col-label mb-1">IP address</p>
            <p class="num text-mono">{{ selectedResponse.ipAddress || '—' }}</p>
          </div>
        </div>

        <div class="flex flex-col">
          <div
            v-for="field in responseFields"
            :key="field.id"
            class="py-3.5 border-b border-line-soft last:border-0"
          >
            <p class="col-label mb-1.5">{{ field.label || field.name }}</p>
            <div class="text-body whitespace-pre-wrap">{{ getAnswerValue(field.id) }}</div>
          </div>
        </div>
      </div>
    </Dialog>
  </AppShell>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, type Directive } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { useToast } from 'primevue/usetoast'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Dialog from 'primevue/dialog'
import Tooltip from 'primevue/tooltip'
import AppShell from '@/layouts/AppShell.vue'
import { submittedAt } from '@/utils/formatDate'
import { formsService, type Form, type Field } from '@/services/forms'
import { responsesService, type FormResponse } from '@/services/responses'

// Directive registration for local use
const vTooltip = Tooltip as unknown as Directive

const route = useRoute()
const toast = useToast()

const formId = route.params.id as string
const form = ref<Form | null>(null)
const responses = ref<FormResponse[]>([])
const loading = ref(true)
const exporting = ref(false)
const totalResponses = ref(0)
const rows = ref(20)
const offset = ref(0)

const responseFields = ref<Field[]>([])

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
    // Columns come from the responses endpoint, not from the form: it also
    // returns fields archived by a later edit, whose answers are still here.
    responseFields.value = result.fields ?? form.value?.fields ?? []
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

function onPage(event: { rows: number; first: number }) {
  rows.value = event.rows
  offset.value = event.first
  loadData()
}

// Dynamic columns based on every field these responses have answers for,
// archived ones included.
const dynamicColumns = computed(() => {
  return responseFields.value.map(field => ({
    fieldId: (field.id as string),
    header: (field.label || field.name)
  }))
})

// Flatten responses for DataTable
const formattedResponses = computed(() => {
  return responses.value.map(resp => {
    const row: Record<string, string | null | undefined> = {
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

const formattedDate = computed(() => {
  if (!selectedResponse.value) return ''
  return submittedAt(selectedResponse.value.submittedAt)
})

function viewDetails(data: { id: string }) {
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
/* The Responses artboard: an uppercase 11px column label over a quiet header
   row, 56px rows, and a rule rather than a fill between them. */
.responses-table :deep(.p-datatable-thead > tr > th) {
  background: theme('colors.surface.subtle');
  color: theme('colors.faint');
  font-weight: 600;
  text-transform: uppercase;
  font-size: 11px;
  letter-spacing: 0.06em;
  padding: 11px 16px;
  border-bottom: 1px solid theme('colors.line.soft');
}

.responses-table :deep(.p-datatable-tbody > tr) {
  background: theme('colors.surface.DEFAULT');
  transition: background-color 0.15s;
}

.responses-table :deep(.p-datatable-tbody > tr:hover) {
  background: theme('colors.surface.subtle') !important;
}

.responses-table :deep(.p-datatable-tbody > tr > td) {
  padding: 12px 16px;
  border-bottom: 1px solid theme('colors.line.soft');
  font-size: 13.5px;
  height: 56px;
}

:deep(.p-paginator) {
  background: transparent;
  border: none;
  border-top: 1px solid theme('colors.line.DEFAULT');
  padding: 14px 16px;
}

:deep(.p-paginator .p-paginator-page) {
  min-width: 30px;
  height: 30px;
  border-radius: 6px;
  font-family: theme('fontFamily.mono');
  font-size: 12px;
}
</style>
