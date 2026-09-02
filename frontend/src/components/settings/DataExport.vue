<template>
  <section v-if="canExport" class="px-gutter mt-5" data-testid="data-export">
    <div class="p-4 rounded-card border border-line max-w-[560px]">
      <h2 class="col-label mb-3">Your data</h2>

      <p class="text-body text-muted">
        Download everything this organization holds as a single JSON file: your
        forms and their fields, every response and answer collected through them,
        the members, and your usage per month.
      </p>
      <p class="mt-2 text-meta text-faint">
        The uploaded PDFs are not in the file — each form records the address of
        its own document. A complete file ends with
        <code class="num">"complete": true</code>; if that is missing, the
        download was cut short and should be repeated.
      </p>

      <Button
        label="Download my data"
        icon="pi pi-download"
        outlined
        class="mt-4"
        :loading="loading"
        data-testid="data-export-download"
        @click="download"
      />

      <p
        v-if="error"
        class="mt-3 text-body text-danger"
        role="alert"
        data-testid="data-export-error"
      >
        {{ error }}
      </p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import Button from 'primevue/button'
import { organizationService } from '@/services/organization'
import { useOrganizationStore } from '@/stores/organization.store'
import { useAsyncAction } from '@/composables/useAsyncAction'

/**
 * Downloading everything (features/0030) — the portability half of S8.
 *
 * It sits above the Danger zone deliberately. Erasure shipped first, and until
 * this existed the only way out of the product was to lose everything; putting
 * the way out directly above the way to destroy it is the honest ordering.
 *
 * **Hidden for a member rather than shown and refused.** The endpoint is owner
 * or admin, and a button whose only possible answer is `403` tells somebody the
 * product is broken when it is enforcing a rule — the same argument
 * `ApiKeysPanel` makes for not drawing a create form on a plan without API
 * access (05-frontend-patterns §8).
 */
const organizationStore = useOrganizationStore()

const loading = ref(false)
const error = ref<string | null>(null)

const canExport = computed(() =>
  organizationStore.currentRole === 'owner' || organizationStore.currentRole === 'admin'
)

async function download() {
  let blob: Blob
  try {
    blob = await useAsyncAction(
      { loading, error },
      () => organizationService.exportData(),
      { fallbackMessage: 'Could not download your data' }
    )
  } catch {
    return
  }

  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.setAttribute('download', filename())
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.URL.revokeObjectURL(url)
}

/**
 * The server sends its own name in `Content-Disposition`, but `api.download`
 * returns only the blob, so it is rebuilt here in the same shape. A mismatch is
 * cosmetic; the file's contents are what matter.
 */
function filename(): string {
  const slug = organizationStore.activeOrganization?.slug ?? 'organization'
  return `vuepdf-export-${slug}-${new Date().toISOString().slice(0, 10)}.json`
}
</script>
