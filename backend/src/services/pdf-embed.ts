import { prisma } from './db.js'
import { pdfProcessor, type ExtractedField } from './pdf-processor.js'
import { pdfFilenameFrom } from './pdf-url.js'
import { pdfStorage } from './pdf-storage.js'
import { withOrganizationLock } from './organization-lock.js'
import { logger } from './logger.js'

/**
 * Rewriting a form's stored PDF so its AcroForm matches the form's fields
 * (features/0017).
 *
 * This used to live inside `routes/form-fields.ts`. It moved here because it
 * now has a second caller that is not a request: the queue worker
 * (`src/worker.ts`) runs the exact same function in another process, and
 * duplicating it there is how two copies start disagreeing about what a PDF is.
 *
 * **Everything this module needs, it reads for itself from `formId`.** No
 * *data* is passed in — see `embedFormFields` below for why that is
 * load-bearing rather than a style choice. The one thing a caller may add is
 * intent, and there is exactly one piece of it (`EmbedOptions.allowEmpty`,
 * features/0049), because it is the one question the database cannot answer
 * about itself.
 */

/**
 * What a caller may say about an embed, beyond which form it is for.
 *
 * Deliberately not a field list — `embedFormFields` re-reads those itself, and
 * the reason is in its own comment. This is intent, not data, so it survives
 * the trip through the queue without going stale.
 */
export interface EmbedOptions {
  /**
   * Whether an empty field set means "this form has no fields" rather than
   * "nobody has read this document yet". See the guard in `embedFormFields`.
   */
  allowEmpty?: boolean
}

/**
 * The read-modify-write itself: reads the form's live fields, embeds them into
 * the stored PDF, writes it back.
 *
 * **It re-reads the fields every time it runs**, and callers must not hand it a
 * field list they already read (features/0016, trap 2). Taking the caller's
 * `savedFields` moves the race rather than closing it: whichever writer is
 * serialised second would still embed whatever it read *before* it waited, so
 * the document settles on a stale field set even though the writes themselves
 * were correctly ordered. Reading here, after the wait, is what makes the PDF
 * converge on the database.
 *
 * The same property is what makes it **idempotent**, which the queue relies on:
 * a retried job re-reads and rewrites from the current truth, so running it
 * twice leaves the same document.
 *
 * Unlike the old route-level helper this **throws**. A queued job that failed
 * must be allowed to fail so the queue can retry it; the callers below are the
 * ones that decide whether an error is fatal (it never is — see `embedInline`).
 *
 * `allowEmpty` is the one thing a caller does say, and only because the database
 * cannot say it — see the guard below.
 */
export async function embedFormFields(
  formId: string,
  { allowEmpty = false }: EmbedOptions = {}
): Promise<void> {
  const form = await prisma.form.findUnique({
    where: { id: formId },
    select: { pdfUrl: true }
  })

  // A form deleted between the save and the job is not an error. Neither is a
  // form with no PDF: there is nothing to embed into.
  if (!form?.pdfUrl) return

  const filename = pdfFilenameFrom(form.pdfUrl)
  if (!filename) return

  const fieldsData = await prisma.field.findMany({
    where: { formId, deletedAt: null },
    orderBy: { order: 'asc' }
  })

  // **An empty field set only flattens the document when the caller says it is
  // an answer** (features/0049), and this is what makes it safe for
  // `embedFieldsInPDF` to treat its list as the whole AcroForm.
  //
  // Zero live fields means two completely different things, and the database
  // cannot tell them apart:
  //
  //  - *The author removed them.* The document should lose them too.
  //  - *Nobody has read the document yet.* Extraction runs on upload and, for a
  //    form that has never had fields, on the first `GET /api/forms/:id`
  //    (`syncFieldsFromPDF`). Until then the **document** is the source of truth
  //    and the database simply does not know. Flattening it here would strip the
  //    AcroForm the author uploaded, and the sync that was about to read it
  //    would find nothing — every field they had drawn, gone, with a 200 and no
  //    error anywhere.
  //
  // Only the caller knows which one it is, so only the caller may say. The
  // routes in `routes/form-fields.ts` are writes *about the field set*, so their
  // empty list is an answer; `PUT /api/forms/:id` repoints a form at a document
  // and says nothing about fields, so its empty list is silence.
  if (fieldsData.length === 0 && !allowEmpty) return

  if (!(await pdfStorage().exists(filename))) {
    logger.warn(`PDF not found in storage: ${filename}`)
    return
  }

  const pdfBuffer = await pdfStorage().get(filename)

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
  await pdfStorage().put(filename, modifiedPdfBuffer)

  logger.info(`✓ Successfully embedded ${fieldsToEmbed.length} fields in PDF: ${filename}`)
}

/**
 * The embed as it has always run: inside the request, serialised per form by
 * the in-process lock, swallowing its errors.
 *
 * This is the path taken when `REDIS_URL` is unset — the default, and what
 * every test suite runs (features/0017, trap 3). The lock is still doing real
 * work here, so it stays; on the *queued* path it is gone, because there the
 * queue is the serialiser and a lock that only serialises the enqueue
 * serialises nothing.
 *
 * The lock is `services/organization-lock.ts`, keyed by form rather than by
 * organization — a general in-process queue whose first caller happened to be
 * billing. Read its own comment on what it does not cover: one Node process,
 * not a fleet. The cross-replica case is what the queue closes.
 *
 * Errors are swallowed on purpose and that has not changed: the fields are
 * already committed, which is the record that matters, and the embedded
 * AcroForm is a convenience for whoever downloads the PDF itself
 * (docs/sot/04-backend-patterns.md §5).
 */
export async function embedInline(formId: string, options: EmbedOptions = {}): Promise<void> {
  try {
    await withOrganizationLock(`form-embed:${formId}`, () => embedFormFields(formId, options))
  } catch (error) {
    logger.error({ err: error }, 'Error embedding fields in PDF')
  }
}
