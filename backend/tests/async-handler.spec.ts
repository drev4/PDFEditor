import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { asyncHandler } from '../src/middleware/asyncHandler'
import { AppError, errorHandler } from '../src/middleware/errorHandler'
import { logger } from '../src/services/logger'

/**
 * `asyncHandler` (features/0026).
 *
 * Express 4 does not forward a rejected promise from an `async` handler: it
 * never learns, so **the request is never answered** and the caller waits for a
 * timeout. Node 22 also raises `unhandledRejection`, which `process-guards.ts`
 * survives since features/0017 — so the process lives and the request does not.
 *
 * The first test below is the one that matters. Written against a bare Express
 * app with no wrapper it does not fail cleanly; it **hangs**, which is exactly
 * the defect being fixed and the reason a timeout is set on it.
 */
describe('asyncHandler', () => {
  beforeEach(() => {
    vi.spyOn(logger, 'error').mockImplementation(() => {})
    vi.spyOn(logger, 'info').mockImplementation(() => {})
  })

  /** An app with one route, mounted however the test asks for. */
  function appWith(handler: express.RequestHandler) {
    const app = express()
    app.get('/boom', handler)
    app.use(errorHandler)
    return app
  }

  it('answers 500 when an async handler rejects, instead of hanging', async () => {
    const app = appWith(
      asyncHandler(async () => {
        throw new Error('nobody caught this')
      })
    )

    const res = await request(app).get('/boom')

    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: 'Internal server error' })
  }, 5000)

  it('carries an AppError through to its own status, exactly as a catch did', async () => {
    const app = appWith(
      asyncHandler(async () => {
        throw new AppError(404, 'Form not found')
      })
    )

    const res = await request(app).get('/boom')

    // The whole conversion depends on this: unwrapping a `try`/`catch` that only
    // called `next(error)` must not change a single response.
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Form not found' })
  })

  it('does not interfere with a handler that answers normally', async () => {
    const app = appWith(
      asyncHandler(async (_req, res) => {
        res.status(201).json({ ok: true })
      })
    )

    const res = await request(app).get('/boom')

    expect(res.status).toBe(201)
    expect(res.body).toEqual({ ok: true })
  })

  it('forwards a synchronous throw too', async () => {
    const app = appWith(
      asyncHandler(() => {
        throw new AppError(400, 'Validation error')
      })
    )

    // A wrapper that only handled promises would leave the synchronous case to
    // Express — which does catch it — but the two must not answer differently.
    const res = await request(app).get('/boom')

    expect(res.status).toBe(400)
  })

  it('works as middleware, which is as exposed as a handler', async () => {
    const app = express()
    app.use(
      asyncHandler(async () => {
        throw new AppError(401, 'Not authenticated')
      })
    )
    app.get('/boom', (_req, res) => { res.json({ reached: true }) })
    app.use(errorHandler)

    const res = await request(app).get('/boom')

    // `identifyApiKey` and `requireApiAccess` are mounted exactly like this on
    // `/api/v1`; a rejection there hangs the request just as surely.
    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: 'Not authenticated' })
  })

  /**
   * A stream that fails mid-write is the real shape of this: the PDF route
   * writes bytes and can fail afterwards. Measured before the guard was added —
   * an error handler with no `headersSent` check throws
   * `Cannot set headers after they are sent to the client` **from inside the
   * error handler**, which is a crash on top of a failure.
   */
  describe('when the response has already been sent', () => {
    it('logs and closes the connection instead of answering twice', async () => {
      const logged: unknown[][] = []
      vi.mocked(logger.error).mockImplementation((...args: unknown[]) => {
        logged.push(args)
      })

      const app = appWith(
        asyncHandler(async (_req, res) => {
          res.status(200).write('half a body')
          throw new Error('failed after the headers went out')
        })
      )

      // The client sees the connection go away mid-body. That is the honest
      // outcome: the bytes already sent cannot be unsent, and a truncated
      // response is what a broken stream is.
      await expect(request(app).get('/boom')).rejects.toThrow(/aborted/i)

      // And the server said why, once, rather than throwing over it.
      expect(logged).toHaveLength(1)
      expect(logged[0]![1]).toBe('request failed after the response had started')
    })
  })
})
