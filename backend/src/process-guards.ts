import { logger } from './services/logger.js'
import { captureError, flushErrorTracking } from './services/error-tracking.js'

/**
 * How long the uncaught-exception handler waits for the tracker before exiting.
 * Bounded on purpose — see the handler below.
 */
const EXIT_FLUSH_MS = 2000
/**
 * The last line of defence in a long-running process (features/0017, trap 4).
 *
 * Installed by **both** entrypoints - `src/index.ts` and `src/worker.ts` - and
 * by nothing else. Importing this from a route or a service would install it in
 * every test run too, which is the opposite of what a test wants: a suite needs
 * an unhandled rejection to fail loudly, not to be logged and forgiven.
 *
 * ## Why this exists
 *
 * features/0016 shipped an `async` Express handler with no `try`/`catch`, which
 * produced an unhandled rejection; Node 22 turns that into `process.exit(1)`.
 * In the API that was a crash loop - visible, restarted by a supervisor,
 * noticed by somebody.
 *
 * **In a worker the same failure is silent.** Nothing 500s, no request fails,
 * no user sees an error: the process is simply gone, the queue fills up, and
 * every form's PDF quietly falls behind its database. So an unhandled rejection
 * must not be allowed to take a worker down over what is usually one bad job.
 *
 * ## The asymmetry between the two handlers, which is deliberate
 *
 * An **unhandled rejection** is logged and survived. It means a promise nobody
 * awaited failed; the process state is intact and the next job is unaffected.
 *
 * An **uncaught exception** is logged and then the process exits. After one,
 * the process is in a state the code never planned for - a listener may be
 * half-registered, a lock half-taken - and a worker that keeps claiming jobs in
 * that state corrupts documents rather than failing to write them. Exiting
 * hands the decision to the supervisor, which is the thing that knows how to
 * restart. The exit is deferred by a tick so the log line actually flushes.
 */
export function installProcessGuards(processName: string): void {
  const log = logger.child({ process: processName })

  process.on('unhandledRejection', reason => {
    log.error(
      { err: reason },
      `[${processName}] unhandled promise rejection - staying up, but this is a bug`
    )
    // "This is a bug" is exactly what an error tracker is for, and on the
    // worker this is the only signal that exists (features/0034).
    captureError(reason, { source: `${processName}:unhandledRejection` })
  })

  process.on('uncaughtException', error => {
    log.error({ err: error }, `[${processName}] uncaught exception - shutting down`)
    captureError(error, { source: `${processName}:uncaughtException` })
    // Give the log a tick to flush before the process disappears. It matters
    // more with pino than it did with `console`: the write is asynchronous, so
    // exiting immediately would lose the one line explaining why (features/0025).
    //
    // The tracker needs the same courtesy and needs it more, because its write
    // is a network call — an event still in the transport's buffer when the
    // process exits is lost, and it is precisely the event explaining the
    // crash.
    //
    // So the exit is sequenced **after** the flush rather than racing it: a
    // 2-second flush behind a 100ms exit would lose the event almost every
    // time, which is the same "looks instrumented, records nothing" failure
    // this feature exists to avoid. The flush is bounded and cannot reject —
    // `flushErrorTracking` swallows its own failure — so the worst case is
    // `EXIT_FLUSH_MS` plus the pino tick, and a slow third party delays the
    // exit rather than preventing it.
    //
    // **When tracking is off, which is every test and every developer machine,
    // it resolves immediately and the timing is exactly what it was.**
    void flushErrorTracking(EXIT_FLUSH_MS).finally(() => {
      setTimeout(() => process.exit(1), 100).unref()
    })
  })
}
