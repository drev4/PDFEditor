#!/usr/bin/env node
/**
 * Audit the dependencies that are actually inside the production API image.
 *
 * `npm audit --omit=dev` describes one lockfile spanning three deliverables —
 * the backend runtime (`Dockerfile.backend`, target `runtime`), the SPA
 * (`Dockerfile.frontend`, an Nginx image with no `node_modules` at all) and the
 * migration job (`Dockerfile.migrations`, which deliberately keeps the Prisma
 * CLI and never serves traffic). Its number therefore describes no artifact this
 * project ships, in both directions:
 *
 *   - it counts advisories against packages that never reach a serving image, and
 *   - it hides the fact that the runtime stage copies the *hoisted*
 *     `/app/node_modules`, so every workspace's production tree — the SPA's
 *     included — is inside the API image.
 *
 * This script answers the only question a gate can act on: is the vulnerable
 * package present in the image we run, at a version the advisory covers? The
 * shipped set is enumerated from the built image, never from a manifest, because
 * a hand-written inventory of what ships is a second source of truth and would
 * drift from `Dockerfile.backend` by the third change to it.
 *
 * Usage:
 *   node scripts/audit-production.mjs                       # build the image, enumerate, audit
 *   node scripts/audit-production.mjs --shipped-from=FILE   # reuse a snapshot (no Docker)
 *   node scripts/audit-production.mjs --write-snapshot=FILE # enumerate and save a snapshot
 *   node scripts/audit-production.mjs --json                # machine-readable report
 *
 * Exit codes:
 *   0  nothing shipped is affected above the threshold, or everything is excepted
 *   1  a `high`/`critical` advisory affects a shipped package and is not excepted,
 *      or an exception has expired
 *   2  the shipped set could not be determined, or `npm audit` could not be run
 *
 * Exit 2 matters as much as exit 1: a gate that degrades to "no findings" when
 * Docker is unavailable is worse than no gate, because it is trusted.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import semver from 'semver'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const EXCEPTIONS_FILE = path.join(ROOT, '.audit-exceptions.json')
const IMAGE_TAG = 'vuepdf-audit-runtime'
const DOCKERFILE = 'Dockerfile.backend'
const TARGET = 'runtime'

/** Advisories at or above this severity fail the run. */
const BLOCKING = new Set(['high', 'critical'])

const args = process.argv.slice(2)
const flag = (name) => {
  const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return undefined
  const eq = hit.indexOf('=')
  return eq === -1 ? true : hit.slice(eq + 1)
}

const asJson = flag('json') === true
const shippedFrom = flag('shipped-from')
const writeSnapshot = flag('write-snapshot')

/** Everything the script prints goes through here so `--json` stays parseable. */
const log = (...a) => {
  if (!asJson) console.log(...a)
}
const warn = (...a) => {
  if (!asJson) console.warn(...a)
}

function die(code, message, hint) {
  if (asJson) {
    console.log(JSON.stringify({ ok: false, error: message, hint }, null, 2))
  } else {
    console.error(`\n  ✖ ${message}`)
    if (hint) console.error(`    ${hint}`)
  }
  process.exit(code)
}

function lockfileFingerprint() {
  const lock = path.join(ROOT, 'package-lock.json')
  return createHash('sha256').update(readFileSync(lock)).digest('hex').slice(0, 16)
}

/**
 * Walk the image's `node_modules` trees and return every installed package.
 *
 * `npm ls` is not used here. It reads the lockfile's idea of the tree, and the
 * runtime stage is assembled by copying directories out of another stage — the
 * two can disagree, and when they do the directories are the truth. Walking also
 * survives a pruned tree, where `npm ls` can fail its own integrity check.
 */
const ENUMERATE = `
const fs = require('fs'), path = require('path');
const roots = ['/app/node_modules', '/app/backend/node_modules'];
const found = new Map();
function walk(dir, depth) {
  if (depth > 8) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (entry.name === '.bin') continue;
    const full = path.join(dir, entry.name);
    if (entry.name.startsWith('@')) { walk(full, depth + 1); continue }
    let pkg;
    try { pkg = JSON.parse(fs.readFileSync(path.join(full, 'package.json'), 'utf8')) } catch {}
    if (pkg && pkg.name && pkg.version) {
      if (!found.has(pkg.name)) found.set(pkg.name, new Set());
      found.get(pkg.name).add(pkg.version);
    }
    const nested = path.join(full, 'node_modules');
    if (fs.existsSync(nested)) walk(nested, depth + 1);
  }
}
for (const r of roots) walk(r, 0);
process.stdout.write(JSON.stringify(
  Object.fromEntries([...found].map(([n, v]) => [n, [...v].sort()]))
));
`

