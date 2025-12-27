import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, VueWrapper } from '@vue/test-utils'
import FileUploader from './FileUploader.vue'
import { useDocumentStore } from '@/stores/document.store'
import { setupPinia } from '@/test/helpers/pinia-setup'
import { createMockPDFFile } from '@/test/helpers/test-utils'
import FileUpload from 'primevue/fileupload'

describe('FileUploader', () => {
  let wrapper: VueWrapper

  beforeEach(() => {
    setupPinia()
  })

  afterEach(() => {
    wrapper?.unmount()
  })

  it('renderiza el componente FileUpload con props correctas', () => {
    wrapper = mount(FileUploader, {
      global: {
        components: {
          FileUpload
        }
      }
    })

    const fileUpload = wrapper.findComponent(FileUpload)
    expect(fileUpload.exists()).toBe(true)
    expect(fileUpload.props('accept')).toBe('application/pdf')
    expect(fileUpload.props('maxFileSize')).toBe(50000000)
    expect(fileUpload.props('mode')).toBe('basic')
  })

  it('carga un archivo PDF válido al seleccionar', async () => {
    const documentStore = useDocumentStore()
    const loadPDFSpy = vi.spyOn(documentStore, 'loadPDF')

    wrapper = mount(FileUploader, {
      global: {
        components: {
          FileUpload
        }
      }
    })

    const file = createMockPDFFile('test.pdf', 1024)
    const fileUpload = wrapper.findComponent(FileUpload)

    await fileUpload.vm.$emit('select', {
      files: [file]
    })

    expect(loadPDFSpy).toHaveBeenCalledWith(file)
  })

  it('ignora archivos que no sean PDF', async () => {
    const documentStore = useDocumentStore()
    const loadPDFSpy = vi.spyOn(documentStore, 'loadPDF')

    wrapper = mount(FileUploader, {
      global: {
        components: {
          FileUpload
        }
      }
    })

    const nonPdfFile = new File(['content'], 'test.txt', { type: 'text/plain' })
    const fileUpload = wrapper.findComponent(FileUpload)

    await fileUpload.vm.$emit('select', {
      files: [nonPdfFile]
    })

    expect(loadPDFSpy).not.toHaveBeenCalled()
  })

  it('maneja errores al cargar PDF', async () => {
    const documentStore = useDocumentStore()
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(documentStore, 'loadPDF').mockRejectedValue(new Error('Load failed'))

    wrapper = mount(FileUploader, {
      global: {
        components: {
          FileUpload
        }
      }
    })

    const file = createMockPDFFile('test.pdf')
    const fileUpload = wrapper.findComponent(FileUpload)

    await fileUpload.vm.$emit('select', {
      files: [file]
    })

    // Wait for async error handling
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(consoleErrorSpy).toHaveBeenCalledWith('Error loading PDF:', expect.any(Error))

    consoleErrorSpy.mockRestore()
  })
})
