import * as Sentry from '@sentry/node'
import { logger } from './logger.js'
import { isStrict } from '../config/validate-env.js'

/**
 * Everything that knows an error tracker exists (features/0034).
 *
 * **This is the only module in the backend that imports the Sentry SDK.** The
 * same boundary `services/stripe.ts` draws, for the same reason:
 * `middleware/errorHandler.ts` and `process-guards.ts` report *that something
 * failed*, and neither may learn which vendor is on the other end — otherwise
 * replacing it stops being a contained change. `grep -rn "@sentry/node" src`
 * must only ever find this file.
 *
 * ## What is sent, and why it is an allowlist
 *
 * [08-operations](../../../docs/sot/08-operations.md) already settled the
 * governing rule for the log, and it governs here identically:
 *
 * > No request body, ever — the most sensitive thing this API handles is answer
 * > values typed by members of the public, and they arrive keyed by field id,
 * > so their paths are data and no redaction list can cover them.
 *
 * That last clause is the whole argument. A denylist cannot work because the
 * sensitive keys are **field ids**, which differ per form and are chosen by the
 * customer — there is no fixed set of names to strip. So this module sends an
 * explicit list and nothing else: the message, the stack, the request id, the
 * matched route, the status and which process it was.
 *
 * The mechanism is `defaultIntegrations: false`. The Sentry Node SDK's default
 * set auto-instruments `http`, Express and Postgres, and attaches request data
 * and breadcrumbs on its own — every one of which is a path for a body or a
 * query string to arrive without anybody deciding it should. Turning the
 * defaults off means nothing is collected that this file did not put there, and
 * `beforeSend` below is a **backstop against a future change that forgets**,
 * not the mechanism. That is the same shape, and the same reasoning, as pino's
 * `redact` in `services/logger.ts`: a design that gathers everything and then
 * removes the known-bad parts fails open.
 *
 * ## When it is off
 *
 * Unset `SENTRY_DSN` means off — no init, no network, no throw — exactly as an
 * unset `STRIPE_SECRET_KEY` means billing is off. A deployment without error
 * tracking has less visibility; it is not broken, so this is never required at
 * boot.
 *
 * It is also off in development and test, decided by `isStrict` rather than by
 * `NODE_ENV !== 'production'`. The difference matters and is the same argument
 * `DEV_PLAN_KEY` and `REGISTRATION_MODE` make: a `NODE_ENV` that is unset,
 * misspelled or dropped by a process manager falls into the *strict* branch, so
 * the failure mode is "a deployment reports errors" rather than "a developer's
 * crashes land in the customer project".
 */

/** What a caller may attach. Anything not on this list is not sent. */
export interface ErrorContext {
  /** Ties the event to the server log line, and to the browser's report. */
  requestId?: string
  /** The matched route pattern (`/api/forms/:id`), never the URL. */
  route?: string
  statusCode?: number
  /** `api` or `worker`, or the guard that caught it. */
  source?: string
}

let enabled = false

/** So a permanent condition does not print once per error. */
let announced = false

function announceOnce(message: string): void {
  if (announced) return
  announced = true
  logger.warn(message)
}

/**
 * Starts the tracker, or does nothing.
 *
 * Called from `src/index.ts` and `src/worker.ts` only — the two files a real
 * process enters — for the same reason `installProcessGuards` is: initialising
 * from a module every spec imports would arm it in every test run.
 */
export function initErrorTracking(role: 'api' | 'worker'): void {
  const dsn = process.env.SENTRY_DSN?.trim()
  if (!dsn) return

  if (!isStrict(process.env)) {
    logger.info(
      'SENTRY_DSN is set but NODE_ENV is development or test, so error ' +
      'tracking is off. This is deliberate: a developer\'s crashes do not ' +
      'belong in the deployment\'s project.'
    )
    return
  }

  try {
    Sentry.init({
      dsn,
      // See the module comment. Nothing is collected that this file did not
      // put there — no request data, no breadcrumbs, no auto-instrumentation.
      defaultIntegrations: false,
      integrations: [],
      // Off explicitly rather than by default, because the default has changed
      // between major versions of this SDK before.
      sendDefaultPii: false,
      environment: process.env.NODE_ENV?.trim() || 'unknown',
      // The backstop, not the mechanism.
      //
      // `extra` and `contexts` are here because of a gap the first version of
      // this had. When `captureException` is given a value that is **not an
      // `Error`**, Sentry's *core* serialises that value's own properties into
      // `event.extra.__serialized__` — core, not an integration, so
      // `defaultIntegrations: false` above does nothing about it. The way in is
      // the `unhandledRejection` guard in `process-guards.ts`, which passes the
      // raw rejection reason straight through, and a rejection reason is often
      // a plain object. On the worker that guard is the only signal there is.
      //
      // Deleting rather than filtering, for the same reason the whole module is
      // an allowlist: there is no set of key names that covers answer values,
      // because they are keyed by field id.
      beforeSend(event) {
        delete event.request
        delete event.user
        delete event.breadcrumbs
        delete event.extra
        delete event.contexts
        return event
      }
    })

    Sentry.setTag('role', role)
    enabled = true
  } catch (err) {
    // A tracker that cannot start must not stop the service it watches.
    logger.error({ err }, 'error tracking failed to initialise; continuing without it')
  }
}

/**
 * Reports one failure, or does nothing.
 *
 * **Never called for a 4xx.** `middleware/errorHandler.ts` explains at length
 * why a 4xx is logged at `info` with no stack: it is the API answering
 * correctly, and a log that cries fault when nothing is wrong is a log people
 * stop reading. Sending 4xx here would recreate that exact problem in a place
 * that also charges by the event.
 *
 * It never throws. A failure to report a failure is not worth turning into a
 * second one, and this sits on the error path of every request.
 */
export function captureError(err: unknown, context: ErrorContext = {}): void {
  if (!enabled) return

  try {
    Sentry.withScope(scope => {
      // Explicit, one key at a time. Spreading `context` would send whatever a
      // future caller happened to put in it.
      if (context.requestId) scope.setTag('requestId', context.requestId)
      if (context.route) scope.setTag('route', context.route)
      if (context.source) scope.setTag('source', context.source)
      if (context.statusCode !== undefined) {
        scope.setTag('statusCode', String(context.statusCode))
      }

      Sentry.captureException(err)
    })
  } catch (reportingError) {
    announceOnce(
      `error tracking could not report an event: ${String(reportingError)}`
    )
  }
}

/**
 * Whether events are actually being sent. For tests and for the boot log —
 * "configured" and "reporting" are different states and the difference is
 * exactly what goes wrong silently.
 */
export function isErrorTrackingEnabled(): boolean {
  return enabled
}

/**
 * Flushes buffered events, with a bound.
 *
 * Used by the uncaught-exception guard, which is about to exit: without this
 * the event that explains the crash is lost in the transport's buffer. The
 * bound matters as much as the flush — a process refusing to die because a
 * third party is slow is worse than a missing event.
 */
export async function flushErrorTracking(timeoutMs = 2000): Promise<void> {
  if (!enabled) return
  try {
    await Sentry.flush(timeoutMs)
  } catch {
    // Exiting is more important than reporting why.
  }
}
