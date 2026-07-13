<template>
  <div class="min-h-screen bg-gray-50 flex items-center justify-center px-4">
    <div class="max-w-md w-full">
      <!-- Success Card -->
      <div class="bg-white rounded-lg shadow-lg p-8 text-center">
        <!-- Success Icon -->
        <div class="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-green-100 mb-6">
          <svg class="h-10 w-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
          </svg>
        </div>

        <!-- Title -->
        <h2 class="text-2xl font-bold text-gray-900 mb-2">
          Response Submitted!
        </h2>

        <!-- Message -->
        <p class="text-gray-600 mb-8">
          Thank you for completing the form. Your response has been successfully submitted.
        </p>

        <!-- Actions -->
        <div class="space-y-3">
          <button
            @click="submitAnother"
            class="w-full px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
          >
            Submit Another Response
          </button>
        </div>

        <!-- Footer -->
        <div class="mt-8 pt-6 border-t border-gray-200">
          <p class="text-xs text-gray-500">
            Your response has been recorded at {{ new Date().toLocaleString() }}
          </p>
        </div>
      </div>

      <!-- Additional Info -->
      <div class="mt-4 text-center">
        <p class="text-sm text-gray-500">
          You can now close this window
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()

const shareId = computed(() => route.params.shareId as string)

function submitAnother() {
  router.push(`/form/${shareId.value}`)
}
</script>
