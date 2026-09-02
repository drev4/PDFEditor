import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as Sentry from '@sentry/node'

/**
 * What `beforeSend` actually strips (follow-up to features/0034).
 *
 * The module's own comment calls `beforeSend` "a backstop against a future
 * change that forgets". This file is what holds it to that, and it exists
 * because the first version of the backstop was incomplete in a way no test
 * could see: it deleted `request`, `user` and `breadcrumbs` and nothing else.
 *
 * **The gap was `event.extra`, and the reason it matters is that nothing in the
 * module's configuration prevents it.** When `captureException` is handed a
 * value that is not an `Error`, Sentry's *core* — not an integration, so
 * `defaultIntegrations: false` and `integrations: []` do not touch it —
 * serialises that value's own properties and attaches them as
 * `event.extra.__serialized__`.
 *
 * The path in is the one the feature singles out as mattering most: both
 * `unhandledRejection` handlers pass the raw rejection reason straight through,
 * and a rejection reason is frequently a plain object. On the worker that
 * handler is the only signal that exists.
 *
 * So the assertions here are on the payload after `beforeSend`, with an object
 * shaped like the thing this product must never send: answer values keyed by
 * field id.
 */
vi.mock('@sentry/node', () => ({
  init: vi.fn(),
  setTag: vi.fn(),
  withScope: vi.fn((fn: (s: unknown) => void) => fn({ setTag: vi.fn() })),
  captureException: vi.fn(),
  flush: vi.fn(async () => true)
}))

/** Starts the real module against the mocked SDK, in a strict environment. */
async function beforeSendOf(): Promise<(event: Record<string, unknown>) => unknown> {
  vi.resetModules()
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('SENTRY_DSN', 'https://key@o1.ingest.sentry.io/42')

  const mod = await import('../src/services/error-tracking.js')
  mod.initErrorTracking('api')

  const options = vi.mocked(Sentry.init).mock.calls[0]![0] as Record<string, unknown>
  return options.beforeSend as (event: Record<string, unknown>) => unknown
}

describe('beforeSend', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  it('strips the request, the user and the breadcrumbs', async () => {
    const beforeSend = await beforeSendOf()

    const cleaned = beforeSend({
      request: { data: { 'field-9f2a': 'Dr Ana Ruiz' } },
      user: { email: 'ana@example.com' },
      breadcrumbs: [{ message: 'POST /api/responses' }],
      exception: { values: [] }
    }) as Record<string, unknown>

    expect(cleaned.request).toBeUndefined()
    expect(cleaned.user).toBeUndefined()
    expect(cleaned.breadcrumbs).toBeUndefined()
  })

  /**
   * The gap this file was written for. A promise rejected with a plain object
   * — not an `Error` — reaches `captureError` from the `unhandledRejection`
   * guard, and Sentry core serialises its properties into `event.extra`.
   */
  it('strips the serialised copy of a non-Error rejection reason', async () => {
    const beforeSend = await beforeSendOf()

    const cleaned = beforeSend({
      exception: { values: [{ type: 'Object', value: 'Object captured as exception' }] },
      // The shape Sentry core produces for a non-Error capture.
      extra: {
        __serialized__: {
          'field-9f2a': 'Dr Ana Ruiz',
          'field-77c1': 'ana@example.com',
          authorization: 'Bearer leaked-credential'
        }
      }
    }) as Record<string, unknown>

    expect(cleaned.extra).toBeUndefined()
    expect(JSON.stringify(cleaned)).not.toContain('Dr Ana Ruiz')
    expect(JSON.stringify(cleaned)).not.toContain('leaked-credential')
  })

  it('strips contexts, which is the other place arbitrary state lands', async () => {
    const beforeSend = await beforeSendOf()

    const cleaned = beforeSend({
      exception: { values: [] },
      contexts: { state: { answers: { 'field-9f2a': 'Dr Ana Ruiz' } } }
    }) as Record<string, unknown>

    expect(cleaned.contexts).toBeUndefined()
    expect(JSON.stringify(cleaned)).not.toContain('Dr Ana Ruiz')
  })

  it('keeps what the allowlist is for', async () => {
    const beforeSend = await beforeSendOf()

    const cleaned = beforeSend({
      exception: { values: [{ type: 'Error', value: 'the database went away' }] },
      tags: { requestId: 'the-request-id', route: '/api/forms/:id' }
    }) as Record<string, unknown>

    // Stripping everything would be safe and useless. The message, the stack
    // and the correlation tags are the whole point.
    expect(JSON.stringify(cleaned)).toContain('the database went away')
    expect(JSON.stringify(cleaned)).toContain('the-request-id')
  })
})