function enumerateFromImage() {
  try {
    execFileSync('docker', ['version', '--format', '{{.Server.Version}}'], { stdio: 'pipe' })
  } catch {
    die(
      2,
      'Docker is not available, so the set of packages inside the production image cannot be determined.',
      `Start Docker, or pass --shipped-from=<snapshot>. Refusing to report "no findings" without knowing what ships.`
    )
  }

  log(`  Building ${DOCKERFILE} (target: ${TARGET}) to enumerate what ships…`)
  try {
    execFileSync(
      'docker',
      ['build', '-f', DOCKERFILE, '--target', TARGET, '-t', IMAGE_TAG, '.'],
      { cwd: ROOT, stdio: asJson ? 'pipe' : 'inherit' }
    )
  } catch {
    die(2, `Could not build the ${TARGET} stage of ${DOCKERFILE}.`, 'The audit cannot proceed without the image.')
  }

  let raw
  try {
    raw = execFileSync('docker', ['run', '--rm', IMAGE_TAG, 'node', '-e', ENUMERATE], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024
    })
  } catch {
    die(2, 'Could not enumerate node_modules inside the built image.')
  }

  let packages
  try {
    packages = JSON.parse(raw)
  } catch {
    die(2, 'The image enumeration did not return valid JSON.')
  }
  if (Object.keys(packages).length === 0) {
    die(2, 'The image enumeration found no packages at all, which cannot be right.')
  }
  return { packages, lockfile: lockfileFingerprint(), generatedAt: new Date().toISOString() }
}

function loadSnapshot(file) {
  const resolved = path.resolve(ROOT, file)
  if (!existsSync(resolved)) die(2, `Snapshot not found: ${resolved}`)
  let snapshot
  try {
    snapshot = JSON.parse(readFileSync(resolved, 'utf8'))
  } catch {
    die(2, `Snapshot is not valid JSON: ${resolved}`)
  }
  if (!snapshot.packages || Object.keys(snapshot.packages).length === 0) {
    die(2, `Snapshot contains no packages: ${resolved}`)
  }

  // Staleness is a warning, not a failure. Making a lockfile change fail this
  // gate until somebody regenerates a snapshot is how a gate acquires a red
  // build nobody can act on — and then gets deleted. CI builds the image
  // itself and never reaches this path.
  const current = lockfileFingerprint()
  if (snapshot.lockfile !== current) {
    warn(
      `  ! Snapshot is STALE. It was taken against package-lock.json ${snapshot.lockfile}; the tree is now ${current}.`
    )
    warn(`    Findings below may not reflect the image that would be built today.`)
    warn(`    Regenerate with: npm run audit:prod -- --write-snapshot=${file}`)
  }
  if (snapshot.generatedAt) log(`  Using snapshot from ${snapshot.generatedAt} (no image was built).`)
  return snapshot
}

function runNpmAudit() {
  let raw
  try {
    raw = execFileSync('npm', ['audit', '--omit=dev', '--json'], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      shell: process.platform === 'win32'
    })
  } catch (error) {
    // `npm audit` exits non-zero precisely when it finds something, which is
    // the normal case here. Only a missing/!parseable payload is a real failure.
    raw = error.stdout
    if (!raw) die(2, 'npm audit produced no output.', error.message)
  }
  try {
    return JSON.parse(raw)
  } catch {
    die(2, 'npm audit did not return valid JSON.')
  }
}

function loadExceptions() {
  if (!existsSync(EXCEPTIONS_FILE)) return []
  let parsed
  try {
    parsed = JSON.parse(readFileSync(EXCEPTIONS_FILE, 'utf8'))
  } catch {
    die(2, `.audit-exceptions.json is not valid JSON.`)
  }
  if (!Array.isArray(parsed)) die(2, `.audit-exceptions.json must be a JSON array.`)
  for (const [i, e] of parsed.entries()) {
    for (const key of ['id', 'package', 'reason', 'expires']) {
      if (!e[key] || typeof e[key] !== 'string') {
        die(2, `.audit-exceptions.json[${i}] is missing a string "${key}".`)
      }
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.expires)) {
      die(2, `.audit-exceptions.json[${i}] has expires="${e.expires}"; expected YYYY-MM-DD.`)
    }
  }
  return parsed
}

/** Pull the distinct advisories out of npm's nested `via` chains. */
function advisoriesFor(entry, all, seen = new Set()) {
  const out = []
  for (const via of entry.via ?? []) {
    if (typeof via === 'string') {
      // An indirect entry: this package is vulnerable only because a dependency
      // is. Follow it so the finding names the advisory, not just the parent.
      if (seen.has(via)) continue
      seen.add(via)
      const parent = all[via]
      if (parent) out.push(...advisoriesFor(parent, all, seen))
      continue
    }
    const ghsa = /GHSA-[a-z0-9-]+/i.exec(via.url ?? '')?.[0] ?? `NPM-${via.source}`
    out.push({ id: ghsa, title: via.title, severity: via.severity, url: via.url, range: via.range })
  }
  return out
}

