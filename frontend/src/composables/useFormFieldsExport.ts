import { PDFDocument } from 'pdf-lib'
import { useFormFieldsStore } from '@/stores/formFields.store'
import { useDocumentStore } from '@/stores/document.store'
import { embedFieldsInPDF, type EmbedField } from '@/utils/pdfFieldEmbedder'

export function useFormFieldsExport() {
  const formFieldsStore = useFormFieldsStore()
  const documentStore = useDocumentStore()

  const exportPDFWithFields = async (): Promise<Uint8Array> => {
    if (!documentStore.activeDocument?.arrayBuffer) {
      throw new Error('No active document')
    }

    const pdfDoc = await PDFDocument.load(documentStore.activeDocument.arrayBuffer, { ignoreEncryption: true })
    const scale = documentStore.activeDocument.scale || 1.5

    const fields: EmbedField[] = formFieldsStore.fields.map(field => ({
      type: field.type,
      name: field.name,
      label: field.label,
      required: field.required,
      border: field.border,
      position: field.position,
      options: field.options
    }))

    await embedFieldsInPDF(pdfDoc, fields, scale)

    return await pdfDoc.save()
  }

  const downloadPDFWithFields = async (filename?: string) => {
    const pdfBytes = await exportPDFWithFields()
    const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)

    const link = document.createElement('a')
    link.href = url
    link.download = filename || `${documentStore.activeDocument?.name || 'form'}_with_fields.pdf`
    link.click()

    URL.revokeObjectURL(url)
  }

  const getFieldsJSON = () => {
    return formFieldsStore.fields.map(field => ({
      name: field.name,
      type: field.type,
      label: field.label,
      required: field.required,
      position: field.position,
      options: field.options
    }))
  }

  return {
    exportPDFWithFields,
    downloadPDFWithFields,
    getFieldsJSON
  }
}
