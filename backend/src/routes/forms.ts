import { Router } from 'express'
import { z } from 'zod'
import { nanoid } from 'nanoid'
import { prisma } from '../services/db.js'
import { AppError } from '../middleware/errorHandler.js'
import { authenticate, AuthRequest } from '../middleware/auth.js'
import { pdfProcessor, type ExtractedField } from '../services/pdf-processor.js'
import fs from 'fs'
import path from 'path'

export const formsRouter = Router()

const createFormSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  pdfUrl: z.string().optional()
})

const updateFormSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  status: z.enum(['draft', 'published', 'closed']).optional(),
  pdfUrl: z.string().optional(),
  settings: z.record(z.unknown()).optional()
})

// GET /api/forms - List user's forms
formsRouter.get('/', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const forms = await prisma.form.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { fields: true, responses: true }
        }
      }
    })

    res.json({ forms })
  } catch (error) {
    next(error)
  }
})

// POST /api/forms - Create form
formsRouter.post('/', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const validation = createFormSchema.safeParse(req.body)
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation error',
        details: validation.error.errors
      })
    }

    const { title, description, pdfUrl } = validation.data

    const form = await prisma.form.create({
      data: {
        userId: req.userId!,
        title,
        description,
        pdfUrl,
        shareId: nanoid(12)
      }
    })

    res.status(201).json({ form })
  } catch (error) {
    next(error)
  }
})

// GET /api/forms/:id - Get form by ID
formsRouter.get('/:id', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const id = req.params.id as string

    const form = await prisma.form.findFirst({
      where: {
        id,
        userId: req.userId
      },
      include: {
        fields: { orderBy: { order: 'asc' } }
      }
    })

    if (!form) {
      throw new AppError(404, 'Form not found')
    }

    // Sync fields from PDF if pdfUrl exists and no fields in DB
    if (form.pdfUrl && form.fields.length === 0) {
      try {
        // Extract filename from URL
        const urlParts = form.pdfUrl.split('/')
        const filename = urlParts[urlParts.length - 1]
        const pdfPath = path.join(process.cwd(), 'uploads', 'pdfs', filename)

        // Check if PDF file exists
        if (fs.existsSync(pdfPath)) {
          // Read and extract fields from PDF
          const pdfBuffer = fs.readFileSync(pdfPath)
          const extractedFields = await pdfProcessor.extractFieldsFromPDF(pdfBuffer)

          if (extractedFields.length > 0) {
            console.log(`Found ${extractedFields.length} fields in PDF, syncing to database...`)

            // Save extracted fields to database
            await prisma.field.createMany({
              data: extractedFields.map((field, index) => ({
                formId: id,
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
                } : undefined,
                order: index
              }))
            })

            // Reload form with newly created fields
            const updatedForm = await prisma.form.findFirst({
              where: { id },
              include: {
                fields: { orderBy: { order: 'asc' } }
              }
            })

            console.log(`✓ Successfully synced ${extractedFields.length} fields from PDF to database`)

            return res.json({ form: updatedForm })
          }
        }
      } catch (error) {
        console.error('Error syncing fields from PDF:', error)
        // Continue with original form even if sync fails
      }
    }

    res.json({ form })
  } catch (error) {
    next(error)
  }
})

// PUT /api/forms/:id - Update form
formsRouter.put('/:id', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const id = req.params.id as string
    const validation = updateFormSchema.safeParse(req.body)
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation error',
        details: validation.error.errors
      })
    }

    const data = validation.data

    const existingForm = await prisma.form.findFirst({
      where: { id, userId: req.userId }
    })

    if (!existingForm) {
      throw new AppError(404, 'Form not found')
    }

    const form = await prisma.form.update({
      where: { id },
      data: data as any
    })

    res.json({ form })
  } catch (error) {
    next(error)
  }
})

// DELETE /api/forms/:id - Delete form
formsRouter.delete('/:id', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const id = req.params.id as string

    const existingForm = await prisma.form.findFirst({
      where: { id, userId: req.userId }
    })

    if (!existingForm) {
      throw new AppError(404, 'Form not found')
    }

    await prisma.form.delete({ where: { id } })

    res.json({ message: 'Form deleted' })
  } catch (error) {
    next(error)
  }
})

// GET /api/forms/public/:shareId - Get public form (no auth)
formsRouter.get('/public/:shareId', async (req, res, next) => {
  try {
    const form = await prisma.form.findUnique({
      where: { shareId: req.params.shareId },
      include: {
        fields: { orderBy: { order: 'asc' } }
      }
    })

    if (!form || form.status !== 'published') {
      throw new AppError(404, 'Form not found')
    }

    // Increment view count
    await prisma.form.update({
      where: { id: form.id },
      data: { viewCount: { increment: 1 } }
    })

    // Don't expose sensitive data
    const { userId, ...publicForm } = form

    res.json({ form: publicForm })
  } catch (error) {
    next(error)
  }
})

