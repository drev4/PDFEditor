import type { PatternReply, PatternRequest } from './pattern-worker'

/**
 * Runs an author's `pattern` against a respondent's value, with a bound
 * (features/0035).
 *
 * The reasoning lives in `pattern-worker.ts`. This module owns the part the
 * worker cannot: the clock, and the decision to kill.
 *
 * ## Three outcomes, and why the third is not a failure
 *
 * `matched` and `no-match` are the ordinary answers. **`no-verdict` means the
 * browser could not judge**, and it is reachable four ways — the pattern did
 * not compile here, the evaluation ran past the deadline, the worker never
 * became ready, or workers do not exist at all.
 *
 * All of them behave identically, and it is the same behaviour the old
 * `try`/`catch` produced by accident: the respondent is told nothing. The
 * difference is that it is now a named decision. Inventing a failure would be
 * worse than saying nothing, because the thing that failed is *our* ability to
 * read the rule, not the value the respondent typed — and the server checks the
 * same rule with an engine that can always read it.
 *
 * ## The deadline bounds the regex, not the thread
 *
 * This distinction was not obvious and cost a wrong first version. Starting a
 * module worker and parsing it took **over 50 ms** in real Chromium, so a
 * deadline that began at construction expired on `^[0-9]+$` against `12345` —
 * an ordinary pattern, answered instantly once the thread exists. That version
 * would have returned `no-verdict` for everything, disabling client-side
 * pattern checking completely while every test still passed and nothing logged.
 *
 * So the worker announces itself with `{ ready: true }`, and `DEADLINE_MS`
 * starts only after that. Startup gets its own, far looser, bound.
 */

export type PatternVerdict = 'matched' | 'no-match' | 'no-verdict'

/**
 * How long a pattern may run, once the thread is up.
 *
 * Generous for any real pattern and hopeless for a catastrophic one, which is
 * the only distinction that matters: a linear match over a form field's worth
 * of text is microseconds, while `^(a+)+$` over 41 characters was still running
 * after 25 *seconds* when measured for this feature. Nothing realistic lands in
 * between, so the exact number is not delicate — 50 ms stays well under the
 * threshold where a person notices a keystroke lagging.
 */
const DEADLINE_MS = 50

/**
 * How long the thread itself may take to come up. Loose on purpose: it covers
 * fetching and parsing a module on a cold, possibly slow, device, and being
 * wrong in this direction only costs a lost verdict on the first keystroke.
 */
const STARTUP_MS = 2000

interface Pooled {
  worker: Worker
  /** Resolves true once the worker has announced itself, false if it never does. */
  ready: Promise<boolean>
}

/**
 * One worker, reused, replaced after it is killed.
 *
 * Spawning per keystroke would be simpler and wasteful where this is called
 * from — `validateField` runs on every change to a field — and it would also
 * pay the startup cost above every time. It is created lazily on the first
 * pattern actually checked, so forms without patterns never make one.
 */
let pooled: Pooled | null = null

/**
 * Checks are serialised, because one worker answers one question at a time.
 *
 * Without this, two overlapping calls both attach a listener and **both**
 * receive the first reply — so the second field's verdict would be the first
 * field's answer. Two debounced `validateField` calls firing together is enough
 * to hit it. The queue is bounded by construction: every link resolves within
 * `DEADLINE_MS` or is killed.
 */
let queue: Promise<unknown> = Promise.resolve()

function spawn(): Pooled | null {
  let worker: Worker
  try {
    worker = new Worker(new URL('./pattern-worker.ts', import.meta.url), { type: 'module' })
  } catch {
    // No workers here — an old browser, or a test environment without them.
    return null
  }

  const ready = new Promise<boolean>(resolve => {
    const timer = setTimeout(() => resolve(false), STARTUP_MS)
    const onReady = (event: MessageEvent<PatternReply>) => {
      if ((event.data as { ready?: boolean }).ready !== true) return
      clearTimeout(timer)
      worker.removeEventListener('message', onReady)
      resolve(true)
    }
    worker.addEventListener('message', onReady)
  })

  return { worker, ready }
}

/** Drops the pooled worker, so the next call builds a fresh one. */
function discard(entry: Pooled): void {
  entry.worker.terminate()
  if (pooled === entry) pooled = null
}

export function resetPatternWorker(): void {
  if (pooled) discard(pooled)
  pooled = null
}

export function runPattern(pattern: string, value: string): Promise<PatternVerdict> {
  const result = queue.then(() => check(pattern, value))
  // The queue must not break on a rejection, and `check` never rejects — but a
  // chain that could is a chain that stops serialising after one bad link.
  queue = result.catch(() => undefined)
  return result
}

async function check(pattern: string, value: string): Promise<PatternVerdict> {
  const entry = (pooled ??= spawn())
  if (!entry) return 'no-verdict'

  if (!(await entry.ready)) {
    // It never announced itself. Kill it rather than leave a thread that may
    // still wake up and answer a question nobody is listening for.
    discard(entry)
    return 'no-verdict'
  }

  return new Promise<PatternVerdict>(resolve => {
    let settled = false

    const finish = (verdict: PatternVerdict, kill: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      entry.worker.removeEventListener('message', onMessage)
      entry.worker.removeEventListener('error', onError)
      // Killing is the point. A worker stuck inside `test()` cannot be asked to
      // stop — it is the thread that would have to read the request.
      if (kill) discard(entry)
      resolve(verdict)
    }

    const onMessage = (event: MessageEvent<PatternReply>) => {
      const reply = event.data as { ok?: boolean; matched?: boolean; ready?: boolean }
      if (reply.ready === true) return
      finish(reply.ok ? (reply.matched ? 'matched' : 'no-match') : 'no-verdict', false)
    }

    const onError = () => finish('no-verdict', true)

    const timer = setTimeout(() => finish('no-verdict', true), DEADLINE_MS)

    entry.worker.addEventListener('message', onMessage)
    entry.worker.addEventListener('error', onError)
    entry.worker.postMessage({ pattern, value } satisfies PatternRequest)
  })
}
