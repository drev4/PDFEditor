import { Router } from 'express'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '../services/db.js'
import { authenticate, AuthRequest } from '../middleware/auth.js'
import { verifyFormOwnership, verifyFieldOwnership } from '../middleware/formOwnership.js'
import { checkPattern } from '../services/pattern-validator.js'
import { requestEmbed } from '../services/embed-queue.js'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { AppError } from '../middleware/errorHandler.js'

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
    // A pattern is compiled and run against anonymous input on the public
    // endpoint, so it is checked here rather than at submission time - the author
    // finds out now, not when respondents start failing. See
    // services/pattern-validator.ts.
    pattern: z.string().optional().superRefine((value, ctx) => {
      if (value === undefined) return
      const check = checkPattern(value)
      if (!check.ok) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: check.reason })
      }
    })
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

// What a multi-field deletion accepts (features/0050).
//
// The cap is not ceremony: every id in here becomes a row lock held until the
// transaction commits, and an unbounded list is an unbounded lock. Two hundred
// is far above any real selection on one page and far below anything that would
// hold the table.
const deleteFieldsSchema = z.object({
  fieldIds: z.array(z.string().uuid()).min(1).max(200)
})

const checkPatternSchema = z.object({
  pattern: z.string()
})

// POST /api/forms/fields/check-pattern
//
// Whether a pattern may be stored, asked before anything is saved
// (features/0036). The editor needs an answer while an author is typing, and
// **only this side can give it**: RE2 rejects lookahead, lookbehind and
// backreferences that JavaScript accepts, and accepts `(?P<n>a)` that
// JavaScript rejects, so reimplementing the rules in the browser would be a
// second source of truth about which patterns are legal — the thing
// `services/pattern-validator.ts` exists to prevent.
//
// It earns its own route rather than letting the author find out on save,
// because `pattern` is validated inside `createFieldSchema` below: an invalid
// one fails the **whole** bulk save and takes every other unsaved edit on the
// form with it. A pattern is invalid for most of the time somebody is typing
// one, so that is not an edge case.
//
// **Declared above the `/:formId` routes on purpose.** Both this router and
// `formsRouter` mount on `/api/forms`, and a static path underneath a family of
// parameterised ones is exactly where shadowing happens; `tests/fields.spec.ts`
// asserts it is still reached.
//
// `authenticate` and nothing else — every neighbouring route also resolves a
// membership, and this one has no form and no row to own. It reads no database
// and **compiles** a pattern without ever executing it against input, so its
// cost is bounded by `MAX_PATTERN_LENGTH` and it needs no rate limiter of its
// own beyond being authenticated at all.
formFieldsRouter.post('/fields/check-pattern', authenticate, asyncHandler(async (req: AuthRequest, res, next) => {
  const validation = checkPatternSchema.safeParse(req.body)
  if (!validation.success) {
    return res.status(400).json({ error: 'Validation error', details: validation.error.errors })
  }

  const check = checkPattern(validation.data.pattern)

  // 200 either way: "this pattern is not storable" is the answer to the
  // question, not a failure to answer it. A 400 here would be indistinguishable
  // from a malformed request.
  return res.json(check.ok ? { ok: true } : { ok: false, reason: check.reason })
}))

// POST /api/forms/:formId/fields - Create field
formFieldsRouter.post('/:formId/fields', authenticate, asyncHandler(async (req: AuthRequest, res, next) => {
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

  // Every write that changes the live field set rewrites the stored PDF, not
  // just the bulk save (features/0049). Placement is the bulk save's: after the
  // write, awaited, best-effort — `requestEmbed` decides where the work runs
  // and swallows or retries its own failures, so nothing below depends on it.
  await requestEmbed(formId, { allowEmpty: true })

  res.status(201).json({ field })
}))

