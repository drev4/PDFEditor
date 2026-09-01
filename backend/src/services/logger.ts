import pino from 'pino'

/**
 * The logger (features/0025).
 *
 * **This is the only module that constructs a `pino` instance.** Everything else
 * imports `logger`, or — inside a request — uses `req.log`, which is a child of
 * it carrying the request id (`middleware/requestLog.ts`).
 *
 * ## What is never logged
 *
 * **No request body, ever.** Not at `debug`, not behind a flag. The most
 * sensitive thing this API handles is answer values typed by members of the
 * public, and they arrive as `POST /api/responses` with `answers` keyed by field
 * id — an object whose *paths are data*, so no redaction list can cover them.
 * The rule is the same one that keeps payloads out of the webhook delivery log
 * (features/0020): do not collect it, rather than collect it and try to hide it.
 *
 * `redact` below is therefore a **backstop against a future line that forgets**,
 * not the mechanism. A design that logs everything and then removes the
 * known-bad paths fails *open*; one that logs only what it names fails *closed*,
 * and this codebase does the second.
 *
 * ## Levels, and where they come from
 *
 * `LOG_LEVEL` selects it, `info` by default. The test environment is **silent**:
 * a suite that prints log lines trains everybody to ignore its output, which is
 * where a real failure will be.
 *
 * Development gets `pino-pretty`, because a person is reading it. Everything
 * else gets one JSON object per line, because a machine is.
 */

/** Human-readable in development; one JSON object per line everywhere else. */
function transport() {
  if (process.env.NODE_ENV !== 'development') return undefined

  return {
    target: 'pino-pretty',
    options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' }
  }
}

function level(): string {
  if (process.env.LOG_LEVEL) return process.env.LOG_LEVEL
  // Not `silent` merely to be quiet: an assertion about a log line belongs in a
  // test that installs its own destination, not in whatever scrolled past.
  return process.env.NODE_ENV === 'test' ? 'silent' : 'info'
}

/**
 * Exported so a test can drive the real configuration rather than a copy of it.
 * A redaction list asserted against a second list in a spec proves only that
 * somebody typed the same thing twice.
 */
export const REDACT = {
  paths: [
    'authorization',
    'cookie',
    'password',
    'token',
    'secret',
    '*.authorization',
    '*.cookie',
    '*.password',
    '*.token',
    '*.secret',
    'headers.authorization',
    'headers.cookie'
  ],
  censor: '[redacted]'
}

export const logger = pino({
  level: level(),
  redact: REDACT,
  ...(transport() ? { transport: transport() } : {})
})

export type Logger = typeof logger
