import { describe, it, expect, vi, beforeEach } from 'vitest'
import { usePatternAuthoring } from './usePatternAuthoring'
import { fieldsService } from '@/services/fields'
import { describePattern } from '@/services/pattern-check'

/**
 * Authoring a pattern (features/0036).
 *
 * Both checks are mocked, because the subject here is **which of the two
 * answers wins and what the author is told**. Each is proven where it lives:
 * the server's rules in `backend/tests/fields.spec.ts`, the deadline and the
 * kill in `services/pattern-check.spec.ts`, and the real engine in a browser.
 */
vi.mock('@/services/fields', () => ({
  fieldsService: { checkPattern: vi.fn() }
}))
vi.mock('@/services/pattern-check', () => ({
  describePattern: vi.fn()
}))

const serverSays = vi.mocked(fieldsService.checkPattern)
const browserSays = vi.mocked(describePattern)

describe('usePatternAuthoring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    serverSays.mockResolvedValue({ ok: true })
    browserSays.mockResolvedValue({ verdict: 'no-match' })
  })

  it('is empty for an empty pattern, and asks nobody', async () => {
    const { state, check } = usePatternAuthoring()

    await expect(check('   ')).resolves.toBe(true)

    expect(state.value).toBe('empty')
    expect(serverSays).not.toHaveBeenCalled()
  })

  it('accepts an ordinary pattern with no warning', async () => {
    const { state, reason, check } = usePatternAuthoring()

    await expect(check('^[0-9]+$')).resolves.toBe(true)

    expect(state.value).toBe('ok')
    expect(reason.value).toBeNull()
  })

  describe('what the server refuses', () => {
    it('reports the server’s own reason and refuses the pattern', async () => {
      serverSays.mockResolvedValue({ ok: false, reason: 'Invalid pattern: invalid perl operator: (?=' })
      const { state, reason, check } = usePatternAuthoring()

      // `false` is what keeps it out of the store — and therefore out of the
      // bulk save, which an invalid pattern would fail wholesale.
      await expect(check('(?=.*\\d).{8,}')).resolves.toBe(false)

      expect(state.value).toBe('invalid')
      expect(reason.value).toContain('(?=')
    })

    it('does not bother probing a pattern that cannot be stored', async () => {
      serverSays.mockResolvedValue({ ok: false, reason: 'nope' })
      const { check } = usePatternAuthoring()

      await check('(?=x)')

      expect(browserSays).not.toHaveBeenCalled()
    })
  })

  /**
   * The pair that is the whole feature: valid on the server, unusable in a
   * browser. RE2 runs `^(a+)+$` in 0.05 ms and has nothing to object to.
   */
  describe('what the server cannot see', () => {
    it('warns about a catastrophic pattern the server accepted', async () => {
      serverSays.mockResolvedValue({ ok: true })
      browserSays.mockResolvedValue({ verdict: 'no-verdict', reason: 'timeout' })
      const { state, check } = usePatternAuthoring()

      // Still `true`: slow is a warning, never a refusal. A probe can show a
      // pattern is slow, never that it is safe, so refusing on it would block
      // legitimate patterns on a guess.
      await expect(check('^(a+)+$')).resolves.toBe(true)

      expect(state.value).toBe('slow')
    })

    it('does not call a pattern slow when this engine merely cannot read it', async () => {
      // `(?P<n>a)` is valid RE2 and a SyntaxError in JavaScript. It is not slow,
      // and saying so would be a false alarm of the kind that teaches people to
      // ignore warnings.
      browserSays.mockResolvedValue({ verdict: 'no-verdict', reason: 'uncompilable' })
      const { state, check } = usePatternAuthoring()

      await check('(?P<n>a)')

      expect(state.value).toBe('ok')
    })

    it('does not call a pattern slow when there was no worker to ask', async () => {
      browserSays.mockResolvedValue({ verdict: 'no-verdict', reason: 'unavailable' })
      const { state, check } = usePatternAuthoring()

      await check('^[0-9]+$')

      expect(state.value).toBe('ok')
    })

    it('probes with input designed to make a pattern backtrack', async () => {
      const { check } = usePatternAuthoring()

      await check('^(a+)+$')

      // Long runs of one character with a mismatch on the end: the shape that
      // makes a nested quantifier explode.
      expect(browserSays).toHaveBeenCalled()
      const [, input] = browserSays.mock.calls[0]!
      expect(String(input).length).toBeGreaterThan(20)
    })

    it('stops probing as soon as one input is slow', async () => {
      browserSays.mockResolvedValue({ verdict: 'no-verdict', reason: 'timeout' })
      const { check } = usePatternAuthoring()

      await check('^(a+)+$')

      // Each probe costs the deadline. Once one has answered, the rest are
      // 50 ms each of nothing.
      expect(browserSays).toHaveBeenCalledTimes(1)
    })
  })

  describe('when the check itself fails', () => {
    it('does not call a pattern invalid because a request failed', async () => {
      serverSays.mockRejectedValue(new Error('offline'))
      const { state, check } = usePatternAuthoring()

      // Refusing here would reject a pattern on the strength of a dropped
      // request. The server validates it again on save regardless.
      await expect(check('^[0-9]+$')).resolves.toBe(true)

      expect(state.value).toBe('ok')
    })
  })

  describe('when the author keeps typing', () => {
    it('lets only the newest answer win', async () => {
      let releaseFirst: (v: { ok: false; reason: string }) => void
      serverSays.mockImplementationOnce(
        () => new Promise(resolve => { releaseFirst = resolve as never })
      )
      serverSays.mockResolvedValueOnce({ ok: true })

      const { state, check } = usePatternAuthoring()

      const stale = check('^(a')       // still in flight
      await check('^(a)$')             // finishes first

      releaseFirst!({ ok: false, reason: 'unterminated group' })
      await stale

      // The stale answer must not overwrite the current one, or the panel shows
      // an error for a pattern the author has already fixed.
      expect(state.value).toBe('ok')
    })

    it('forgets an in-flight result when the field changes', async () => {
      const { state, check, reset } = usePatternAuthoring()
      serverSays.mockResolvedValue({ ok: false, reason: 'nope' })

      const pending = check('(?=x)')
      reset()
      await pending

      expect(state.value).toBe('empty')
    })
  })
})
