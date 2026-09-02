import type { Writable } from 'stream'
import { prisma } from './db.js'

/**
 * The organization data export (features/0030, finding S8).
 *
 * **This is the only module that knows the export format.** The route writes no
 * JSON of its own; it opens the stream, calls `writeOrganizationExport` and
 * handles the failure.
 *
 * ## Why it streams, and what that costs
 *
 * The shape to avoid is `services/csv-exporter.ts`, which takes every response
 * with every answer already loaded and returns one string. At Team's allowance —
 * 25,000 responses a month — that is already a live risk for one form, and this
 * covers every form an organization has. So responses are read a page at a time
 * and each page is written before the next is fetched. Nothing here accumulates
 * the whole set, and `JSON.stringify` is only ever called on one object.
 *
 * The cost is the thing to understand before changing anything below. **Once the
 * first byte is written the response is a `200` and cannot become anything
 * else.** A database failure on page forty produces a truncated file: either
 * unparseable, or — worse — parseable and quietly missing half the customer's
 * responses. A file that looks complete and is not is the failure this product
 * can least afford in an export somebody is about to delete their account
 * behind.
 *
 * That is why the document ends with `"complete": true`, written only after the
 * last page. It is the reader's proof that the writer reached the end. Moving it
 * to the top, where it would be more convenient to emit, removes the only signal
 * that distinguishes a complete file from a truncated one.
 *
 * ## Why every object is built by hand
 *
 * No Prisma row is spread into this document. `GET /api/organizations/responses`
 * gives the reason for its own listing and it applies here with more force: a
 * column added to `Response` for an internal purpose would otherwise leave the
 * building in every customer's export from that deploy onwards, with nobody
 * deciding it should. An export is the worst possible place for that to be
 * automatic.
 */

/** Bumped when the shape changes in a way a reader would notice. */
export const EXPORT_SCHEMA_VERSION = 1

/**
 * How many responses are read and written at a time.
 *
 * Large enough that the query count stays sane on a big organization, small
 * enough that one page plus its answers is an unremarkable amount of memory.
 */
const RESPONSE_PAGE_SIZE = 200

export interface ExportTarget {
  organizationId: string
  userId: string
}

/** `application/json`, and a filename a person can recognise a year later. */
export function exportFilename(slug: string, now = new Date()): string {
  const date = now.toISOString().slice(0, 10)
  return `vuepdf-export-${slug}-${date}.json`
}

function write(out: Writable, chunk: string): void {
  out.write(chunk)
}

/** One value, encoded. The only place `JSON.stringify` is called. */
function json(value: unknown): string {
  return JSON.stringify(value)
}

/**
 * Writes the whole export document to `out`.
 *
 * Throws only if it fails **before** the first byte; after that a failure
 * propagates to the caller, which can no longer change the status code and must
 * destroy the response instead. The absence of the completion marker is what
 * tells the customer their file is short.
 */
export async function writeOrganizationExport(out: Writable, target: ExportTarget): Promise<void> {
  const { organizationId, userId } = target

  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { id: true, name: true, slug: true, planKey: true, createdAt: true }
  })

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    // Explicit, and `passwordHash` is not in it. A `select` that listed columns
    // to omit would include every column added later.
    select: { id: true, email: true, name: true, createdAt: true }
  })

  write(out, '{\n')
  write(out, `  "version": ${EXPORT_SCHEMA_VERSION},\n`)
  write(out, `  "exportedAt": ${json(new Date().toISOString())},\n`)
  write(out, `  "organization": ${json({
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    planKey: organization.planKey,
    createdAt: organization.createdAt.toISOString()
  })},\n`)
  write(out, `  "exportedBy": ${json({
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt.toISOString()
  })},\n`)

  await writeMembers(out, organizationId)
  await writeForms(out, organizationId)
  await writeResponses(out, organizationId)
  await writeUsage(out, organizationId)

  // Last, and only now. See the module comment: this is the whole mechanism.
  write(out, '  "complete": true\n}\n')
}

async function writeMembers(out: Writable, organizationId: string): Promise<void> {
  const memberships = await prisma.membership.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'asc' },
    select: {
      role: true,
      createdAt: true,
      user: { select: { id: true, email: true, name: true } }
    }
  })

  const members = memberships.map(m => ({
    userId: m.user.id,
    email: m.user.email,
    name: m.user.name,
    role: m.role,
    joinedAt: m.createdAt.toISOString()
  }))

  write(out, `  "members": ${json(members)},\n`)
}

