import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runPattern, resetPatternWorker } from './pattern-check'

/**
 * The bound on an author's pattern (features/0035).
 *
 * jsdom has no `Worker`, so one is installed here. That is not a shortcut
 * around the real thing — the subject of these tests **is** the supervision:
 * the clock, and the decision to kill. What the worker itself does with a
 * `RegExp` is four lines and is exercised for real by a browser, not here.
 *
 * The property that matters: a worker that never replies must be terminated
 * and must produce `no-verdict`. `terminate()` is the only thing that stops a
 * thread stuck inside `test()` — asking it to stop cannot work, because it is
 * the thread that would have to read the request.
 */

type Reply = { ok: true; matched: boolean } | { ok: false } | { ready: true }

/** How a fake worker should behave when a message arrives. */
type Behaviour =
  | { kind: 'reply'; reply: Reply }
  /** Never answers — what a catastrophic pattern looks like from out here. */
  | { kind: 'hang' }
  | { kind: 'error' }
  /** Hands out a different reply per request, in order. */
  | { kind: 'queue'; replies: Reply[] }

let behaviour: Behaviour = { kind: 'hang' }
let announcesReady = true
let constructed = 0
let terminated = 0

/**
 * A worker that announces itself, like the real one.
 *
 * The handshake is not incidental: the deadline must bound the regex, not the
 * creation of the thread. A real module worker took **over 50 ms** to start in
 * Chromium, which is longer than `DEADLINE_MS` — so a version that started the
 * clock at construction returned `no-verdict` for every pattern, including
 * trivial ones. That was caught in a real browser, not here.
 */
class FakeWorker {
  onerror: ((e: unknown) => void) | null = null
  private killed = false
  private listeners: Record<string, ((e: unknown) => void)[]> = {}

  constructor() {
    constructed++
    // Asynchronous, exactly as a real worker's first message is.
    setTimeout(() => {
      if (!this.killed && announcesReady) this.emit('message', { data: { ready: true } })
    }, 0)
  }

  addEventListener(type: string, fn: (e: unknown) => void): void {
    ;(this.listeners[type] ??= []).push(fn)
  }

  removeEventListener(type: string, fn: (e: unknown) => void): void {
    this.listeners[type] = (this.listeners[type] ?? []).filter(f => f !== fn)
  }

  private emit(type: string, event: unknown): void {
    for (const fn of [...(this.listeners[type] ?? [])]) fn(event)
  }

  postMessage(): void {
    if (behaviour.kind === 'hang') return

    const next = behaviour.kind === 'queue' ? behaviour.replies.shift() : behaviour.reply

    setTimeout(() => {
      if (this.killed) return
      if (behaviour.kind === 'error') this.emit('error', new Error('worker blew up'))
      else if (next) this.emit('message', { data: next })
    }, 0)
  }

  terminate(): void {
    this.killed = true
    terminated++
  }
}

describe('runPattern', () => {
  beforeEach(() => {
    vi.stubGlobal('Worker', FakeWorker)
    behaviour = { kind: 'hang' }
    announcesReady = true
    constructed = 0
    terminated = 0
    resetPatternWorker()
  })

  afterEach(() => {
    resetPatternWorker()
    vi.unstubAllGlobals()
  })

  it('reports a match', async () => {
    behaviour = { kind: 'reply', reply: { ok: true, matched: true } }

    await expect(runPattern('^[0-9]+$', '123')).resolves.toBe('matched')
  })

  it('reports a value that does not match', async () => {
    behaviour = { kind: 'reply', reply: { ok: true, matched: false } }

    await expect(runPattern('^[0-9]+$', 'abc')).resolves.toBe('no-match')
  })

  /**
   * The reason this module exists. `^(a+)+$` is accepted by RE2 and stored, and
   * backtracks catastrophically here — measured at over 25 seconds for 41
   * characters while building this feature.
   */
  it('gives up on a pattern that never returns, and kills the worker', async () => {
    behaviour = { kind: 'hang' }

    await expect(runPattern('^(a+)+$', 'a'.repeat(40) + 'b')).resolves.toBe('no-verdict')

    // Not merely abandoned: the thread is stopped. A worker left spinning would
    // keep burning the respondent's CPU for as long as the tab is open.
    expect(terminated).toBe(1)
  })

  /**
   * A pattern valid in RE2 and invalid in JavaScript — `(?P<n>a)`. The worker
   * answers `{ ok: false }` rather than hanging, and that is still no verdict:
   * what failed is our ability to read the rule, not the respondent's value.
   */
  it('has no verdict on a pattern this engine cannot compile', async () => {
    behaviour = { kind: 'reply', reply: { ok: false } }

    await expect(runPattern('(?P<n>a)', 'anything')).resolves.toBe('no-verdict')
  })

  it('has no verdict when the worker errors', async () => {
    behaviour = { kind: 'error' }

    await expect(runPattern('^a$', 'a')).resolves.toBe('no-verdict')
    expect(terminated).toBe(1)
  })

  it('has no verdict, rather than throwing, where workers do not exist', async () => {
    vi.stubGlobal('Worker', undefined)
    resetPatternWorker()

    // An old browser, or any environment without workers. The server still
    // validates, so silence is the correct outcome.
    await expect(runPattern('^a$', 'a')).resolves.toBe('no-verdict')
  })

  it('reuses one worker across checks rather than spawning per keystroke', async () => {
    behaviour = { kind: 'reply', reply: { ok: true, matched: true } }

    await runPattern('^a$', 'a')
    await runPattern('^b$', 'b')
    await runPattern('^c$', 'c')

    expect(constructed).toBe(1)
    expect(terminated).toBe(0)
  })

  /**
   * Found in real Chromium, not here: starting the thread took longer than the
   * deadline, so a clock begun at construction expired on `^[0-9]+$` against
   * `12345`. Every verdict became `no-verdict` — client-side pattern checking
   * silently switched off while every test still passed.
   */
  it('does not spend the pattern deadline on starting the thread', async () => {
    behaviour = { kind: 'reply', reply: { ok: true, matched: false } }

    // The fake announces readiness on a timer, like a real worker. If the
    // deadline covered startup, this would come back `no-verdict`.
    await expect(runPattern('^[0-9]+$', 'abc')).resolves.toBe('no-match')
  })

  it('has no verdict when the thread never announces itself', async () => {
    announcesReady = false
    behaviour = { kind: 'reply', reply: { ok: true, matched: true } }

    await expect(runPattern('^a$', 'a')).resolves.toBe('no-verdict')
    expect(terminated).toBe(1)
  }, 10000)

  /**
   * One worker answers one question at a time. Without serialising, two
   * overlapping calls both hear the first reply — so the second field's verdict
   * would be the first field's answer.
   */
  it('never answers one check with another check’s reply', async () => {
    // Two distinct answers, handed out in the order the worker is asked.
    const replies: Reply[] = [
      { ok: true, matched: true },
      { ok: true, matched: false }
    ]
    behaviour = { kind: 'queue', replies }

    const [first, second] = await Promise.all([
      runPattern('^a$', 'a'),
      runPattern('^b$', 'zzz')
    ])

    expect(first).toBe('matched')
    expect(second).toBe('no-match')
  })

  it('builds a fresh worker after killing one', async () => {
    behaviour = { kind: 'hang' }
    await runPattern('^(a+)+$', 'aaaa')
    expect(terminated).toBe(1)

    behaviour = { kind: 'reply', reply: { ok: true, matched: true } }
    await expect(runPattern('^a$', 'a')).resolves.toBe('matched')

    // The killed one cannot be reused, so a second was constructed.
    expect(constructed).toBe(2)
  })
})
