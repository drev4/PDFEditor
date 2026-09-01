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
  process.on('unhandledRejection', reason => {
    console.error(
      `[${processName}] unhandled promise rejection - staying up, but this is a bug:`,
      reason
    )
  })

  process.on('uncaughtException', error => {
    console.error(`[${processName}] uncaught exception - shutting down:`, error)
    // Give the log a tick to flush before the process disappears.
    setTimeout(() => process.exit(1), 100).unref()
  })
}
