import { api } from './api'

/**
 * The account itself, as opposed to the session (`auth.ts`) or the organization
 * (`organization.ts`).
 *
 * One method, and it is the one with no undo — which is why it lives here rather
 * than growing onto `authService`: deleting an account is not a session
 * operation, and putting it beside `logout` invites the two being confused by
 * whoever reads the call site next.
 */
export const accountService = {
  /**
   * Deletes the account and every organization the caller is alone in.
   *
   * The password is re-entered by the person, not held anywhere: the access
   * token proves the session, and this proves who is at the keyboard.
   *
   * Throws `ApiError` with the server's own message, which the screen shows
   * verbatim — a `409` here names the organizations blocking the deletion and
   * says what to do about them, and paraphrasing it would lose that.
   */
  async deleteAccount(password: string): Promise<void> {
    await api.delete('/account', { password })
  }
}
