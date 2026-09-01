import { PDFDocument, PDFField, PDFForm, PDFPage, rgb } from 'pdf-lib'
import type { FieldType } from '@prisma/client'
import { logger } from './logger.js'

/**
 * Represents a field extracted from or to be embedded in a PDF
 */
export interface ExtractedField {
  type: FieldType
  name: string
  label: string
  required: boolean
  position: {
    x: number
    y: number
    width: number
    height: number
    page: number
  }
  options?: string[]
  validation?: {
    minLength?: number
    maxLength?: number
    pattern?: string
  }
}

/**
 * Service for processing PDF documents and managing AcroForm fields
 * Handles extraction, embedding, and validation of PDF form fields
 */
export class PDFProcessor {
  private readonly DEFAULT_SCALE = 1.5

  /**
   * Validates that a PDF buffer is a valid PDF document
   * @param pdfBuffer - The PDF file as a Buffer
   * @returns true if valid, false otherwise
   */
  async validatePDF(pdfBuffer: Buffer): Promise<boolean> {
    try {
      await PDFDocument.load(pdfBuffer, { ignoreEncryption: true })
      return true
    } catch (error) {
      logger.error({ err: error }, 'PDF validation failed')
      return false
    }
  }

  /**
   * Extracts AcroForm fields from a PDF document
   * Converts PDF coordinates to canvas coordinates (for database storage)
   * @param pdfBuffer - The PDF file as a Buffer
   * @returns Array of extracted fields with canvas coordinates
   */
  async extractFieldsFromPDF(pdfBuffer: Buffer): Promise<ExtractedField[]> {
    try {
      const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true })
      const form = pdfDoc.getForm()
      const fields = form.getFields()
      const pages = pdfDoc.getPages()
      const scale = this.DEFAULT_SCALE

      logger.info(`PDF loaded, found ${fields.length} form fields`)

      const extractedFields: ExtractedField[] = []

      for (const field of fields) {
        const fieldName = field.getName()
        const fieldType = this.getFieldType(field)

        if (!fieldType) {
          logger.warn(`  -> Field "${fieldName}" has unrecognized type, skipping`)
          continue
        }

        // Get widgets (visual representations of the field on pages)
        const widgets = (field as any).acroField.getWidgets()

        if (widgets && widgets.length > 0) {
          const widget = widgets[0]
          const rect = widget.getRectangle()

          // Find the page where the field is located
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
          } catch (e) {
            // If we can't get the page, assume first page
            pageIndex = 0
          }

          const page = pages[pageIndex]
          if (!page) {
            continue
          }

          const pageHeight = page.getHeight()

          // Convert PDF coordinates to canvas coordinates
          // PDF coordinates: origin at bottom-left
          // Canvas coordinates: origin at top-left
          const canvasX = rect.x * scale
          const canvasY = (pageHeight - rect.y - rect.height) * scale
          const canvasWidth = rect.width * scale
          const canvasHeight = rect.height * scale

          // Get options for radio/dropdown fields
          let options: string[] | undefined
          if (fieldType === 'radio' || fieldType === 'dropdown') {
            try {
              if ((field as any).getOptions) {
                options = (field as any).getOptions()
              }
            } catch (e) {
              // If we can't get options, use defaults
              options = ['Option 1', 'Option 2']
            }
          }

          const extractedField: ExtractedField = {
            type: fieldType,
            name: fieldName,
            label: fieldName, // Use field name as default label
            required: false, // pdf-lib doesn't easily expose required flag
            position: {
              x: canvasX,
              y: canvasY,
              width: canvasWidth,
              height: canvasHeight,
              page: pageIndex + 1
            },
            options
          }

          extractedFields.push(extractedField)
        }
      }

      logger.info(`✓ Extracted ${extractedFields.length} fields from PDF`)
      return extractedFields
    } catch (error) {
      logger.error({ err: error }, 'Error extracting fields from PDF')
      throw new Error('Failed to extract fields from PDF')
    }
  }

  /**
   * Embeds form fields into a PDF document
   * Converts canvas coordinates to PDF coordinates
   * @param pdfBuffer - The original PDF file as a Buffer
   * @param fields - Array of fields to embed with canvas coordinates
   * @returns Modified PDF as a Buffer
   */
  async embedFieldsInPDF(pdfBuffer: Buffer, fields: ExtractedField[]): Promise<Buffer> {
    try {
      const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true })
      const form = pdfDoc.getForm()
      const pages = pdfDoc.getPages()
      const scale = this.DEFAULT_SCALE

      logger.info(`Embedding ${fields.length} fields into PDF`)

      for (const field of fields) {
        const pageIndex = field.position.page - 1
        const page = pages[pageIndex]

        if (!page) {
          logger.warn(`  -> Page ${field.position.page} not found for field "${field.name}", skipping`)
          continue
        }

        // Check if field already exists and remove it to avoid duplicates
        try {
          const existingField = form.getFieldMaybe(field.name)
          if (existingField) {
            logger.info(`  -> Removing existing field "${field.name}" before recreating`)
            form.removeField(existingField)
          }
        } catch (e) {
          // Field doesn't exist, which is fine
        }

        const pageHeight = page.getHeight()

        // Convert canvas coordinates to PDF coordinates
        const pdfX = field.position.x / scale
        const pdfY = pageHeight - (field.position.y / scale) - (field.position.height / scale)
        const pdfWidth = field.position.width / scale
        const pdfHeight = field.position.height / scale

        await this.addFieldToPDF(form, page, field, pdfX, pdfY, pdfWidth, pdfHeight)
      }

      const pdfBytes = await pdfDoc.save()
      logger.info(`✓ Successfully embedded ${fields.length} fields into PDF`)

      return Buffer.from(pdfBytes)
    } catch (error) {
      logger.error({ err: error }, 'Error embedding fields in PDF')
      throw new Error('Failed to embed fields in PDF')
    }
  }

  /**
   * Determines the field type based on the PDF field constructor
   * @param field - The PDF field from pdf-lib
   * @returns The FieldType or null if unrecognized
   */
  private getFieldType(field: PDFField): FieldType | null {
    const constructor = field.constructor.name

    // Handle both PDFTextField and PDFTextField2 (and others with suffix 2)
    if (constructor === 'PDFTextField' || constructor === 'PDFTextField2') {
      // Check if it's multiline
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

  /**
   * Adds a field to the PDF form based on its type
   * @param form - The PDF form
   * @param page - The PDF page where the field will be added
   * @param field - The field data
   * @param x - X coordinate in PDF space
   * @param y - Y coordinate in PDF space
   * @param width - Width in PDF space
   * @param height - Height in PDF space
   */
  private async addFieldToPDF(
    form: PDFForm,
    page: PDFPage,
    field: ExtractedField,
    x: number,
    y: number,
    width: number,
    height: number
  ): Promise<void> {
    const borderColor = rgb(0.6, 0.6, 0.6)

    try {
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

        default:
          logger.warn(`  -> Unsupported field type: ${field.type}`)
      }
    } catch (error) {
      logger.error({ err: error }, `  -> Error adding field "${field.name}" of type ${field.type}`)
      // Continue with other fields even if one fails
    }
  }
}

// Export singleton instance
export const pdfProcessor = new PDFProcessor()
