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

      // Upload PDF if provided
      let pdfUrl: string | undefined = undefined
      let extractedFieldsCount = 0
      if (pdfFile) {
        const uploadResult = await uploadPDF(pdfFile)
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

  return {
    isInitializing,
    isUploading,
    uploadProgress,
    createFormForCurrentDocument,
    loadForm,
    saveCurrentForm,
    autoInitializeForm,
    uploadPDF,
    uploadPDFForCurrentForm
  }
}
