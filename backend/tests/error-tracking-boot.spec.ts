import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * What each process says at boot, and the one-shot verification (features/0041).
 *
 * **A different subject from `error-tracking.spec.ts`, and it needs the real
 * module.** That suite mocks this module wholesale, because its question is what
 * the *error handler* decides to report. The question here is what
 * `initErrorTracking` itself does, so the module is real and the SDK is mocked.
 *
 * Why this is worth testing at all: the SPA sat for a day with its variable set
 * correctly and reporting nothing, and it was only caught because a bundle and a
 * CSP can be read from outside. The API and the worker offer no such surface, so
 * **the boot log is the only place the three states are distinguishable** — and a
 * log line nobody asserts is a log line that quietly stops being written.
 */

const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  setTag: vi.fn(),
  withScope: vi.fn((fn: (scope: unknown) => void) => fn({ setTag: vi.fn(), setLevel: vi.fn() })),
  captureMessage: vi.fn(),
  captureException: vi.fn()
}))
vi.mock('@sentry/node', () => sentry)

const logged = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }))
vi.mock('../src/services/logger', () => ({ logger: logged }))

const DSN = 'https://key@o1.ingest.de.sentry.io/2'

/** A fresh module every time, because `enabled` is module state. */
async function boot(role: 'api' | 'worker' = 'api') {
  vi.resetModules()
  const mod = await import('../src/services/error-tracking')
  mod.initErrorTracking(role)
  return mod
}

/** The message of every `logger.info` call, in order. */
const infoMessages = () => logged.info.mock.calls.map(call => String(call[call.length - 1]))

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('SENTRY_DSN', '')
  vi.stubEnv('SENTRY_VERIFY_ON_BOOT', '')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('the three states are told apart at boot', () => {
  it('says so when there is no DSN, instead of staying silent', async () => {
    const mod = await boot()

    expect(mod.isErrorTrackingEnabled()).toBe(false)
    expect(sentry.init).not.toHaveBeenCalled()
    expect(infoMessages().join(' ')).toContain('not configured')
  })

  it('says so when a DSN is set but the environment is not a deployment', async () => {
    // Configured and off is its own state: a developer's crashes do not belong
    // in the deployment's project, and somebody reading the log needs to see
    // that this is the reason rather than a missing value.
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('SENTRY_DSN', DSN)

    const mod = await boot()

    expect(mod.isErrorTrackingEnabled()).toBe(false)
    expect(sentry.init).not.toHaveBeenCalled()
    expect(infoMessages().join(' ')).toMatch(/NODE_ENV is development or test/)
  })

  it('says it is reporting, with the role and the environment', async () => {
    vi.stubEnv('SENTRY_DSN', DSN)

    const mod = await boot('worker')

    expect(mod.isErrorTrackingEnabled()).toBe(true)
    expect(sentry.init).toHaveBeenCalledOnce()
    expect(infoMessages().join(' ')).toContain('reporting')

    // The role is what tells the two processes apart in both places.
    expect(sentry.setTag).toHaveBeenCalledWith('role', 'worker')
    const context = logged.info.mock.calls.at(-1)?.[0] as { role?: string }
    expect(context.role).toBe('worker')
  })
})

describe('the boot verification is opt-in and one event', () => {
  it('sends nothing when the switch is unset', async () => {
    vi.stubEnv('SENTRY_DSN', DSN)

    await boot()

    expect(sentry.captureMessage).not.toHaveBeenCalled()
  })

  it('sends nothing for any value other than true', async () => {
    // Anything but `true` is off, so a leftover `1` or `yes` does not quietly
    // add an event to every restart the platform performs on its own.
    vi.stubEnv('SENTRY_DSN', DSN)
    vi.stubEnv('SENTRY_VERIFY_ON_BOOT', '1')

    await boot()

    expect(sentry.captureMessage).not.toHaveBeenCalled()
  })

  it('sends nothing when tracking never started, however the switch is set', async () => {
    // The switch must not be a second way to turn tracking on.
    vi.stubEnv('SENTRY_VERIFY_ON_BOOT', 'true')

    const mod = await boot()

    expect(mod.isErrorTrackingEnabled()).toBe(false)
    expect(sentry.captureMessage).not.toHaveBeenCalled()
  })

  it('sends exactly one event, naming the process', async () => {
    vi.stubEnv('SENTRY_DSN', DSN)
    vi.stubEnv('SENTRY_VERIFY_ON_BOOT', 'true')

    await boot('worker')

    expect(sentry.captureMessage).toHaveBeenCalledOnce()
    expect(String(sentry.captureMessage.mock.calls[0][0])).toContain('worker')

    // And it says out loud that it did, including how to stop it — the switch
    // is meant to be turned off again.
    expect(infoMessages().join(' ')).toContain('SENTRY_VERIFY_ON_BOOT')
  })
})
