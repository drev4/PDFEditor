import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as Sentry from '@sentry/vue'
import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
type TrackingModule = typeof import('./error-tracking')

/**
 * A fresh copy of the module for each test.
 *
 * `enabled` is module-level state that is set once and never reset — correct
 * for a process that boots once, and something the tests have to work around
 * rather than something to add a reset for. Without this, a test asserting the
 * module is off would see the `enabled` left behind by the test before it.
 */
async function freshModule(): Promise<TrackingModule> {
  vi.resetModules()
  return import('./error-tracking')
}

/**
 * Error tracking in the SPA (features/0034).
 *
 * The subject is **what this module decides to send**, not what Sentry does
 * with it, so the SDK is mocked and the assertions are on the options and the
 * calls it is handed. That is the same choice the backend spec makes, and the
 * same one `request-log.spec.ts` makes about pino: asserting on the arguments
 * is stricter than asserting on the output, because a value stripped later was
 * still collected.
 */
vi.mock('@sentry/vue', () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  withScope: vi.fn((fn: (scope: unknown) => void) =>
    fn({ setTag: vi.fn(), setContext: vi.fn(), setUser: vi.fn() })
  )
}))

function routerWith(path: string) {
  const router = createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/dashboard/editor', name: 'editor', component: { template: '<div/>' } },
      {
        path: '/form/:shareId',
        name: 'public-form',
        component: { template: '<div/>' },
        meta: { public: true }
      },
      {
        path: '/invitations/:token',
        name: 'accept-invitation',
        component: { template: '<div/>' },
        meta: { public: true }
      }
    ]
  })
  return { router, ready: router.push(path).then(() => router.isReady()) }
}

async function start(path: string, dsn = 'https://key@o1.ingest.sentry.io/42') {
  vi.stubEnv('VITE_SENTRY_DSN', dsn)
  // `import.meta.env.DEV` is true under Vitest, and the module refuses to
  // initialise in development on purpose. Force the production branch.
  vi.stubEnv('DEV', '')

  const mod = await freshModule()
  const app = createApp({ template: '<div/>' })
  const { router, ready } = routerWith(path)
  await ready

  mod.initErrorTracking(app, router)
  return { app, router, ...mod }
}

