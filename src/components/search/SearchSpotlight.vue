<template>
  <Transition name="spotlight-fade">
    <div v-if="isVisible" :class="['spotlight-overlay', { 'minimized': isMinimized }]" @click="handleOverlayClick">
      <div
        :class="['spotlight-container', { 'minimized': isMinimized }]"
        
      >
        <div class="spotlight-search">
          <i class="pi pi-search search-icon"></i>
          <input
            ref="searchInput"
            v-model="searchQuery"
            type="text"
            class="spotlight-input"
            placeholder="Buscar en el documento..."
            @click.stop="handleContainerClick"
            @keydown.escape="close"
            @keydown.enter="performSearch"
          />
          <button
            v-if="searchQuery"
            class="clear-button"
            @click="clearSearch"
            @click.stop="handleContainerClick"
            title="Limpiar"
          >
            <i class="pi pi-times"></i>
          </button>
        </div>

        <div v-if="searchMatches.length > 0" class="search-results">
          <div class="results-header">
            <span class="results-count">
              {{ currentMatchIndex + 1 }} de {{ searchMatches.length }} resultados
            </span>
            <div class="results-navigation">
              <button
                class="nav-button"
                @click="previousMatch"
                :disabled="searchMatches.length === 0"
                title="Anterior"
              >
                <i class="pi pi-chevron-up"></i>
              </button>
              <button
                class="nav-button"
                @click="nextMatch"
                :disabled="searchMatches.length === 0"
                title="Siguiente"
              >
                <i class="pi pi-chevron-down"></i>
              </button>
            </div>
          </div>
        </div>

        <div v-else-if="hasSearched && searchMatches.length === 0" class="no-results">
          <i class="pi pi-info-circle"></i>
          <span>No se encontraron resultados</span>
        </div>

        <div class="spotlight-footer">
          <span class="shortcut-hint">
            <kbd>ESC</kbd> para cerrar
            <kbd>ENTER</kbd> para buscar
          </span>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { useSearchStore } from '@/stores/search.store'
import { storeToRefs } from 'pinia'

const props = defineProps<{
  isVisible: boolean
}>()

const emit = defineEmits<{
  'close': []
  'search': []
}>()

const searchStore = useSearchStore()
const { searchMatches, currentMatchIndex } = storeToRefs(searchStore)

const searchInput = ref<HTMLInputElement | null>(null)
const searchQuery = ref('')
const hasSearched = ref(false)
const isMinimized = ref(false)

// Watch for visibility changes to focus input
watch(() => props.isVisible, async (visible) => {
  if (visible) {
    isMinimized.value = false
    await nextTick()
    searchInput.value?.focus()
    searchQuery.value = searchStore.searchQuery
  } else {
    hasSearched.value = false
    isMinimized.value = false
  }
})

const performSearch = () => {
  if (!searchQuery.value.trim()) return

  hasSearched.value = true
  searchStore.setSearchQuery(searchQuery.value)
  searchStore.setIsSearching(true)
  isMinimized.value = true
  emit('search')
}

const handleOverlayClick = () => {
  if (!isMinimized.value) {
    //close()
  }
}

const handleContainerClick = () => {
  if (isMinimized.value) {
    isMinimized.value = false
    nextTick(() => {
      searchInput.value?.focus()
    })
  }
}

const clearSearch = () => {
  searchQuery.value = ''
  hasSearched.value = false
  searchStore.clearSearch()
  searchInput.value?.focus()
}

const close = () => {
  emit('close')
}

const nextMatch = () => {
  searchStore.nextSearchMatch()
  isMinimized.value = true
}

const previousMatch = () => {
  searchStore.previousSearchMatch()
  isMinimized.value = true
}
</script>

<style scoped>
.spotlight-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(8px);
  z-index: 100;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 15vh;
  transition: background 0.3s ease, backdrop-filter 0.3s ease;
}

.spotlight-overlay.minimized {
  background: transparent;
  backdrop-filter: none;
  pointer-events: none;
}

.spotlight-container {
  background: white;
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  width: 90%;
  max-width: 600px;
  overflow: hidden;
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  pointer-events: auto;
  cursor: default;
}

.spotlight-container.minimized {
  position: fixed;
  top: 1rem;
  right: 1rem;
  width: 320px;
  max-width: 320px;
  transform: translateX(0) translateY(0);
  cursor: pointer;
}

.spotlight-container.minimized:hover {
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.35);
  transform: translateY(-2px);
}

.spotlight-search {
  display: flex;
  align-items: center;
  padding: 1.5rem;
  border-bottom: 1px solid #e5e7eb;
  gap: 1rem;
}

.search-icon {
  font-size: 1.25rem;
  color: #6b7280;
  flex-shrink: 0;
}

.spotlight-input {
  flex: 1;
  border: none;
  outline: none;
  font-size: 1.125rem;
  color: #111827;
  background: transparent;
}

.spotlight-input::placeholder {
  color: #9ca3af;
}

.clear-button {
  background: #f3f4f6;
  border: none;
  border-radius: 6px;
  padding: 0.5rem;
  cursor: pointer;
  color: #6b7280;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.clear-button:hover {
  background: #e5e7eb;
  color: #374151;
}

.search-results {
  padding: 1rem 1.5rem;
  border-bottom: 1px solid #e5e7eb;
}

.results-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.results-count {
  font-size: 0.875rem;
  color: #6b7280;
}

.results-navigation {
  display: flex;
  gap: 0.25rem;
}

.nav-button {
  background: #f3f4f6;
  border: none;
  border-radius: 6px;
  padding: 0.5rem;
  cursor: pointer;
  color: #374151;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
}

.nav-button:hover:not(:disabled) {
  background: #e5e7eb;
  color: #111827;
}

.nav-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.no-results {
  padding: 2rem 1.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  color: #6b7280;
  font-size: 0.875rem;
}

.no-results i {
  font-size: 1.25rem;
}

.spotlight-footer {
  padding: 1rem 1.5rem;
  background: #f9fafb;
  display: flex;
  justify-content: flex-end;
}

.shortcut-hint {
  display: flex;
  gap: 1rem;
  font-size: 0.75rem;
  color: #6b7280;
  align-items: center;
}

kbd {
  background: white;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  padding: 0.25rem 0.5rem;
  font-family: monospace;
  font-size: 0.75rem;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  margin: 0 0.25rem;
}

/* Transitions */
.spotlight-fade-enter-active,
.spotlight-fade-leave-active {
  transition: opacity 0.3s ease;
}

.spotlight-fade-enter-active .spotlight-container,
.spotlight-fade-leave-active .spotlight-container {
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.spotlight-fade-enter-from,
.spotlight-fade-leave-to {
  opacity: 0;
}

.spotlight-fade-enter-from .spotlight-container {
  transform: scale(0.95) translateY(-20px);
}

.spotlight-fade-leave-to .spotlight-container {
  transform: scale(0.95) translateY(-20px);
}
</style>
