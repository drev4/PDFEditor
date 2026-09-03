import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { soleManifest, NO_BACKUP_DIR, main } from '../src/scripts/backup-run'

/**
 * The backup as one scheduled command (features/0042).
 *
 * **What is worth testing here is the refusal, not the happy path.** A real
 * backup needs `pg_dump`, a database and a bucket, and it was verified that way
 * — run inside the `backup` image against a real PostgreSQL, writing to a
 * mounted volume that outlived the container. That evidence is in the feature's
 * Outcome and no unit test could produce it.
 *
 * What a test *can* hold still is the guard, and the guard is the whole point:
 * `backup:db` defaults its output to `./backups`, and on a platform whose
 * scheduled jobs run in a container that is thrown away, that default produces a
 * job which succeeds every night and keeps nothing. **A green job is worse than
 * a missing one**, because it removes the pressure to fix it.
 */
describe('the backup refuses to run somewhere it would be lost', () => {
  const errors: string[] = []

  beforeEach(() => {
    errors.length = 0
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(' '))
    })
    vi.stubEnv('BACKUP_DIR', '')
    process.exitCode = undefined
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    process.exitCode = undefined
  })

  it('exits non-zero when BACKUP_DIR is not set', async () => {
    await main()

    expect(process.exitCode).toBe(1)
    expect(errors.join('\n')).toBe(NO_BACKUP_DIR)
  })

  it('treats whitespace as unset, because a blank platform variable is not a path', async () => {
    vi.stubEnv('BACKUP_DIR', '   ')

    await main()

    expect(process.exitCode).toBe(1)
  })

  /**
   * The message has to teach, not just report. Somebody reading it at 03:00 has
   * to understand why the convenient default was taken away, or they will pass
   * `--out .` and recreate the problem.
   */
  it('explains the ephemeral container rather than only naming the variable', () => {
    expect(NO_BACKUP_DIR).toMatch(/thrown away/)
    expect(NO_BACKUP_DIR).toMatch(/worse than no backup/)
    expect(NO_BACKUP_DIR).toMatch(/mounted volume/)
    expect(NO_BACKUP_DIR).toContain('backup-and-restore.md')
  })
})

describe('the manifest of a run is unambiguous by construction', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-run-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('finds the single manifest a run leaves behind', () => {
    fs.writeFileSync(path.join(dir, 'vuepdf-2026.dump'), '')
    fs.writeFileSync(path.join(dir, 'vuepdf-2026.dump.manifest.json'), '{}')

    expect(soleManifest(dir)).toBe(path.join(dir, 'vuepdf-2026.dump.manifest.json'))
  })

  it('refuses when the dump left none', () => {
    fs.writeFileSync(path.join(dir, 'vuepdf-2026.dump'), '')

    // A dump that reports success without a manifest is not a backup: nothing
    // downstream can be verified and `backup:objects` has no work list.
    expect(soleManifest(dir)).toBeNull()
  })

  it('refuses when there is more than one, instead of guessing', () => {
    // Each run gets its own directory precisely so this cannot happen. If it
    // does, the assumption is broken and picking one would back up the wrong
    // set of documents.
    fs.writeFileSync(path.join(dir, 'a.dump.manifest.json'), '{}')
    fs.writeFileSync(path.join(dir, 'b.dump.manifest.json'), '{}')

    expect(soleManifest(dir)).toBeNull()
  })
})
