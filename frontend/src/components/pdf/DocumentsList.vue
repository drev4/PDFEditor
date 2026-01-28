<template>
  <div class="documents-list">
    <div class="flex items-center justify-between mb-4">
      <h3 class="text-sm font-bold text-gray-700 uppercase tracking-wide">
        Documents
      </h3>
      <span class="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full font-semibold">
        {{ documentStore.documents.length }}
      </span>
    </div>
    <div class="space-y-3">
      <div
        v-for="doc in documentStore.documents"
        :key="doc.id"
        @click="documentStore.setActiveDocument(doc.id)"
        :class="[
          'group p-4 rounded-xl cursor-pointer transition-all duration-200',
          doc.id === documentStore.activeDocumentId
            ? 'bg-gradient-to-r from-blue-600 to-indigo-600 shadow-lg scale-105'
            : 'bg-gray-50 hover:bg-gray-100 hover:shadow-md'
        ]"
      >
        <div class="flex items-start gap-3">
          <div :class="[
            'w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0',
            doc.id === documentStore.activeDocumentId
              ? 'bg-white/20'
              : 'bg-red-100'
          ]">
            <i :class="[
              'pi pi-file-pdf text-xl',
              doc.id === documentStore.activeDocumentId
                ? 'text-white'
                : 'text-red-500'
            ]"></i>
          </div>
          <div class="flex-1 min-w-0">
            <p :class="[
              'text-sm font-semibold truncate',
              doc.id === documentStore.activeDocumentId
                ? 'text-white'
                : 'text-gray-900'
            ]">
              {{ doc.name }}
            </p>
            <p :class="[
              'text-xs mt-1',
              doc.id === documentStore.activeDocumentId
                ? 'text-blue-100'
                : 'text-gray-500'
            ]">
              {{ doc.numPages }} pages
            </p>
          </div>
          <Button
            v-if="doc.id === documentStore.activeDocumentId"
            icon="pi pi-times"
            @click.stop="documentStore.closeDocument(doc.id)"
            text
            rounded
            severity="secondary"
            size="small"
            class="opacity-0 group-hover:opacity-100 transition-opacity"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import Button from 'primevue/button'
import { useDocumentStore } from '@/stores/document.store'

const documentStore = useDocumentStore()
</script>

<style scoped>
.documents-list {
  padding: 1.5rem;
  height: 100%;
  overflow-y: auto;
}

/* Custom scrollbar */
.documents-list::-webkit-scrollbar {
  width: 6px;
}

.documents-list::-webkit-scrollbar-track {
  background: transparent;
}

.documents-list::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 3px;
}

.documents-list::-webkit-scrollbar-thumb:hover {
  background: #94a3b8;
}
</style>
