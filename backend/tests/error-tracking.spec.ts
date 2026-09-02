import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { errorHandler, AppError } from '../src/middleware/errorHandler'
import { captureError } from '../src/services/error-tracking'

/**
 * Error tracking (features/0034).
 *
 * Two properties are asserted here and the second is the one that matters.
 *
 *  - a 5xx is reported and a 4xx is not;
 *  - **nothing the request carried reaches the tracker** — no body, no query
 *    string, no headers.
 *
 * Note *where* the second assertion is made: on the arguments handed to
 * `captureError`, not on what the SDK would eventually serialise. That is the
 * stricter place, and it is the same choice `tests/request-log.spec.ts` makes
 * about pino — a `beforeSend` that stripped a body would hide a value that had
 * still been collected, while asserting here says it was never gathered.
 *
 * The DSN is unset in every suite, so nothing here reaches a network. The
 * module under test is mocked anyway, because the subject is *what the error
 * handler decides to report*, not what Sentry does with it.
 */
vi.mock('../src/services/error-tracking', () => ({
  captureError: vi.fn(),
  initErrorTracking: vi.fn(),
  flushErrorTracking: vi.fn(async () => {}),
  isErrorTrackingEnabled: vi.fn(() => true)
}))

const captured = vi.mocked(captureError)

describe('what the error handler reports', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  /**
   * A request carrying every shape of sensitive value this API actually
   * handles: an answer body keyed by field id, a token in the query string and
   * a credential in a header.
   */
  function appThatFailsWith(err: Error) {
    const app = express()
    app.use(express.json())
    app.post('/api/things/:id', (_req, _res, next) => next(err))
    app.use(errorHandler)
    return app
  }

  async function failWith(err: Error) {
    await request(appThatFailsWith(err))
      .post('/api/things/abc?token=secret-in-the-query')
      .set('Authorization', 'Bearer leaked-credential')
      .set('Cookie', 'refresh_token=leaked-cookie')
      .send({
        'field-9f2a': 'Dr Ana Ruiz',
        'field-77c1': 'ana@example.com',
        'field-4b30': 'a private answer'
      })
  }

  it('reports a thrown error that is not an AppError', async () => {
    await failWith(new Error('the database went away'))

    expect(captured).toHaveBeenCalledTimes(1)
  })

  it('reports a 5xx AppError', async () => {
    await failWith(new AppError(503, 'upstream unavailable'))

    expect(captured).toHaveBeenCalledTimes(1)
  })

  /**
   * The one that keeps this useful. A 4xx is the API answering correctly — the
   * login page calls `/api/auth/refresh` with no cookie on every anonymous
   * page load and correctly gets a 401. Reporting those buries the real fault
   * and spends the quota that would have caught it.
   */
  it('does not report a 4xx', async () => {
    await failWith(new AppError(404, 'Form not found'))

    expect(captured).not.toHaveBeenCalled()
  })

  it('does not report a 403 either', async () => {
    await failWith(new AppError(403, 'Sign-ups are invitation-only right now.'))

    expect(captured).not.toHaveBeenCalled()
  })

  it('sends nothing the request carried', async () => {
    await failWith(new Error('the database went away'))

    const payload = JSON.stringify(captured.mock.calls[0])

    // The body: answer values typed by a member of the public.
    expect(payload).not.toContain('Dr Ana Ruiz')
    expect(payload).not.toContain('ana@example.com')
    expect(payload).not.toContain('a private answer')
    // Their field ids are data too — that is why a denylist cannot work here.
    expect(payload).not.toContain('field-9f2a')
    // Credentials.
    expect(payload).not.toContain('leaked-credential')
    expect(payload).not.toContain('leaked-cookie')
    // The query string.
    expect(payload).not.toContain('secret-in-the-query')
  })

  it('sends the status and the route pattern rather than the URL', async () => {
    await failWith(new Error('the database went away'))

    const [, context] = captured.mock.calls[0] as [unknown, Record<string, unknown>]

    expect(context.statusCode).toBe(500)
    // The pattern groups events by endpoint, and a path that happened to hold
    // an id or a token never reaches the tracker. Same rule as the log line.
    expect(context.route).toBe('/api/things/:id')
    expect(String(context.route)).not.toContain('abc')
  })

  it('carries the request id, so the event joins the server log line', async () => {
    const app = express()
    app.use((req, _res, next) => {
      ;(req as express.Request & { requestId?: string }).requestId = 'the-request-id'
      next()
    })
    app.get('/api/things', (_req, _res, next) => next(new Error('boom')))
    app.use(errorHandler)

    await request(app).get('/api/things')

    const [, context] = captured.mock.calls[0] as [unknown, Record<string, unknown>]
    expect(context.requestId).toBe('the-request-id')
  })
})

/**
 * The module's own behaviour when nothing is configured, which is the state
 * every suite and every developer machine runs in.
 */
describe('when no DSN is configured', () => {
  const original = process.env.SENTRY_DSN

  afterEach(() => {
    if (original === undefined) delete process.env.SENTRY_DSN
    else process.env.SENTRY_DSN = original
  })

  it('does not report and does not throw', async () => {
    delete process.env.SENTRY_DSN
    const real = await vi.importActual<typeof import('../src/services/error-tracking')>(
      '../src/services/error-tracking'
    )

    real.initErrorTracking('api')

    expect(real.isErrorTrackingEnabled()).toBe(false)
    // The error path of every request runs through this. It must never be the
    // thing that fails.
    expect(() => real.captureError(new Error('boom'), { requestId: 'x' })).not.toThrow()
    await expect(real.flushErrorTracking()).resolves.toBeUndefined()
  })

  it('stays off in development even when a DSN is present', async () => {
    process.env.SENTRY_DSN = 'https://publickey@o0.ingest.sentry.io/1'
    const real = await vi.importActual<typeof import('../src/services/error-tracking')>(
      '../src/services/error-tracking'
    )

    // vitest.config.ts pins NODE_ENV=test, which `isStrict` treats as lenient.
    real.initErrorTracking('api')

    expect(real.isErrorTrackingEnabled()).toBe(false)
  })
})