// ============================================================================
// FIELD ROUTES - Nested under forms
// ============================================================================

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

// POST /api/forms/:formId/fields - Create field
formsRouter.post('/:formId/fields', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const formId = req.params.formId as string

    // Verify form ownership
    const form = await prisma.form.findFirst({
      where: { id: formId, userId: req.userId }
    })

    if (!form) {
      throw new AppError(404, 'Form not found')
    }

    const validation = createFieldSchema.safeParse(req.body)
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation error',
        details: validation.error.errors
      })
    }

    const data = validation.data

    const field = await prisma.field.create({
      data: {
        formId,
        ...data
      }
    })

    res.status(201).json({ field })
  } catch (error) {
    next(error)
  }
})

// PUT /api/forms/:formId/fields/:fieldId - Update field
formsRouter.put('/:formId/fields/:fieldId', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const formId = req.params.formId as string
    const fieldId = req.params.fieldId as string

    // Verify form ownership
    const form = await prisma.form.findFirst({
      where: { id: formId, userId: req.userId }
    })

    if (!form) {
      throw new AppError(404, 'Form not found')
    }

    // Verify field belongs to form
    const existingField = await prisma.field.findFirst({
      where: { id: fieldId, formId }
    })

    if (!existingField) {
      throw new AppError(404, 'Field not found')
    }

    const validation = updateFieldSchema.safeParse(req.body)
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation error',
        details: validation.error.errors
      })
    }

    const data = validation.data

    const field = await prisma.field.update({
      where: { id: fieldId },
      data
    })

    res.json({ field })
  } catch (error) {
    next(error)
  }
})

// DELETE /api/forms/:formId/fields/:fieldId - Delete field
formsRouter.delete('/:formId/fields/:fieldId', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const formId = req.params.formId as string
    const fieldId = req.params.fieldId as string

    // Verify form ownership
    const form = await prisma.form.findFirst({
      where: { id: formId, userId: req.userId }
    })

    if (!form) {
      throw new AppError(404, 'Form not found')
    }

    // Verify field belongs to form
    const existingField = await prisma.field.findFirst({
      where: { id: fieldId, formId }
    })

    if (!existingField) {
      throw new AppError(404, 'Field not found')
    }

    await prisma.field.delete({ where: { id: fieldId } })

    res.json({ message: 'Field deleted' })
  } catch (error) {
    next(error)
  }
})

// POST /api/forms/:formId/fields/bulk - Bulk save fields
formsRouter.post('/:formId/fields/bulk', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const formId = req.params.formId as string

    // Verify form ownership
    const form = await prisma.form.findFirst({
      where: { id: formId, userId: req.userId }
    })

    if (!form) {
      throw new AppError(404, 'Form not found')
    }

    const validation = z.array(createFieldSchema).safeParse(req.body.fields)
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation error',
        details: validation.error.errors
      })
    }

    const fieldsData = validation.data

    // Delete existing fields and create new ones (simplest approach)
    await prisma.field.deleteMany({ where: { formId } })

    await prisma.field.createMany({
      data: fieldsData.map(field => ({
        formId,
        ...field
      }))
    })

    // Embed fields in the PDF if pdfUrl exists
    if (form.pdfUrl) {
      try {
        // Extract filename from URL (format: http://baseurl/uploads/pdfs/filename.pdf)
        const urlParts = form.pdfUrl.split('/')
        const filename = urlParts[urlParts.length - 1]
        const pdfPath = path.join(process.cwd(), 'uploads', 'pdfs', filename)

        // Check if PDF file exists
        if (fs.existsSync(pdfPath)) {
          // Read the PDF
          const pdfBuffer = fs.readFileSync(pdfPath)

          // Convert field data to ExtractedField format for embedding
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

          // Embed fields in the PDF
          const modifiedPdfBuffer = await pdfProcessor.embedFieldsInPDF(pdfBuffer, fieldsToEmbed)

          // Save the modified PDF back to disk
          fs.writeFileSync(pdfPath, modifiedPdfBuffer)

          console.log(`✓ Successfully embedded ${fieldsToEmbed.length} fields in PDF: ${filename}`)
        } else {
          console.warn(`PDF file not found at path: ${pdfPath}`)
        }
      } catch (error) {
        console.error('Error embedding fields in PDF:', error)
        // Continue even if PDF embedding fails - fields are already saved in DB
      }
    }

    // Return newly created fields
    const savedFields = await prisma.field.findMany({
      where: { formId },
      orderBy: { order: 'asc' }
    })

    res.json({ fields: savedFields })
  } catch (error) {
    next(error)
  }
})
