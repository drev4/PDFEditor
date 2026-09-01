import { describe, it, expect } from 'vitest'
import { spawnSync } from 'child_process'
import path from 'path'

/**
 * The process guards both entrypoints install (features/0017, goal 9).
 *
 * These run the fixture in a **real child process** rather than calling the
 * handlers directly. The behaviour under test is whether a process stays up,
 * and nothing observed from inside Vitest can answer that: the runner installs
 * its own `unhandledRejection` handler, so an in-process test would be
 * measuring Vitest's guards instead of ours.
 *
 * Why it matters here more than it did before: features/0016 shipped an `async`
 * Express handler with no `try`/`catch`, and Node 22 turned the resulting
 * unhandled rejection into `process.exit(1)`. In the API that was a crash loop -
 * loud, restarted, noticed. **In the queue worker the same failure is silent:**
 * no request fails, nothing 500s, and every form's PDF quietly stops being
 * rewritten while the queue fills up.
 */
describe('process guards', () => {
  const FIXTURE = path.join(process.cwd(), 'tests', 'fixtures', 'guarded-process.ts')

  /**
   * The child runs as a **production-like process**, not as part of this suite.
   *
   * `NODE_ENV` and `LOG_LEVEL` are set explicitly because the logger is silent
   * under `NODE_ENV=test` (features/0025) — and a child that inherited that
   * would make these tests pass or fail on how the *runner* is configured
   * rather than on what the guards do.
   */
  function run(mode: string) {
    return spawnSync(process.execPath, ['--import', 'tsx', FIXTURE, mode], {
      encoding: 'utf-8',
      timeout: 60_000,
      env: { ...process.env, NODE_ENV: 'production', LOG_LEVEL: 'info' }
    })
  }

  it('survives an unhandled rejection, and says so', () => {
    const result = run('rejection')

    // The whole point: a promise nobody awaited failed, and the process is still
    // there to run the next job.
    expect(result.stdout).toContain('STILL ALIVE')
    expect(result.status).toBe(0)

    // And it is not silent. A swallowed rejection would be worse than a crash,
    // because nothing would ever say the job was lost.
    //
    // **stdout, not stderr, since features/0025.** `pino` writes every level to
    // stdout as one JSON object per line; separating streams by severity is a
    // console habit that a log collector does not want, since it splits one
    // stream of events into two that have to be re-merged by timestamp.
    expect(result.stdout).toContain('unhandled promise rejection')
  })

  it('exits on an uncaught exception, deliberately unlike a rejection', () => {
    const result = run('exception')

    // The asymmetry is the design (see `src/process-guards.ts`). After an
    // uncaught exception the process is in a state the code never planned for,
    // and a worker that keeps claiming jobs in that state corrupts customer
    // documents rather than failing to write them. Exiting hands the decision to
    // the supervisor.
    expect(result.stdout).not.toContain('STILL ALIVE')
    expect(result.status).toBe(1)
    // This assertion is doing double duty now: it says the guard explained
    // itself, and it says the line **survived the exit**. `pino` writes
    // asynchronously, so the 100ms the handler waits before `process.exit` is
    // load-bearing in a way it was not with `console.error` (features/0025).
    expect(result.stdout).toContain('uncaught exception')
  })
})