// GET /api/forms/:formId/fields/archived - List the archived fields of a form
//
// The other half of soft deletion (features/0045). Archiving worked and was
// tested; *seeing* it did not exist — the only signal a field had been archived
// was a toast that appeared once and expired after eight seconds, and after
// that the field was in no screen at all.
//
// **Declared above the `/:formId/fields/:fieldId` routes on purpose**, for the
// same reason `POST /fields/check-pattern` is declared above everything: a
// static segment underneath a family of parameterised ones is exactly where
// shadowing happens. There is no `GET /:formId/fields/:fieldId` today to
// collide with, and this ordering is what keeps that true the day somebody adds
// one. `tests/fields.spec.ts` asserts this route is still reached.
//
// `answerCount` comes from the server because the client cannot compute it: the
// responses screen holds one page of submissions, and the number that makes
// this list mean anything is how many answers each archived field is keeping in
// total.
formFieldsRouter.get('/:formId/fields/archived', authenticate, asyncHandler(async (req: AuthRequest, res, next) => {
  const formId = req.params.formId as string

  await verifyFormOwnership(req, formId)

  const fields = await prisma.field.findMany({
    where: { formId, deletedAt: { not: null } },
    include: { _count: { select: { answers: true } } },
    orderBy: { deletedAt: 'desc' }
  })

  res.json({
    fields: fields.map(({ _count, ...field }) => ({ ...field, answerCount: _count.answers }))
  })
}))

// POST /api/forms/:formId/fields/:fieldId/restore - Un-archive a field
//
// Without this, the only way to bring back an archived question is to place a
// new field, which gets a **new id**. The old answers stay attached to the old
// id, so the CSV grows two columns for one question and nothing can ever join
// them. Stable field ids are the work of features/0001; this is what makes them
// recoverable when somebody removes a field by mistake.
//
// It deliberately does **not** go through `verifyFieldOwnership`, and that
// helper must not grow an `includeArchived` flag: it is the single thing
// guaranteeing the individual `PUT` and `DELETE` cannot reach an archived
// field, and an optional parameter living inside that guarantee is what someone
// eventually passes `true` for convenience.
//
// **No transaction and no `SELECT … FOR UPDATE` here, unlike the `DELETE`
// above.** That lock exists because deleting *counts* answers and then destroys
// rows, so a submission arriving between the two would lose its answer.
// Restoring counts nothing and destroys nothing: the worst a concurrent
// submission can do is land on a field that becomes live a moment later, which
// is the outcome either ordering produces.
//
// It does call `requestEmbed`, like every other write that changes the live
// field set (features/0049). It did not until that feature, and neither did the
// individual create, update or delete: the stored PDF's AcroForm lagged behind
// the database until somebody happened to run a bulk save.
formFieldsRouter.post('/:formId/fields/:fieldId/restore', authenticate, asyncHandler(async (req: AuthRequest, res, next) => {
  const formId = req.params.formId as string
  const fieldId = req.params.fieldId as string

  await verifyFormOwnership(req, formId)

  const archivedField = await prisma.field.findFirst({
    where: { id: fieldId, formId, deletedAt: { not: null } }
  })

  // A live field is a 404 here, the mirror of an archived field being a 404 to
  // `PUT` and `DELETE`: each route can only reach the fields it is about.
  if (!archivedField) {
    throw new AppError(404, 'Archived field not found')
  }

  const field = await prisma.field.update({
    where: { id: fieldId },
    data: { deletedAt: null }
  })

  // The restored field goes back into the document too (features/0049). Until
  // it did, the editor's toast had to tell the author to save the form before
  // the question was really back — which was true, and was the bug.
  await requestEmbed(formId, { allowEmpty: true })

  res.json({ field })
}))

