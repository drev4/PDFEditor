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
    const form = await prisma.form.findFirst({
      where: {
        id: req.params.id,
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
    const data = updateFormSchema.parse(req.body)

    const existingForm = await prisma.form.findFirst({
      where: { id: req.params.id, userId: req.userId }
    })

    if (!existingForm) {
      throw new AppError(404, 'Form not found')
    }

    const form = await prisma.form.update({
      where: { id: req.params.id },
      data
    })

    res.json({ form })
  } catch (error) {
    next(error)
  }
})

// DELETE /api/forms/:id - Delete form
formsRouter.delete('/:id', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const existingForm = await prisma.form.findFirst({
      where: { id: req.params.id, userId: req.userId }
    })

    if (!existingForm) {
      throw new AppError(404, 'Form not found')
    }

    await prisma.form.delete({ where: { id: req.params.id } })

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
