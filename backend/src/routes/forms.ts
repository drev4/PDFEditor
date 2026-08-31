import { Router } from 'express'
import { z } from 'zod'
import { nanoid } from 'nanoid'
import { prisma } from '../services/db.js'
import { AppError } from '../middleware/errorHandler.js'
import { authenticate, AuthRequest } from '../middleware/auth.js'
import { verifyFormOwnership, callerCanReachForm } from '../middleware/formOwnership.js'
import { requireOrganizationId } from '../middleware/membership.js'
import { assertCanPublishForm, isOverResponseLimit, mustShowBranding } from '../services/entitlements.js'
import { pdfProcessor } from '../services/pdf-processor.js'
import { exportResponsesToCSV } from '../services/csv-exporter.js'
import { canonicalPdfUrl, pdfFilenameFrom, signPdfUrl } from '../services/pdf-url.js'
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

/**
 * Every form that leaves this API goes through here.
 *
 * `Form.pdfUrl` holds the canonical, unsigned URL — it is written once at upload
 * and read forever after, so a signed value stored there would stop verifying
 * one TTL later. The signature is therefore minted per response, never
 * persisted. Miss one `res.json({ form })` and that screen's PDF 403s while
 * every other screen works.
 *
 * `organizationId` and `createdByUserId` are stripped here rather than at each
 * call site. Nothing in the client uses either, tenancy is decided entirely on
 * the server, and internal ids that no consumer needs are surface a future
 * change has to keep compatible for no benefit. When an organization switcher
 * needs one, add it back deliberately.
 */
function toApiForm<T extends { pdfUrl: string | null }>(form: T): Omit<T, 'organizationId' | 'createdByUserId'> {
  const { organizationId, createdByUserId, ...rest } = form as T & {
    organizationId?: string
    createdByUserId?: string | null
  }
  return { ...rest, pdfUrl: signPdfUrl(form.pdfUrl) } as Omit<T, 'organizationId' | 'createdByUserId'>
}

/**
 * The response and field counts every form response carries.
 *
 * Shared rather than repeated because it was not, and the routes drifted: only
 * the list included `_count`, so publishing a form from the share dialog — a
 * PATCH whose response replaced the row in the store — wiped the counts and the
 * dialog reported 0 responses for a form that had hundreds. A client should not
 * have to know which endpoint returns a whole form and which returns a partial
 * one.
 */
const formCounts = {
  _count: {
    select: {
      // Archived fields are gone from the editor; they must not inflate
      // the field count shown on the dashboard.
      fields: { where: { deletedAt: null } },
      responses: true
    }
  }
} as const

// GET /api/forms - List user's forms
formsRouter.get('/', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const forms = await prisma.form.findMany({
      where: callerCanReachForm(req),
      orderBy: { createdAt: 'desc' },
      include: formCounts
    })

    res.json({ forms: forms.map(toApiForm) })
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
        organizationId: await requireOrganizationId(req),
        // Provenance only. Authorization reads the organization, never this.
        createdByUserId: req.userId!,
        title,
        description,
        // Only ever the canonical unsigned URL reaches the column. A client that
        // echoes back a `pdfUrl` it read from this API would otherwise persist a
        // signature, and the form would break one TTL later.
        pdfUrl: pdfUrl === undefined ? undefined : canonicalPdfUrl(pdfUrl),
        shareId: nanoid(12)
      }
    })

    res.status(201).json({ form: toApiForm(form) })
  } catch (error) {
    next(error)
  }
})

