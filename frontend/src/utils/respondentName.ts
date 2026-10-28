/**
 * The respondent's declared name, checked in the browser (features/0054).
 *
 * A mirror of `backend/src/services/respondent-name.ts` for feedback only: the
 * server normalises again and is the gate. Keep the two limits equal.
 */

export const RESPONDENT_NAME_MAX_LENGTH = 120

// Built from code points rather than written literally, so no editor or tool
// can turn the separators into real line breaks inside a regex literal.
const CONTROL_CHARACTERS = new RegExp(
  `[\\u0000-\\u001F\\u007F-\\u009F${String.fromCharCode(0x2028, 0x2029)}]`
)

/** The name as the server will store it. */
export function normalizeRespondentName(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

/** Why the name would be refused, or `null` when it would be accepted. */
export function respondentNameError(value: string): string | null {
  if (CONTROL_CHARACTERS.test(value)) return 'Your name contains characters that are not allowed'
  const name = normalizeRespondentName(value)
  if (name.length === 0) return 'Your name is required'
  if (name.length > RESPONDENT_NAME_MAX_LENGTH) return `Maximum length is ${RESPONDENT_NAME_MAX_LENGTH}`
  return null
}
