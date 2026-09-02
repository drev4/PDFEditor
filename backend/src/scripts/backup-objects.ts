import dotenv from 'dotenv'

// Same first two lines as `src/index.ts` and `src/worker.ts`: this is an
// entrypoint, so nothing has loaded `.env` for it. Placed above every other
// import that might read the environment while it is being evaluated.
dotenv.config()

import fs from 'fs'
import path from 'path'
import { pipeline } from 'stream/promises'
import { pdfStorage } from '../services/pdf-storage.js'
import { manifestPathFor, readManifest } from '../services/backup.js'

/**
 * Copies the PDF documents a dump refers to out of the configured storage
 * (features/0037).
 *
 *   npm run backup:objects --workspace=backend -- --manifest ./backups/vuepdf-….dump.manifest.json
 *   npm run backup:objects --workspace=backend -- --dump ./backups/vuepdf-….dump
 *
 * **Why a script and not the provider's versioning.** Two reasons, and the
 * second is the one that decided it. Versioning is a per-provider feature with
 * per-provider semantics — S3 has it, an S3-compatible endpoint may not, and
 * the deployment's bucket is a decision that can change — so a backup that
 * depends on it is a backup that stops existing when somebody swaps the
 * storage. And versioning protects against overwrite and deletion *inside* the
 * bucket; it does nothing when the bucket, the account or the region is what is
 * lost, which is the scenario an off-site copy is for. Provider versioning
 * should still be switched on, and the runbook says so — it is a much better
 * answer than this script for the common case of one deleted object.
 *
 * **The work list comes from the manifest, never from the live database.** That
 * is the whole point. Reading the current `forms` table would capture the
 * documents the product references *now*, which is a different set from the one
 * the dump refers to — a form created after the dump contributes an object that
 * the restored database has no row for, and a form deleted after the dump has
 * already had its object collected (features/0029). Pairing the two artifacts
 * by construction is what makes the restore coherent.
 *
 * Missing objects are reported and do not stop the run. An object referenced by
 * a dumped row and absent from the bucket is a fact about the source that the
 * operator needs on the day of the backup, not on the day of the restore.
 */

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name)
  if (index === -1) return null
  return process.argv[index + 1] ?? null
}

async function main() {
  const dump = argValue('--dump')
  const manifestFile = argValue('--manifest') ?? (dump ? manifestPathFor(dump) : null)

  if (!manifestFile) {
    console.error(
      'Usage: npm run backup:objects --workspace=backend -- --manifest <file>\n' +
      '   or: npm run backup:objects --workspace=backend -- --dump <file>'
    )
    process.exitCode = 1
    return
  }

  if (!fs.existsSync(manifestFile)) {
    console.error(`No manifest at ${manifestFile}. It is written beside the dump by backup:db.`)
    process.exitCode = 1
    return
  }

  const manifest = readManifest(manifestFile)
  // Beside the dump, named after it, so the pair travels together. An operator
  // copying one directory off-site gets both halves or neither.
  const outDir = argValue('--out') ?? path.join(path.dirname(manifestFile), `${manifest.dumpFile}.objects`)
  fs.mkdirSync(outDir, { recursive: true })

  const storage = pdfStorage()
  const stats = { copied: 0, alreadyThere: 0, missing: 0, failed: 0 }
  const missing: string[] = []

  console.log(`Copying ${manifest.documentKeys.length} documents referenced by ${manifest.dumpFile}\n`)

  for (const key of manifest.documentKeys) {
    const target = path.join(outDir, key)

    // Resumable: a run interrupted halfway does not start over, and the object
    // store is charged per request. `.part` below is why an existing file can
    // be trusted to be whole.
    if (fs.existsSync(target)) {
      stats.alreadyThere++
      continue
    }

    try {
      const stream = await storage.getStream(key)

      if (!stream) {
        missing.push(key)
        stats.missing++
        continue
      }

      // Written to a temporary name and renamed, for the reason
      // `LocalPdfStorage.put` gives: a truncated PDF left by an interrupted run
      // is indistinguishable from a whole one, and this is a backup — the copy
      // nobody looks at until it is the only copy.
      const temporary = `${target}.part`
      await pipeline(stream, fs.createWriteStream(temporary))
      fs.renameSync(temporary, target)
      stats.copied++
    } catch (error) {
      console.error(`⚠️  ${key}: ${error instanceof Error ? error.message : String(error)}`)
      stats.failed++
    }
  }

  console.log(
    `\n${stats.copied} copied, ${stats.alreadyThere} already present, ` +
    `${stats.missing} missing, ${stats.failed} failed`
  )
  console.log(`   ${outDir}`)

  if (missing.length > 0) {
    console.log('\n⚠️  Referenced by a dumped row and not in storage:')
    for (const key of missing.slice(0, 20)) console.log(`   ${key}`)
    if (missing.length > 20) console.log(`   … and ${missing.length - 20} more`)
    console.log(
      '\nThese forms will restore with a document that cannot be opened. This is\n' +
      'a fact about the source database, not about the backup.'
    )
  }

  // A failed read is an incomplete backup and must not exit 0: a scheduler that
  // only checks the exit code is the whole audience for this decision.
  if (stats.failed > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(`\n❌ ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
