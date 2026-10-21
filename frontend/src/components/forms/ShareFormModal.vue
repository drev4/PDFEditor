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
      <div class="flex items-center justify-between p-4 rounded-lg bg-surface-subtle">
        <div class="flex items-center gap-3">
          <i
            class="pi text-title"
            :class="form.status === 'published' ? 'pi-globe text-published' : 'pi-lock text-faint'"
          ></i>
          <div>
            <p class="font-semibold text-ink">
              {{ form.status === 'published' ? 'Published' : 'Draft' }}
            </p>
            <p class="text-body text-muted">
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

      <!--
        What is stored about the people who respond (features/0032, finding S7).
        It lives here, beside publishing, because it is a property of what
        happens when somebody uses the link rather than of the document.
      -->
      <div class="flex items-start justify-between gap-4 p-4 rounded-lg bg-surface-subtle">
        <div>
          <p class="font-semibold text-ink">Record who responded</p>
          <p class="text-body text-muted">
            Stores each respondent's IP address and browser with their
            submission. Off by default, and the public form tells them when it
            is on.
          </p>
          <p
            v-if="metadataError"
            class="mt-1 text-body text-danger"
            role="alert"
            data-testid="metadata-error"
          >
            {{ metadataError }}
          </p>
        </div>
        <InputSwitch
          v-model="collectsMetadata"
          :disabled="isTogglingMetadata"
          data-testid="collects-metadata-switch"
          @change="handleToggleMetadata"
        />
      </div>

      <!-- Analytics -->
      <div v-if="form.status === 'published'" class="grid grid-cols-2 gap-4">
        <div class="p-4 rounded-lg bg-accent-soft border border-accent">
          <div class="flex items-center gap-2 mb-1">
            <i class="pi pi-eye text-accent"></i>
            <span class="text-body font-medium text-accent">Views</span>
          </div>
          <p class="text-title font-bold text-accent">{{ form.viewCount || 0 }}</p>
        </div>
        <div class="p-4 rounded-lg bg-published-soft border border-published">
          <div class="flex items-center gap-2 mb-1">
            <i class="pi pi-check-circle text-published"></i>
            <span class="text-body font-medium text-published">Responses</span>
          </div>
          <p class="text-title font-bold text-published">{{ form._count?.responses || 0 }}</p>
        </div>
      </div>

      <!-- Share Link -->
      <div v-if="form.status === 'published'">
        <label class="block text-body font-medium text-ink mb-2">Share Link</label>
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
        <p class="text-meta text-muted mt-2">
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
import { formsService, type Form } from '@/services/forms'

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

/**
 * Whether this form records its respondents (features/0032).
 *
 * Unlike publishing, this calls the service directly instead of emitting to the
 * parent. Publishing is emitted because three different screens each keep their
 * own copy of the form and all of them render its status; this flag is rendered
 * nowhere but here, so threading an event through `FormSavePanel`, `FormsList`
 * and `FormsManagementView` would add three call sites to keep a value in sync
 * that none of them displays.
 *
 * The honest cost: the parent's copy of `form` keeps the old value until the
 * next list refresh. Harmless today, and the thing to revisit if this flag ever
 * appears on a screen.
 */
const collectsMetadata = ref(false)
const isTogglingMetadata = ref(false)
const metadataError = ref<string | null>(null)

// Update isPublished when form changes
watch(() => props.form?.status, (status) => {
  isPublished.value = status === 'published'
}, { immediate: true })

watch(() => props.form?.collectsRespondentMetadata, (value) => {
  collectsMetadata.value = value === true
  metadataError.value = null
}, { immediate: true })

async function handleToggleMetadata() {
  if (!props.form) return

  const wanted = collectsMetadata.value
  isTogglingMetadata.value = true
  metadataError.value = null

  try {
    await formsService.update(props.form.id, { collectsRespondentMetadata: wanted })
    toast.add({
      severity: 'success',
      summary: wanted ? 'Recording respondents' : 'No longer recording respondents',
      detail: wanted
        ? "New submissions will store the respondent's IP address and browser."
        : 'New submissions will store neither. Anything already collected is unchanged.',
      life: 3000
    })
  } catch (error) {
    // Put the switch back where it was, so it never shows a state the server
    // does not hold.
    collectsMetadata.value = !wanted
    metadataError.value = error instanceof Error ? error.message : 'Could not change this setting'
  } finally {
    isTogglingMetadata.value = false
  }
}

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
