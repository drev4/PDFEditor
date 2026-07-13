import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../services/db.js'
import { authenticate, AuthRequest } from '../middleware/auth.js'
import { verifyFormOwnership, verifyFieldOwnership } from '../middleware/formOwnership.js'
import { pdfProcessor, type ExtractedField } from '../services/pdf-processor.js'
import fs from 'fs'
import path from 'path'

export const formFieldsRouter = Router()

const createFieldSchema = z.object({
  type: z.enum(['text', 'textarea', 'checkbox', 'radio', 'dropdown']),
  name: z.string().min(1).max(255),
  label: z.string().min(1).max(255),
  required: z.boolean().default(false),
  position: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
    page: z.number()
  }),
  options: z.array(z.string()).optional(),
  validation: z.object({
    minLength: z.number().optional(),
    maxLength: z.number().optional(),
    pattern: z.string().optional()
  }).optional(),
  order: z.number().default(0)
})

const updateFieldSchema = createFieldSchema.partial()

async function embedFieldsInPDF(form: { pdfUrl: string | null }, fieldsData: z.infer<typeof createFieldSchema>[]) {
  if (!form.pdfUrl) return

  try {
    const urlParts = form.pdfUrl.split('/')
    const filename = urlParts[urlParts.length - 1]
    const pdfPath = path.join(process.cwd(), 'uploads', 'pdfs', filename)

    if (!fs.existsSync(pdfPath)) {
      console.warn(`PDF file not found at path: ${pdfPath}`)
      return
    }

    const pdfBuffer = fs.readFileSync(pdfPath)

    const fieldsToEmbed: ExtractedField[] = fieldsData.map(field => ({
      type: field.type,
      name: field.name,
      label: field.label,
      required: field.required,
      position: field.position,
      options: field.options || undefined,
      validation: field.validation ? {
        minLength: field.validation.minLength || undefined,
        maxLength: field.validation.maxLength || undefined,
        pattern: field.validation.pattern || undefined
      } : undefined
    }))

    const modifiedPdfBuffer = await pdfProcessor.embedFieldsInPDF(pdfBuffer, fieldsToEmbed)
    fs.writeFileSync(pdfPath, modifiedPdfBuffer)

    console.log(`✓ Successfully embedded ${fieldsToEmbed.length} fields in PDF: ${filename}`)
  } catch (error) {
    console.error('Error embedding fields in PDF:', error)
  }
}

// POST /api/forms/:formId/fields - Create field
formFieldsRouter.post('/:formId/fields', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const formId = req.params.formId as string

    const form = await verifyFormOwnership(req, formId)

    const validation = createFieldSchema.safeParse(req.body)
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation error',
        details: validation.error.errors
      })
    }

    const field = await prisma.field.create({
      data: { formId, ...validation.data }
    })

    res.status(201).json({ field })
  } catch (error) {
    next(error)
  }
})

// PUT /api/forms/:formId/fields/:fieldId - Update field
formFieldsRouter.put('/:formId/fields/:fieldId', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const formId = req.params.formId as string
    const fieldId = req.params.fieldId as string

    await verifyFieldOwnership(req, formId, fieldId)

    const validation = updateFieldSchema.safeParse(req.body)
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation error',
        details: validation.error.errors
      })
    }

    const field = await prisma.field.update({
      where: { id: fieldId },
      data: validation.data
    })

    res.json({ field })
  } catch (error) {
    next(error)
  }
})

// DELETE /api/forms/:formId/fields/:fieldId - Delete field
formFieldsRouter.delete('/:formId/fields/:fieldId', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const formId = req.params.formId as string
    const fieldId = req.params.fieldId as string

    await verifyFieldOwnership(req, formId, fieldId)

    await prisma.field.delete({ where: { id: fieldId } })

    res.json({ message: 'Field deleted' })
  } catch (error) {
    next(error)
  }
})

// POST /api/forms/:formId/fields/bulk - Bulk save fields
formFieldsRouter.post('/:formId/fields/bulk', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const formId = req.params.formId as string

    const form = await verifyFormOwnership(req, formId)

    const validation = z.array(createFieldSchema).safeParse(req.body.fields)
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation error',
        details: validation.error.errors
      })
    }

    const fieldsData = validation.data

    await prisma.field.deleteMany({ where: { formId } })

    await prisma.field.createMany({
      data: fieldsData.map(field => ({ formId, ...field }))
    })

    await embedFieldsInPDF(form, fieldsData)

    const savedFields = await prisma.field.findMany({
      where: { formId },
      orderBy: { order: 'asc' }
    })

    res.json({ fields: savedFields })
  } catch (error) {
    next(error)
  }
})
