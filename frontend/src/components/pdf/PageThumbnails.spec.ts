import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import PageThumbnails from './PageThumbnails.vue'
import { setupPinia } from '@/test/helpers/pinia-setup'
import { useDocumentStore } from '@/stores/document.store'

// Mock ProgressSpinner
vi.mock('primevue/progressspinner', () => ({
  default: {
    name: 'ProgressSpinner',
    template: '<div class="p-progress-spinner"></div>'
  }
}))

// Mock useThumbnails
vi.mock('@/composables/useThumbnails', () => ({
  useThumbnails: () => ({
    generateThumbnail: vi.fn().mockResolvedValue('data:image/png;base64,mockImage')
  })
}))

// Mock DataTransfer for drag and drop tests
class MockDataTransfer {
  data: Record<string, string> = {}
  effectAllowed = 'move'
  dropEffect = 'move'

  setData(format: string, data: string) {
    this.data[format] = data
  }

  getData(format: string) {
    return this.data[format]
  }
}

describe('PageThumbnails', () => {
  beforeEach(() => {
    setupPinia()
  })

  it('muestra loading cuando no hay pdfDoc', () => {
    const wrapper = mount(PageThumbnails, {
      props: {
        pdfDoc: null
      }
    })

    expect(wrapper.find('.p-progress-spinner').exists()).toBe(true)
    expect(wrapper.text()).toContain('Loading pages...')
  })

  it('renderiza lista de thumbnails cuando hay pdfDoc', async () => {
    const documentStore = useDocumentStore()
    documentStore.activeDocumentId = 'doc1'
    documentStore.documents = [{
      id: 'doc1',
      name: 'test.pdf',
      file: new File([], 'test.pdf'),
      data: new Uint8Array(),
      numPages: 3,
      currentPage: 1,
      scale: 1.5,
      rotation: 0,
      pageOrder: [1, 2, 3]
    }]

    const mockPdfDoc = {
      numPages: 3,
      getPage: vi.fn().mockResolvedValue({})
    }

    const wrapper = mount(PageThumbnails, {
      props: {
        pdfDoc: mockPdfDoc
      }
    })

    await wrapper.vm.$nextTick()
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(wrapper.findAll('.thumbnail-card')).toHaveLength(3)
  })

  it('destaca la página actual', async () => {
    const documentStore = useDocumentStore()
    documentStore.activeDocumentId = 'doc1'
    documentStore.documents = [{
      id: 'doc1',
      name: 'test.pdf',
      file: new File([], 'test.pdf'),
      data: new Uint8Array(),
      numPages: 3,
      currentPage: 2,
      scale: 1.5,
      rotation: 0,
      pageOrder: [1, 2, 3]
    }]

    const mockPdfDoc = {
      numPages: 3,
      getPage: vi.fn().mockResolvedValue({})
    }

    const wrapper = mount(PageThumbnails, {
      props: {
        pdfDoc: mockPdfDoc
      }
    })

    await wrapper.vm.$nextTick()
    await new Promise(resolve => setTimeout(resolve, 50))

    const thumbnails = wrapper.findAll('.thumbnail-card')
    expect(thumbnails[1].classes()).toContain('ring-accent')
  })

  it('navega a página al hacer clic en thumbnail', async () => {
    const documentStore = useDocumentStore()
    documentStore.activeDocumentId = 'doc1'
    documentStore.documents = [{
      id: 'doc1',
      name: 'test.pdf',
      file: new File([], 'test.pdf'),
      data: new Uint8Array(),
      numPages: 3,
      currentPage: 1,
      scale: 1.5,
      rotation: 0,
      pageOrder: [1, 2, 3]
    }]

    const mockPdfDoc = {
      numPages: 3,
      getPage: vi.fn().mockResolvedValue({})
    }

    const wrapper = mount(PageThumbnails, {
      props: {
        pdfDoc: mockPdfDoc
      }
    })

    await wrapper.vm.$nextTick()
    await new Promise(resolve => setTimeout(resolve, 50))

    const thumbnails = wrapper.findAll('.thumbnail-card')
    await thumbnails[2].trigger('click')

    expect(documentStore.activeDocument?.currentPage).toBe(3)
  })

  it('soporta drag and drop para reordenar páginas', async () => {
    const documentStore = useDocumentStore()
    documentStore.activeDocumentId = 'doc1'
    documentStore.documents = [{
      id: 'doc1',
      name: 'test.pdf',
      file: new File([], 'test.pdf'),
      data: new Uint8Array(),
      numPages: 3,
      currentPage: 1,
      scale: 1.5,
      rotation: 0,
      pageOrder: [1, 2, 3]
    }]

    const mockPdfDoc = {
      numPages: 3,
      getPage: vi.fn().mockResolvedValue({})
    }

    const wrapper = mount(PageThumbnails, {
      props: {
        pdfDoc: mockPdfDoc
      }
    })

    await wrapper.vm.$nextTick()
    await new Promise(resolve => setTimeout(resolve, 50))

    const thumbnails = wrapper.findAll('.thumbnail-card')

    // Simulate drag and drop page 1 to position 3
    const dataTransfer = new MockDataTransfer()
    await thumbnails[0].trigger('dragstart', { dataTransfer })
    await thumbnails[2].trigger('dragover', { dataTransfer })
    await thumbnails[2].trigger('drop', { dataTransfer })

    expect(documentStore.activeDocument?.pageOrder).toEqual([2, 3, 1])
  })

  it('muestra número total de páginas en header', () => {
    const documentStore = useDocumentStore()
    documentStore.activeDocumentId = 'doc1'
    documentStore.documents = [{
      id: 'doc1',
      name: 'test.pdf',
      file: new File([], 'test.pdf'),
      data: new Uint8Array(),
      numPages: 5,
      currentPage: 1,
      scale: 1.5,
      rotation: 0,
      pageOrder: [1, 2, 3, 4, 5]
    }]

    const wrapper = mount(PageThumbnails, {
      props: {
        pdfDoc: null
      }
    })

    expect(wrapper.text()).toContain('5')
  })
})
