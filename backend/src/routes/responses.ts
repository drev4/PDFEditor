import { Router, Request } from 'express'
import { z } from 'zod'
import { prisma } from '../services/db.js'
import { AppError } from '../middleware/errorHandler.js'

export const responsesRouter = Router()

const submitResponseSchema = z.object({
  formId: z.string().uuid(),
  shareId: z.string(),
  answers: z.record(z.string(), z.any()) // { fieldId: value }
})

// POST /api/responses - Submit form response (no auth required)
responsesRouter.post('/', async (req: Request, res, next) => {
  try {
    const validation = submitResponseSchema.safeParse(req.body)
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation error',
        details: validation.error.errors
      })
    }

    const { formId, shareId, answers } = validation.data

    // Verify form exists and is published
    const form = await prisma.form.findFirst({
      where: {
        id: formId,
        shareId
      },
      include: {
        fields: true
      }
    })

    if (!form) {
      throw new AppError(404, 'Form not found or shareId mismatch')
    }

    if (form.status !== 'published') {
      throw new AppError(403, 'Form is not accepting responses')
    }

    // Validate required fields are present
    const requiredFields = form.fields.filter(f => f.required)
    const missingFields: string[] = []

    for (const field of requiredFields) {
      if (!answers[field.id] || answers[field.id] === '') {
        missingFields.push(field.label)
      }
    }

    if (missingFields.length > 0) {
      return res.status(400).json({
        error: 'Validation failed',
        details: {
          message: 'Required fields are missing',
          fields: missingFields
        }
      })
    }

    // Validate field types and values
    const validationErrors: Record<string, string> = {}

    for (const field of form.fields) {
      const value = answers[field.id]

      // Skip validation if field is not filled and not required
      if (!value && !field.required) continue

      // Type-specific validation
      switch (field.type) {
        case 'checkbox':
          if (typeof value !== 'boolean') {
            validationErrors[field.name] = 'Must be a boolean value'
          }
          break

        case 'radio':
        case 'dropdown':
          const options = field.options as string[]
          if (options && !options.includes(value)) {
            validationErrors[field.name] = 'Invalid option selected'
          }
          break

        case 'text':
        case 'textarea':
          if (typeof value !== 'string') {
            validationErrors[field.name] = 'Must be a string value'
          } else {
            const validation = field.validation as any
            if (validation?.minLength && value.length < validation.minLength) {
              validationErrors[field.name] = `Minimum length is ${validation.minLength}`
            }
            if (validation?.maxLength && value.length > validation.maxLength) {
              validationErrors[field.name] = `Maximum length is ${validation.maxLength}`
            }
            if (validation?.pattern) {
              const regex = new RegExp(validation.pattern)
              if (!regex.test(value)) {
                validationErrors[field.name] = 'Invalid format'
              }
            }
          }
          break
      }
    }

    if (Object.keys(validationErrors).length > 0) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validationErrors
      })
    }

    // Get client IP and User-Agent
    const ipAddress = req.ip || req.socket.remoteAddress || null
    const userAgent = req.headers['user-agent'] || null

    // Create response with answers
    const response = await prisma.response.create({
      data: {
        formId,
        ipAddress,
        userAgent,
        answers: {
          create: Object.entries(answers).map(([fieldId, value]) => ({
            fieldId,
            value: typeof value === 'boolean' ? String(value) : value
          }))
        }
      },
      include: {
        answers: true
      }
    })

    res.status(201).json({
      success: true,
      responseId: response.id,
      message: 'Response submitted successfully'
    })
  } catch (error) {
    next(error)
  }
})
