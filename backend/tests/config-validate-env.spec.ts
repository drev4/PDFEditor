import { describe, it, expect } from 'vitest'
import { validateEnv, isStrict } from '../src/config/validate-env.js'

/**
 * Boot-time configuration validation (features/0028).
 *
 * Every case here passes a literal environment object. Nothing in this file
 * touches `process.env`, which is the reason `validateEnv` takes the
 * environment as an argument at all: these specs run inside the same process as
 * every other suite, and a test that mutated the real environment would leak
 * into whichever spec ran next.
 */

/** A strict environment with nothing wrong in it. */
function validStrictApi(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    JWT_SECRET: 'x'.repeat(32),
    DATABASE_URL: 'postgresql://user:pw@db:5432/vuepdf',
    BASE_URL: 'https://api.example.com',
    FRONTEND_URL: 'https://app.example.com',
    // Required explicitly in a strict environment (features/0033). It is here
    // rather than defaulted because the default is `open`, and a deployment
    // that never said so is exactly the case the rule exists to catch.
    REGISTRATION_MODE: 'open'
  }
}

describe('validateEnv', () => {
  describe('strictness is an allowlist on NODE_ENV', () => {
    it('is lenient for exactly "development" and "test"', () => {
      expect(isStrict({ NODE_ENV: 'development' })).toBe(false)
      expect(isStrict({ NODE_ENV: 'test' })).toBe(false)
    })

    /**
     * The case the allowlist exists for. `NODE_ENV !== 'production'` would make
     * this lenient, and a process manager that drops the variable is an
     * ordinary way a real deployment arrives here.
     */
    it('is strict when NODE_ENV is unset', () => {
      expect(isStrict({})).toBe(true)
      expect(validateEnv({}, 'api').length).toBeGreaterThan(0)
    })

    it('is strict for an environment nobody planned for', () => {
      expect(isStrict({ NODE_ENV: 'staging' })).toBe(true)
      expect(isStrict({ NODE_ENV: 'Production' })).toBe(true)
      expect(isStrict({ NODE_ENV: ' development ' })).toBe(false) // trimmed
    })

    it('accepts an empty environment when lenient', () => {
      expect(validateEnv({ NODE_ENV: 'test' }, 'api')).toEqual([])
      expect(validateEnv({ NODE_ENV: 'development' }, 'worker')).toEqual([])
    })
  })

  describe('a valid strict environment', () => {
    it('reports nothing for the api', () => {
      expect(validateEnv(validStrictApi(), 'api')).toEqual([])
    })

    it('reports nothing for the worker, which needs no URLs', () => {
      const env = validStrictApi()
      delete env.BASE_URL
      delete env.FRONTEND_URL

      expect(validateEnv(env, 'worker')).toEqual([])
    })
  })

  describe('required variables in strict mode', () => {
    it.each([
      ['JWT_SECRET', 'JWT_SECRET'],
      ['DATABASE_URL', 'DATABASE_URL'],
      ['BASE_URL', 'BASE_URL'],
      ['FRONTEND_URL', 'FRONTEND_URL']
    ])('reports %s when it is missing', (name, expected) => {
      const env = validStrictApi()
      delete env[name]

      expect(validateEnv(env, 'api').join('\n')).toContain(expected)
    })

    it('treats a whitespace-only value as missing', () => {
      const env = { ...validStrictApi(), JWT_SECRET: '   ' }
      expect(validateEnv(env, 'api').join('\n')).toContain('JWT_SECRET is missing')
    })

    /**
     * All of them, not the first. A deploy missing three variables must learn
     * all three from one restart.
     */
    it('reports every problem at once rather than stopping at the first', () => {
      const problems = validateEnv({ NODE_ENV: 'production' }, 'api')

      expect(problems.length).toBeGreaterThanOrEqual(4)
      const joined = problems.join('\n')
      for (const name of ['JWT_SECRET', 'DATABASE_URL', 'BASE_URL', 'FRONTEND_URL']) {
        expect(joined).toContain(name)
      }
    })

    it('rejects a JWT_SECRET shorter than 32 characters', () => {
      const env = { ...validStrictApi(), JWT_SECRET: 'short' }
      expect(validateEnv(env, 'api').join('\n')).toContain('5 characters')
    })

    it('does not ask the worker for BASE_URL or FRONTEND_URL', () => {
      const env = validStrictApi()
      delete env.BASE_URL
      delete env.FRONTEND_URL

      expect(validateEnv(env, 'worker').join('\n')).not.toContain('BASE_URL')
      expect(validateEnv(env, 'worker').join('\n')).not.toContain('FRONTEND_URL')
    })
  })

  describe('URL shape', () => {
    it('rejects a BASE_URL that is not a URL', () => {
      const env = { ...validStrictApi(), BASE_URL: 'api.example.com' }
      expect(validateEnv(env, 'api').join('\n')).toContain('is not a URL')
    })

    it('rejects a non-http scheme', () => {
      const env = { ...validStrictApi(), FRONTEND_URL: 'ftp://app.example.com' }
      expect(validateEnv(env, 'api').join('\n')).toContain('expected http or https')
    })

    /**
     * `services/pdf-url.ts` concatenates `BASE_URL` with `/uploads/pdfs/...`,
     * so a trailing slash is a double slash in every signed link.
     */
    it('rejects a trailing slash on BASE_URL', () => {
      const env = { ...validStrictApi(), BASE_URL: 'https://api.example.com/' }
      expect(validateEnv(env, 'api').join('\n')).toContain('trailing slash')
    })

    it('rejects a DATABASE_URL that is not PostgreSQL', () => {
      const env = { ...validStrictApi(), DATABASE_URL: 'mysql://user@db/vuepdf' }
      expect(validateEnv(env, 'api').join('\n')).toContain('expected postgresql')
    })
  })

  describe('shape errors are reported in every environment', () => {
    const lenient = { NODE_ENV: 'test' }

    it('rejects an unknown PDF_STORAGE_DRIVER', () => {
      const env = { ...lenient, PDF_STORAGE_DRIVER: 'gcs' }
      expect(validateEnv(env, 'api').join('\n')).toContain('is not a driver')
    })

    it('rejects s3 with no bucket', () => {
      const env = { ...lenient, PDF_STORAGE_DRIVER: 's3' }
      expect(validateEnv(env, 'api').join('\n')).toContain('PDF_STORAGE_BUCKET')
    })

    it('accepts s3 with a bucket', () => {
      const env = { ...lenient, PDF_STORAGE_DRIVER: 's3', PDF_STORAGE_BUCKET: 'forms' }
      expect(validateEnv(env, 'api')).toEqual([])
    })

    it('rejects a WEBHOOK_SIGNING_KEY that is not 32 bytes', () => {
      const env = { ...lenient, WEBHOOK_SIGNING_KEY: Buffer.alloc(16).toString('base64') }
      expect(validateEnv(env, 'api').join('\n')).toContain('16 ')
    })

    it('accepts a 32-byte WEBHOOK_SIGNING_KEY', () => {
      const env = { ...lenient, WEBHOOK_SIGNING_KEY: Buffer.alloc(32).toString('base64') }
      expect(validateEnv(env, 'api')).toEqual([])
    })

    it('rejects a REDIS_URL with the wrong scheme', () => {
      const env = { ...lenient, REDIS_URL: 'http://redis:6379' }
      expect(validateEnv(env, 'api').join('\n')).toContain('expected redis or rediss')
    })

    it.each(['redis://redis:6379', 'rediss://redis:6380'])('accepts %s', url => {
      expect(validateEnv({ ...lenient, REDIS_URL: url }, 'worker')).toEqual([])
    })

    it('rejects a TRUST_PROXY_HOPS that is not a non-negative integer', () => {
      expect(validateEnv({ ...lenient, TRUST_PROXY_HOPS: 'true' }, 'api').join('\n'))
        .toContain('TRUST_PROXY_HOPS')
      expect(validateEnv({ ...lenient, TRUST_PROXY_HOPS: '-1' }, 'api').join('\n'))
        .toContain('TRUST_PROXY_HOPS')
      expect(validateEnv({ ...lenient, TRUST_PROXY_HOPS: '0' }, 'api')).toEqual([])
    })
  })

  describe('Stripe is checked as a group', () => {
    const lenient = { NODE_ENV: 'test' }

    it('says nothing when billing is simply off', () => {
      expect(validateEnv(lenient, 'api')).toEqual([])
    })

    it('rejects a secret key with no webhook secret', () => {
      const env = { ...lenient, STRIPE_SECRET_KEY: 'sk_live_x', STRIPE_PRICE_PRO: 'price_x' }
      expect(validateEnv(env, 'api').join('\n')).toContain('STRIPE_WEBHOOK_SECRET')
    })

    it('rejects a secret key with no price at all', () => {
      const env = { ...lenient, STRIPE_SECRET_KEY: 'sk_live_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' }
      expect(validateEnv(env, 'api').join('\n')).toContain('STRIPE_PRICE_PRO')
    })

    it('accepts either price on its own', () => {
      const base = { ...lenient, STRIPE_SECRET_KEY: 'sk_live_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' }
      expect(validateEnv({ ...base, STRIPE_PRICE_PRO: 'price_pro' }, 'api')).toEqual([])
      expect(validateEnv({ ...base, STRIPE_PRICE_TEAM: 'price_team' }, 'api')).toEqual([])
    })

    it('does not ask the worker about Stripe', () => {
      const env = { ...lenient, STRIPE_SECRET_KEY: 'sk_live_x' }
      expect(validateEnv(env, 'worker')).toEqual([])
    })
  })

  /**
   * Closed registration (features/0033).
   *
   * `config/registration.ts` defaults an unset mode to `open`. These cases are
   * the half that makes that default safe — without them a production deploy
   * that forgot the variable would run an open private beta and nothing would
   * say so.
   */
  describe('REGISTRATION_MODE', () => {
    it('is required when strict', () => {
      const env = validStrictApi()
      delete env.REGISTRATION_MODE

      const problems = validateEnv(env, 'api')
      expect(problems).toHaveLength(1)
      expect(problems[0]).toContain('REGISTRATION_MODE is missing')
    })

    /**
     * The same argument JWT_SECRET makes: the two processes are one image
     * reading one environment, so a rule that held for the API alone would
     * boot the worker and fail the API one deploy later.
     */
    it('is required for the worker too', () => {
      const env = validStrictApi()
      delete env.REGISTRATION_MODE
      delete env.BASE_URL
      delete env.FRONTEND_URL

      expect(validateEnv(env, 'worker').join(' ')).toContain('REGISTRATION_MODE')
    })

    it('is not required when lenient', () => {
      expect(validateEnv({ NODE_ENV: 'development' }, 'api')).toEqual([])
    })

    /**
     * A shape error, so it is reported in development too — `inviteonly` is
     * not a missing value, it is a value that cannot work.
     */
    it('rejects an unrecognised mode in every environment', () => {
      const lenient = validateEnv(
        { NODE_ENV: 'development', REGISTRATION_MODE: 'inviteonly' },
        'api'
      )
      expect(lenient.join(' ')).toContain('REGISTRATION_MODE="inviteonly" is not a mode')

      const env = validStrictApi()
      env.REGISTRATION_MODE = 'closed'
      expect(validateEnv(env, 'api').join(' ')).toContain('is not a mode')
    })

    it('accepts both modes', () => {
      const env = validStrictApi()
      env.REGISTRATION_MODE = 'invite_only'
      env.REGISTRATION_CODE = 'a-code-long-enough-to-pass'

      expect(validateEnv(env, 'api')).toEqual([])
    })

    /**
     * The configuration that must not start: closed, with no code that can
     * ever match, so there is no way back in short of another deploy — which
     * is the one thing this switch exists to avoid.
     */
    it('requires a code when the mode is invite_only', () => {
      const env = validStrictApi()
      env.REGISTRATION_MODE = 'invite_only'

      const problems = validateEnv(env, 'api')
      expect(problems).toHaveLength(1)
      expect(problems[0]).toContain('requires REGISTRATION_CODE')
    })

    it('rejects a code that is too short to be a credential', () => {
      const env = validStrictApi()
      env.REGISTRATION_MODE = 'invite_only'
      env.REGISTRATION_CODE = 'beta2026'

      const problems = validateEnv(env, 'api')
      expect(problems).toHaveLength(1)
      expect(problems[0]).toContain('REGISTRATION_CODE is 8 characters')
    })

    it('does not ask for a code when registration is open', () => {
      const env = validStrictApi()
      env.REGISTRATION_MODE = 'open'

      expect(validateEnv(env, 'api')).toEqual([])
    })
  })

  /**
   * Error tracking (features/0034).
   *
   * Optional, so absence is never a problem — but a value that is present and
   * unusable is, because the SDK does not reject a bad DSN. It disables itself
   * quietly, and the process then boots, serves and reports nothing. That was
   * observed, not assumed: an API started with `SENTRY_DSN=totally-not-a-dsn`
   * logged nothing at all. Same rule as `WEBHOOK_SIGNING_KEY`.
   */
  describe('SENTRY_DSN', () => {
    it('is optional — an absent one is not a problem', () => {
      const env = validStrictApi()
      delete env.SENTRY_DSN

      expect(validateEnv(env, 'api')).toEqual([])
    })

    it('accepts a real DSN', () => {
      const env = validStrictApi()
      env.SENTRY_DSN = 'https://abc123@o4507.ingest.de.sentry.io/42'

      expect(validateEnv(env, 'api')).toEqual([])
    })

    it('rejects a value that is not a URL at all', () => {
      const env = validStrictApi()
      env.SENTRY_DSN = 'totally-not-a-dsn'

      const problems = validateEnv(env, 'api')
      expect(problems).toHaveLength(1)
      expect(problems[0]).toContain('is not a DSN')
    })

    it('rejects a scheme the SDK will not post to', () => {
      const env = validStrictApi()
      env.SENTRY_DSN = 'ftp://abc123@ingest.example.com/42'

      expect(validateEnv(env, 'api').join(' ')).toContain('is not a DSN')
    })

    /**
     * A shape error, so development hears about it too — the same treatment
     * `PDF_STORAGE_DRIVER` gets.
     */
    it('is checked in a lenient environment as well', () => {
      const problems = validateEnv(
        { NODE_ENV: 'development', SENTRY_DSN: 'nonsense' },
        'api'
      )

      expect(problems.join(' ')).toContain('SENTRY_DSN')
    })

    it('is checked for the worker too', () => {
      const env = validStrictApi()
      env.SENTRY_DSN = 'nonsense'
      delete env.BASE_URL
      delete env.FRONTEND_URL

      expect(validateEnv(env, 'worker').join(' ')).toContain('SENTRY_DSN')
    })
  })

  /**
   * The messages are the deliverable. An operator reading one at 3am must be
   * able to act without opening this repository, which means every message
   * names its variable and says what goes wrong if it is left alone.
   */
  describe('message quality', () => {
    it('names the variable in every message', () => {
      const problems = validateEnv({ NODE_ENV: 'production', PDF_STORAGE_DRIVER: 'gcs' }, 'api')
      expect(problems.length).toBeGreaterThan(0)

      for (const problem of problems) {
        expect(problem).toMatch(/^[A-Z][A-Z0-9_]+/)
      }
    })
  })
})