// POST /api/forms/:formId/fields/delete - Remove several fields at once
//
// The gesture behind it is a marquee selection and one press of Delete
// (features/0050). It exists rather than the client looping over the individual
// `DELETE` for one reason that only became true with features/0049: **every
// field write re-embeds the document**, so thirty deletions would be thirty
// read-modify-writes of the same PDF, serialised one behind another by the
// per-form lock while the author waits. Here it is one transaction and one
// embed.
//
// **Declared above the `/:formId/fields/:fieldId` routes on purpose**, the same
// rule `POST /fields/check-pattern` and `GET /fields/archived` follow: a static
// segment underneath a family of parameterised ones is where shadowing happens.
//
// The rule per field is features/0044's, unchanged and deliberately not
// simplified: a field holding answers is archived, a field holding none is
// really deleted. What changes is that the caller gets **one** answer for the
// whole set, so the editor can say "4 removed, 2 archived, 37 responses kept"
// instead of narrating six requests.
formFieldsRouter.post('/:formId/fields/delete', authenticate, asyncHandler(async (req: AuthRequest, res, next) => {
  const formId = req.params.formId as string

  await verifyFormOwnership(req, formId)

  const validation = deleteFieldsSchema.safeParse(req.body)
  if (!validation.success) {
    return res.status(400).json({
      error: 'Validation error',
      details: validation.error.errors
    })
  }

  const requestedIds = [...new Set(validation.data.fieldIds)]

  const liveIds = new Set(
    (await prisma.field.findMany({
      where: { formId, deletedAt: null },
      select: { id: true }
    })).map(f => f.id)
  )

  // An id that is not a live field of this form fails the **whole** request,
  // exactly as it does in the bulk save. Skipping it quietly would let a
  // confused client believe it had deleted something that is still on the form,
  // and an already-archived field is not something this route may reach.
  const unknownIds = requestedIds.filter(id => !liveIds.has(id))
  if (unknownIds.length > 0) {
    return res.status(400).json({
      error: 'Validation error',
      details: { message: 'Unknown field id for this form', fieldIds: unknownIds }
    })
  }

  // Sorted so two concurrent requests over overlapping sets take the row locks
  // in the same order and cannot deadlock each other - the bulk save sorts for
  // the same reason.
  const targetIds = [...requestedIds].sort()

  const { archived, deleted } = await prisma.$transaction(async tx => {
    // The lock goes **before** the count, and taking it afterwards restores the
    // race in full. Inserting an `Answer` takes `FOR KEY SHARE` on the field it
    // references, which conflicts with this: a submission arriving while we
    // decide either lands first - and we see its answer, and archive - or waits
    // until we commit and then fails its foreign key. Counting first leaves the
    // window where a response is accepted with a 201 and its answer is cascaded
    // away a moment later.
    await tx.$queryRaw`
      SELECT id FROM "fields" WHERE id IN (${Prisma.join(targetIds)}) FOR UPDATE
    `

    // One query for the whole set rather than one per field: the counts are
    // what the editor reports back to the author, so they have to come from
    // inside this transaction, after the lock.
    const counts = await tx.answer.groupBy({
      by: ['fieldId'],
      where: { fieldId: { in: targetIds } },
      _count: { _all: true }
    })

    const answerCounts = new Map(counts.map(row => [row.fieldId, row._count._all]))

    const toArchive = targetIds.filter(id => (answerCounts.get(id) ?? 0) > 0)
    const toDelete = targetIds.filter(id => (answerCounts.get(id) ?? 0) === 0)

    if (toDelete.length > 0) {
      await tx.field.deleteMany({ where: { id: { in: toDelete } } })
    }

    if (toArchive.length > 0) {
      await tx.field.updateMany({
        where: { id: { in: toArchive } },
        data: { deletedAt: new Date() }
      })
    }

    return {
      archived: toArchive.map(id => ({ id, answerCount: answerCounts.get(id) ?? 0 })),
      deleted: toDelete
    }
  })

  // After the commit, never inside it (features/0049).
  await requestEmbed(formId, { allowEmpty: true })

  res.json({ archived, deleted })
}))

// PUT /api/forms/:formId/fields/:fieldId - Update field
formFieldsRouter.put('/:formId/fields/:fieldId', authenticate, asyncHandler(async (req: AuthRequest, res, next) => {
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

  // A rename, a retype or a move changes what the AcroForm must say as surely
  // as a create does (features/0049).
  await requestEmbed(formId, { allowEmpty: true })

  res.json({ field })
}))

