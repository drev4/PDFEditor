import { createRequire } from 'node:module'

/**
 * The one place that knows how an author-supplied `pattern` is compiled.
 *
 * A pattern is written by a form author and executed against input written by an
 * anonymous respondent, on the public submission endpoint, on the only thread
 * this service has. Two things follow, and both are why `new RegExp` must never
 * appear at a call site again:
 *
 *  - A catastrophically backtracking pattern hangs the whole process. `/^(a+)+$/`
 *    against 33 characters took 155 seconds on a native RegExp, doubling every
 *    two characters. It cannot be bounded with a timeout: `test()` is synchronous
 *    and the event loop is exactly what it blocks. The fix is an engine that
 *    cannot backtrack — RE2 is linear by construction, and runs that same case in
 *    0.05 ms.
 *  - An *invalid* pattern is accepted on write and then throws `SyntaxError` on
 *    every submission, which the error handler turns into a 500. One typo brings
 *    a form down permanently.
 */

const require = createRequire(import.meta.url)

export const MAX_PATTERN_LENGTH = 200

interface CompiledPattern {
  test(value: string): boolean
}

type RE2Constructor = new (pattern: string, flags?: string) => CompiledPattern

// `re2` is a native module, so its binary is tied to a Node ABI. Switching Node
// versions without reinstalling makes `require` throw. That must not take the
// API down for a feature this small, so it is loaded defensively: without the
// engine, patterns are still syntax-checked on write and simply not enforced on
// submission. Never fall back to native RegExp here - that reinstates the hang.
let RE2: RE2Constructor | null = null

try {
  RE2 = require('re2') as RE2Constructor
} catch (error) {
  console.error(
    'Could not load the re2 regex engine. Field `pattern` validation is DISABLED: ' +
    'patterns are still checked for syntax when saved, but are not enforced when ' +
    'a response is submitted. The usual cause is a native module built for a ' +
    'different Node version - reinstall dependencies.',
    error
  )
}

export type PatternCheck = { ok: true } | { ok: false; reason: string }

/**
 * Whether a pattern may be stored. Used by the field write endpoints so an author
 * is told immediately, rather than discovering it when respondents cannot submit.
 */
export function checkPattern(pattern: string): PatternCheck {
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return {
      ok: false,
      reason: `Pattern must be ${MAX_PATTERN_LENGTH} characters or fewer (got ${pattern.length})`
    }
  }

  const engine = RE2 ?? RegExp

  try {
    // eslint-disable-next-line no-new
    new engine(pattern)
    return { ok: true }
  } catch (error) {
    // RE2's messages name the unsupported construct, e.g.
    // "invalid perl operator: (?=" for lookahead, which is what an author needs.
    const reason = error instanceof Error ? error.message : 'Invalid regular expression'
    return { ok: false, reason: `Invalid pattern: ${reason}` }
  }
}

/**
 * Compiles a stored pattern for use against respondent input.
 *
 * Returns `null` when the pattern cannot be used — it predates validation, or the
 * engine is unavailable. Callers treat `null` as "no pattern constraint": throwing
 * would restore the 500 this module exists to remove, and rejecting the submission
 * would punish a respondent for the author's mistake. `pattern` is a formatting
 * convenience, not a security control, so unconstrained is the right degradation.
 */
export function compilePattern(pattern: string): CompiledPattern | null {
  if (!RE2) return null

  try {
    return new RE2(pattern)
  } catch {
    return null
  }
}

/** Whether the non-backtracking engine is available. Exposed for diagnostics. */
export function isPatternEngineAvailable(): boolean {
  return RE2 !== null
}
