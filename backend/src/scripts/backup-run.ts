import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { fileURLToPath, pathToFileURL } from 'url'

/**
 * The whole backup, as one command, for something that runs on a clock
 * (features/0042).
 *
 * ## Why this exists rather than two lines in a cron entry
 *
 * `backup:objects` needs the manifest that `backup:db` produced, and the
 * manifest's name contains the timestamp the dump was taken at. A scheduled job
 * cannot chain them without either parsing stdout or guessing the filename, and
 * both are the kind of thing that works until the day it matters.
 *
 * This gives each run **its own directory**, so the manifest inside it is
 * unambiguous — and, as a second effect that is worth as much, so that pruning
 * old backups is `rm -rf` on a dated directory rather than a filename pattern.
 *
 * ## The failure this is really guarding against
 *
 * `backup:db` defaults its output to `./backups` under the working directory.
 * On a platform whose scheduled jobs run in a **container that is discarded when
 * the job exits**, that default produces a job which succeeds every night and
 * keeps nothing — and a green job is worse than a missing one, because it
 * removes the pressure to fix it.
 *
 * So `BACKUP_DIR` is **required** here and there is no default. Pointing it at a
 * mounted volume is the deployment's job and the runbook says so; what this file
 * guarantees is that nobody gets a silent, ephemeral one by accident.
 *
 * ## What it deliberately does not do
 *
 * **It does not upload anywhere.** The runbook is explicit that a copy living
 * with the provider that holds the database is not an off-site backup, and
 * inventing an upload destination here would make it look like that box is
 * ticked. Durable-within-the-provider is the honest step this closes; off-site
 * stays a documented, deliberate act.
 *
 * **It does not prune.** Deleting old backups is not something to infer from a
 * default — see the runbook for the retention decision, which is the operator's.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** Runs one of the sibling scripts, resolving false when it exits non-zero. */
function runScript(script: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(HERE, script), ...args], {
      stdio: 'inherit',
      env: process.env
    })
    child.on('error', () => resolve(false))
    child.on('close', (code) => resolve(code === 0))
  })
}

/**
 * The single manifest in a directory this run created.
 *
 * Unambiguous by construction rather than by pattern matching: the directory was
 * empty a moment ago, so anything but exactly one manifest means the dump did
 * not do what it says.
 */
export function soleManifest(dir: string): string | null {
  const found = fs.readdirSync(dir).filter((name) => name.endsWith('.manifest.json'))
  return found.length === 1 ? path.join(dir, found[0]!) : null
}

/**
 * What a missing `BACKUP_DIR` says, as a constant so a test can assert that it
 * explains the ephemeral-container trap rather than merely naming the variable.
 * A message that only says "not set" teaches nobody why the default was removed.
 */
export const NO_BACKUP_DIR =
  'BACKUP_DIR is not set, and this command has no default on purpose.\n\n' +
  'A scheduled job usually runs in a container that is thrown away when it\n' +
  'finishes. Writing the backup into that container produces a job that\n' +
  'succeeds every night and keeps nothing, which is worse than no backup at\n' +
  'all because it looks like one.\n\n' +
  'Point BACKUP_DIR at storage that outlives the job — a mounted volume —\n' +
  'and see docs/runbooks/backup-and-restore.md.'

export async function main() {
  const root = process.env.BACKUP_DIR?.trim()

  if (!root) {
    console.error(NO_BACKUP_DIR)
    process.exitCode = 1
    return
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outDir = path.join(root, stamp)
  fs.mkdirSync(outDir, { recursive: true })

  console.log(`Backup ${stamp} -> ${outDir}\n`)

  if (!(await runScript('backup-db.js', ['--out', outDir]))) {
    console.error('\n❌ The database backup failed. Nothing else ran.')
    process.exitCode = 1
    return
  }

  const manifest = soleManifest(outDir)
  if (!manifest) {
    console.error(
      `\n❌ Expected exactly one manifest in ${outDir}. ` +
      'The dump reported success without leaving one, so this run cannot be trusted.'
    )
    process.exitCode = 1
    return
  }

  // Bytes after rows, and the work list comes from the manifest rather than the
  // live database, so the two artifacts describe the same moment. That ordering
  // is the runbook's, not this file's.
  if (!(await runScript('backup-objects.js', ['--manifest', manifest]))) {
    console.error(
      '\n❌ The documents failed to back up. **The dump on its own is not a ' +
      'backup of this product** — it restores forms whose PDFs are gone.'
    )
    process.exitCode = 1
    return
  }

  console.log(`\n✅ Backup complete: ${outDir}`)
}

// Only when run as a command. The spec imports this file to assert the guards
// without a database, and importing it must not start a backup.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`\n❌ ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}
