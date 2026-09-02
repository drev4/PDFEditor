/**
 * Where an error report is posted, derived from the DSN (features/0034).
 *
 * It lives in its own module, imported by `vite.config.ts`, for one practical
 * reason: a spec that imported the vite config would pull vite's own internals
 * into jsdom and fail before reaching an assertion. Keeping it here means the
 * rule can actually be tested, and the rule is worth testing — see below.
 *
 * There is no runtime caller. This is build-time configuration.
 */

/**
 * The origin the SDK will POST to, or `null` when tracking is not configured.
 *
 * The CSP's `connect-src` is an allowlist, so this value has to be in it or the
 * browser refuses every event — the SDK still initialises and still reports
 * success, and nothing in the application says otherwise. Deriving the origin
 * from the DSN rather than configuring it separately is what stops the two
 * disagreeing.
 *
 * **A malformed DSN throws, failing the build.** That is the opposite of how
 * `VITE_API_URL` is treated in the same file, and the difference is what the
 * failure costs: a bad API URL breaks the app on first use, loudly, in front of
 * whoever deployed it. A DSN quietly skipped here produces a policy with no
 * ingest origin — a deployment that looks instrumented and records nothing,
 * discovered whenever somebody eventually goes looking for errors that never
 * arrived. Build time is the cheap moment to find out.
 */
export function sentryIngestOrigin(env: Record<string, string | undefined>): string | null {
  const dsn = env.VITE_SENTRY_DSN?.trim()
  if (!dsn) return null

  try {
    return new URL(dsn).origin
  } catch {
    throw new Error(
      `VITE_SENTRY_DSN="${dsn}" is not a URL. A DSN looks like ` +
      'https://<key>@<host>/<projectId>. Refusing to build rather than emit a ' +
      'CSP with no ingest origin, which would drop every error report silently.'
    )
  }
}
