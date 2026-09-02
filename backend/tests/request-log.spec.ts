import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import pino from 'pino'
import { Writable } from 'stream'
import { requestLog } from '../src/middleware/requestLog'
import { logger, REDACT } from '../src/services/logger'

/**
 * The request log (features/0025).
 *
 * Two things are asserted, and the second is the one that matters:
 *
 *  - a request gets an id and one completion line;
 *  - **nothing that request carried reaches the log** — no `Authorization`, no
 *    cookie, and above all no body, because a body on this API is answer values
 *    typed by a member of the public.
 *
 * Note *where* that second assertion is made. It reads the arguments handed to
 * pino rather than the bytes pino writes, and that is deliberately the stricter
 * place: redaction would hide a secret in the output while it was still being
 * collected. Asserting here says the value was never gathered at all.
 */
describe('request logging', () => {
  /** Captures the child logger the middleware builds for the request. */
  function captureLines() {
    const lines: unknown[][] = []
    vi.spyOn(logger, 'child').mockReturnValue({
      info: (...args: unknown[]) => lines.push(args),
      error: (...args: unknown[]) => lines.push(args),
      warn: (...args: unknown[]) => lines.push(args)
    } as never)
    return lines
  }

  function appWith(handler: express.RequestHandler) {
    const app = express()
    app.use(express.json())
    app.use(requestLog)
    app.post('/api/things/:id', handler)
    app.get('/health', (_req, res) => { res.json({ status: 'ok' }) })
    return app
  }

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('logs one completion line naming the route, status and duration', async () => {
    const lines = captureLines()
    const app = appWith((_req, res) => { res.status(201).json({ ok: true }) })

    await request(app).post('/api/things/abc').send({ hello: 'world' })

    expect(lines).toHaveLength(1)
    const [fields, message] = lines[0] as [Record<string, unknown>, string]
    expect(message).toBe('request completed')
    // The matched route, not the URL: lines group by endpoint, and an id in a
    // path never becomes a log field by accident.
    expect(fields.route).toBe('/api/things/:id')
    expect(fields.status).toBe(201)
    expect(typeof fields.durationMs).toBe('number')
  })

  it('gives every request its own id', async () => {
    const seen: string[] = []
    vi.spyOn(logger, 'child').mockImplementation((bindings: Record<string, unknown>) => {
      seen.push(String(bindings.requestId))
      return { info: () => {}, error: () => {}, warn: () => {} } as never
    })
    const app = appWith((_req, res) => { res.json({ ok: true }) })

    await request(app).post('/api/things/a').send({})
    await request(app).post('/api/things/b').send({})

    expect(seen).toHaveLength(2)
    expect(seen[0]).not.toBe(seen[1])
    expect(seen[0]).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('never logs the body, the Authorization header or a cookie', async () => {
    const lines = captureLines()
    const app = appWith((_req, res) => { res.json({ ok: true }) })

    await request(app)
      .post('/api/things/abc')
      .set('Authorization', 'Bearer super-secret-token')
      .set('Cookie', 'refreshToken=another-secret')
      .send({ answers: { 'field-1': 'my home address' } })

    const serialised = JSON.stringify(lines)
    expect(serialised).not.toContain('super-secret-token')
    expect(serialised).not.toContain('another-secret')
    // The one that matters most: an answer is a member of the public's data,
    // and it is not this application's to write into a log file.
    expect(serialised).not.toContain('my home address')
    expect(serialised).not.toContain('field-1')
  })

  it('records an upstream request id as a field, and never adopts it as the id', async () => {
    const bindings: Record<string, unknown>[] = []
    const lines: unknown[][] = []
    vi.spyOn(logger, 'child').mockImplementation((b: Record<string, unknown>) => {
      bindings.push(b)
      return {
        info: (...args: unknown[]) => lines.push(args),
        error: () => {},
        warn: () => {}
      } as never
    })
    const app = appWith((_req, res) => { res.json({ ok: true }) })

    await request(app).post('/api/things/abc').set('X-Request-Id', 'chosen-by-the-caller').send({})

    // Ours, generated here. Adopting a caller's value would let somebody repeat
    // an id to interleave their requests with another customer's.
    expect(bindings[0]!.requestId).not.toBe('chosen-by-the-caller')
    expect(bindings[0]!.requestId).toMatch(/^[0-9a-f-]{36}$/)
    // But the trace is not lost.
    const [fields] = lines[0] as [Record<string, unknown>]
    expect(fields.upstreamRequestId).toBe('chosen-by-the-caller')
  })

  it('truncates an upstream id rather than putting a payload on every line', async () => {
    const lines = captureLines()
    const app = appWith((_req, res) => { res.json({ ok: true }) })

    await request(app)
      .post('/api/things/abc')
      .set('X-Request-Id', 'x'.repeat(5000))
      .send({})

    const [fields] = lines[0] as [Record<string, unknown>]
    expect(String(fields.upstreamRequestId)).toHaveLength(128)
  })

  it('says nothing about /health, which a load balancer calls for ever', async () => {
    const lines = captureLines()
    const app = appWith((_req, res) => { res.json({ ok: true }) })

    await request(app).get('/health')

    expect(lines).toHaveLength(0)
  })

  /**
   * The id has to leave the process to be worth anything (features/0034).
   *
   * Until this feature the id existed only in the log: `req.log` carried it and
   * nothing ever sent it back. So a browser-side error report and the server
   * line that explains it could not be joined — which is the whole stated value
   * of putting error tracking on both sides.
   */
  describe('the response header', () => {
    it('returns the request id to the caller', async () => {
      captureLines()
      const app = appWith((_req, res) => { res.json({ ok: true }) })

      const res = await request(app).post('/api/things/abc').send({})

      expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
    })

    it('returns the id it generated, never the one the caller sent', async () => {
      captureLines()
      const app = appWith((_req, res) => { res.json({ ok: true }) })

      const res = await request(app)
        .post('/api/things/abc')
        .set('X-Request-Id', 'chosen-by-the-caller')
        .send({})

      // Echoing the caller's value back would make the header useless as a
      // correlation key and would reflect an attacker-chosen string.
      expect(res.headers['x-request-id']).not.toBe('chosen-by-the-caller')
      expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
    })

    it('sets the header even on a path that is not logged', async () => {
      captureLines()
      const app = appWith((_req, res) => { res.json({ ok: true }) })

      // `/health` returns early from the logging branch. The header is set
      // before that return, so a health check is still traceable.
      const res = await request(app).get('/health')

      expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
    })

    it('matches the id the log line was written under', async () => {
      const bindings: Record<string, unknown>[] = []
      vi.spyOn(logger, 'child').mockImplementation((b: Record<string, unknown>) => {
        bindings.push(b)
        return { info: () => {}, error: () => {}, warn: () => {} } as never
      })
      const app = appWith((_req, res) => { res.json({ ok: true }) })

      const res = await request(app).post('/api/things/abc').send({})

      // The point of the whole exercise: the value a browser can read is the
      // value the server logged under.
      expect(res.headers['x-request-id']).toBe(bindings[0]!.requestId)
    })
  })
})

/**
 * Redaction, driven through the **real** configuration rather than a copy of
 * it: a spec asserting one list against another only proves somebody typed the
 * same thing twice.
 *
 * This is the backstop, not the mechanism — nothing is supposed to hand these
 * values to the logger in the first place (see `services/logger.ts`).
 */
describe('redaction', () => {
  function write(value: unknown): string {
    let written = ''
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        written += String(chunk)
        callback()
      }
    })
    const testLogger = pino({ level: 'info', redact: REDACT }, destination)
    testLogger.info(value as object, 'test')
    return written
  }

  it('censors a credential that reaches the logger anyway', () => {
    const output = write({ authorization: 'Bearer leaked', nested: { password: 'hunter2' } })

    expect(output).not.toContain('Bearer leaked')
    expect(output).not.toContain('hunter2')
    expect(output).toContain('[redacted]')
  })

  it('does not censor ordinary fields', () => {
    const output = write({ formId: 'form-1', status: 200 })

    expect(output).toContain('form-1')
  })
})
