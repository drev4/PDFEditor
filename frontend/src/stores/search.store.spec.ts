import { describe, it, expect, beforeEach } from 'vitest'
import { useSearchStore } from './search.store'
import { setupPinia } from '@/test/helpers/pinia-setup'
import { createMockSearchMatches } from '@/test/helpers/test-utils'

describe('SearchStore', () => {
  beforeEach(() => {
    setupPinia()
  })

  describe('setSearchQuery', () => {
    it('establece la consulta de búsqueda', () => {
      const store = useSearchStore()

      store.setSearchQuery('test query')
      expect(store.searchQuery).toBe('test query')

      store.setSearchQuery('')
      expect(store.searchQuery).toBe('')
    })
  })

  describe('setSearchMatches', () => {
    it('establece matches y configura índice inicial en 0', () => {
      const store = useSearchStore()
      const matches = createMockSearchMatches(5)

      store.setSearchMatches(matches)

      expect(store.searchMatches).toHaveLength(5)
      expect(store.currentMatchIndex).toBe(0)
    })

    it('establece índice en -1 cuando no hay matches', () => {
      const store = useSearchStore()

      store.setSearchMatches([])

      expect(store.searchMatches).toHaveLength(0)
      expect(store.currentMatchIndex).toBe(-1)
    })
  })

  describe('nextSearchMatch', () => {
    it('avanza al siguiente match', () => {
      const store = useSearchStore()
      const matches = createMockSearchMatches(3)
      store.setSearchMatches(matches)

      expect(store.currentMatchIndex).toBe(0)

      store.nextSearchMatch()
      expect(store.currentMatchIndex).toBe(1)

      store.nextSearchMatch()
      expect(store.currentMatchIndex).toBe(2)
    })

    it('vuelve al inicio al llegar al final (circular)', () => {
      const store = useSearchStore()
      const matches = createMockSearchMatches(3)
      store.setSearchMatches(matches)

      store.currentMatchIndex = 2
      store.nextSearchMatch()

      expect(store.currentMatchIndex).toBe(0)
    })

    it('no hace nada si no hay matches', () => {
      const store = useSearchStore()
      store.setSearchMatches([])

      store.nextSearchMatch()
      expect(store.currentMatchIndex).toBe(-1)
    })
  })

  describe('previousSearchMatch', () => {
    it('retrocede al match anterior', () => {
      const store = useSearchStore()
      const matches = createMockSearchMatches(3)
      store.setSearchMatches(matches)

      store.currentMatchIndex = 2

      store.previousSearchMatch()
      expect(store.currentMatchIndex).toBe(1)

      store.previousSearchMatch()
      expect(store.currentMatchIndex).toBe(0)
    })

    it('vuelve al final al estar en el inicio (circular)', () => {
      const store = useSearchStore()
      const matches = createMockSearchMatches(3)
      store.setSearchMatches(matches)

      expect(store.currentMatchIndex).toBe(0)
      store.previousSearchMatch()

      expect(store.currentMatchIndex).toBe(2)
    })

    it('no hace nada si no hay matches', () => {
      const store = useSearchStore()
      store.setSearchMatches([])

      store.previousSearchMatch()
      expect(store.currentMatchIndex).toBe(-1)
    })
  })

  describe('clearSearch', () => {
    it('limpia todos los datos de búsqueda', () => {
      const store = useSearchStore()

      store.setSearchQuery('test')
      store.setSearchMatches(createMockSearchMatches(5))
      store.setIsSearching(true)

      store.clearSearch()

      expect(store.searchQuery).toBe('')
      expect(store.searchMatches).toHaveLength(0)
      expect(store.currentMatchIndex).toBe(-1)
      expect(store.isSearching).toBe(false)
    })
  })

  describe('setIsSearching', () => {
    it('controla el estado de búsqueda activa', () => {
      const store = useSearchStore()

      expect(store.isSearching).toBe(false)

      store.setIsSearching(true)
      expect(store.isSearching).toBe(true)

      store.setIsSearching(false)
      expect(store.isSearching).toBe(false)
    })
  })
})
