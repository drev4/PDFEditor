<template>
  <Dialog
    v-model:visible="isVisible"
    modal
    :header="form?.title || 'Share Form'"
    :style="{ width: '35rem' }"
    :dismissableMask="true"
  >
    <div v-if="form" class="space-y-6">
      <!-- Form Status -->
      <div class="flex items-center justify-between p-4 rounded-lg bg-gray-50">
        <div class="flex items-center gap-3">
          <i
            class="pi text-2xl"
            :class="form.status === 'published' ? 'pi-globe text-green-500' : 'pi-lock text-gray-400'"
          ></i>
          <div>
            <p class="font-semibold text-gray-900">
              {{ form.status === 'published' ? 'Published' : 'Draft' }}
            </p>
            <p class="text-sm text-gray-500">
              {{ form.status === 'published' ? 'Anyone with the link can respond' : 'Form is not accepting responses' }}
            </p>
          </div>
        </div>
        <InputSwitch
          v-model="isPublished"
          @change="handleTogglePublish"
          :disabled="isTogglingStatus"
        />
      </div>

      <!-- Analytics -->
      <div v-if="form.status === 'published'" class="grid grid-cols-2 gap-4">
        <div class="p-4 rounded-lg bg-blue-50 border border-blue-200">
          <div class="flex items-center gap-2 mb-1">
            <i class="pi pi-eye text-blue-600"></i>
            <span class="text-sm font-medium text-blue-900">Views</span>
          </div>
          <p class="text-2xl font-bold text-blue-700">{{ form.viewCount || 0 }}</p>
        </div>
        <div class="p-4 rounded-lg bg-green-50 border border-green-200">
          <div class="flex items-center gap-2 mb-1">
            <i class="pi pi-check-circle text-green-600"></i>
            <span class="text-sm font-medium text-green-900">Responses</span>
          </div>
          <p class="text-2xl font-bold text-green-700">{{ form._count?.responses || 0 }}</p>
        </div>
      </div>

      <!-- Share Link -->
      <div v-if="form.status === 'published'">
        <label class="block text-sm font-medium text-gray-700 mb-2">Share Link</label>
        <div class="flex gap-2">
          <InputText
            :value="shareUrl"
            readonly
            class="flex-1"
            @focus="($event.target as HTMLInputElement).select()"
          />
          <Button
            icon="pi pi-copy"
            label="Copy"
            @click="handleCopyLink"
            :disabled="isCopying"
            severity="secondary"
          />
        </div>
        <p class="text-xs text-gray-500 mt-2">
          Share this link with people you want to collect responses from
        </p>
      </div>

      <!-- Actions -->
      <div class="flex gap-2">
        <Button
          v-if="form.status === 'published'"
          icon="pi pi-external-link"
          label="Preview"
          @click="handlePreview"
          outlined
          class="flex-1"
        />
        <Button
          icon="pi pi-times"
          label="Close"
          @click="handleClose"
          severity="secondary"
          outlined
          class="flex-1"
        />
      </div>

      <!-- Toast for copy confirmation -->
      <Toast position="top-center" />
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useToast } from 'primevue/usetoast'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import InputSwitch from 'primevue/inputswitch'
import Toast from 'primevue/toast'
import type { Form } from '@/services/forms'

interface Props {
  visible: boolean
  form: Form | null
}

interface Emits {
  (e: 'update:visible', value: boolean): void
  (e: 'publish', formId: string): void
  (e: 'unpublish', formId: string): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const toast = useToast()

const isVisible = computed({
  get: () => props.visible,
  set: (value) => emit('update:visible', value)
})

const isPublished = ref(false)
const isTogglingStatus = ref(false)
const isCopying = ref(false)

// Update isPublished when form changes
watch(() => props.form?.status, (status) => {
  isPublished.value = status === 'published'
}, { immediate: true })

const shareUrl = computed(() => {
  if (!props.form?.shareId) return ''
  const baseUrl = window.location.origin
  return `${baseUrl}/form/${props.form.shareId}`
})

async function handleTogglePublish() {
  if (!props.form) return

  isTogglingStatus.value = true
  try {
    if (isPublished.value) {
      emit('publish', props.form.id)
    } else {
      emit('unpublish', props.form.id)
    }
  } catch (error) {
    // Revert on error
    isPublished.value = !isPublished.value
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Failed to update form status',
      life: 3000
    })
  } finally {
    isTogglingStatus.value = false
  }
}

async function handleCopyLink() {
  isCopying.value = true
  try {
    await navigator.clipboard.writeText(shareUrl.value)
    toast.add({
      severity: 'success',
      summary: 'Copied!',
      detail: 'Share link copied to clipboard',
      life: 2000
    })
  } catch (error) {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Failed to copy link',
      life: 3000
    })
  } finally {
    isCopying.value = false
  }
}

function handlePreview() {
  if (props.form?.shareId) {
    window.open(`/form/${props.form.shareId}`, '_blank')
  }
}

function handleClose() {
  isVisible.value = false
}
</script>
