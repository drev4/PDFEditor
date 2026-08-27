import { Router } from 'express'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
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

// Only the bulk save accepts a client-supplied id: it is how the editor says
// "this is the same field you already gave me an id for". `createFieldSchema`
// must keep rejecting `id`, so the individual POST cannot be told which row to
// be.
const bulkFieldSchema = createFieldSchema.extend({
  id: z.string().uuid().optional()
})

interface EmbeddableField {
  type: ExtractedField['type']
  name: string
  label: string
  required: boolean
  position: unknown
  options: unknown
  validation: unknown
}

async function embedFieldsInPDF(form: { pdfUrl: string | null }, fieldsData: EmbeddableField[]) {
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

    const fieldsToEmbed: ExtractedField[] = fieldsData.map(field => {
      const validation = field.validation as ExtractedField['validation'] | null
      return {
        type: field.type,
        name: field.name,
        label: field.label,
        required: field.required,
        position: field.position as ExtractedField['position'],
        options: (field.options as string[] | null) || undefined,
        validation: validation ? {
          minLength: validation.minLength || undefined,
          maxLength: validation.maxLength || undefined,
          pattern: validation.pattern || undefined
        } : undefined
      }
    })

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
//
// A save is a diff, not a replacement. There is deliberately no branch on
// whether the form has responses: the destructive path is the one that gets
// exercised in development, so there must not be one. Field ids assigned by the
// server survive every save, which is also what lets anything outside the
// database (exports, webhooks, per-question analytics) hold a reference to a
// field.
formFieldsRouter.post('/:formId/fields/bulk', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const formId = req.params.formId as string

    const form = await verifyFormOwnership(req, formId)

    const validation = z.array(bulkFieldSchema).safeParse(req.body.fields)
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation error',
        details: validation.error.errors
      })
    }

    const fieldsData = validation.data

    const liveFields = await prisma.field.findMany({
      where: { formId, deletedAt: null },
      select: { id: true }
    })
    const liveIds = new Set(liveFields.map(f => f.id))

    const payloadIds = fieldsData.flatMap(f => (f.id ? [f.id] : []))

    // An id the client sends that is not a live field of this form means the
    // client is confused. Creating a field instead would hide that bug and
    // silently duplicate the form.
    const unknownIds = payloadIds.filter(id => !liveIds.has(id))
    if (unknownIds.length > 0) {
      return res.status(400).json({
        error: 'Validation error',
        details: { message: 'Unknown field id for this form', fieldIds: unknownIds }
      })
    }

    const duplicateIds = payloadIds.filter((id, i) => payloadIds.indexOf(id) !== i)
    if (duplicateIds.length > 0) {
      return res.status(400).json({
        error: 'Validation error',
        details: { message: 'Duplicate field id in payload', fieldIds: [...new Set(duplicateIds)] }
      })
    }

    const keptIds = new Set(payloadIds)
    // Sorted so two concurrent saves on the same form take the row locks below
    // in the same order and cannot deadlock each other.
    const removedIds = [...liveIds].filter(id => !keptIds.has(id)).sort()

    const archived = await prisma.$transaction(async tx => {
      for (const field of fieldsData) {
        const { id, ...data } = field
        if (id) {
          await tx.field.update({ where: { id }, data })
        } else {
          await tx.field.create({ data: { formId, ...data } })
        }
      }

      if (removedIds.length === 0) return []

      // Lock the rows we are about to remove before asking whether they have
      // answers. Inserting an answer takes a FOR KEY SHARE lock on the field it
      // references, which conflicts with this: a response submitted while we
      // decide either lands first — and we see its answer, and archive the
      // field — or blocks until we commit. Without the lock, a submission that
      // arrives between the count and the delete has its answer cascaded away,
      // which is the whole class of bug this endpoint exists to not have.
      await tx.$queryRaw`
        SELECT id FROM "fields" WHERE id IN (${Prisma.join(removedIds)}) FOR UPDATE
      `

      // A removed field that holds answers is soft-deleted rather than deleted:
      // `Answer.field` is `onDelete: Cascade`, so deleting the row would destroy
      // responses the user never asked to throw away. Soft deletion keeps the
      // historical column and its label in the responses table and the CSV.
      const withAnswers = new Set(
        (await tx.answer.findMany({
          where: { fieldId: { in: removedIds } },
          select: { fieldId: true },
          distinct: ['fieldId']
        })).map(a => a.fieldId)
      )

      const toArchive = removedIds.filter(id => withAnswers.has(id))
      const toDelete = removedIds.filter(id => !withAnswers.has(id))

      if (toDelete.length > 0) {
        await tx.field.deleteMany({ where: { id: { in: toDelete } } })
      }

      if (toArchive.length > 0) {
        await tx.field.updateMany({
          where: { id: { in: toArchive } },
          data: { deletedAt: new Date() }
        })
      }

      return toArchive
    })

    const savedFields = await prisma.field.findMany({
      where: { formId, deletedAt: null },
      orderBy: { order: 'asc' }
    })

    await embedFieldsInPDF(form, savedFields)

    res.json({ fields: savedFields, archived })
  } catch (error) {
    next(error)
  }
})
