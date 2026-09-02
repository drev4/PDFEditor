import { ref } from 'vue'
import { fieldsService } from '@/services/fields'
import { describePattern } from '@/services/pattern-check'

/**
 * Everything that happens between an author typing a pattern and it being
 * allowed near a save (features/0036).
 *
 * ## Two checks, in two places, and neither is sufficient
 *
 * **The server says whether it may be stored.** RE2's rules are not
 * JavaScript's — it rejects lookahead, lookbehind and backreferences that
 * JavaScript accepts, and accepts `(?P<n>a)` that JavaScript rejects — so this
 * cannot be decided here without keeping a second copy of the engine's grammar
 * that drifts from it.
 *
 * **The browser says whether it will be usable.** RE2 is linear by
 * construction, so `^(a+)+$` compiles in 0.05 ms and there is nothing for the
 * server to object to. The same pattern backtracks catastrophically in a
 * browser — measured still running after 25 seconds on 41 characters
 * (features/0035). The engine that stores it cannot see the problem.
 *
 * ## Why invalid blocks and slow only warns
 *
 * `invalid` is the server's answer and it is definitive, so the caller must
 * keep the pattern out of the store: `pattern` is validated inside
 * `createFieldSchema`, and an invalid one fails the **whole** bulk save, taking
 * every other unsaved edit on the form with it.
 *
 * `slow` is a probe result. It can show that a pattern *is* slow and never that
 * it is safe, because the input that triggers backtracking depends on the
 * pattern. Refusing to save on a heuristic would block legitimate patterns on a
 * guess, so it warns and the author decides.
 */

export type PatternState =
  | 'empty'
  /** A request is in flight. */
  | 'checking'
  /** Storable, and fast enough to check in a browser. */
  | 'ok'
  /** The server will not store it. `reason` says why. */
  | 'invalid'
  /** Storable, but too slow to evaluate in a respondent's browser. */
  | 'slow'

/**
 * What the probe runs the pattern against.
 *
 * Catastrophic backtracking needs an input that *almost* matches and then
 * fails, so each of these is a long run of one character with a single
 * mismatching character on the end. The runs cover the character classes a
 * form field's pattern realistically constrains.
 *
 * **This is a heuristic and cannot be otherwise.** Generating genuinely
 * adversarial input for an arbitrary pattern is a research problem; these catch
 * the shapes that actually occur — `(a+)+`, `(\\d+)*`, `(\\w+)*` and their
 * relatives. A pattern that is slow only on some other input is missed, which
 * is why the result is a warning and the respondent's browser still has the
 * deadline from features/0035 underneath it.
 */
const PROBE_INPUTS: readonly string[] = [
  'a'.repeat(40) + '!',
  '0'.repeat(40) + '!',
  'aA0'.repeat(14) + '!',
  ' '.repeat(40) + '!'
]

export function usePatternAuthoring() {
  const state = ref<PatternState>('empty')
  /** The server's message, when `state` is `invalid`. */
  const reason = ref<string | null>(null)

  /** Only the newest request may write to `state`. */
  let generation = 0

  /**
   * Runs both checks against `pattern` and reports what to do about it.
   *
   * Resolves to `true` when the pattern is safe to put in the store — which is
   * `ok` **and** `slow`, because slow is a warning rather than a refusal.
   */
  async function check(pattern: string): Promise<boolean> {
    const mine = ++generation
    const trimmed = pattern.trim()

    if (!trimmed) {
      state.value = 'empty'
      reason.value = null
      return true
    }

    state.value = 'checking'
    reason.value = null

    let storable: Awaited<ReturnType<typeof fieldsService.checkPattern>>
    try {
      storable = await fieldsService.checkPattern(trimmed)
    } catch {
      // The check is unavailable, not the pattern invalid. Saying "invalid"
      // here would refuse a pattern on the strength of a failed request, so it
      // falls through to the server's own validation on save.
      if (mine === generation) {
        state.value = 'ok'
        reason.value = null
      }
      return true
    }

    if (mine !== generation) return !('ok' in storable && !storable.ok)

    if (!storable.ok) {
      state.value = 'invalid'
      reason.value = storable.reason
      return false
    }

    // Storable. Now: will a respondent's browser manage to run it?
    for (const input of PROBE_INPUTS) {
      const { verdict, reason: why } = await describePattern(trimmed, input)
      if (mine !== generation) return true

      // **Only a timeout means slow.** `uncompilable` is a pattern this engine
      // cannot read — valid RE2, invalid JavaScript — and `unavailable` means
      // there was nothing to ask. Reporting either as slow would be wrong, and
      // a warning that cries wolf is one people stop reading.
      if (verdict === 'no-verdict' && why === 'timeout') {
        state.value = 'slow'
        reason.value = null
        return true
      }
    }

    state.value = 'ok'
    reason.value = null
    return true
  }

  /** Drops any in-flight result, for when the selected field changes. */
  function reset(): void {
    generation++
    state.value = 'empty'
    reason.value = null
  }

  return { state, reason, check, reset }
}
