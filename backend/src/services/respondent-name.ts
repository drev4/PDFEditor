/**
 * The respondent's declared name (features/0054).
 *
 * **Declared, not verified.** A share link is anonymous, so this is whatever the
 * person holding it typed. It is stored as a snapshot string and never matched
 * against an account; every surface that shows it labels it "Declared name".
 *
 * One function decides what a valid name is, so the submit route, its tests and
 * any later consumer (the completed PDF, PRD-018) cannot disagree.
 */

/** Longest name accepted, counted after normalisation. */
export const RESPONDENT_NAME_MAX_LENGTH = 120

// C0 and C1 control characters, DEL, and the Unicode line/paragraph separators.
// A name is one line of text; anything that moves the cursor or breaks a CSV
// row is not part of one.
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/

export type RespondentNameResult =
  | { ok: true; name: string }
  | { ok: false; error: string }

/**
 * Trims, collapses runs of whitespace to one space, and checks the limits.
 *
 * The client mirrors this for feedback; this is the gate.
 */
export function normalizeRespondentName(value: unknown): RespondentNameResult {
  if (typeof value !== 'string') {
    return { ok: false, error: 'Your name is required' }
  }

  // Checked before collapsing whitespace, because `\s` would quietly turn a tab
  // or a newline into a space and accept it.
  if (CONTROL_CHARACTERS.test(value)) {
    return { ok: false, error: 'Your name contains characters that are not allowed' }
  }

  const name = value.trim().replace(/\s+/g, ' ')

  if (name.length === 0) {
    return { ok: false, error: 'Your name is required' }
  }

  if (name.length > RESPONDENT_NAME_MAX_LENGTH) {
    return { ok: false, error: `Maximum length is ${RESPONDENT_NAME_MAX_LENGTH}` }
  }

  return { ok: true, name }
}
