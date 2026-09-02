import crypto from 'crypto'

/**
 * Whether this deployment accepts new accounts from the open internet
 * (features/0033).
 *
 * ## Why this exists
 *
 * `POST /api/auth/register` was open, and the landing at `docaiflow.com` is
 * live and collecting waitlist addresses — so the URL is discoverable by people
 * the private beta has not admitted. The beta is committed for 2026-09-30 and
 * public opening is scheduled for one week after it, which is a calendar event
 * rather than an engineering task. That is the whole reason this is
 * configuration and not code: **the way back has to be a switch somebody can
 * throw**, not a deploy that reverts a commit.
 *
 * ## What it is not
 *
 * It is **not** a gate over account creation in general, and that distinction
 * is the one thing to get right here. `POST /api/organizations/invitations/
 * accept` also creates users, and it must keep working in every mode: a person
 * holding a single-use, expiring, address-bound token has already been admitted
 * by a paying customer, and closing that path would break the colleagues of the
 * very customers the beta is for. So the only caller of `registrationMode` that
 * refuses anything is the `/register` handler.
 *
 * It is also not a login control. Account-level lockout on repeated failed
 * logins is a separate, still-open item (S10 in `07-security-and-privacy.md`).
 *
 * ## The admission mechanism, and its accepted cost
 *
 * A **shared** signup code, carried in the beta email. It can be forwarded, and
 * that is a real cost that was weighed rather than missed: the beta is free, so
 * a forwarded code produces an extra unpaid account rather than lost revenue.
 * The alternatives cost more than that is worth — an allowlist puts customer
 * addresses into deploy configuration and needs a restart per cohort, and
 * per-person invitations that create their own organization are a migration on
 * a table in the cascade map, for a mechanism retired one week after it ships.
 * The second is filed in `docs/BACKLOG.md` if a larger cohort ever needs it.
 *
 * ## Where the default lives, and why it is not here
 *
 * `MODE_DEFAULT` is `open`, which looks like the unsafe direction and would be,
 * on its own: a production deploy that forgot the variable would silently run
 * an open beta. The check that makes it safe is in `config/validate-env.ts`,
 * which **requires the variable explicitly whenever `isStrict(env)`**. That is
 * the shape features/0028 already built, and it is here because neither literal
 * default is safe — defaulting to `invite_only` would instead break every
 * developer environment and the four suites that register users.
 *
 * This module is the only place in `src/` that reads either variable.
 */

export type RegistrationMode = 'open' | 'invite_only'

export const REGISTRATION_MODES: readonly RegistrationMode[] = ['open', 'invite_only']

/**
 * Used when `REGISTRATION_MODE` is unset. Safe only because `validateEnv`
 * refuses to boot a strict environment that has not set it — see the module
 * comment above.
 */
const MODE_DEFAULT: RegistrationMode = 'open'

/**
 * The shortest `REGISTRATION_CODE` this accepts, enforced by `validateEnv`.
 *
 * A code is guessed through `registerRateLimit`, so the limiter does most of
 * the work; the length is what stops the code being a word somebody picked.
 */
export const MIN_CODE_LENGTH = 16

function raw(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value ? value : undefined
}

/**
 * The mode this process is running in.
 *
 * **An unrecognised value throws rather than falling back**, which is the same
 * refusal `services/pdf-storage.ts` makes for an unknown driver and for the
 * same reason: there is no safe direction to guess in. Falling back to `open`
 * would put a typo — `REGISTRATION_MODE=inviteonly` — in charge of whether the
 * private beta is private, and it would do so silently. Falling back to
 * `invite_only` would lock everybody out just as silently. `validateEnv`
 * reports the same problem at boot, so in a real process this throw is the
 * second line of defence rather than the first.
 */
export function registrationMode(): RegistrationMode {
  const requested = raw('REGISTRATION_MODE')
  if (!requested) return MODE_DEFAULT

  if ((REGISTRATION_MODES as readonly string[]).includes(requested)) {
    return requested as RegistrationMode
  }

  throw new Error(
    `Unknown REGISTRATION_MODE="${requested}". Expected "open" or "invite_only".`
  )
}

/** True when new accounts require the signup code. */
export function registrationIsClosed(): boolean {
  return registrationMode() === 'invite_only'
}

function sha256(value: string): Buffer {
  return crypto.createHash('sha256').update(value).digest()
}

/**
 * Whether `supplied` is the configured signup code.
 *
 * Both sides are hashed and compared with `crypto.timingSafeEqual`, the same
 * shape `services/api-key.ts` uses. Hashing first is what makes the comparison
 * safe to write at all: `timingSafeEqual` throws on a length mismatch, so
 * comparing the raw strings would leak the code's length through an exception,
 * while two SHA-256 digests are always 32 bytes.
 *
 * A missing code and a wrong code are the same answer on purpose — the caller
 * turns both into one `403` with one message, so nothing here distinguishes
 * "you sent nothing" from "you sent something close".
 *
 * **The code is never logged**, here or in the caller. It arrives in a request
 * body and `middleware/requestLog.ts` does not log bodies; nothing added by
 * this feature may change that.
 */
export function codeMatches(supplied: string | undefined): boolean {
  const expected = raw('REGISTRATION_CODE')
  if (!expected) return false

  const presented = supplied?.trim()
  if (!presented) return false

  return crypto.timingSafeEqual(sha256(presented), sha256(expected))
}
