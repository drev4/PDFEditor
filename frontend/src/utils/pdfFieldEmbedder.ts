import { PDFDocument, PDFForm, PDFPage, rgb, type Color } from 'pdf-lib'
import { BASE_SCALE } from './pdfCoordinates'

export type EmbedFieldType = 'text' | 'textarea' | 'checkbox' | 'radio' | 'dropdown'

export interface EmbedFieldPosition {
  x: number
  y: number
  width: number
  height: number
  page: number
}

export interface EmbedField {
  type: EmbedFieldType
  name: string
  label: string
  required: boolean
  border?: boolean
  position: EmbedFieldPosition
  options?: string[]
}

export interface EmbedFieldOptions {
  borderWidth?: number
  borderColor?: Color
  backgroundColor?: Color
}

const DEFAULT_BORDER_COLOR = rgb(0.6, 0.6, 0.6)

/**
 * Stored position to PDF points.
 *
 * The divisor is `BASE_SCALE` and **not a parameter** (features/0052). It used
 * to be one, defaulting to 1.5, and both call sites passed
 * `documentStore.activeDocument.scale` — the *zoom* — so a document downloaded
 * after zooming in carried every field in the wrong place. A stored position
 * has exactly one scale in it, so this function does not need to be told.
 *
 * The same arithmetic lives in `pdf-processor.ts` on the server. Neither is the
 * "real" one; they are pinned to each other by the worked example their two
 * specs share.
 */
function canvasToPDFCoords(
  field: EmbedField,
  pageHeight: number
): { x: number; y: number; width: number; height: number } {
  return {
    x: field.position.x / BASE_SCALE,
    y: pageHeight - (field.position.y / BASE_SCALE) - (field.position.height / BASE_SCALE),
    width: field.position.width / BASE_SCALE,
    height: field.position.height / BASE_SCALE
  }
}

function buildFieldOptions(field: EmbedField, overrides?: Partial<EmbedFieldOptions>): EmbedFieldOptions {
  return {
    borderWidth: field.border !== false ? (overrides?.borderWidth ?? 1) : 0,
    borderColor: field.border !== false ? (overrides?.borderColor ?? DEFAULT_BORDER_COLOR) : undefined,
    backgroundColor: overrides?.backgroundColor
  }
}

async function addFieldToPDF(
  form: PDFForm,
  page: PDFPage,
  field: EmbedField,
  pdfX: number,
  pdfY: number,
  pdfWidth: number,
  pdfHeight: number
): Promise<void> {
  const opts = buildFieldOptions(field)

  try {
    switch (field.type) {
      case 'text':
      case 'textarea': {
        const textField = form.createTextField(field.name)
        textField.addToPage(page, {
          x: pdfX,
          y: pdfY,
          width: pdfWidth,
          height: pdfHeight,
          borderWidth: opts.borderWidth,
          borderColor: opts.borderColor,
          backgroundColor: opts.backgroundColor
        })
        if (field.type === 'textarea') {
          textField.enableMultiline()
        }
        break
      }

      case 'checkbox': {
        const checkbox = form.createCheckBox(field.name)
        checkbox.addToPage(page, {
          x: pdfX,
          y: pdfY,
          width: pdfWidth,
          height: pdfHeight,
          borderWidth: opts.borderWidth,
          borderColor: opts.borderColor,
          backgroundColor: opts.backgroundColor
        })
        break
      }

      case 'radio': {
        const radioGroup = form.createRadioGroup(field.name)
        const options = field.options || ['Option 1', 'Option 2']
        const optionHeight = Math.min(pdfHeight, 20)
        const spacing = optionHeight + 5

        options.forEach((option, index) => {
          const optionY = pdfY - (index * spacing)
          radioGroup.addOptionToPage(option, page, {
            x: pdfX,
            y: optionY,
            width: optionHeight,
            height: optionHeight,
            borderWidth: opts.borderWidth,
            borderColor: opts.borderColor,
            backgroundColor: opts.backgroundColor
          })

          page.drawText(option, {
            x: pdfX + optionHeight + 5,
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
          x: pdfX,
          y: pdfY,
          width: pdfWidth,
          height: pdfHeight,
          borderWidth: opts.borderWidth,
          borderColor: opts.borderColor,
          backgroundColor: opts.backgroundColor
        })
        break
      }
    }
  } catch (error) {
    console.error(`Error adding field "${field.name}" of type ${field.type}:`, error)
  }
}

export async function embedFieldsInPDF(
  pdfDoc: PDFDocument,
  fields: EmbedField[]
): Promise<void> {
  const form = pdfDoc.getForm()
  const pages = pdfDoc.getPages()

  for (const field of fields) {
    const pageIndex = field.position.page - 1
    const page = pages[pageIndex]
    if (!page) continue

    try {
      const existingField = form.getFieldMaybe(field.name)
      if (existingField) {
        form.removeField(existingField)
      }
    } catch {
      // Field doesn't exist, which is fine
    }

    const pageHeight = page.getHeight()
    const { x, y, width, height } = canvasToPDFCoords(field, pageHeight)
    await addFieldToPDF(form, page, field, x, y, width, height)
  }
}
