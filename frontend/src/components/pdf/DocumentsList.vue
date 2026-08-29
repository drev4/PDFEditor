<template>
  <div class="documents-list">
    <div class="flex items-center justify-between mb-4">
      <h3 class="text-sm font-bold text-ink uppercase tracking-wide">
        Documents
      </h3>
      <span class="text-xs bg-accent-soft text-accent px-2 py-1 rounded-full font-semibold">
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
            ? 'bg-accent-soft border border-accent'
            : 'bg-surface-subtle hover:bg-surface-sunken hover:shadow-md'
        ]"
      >
        <div class="flex items-start gap-3">
          <div :class="[
            'w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0',
            doc.id === documentStore.activeDocumentId
              ? 'bg-surface'
              : 'bg-danger-soft'
          ]">
            <i :class="[
              'pi pi-file-pdf text-xl',
              doc.id === documentStore.activeDocumentId
                ? 'text-white'
                : 'text-danger'
            ]"></i>
          </div>
          <div class="flex-1 min-w-0">
            <p :class="[
              'text-sm font-semibold truncate',
              doc.id === documentStore.activeDocumentId
                ? 'text-white'
                : 'text-ink'
            ]">
              {{ doc.name }}
            </p>
            <p :class="[
              'text-xs mt-1',
              doc.id === documentStore.activeDocumentId
                ? 'text-accent'
                : 'text-muted'
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
  background: #d8dae1;
  border-radius: 3px;
}

.documents-list::-webkit-scrollbar-thumb:hover {
  background: #9ba1ac;
}
</style>
