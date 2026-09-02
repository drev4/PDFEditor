import dotenv from 'dotenv'

// Same first two lines as `src/index.ts` and `src/worker.ts`: this is an
// entrypoint, so nothing has loaded `.env` for it. Placed above every other
// import that might read the environment while it is being evaluated.
dotenv.config()

import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { PrismaClient } from '@prisma/client'
import {
  MANIFEST_VERSION,
  appliedMigration,
  countRows,
  describeDatabase,
  documentKeys,
  manifestPathFor,
  pgEnvFrom,
  publicTables,
  sha256File,
  type BackupManifest
} from '../services/backup.js'

/**
 * Takes a portable backup of the database (features/0037).
 *
 *   npm run backup:db --workspace=backend                  # into ./backups
 *   npm run backup:db --workspace=backend -- --out /var/backups
 *
 * Produces two files: a `pg_dump --format=custom` artifact and a
 * `<dump>.manifest.json` beside it. **Both are the backup** — the manifest is
 * not metadata for humans. `restore:verify` reads it to know what the restored
 * database is supposed to contain, and `backup:objects` reads it to know which
 * documents belong to this dump. A dump without its manifest can still be
 * restored and cannot be *verified*, which is the half this feature exists for.
 *
 * Why the custom format rather than plain SQL: it can be restored selectively,
 * it is compressed, and `pg_restore` fails loudly on a corrupt archive instead
 * of feeding half a file to psql.
 *
 * This is a floor, not a replacement for the provider's own backups. The
 * argument for having both is in `docs/runbooks/backup-and-restore.md`: a
 * managed snapshot restores into that provider and nowhere else.
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
              `package, and its version must be at least the server's — see ` +
              `docs/runbooks/backup-and-restore.md.`
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
  const databaseUrl = process.env.DATABASE_URL

  if (!databaseUrl) {
    console.error('DATABASE_URL is not set; there is nothing to back up.')
    process.exitCode = 1
    return
  }

  const outDir = argValue('--out') ?? path.join(process.cwd(), 'backups')
  fs.mkdirSync(outDir, { recursive: true })

  // Colons are not portable in filenames, so the ISO stamp is flattened. It
  // stays sortable, which is what a directory of these is read by.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dumpFile = path.join(outDir, `vuepdf-${stamp}.dump`)

  console.log(`Backing up ${describeDatabase(databaseUrl)} to ${dumpFile}\n`)

  // `--no-owner` and `--no-acl`: the restore target is a scratch database whose
  // roles are not production's, and a dump that insists on its original owner
  // fails on every host but the one it came from — which would be discovered
  // during the first real incident.
  await run(
    'pg_dump',
    ['--format=custom', '--no-owner', '--no-acl', `--file=${dumpFile}`],
    pgEnvFrom(databaseUrl)
  )

  // The manifest is built *after* the dump so its counts describe a database
  // that has already been read. They can still drift if the database is being
  // written to during the dump; `pg_dump` takes a consistent snapshot, so the
  // dump is coherent with itself and the counts are the best available
  // approximation of it. The runbook says to take backups when traffic is low
  // for exactly this reason, and `restore:verify` reports a count mismatch as a
  // warning rather than a failure because of it.
  const prisma = new PrismaClient({ log: ['error'] })

  try {
    const tables = await publicTables(prisma)

    const manifest: BackupManifest = {
      version: MANIFEST_VERSION,
      createdAt: new Date().toISOString(),
      database: describeDatabase(databaseUrl),
      migration: await appliedMigration(prisma),
      dumpFile: path.basename(dumpFile),
      dumpSha256: await sha256File(dumpFile),
      rowCounts: await countRows(prisma, tables),
      documentKeys: await documentKeys(prisma)
    }

    const manifestFile = manifestPathFor(dumpFile)
    fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

    const bytes = fs.statSync(dumpFile).size
    console.log(`\n✅ ${(bytes / 1024 / 1024).toFixed(1)} MB, migration ${manifest.migration ?? '(none)'}`)
    console.log(`   ${manifest.documentKeys.length} referenced documents`)
    console.log(`   manifest ${path.basename(manifestFile)}`)
    console.log(
      `\nNext: npm run backup:objects --workspace=backend -- --manifest ${manifestFile}\n` +
      'A database backup on its own restores forms whose PDFs are gone.'
    )
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(`\n❌ ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
