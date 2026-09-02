/**
 * The one place in the SPA that constructs a `RegExp` (features/0035).
 *
 * It is the mirror of `backend/src/services/pattern-validator.ts`, and it
 * exists for the same reason with one difference in the remedy.
 *
 * A field `pattern` is written by a form author and evaluated against input
 * typed by an anonymous respondent. The server compiles it with RE2, which is
 * linear by construction. The browser has no RE2, and `new RegExp` backtracks:
 * `^(a+)+$` is **accepted by RE2** — it runs that case in 0.05 ms — and is
 * catastrophic natively, where features/0004 measured 155 seconds at 33
 * characters, doubling every two. Verified again while building this: the same
 * pattern against 41 characters was still running after 25 seconds.
 *
 * So an author could hang the tab of everyone who filled in their form, using a
 * pattern the product stored without complaint.
 *
 * **The remedy the API could not use is available here.** `pattern-validator.ts`
 * argues that a synchronous `test()` cannot be bounded by a timeout, because the
 * event loop is exactly what it blocks — true, and the reason the server needs
 * an engine that cannot backtrack. A browser has a second thread it is allowed
 * to *kill*: `worker.terminate()` stops this file mid-`test()`. That asymmetry
 * is the whole design, and it is why this is a worker rather than an RE2 build.
 *
 * This module must stay tiny and dependency-free. It is the thread that gets
 * terminated, so anything it owns is lost without warning.
 */

export interface PatternRequest {
  pattern: string
  value: string
}

export type PatternReply =
  | { ok: true; matched: boolean }
  /** The pattern did not compile here — valid RE2, invalid JavaScript. */
  | { ok: false }
  /**
   * Sent once, on load, before any request is handled.
   *
   * The caller's deadline must bound **the regex**, not the creation of this
   * thread. Measured in real Chromium while building this: starting a module
   * worker and parsing it took over 50 ms, so a deadline that began at
   * construction expired on ordinary patterns too — which would have disabled
   * client-side pattern checking entirely while looking like it worked.
   */
  | { ready: true }

// Announce before the first request, so the caller starts its clock only once
// this thread is actually able to run something.
self.postMessage({ ready: true } satisfies PatternReply)

self.onmessage = (event: MessageEvent<PatternRequest>) => {
  const { pattern, value } = event.data

  let regex: RegExp
  try {
    regex = new RegExp(pattern)
  } catch {
    // RE2 accepts constructs JavaScript rejects — `(?P<n>a)` is a Python-style
    // named group, valid there and a SyntaxError here. The caller turns this
    // into "no verdict"; it must never become "the respondent's value is wrong",
    // because what failed is our ability to read the rule.
    self.postMessage({ ok: false } satisfies PatternReply)
    return
  }

  // If this line never returns, the caller's timeout terminates the worker.
  self.postMessage({ ok: true, matched: regex.test(value) } satisfies PatternReply)
}