// DELETE /api/forms/:formId/fields/:fieldId - Delete or archive a field
//
// This used to be a bare `prisma.field.delete`. `Answer.field` is
// `onDelete: Cascade`, so that one line destroyed every answer the field had
// ever collected, in every past response, without counting them or saying so.
// features/0001 left it that way deliberately — the cascade was "an explicit
// act by the user rather than a side effect of saving" — and said to revisit it
// "once soft delete exists". It exists, and the explicitness did not: the
// editor's confirmation never mentioned responses at all.
//
// The rule is now the bulk save's rule, and it is the same rule for the same
// reason: a field holding answers is archived, a field holding none is really
// deleted. Archiving both would leave a permanent row for every field placed
// and discarded while designing a form (features/0044).
formFieldsRouter.delete('/:formId/fields/:fieldId', authenticate, asyncHandler(async (req: AuthRequest, res, next) => {
  const formId = req.params.formId as string
  const fieldId = req.params.fieldId as string

  // Also the 404 for an already-archived field: `verifyFieldOwnership` filters
  // on `deletedAt: null`, so this endpoint cannot reach one the editor cannot
  // see.
  await verifyFieldOwnership(req, formId, fieldId)

  const { archived, answerCount } = await prisma.$transaction(async tx => {
    // The lock goes **before** the count, exactly as in the bulk save above,
    // and taking it afterwards restores the race in full. Inserting an `Answer`
    // takes `FOR KEY SHARE` on the field it references, which conflicts with
    // this: a submission arriving while we decide either lands first — and we
    // see its answer, and archive — or waits until we commit and then fails its
    // foreign key. Counting first leaves the window where a response is
    // accepted with a 201 and its answer is cascaded away a moment later.
    await tx.$queryRaw`SELECT id FROM "fields" WHERE id = ${fieldId} FOR UPDATE`

    const answerCount = await tx.answer.count({ where: { fieldId } })

    if (answerCount > 0) {
      await tx.field.update({ where: { id: fieldId }, data: { deletedAt: new Date() } })
      return { archived: true, answerCount }
    }

    await tx.field.delete({ where: { id: fieldId } })
    return { archived: false, answerCount }
  })

  // **Outside the transaction, and that is not a style choice**
  // (features/0049). `embedFormFields` re-reads the fields through the global
  // `prisma` client, which cannot see an uncommitted transaction — called
  // inside, it would embed the field set this request just removed and leave
  // the document describing exactly the state the author deleted.
  await requestEmbed(formId, { allowEmpty: true })

  // The caller is told which of the two happened and how many responses were at
  // stake, because the editor cannot know either before asking: the form is
  // published and can take a submission while the author reads the dialog.
  res.json({
    message: archived ? 'Field archived' : 'Field deleted',
    archived,
    answerCount
  })
}))

// POST /api/forms/:formId/fields/bulk - Bulk save fields
//
// A save is a diff, not a replacement. There is deliberately no branch on
// whether the form has responses: the destructive path is the one that gets
// exercised in development, so there must not be one. Field ids assigned by the
// server survive every save, which is also what lets anything outside the
// database (exports, webhooks, per-question analytics) hold a reference to a
// field.
formFieldsRouter.post('/:formId/fields/bulk', authenticate, asyncHandler(async (req: AuthRequest, res, next) => {
  const formId = req.params.formId as string

  await verifyFormOwnership(req, formId)

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

  // Rewriting the stored PDF so its AcroForm matches these fields. Where it
  // runs is `services/embed-queue.ts`'s decision, not this handler's: queued
  // when `REDIS_URL` is set, inline and locked when it is not (features/0017).
  // Either way it is best-effort and the response does not depend on it - the
  // fields are already committed, which is the record that matters.
  await requestEmbed(formId, { allowEmpty: true })

  res.json({ fields: savedFields, archived })
}))
