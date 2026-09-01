import { logger } from '../services/logger.js'
/**
 * Reads a boolean from the environment. Accepts `true`/`false` and `1`/`0`.
 *
 * Same contract as `envInt`: a value that cannot be read is logged and the
 * default is used, and every caller must pick the safe direction as its
 * default so that a typo cannot quietly turn a control off.
 */
export function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback

  const value = raw.trim().toLowerCase()
  if (value === 'true' || value === '1') return true
  if (value === 'false' || value === '0') return false

  logger.warn(
    `Invalid ${name}="${raw}" (expected true/false); using ${fallback}`
  )
  return fallback
}

/**
 * Reads an integer from the environment, falling back to a default rather than
 * crashing on nonsense.
 *
 * A bad value here should not take the service down, but it must not silently
 * become something permissive either: an unparseable or out-of-range value is
 * logged and the (safe) default is used.
 */
export function envInt(name: string, fallback: number, min = 1): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback

  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < min) {
    logger.warn(
      `Invalid ${name}="${raw}" (expected an integer >= ${min}); using ${fallback}`
    )
    return fallback
  }

  return parsed
}