async function syncFieldsFromPDF(formId: string, pdfUrl: string) {
  const filename = pdfFilenameFrom(pdfUrl)
  if (!filename) return null

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
      where: { id, ...callerCanReachForm(req) },
      include: {
        fields: { where: { deletedAt: null }, orderBy: { order: 'asc' } },
        ...formCounts
      }
    })

    if (!form) {
      throw new AppError(404, 'Form not found')
    }

    // A form whose only fields are archived has been edited down to nothing on
    // purpose. Re-extracting from the PDF would resurrect them as new rows next
    // to the archived ones, so the guard counts archived fields too.
    const everHadFields = form.fields.length > 0
      || (await prisma.field.count({ where: { formId: id } })) > 0

    if (form.pdfUrl && !everHadFields) {
      try {
        await syncFieldsFromPDF(id, form.pdfUrl)
        const updatedForm = await prisma.form.findFirst({
          where: { id },
          include: { fields: { where: { deletedAt: null }, orderBy: { order: 'asc' } } }
        })
        return res.json({ form: updatedForm ? toApiForm(updatedForm) : updatedForm })
      } catch (error) {
        console.error('Error syncing fields from PDF:', error)
      }
    }

    res.json({ form: toApiForm(form) })
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

    // See the note in POST /: the column holds canonical URLs only.
    if (data.pdfUrl !== undefined) {
      data.pdfUrl = canonicalPdfUrl(data.pdfUrl) ?? undefined
    }

    const existing = await verifyFormOwnership(req, id)

    // Publishing is what the plan meters, not creating — see
    // `services/entitlements.ts`. This route can publish too, because
    // `updateFormSchema` accepts `status`; gating only PATCH /:id/status would
    // leave the limit reachable through the back door.
    if (data.status === 'published') {
      await assertCanPublishForm(existing.organizationId, id)
    }

    const form = await prisma.form.update({
      where: { id },
      data: data as any,
      include: formCounts
    })

    res.json({ form: toApiForm(form) })
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

    const existing = await verifyFormOwnership(req, id)

    if (status === 'published') {
      await assertCanPublishForm(existing.organizationId, id)
    }

    const form = await prisma.form.update({
      where: { id },
      data: { status },
      include: formCounts
    })

    res.json({ form: toApiForm(form) })
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
      include: { fields: { where: { deletedAt: null }, orderBy: { order: 'asc' } } }
    })

    if (!form || form.status !== 'published') {
      throw new AppError(404, 'Form not found')
    }

    // An organization that has spent the month's responses cannot accept this
    // one, so the form must be unavailable *before* anybody fills it in —
    // enforcing the limit only at submit time means the respondent types
    // everything and then loses it.
    //
    // The same `404` a closed form gets, and deliberately not a `402`: the
    // person reading this is a respondent, not the customer. A `402` would be
    // meaningless to them and would publish the customer's billing state to
    // anyone holding the share link.
    if (await isOverResponseLimit(form.organizationId)) {
      throw new AppError(404, 'Form not found')
    }

    await prisma.form.update({
      where: { id: form.id },
      data: { viewCount: { increment: 1 } }
    })

    // `toApiForm` strips the owning organization and the creator from every
    // response, so nothing extra is needed here for the anonymous case.
    //
    // `showBranding` is the ONLY thing about the owner's plan that may appear
    // in this payload, and it is one boolean on purpose (features/0014). The
    // tempting version — sending the plan, or the entitlements object, and
    // letting the client decide — would publish the customer's billing state to
    // anyone holding a share link, which is the exact rule the rest of this
    // handler enforces: the response limit answers `404` rather than `402`
    // precisely so a respondent learns nothing about how the owner pays.
    //
    // It does reveal paid-versus-not, which is unavoidable: the mark is visible.
    // It reveals no plan name, no limit, no usage and no organization.
    res.json({
      form: toApiForm(form),
      showBranding: await mustShowBranding(form.organizationId)
    })
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

    // Archived fields are included deliberately: their answers are still in
    // these responses and would otherwise render as an unlabelled column.
    const fields = await prisma.field.findMany({
      where: { formId: id },
      orderBy: { order: 'asc' }
    })

    res.json({
      responses,
      fields,
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

    // No `deletedAt` filter, on purpose: an archived field keeps its column and
    // its original label in the export, so historical rows stay readable.
    const form = await prisma.form.findFirst({
      where: { id, ...callerCanReachForm(req) },
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
