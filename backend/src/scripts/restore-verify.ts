import dotenv from 'dotenv'

// Same first two lines as `src/index.ts` and `src/worker.ts`: this is an
// entrypoint, so nothing has loaded `.env` for it. Placed above every other
// import that might read the environment while it is being evaluated.
dotenv.config()

import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { PrismaClient } from '@prisma/client'
import { pdfStorage } from '../services/pdf-storage.js'
import {
  addressesSameDatabase,
  appliedMigration,
  compareRowCounts,
  countRows,
  describeDatabase,
  documentKeys,
  manifestPathFor,
  newestMigrationOnDisk,
  pgEnvFrom,
  publicTables,
  readManifest,
  sha256File,
  unreadableDocumentUrls,
  verifyDocuments
} from '../services/backup.js'

/**
 * The restore drill (features/0037).
 *
 *   npm run restore:verify --workspace=backend -- \
 *     --dump ./backups/vuepdf-….dump \
 *     --target postgresql://postgres:postgres@localhost:5432/vuepdf_restore
 *
 * **This is the deliverable, not the backup script.** `docs/sot/08-operations.md`
 * said recovery time was unknown; a `pg_dump` in a cron entry does not change
 * that, because an untested backup is a belief. This restores an artifact into
 * a scratch database and then asks whether the result is a database the
 * application could actually serve.
 *
 * `pg_restore` exiting 0 is not that question. It reports on its own execution.
 * The four checks below are about the data:
 *
 *   1. the schema is the one this build expects (`_prisma_migrations` against
 *      `prisma/migrations/`), because a restore one migration behind the code
 *      is a deploy that crashes on the first query;
 *   2. row counts match the manifest;
 *   3. every foreign key holds — which `pg_restore --exit-on-error` establishes
 *      for us, since a custom-format restore creates the constraints *after*
 *      loading the data and PostgreSQL validates them as it creates them. That
 *      is why the flag is not optional and why there is no separate integrity
 *      query: re-checking it here would be a second, weaker implementation of
 *      something the restore already did properly;
 *   4. **the documents are there.** Nothing else in this codebase crosses from
 *      a row to the bytes it points at, and it is the check that fails when a
 *      database backup was taken without its objects.
 *
 * Two refusals come before any of it, and before `pg_restore` touches anything.
 */

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name)
  if (index === -1) return null
  return process.argv[index + 1] ?? null
}

