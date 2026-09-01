import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

/**
 * Every `async` route handler is wrapped (features/0026).
 *
 * **This is the half of the feature that does the work.** A wrapper somebody has
 * to remember fails exactly like a `try`/`catch` somebody has to remember: the
 * next handler that forgets `asyncHandler(...)` is in precisely the position an
 * unguarded one is today — Express 4 never learns the promise rejected, and the
 * request is never answered.
 *
 * It is a lint rule in the only shape this repository can run one. `npm run
 * lint` lints nothing and there is no ESLint config, which is its own backlog
 * row; until there is, this spec is the thing that notices.
 *
 * **If this failed on you:** wrap the handler it names —
 * `router.get('/x', asyncHandler(async (req, res) => { … }))` — and delete the
 * outer `try`/`catch` whose only body was `next(error)`. Keep any inner `catch`
 * that does something else; three of those exist and are deliberate.
 *
 * It can be deleted the day Express 5 lands, which forwards rejections itself.
 * That is filed in `docs/BACKLOG.md`, and this comment is how whoever does it
 * will know this file is theirs to remove.
 */
describe('async handler coverage', () => {
  const SRC = path.join(process.cwd(), 'src')

  /** Everything that mounts a handler on a router. */
  function sourcesToScan(): string[] {
    const files = [path.join(SRC, 'app.ts'), path.join(SRC, 'middleware', 'apiKeyAuth.ts')]

    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.name.endsWith('.ts')) files.push(full)
      }
    }
    walk(path.join(SRC, 'routes'))

    return files
  }

  /**
   * Lines that open an `async` handler without the wrapper.
   *
   * Deliberately boring: it looks for `async (` on a line that is not already
   * inside `asyncHandler(`. A cleverer scan that silently matched nothing would
   * be worse than none, which is what the negative control below is for.
   */
  function unwrappedHandlers(source: string): { line: number; text: string }[] {
    const found: { line: number; text: string }[] = []

    source.split('\n').forEach((text, index) => {
      const opensHandler = /async \((req|_req)\b/.test(text)
      if (!opensHandler) return
      // `asyncHandler(` and `asyncHandler<ApiKeyRequest>(` both count. The
      // generic form is not a curiosity: it is how the two `/api/v1` middleware
      // are written, and the first draft of this scan flagged them both.
      if (/asyncHandler\s*(<[^>]*>)?\s*\(/.test(text)) return
      // A standalone `async function` declaration is not mounted on a router by
      // this line; only the call sites matter.
      if (/^\s*(export )?async function/.test(text)) return

      found.push({ line: index + 1, text: text.trim() })
    })

    return found
  }

  it('finds no unwrapped handler anywhere a router mounts one', () => {
    const offences: string[] = []

    for (const file of sourcesToScan()) {
      const source = fs.readFileSync(file, 'utf-8')
      for (const hit of unwrappedHandlers(source)) {
        offences.push(`${path.relative(process.cwd(), file)}:${hit.line}  ${hit.text}`)
      }
    }

    // The message is the point: whoever this fails on has probably never read
    // this file, so it has to say where and what.
    expect(
      offences,
      `These handlers are not wrapped in asyncHandler(), so a rejection would ` +
        `leave the request unanswered:\n  ${offences.join('\n  ')}\n`
    ).toEqual([])
  })

  it('the scan can actually fail', () => {
    // The negative control. Without this, a regex that stopped matching would
    // report a clean codebase for ever and nobody would notice — which is the
    // failure mode of every check that only ever passes.
    const offending = [
      "formsRouter.get('/:id', authenticate, async (req: AuthRequest, res, next) => {",
      '  const form = await prisma.form.findUnique({ where: { id } })',
      '})'
    ].join('\n')

    expect(unwrappedHandlers(offending)).toHaveLength(1)
    expect(unwrappedHandlers(offending)[0]!.line).toBe(1)
  })

  it('does not flag a handler that is wrapped, with or without a generic', () => {
    const fine = [
      "formsRouter.get('/:id', authenticate, asyncHandler(async (req: AuthRequest, res) => {",
      '  res.json({ ok: true })',
      '}))',
      // How the two `/api/v1` middleware are written. The first draft of the
      // scan matched the literal `asyncHandler(` and flagged both of them.
      'export const identify = asyncHandler<ApiKeyRequest>(async (req, _res, next) => {',
      '  next()',
      '})'
    ].join('\n')

    expect(unwrappedHandlers(fine)).toEqual([])
  })
})