describe('SPA error tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  describe('what it never turns on', () => {
    it('enables no default integrations and no replay', async () => {
      await start('/dashboard/editor')

      const options = vi.mocked(Sentry.init).mock.calls[0]![0] as Record<string, unknown>

      // The default set records a breadcrumb for every fetch and console call.
      // A fetch URL here carries a shareId; a console line carries anything.
      expect(options.defaultIntegrations).toBe(false)
      expect(options.integrations).toEqual([])
      expect(options.sendDefaultPii).toBe(false)
      // Session Replay would record a respondent typing their answers in. It
      // is off because it is never switched on: no replay integration, and
      // neither sample rate is set to anything.
      expect(options.replaysSessionSampleRate).toBeUndefined()
      expect(options.replaysOnErrorSampleRate).toBeUndefined()
      expect(Object.keys(options).filter(k => k.toLowerCase().includes('replay'))).toEqual([])
      // Breadcrumbs are refused one at a time as well as switched off wholesale.
      expect((options.beforeBreadcrumb as () => unknown)()).toBeNull()
    })

    it('strips request, user and breadcrumbs from any event that gets that far', async () => {
      await start('/dashboard/editor')

      const options = vi.mocked(Sentry.init).mock.calls[0]![0] as Record<string, unknown>
      const beforeSend = options.beforeSend as (e: Record<string, unknown>) => unknown

      const cleaned = beforeSend({
        request: { data: { 'field-9f2a': 'Dr Ana Ruiz' } },
        user: { email: 'ana@example.com' },
        breadcrumbs: [{ message: 'GET /form/abc123' }],
        exception: { values: [] }
      }) as Record<string, unknown>

      expect(cleaned.request).toBeUndefined()
      expect(cleaned.user).toBeUndefined()
      expect(cleaned.breadcrumbs).toBeUndefined()
      expect(JSON.stringify(cleaned)).not.toContain('Dr Ana Ruiz')
    })

    /**
     * The gap the first version of this backstop had.
     *
     * When `captureException` is handed something that is not an `Error`,
     * Sentry's **core** — not an integration, so `defaultIntegrations: false`
     * does not touch it — serialises that value's own properties into
     * `event.extra.__serialized__`. The way in is `main.ts`'s
     * `unhandledrejection` listener, which passes `event.reason` straight
     * through, and a rejection reason is often a plain object.
     */
    it('strips the serialised copy of a non-Error rejection reason', async () => {
      await start('/dashboard/editor')

      const options = vi.mocked(Sentry.init).mock.calls[0]![0] as Record<string, unknown>
      const beforeSend = options.beforeSend as (e: Record<string, unknown>) => unknown

      const cleaned = beforeSend({
        exception: { values: [{ type: 'Object' }] },
        extra: {
          __serialized__: {
            'field-9f2a': 'Dr Ana Ruiz',
            token: 'leaked-credential'
          }
        },
        contexts: { state: { answers: { 'field-77c1': 'ana@example.com' } } }
      }) as Record<string, unknown>

      expect(cleaned.extra).toBeUndefined()
      expect(cleaned.contexts).toBeUndefined()
      expect(JSON.stringify(cleaned)).not.toContain('Dr Ana Ruiz')
      expect(JSON.stringify(cleaned)).not.toContain('leaked-credential')
      expect(JSON.stringify(cleaned)).not.toContain('ana@example.com')
    })
  })

  /**
   * The respondent surface is excluded entirely. features/0032 had just stopped
   * storing a respondent's IP by default; sending the same person's browser
   * session to a third-party processor would walk that back silently.
   */
  describe('the public respondent surface', () => {
    it('reports nothing from a public form', async () => {
      const { captureAppError } = await start('/form/abc123')

      captureAppError(new Error('the editor exploded'))

      expect(Sentry.captureException).not.toHaveBeenCalled()
    })

    it('reports nothing from an invitation page', async () => {
      const { captureAppError } = await start('/invitations/some-token')

      captureAppError(new Error('boom'))

      expect(Sentry.captureException).not.toHaveBeenCalled()
    })

    it('drops a public-route event in beforeSend as well, not only at the call site', async () => {
      await start('/form/abc123')

      const options = vi.mocked(Sentry.init).mock.calls[0]![0] as Record<string, unknown>
      const beforeSend = options.beforeSend as (e: Record<string, unknown>) => unknown

      // Two independent gates. The SDK can raise an event this module never
      // asked it to — an integration added later, a transport retry — and the
      // exclusion has to hold for those too.
      expect(beforeSend({ exception: { values: [] } })).toBeNull()
    })

    it('does report from an authenticated screen', async () => {
      const { captureAppError } = await start('/dashboard/editor')

      captureAppError(new Error('the editor exploded'))

      expect(Sentry.captureException).toHaveBeenCalledTimes(1)
    })
  })

  describe('when it is off', () => {
    it('does nothing without a DSN', async () => {
      vi.stubEnv('VITE_SENTRY_DSN', '')
      vi.stubEnv('DEV', '')
      const mod = await freshModule()
      const app = createApp({ template: '<div/>' })
      const { router, ready } = routerWith('/dashboard/editor')
      await ready

      mod.initErrorTracking(app, router)

      expect(Sentry.init).not.toHaveBeenCalled()
      expect(mod.isErrorTrackingEnabled()).toBe(false)
      // This runs on the failure path; it must never be the thing that fails.
      expect(() => mod.captureAppError(new Error('boom'))).not.toThrow()
    })

    it('stays off in development even with a DSN', async () => {
      vi.stubEnv('VITE_SENTRY_DSN', 'https://key@o1.ingest.sentry.io/42')
      vi.stubEnv('DEV', '1')
      const mod = await freshModule()
      const app = createApp({ template: '<div/>' })
      const { router, ready } = routerWith('/dashboard/editor')
      await ready

      mod.initErrorTracking(app, router)

      expect(Sentry.init).not.toHaveBeenCalled()
    })
  })

  describe('correlation with the server', () => {
    it('tags the event with the request id from an ApiError', async () => {
      const setTag = vi.fn()
      vi.mocked(Sentry.withScope).mockImplementation((fn: never) =>
        (fn as unknown as (s: unknown) => void)({ setTag }) as never
      )
      const { captureAppError } = await start('/dashboard/editor')

      captureAppError(new Error('save failed'), 'the-request-id')

      expect(setTag).toHaveBeenCalledWith('requestId', 'the-request-id')
    })

    it('sends the route name rather than the URL', async () => {
      const setTag = vi.fn()
      vi.mocked(Sentry.withScope).mockImplementation((fn: never) =>
        (fn as unknown as (s: unknown) => void)({ setTag }) as never
      )
      const { captureAppError } = await start('/dashboard/editor')

      captureAppError(new Error('save failed'))

      // A URL here would carry a shareId or an invitation token.
      expect(setTag).toHaveBeenCalledWith('route', 'editor')
    })
  })
})
