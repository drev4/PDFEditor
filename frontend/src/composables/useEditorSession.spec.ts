import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFormManagement } from './useFormManagement'
import { useDocumentStore } from '@/stores/document.store'
import { useFormFieldsStore } from '@/stores/formFields.store'
import { createMockPDFFile } from '@/test/helpers/test-utils'

vi.mock('@/services/forms')
vi.mock('@/services/fields')
vi.mock('@/services/upload', () => ({
  uploadService: {
    uploadPDF: vi.fn().mockResolvedValue({
      url: 'http://localhost:3000/uploads/pdfs/uploaded.pdf',
      filename: 'uploaded.pdf',
      size: 1024,
      fields: []
    })
  }
}))

/**
 * The editor's session is a document, its fields, and the form they belong to.
 * They live in stores that outlive the route and each other, and ending only
 * one of them is a bug every time.
 */
describe('resetEditorSession', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  const openDocumentWithFields = async () => {
    const documentStore = useDocumentStore()
    const formFieldsStore = useFormFieldsStore()

    await documentStore.loadPDF(createMockPDFFile('first.pdf', 1024))
    formFieldsStore.setCurrentForm('form-1')
    formFieldsStore.addField({
      type: 'text',
      name: 'text_1',
      label: 'Name',
      required: false,
      position: { x: 10, y: 10, width: 100, height: 30, page: 1 }
    })

    return { documentStore, formFieldsStore }
  }

  // The reported bug: closing the document left the fields behind, so the next
  // PDF opened with the previous form's fields drawn on it — and saving would
  // have written them into the new form.
  it('takes the fields with the document', async () => {
    const { documentStore, formFieldsStore } = await openDocumentWithFields()
    expect(formFieldsStore.fields).toHaveLength(1)

    useFormManagement().resetEditorSession()

    expect(documentStore.documents).toHaveLength(0)
    expect(formFieldsStore.fields).toHaveLength(0)
  })

  it('takes the form with them, so nothing is saved into it by mistake', async () => {
    const { formFieldsStore } = await openDocumentWithFields()

    useFormManagement().resetEditorSession()

    expect(formFieldsStore.currentFormId).toBeNull()
  })

  it('leaves nothing marked as unsaved', async () => {
    const { documentStore, formFieldsStore } = await openDocumentWithFields()
    documentStore.markEdited()

    useFormManagement().resetEditorSession()

    expect(documentStore.hasUnsavedEdits).toBe(false)
    expect(formFieldsStore.hasUnsavedChanges).toBe(false)
  })

  it('a document opened after a reset carries no fields', async () => {
    await openDocumentWithFields()
    const formManagement = useFormManagement()

    formManagement.resetEditorSession()

    const documentStore = useDocumentStore()
    const formFieldsStore = useFormFieldsStore()
    await documentStore.loadPDF(createMockPDFFile('second.pdf', 2048))

    expect(documentStore.activeDocument?.name).toBe('second.pdf')
    expect(formFieldsStore.fields).toHaveLength(0)
  })
})
