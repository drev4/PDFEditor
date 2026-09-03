import { prisma } from './db.js'
import { logger } from './logger.js'
import { pdfStorage } from './pdf-storage.js'
import { pdfFilenameFrom } from './pdf-url.js'

/**
 * Removing stored documents whose forms are gone (features/0029).
 *
 * **This is the only module that may call `pdfStorage().remove()`.** Before this
 * feature nothing in the application called it at all: `remove` had been on the
 * driver interface since features/0016 with zero call sites, so a deleted form
 * left its PDF in storage for ever — unmeasured waste on local disk, a bill that
 * only grows on `s3`, and, the part that matters more, customer data retained
 * after the customer deleted it.
 *
 * ## Why a key is not owned by the form that points at it
 *
 * The obvious implementation is one line in the delete handler:
 * `remove(pdfFilenameFrom(form.pdfUrl))`. It is wrong, and wrong in the
 * direction that destroys data.
 *
 * Two forms can reference one key. The editor's save path uploads a new document
 * and repoints the form without deleting the old one, so keys are abandoned and
 * reused in ordinary use, and nothing stops a member building a second form on
 * the same upload.
 *
 * Until features/0039 they need not even have belonged to the same organization:
 * `Form.pdfUrl` was an unconstrained client-supplied string that
 * `createFormSchema` and `updateFormSchema` accepted as any `z.string()`. It now
 * has to name an `Upload` owned by the acting organization
 * (`services/uploads.ts`).
 *
 * So the question is never "which key did this form have" but **"is any surviving
 * form still using this key"**, and it can only be answered *after* the rows are
 * gone. Hence the two-step shape: collect the candidate keys while the rows still
 * exist, then call `collectOrphanDocuments` once they do not.
 *
 * **features/0039 narrowed who can create an alias and did not remove aliasing**,
 * so this question is still the right one. A `pdfUrl` must now name an `Upload`
 * belonging to the acting organization, which closes the cross-tenant case — but
 * two forms *in one organization* can still share a key, because the editor
 * repoints a form at a newly uploaded document without deleting the old one
 * (`useFormManagement.ts`, `FormSavePanel.vue`) and nothing stops a member
 * building a second form on the same upload. Going back to
 * `remove(pdfFilenameFrom(form.pdfUrl))` would destroy a live form's document.
 *
 * ## Rows first, bytes second
 *
 * Storage removal never runs inside the database transaction, and the ordering is
 * deliberate rather than incidental. A rollback after the bytes are gone would
 * destroy the document of a form that still exists — unrecoverable. A commit
 * followed by a failed removal leaves an orphaned object — waste, logged, and
 * fixable later. Only one of those two failures is reversible, so the code is
 * arranged so that it is the one that can happen.
 */

/**
 * The storage keys these forms reference, deduplicated.
 *
 * Call it **before** deleting the rows: afterwards there is nothing left to read
 * the `pdfUrl` from.
 */
export function keysReferencedBy(forms: { pdfUrl: string | null }[]): string[] {
  const keys = new Set<string>()

  for (const form of forms) {
    const key = pdfFilenameFrom(form.pdfUrl)
    if (key) keys.add(key)
  }

  return [...keys]
}

/**
 * The `<key>-backup.pdf` sibling written by `scripts/migrate-existing-forms.ts`
 * when it embedded fields into an existing document.
 *
 * It is a copy of the same customer document, so it goes when the original does
 * and stays while any form still references the original.
 */
function backupKeyFor(key: string): string {
  return key.replace(/\.pdf$/i, '') + '-backup.pdf'
}

/**
 * Whether any form still references `key`.
 *
 * The `contains` clause is a prefilter, not the answer: it narrows the rows the
 * database returns, and `pdfFilenameFrom` — the one parser, never a second
 * implementation — decides. A `contains` match alone would treat one key as a
 * reference to another whenever one filename happened to embed the other.
 */
async function stillReferenced(key: string): Promise<boolean> {
  const candidates = await prisma.form.findMany({
    where: { pdfUrl: { contains: key } },
    select: { pdfUrl: true }
  })

  return candidates.some(candidate => pdfFilenameFrom(candidate.pdfUrl) === key)
}

/**
 * Removes every key no surviving form references, and its migration backup.
 *
 * **Call after the deleting transaction has committed.** Never throws: a storage
 * failure here must not turn a completed deletion into a `500` for the customer
 * who asked for it, and the row is already gone. The orphan is logged with its
 * key, which is what `docs/sot/08-operations.md` tells an operator to look for.
 */
export async function collectOrphanDocuments(keys: string[]): Promise<void> {
  for (const key of keys) {
    try {
      if (await stillReferenced(key)) continue

      const storage = pdfStorage()
      await storage.remove(key)

      const backup = backupKeyFor(key)
      if (await storage.exists(backup)) await storage.remove(backup)

      // The ownership record goes with the object it describes, never before it
      // (features/0039). An `Upload` row outliving its bytes is a key the
      // organization may still point a form at and which 404s on every read —
      // exactly the state the bytes-first ordering in `routes/upload.ts` exists
      // to avoid, mirrored here.
      await prisma.upload.deleteMany({ where: { key } })

      logger.info({ key }, 'Removed stored PDF for a deleted form')
    } catch (error) {
      // Deliberately swallowed. See the module comment: the reversible failure
      // is the one that leaves bytes behind, and this is it.
      logger.error({ err: error, key }, 'Could not remove stored PDF; it is now orphaned')
    }
  }
}
