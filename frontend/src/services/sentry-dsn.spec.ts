import { describe, it, expect } from 'vitest'
import { sentryIngestOrigin } from './sentry-dsn'

/**
 * The ingest origin in the CSP (features/0034).
 *
 * This is the cheap guard on the failure the feature most needed to avoid.
 * `frontend/vite.config.ts` builds the SPA's `Content-Security-Policy` at build
 * time with `connect-src` as an allowlist. If the error tracker's ingest host
 * is missing from it, the SDK initialises, reports success, and **every event
 * is refused by the browser** with nothing in the application to say so — a
 * deployment that looks instrumented and records nothing.
 *
 * The origin is therefore derived from the DSN rather than configured
 * separately, so the two cannot disagree.
 */
describe('sentryIngestOrigin', () => {
  it('is null when no DSN is configured, so the policy gains nothing', () => {
    expect(sentryIngestOrigin({})).toBeNull()
    expect(sentryIngestOrigin({ VITE_SENTRY_DSN: '' })).toBeNull()
    expect(sentryIngestOrigin({ VITE_SENTRY_DSN: '   ' })).toBeNull()
  })

  it('takes the origin from a DSN, dropping the key and the project id', () => {
    expect(
      sentryIngestOrigin({ VITE_SENTRY_DSN: 'https://abc123@o4507.ingest.de.sentry.io/42' })
    ).toBe('https://o4507.ingest.de.sentry.io')
  })

  /**
   * Loudly, and this is the decision worth keeping. A bad `VITE_API_URL`
   * breaks the app on first use in front of whoever deployed it; a DSN quietly
   * skipped here produces a policy that silently drops every report. Build time
   * is the cheap moment to find out.
   */
  it('fails the build on a malformed DSN rather than emitting a policy without it', () => {
    expect(() => sentryIngestOrigin({ VITE_SENTRY_DSN: 'not-a-dsn' })).toThrow(
      /is not a URL/
    )
  })
})
