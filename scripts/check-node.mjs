#!/usr/bin/env node
/**
 * Preflight for the Node toolchain.
 *
 * On an unsupported Node this repository fails in three unrelated ways, none of
 * which mentions Node: the frontend suite will not start (`ERR_REQUIRE_ESM`), the
 * frontend build dies with `crypto.hash is not a function` inside
 * @vitejs/plugin-vue, and the native `re2` module stops loading — which is worse
 * than the other two, because the backend then passes almost every test while
 * silently not enforcing field patterns.
 *
 * `engines` alone does not prevent that: npm prints EBADENGINE as a *warning*
 * during install and carries on. `.npmrc` sets `engine-strict=true` so install
 * now fails, but the common failure is switching Node *after* a good install, so
 * the check has to run where the failure happens — hence the `pre*` hooks in the
 * root package.json.
 *
 * Usage:
 *   node scripts/check-node.mjs            version + .nvmrc/engines consistency
 *   node scripts/check-node.mjs --native   also verify the generated Prisma
 *                                          client and the native re2 module load
 */

import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const checkNative = process.argv.includes('--native')

function fail(lines) {
  console.error(`\n\x1b[31m✖ ${lines[0]}\x1b[0m\n${lines.slice(1).map(l => `  ${l}`).join('\n')}\n`)
  process.exit(1)
}

// --- a deliberately small semver subset -------------------------------------
// Only the comparators this repo's `engines` actually uses. An unrecognised one
// warns rather than blocking every script on a bug in the checker itself.

const parse = v => String(v).replace(/^v/, '').split('.').map(Number).slice(0, 3)
const cmp = (a, b) => {
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) < (b[i] || 0) ? -1 : 1
  }
  return 0
}

function satisfiesOne(version, comparator) {
  const raw = comparator.trim()
  const match = raw.match(/^(\^|~|>=|>)?\s*v?(\d+(?:\.\d+){0,2})$/)
  if (!match) return null // unparseable

  const [, op = '', bound] = match
  const v = parse(version)
  const b = parse(bound)

  if (op === '>=') return cmp(v, b) >= 0
  if (op === '>') return cmp(v, b) > 0
  if (op === '^') return v[0] === b[0] && cmp(v, b) >= 0
  if (op === '~') return v[0] === b[0] && v[1] === b[1] && cmp(v, b) >= 0
  return cmp(v, b) === 0
}

/** Returns true/false, or null when the range uses something unsupported. */
function satisfies(version, range) {
  let sawUnparseable = false
  const ok = range.split('||').some(part => {
    const result = satisfiesOne(version, part)
    if (result === null) sawUnparseable = true
    return result === true
  })
  if (!ok && sawUnparseable) return null
  return ok
}

// --- checks -----------------------------------------------------------------

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const range = pkg.engines?.node

if (!range) {
  console.warn('check-node: no engines.node in package.json; skipping version check')
} else {
  const current = process.versions.node
  const ok = satisfies(current, range)

  if (ok === null) {
    console.warn(
      `check-node: cannot interpret the engines range "${range}"; skipping. ` +
      'Extend scripts/check-node.mjs rather than leaving this unchecked.'
    )
  } else if (!ok) {
    fail([
      `Node ${current} is not supported by this repository.`,
      `Required: ${range}   (see .nvmrc)`,
      '',
      'On an unsupported version you will get errors that never mention Node:',
      '  frontend tests  -> ERR_REQUIRE_ESM, every spec fails to start',
      '  frontend build  -> "crypto.hash is not a function"',
      '  backend         -> passes, but silently stops enforcing field patterns',
      '',
      'Fix:  nvm use          (or install the version in .nvmrc)',
      '      npm rebuild re2  (native modules are tied to a Node ABI)'
    ])
  }

  // .nvmrc and engines are two places to write the same fact. This is the check
  // that would have caught them disagreeing - .nvmrc said 22.12.0 while CI ran
  // Node 20.x, so nobody was running what CI ran.
  const nvmrcPath = join(root, '.nvmrc')
  if (existsSync(nvmrcPath)) {
    const pinned = readFileSync(nvmrcPath, 'utf8').trim()
    if (pinned && satisfies(pinned, range) === false) {
      fail([
        `.nvmrc pins Node ${pinned}, which does not satisfy engines "${range}".`,
        'These must agree: .nvmrc is what developers and CI install, engines is',
        'what npm enforces. Update whichever one is wrong.'
      ])
    }
  }
}

if (checkNative) {
  // The generated Prisma client is not committed and is not part of the package
  // tree - it is produced by `prisma generate` during install. When that is
  // skipped the stub throws at import, the API dies at boot, and every symptom
  // appears somewhere else entirely. See features/0005.
  const backendRequire = createRequire(pathToFileURL(join(root, 'backend', 'package.json')))

  try {
    const { PrismaClient } = backendRequire('@prisma/client')
    new PrismaClient()
  } catch (error) {
    fail([
      'The generated Prisma client is missing or stale.',
      '',
      'Nothing that imports backend/src/services/db.ts can start, because the',
      'client is constructed at module scope - so the API exits at boot and the',
      'failure surfaces far from its cause.',
      '',
      'Fix:  npm run db:generate --workspace=backend',
      '',
      `(${String(error.message).split('\n')[0]})`
    ])
  }

  // A version comparison does not catch this: the re2 binary's ABI tracks the
  // Node *major*, so a module built under 22.12 loads fine on 22.22. What breaks
  // it is reinstalling or switching major without rebuilding - and the runtime
  // degrades quietly by design, so nothing else would tell you.
  try {
    backendRequire('re2')
  } catch (error) {
    fail([
      'The native re2 module could not be loaded.',
      `Node ${process.versions.node} — the binary was built for a different version.`,
      '',
      'The backend would still start, and would silently stop enforcing field',
      '`pattern` validation. See backend/src/services/pattern-validator.ts.',
      '',
      'Fix:  npm rebuild re2',
      '',
      `(${error.message.split('\n')[0]})`
    ])
  }
}
