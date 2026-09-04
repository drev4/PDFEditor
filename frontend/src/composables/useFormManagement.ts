import { ref } from 'vue'
import { useFormsStore } from '@/stores/forms.store'
import { useFormFieldsStore } from '@/stores/formFields.store'
import { useDocumentStore } from '@/stores/document.store'
import { uploadService, type UploadProgress } from '@/services/upload'

/**
 * Composable para gestionar la conexión entre documentos PDF y formularios persistidos
 */
export function useFormManagement() {
  const formsStore = useFormsStore()
  const formFieldsStore = useFormFieldsStore()
  const documentStore = useDocumentStore()

  const isInitializing = ref(false)
  const uploadProgress = ref<UploadProgress | null>(null)
  const isUploading = ref(false)

  /**
   * Upload a PDF file to the server
   * Returns the PDF URL and extracted fields count
   */
  async function uploadPDF(file: File): Promise<{ url: string; extractedFieldsCount: number }> {
    try {
      isUploading.value = true
      uploadProgress.value = null

      const response = await uploadService.uploadPDF(file, (progress) => {
        uploadProgress.value = progress
      })

      // If the PDF has extracted fields, load them into the store
      let extractedFieldsCount = 0
      if (response.fields && response.fields.length > 0) {
        console.log(`PDF uploaded with ${response.fields.length} extracted fields`)

        // Convert extracted fields to store format and load them
        formFieldsStore.loadFieldsFromPDF(response.fields.map(field => ({
          type: field.type,
          name: field.name,
          label: field.label,
          required: field.required,
          position: field.position,
          options: field.options,
          border: true, // Default to having border
          validation: field.validation
        })))

        extractedFieldsCount = response.fields.length
      }

      return {
        url: response.url,
        extractedFieldsCount
      }
    } finally {
      isUploading.value = false
      uploadProgress.value = null
    }
  }

  /**
   * Close the editor's session: the document, its fields, and the form they
   * belonged to.
   *
   * These three live in stores that outlive the route and each other, and
   * closing only one of them is a bug every time. Closing the document on its
   * own left the fields in place, so the next PDF opened with the previous
   * form's fields drawn on it — and saving would have written them into the new
   * form. This is the only thing that should ever end a session.
   */
  function resetEditorSession() {
    documentStore.documents.forEach(doc => documentStore.closeDocument(doc.id))
    formFieldsStore.clearFields()
    formFieldsStore.setCurrentForm(null)
    documentStore.markSaved()
  }

  /**
   * The open document as a `File`, ready to upload.
   *
   * Prefers the in-memory buffer over the originally picked file, because the
   * buffer is what the editor's tools have been writing to — using
   * `document.file` would upload the version before any edit.
   */
  function fileFromActiveDocument(): File | null {
    const doc = documentStore.activeDocument
    if (!doc?.arrayBuffer) return doc?.file ?? null
    return new File([doc.arrayBuffer], doc.name || 'document.pdf', { type: 'application/pdf' })
  }

  /**
   * Make sure the open document exists in the database, fields or not.
   *
   * A PDF that has been opened but never given a field has no form row at all,
   * so closing the editor threw it away silently. Saving it with no fields is a
   * perfectly reasonable thing to want — the document is the work.
   */
  async function saveDocumentToDatabase() {
    if (!documentStore.activeDocument) return null

    if (!formFieldsStore.currentFormId) {
      const form = await createFormForCurrentDocument()
      documentStore.markSaved()
      return form
    }

    if (formFieldsStore.fields.length > 0) {
      await formFieldsStore.saveAllFields()
    }

    if (documentStore.hasUnsavedEdits) {
      await persistEditedDocument()
    }

    return formsStore.currentForm
  }

  /**
   * Crea un formulario nuevo para el documento actual
   * @param title - Título del formulario (opcional)
   * @param pdfFile - Archivo PDF a subir (opcional)
   */
  async function createFormForCurrentDocument(title?: string, pdfFile?: File, description?: string) {
    const activeDoc = documentStore.activeDocument
    if (!activeDoc) {
      throw new Error('No active document')
    }

    try {
      isInitializing.value = true

      // Upload the PDF. If the caller did not hand one over, the open
      // document's own bytes are the PDF — and they have to go up, because a
      // form row with a null `pdfUrl` is a broken form: the dashboard lists it,
      // and opening it fails with "This form has no PDF". That is exactly what
      // happened when a field was placed on a freshly opened document, which
      // auto-creates the form through `autoInitializeForm`.
      const file = pdfFile ?? fileFromActiveDocument()

      let pdfUrl: string | undefined = undefined
      let extractedFieldsCount = 0
      if (file) {
        const uploadResult = await uploadPDF(file)
        pdfUrl = uploadResult.url
        extractedFieldsCount = uploadResult.extractedFieldsCount
      }

      const form = await formsStore.createForm({
        title: title || `Form - ${activeDoc.name}`,
        description: description || undefined,
        pdfUrl
      })

      // Set as current form in fields store
      formFieldsStore.setCurrentForm(form.id)

      // Save any existing local fields to the new form
      // This includes both manually added fields and extracted fields from the PDF
      if (formFieldsStore.fields.length > 0) {
        await formFieldsStore.saveAllFields()
      }

      console.log(`Form created with ${extractedFieldsCount} fields extracted from PDF`)

      return form
    } finally {
      isInitializing.value = false
    }
  }

  /**
   * Carga un formulario existente y sus campos
   */
  async function loadForm(formId: string) {
    try {
      isInitializing.value = true

      const form = await formsStore.fetchForm(formId)

      // Set as current form
      formFieldsStore.setCurrentForm(form.id)

      // Load fields
      if (form.fields && form.fields.length > 0) {
        formFieldsStore.loadFieldsFromForm(form.fields)
      }

      return form
    } finally {
      isInitializing.value = false
    }
  }

  /**
   * Guarda todos los campos del formulario actual
   */
  async function saveCurrentForm() {
    if (!formFieldsStore.currentFormId) {
      throw new Error('No current form set')
    }

    return await formFieldsStore.saveAllFields()
  }

  /**
   * Inicializa automáticamente un formulario cuando el usuario agrega el primer campo
   * (Solo si no hay formulario actual establecido)
   */
  async function autoInitializeForm() {
    // Si ya hay un formulario activo, no hacer nada
    if (formFieldsStore.currentFormId) {
      return
    }

    // Si no hay documento activo, no hacer nada
    if (!documentStore.activeDocument) {
      return
    }

    // Crear formulario automáticamente
    return await createFormForCurrentDocument()
  }

  /**
   * Upload a PDF and update the current form
   * Automatically loads extracted fields from the PDF
   */
  async function uploadPDFForCurrentForm(file: File) {
    if (!formFieldsStore.currentFormId) {
      throw new Error('No current form set')
    }

    const uploadResult = await uploadPDF(file)

    await formsStore.updateForm(formFieldsStore.currentFormId, {
      pdfUrl: uploadResult.url
    })

    // Save the extracted fields if any
    if (uploadResult.extractedFieldsCount > 0) {
      await formFieldsStore.saveAllFields()
      console.log(`Saved ${uploadResult.extractedFieldsCount} fields extracted from PDF`)
    }

    return uploadResult
  }

  /**
   * Persist the bytes of the document currently open in the editor.
   *
   * The editor's drawing tools (text, images, drawings) modify the PDF in the
   * browser with pdf-lib and write the result back to
   * `documentStore.activeDocument.arrayBuffer`. Nothing sent it anywhere, so
   * every one of those edits was lost on reload — the document on the server
   * was still the one that was uploaded.
   *
   * This uploads the edited bytes and repoints the form at them. It goes
   * through the existing `POST /api/upload` + `PATCH /api/forms/:id` rather
   * than a new endpoint, because both already do exactly this and neither
   * needs a new public surface.
   *
   * Two things it deliberately does not do:
   *  - It does not touch the fields. `uploadPDFForCurrentForm` saves the fields
   *    extracted from the uploaded file, which is right when the user picks a
   *    new PDF and wrong here: these bytes already carry the embedded AcroForm,
   *    so re-saving them would duplicate every field.
   *  - It does not delete the previous file, and must not try to. The server
   *    collects it on the repoint (features/0046): `PUT /api/forms/:id` removes
   *    the document it replaced once no surviving form references it. That
   *    question can only be answered where the other forms are, so this client
   *    neither asks it nor names bytes to destroy.
   */
  async function persistEditedDocument(): Promise<string | undefined> {
    const document = documentStore.activeDocument
    if (!document?.arrayBuffer) return

    // Mirrors FormFieldsOverlay: the first edit on a loose document is what
    // creates the form to hang it on.
    await autoInitializeForm()

    const formId = formFieldsStore.currentFormId
    if (!formId) return

    const file = fileFromActiveDocument()
    if (!file) return

    const { url } = await uploadPDF(file)
    await formsStore.updateForm(formId, { pdfUrl: url })
    documentStore.markSaved()

    return url
  }

  return {
    isInitializing,
    isUploading,
    uploadProgress,
    createFormForCurrentDocument,
    loadForm,
    saveCurrentForm,
    autoInitializeForm,
    uploadPDF,
    uploadPDFForCurrentForm,
    persistEditedDocument,
    saveDocumentToDatabase,
    resetEditorSession
  }
}