function run(command: string, args: string[], env: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'inherit', 'inherit']
    })

    child.on('error', (error: NodeJS.ErrnoException) => {
      reject(
        error.code === 'ENOENT'
          ? new Error(
              `${command} is not on PATH. It ships with the PostgreSQL client ` +
              'package — see docs/runbooks/backup-and-restore.md.'
            )
          : error
      )
    })
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} exited ${code}`))
    })
  })
}

async function main() {
  const dumpFile = argValue('--dump')
  const target = argValue('--target')
  const sampleArg = argValue('--sample')
  const sample = sampleArg ? Number(sampleArg) : Number.POSITIVE_INFINITY

  if (!dumpFile || !target) {
    console.error(
      'Usage: npm run restore:verify --workspace=backend -- --dump <file> --target <postgres url>\n' +
      '  --sample <n>   check only the first n documents (default: all)'
    )
    process.exitCode = 1
    return
  }

  if (!fs.existsSync(dumpFile)) {
    console.error(`No dump at ${dumpFile}`)
    process.exitCode = 1
    return
  }

  // ---- Refusal 1: never the database the application is using. ------------
  //
  // Compared on host, port and database name rather than as strings, because
  // the same database is routinely named by two different URLs and a drill that
  // restores over production because two strings differed by a query parameter
  // is the accident this whole script is supposed to rehearse *avoiding*.
  const current = process.env.DATABASE_URL
  if (current && addressesSameDatabase(current, target)) {
    console.error(
      `Refusing: --target is the database in DATABASE_URL (${describeDatabase(target)}).\n` +
      'A restore drill runs against a scratch database. Create an empty one and point at that.'
    )
    process.exitCode = 1
    return
  }

  const prisma = new PrismaClient({ datasourceUrl: target, log: ['error'] })

  try {
    // ---- Refusal 2: the target must be empty. ---------------------------
    //
    // Not politeness. `_prisma_migrations` travels inside the dump, so
    // restoring over a database the migration job has already touched produces
    // conflicting rows and a partially-applied mess rather than a clean
    // failure. Refusing first is what keeps that from being discovered later.
    const existing = await publicTables(prisma)
    if (existing.length > 0) {
      console.error(
        `Refusing: ${describeDatabase(target)} already contains ${existing.length} table(s) ` +
        `(${existing.slice(0, 3).join(', ')}${existing.length > 3 ? ', …' : ''}).\n` +
        'Drop and recreate it, or point at a fresh one.'
      )
      process.exitCode = 1
      return
    }

    const manifestFile = manifestPathFor(dumpFile)
    const manifest = fs.existsSync(manifestFile) ? readManifest(manifestFile) : null

    if (!manifest) {
      console.warn(
        `⚠️  No manifest at ${path.basename(manifestFile)}. The restore will run and the\n` +
        '   row-count and document checks cannot. This is a partial drill.\n'
      )
    } else {
      const actual = await sha256File(dumpFile)
      if (actual !== manifest.dumpSha256) {
        console.error(
          `Refusing: ${path.basename(dumpFile)} does not match its manifest checksum.\n` +
          `  manifest ${manifest.dumpSha256}\n  file     ${actual}\n` +
          'The artifact was corrupted or truncated in transit. Fetch it again.'
        )
        process.exitCode = 1
        return
      }
      console.log(`Manifest: ${manifest.createdAt}, migration ${manifest.migration ?? '(none)'}`)
    }

    console.log(`\nRestoring ${path.basename(dumpFile)} into ${describeDatabase(target)}…\n`)
    const startedAt = Date.now()

    // `--exit-on-error` is what makes check 3 real: without it pg_restore keeps
    // going past a failed constraint creation and reports success at the end,
    // which is precisely the green-check-over-broken-data failure this
    // repository has shipped once already.
    await run(
      'pg_restore',
      ['--no-owner', '--no-acl', '--exit-on-error', '--single-transaction', dumpFile],
      pgEnvFrom(target)
    )

    const restoreSeconds = Math.round((Date.now() - startedAt) / 1000)
    console.log(`\nRestored in ${restoreSeconds}s. Verifying…\n`)

    const failures: string[] = []
    const warnings: string[] = []

    // ---- Check 1: schema version. --------------------------------------
    const restoredMigration = await appliedMigration(prisma)
    const expectedMigration = newestMigrationOnDisk(
      path.join(process.cwd(), 'prisma', 'migrations')
    )

    if (restoredMigration === expectedMigration) {
      console.log(`✅ migration     ${restoredMigration ?? '(none)'}`)
    } else {
      failures.push(
        `migration mismatch: restored ${restoredMigration ?? '(none)'}, ` +
        `repository expects ${expectedMigration ?? '(none)'}`
      )
      console.log(`❌ migration     ${restoredMigration ?? '(none)'} (expected ${expectedMigration ?? '(none)'})`)
    }

    // ---- Check 2: row counts. ------------------------------------------
    if (manifest) {
      const tables = await publicTables(prisma)
      const mismatches = compareRowCounts(manifest.rowCounts, await countRows(prisma, tables))

      if (mismatches.length === 0) {
        console.log(`✅ row counts    ${tables.length} tables match the manifest`)
      } else {
        // A warning rather than a failure, and the reason is in backup-db.ts:
        // the manifest is counted after the dump is written, so a database
        // taking writes during the backup produces a legitimate small
        // difference. A table missing entirely shows as -1 and is unmissable.
        for (const row of mismatches) {
          warnings.push(`${row.table}: manifest ${row.expected}, restored ${row.actual}`)
        }
        console.log(`⚠️  row counts    ${mismatches.length} table(s) differ from the manifest`)
      }
    }

    // ---- Check 4: the documents. ---------------------------------------
    //
    // The one nothing else does. Note it reads the keys out of the *restored*
    // database rather than out of the manifest: the question is whether the
    // database that now exists can serve its documents, and taking the list
    // from the manifest would be checking the backup against itself.
    const keys = await documentKeys(prisma)
    const unreadable = await unreadableDocumentUrls(prisma)
    const check = await verifyDocuments(keys, pdfStorage(), sample)

    if (check.missing.length === 0) {
      console.log(
        `✅ documents     ${check.checked} of ${keys.length} checked, all present` +
        (check.sampled ? ' (sampled)' : '')
      )
    } else {
      failures.push(
        `${check.missing.length} of ${check.checked} referenced documents are not in storage`
      )
      console.log(`❌ documents     ${check.missing.length} of ${check.checked} missing`)
      for (const key of check.missing.slice(0, 20)) console.log(`     ${key}`)
      if (check.missing.length > 20) console.log(`     … and ${check.missing.length - 20} more`)
    }

    if (unreadable.length > 0) {
      // Separate from a missing object on purpose: this is a row somebody wrote
      // by hand, not a backup that lost bytes.
      warnings.push(`${unreadable.length} form(s) have a pdfUrl this service could not have issued`)
      for (const form of unreadable.slice(0, 5)) console.log(`⚠️  form ${form.id}: ${form.pdfUrl}`)
    }

    console.log('')

    if (warnings.length > 0) {
      console.log('Warnings:')
      for (const warning of warnings.slice(0, 20)) console.log(`   ${warning}`)
      console.log('')
    }

    if (failures.length > 0) {
      console.error('❌ DRILL FAILED')
      for (const failure of failures) console.error(`   ${failure}`)
      console.error(
        '\nDo not record this as a successful restore. Fix the cause and run it again.'
      )
      process.exitCode = 1
      return
    }

    console.log('✅ DRILL PASSED')
    console.log(`   restore took ${restoreSeconds}s (this is the RTO figure for the runbook)`)
    if (manifest) {
      const ageMinutes = Math.round((Date.now() - Date.parse(manifest.createdAt)) / 60000)
      console.log(`   artifact was ${ageMinutes} minutes old`)
    }
    console.log(
      '\nRecord the date and these numbers in docs/runbooks/backup-and-restore.md.\n' +
      'A drill nobody wrote down is a drill nobody ran.'
    )
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(`\n❌ ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
