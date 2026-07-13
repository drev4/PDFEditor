import { PDFDocument } from 'pdf-lib'
import type { FormField, FieldType } from '@/stores/formFields.store'
import { useDocumentStore } from '@/stores/document.store'
import { useFormFieldsStore } from '@/stores/formFields.store'

export function usePDFFieldsLoader() {
  const documentStore = useDocumentStore()
  const formFieldsStore = useFormFieldsStore()

  const loadFieldsFromPDF = async (): Promise<void> => {
    if (!documentStore.activeDocument?.arrayBuffer) {
      console.log('No active document')
      return
    }

    try {
      const pdfDoc = await PDFDocument.load(documentStore.activeDocument.arrayBuffer, { ignoreEncryption: true })
      const form = pdfDoc.getForm()
      const fields = form.getFields()
      const pages = pdfDoc.getPages()
      const scale = documentStore.activeDocument.scale || 1.5

      console.log(`PDF loaded, found ${fields.length} form fields`)

      const loadedFields: Omit<FormField, 'id'>[] = []

      for (const field of fields) {
        const fieldName = field.getName()
        const fieldType = getFieldType(field)

        if (!fieldType) {
          console.warn(`  -> Field "${fieldName}" has unrecognized type, skipping`)
          continue
        }

        const widgets = (field as any).acroField.getWidgets()

        if (widgets && widgets.length > 0) {
          const widget = widgets[0]
          const rect = widget.getRectangle()

          let pageIndex = 0
          try {
            const widgetPageRef = widget.P()

            for (let i = 0; i < pages.length; i++) {
              const page = pages[i]
              if (page) {
                const pageRef = (page as any).ref
                if (pageRef && widgetPageRef && pageRef.toString() === widgetPageRef.toString()) {
                  pageIndex = i
                  break
                }
              }
            }
          } catch {
            pageIndex = 0
          }

          const page = pages[pageIndex]
          if (!page) {
            continue
          }

          const pageHeight = page.getHeight()

          const canvasX = rect.x * scale
          const canvasY = (pageHeight - rect.y - rect.height) * scale
          const canvasWidth = rect.width * scale
          const canvasHeight = rect.height * scale

          let options: string[] | undefined
          if (fieldType === 'radio' || fieldType === 'dropdown') {
            try {
              if ((field as any).getOptions) {
                options = (field as any).getOptions()
              }
            } catch {
              options = ['Option 1', 'Option 2']
            }
          }

          const formField: Omit<FormField, 'id'> = {
            type: fieldType,
            name: fieldName,
            label: fieldName,
            required: false,
            border: true,
            position: {
              x: canvasX,
              y: canvasY,
              width: canvasWidth,
              height: canvasHeight,
              page: pageIndex + 1
            },
            options
          }

          loadedFields.push(formField)
        }
      }

      if (loadedFields.length > 0) {
        formFieldsStore.loadFieldsFromPDF(loadedFields)
        console.log(`✓ ${loadedFields.length} form fields loaded successfully`)
      } else {
        console.log('ℹ PDF does not contain form fields')
      }
    } catch (error) {
      console.error('Error loading PDF fields:', error)
    }
  }

  const getFieldType = (field: unknown): FieldType | null => {
    const constructor = (field as { constructor: { name: string } }).constructor.name

    if (constructor === 'PDFTextField' || constructor === 'PDFTextField2') {
      const isMultiline = (field as any).isMultiline && (field as any).isMultiline()
      return isMultiline ? 'textarea' : 'text'
    }

    if (constructor === 'PDFCheckBox' || constructor === 'PDFCheckBox2') {
      return 'checkbox'
    }

    if (constructor === 'PDFRadioGroup' || constructor === 'PDFRadioGroup2') {
      return 'radio'
    }

    if (constructor === 'PDFDropdown' || constructor === 'PDFDropdown2') {
      return 'dropdown'
    }

    return null
  }

  return {
    loadFieldsFromPDF
  }
}
