import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { SearchMatch } from '@/types/pdf'

export const useSearchStore = defineStore('search', () => {
  // State
  const searchQuery = ref('')
  const searchMatches = ref<SearchMatch[]>([])
  const currentMatchIndex = ref(-1)
  const isSearching = ref(false)

  // Actions
  const setSearchQuery = (query: string) => {
    searchQuery.value = query
  }

  const setSearchMatches = (matches: SearchMatch[]) => {
    searchMatches.value = matches
    currentMatchIndex.value = matches.length > 0 ? 0 : -1
  }

  const nextSearchMatch = () => {
    if (searchMatches.value.length === 0) return
    currentMatchIndex.value = (currentMatchIndex.value + 1) % searchMatches.value.length
  }

  const previousSearchMatch = () => {
    if (searchMatches.value.length === 0) return
    currentMatchIndex.value = currentMatchIndex.value - 1 < 0
      ? searchMatches.value.length - 1
      : currentMatchIndex.value - 1
  }

  const clearSearch = () => {
    searchQuery.value = ''
    searchMatches.value = []
    currentMatchIndex.value = -1
    isSearching.value = false
  }

  const setIsSearching = (value: boolean) => {
    isSearching.value = value
  }

  return {
    // State
    searchQuery,
    searchMatches,
    currentMatchIndex,
    isSearching,

    // Actions
    setSearchQuery,
    setSearchMatches,
    nextSearchMatch,
    previousSearchMatch,
    clearSearch,
    setIsSearching
  }
}, {
  persist: false
})
