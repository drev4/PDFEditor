import { PDFDocument, rgb } from 'pdf-lib'
import { useFormFieldsStore, type FormField, type FieldType } from '@/stores/formFields.store'
import { useDocumentStore } from '@/stores/document.store'

export function useFormFieldsExport() {
  const formFieldsStore = useFormFieldsStore()
  const documentStore = useDocumentStore()

  /**
   * Exports the current PDF with all form fields embedded
   * Returns a Uint8Array of the PDF bytes
   */
  const exportPDFWithFields = async (): Promise<Uint8Array> => {
    if (!documentStore.activeDocument?.arrayBuffer) {
      throw new Error('No active document')
    }

    const pdfDoc = await PDFDocument.load(documentStore.activeDocument.arrayBuffer, { ignoreEncryption: true })
    const form = pdfDoc.getForm()
    const pages = pdfDoc.getPages()

    // Get canvas dimensions for coordinate conversion
    // Assuming standard PDF coordinate system (72 DPI)
    const scale = documentStore.activeDocument.scale || 1.5

    for (const field of formFieldsStore.fields) {
      const pageIndex = field.position.page - 1
      const page = pages[pageIndex]

      if (!page) continue

      const pageHeight = page.getHeight()

      // Convert canvas coordinates to PDF coordinates
      // PDF coordinates are from bottom-left, canvas from top-left
      const pdfX = field.position.x / scale
      const pdfY = pageHeight - (field.position.y / scale) - (field.position.height / scale)
      const pdfWidth = field.position.width / scale
      const pdfHeight = field.position.height / scale

      await addFieldToPDF(form, page, field, pdfX, pdfY, pdfWidth, pdfHeight)
    }

    return await pdfDoc.save()
  }

  /**
   * Adds a single field to the PDF form
   */
  const addFieldToPDF = async (
    form: ReturnType<typeof PDFDocument.prototype.getForm>,
    page: ReturnType<typeof PDFDocument.prototype.getPage>,
    field: FormField,
    x: number,
    y: number,
    width: number,
    height: number
  ) => {
    const borderColor = rgb(0.6, 0.6, 0.6)

    switch (field.type) {
      case 'text':
      case 'textarea': {
        const textField = form.createTextField(field.name)
        textField.addToPage(page, {
          x,
          y,
          width,
          height,
          borderWidth: 1,
          borderColor
        })
        if (field.type === 'textarea') {
          textField.enableMultiline()
        }
        break
      }

      case 'checkbox': {
        const checkbox = form.createCheckBox(field.name)
        checkbox.addToPage(page, {
          x,
          y,
          width,
          height,
          borderWidth: 1,
          borderColor
        })
        break
      }

      case 'radio': {
        const radioGroup = form.createRadioGroup(field.name)
        const options = field.options || ['Option 1', 'Option 2']

        // For radio buttons, create multiple options vertically
        const optionHeight = Math.min(height, 20)
        const spacing = optionHeight + 5

        options.forEach((option, index) => {
          const optionY = y - (index * spacing)
          radioGroup.addOptionToPage(option, page, {
            x,
            y: optionY,
            width: optionHeight,
            height: optionHeight,
            borderWidth: 1,
            borderColor
          })

          // Draw label next to radio button
          page.drawText(option, {
            x: x + optionHeight + 5,
            y: optionY + 4,
            size: 10,
            color: rgb(0.2, 0.2, 0.2)
          })
        })
        break
      }

      case 'dropdown': {
        const dropdown = form.createDropdown(field.name)
        const options = field.options || ['Option 1', 'Option 2']
        dropdown.addOptions(options)
        if (options.length > 0 && options[0]) {
          dropdown.select(options[0])
        }
        dropdown.addToPage(page, {
          x,
          y,
          width,
          height,
          borderWidth: 1,
          borderColor
        })
        break
      }
    }
  }

  /**
   * Downloads the PDF with embedded form fields
   */
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

  /**
   * Gets a preview of the form fields as JSON (for debugging or API submission)
   */
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
