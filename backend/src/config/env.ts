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
    console.warn(
      `Invalid ${name}="${raw}" (expected an integer >= ${min}); using ${fallback}`
    )
    return fallback
  }

  return parsed
}
