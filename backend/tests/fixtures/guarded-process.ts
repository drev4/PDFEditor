import { installProcessGuards } from '../../src/process-guards.js'

/**
 * A tiny long-running process, guarded exactly as `src/worker.ts` is, that hurts
 * itself on purpose.
 *
 * Run as a **child process** by `tests/process-guards.spec.ts`, because that is
 * the only honest way to test this: the behaviour under test is whether the
 * process survives, and a test runner that has installed its own
 * `unhandledRejection` handler - Vitest has - cannot observe the real thing
 * in-process.
 *
 * `process.argv[2]` picks which failure to cause.
 */
installProcessGuards('fixture')

const mode = process.argv[2]

if (mode === 'rejection') {
  // What a job handler does when it forgets an `await`: a promise nobody is
  // listening to rejects. Node 22 exits the process over this unless something
  // handles the event.
  void (async () => {
    void Promise.reject(new Error('rejected inside a job handler'))
  })()
} else if (mode === 'exception') {
  setTimeout(() => {
    throw new Error('threw outside every handler')
  }, 10)
}

// Long enough that an exit caused by the failure above happens first, and short
// enough that a hung test is obvious.
setTimeout(() => {
  console.log('STILL ALIVE')
  process.exit(0)
}, 500)
