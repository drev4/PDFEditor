import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFormManagement } from './useFormManagement'
import { useFormsStore } from '@/stores/forms.store'
import { useFormFieldsStore } from '@/stores/formFields.store'
import { useDocumentStore } from '@/stores/document.store'
import { createMockPDFFile } from '@/test/helpers/test-utils'

vi.mock('@/services/forms')
vi.mock('@/services/fields')

describe('useFormManagement', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  const mockForm = {
    id: 'form-1',
    userId: 'user-1',
    title: 'Test Form',
    description: 'Description',
    shareId: 'share-123',
    status: 'draft' as const,
    pdfUrl: null,
    settings: null,
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
    fields: []
  }

  const createMockDocument = async (documentStore: ReturnType<typeof useDocumentStore>) => {
    const mockFile = createMockPDFFile('test.pdf', 1024)
    await documentStore.loadPDF(mockFile)
  }

  describe('createFormForCurrentDocument', () => {
    it('should create form for active document', async () => {
      const documentStore = useDocumentStore()
      const formsStore = useFormsStore()
      const formFieldsStore = useFormFieldsStore()

      await createMockDocument(documentStore)

      formsStore.createForm = vi.fn().mockResolvedValue(mockForm)
      const setCurrentFormSpy = vi.spyOn(formFieldsStore, 'setCurrentForm')

      const { createFormForCurrentDocument } = useFormManagement()
      const form = await createFormForCurrentDocument('My Form')

      expect(formsStore.createForm).toHaveBeenCalledWith({
        title: 'My Form',
        description: 'PDF form based on test.pdf',
        pdfUrl: undefined
      })
      expect(setCurrentFormSpy).toHaveBeenCalledWith('form-1')
      expect(form.id).toBe('form-1')
    })

    it('should throw error if no active document', async () => {
      const { createFormForCurrentDocument } = useFormManagement()

      await expect(createFormForCurrentDocument()).rejects.toThrow('No active document')
    })

    it('should save existing fields', async () => {
      const documentStore = useDocumentStore()
      const formsStore = useFormsStore()
      const formFieldsStore = useFormFieldsStore()

      await createMockDocument(documentStore)

      formFieldsStore.addField({
        type: 'text',
        name: 'field1',
        label: 'Field 1',
        required: false,
        border: true,
        position: { x: 10, y: 20, width: 100, height: 30, page: 1 }
      })

      formsStore.createForm = vi.fn().mockResolvedValue(mockForm)
      formFieldsStore.saveAllFields = vi.fn().mockResolvedValue([])

      const { createFormForCurrentDocument } = useFormManagement()
      await createFormForCurrentDocument()

      expect(formFieldsStore.saveAllFields).toHaveBeenCalled()
    })
  })

  describe('loadForm', () => {
    it('should load form and fields', async () => {
      const formsStore = useFormsStore()
      const formFieldsStore = useFormFieldsStore()

      formsStore.fetchForm = vi.fn().mockResolvedValue({
        ...mockForm,
        fields: [
          {
            id: 'field-1',
            formId: 'form-1',
            type: 'text',
            name: 'field1',
            label: 'Field 1',
            required: false,
            position: { x: 10, y: 20, width: 100, height: 30, page: 1 },
            order: 0,
            createdAt: '2024-01-01'
          }
        ]
      })

      const { loadForm } = useFormManagement()
      const form = await loadForm('form-1')

      expect(formsStore.fetchForm).toHaveBeenCalledWith('form-1')
      expect(formFieldsStore.currentFormId).toBe('form-1')
      expect(formFieldsStore.fields).toHaveLength(1)
    })
  })

  describe('saveCurrentForm', () => {
    it('should save all fields', async () => {
      const formFieldsStore = useFormFieldsStore()
      formFieldsStore.setCurrentForm('form-1')
      formFieldsStore.saveAllFields = vi.fn().mockResolvedValue([])

      const { saveCurrentForm } = useFormManagement()
      await saveCurrentForm()

      expect(formFieldsStore.saveAllFields).toHaveBeenCalled()
    })

    it('should throw error if no current form', async () => {
      const { saveCurrentForm } = useFormManagement()

      await expect(saveCurrentForm()).rejects.toThrow('No current form set')
    })
  })

  describe('autoInitializeForm', () => {
    it('should create form if no current form', async () => {
      const documentStore = useDocumentStore()
      const formsStore = useFormsStore()

      await createMockDocument(documentStore)

      formsStore.createForm = vi.fn().mockResolvedValue(mockForm)

      const { autoInitializeForm } = useFormManagement()
      await autoInitializeForm()

      expect(formsStore.createForm).toHaveBeenCalled()
    })

    it('should not create form if current form exists', async () => {
      const documentStore = useDocumentStore()
      const formFieldsStore = useFormFieldsStore()
      const formsStore = useFormsStore()

      await createMockDocument(documentStore)
      formFieldsStore.setCurrentForm('form-1')

      formsStore.createForm = vi.fn()

      const { autoInitializeForm } = useFormManagement()
      await autoInitializeForm()

      expect(formsStore.createForm).not.toHaveBeenCalled()
    })
  })
})
