import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFormManagement } from './useFormManagement'
import { useFormsStore } from '@/stores/forms.store'
import { useFormFieldsStore } from '@/stores/formFields.store'
import { useDocumentStore } from '@/stores/document.store'
import { createMockPDFFile } from '@/test/helpers/test-utils'

vi.mock('@/services/forms')
vi.mock('@/services/fields')

// Creating a form now uploads the open document's bytes, because a form row
// with a null `pdfUrl` is a broken form: it lists on the dashboard and fails to
// open. Without this the suite made a real XHR and failed on `No token
// provided`.
const uploadPDF = vi.fn().mockResolvedValue({
  url: 'http://localhost:3000/uploads/pdfs/uploaded.pdf',
  filename: 'uploaded.pdf',
  size: 1024,
  fields: []
})
vi.mock('@/services/upload', () => ({
  uploadService: { uploadPDF: (...args: unknown[]) => uploadPDF(...args) }
}))

describe('useFormManagement', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    uploadPDF.mockResolvedValue({
      url: 'http://localhost:3000/uploads/pdfs/uploaded.pdf',
      filename: 'uploaded.pdf',
      size: 1024,
      fields: []
    })
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

      // `pdfUrl` used to be `undefined` here, and that was the defect rather
      // than the contract: the form was created without its PDF.
      expect(formsStore.createForm).toHaveBeenCalledWith({
        title: 'My Form',
        description: undefined,
        pdfUrl: 'http://localhost:3000/uploads/pdfs/uploaded.pdf'
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

  // Regression: `autoInitializeForm` created the form with no `pdfUrl`, so
  // placing a field on a freshly opened document left a row on the dashboard
  // that could not be opened - "This form has no PDF".
  describe('the PDF always goes up with the form', () => {
    it('uploads the open document when creating a form for it', async () => {
      const documentStore = useDocumentStore()
      const formsStore = useFormsStore()
      await createMockDocument(documentStore)
      vi.mocked(formsStore).createForm = vi.fn().mockResolvedValue(mockForm)

      const { createFormForCurrentDocument } = useFormManagement()
      await createFormForCurrentDocument()

      expect(uploadPDF).toHaveBeenCalledTimes(1)
      expect(formsStore.createForm).toHaveBeenCalledWith(
        expect.objectContaining({ pdfUrl: 'http://localhost:3000/uploads/pdfs/uploaded.pdf' })
      )
    })

    it('saves a document that has no fields at all', async () => {
      const documentStore = useDocumentStore()
      const formsStore = useFormsStore()
      const formFieldsStore = useFormFieldsStore()
      await createMockDocument(documentStore)
      vi.mocked(formsStore).createForm = vi.fn().mockResolvedValue(mockForm)

      const { saveDocumentToDatabase } = useFormManagement()
      await saveDocumentToDatabase()

      // The document is the work; needing a field before it can be stored is
      // what made closing an untouched PDF throw it away.
      expect(formsStore.createForm).toHaveBeenCalledTimes(1)
      expect(formFieldsStore.currentFormId).toBe('form-1')
      expect(documentStore.hasUnsavedEdits).toBe(false)
    })
  })
})
