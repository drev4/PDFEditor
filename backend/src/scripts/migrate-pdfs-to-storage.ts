import { prisma } from '../services/db.js'
import { pdfFilenameFrom } from '../services/pdf-url.js'
import { LocalPdfStorage, pdfStorage } from '../services/pdf-storage.js'

/**
 * Copies every PDF the database references from local disk into the configured
 * storage driver (features/0016).
 *
 * **Run this before switching `PDF_STORAGE_DRIVER` to `s3`, not after.** Flipping
 * the driver does not move anything: the application would start looking for
 * objects in a bucket that does not have them, and every form uploaded before
 * the switch would lose its PDF — the forms keep their rows and their fields,
 * and the document behind them stops resolving. Copy first, verify, then switch.
 *
 * Usage:
 *
 *   npm run storage:migrate -- --dry-run     # say what would happen
 *   npm run storage:migrate                  # do it
 *
 * The destination is whatever `PDF_STORAGE_DRIVER` and its variables name, so
 * the environment this runs with must already be the *target* configuration.
 * The source is always the local disk, because that is the only thing this
 * feature migrates away from.
 *
 * It is **idempotent and non-destructive**: an object already present in the
 * destination is skipped rather than overwritten, and nothing is ever deleted
 * from the local disk. Deleting the originals is a separate, deliberate act —
 * keep them until the bucket has been read from in anger, because they are the
 * only copy of a customer document.
 */
async function main() {
  const dryRun = process.argv.includes('--dry-run')

  const destination = pdfStorage()
  const source = new LocalPdfStorage()

  if (destination instanceof LocalPdfStorage) {
    console.error(
      'PDF_STORAGE_DRIVER resolves to the local disk, so the source and the ' +
      'destination are the same place and there is nothing to copy. Set the ' +
      'target storage variables before running this.'
    )
    process.exitCode = 1
    return
  }

  console.log(dryRun ? '🔍 DRY RUN — nothing will be written\n' : '🚚 Copying PDFs into the configured storage\n')

  const forms = await prisma.form.findMany({
    where: { pdfUrl: { not: null } },
    select: { id: true, title: true, pdfUrl: true }
  })

  const stats = { copied: 0, skipped: 0, alreadyThere: 0, missing: 0, failed: 0 }
  // One PDF can be referenced by more than one form; copy it once.
  const seen = new Set<string>()

  for (const form of forms) {
    const key = pdfFilenameFrom(form.pdfUrl)

    if (!key) {
      // Not a name this service could have issued. Reported rather than
      // skipped silently — it means something wrote the column by hand.
      console.warn(`⚠️  ${form.id} "${form.title}": unrecognised pdfUrl ${form.pdfUrl}`)
      stats.skipped++
      continue
    }

    if (seen.has(key)) continue
    seen.add(key)

    try {
      if (!(await source.exists(key))) {
        // The row points at a file that is not on this disk. Nothing this
        // script can do, and worth knowing about before the switch rather than
        // after: it is a form whose PDF is already gone.
        console.warn(`⚠️  ${key}: not on local disk (form ${form.id})`)
        stats.missing++
        continue
      }

      if (await destination.exists(key)) {
        console.log(`⏭️  ${key}: already in the destination`)
        stats.alreadyThere++
        continue
      }

      if (dryRun) {
        console.log(`🔍 ${key}: would copy`)
        stats.copied++
        continue
      }

      const bytes = await source.get(key)
      await destination.put(key, bytes)

      // Read back rather than trusting the write: this is the only copy of a
      // customer's document, and a silent short write is the failure that would
      // not be noticed until somebody opened the form.
      const verified = await destination.get(key)
      if (verified.length !== bytes.length) {
        throw new Error(`copied ${bytes.length} bytes, read back ${verified.length}`)
      }

      console.log(`✅ ${key}: ${(bytes.length / 1024).toFixed(1)} KB`)
      stats.copied++
    } catch (error) {
      console.error(`❌ ${key}: ${error instanceof Error ? error.message : error}`)
      stats.failed++
    }
  }

  console.log('\n──────────────────────────────')
  console.log(`copied:        ${stats.copied}`)
  console.log(`already there: ${stats.alreadyThere}`)
  console.log(`missing:       ${stats.missing}`)
  console.log(`unrecognised:  ${stats.skipped}`)
  console.log(`failed:        ${stats.failed}`)

  if (stats.failed > 0 || stats.missing > 0) {
    console.log('\nDo not switch PDF_STORAGE_DRIVER until this run is clean.')
    process.exitCode = 1
  }
}

main()
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