async function writeForms(out: Writable, organizationId: string): Promise<void> {
  const forms = await prisma.form.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      createdByUserId: true,
      title: true,
      description: true,
      shareId: true,
      status: true,
      pdfUrl: true,
      settings: true,
      createdAt: true,
      updatedAt: true,
      viewCount: true,
      fields: {
        // **No `deletedAt` filter.** An archived field is the only thing that
        // explains an answer collected before the question was removed, and an
        // export that dropped it would hand the customer values keyed to a
        // field id that appears nowhere in their file.
        orderBy: { order: 'asc' },
        select: {
          id: true,
          type: true,
          name: true,
          label: true,
          required: true,
          position: true,
          options: true,
          validation: true,
          order: true,
          createdAt: true,
          deletedAt: true
        }
      }
    }
  })

  write(out, '  "forms": [')

  forms.forEach((form, index) => {
    const body = {
      id: form.id,
      createdByUserId: form.createdByUserId,
      title: form.title,
      description: form.description,
      shareId: form.shareId,
      status: form.status,
      // The canonical, unsigned URL, exactly as stored. The document itself is
      // not in this file — see features/0030.
      pdfUrl: form.pdfUrl,
      settings: form.settings,
      createdAt: form.createdAt.toISOString(),
      updatedAt: form.updatedAt.toISOString(),
      viewCount: form.viewCount,
      fields: form.fields.map(field => ({
        id: field.id,
        type: field.type,
        name: field.name,
        label: field.label,
        required: field.required,
        position: field.position,
        options: field.options,
        validation: field.validation,
        order: field.order,
        createdAt: field.createdAt.toISOString(),
        archivedAt: field.deletedAt ? field.deletedAt.toISOString() : null
      }))
    }

    write(out, `${index === 0 ? '\n    ' : ',\n    '}${json(body)}`)
  })

  write(out, forms.length === 0 ? '],\n' : '\n  ],\n')
}

/**
 * Every response in the organization, a page at a time.
 *
 * Paged by `id` cursor rather than by offset: an offset re-scans the rows it
 * skips, and on the only table that can hold a million rows here that turns a
 * long export into a quadratic one. It also cannot lose or repeat a row if
 * anything is written while the export runs, which an offset can.
 */
async function writeResponses(out: Writable, organizationId: string): Promise<void> {
  write(out, '  "responses": [')

  let cursor: string | undefined
  let written = 0

  for (;;) {
    const page = await prisma.response.findMany({
      where: { form: { organizationId } },
      orderBy: { id: 'asc' },
      take: RESPONSE_PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        formId: true,
        submittedAt: true,
        ipAddress: true,
        userAgent: true,
        answers: { select: { fieldId: true, value: true } }
      }
    })

    if (page.length === 0) break

    for (const response of page) {
      const body = {
        id: response.id,
        formId: response.formId,
        submittedAt: response.submittedAt.toISOString(),
        // Collected from the respondent, so it is in the file the controller
        // asked for. docs/sot/07-security-and-privacy.md carries what that
        // means for the customer's own obligations.
        ipAddress: response.ipAddress,
        userAgent: response.userAgent,
        answers: response.answers.map(answer => ({
          fieldId: answer.fieldId,
          value: answer.value
        }))
      }

      write(out, `${written === 0 ? '\n    ' : ',\n    '}${json(body)}`)
      written += 1
    }

    if (page.length < RESPONSE_PAGE_SIZE) break
    cursor = page[page.length - 1]!.id
  }

  write(out, written === 0 ? '],\n' : '\n  ],\n')
}

async function writeUsage(out: Writable, organizationId: string): Promise<void> {
  const counters = await prisma.usageCounter.findMany({
    where: { organizationId },
    orderBy: { period: 'asc' },
    select: { period: true, responses: true, updatedAt: true }
  })

  const usage = counters.map(counter => ({
    period: counter.period,
    responses: counter.responses,
    updatedAt: counter.updatedAt.toISOString()
  }))

  write(out, `  "usage": ${json(usage)},\n`)
}
