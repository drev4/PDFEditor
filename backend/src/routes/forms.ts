import { Router } from 'express'
import { z } from 'zod'
import { nanoid } from 'nanoid'
import { prisma } from '../services/db.js'
import { AppError } from '../middleware/errorHandler.js'
import { authenticate, AuthRequest } from '../middleware/auth.js'

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
    const { title, description, pdfUrl } = createFormSchema.parse(req.body)

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

    res.json({ form })
  } catch (error) {
    next(error)
  }
})

// PUT /api/forms/:id - Update form
formsRouter.put('/:id', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const id = req.params.id as string
    const data = updateFormSchema.parse(req.body)

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

    const data = createFieldSchema.parse(req.body)

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

    const data = updateFieldSchema.parse(req.body)

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

    const fieldsData = z.array(createFieldSchema).parse(req.body.fields)

    // Delete existing fields and create new ones (simplest approach)
    await prisma.field.deleteMany({ where: { formId } })

    await prisma.field.createMany({
      data: fieldsData.map(field => ({
        formId,
        ...field
      }))
    })

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
