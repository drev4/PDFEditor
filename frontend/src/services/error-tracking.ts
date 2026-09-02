import * as Sentry from '@sentry/vue'
import type { App } from 'vue'
import type { Router } from 'vue-router'

/**
 * Everything in the SPA that knows an error tracker exists (features/0034).
 *
 * **This is the only module in the frontend that imports the Sentry SDK**, the
 * same boundary `services/error-tracking.ts` draws on the backend.
 *
 * ## Why the browser needed this at all
 *
 * The API has had structured logging with a request id since features/0025. The
 * browser had nothing: an exception in the field editor, a failed PDF render,
 * or a public form throwing while somebody filled it in produced no record
 * anywhere, and the only way anyone found out was a customer describing it.
 *
 * ## What is sent, and why it is an allowlist
 *
 * `defaultIntegrations: false`, and then nothing is added back. The SDK's
 * default set records a breadcrumb for every fetch, every console call and
 * every DOM interaction — and on this SPA a fetch URL contains a form's
 * `shareId` while a console line may contain anything at all. There is no list
 * of key names that would make those safe, because the values are the
 * customer's own data.
 *
 * **No Session Replay, on any route.** It is the feature that would record a
 * respondent typing their answers into a public form, and it is off because it
 * is never switched on rather than because a flag says false.
 *
 * ## The respondent surface is excluded entirely
 *
 * `meta: { public: true }` in `router/index.ts` marks the three routes a
 * non-customer reaches: `/form/:shareId`, `/form/:shareId/confirmation` and
 * `/invitations/:token`. Nothing is reported from them.
 *
 * That is a decision rather than an oversight, and features/0032 is why: it had
 * just stopped storing a respondent's IP by default, on the grounds that
 * collecting it for a purpose nobody had implemented was indefensible. Sending
 * the same person's browser session to a third-party processor a fortnight
 * later — without touching the privacy notice that feature wrote — would walk
 * that back silently. The author's own screens are the ones this feature was
 * asked to make visible, and they are the ones it watches.
 *
 * The cost is real and worth stating: **a bug that only happens on the public
 * form is still invisible.** Making it visible needs the respondent notice
 * updated first, which is a product change with a privacy decision attached.
 */

/** Set once, so `captureAppError` can cheaply do nothing. */
let enabled = false

/** Read for the route check, without importing the router instance. */
let activeRouter: Router | null = null

/**
 * True when the route being viewed belongs to a respondent rather than a
 * customer. Uses the router's own matched record, not the URL — a string check
 * on the path would drift the moment a route is renamed.
 */
function onPublicRoute(): boolean {
  const current = activeRouter?.currentRoute.value
  if (!current) return false
  return current.matched.some(record => record.meta?.public === true)
}

/**
 * Starts the tracker, or does nothing.
 *
 * Off unless `VITE_SENTRY_DSN` is set at **build** time — it is compile-time
 * configuration, baked into the bundle, and cannot be changed by restarting
 * anything. Off in development regardless, so a developer's own crashes do not
 * land in the deployment's project.
 */
export function initErrorTracking(app: App, router: Router): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN?.trim()
  if (!dsn || import.meta.env.DEV) return

  activeRouter = router

  try {
    Sentry.init({
      app,
      dsn,
      // See the module comment: nothing is collected that this file did not
      // put there.
      defaultIntegrations: false,
      integrations: [],
      sendDefaultPii: false,
      environment: import.meta.env.MODE,
      // The backstop, not the mechanism — the same relationship `redact` has
      // to what the backend logger sends.
      beforeSend(event) {
        if (onPublicRoute()) return null
        delete event.request
        delete event.user
        delete event.breadcrumbs
        // Sentry's core — not an integration, so `defaultIntegrations: false`
        // does not cover it — serialises a non-`Error` capture's own properties
        // into `event.extra.__serialized__`. `main.ts` hands the raw
        // `event.reason` of an unhandled rejection to `captureAppError`, and a
        // rejection reason is often a plain object.
        delete event.extra
        delete event.contexts
        return event
      },
      beforeBreadcrumb: () => null
    })

    enabled = true
  } catch {
    // A tracker that cannot start must not take the application with it.
  }
}

/**
 * Reports one error from the SPA, or does nothing.
 *
 * `requestId` is what makes this worth having: `services/api.ts` reads the
 * `X-Request-Id` header off every response and puts it on `ApiError`, so a
 * browser event and the server log line that explains it carry the same id.
 * Before features/0034 the id never left the API and the two could not be
 * joined at all.
 *
 * Never throws. This runs on the failure path.
 */
export function captureAppError(err: unknown, requestId?: string): void {
  if (!enabled || onPublicRoute()) return

  try {
    Sentry.withScope(scope => {
      if (requestId) scope.setTag('requestId', requestId)
      // The route name, not the URL: a path here carries a `shareId` or an
      // invitation token.
      const name = activeRouter?.currentRoute.value?.name
      if (typeof name === 'string') scope.setTag('route', name)

      Sentry.captureException(err)
    })
  } catch {
    // Reporting a failure must not become a second one.
  }
}

/** Whether events are actually being sent. For tests, and for honesty. */
export function isErrorTrackingEnabled(): boolean {
  return enabled
}
