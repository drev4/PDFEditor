import { PDFDocument } from 'pdf-lib'
import type { FormField, FieldType } from '@/stores/formFields.store'
import { useDocumentStore } from '@/stores/document.store'
import { useFormFieldsStore } from '@/stores/formFields.store'

export function usePDFFieldsLoader() {
  const documentStore = useDocumentStore()
  const formFieldsStore = useFormFieldsStore()

  /**
   * Lee los campos del formulario PDF y los carga en el store
   */
  const loadFieldsFromPDF = async (): Promise<void> => {
    if (!documentStore.activeDocument?.arrayBuffer) {
      console.log('No hay documento activo')
      return
    }

    try {
      const pdfDoc = await PDFDocument.load(documentStore.activeDocument.arrayBuffer, { ignoreEncryption: true })
      const form = pdfDoc.getForm()
      const fields = form.getFields()
      const pages = pdfDoc.getPages()
      const scale = documentStore.activeDocument.scale || 1.5

      console.log(`PDF cargado, encontrados ${fields.length} campos del formulario`)

      const loadedFields: Omit<FormField, 'id'>[] = []

      for (const field of fields) {
        const fieldName = field.getName()
        const fieldType = getFieldType(field)

        if (!fieldType) {
          console.warn(`  -> Campo "${fieldName}" tipo no reconocido, ignorando`)
          continue // Si no reconocemos el tipo, lo ignoramos
        }

        // Obtener widgets (representaciones visuales del campo en las páginas)
        const widgets = (field as any).acroField.getWidgets()

        if (widgets && widgets.length > 0) {
          const widget = widgets[0] // Tomamos el primer widget
          const rect = widget.getRectangle()

          // Encontrar la página donde está el campo
          let pageIndex = 0
          try {
            // Intentar obtener la página del widget
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
          } catch (e) {
            // Si no podemos obtener la página, asumimos la primera
            pageIndex = 0
          }

          const page = pages[pageIndex]
          if (!page) {
            continue
          }

          const pageHeight = page.getHeight()

          // Convertir coordenadas PDF a canvas
          const canvasX = rect.x * scale
          const canvasY = (pageHeight - rect.y - rect.height) * scale
          const canvasWidth = rect.width * scale
          const canvasHeight = rect.height * scale

          // Obtener opciones para radio/dropdown
          let options: string[] | undefined
          if (fieldType === 'radio' || fieldType === 'dropdown') {
            try {
              if ((field as any).getOptions) {
                options = (field as any).getOptions()
              }
            } catch (e) {
              // Si no se pueden obtener opciones, usar valores por defecto
              options = ['Option 1', 'Option 2']
            }
          }

          const formField: Omit<FormField, 'id'> = {
            type: fieldType,
            name: fieldName,
            label: fieldName, // Por defecto usamos el nombre como etiqueta
            required: false, // PDF-lib no expone si un campo es requerido fácilmente
            border: true, // Por defecto los campos del PDF tienen borde
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

      // Cargar los campos en el store
      if (loadedFields.length > 0) {
        formFieldsStore.loadFieldsFromPDF(loadedFields)
        console.log(`✓ ${loadedFields.length} campos del formulario cargados correctamente`)
      } else {
        console.log('ℹ El PDF no contiene campos de formulario')
      }
    } catch (error) {
      console.error('Error loading PDF fields:', error)
    }
  }

  /**
   * Determina el tipo de campo basado en el campo PDF
   */
  const getFieldType = (field: any): FieldType | null => {
    const constructor = field.constructor.name

    // Manejar tanto PDFTextField como PDFTextField2 (y otros con sufijo 2)
    if (constructor === 'PDFTextField' || constructor === 'PDFTextField2') {
      // Verificar si es multiline
      const isMultiline = field.isMultiline && field.isMultiline()
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
