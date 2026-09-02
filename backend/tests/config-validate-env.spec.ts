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
    FRONTEND_URL: 'https://app.example.com'
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
