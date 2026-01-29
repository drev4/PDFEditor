<template>
  <div class="min-h-screen bg-gray-50">
    <!-- Loading State -->
    <div v-if="isLoading" class="flex items-center justify-center min-h-screen">
      <div class="text-center">
        <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
        <p class="mt-4 text-gray-600">Loading form...</p>
      </div>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="flex items-center justify-center min-h-screen">
      <div class="text-center max-w-md mx-auto px-4">
        <div class="text-red-500 mb-4">
          <svg class="h-16 w-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
        </div>
        <h2 class="text-2xl font-bold text-gray-900 mb-2">Form Not Available</h2>
        <p class="text-gray-600">{{ error }}</p>
      </div>
    </div>

    <!-- Form Content -->
    <div v-else-if="form" class="container mx-auto px-4 py-8 max-w-5xl">
      <!-- Header -->
      <div class="bg-white rounded-lg shadow-sm p-6 mb-6">
        <h1 class="text-3xl font-bold text-gray-900 mb-2">{{ title }}</h1>
        <p v-if="description" class="text-gray-600">{{ description }}</p>
        <div class="mt-4 flex items-center text-sm text-gray-500">
          <svg class="h-5 w-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
          </svg>
          <span>{{ fields.length }} field{{ fields.length !== 1 ? 's' : '' }} to complete</span>
        </div>
      </div>

      <!-- PDF and Fields -->
      <div v-if="pdfUrl" class="bg-white rounded-lg shadow-sm p-6 mb-6">
        <div class="mb-4">
          <h2 class="text-lg font-semibold text-gray-900">Form Document</h2>
          <p class="text-sm text-gray-500">Please fill in the required fields below</p>
        </div>

        <!-- PDF Viewer Placeholder -->
        <div class="border rounded-lg p-4 bg-gray-50 mb-6">
          <div class="aspect-[8.5/11] bg-white shadow-sm rounded flex items-center justify-center">
            <div class="text-center text-gray-500">
              <svg class="h-16 w-16 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path>
              </svg>
              <p class="text-sm">PDF: {{ pdfUrl }}</p>
              <p class="text-xs text-gray-400 mt-1">PDF viewer will be integrated in next iteration</p>
            </div>
          </div>
        </div>

        <!-- Form Fields -->
        <div class="space-y-4">
          <div
            v-for="field in fields"
            :key="field.id"
            class="border rounded-lg p-4"
            :class="{ 'border-red-300 bg-red-50': validationErrors[field.name] }"
          >
            <label class="block text-sm font-medium text-gray-700 mb-2">
              {{ field.label }}
              <span v-if="field.required" class="text-red-500">*</span>
            </label>

            <!-- Text Input -->
            <input
              v-if="field.type === 'text'"
              type="text"
              :value="responsesStore.getResponse(field.id)"
              @input="handleFieldChange(field.id, ($event.target as HTMLInputElement).value)"
              class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              :class="{ 'border-red-300': validationErrors[field.name] }"
            />

            <!-- Textarea -->
            <textarea
              v-else-if="field.type === 'textarea'"
              :value="responsesStore.getResponse(field.id)"
              @input="handleFieldChange(field.id, ($event.target as HTMLTextAreaElement).value)"
              rows="4"
              class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              :class="{ 'border-red-300': validationErrors[field.name] }"
            ></textarea>

            <!-- Checkbox -->
            <div v-else-if="field.type === 'checkbox'" class="flex items-center">
              <input
                type="checkbox"
                :checked="responsesStore.getResponse(field.id) === true"
                @change="handleFieldChange(field.id, ($event.target as HTMLInputElement).checked)"
                class="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              />
              <span class="ml-2 text-sm text-gray-600">Check if applicable</span>
            </div>

            <!-- Radio Buttons -->
            <div v-else-if="field.type === 'radio'" class="space-y-2">
              <div v-for="option in field.options" :key="option" class="flex items-center">
                <input
                  type="radio"
                  :name="field.id"
                  :value="option"
                  :checked="responsesStore.getResponse(field.id) === option"
                  @change="handleFieldChange(field.id, option)"
                  class="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
                />
                <label class="ml-2 text-sm text-gray-700">{{ option }}</label>
              </div>
            </div>

            <!-- Dropdown -->
            <select
              v-else-if="field.type === 'dropdown'"
              :value="responsesStore.getResponse(field.id)"
              @change="handleFieldChange(field.id, ($event.target as HTMLSelectElement).value)"
              class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              :class="{ 'border-red-300': validationErrors[field.name] }"
            >
              <option value="">Select an option</option>
              <option v-for="option in field.options" :key="option" :value="option">
                {{ option }}
              </option>
            </select>

            <!-- Validation Error -->
            <p v-if="validationErrors[field.name]" class="mt-1 text-sm text-red-600">
              {{ validationErrors[field.name] }}
            </p>
          </div>
        </div>

        <!-- Submit Button -->
        <div class="mt-8 flex items-center justify-between">
          <div class="text-sm text-gray-500">
            <span v-if="responsesStore.totalFields > 0">
              {{ responsesStore.totalFields }} field{{ responsesStore.totalFields !== 1 ? 's' : '' }} filled
            </span>
          </div>
          <button
            @click="handleSubmit"
            :disabled="isSubmitting"
            class="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <span v-if="isSubmitting" class="flex items-center">
              <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Submitting...
            </span>
            <span v-else>Submit Response</span>
          </button>
        </div>

        <!-- Submit Error -->
        <div v-if="submitError" class="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
          <div class="flex">
            <svg class="h-5 w-5 text-red-400" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"></path>
            </svg>
            <div class="ml-3">
              <h3 class="text-sm font-medium text-red-800">Error submitting response</h3>
              <p class="text-sm text-red-700 mt-1">{{ submitError }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { usePublicForm } from '../composables/usePublicForm'
import { useResponseSubmit } from '../composables/useResponseSubmit'
import { usePublicResponsesStore } from '../stores/publicResponses.store'

const route = useRoute()
const router = useRouter()

const { form, fields, pdfUrl, title, description, isLoading, error, loadForm } = usePublicForm()
const { isSubmitting, error: submitError, validationErrors, submit } = useResponseSubmit()
const responsesStore = usePublicResponsesStore()

const shareId = computed(() => route.params.shareId as string)

onMounted(async () => {
  if (shareId.value) {
    await loadForm(shareId.value)
    if (form.value) {
      responsesStore.loadFromSession(form.value.id)
    }
  }
})

function handleFieldChange(fieldId: string, value: any) {
  responsesStore.setResponse(fieldId, value)
}

async function handleSubmit() {
  if (!form.value) return

  const answers = responsesStore.getAllResponses()

  try {
    await submit({
      formId: form.value.id,
      shareId: shareId.value,
      answers
    })

    // Clear responses and redirect to confirmation
    responsesStore.clearResponses()
    router.push(`/form/${shareId.value}/confirmation`)
  } catch (err) {
    // Error is handled by the composable
    console.error('Submit failed:', err)
  }
}
</script>
