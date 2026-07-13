import { Router } from 'express'
import { z } from 'zod'
import { nanoid } from 'nanoid'
import { prisma } from '../services/db.js'
import { AppError } from '../middleware/errorHandler.js'
import { authenticate, AuthRequest } from '../middleware/auth.js'
import { verifyFormOwnership } from '../middleware/formOwnership.js'
import { pdfProcessor } from '../services/pdf-processor.js'
import { exportResponsesToCSV } from '../services/csv-exporter.js'
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

async function syncFieldsFromPDF(formId: string, pdfUrl: string) {
  const urlParts = pdfUrl.split('/')
  const filename = urlParts[urlParts.length - 1]
  const pdfPath = path.join(process.cwd(), 'uploads', 'pdfs', filename)

  if (!fs.existsSync(pdfPath)) return null

  const pdfBuffer = fs.readFileSync(pdfPath)
  const extractedFields = await pdfProcessor.extractFieldsFromPDF(pdfBuffer)

  if (extractedFields.length === 0) return null

  console.log(`Found ${extractedFields.length} fields in PDF, syncing to database...`)

  await prisma.field.createMany({
    data: extractedFields.map((field, index) => ({
      formId,
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

  console.log(`✓ Successfully synced ${extractedFields.length} fields from PDF to database`)
  return extractedFields.length
}

// GET /api/forms/:id - Get form by ID
formsRouter.get('/:id', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const id = req.params.id as string

    const form = await prisma.form.findFirst({
      where: { id, userId: req.userId },
      include: { fields: { orderBy: { order: 'asc' } } }
    })

    if (!form) {
      throw new AppError(404, 'Form not found')
    }

    if (form.pdfUrl && form.fields.length === 0) {
      try {
        await syncFieldsFromPDF(id, form.pdfUrl)
        const updatedForm = await prisma.form.findFirst({
          where: { id },
          include: { fields: { orderBy: { order: 'asc' } } }
        })
        return res.json({ form: updatedForm })
      } catch (error) {
        console.error('Error syncing fields from PDF:', error)
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

    await verifyFormOwnership(req, id)

    const form = await prisma.form.update({ where: { id }, data: data as any })

    res.json({ form })
  } catch (error) {
    next(error)
  }
})

// PATCH /api/forms/:id/status - Update form status
formsRouter.patch('/:id/status', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const id = req.params.id as string
    const { status } = req.body

    if (!['draft', 'published', 'closed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' })
    }

    await verifyFormOwnership(req, id)

    const form = await prisma.form.update({ where: { id }, data: { status } })

    res.json({ form })
  } catch (error) {
    next(error)
  }
})

// DELETE /api/forms/:id - Delete form
formsRouter.delete('/:id', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const id = req.params.id as string

    await verifyFormOwnership(req, id)

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
      include: { fields: { orderBy: { order: 'asc' } } }
    })

    if (!form || form.status !== 'published') {
      throw new AppError(404, 'Form not found')
    }

    await prisma.form.update({
      where: { id: form.id },
      data: { viewCount: { increment: 1 } }
    })

    const { userId, ...publicForm } = form

    res.json({ form: publicForm })
  } catch (error) {
    next(error)
  }
})

// GET /api/forms/:id/responses - Get responses for a form
formsRouter.get('/:id/responses', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const id = req.params.id as string
    const limit = parseInt(req.query.limit as string) || 20
    const offset = parseInt(req.query.offset as string) || 0

    await verifyFormOwnership(req, id)

    const totalCount = await prisma.response.count({ where: { formId: id } })

    const responses = await prisma.response.findMany({
      where: { formId: id },
      include: { answers: true },
      orderBy: { submittedAt: 'desc' },
      take: limit,
      skip: offset
    })

    res.json({
      responses,
      pagination: { total: totalCount, limit, offset }
    })
  } catch (error) {
    next(error)
  }
})

// GET /api/forms/:id/responses/export - Export responses as CSV
formsRouter.get('/:id/responses/export', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const id = req.params.id as string

    const form = await prisma.form.findFirst({
      where: { id, userId: req.userId },
      include: { fields: { orderBy: { order: 'asc' } } }
    })

    if (!form) {
      throw new AppError(404, 'Form not found')
    }

    const responses = await prisma.response.findMany({
      where: { formId: id },
      include: { answers: true },
      orderBy: { submittedAt: 'desc' }
    })

    const csvContent = exportResponsesToCSV(form, responses)

    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="responses-${form.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.csv"`)
    res.send(csvContent)
  } catch (error) {
    next(error)
  }
})
