<template>
  <div class="min-h-screen bg-surface-sunken flex items-center justify-center px-4">
    <div class="max-w-[400px] w-full">
      <div class="bg-surface rounded-card border border-line shadow-paper p-8 text-center">
        <div
          class="mx-auto flex items-center justify-center h-11 w-11 rounded-pill bg-published-soft text-published mb-5"
        >
          <i class="pi pi-check text-[16px]" />
        </div>

        <h2 class="text-title">Response Submitted</h2>

        <p class="text-body text-muted mt-2 mb-7">
          Thank you for completing the form. Your answers have been recorded.
        </p>

        <button
          type="button"
          class="w-full h-control rounded-control bg-accent hover:bg-accent-pressed text-white text-row font-medium transition-colors"
          @click="submitAnother"
        >
          Submit another response
        </button>

        <div class="mt-7 pt-5 border-t border-line-soft">
          <p class="text-micro text-faint">
            Recorded at <span class="num">{{ recordedAt }}</span>
          </p>
        </div>
      </div>

      <p class="mt-4 text-center text-meta text-faint">You can now close this window.</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { submittedAt } from '@/utils/formatDate'

const route = useRoute()
const router = useRouter()

const shareId = computed(() => route.params.shareId as string)

// Read once on arrival. The old version called `new Date()` inside the
// template, so the "recorded at" time moved on every re-render.
const recordedAt = submittedAt(new Date().toISOString())

function submitAnother() {
  router.push(`/form/${shareId.value}`)
}
</script>
