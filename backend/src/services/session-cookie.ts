import { Response } from 'express'
import { envBool } from '../config/env.js'
import { refreshTokenTtlMs } from './refresh-token.js'

/**
 * The refresh token travels in an `httpOnly` cookie, which is the whole point of
 * finding S4: JavaScript on the page cannot read it, so an XSS cannot walk away
 * with a long-lived credential.
 *
 * The access token deliberately does NOT live here. It is returned in the
 * response body and held in memory by the SPA, so every other endpoint keeps
 * authenticating with an `Authorization: Bearer` header — and a header cannot be
 * forged cross-site, which keeps the entire API immune to CSRF. Only the two
 * routes that read this cookie need a CSRF guard. See `middleware/csrf.ts`.
 */
export const REFRESH_COOKIE = 'refresh_token'

/**
 * Scoped to the auth routes, so the cookie is not attached to the hundreds of
 * ordinary API requests that have no use for it. Narrower than `/` on purpose:
 * a credential that is not sent is a credential that cannot leak in a log.
 */
const COOKIE_PATH = '/api/auth'

function cookieOptions() {
  return {
    httpOnly: true,
    // Defaults to true. Browsers treat `localhost` as a trustworthy origin, so
    // a Secure cookie still works over plain HTTP in development — which means
    // the safe default is also the working one. Set COOKIE_SECURE=false only
    // for a non-localhost deployment served over plain HTTP, which should not
    // exist.
    secure: envBool('COOKIE_SECURE', true),
    // `Lax` and not `None`. `None` would be needed if the SPA and the API were
    // cross-site, and it is a trap: Safari's ITP and Firefox block third-party
    // cookies, so it would work on the developer's Chrome and silently fail for
    // a real customer. The deployment requirement that keeps `Lax` correct — the
    // SPA and the API must share a registrable domain — is in
    // docs/sot/08-operations.md.
    sameSite: 'lax' as const,
    path: COOKIE_PATH
  }
}

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, { ...cookieOptions(), maxAge: refreshTokenTtlMs() })
}

/**
 * The attributes must match those the cookie was set with, or the browser keeps
 * the original and logout silently does nothing on the client side. The
 * server-side revocation is what actually ends the session, but leaving a dead
 * cookie in place makes the next refresh fail in a confusing way.
 */
export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, cookieOptions())
}
