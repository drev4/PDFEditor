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
   */
  async function uploadPDF(file: File): Promise<string> {
    try {
      isUploading.value = true
      uploadProgress.value = null

      const response = await uploadService.uploadPDF(file, (progress) => {
        uploadProgress.value = progress
      })

      return response.url
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
  async function createFormForCurrentDocument(title?: string, pdfFile?: File) {
    const activeDoc = documentStore.activeDocument
    if (!activeDoc) {
      throw new Error('No active document')
    }

    try {
      isInitializing.value = true

      // Upload PDF if provided
      let pdfUrl: string | undefined = undefined
      if (pdfFile) {
        pdfUrl = await uploadPDF(pdfFile)
      }

      const form = await formsStore.createForm({
        title: title || `Form - ${activeDoc.name}`,
        description: `PDF form based on ${activeDoc.name}`,
        pdfUrl
      })

      // Set as current form in fields store
      formFieldsStore.setCurrentForm(form.id)

      // Save any existing local fields to the new form
      if (formFieldsStore.fields.length > 0) {
        await formFieldsStore.saveAllFields()
      }

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
   */
  async function uploadPDFForCurrentForm(file: File) {
    if (!formFieldsStore.currentFormId) {
      throw new Error('No current form set')
    }

    const pdfUrl = await uploadPDF(file)

    await formsStore.updateForm(formFieldsStore.currentFormId, {
      pdfUrl
    })

    return pdfUrl
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
