import { Router } from 'express'
import { prisma } from '../../services/db.js'
import { AppError } from '../../middleware/errorHandler.js'
import { callerOrganizationId, type ApiKeyRequest } from '../../middleware/apiKeyAuth.js'
import { exportResponsesToCSV } from '../../services/csv-exporter.js'
import { asyncHandler } from '../../middleware/asyncHandler.js'

/**
 * The published read-only API (features/0019).
 *
 * ## Everything here is a promise
 *
 * `/api/v1` is a contract with people outside this repository; `/api/*` is the
 * SPA's private business and may change in any release
 * (docs/sot/06-api-reference.md). The practical rule that keeps the two apart
 * is in every handler below: **responses are built explicitly, never returned
 * as Prisma rows.** `Form.createdByUserId` is provenance, `organizationId` is
 * tenancy, and neither is a customer's business — and if a column added next
 * year would appear here automatically, adding a column becomes a public API
 * change nobody meant to make.
 *
 * ## Tenancy is on every query, and it is a `404`
 *
 * There is no `verifyFormOwnership` here: that resolves a *user*, and this
 * router has an organization instead. Every query carries
 * `organizationId: callerOrganizationId(req)` in its `where` — not a check
 * afterwards — and a form belonging to somebody else is indistinguishable from
 * one that does not exist. Same rule as the rest of the product
 * (docs/sot/04-backend-patterns.md §9), and more important here: an API is a
 * far better place to enumerate ids from than a browser.
 */
export const v1FormsRouter = Router()

/** Pagination that a caller cannot use to ask for the whole table at once. */
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

function pagination(req: ApiKeyRequest): { limit: number; offset: number } {
  const requested = Number.parseInt(String(req.query.limit ?? ''), 10)
  const offset = Number.parseInt(String(req.query.offset ?? ''), 10)

  return {
    limit: Number.isInteger(requested) && requested > 0 ? Math.min(requested, MAX_LIMIT) : DEFAULT_LIMIT,
    offset: Number.isInteger(offset) && offset > 0 ? offset : 0
  }
}

/** The published shape of a form. Anything not listed here is not published. */
function publicForm(form: {
  id: string
  title: string
  description: string | null
  status: string
  shareId: string
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: form.id,
    title: form.title,
    description: form.description,
    status: form.status,
    shareId: form.shareId,
    createdAt: form.createdAt,
    updatedAt: form.updatedAt
  }
}

/** The published shape of a field. `id` is stable across saves (features/0001). */
function publicField(field: {
  id: string
  name: string
  label: string
  type: string
  required: boolean
  order: number
  options: unknown
  deletedAt: Date | null
}) {
  return {
    id: field.id,
    name: field.name,
    label: field.label,
    type: field.type,
    required: field.required,
    order: field.order,
    options: (field.options as string[] | null) ?? undefined,
    // Archived rather than deleted, because its answers survive
    // (docs/sot/03-domain-model.md). An integration needs to know that a field
    // it holds a reference to is no longer collected, which is different from
    // it having vanished.
    archived: field.deletedAt !== null
  }
}

// GET /api/v1/forms
v1FormsRouter.get('/', asyncHandler(async (req: ApiKeyRequest, res, next) => {
  const organizationId = callerOrganizationId(req)
  const { limit, offset } = pagination(req)

  const where = { organizationId }

  const [total, forms] = await Promise.all([
    prisma.form.count({ where }),
    prisma.form.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset
    })
  ])

  res.json({ data: forms.map(publicForm), pagination: { total, limit, offset } })
}))

// GET /api/v1/forms/:id
v1FormsRouter.get('/:id', asyncHandler(async (req: ApiKeyRequest, res, next) => {
  const organizationId = callerOrganizationId(req)

  const form = await prisma.form.findFirst({
    where: { id: req.params.id as string, organizationId },
    include: { fields: { where: { deletedAt: null }, orderBy: { order: 'asc' } } }
  })

  if (!form) throw new AppError(404, 'Form not found')

  res.json({ ...publicForm(form), fields: form.fields.map(publicField) })
}))

/**
 * Answers keyed by **field name**, not by field id.
 *
 * A name is what the author typed and what a spreadsheet column is called, so
 * it is what an integration wants to read. The id is published on the field
 * itself for anyone who needs the stable reference — features/0001 made ids
 * survive every save precisely so an outside system can hold one.
 *
 * An answer whose field was archived keeps appearing, under its historical
 * name: the response happened, and silently dropping part of it because the
 * author later removed the question would be a quiet loss of a customer's data.
 */
function publicResponse(
  response: { id: string; submittedAt: Date; answers: { fieldId: string; value: string }[] },
  fieldNames: Map<string, string>
) {
  const answers: Record<string, string> = {}

  for (const answer of response.answers) {
    const name = fieldNames.get(answer.fieldId)
    if (name) answers[name] = answer.value
  }

  return { id: response.id, submittedAt: response.submittedAt, answers }
}

// GET /api/v1/forms/:id/responses
v1FormsRouter.get('/:id/responses', asyncHandler(async (req: ApiKeyRequest, res, next) => {
  const organizationId = callerOrganizationId(req)
  const formId = req.params.id as string
  const { limit, offset } = pagination(req)

  // The tenancy check and the field lookup in one query: no archived filter,
  // because an archived field still names the answers already collected
  // through it.
  const form = await prisma.form.findFirst({
    where: { id: formId, organizationId },
    include: { fields: { orderBy: { order: 'asc' } } }
  })

  if (!form) throw new AppError(404, 'Form not found')

  const fieldNames = new Map(form.fields.map(field => [field.id, field.name]))

  const [total, responses] = await Promise.all([
    prisma.response.count({ where: { formId } }),
    prisma.response.findMany({
      where: { formId },
      include: { answers: true },
      orderBy: { submittedAt: 'desc' },
      take: limit,
      skip: offset
    })
  ])

  res.json({
    data: responses.map(response => publicResponse(response, fieldNames)),
    pagination: { total, limit, offset }
  })
}))

// GET /api/v1/forms/:id/responses.csv
v1FormsRouter.get('/:id/responses.csv', asyncHandler(async (req: ApiKeyRequest, res, next) => {
  const organizationId = callerOrganizationId(req)
  const formId = req.params.id as string

  const form = await prisma.form.findFirst({
    where: { id: formId, organizationId },
    include: { fields: { orderBy: { order: 'asc' } } }
  })

  if (!form) throw new AppError(404, 'Form not found')

  const responses = await prisma.response.findMany({
    where: { formId },
    include: { answers: true },
    orderBy: { submittedAt: 'desc' }
  })

  // The same exporter the SPA's download uses, so the two files cannot drift
  // apart. Deliberately not paginated: a partial export is a broken export,
  // and this is the endpoint somebody automates a nightly backup with.
  const csv = exportResponsesToCSV(form, responses)

  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="responses-${form.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.csv"`
  )
  res.send(csv)
}))
