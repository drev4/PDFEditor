import { Router, Request } from 'express'
import { z } from 'zod'
import { prisma } from '../services/db.js'
import { AppError } from '../middleware/errorHandler.js'
import { compilePattern } from '../services/pattern-validator.js'
import { responseRateLimit } from '../middleware/rateLimit.js'
import { assertResponseWithinLimit } from '../services/entitlements.js'
import { queueResponseCreated } from '../services/webhook-queue.js'
import { logger } from '../services/logger.js'

export const responsesRouter = Router()

const submitResponseSchema = z.object({
  formId: z.string().uuid(),
  shareId: z.string(),
  answers: z.record(z.string(), z.any()) // { fieldId: value }
})

// POST /api/responses - Submit form response (no auth required)
responsesRouter.post('/', responseRateLimit, async (req: Request, res, next) => {
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
        // Live fields only: an archived field must never be rendered on the
        // public form, and must never be required for a submission.
        fields: { where: { deletedAt: null } }
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
            // `else if`, deliberately: a value that already failed a length check
            // must not reach the regex. Previously these were independent `if`s,
            // so a 100 kB value was pattern-matched even when maxLength was 5.
            if (validation?.minLength && value.length < validation.minLength) {
              validationErrors[field.name] = `Minimum length is ${validation.minLength}`
            } else if (validation?.maxLength && value.length > validation.maxLength) {
              validationErrors[field.name] = `Maximum length is ${validation.maxLength}`
            } else if (validation?.pattern) {
              // Compiled through the shared helper, never `new RegExp` here: the
              // engine must not backtrack, and an unusable pattern must not throw.
              const regex = compilePattern(validation.pattern)
              if (!regex) {
                logger.warn(
                  `Ignoring unusable pattern on field ${field.id} of form ${formId}: ` +
                  `${JSON.stringify(validation.pattern)}`
                )
              } else if (!regex.test(value)) {
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
    // Filter answers to only include fields that belong to this form
    const formFieldIds = new Set(form.fields.map(f => f.id))
    const validAnswerEntries = Object.entries(answers).filter(([fieldId]) => {
      const isValid = formFieldIds.has(fieldId)
      if (!isValid) logger.warn(`Skipping invalid fieldId in response: ${fieldId}`)
      return isValid
    })

    try {
      // One transaction, so the meter and the response cannot disagree.
      //
      // `assertResponseWithinLimit` increments the month's counter and throws
      // when that increment goes past the plan — which rolls this whole
      // transaction back, leaving neither a response nor an inflated count.
      // Doing it the other way round (check, then write) lets two concurrent
      // submissions both pass at `limit - 1`. Nothing here may catch that
      // throw; it has to reach the transaction boundary.
      const response = await prisma.$transaction(async tx => {
        await assertResponseWithinLimit(tx, form.organizationId)

        return tx.response.create({
          data: {
            formId,
            ipAddress,
            userAgent,
            answers: {
              create: validAnswerEntries.map(([fieldId, value]) => {
                // Ensure value is always a string and not undefined/null
                let stringValue = ''
                if (value === true || value === false) {
                  stringValue = String(value)
                } else if (value !== null && value !== undefined) {
                  stringValue = String(value)
                }

                return {
                  fieldId,
                  value: stringValue
                }
              })
            }
          },
          include: {
            answers: true
          }
        })
      })

      // Webhooks, **after** the transaction commits and never inside it
      // (features/0020). Three properties, all deliberate:
      //
      //   - it cannot fail the submission. The response is saved, which is the
      //     record that matters, and a respondent must not see an error because
      //     a customer's integration is misconfigured. `queueResponseCreated`
      //     swallows and logs everything, like the PDF embed
      //     (docs/sot/04-backend-patterns.md §5);
      //   - it only *queues*. Delivering here would put a third party's server
      //     on the critical path of somebody pressing "submit";
      //   - it is a no-op when nothing is configured, which is every
      //     deployment without `REDIS_URL` and every organization with no
      //     endpoints.
      await queueResponseCreated({
        organizationId: form.organizationId,
        formId,
        responseId: response.id
      })

      res.status(201).json({
        success: true,
        responseId: response.id,
        message: 'Response submitted successfully'
      })
    } catch (prismaError) {
      // A rejected submission is this API answering correctly, not failing.
      // Logging the plan-limit `AppError` here as a "Prisma Error" would print
      // a fault every time a free form fills up — the exact noise
      // `middleware/errorHandler.ts` exists to keep out of the log.
      if (!(prismaError instanceof AppError)) {
        logger.error({ err: prismaError }, 'Prisma Error creating response')
      }
      throw prismaError // Will be caught by errorHandler
    }
  } catch (error) {
    next(error)
  }
})
