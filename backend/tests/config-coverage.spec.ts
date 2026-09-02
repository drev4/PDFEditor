import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { KNOWN_VARIABLES } from '../src/config/validate-env.js'

/**
 * Every environment variable this backend reads is declared (features/0028).
 *
 * **This is the half of the feature that keeps working after today.** A list of
 * variables inside `config/validate-env.ts` is a second source of truth about
 * the configuration, and a second source of truth drifts: the next
 * `process.env.SOMETHING_NEW` added anywhere in `src/` is invisible to the
 * validator, and invisible is exactly the failure this feature exists to
 * remove.
 *
 * It is a lint rule in the only shape this repository can run one — the same
 * argument as `tests/async-handler-coverage.spec.ts`, and for the same reason:
 * `npm run lint` lints nothing and there is no ESLint config.
 *
 * **If this failed on you:** add the variable to `KNOWN_VARIABLES` in
 * `src/config/validate-env.ts`. If it has a safe default and warns on nonsense
 * — an `envInt`/`envBool` tunable — put it in the "deliberately unchecked"
 * block with a one-line reason. If getting it wrong is silent, add a rule to
 * `validateEnv` as well.
 */
describe('configuration coverage', () => {
  const SRC = path.join(process.cwd(), 'src')

  function sourceFiles(): string[] {
    const files: string[] = []

    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.name.endsWith('.ts')) files.push(full)
      }
    }
    walk(SRC)

    return files
  }

  /**
   * Three shapes, because this codebase reads the environment in three ways.
   *
   * The third is not decoration: `middleware/rateLimit.ts` never writes
   * `process.env.RATE_LIMIT_LOGIN_MAX`. It stores the *name* on a config object
   * (`limitEnv: 'RATE_LIMIT_LOGIN_MAX'`) and passes it to `envInt` at call
   * time, so a scan that only looked for the first two shapes would report
   * twelve variables as unread and miss them entirely.
   */
  const PATTERNS: readonly RegExp[] = [
    /process\.env\.([A-Z][A-Z0-9_]*)/g,
    /env(?:Int|Bool)\(\s*'([A-Z][A-Z0-9_]*)'/g,
    /(?:windowEnv|limitEnv)\s*:\s*'([A-Z][A-Z0-9_]*)'/g
  ]

  function variablesReadIn(source: string): Set<string> {
    const found = new Set<string>()

    for (const pattern of PATTERNS) {
      for (const match of source.matchAll(pattern)) found.add(match[1])
    }

    return found
  }

  it('declares every variable read anywhere in src/', () => {
    const undeclared: string[] = []

    for (const file of sourceFiles()) {
      // The declaration itself lists every name as a string literal; scanning
      // it would only ever confirm that a list contains itself.
      if (file.endsWith(path.join('config', 'validate-env.ts'))) continue

      const source = fs.readFileSync(file, 'utf8')
      for (const name of variablesReadIn(source)) {
        if (!KNOWN_VARIABLES.includes(name)) {
          undeclared.push(`${path.relative(SRC, file)} reads ${name}`)
        }
      }
    }

    expect(undeclared).toEqual([])
  })

  /**
   * The negative control. A scan that silently matched nothing would pass the
   * assertion above for ever while checking nothing at all, so prove each
   * pattern still finds something real.
   */
  describe('the scan actually matches', () => {
    it('finds a direct process.env read', () => {
      const source = fs.readFileSync(path.join(SRC, 'services', 'webhooks.ts'), 'utf8')
      expect(variablesReadIn(source)).toContain('WEBHOOK_SIGNING_KEY')
    })

    it('finds an envInt call', () => {
      const source = fs.readFileSync(path.join(SRC, 'services', 'pdf-url.ts'), 'utf8')
      expect(variablesReadIn(source)).toContain('UPLOAD_URL_TTL_SECONDS')
    })

    it('finds a rate-limit name held on a config object', () => {
      const source = fs.readFileSync(path.join(SRC, 'middleware', 'rateLimit.ts'), 'utf8')
      expect(variablesReadIn(source)).toContain('RATE_LIMIT_LOGIN_MAX')
    })

    it('reports a variable that is not declared', () => {
      const invented = variablesReadIn('const x = process.env.TOTALLY_INVENTED_VARIABLE')
      expect(invented).toContain('TOTALLY_INVENTED_VARIABLE')
      expect(KNOWN_VARIABLES).not.toContain('TOTALLY_INVENTED_VARIABLE')
    })
  })
})