// ---------------------------------------------------------------------------

const shipped = shippedFrom ? loadSnapshot(shippedFrom) : enumerateFromImage()

if (writeSnapshot) {
  const target = path.resolve(ROOT, writeSnapshot)
  writeFileSync(target, `${JSON.stringify(shipped, null, 2)}\n`)
  log(`  Snapshot written: ${target} (${Object.keys(shipped.packages).length} packages)`)
}

const audit = runNpmAudit()
const exceptions = loadExceptions()
const today = new Date().toISOString().slice(0, 10)

const expired = exceptions.filter((e) => e.expires < today)
const usedExceptions = new Set()

const findings = []
const notShipped = []

for (const [name, entry] of Object.entries(audit.vulnerabilities ?? {})) {
  const versions = shipped.packages[name]
  if (!versions) {
    notShipped.push({ package: name, severity: entry.severity })
    continue
  }

  // Which of the installed versions the advisory range actually covers. An
  // advisory naming a range the image does not contain is not a finding here,
  // and saying so is the point of intersecting on version rather than on name.
  const affected = versions.filter((v) => {
    if (!entry.range) return true
    try {
      return semver.satisfies(v, entry.range, { includePrerelease: true })
    } catch {
      return true // an unparseable range is reported, not silently dropped
    }
  })
  if (affected.length === 0) {
    notShipped.push({ package: name, severity: entry.severity, reason: 'version not in range' })
    continue
  }

  for (const advisory of advisoriesFor(entry, audit.vulnerabilities)) {
    const exception = exceptions.find((e) => e.id === advisory.id && e.package === name)
    if (exception) usedExceptions.add(`${exception.id}::${exception.package}`)
    findings.push({
      package: name,
      installed: affected,
      severity: advisory.severity ?? entry.severity,
      id: advisory.id,
      title: advisory.title,
      url: advisory.url,
      excepted: Boolean(exception),
      exceptionExpires: exception?.expires,
      exceptionReason: exception?.reason
    })
  }
}

const blocking = findings.filter((f) => BLOCKING.has(f.severity) && !f.excepted)
const excepted = findings.filter((f) => f.excepted)
const belowThreshold = findings.filter((f) => !BLOCKING.has(f.severity) && !f.excepted)
const unusedExceptions = exceptions.filter((e) => !usedExceptions.has(`${e.id}::${e.package}`))

if (asJson) {
  console.log(
    JSON.stringify(
      {
        ok: blocking.length === 0 && expired.length === 0,
        shippedPackages: Object.keys(shipped.packages).length,
        blocking,
        excepted,
        belowThreshold,
        notShipped,
        expiredExceptions: expired,
        unusedExceptions
      },
      null,
      2
    )
  )
} else {
  const line = (f) =>
    `    ${f.severity.padEnd(8)} ${f.package}@${f.installed.join(',')}  ${f.id}\n      ${f.title ?? ''}`

  console.log(`\n  Packages in the ${TARGET} image: ${Object.keys(shipped.packages).length}`)
  console.log(`  Advisories from npm audit --omit=dev: ${Object.keys(audit.vulnerabilities ?? {}).length} packages`)
  console.log(`  Of those, not present in the image (or not at an affected version): ${notShipped.length}`)

  if (blocking.length) {
    console.log(`\n  BLOCKING — shipped, high or critical, not excepted (${blocking.length}):`)
    for (const f of blocking) console.log(line(f))
  }
  if (belowThreshold.length) {
    console.log(`\n  Below the failure threshold — shipped, but moderate or lower (${belowThreshold.length}):`)
    for (const f of belowThreshold) console.log(line(f))
  }
  if (excepted.length) {
    console.log(`\n  Excepted (${excepted.length}):`)
    for (const f of excepted) {
      console.log(`${line(f)}\n      expires ${f.exceptionExpires} — ${f.exceptionReason}`)
    }
  }
  if (unusedExceptions.length) {
    console.log(`\n  ! Exceptions that match nothing — the advisory is fixed or gone, remove them:`)
    for (const e of unusedExceptions) console.log(`    ${e.id}  ${e.package}`)
  }
  if (expired.length) {
    console.log(`\n  ✖ EXPIRED exceptions (an exception is a deadline, not a mute button):`)
    for (const e of expired) console.log(`    ${e.id}  ${e.package}  expired ${e.expires} — ${e.reason}`)
  }

  console.log(
    blocking.length === 0 && expired.length === 0
      ? `\n  ✔ Nothing shipped is affected above the threshold.\n`
      : `\n  ✖ Production dependency audit failed.\n`
  )
}

process.exit(blocking.length === 0 && expired.length === 0 ? 0 : 1)
