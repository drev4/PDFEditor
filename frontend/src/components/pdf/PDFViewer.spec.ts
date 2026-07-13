import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import PDFViewer from './PDFViewer.vue'
import { useDocumentStore } from '../../stores/document.store'
import { useEditorStore } from '../../stores/editor.store'
import { createPinia, setActivePinia } from 'pinia'
import PrimeVue from 'primevue/config'

// Mock composables
vi.mock('@/composables/usePDFRendering', () => ({
  usePDFRendering: () => ({
    pdfDoc: { value: null },
    canvasRef: { value: null },
    gridCanvasRef: { value: null },
    textLayerRef: { value: null },
    loadPDF: vi.fn(),
    renderPage: vi.fn().mockResolvedValue(true),
    renderTextLayer: vi.fn(),
    cleanup: vi.fn()
  })
}))

vi.mock('@/composables/usePDFSearch', () => ({
  usePDFSearch: () => ({
    searchTextInPDF: vi.fn(),
    drawSearchHighlights: vi.fn(),
    clearSearchHighlights: vi.fn()
  })
}))

vi.mock('@/composables/useImagePlacement', () => ({
  useImagePlacement: () => ({
    flipHorizontal: { value: false },
    flipVertical: { value: false },
    toggleFlipHorizontal: vi.fn(),
    toggleFlipVertical: vi.fn(),
    startDrag: vi.fn(),
    startResize: vi.fn(),
    confirmImagePlacement: vi.fn(),
    cancelImagePlacement: vi.fn()
  })
}))

vi.mock('@/composables/useTextPlacement', () => ({
  useTextPlacement: () => ({
    startDrag: vi.fn(),
    confirmTextPlacement: vi.fn(),
    cancelTextPlacement: vi.fn()
  })
}))

vi.mock('@/composables/useGridOverlay', () => ({
  useGridOverlay: () => ({
    drawGrid: vi.fn()
  })
}))

describe('PDFViewer', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  const mountComponent = () => {
    return mount(PDFViewer, {
      global: {
        plugins: [PrimeVue],
        stubs: {
          PDFToolbar: true,
          DrawingToolbar: true,
          ImageControls: true,
          TextControls: true,
          SearchSpotlight: true
        }
      }
    })
  }

  it('muestra estado "No PDF loaded" cuando no hay documento activo', () => {
    const wrapper = mountComponent()
    expect(wrapper.text()).toContain('No PDF loaded')
  })

  it('renderiza toolbar cuando hay documento activo', () => {
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
      pageOrder: [1, 2, 3],
      snapshots: [],
      arrayBuffer: new ArrayBuffer(0)
    }]

    const wrapper = mountComponent()
    expect(wrapper.findComponent({ name: 'PDFToolbar' }).exists()).toBe(true)
  })

  it('navega a página siguiente', async () => {
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
      pageOrder: [1, 2, 3],
      snapshots: [],
      arrayBuffer: new ArrayBuffer(0)
    }]

    const wrapper = mountComponent()
    const toolbar = wrapper.findComponent({ name: 'PDFToolbar' })
    await toolbar.vm.$emit('next-page')

    expect(documentStore.activeDocument?.currentPage).toBe(2)
  })

  it('navega a página anterior', async () => {
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
      pageOrder: [1, 2, 3],
      snapshots: [],
      arrayBuffer: new ArrayBuffer(0)
    }]

    const wrapper = mountComponent()
    const toolbar = wrapper.findComponent({ name: 'PDFToolbar' })
    await toolbar.vm.$emit('previous-page')

    expect(documentStore.activeDocument?.currentPage).toBe(1)
  })

  it('hace zoom in correctamente', async () => {
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
      pageOrder: [1, 2, 3],
      snapshots: [],
      arrayBuffer: new ArrayBuffer(0)
    }]

    const wrapper = mountComponent()
    const toolbar = wrapper.findComponent({ name: 'PDFToolbar' })
    await toolbar.vm.$emit('zoom-in')

    expect(documentStore.activeDocument?.scale).toBe(1.75)
  })

  it('hace zoom out correctamente', async () => {
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
      pageOrder: [1, 2, 3],
      snapshots: [],
      arrayBuffer: new ArrayBuffer(0)
    }]

    const wrapper = mountComponent()
    const toolbar = wrapper.findComponent({ name: 'PDFToolbar' })
    await toolbar.vm.$emit('zoom-out')

    expect(documentStore.activeDocument?.scale).toBe(1.25)
  })

  it('rota el PDF correctamente', async () => {
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
      pageOrder: [1, 2, 3],
      snapshots: [],
      arrayBuffer: new ArrayBuffer(0)
    }]

    const wrapper = mountComponent()
    const toolbar = wrapper.findComponent({ name: 'PDFToolbar' })
    await toolbar.vm.$emit('rotate')

    expect(documentStore.activeDocument?.rotation).toBe(90)
  })

  it('muestra SearchSpotlight al seleccionar herramienta de búsqueda', async () => {
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
      pageOrder: [1, 2, 3],
      snapshots: [],
      arrayBuffer: new ArrayBuffer(0)
    }]

    const wrapper = mountComponent()
    const drawingToolbar = wrapper.findComponent({ name: 'DrawingToolbar' })
    await drawingToolbar.vm.$emit('select-tool', 'search')
    await wrapper.vm.$nextTick()

    const searchSpotlight = wrapper.findComponent({ name: 'SearchSpotlight' })
    expect(searchSpotlight.props('isVisible')).toBe(true)
  })

  it('crea text preview al seleccionar herramienta de texto', async () => {
    const documentStore = useDocumentStore()
    const editorStore = useEditorStore()

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
      pageOrder: [1, 2, 3],
      snapshots: [],
      arrayBuffer: new ArrayBuffer(0)
    }]

    const wrapper = mountComponent()
    const drawingToolbar = wrapper.findComponent({ name: 'DrawingToolbar' })
    await drawingToolbar.vm.$emit('select-tool', 'text')
    await wrapper.vm.$nextTick()

    expect(editorStore.textPreview).toBeTruthy()
    expect(editorStore.textPreview?.text).toBe('')
  })
})
