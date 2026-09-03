import { prisma } from './db.js'
import { AppError } from '../middleware/errorHandler.js'
import { canonicalPdfUrl, pdfFilenameFrom } from './pdf-url.js'

/**
 * The one place that decides whether an organization may point a form at a
 * stored document (features/0039).
 *
 * `services/pdf-url.ts` stays the only parser of a `pdfUrl` — it is deliberately
 * pure and knows nothing about the database — and this module is the only
 * ownership check. Nothing else may ask the question, and nothing here may
 * split a URL on `/`.
 *
 * ## Why the rejection says nothing
 *
 * A key that belongs to another organization and a key that does not exist get
 * the **same** `400` with the same message. Two different answers would be an
 * enumeration oracle: a caller could learn which filenames are real without ever
 * reading one, which is most of what the attack needed in the first place.
 *
 * It is `400` rather than the `404` this codebase uses for a cross-tenant read
 * (features/0009), and the distinction is not cosmetic. That convention is about
 * *addressing a resource you may not reach*; here the resource being addressed
 * is a form the caller genuinely owns, and what is wrong is a field inside the
 * body. `404` would also be a lie about the form.
 */

/** What the customer is told, whatever the reason. */
const REJECTION = 'pdfUrl must reference a PDF uploaded by your organization'

/**
 * The canonical URL for `pdfUrl`, provided `organizationId` uploaded it.
 *
 * Throws `AppError(400)` when the value is not a filename this API could have
 * issued, or names no upload belonging to this organization.
 *
 * **An upload is not consumed by being used.** The row stays usable for as long
 * as the organization exists, because repointing a form at a document it
 * already used is ordinary, and two forms in one organization may legitimately
 * share one — see the note on `Upload` in `prisma/schema.prisma` and the module
 * comment in `services/pdf-gc.ts`.
 */
export async function assertUploadBelongsTo(organizationId: string, pdfUrl: string): Promise<string> {
  const key = pdfFilenameFrom(pdfUrl)
  if (!key) throw new AppError(400, REJECTION)

  const upload = await prisma.upload.findUnique({
    where: { key },
    select: { organizationId: true }
  })

  if (!upload || upload.organizationId !== organizationId) {
    throw new AppError(400, REJECTION)
  }

  // Never the value the client sent: a client echoing back a `pdfUrl` it read
  // from this API would otherwise persist a signature, and the form would break
  // one TTL later (features/0006).
  return canonicalPdfUrl(pdfUrl)!
}
