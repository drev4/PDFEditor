import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import SearchSpotlight from './SearchSpotlight.vue'
import { setupPinia } from '@/test/helpers/pinia-setup'
import { useSearchStore } from '@/stores/search.store'

describe('SearchSpotlight', () => {
  beforeEach(() => {
    setupPinia()
  })

  it('renderiza cuando isVisible es true', () => {
    const wrapper = mount(SearchSpotlight, {
      props: { isVisible: true }
    })

    expect(wrapper.find('.spotlight-overlay').exists()).toBe(true)
    expect(wrapper.find('.spotlight-input').exists()).toBe(true)
  })

  it('no renderiza cuando isVisible es false', () => {
    const wrapper = mount(SearchSpotlight, {
      props: { isVisible: false }
    })

    expect(wrapper.find('.spotlight-overlay').exists()).toBe(false)
  })

  it('emite close cuando se presiona ESC', async () => {
    const wrapper = mount(SearchSpotlight, {
      props: { isVisible: true }
    })

    const input = wrapper.find('.spotlight-input')
    await input.trigger('keydown.escape')

    expect(wrapper.emitted('close')).toBeTruthy()
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('ejecuta búsqueda al presionar ENTER', async () => {
    const store = useSearchStore()
    const wrapper = mount(SearchSpotlight, {
      props: { isVisible: true }
    })

    const input = wrapper.find('.spotlight-input')
    await input.setValue('test query')
    await input.trigger('keydown.enter')

    expect(store.searchQuery).toBe('test query')
    expect(store.isSearching).toBe(true)
    expect(wrapper.emitted('search')).toBeTruthy()
  })

  it('no ejecuta búsqueda con query vacío', async () => {
    const store = useSearchStore()
    const wrapper = mount(SearchSpotlight, {
      props: { isVisible: true }
    })

    const input = wrapper.find('.spotlight-input')
    await input.setValue('   ')
    await input.trigger('keydown.enter')

    expect(store.searchQuery).toBe('')
    expect(wrapper.emitted('search')).toBeFalsy()
  })

  it('muestra resultados de búsqueda', async () => {
    const store = useSearchStore()
    store.searchMatches = [
      { pageIndex: 0, text: 'match 1', matchIndex: 0 },
      { pageIndex: 1, text: 'match 2', matchIndex: 1 }
    ]
    store.currentMatchIndex = 0

    const wrapper = mount(SearchSpotlight, {
      props: { isVisible: true }
    })

    expect(wrapper.find('.search-results').exists()).toBe(true)
    expect(wrapper.text()).toContain('1 de 2 resultados')
  })

  it('muestra mensaje de sin resultados', async () => {
    const wrapper = mount(SearchSpotlight, {
      props: { isVisible: true }
    })

    const input = wrapper.find('.spotlight-input')
    await input.setValue('nonexistent')
    await input.trigger('keydown.enter')

    await wrapper.vm.$nextTick()
    expect(wrapper.find('.no-results').exists()).toBe(true)
    expect(wrapper.text()).toContain('No se encontraron resultados')
  })

  it('navega al resultado siguiente', async () => {
    const store = useSearchStore()
    store.searchMatches = [
      { pageIndex: 0, text: 'match 1', matchIndex: 0 },
      { pageIndex: 1, text: 'match 2', matchIndex: 1 }
    ]
    store.currentMatchIndex = 0

    const wrapper = mount(SearchSpotlight, {
      props: { isVisible: true }
    })

    const nextButton = wrapper.findAll('.nav-button')[1]
    await nextButton.trigger('click')

    expect(store.currentMatchIndex).toBe(1)
  })

  it('limpia búsqueda al hacer clic en botón clear', async () => {
    const store = useSearchStore()
    const wrapper = mount(SearchSpotlight, {
      props: { isVisible: true }
    })

    const input = wrapper.find('.spotlight-input')
    await input.setValue('test')
    await wrapper.vm.$nextTick()

    const clearButton = wrapper.find('.clear-button')
    await clearButton.trigger('click')

    expect(wrapper.find('.spotlight-input').element.value).toBe('')
    expect(store.searchQuery).toBe('')
  })
})
