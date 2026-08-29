import { PDFDocument } from 'pdf-lib'
import { useDocumentStore } from '@/stores/document.store'
import { useFormFieldsStore } from '@/stores/formFields.store'
import { embedFieldsInPDF, type EmbedField } from '@/utils/pdfFieldEmbedder'

/**
 * Download the open document, with its fields embedded as a real AcroForm.
 *
 * Extracted from `PDFEditor.vue` so the editor's top bar can offer it too. It
 * was buried in a panel that only appears once a document is open and is
 * scrolled past the search box — for the one action that gets the user's work
 * out of the product, that was too far down.
 */
export function useDownloadPDF() {
  const documentStore = useDocumentStore()
  const formFieldsStore = useFormFieldsStore()

  async function downloadPDF() {
    if (!documentStore.activeDocument?.arrayBuffer) return

    // Page reordering is applied by rebuilding the document, so it has to
    // happen before anything is embedded into it.
    let pdfDoc: PDFDocument

    if (documentStore.activeDocument.pageOrder && documentStore.activeDocument.pageOrder.length > 0) {
      const originalPdfDoc = await PDFDocument.load(documentStore.activeDocument.arrayBuffer, { ignoreEncryption: true })
      pdfDoc = await PDFDocument.create()

      for (const pageNum of documentStore.activeDocument.pageOrder) {
        const [copiedPage] = await pdfDoc.copyPages(originalPdfDoc, [pageNum - 1])
        pdfDoc.addPage(copiedPage)
      }
    } else {
      pdfDoc = await PDFDocument.load(documentStore.activeDocument.arrayBuffer, { ignoreEncryption: true })
    }

    if (formFieldsStore.fields.length > 0) {
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
    }

    const pdfBytes = await pdfDoc.save()
    const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `edited_${documentStore.activeDocument.name}`
    link.click()
    URL.revokeObjectURL(url)
  }

  return { downloadPDF }
}
