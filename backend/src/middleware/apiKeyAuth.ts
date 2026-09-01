import type { Request, Response, NextFunction } from 'express'
import { AppError } from './errorHandler.js'
import { verifyApiKey, touchApiKey } from '../services/api-key.js'

/**
 * Authentication for `/api/v1`, and the only credential in this product that
 * does not belong to a person (features/0019).
 *
 * It sits beside `middleware/auth.ts` rather than inside it, and that
 * separation is the design decision of this feature rather than a filing
 * choice. Everything under `/api/*` resolves `req.userId` and scopes queries
 * with `organization: { memberships: { some: { userId } } }`
 * (`middleware/formOwnership.ts`). An API key has no user, so the two obvious
 * ways to reuse that machinery are both wrong:
 *
 *   - **Giving the key a user id** - its creator's, say - ties a customer's
 *     integration to one employee. Remove that person from the organization and
 *     production breaks, reporting a missing form rather than the real cause.
 *     It would also make `Membership.role` apply to a machine.
 *   - **Loosening `callerCanReachForm`** to take either a user or an
 *     organization changes the authorization input of *every* authenticated
 *     route in the product, for the benefit of a handful of new ones.
 *
 * So `/api/v1` is its own router, scoping on `organizationId` directly, and the
 * two credentials are not interchangeable in either direction: a session token
 * is refused here, and a key is refused by `authenticate`. Both directions are
 * asserted in `tests/integration/api-v1.spec.ts`.
 */

export interface ApiKeyRequest extends Request {
  /** Set by `identifyApiKey` when a usable credential was presented. */
  apiKey?: { id: string; organizationId: string }
}

/**
 * Reads the credential if there is one, and **never rejects**.
 *
 * The split between this and `requireApiKey` is not decoration: it is what
 * makes the rate limiter reachable by a caller who does not authenticate. With
 * one middleware that both identified and rejected, an unauthenticated request
 * was answered `401` *before* the limiter ran, so an attacker had an unlimited
 * budget of unauthenticated requests — each one still costing a parse and,
 * for a well-formed prefix, a database lookup. The order on the router is
 * therefore: identify, limit, require.
 */
export async function identifyApiKey(
  req: ApiKeyRequest,
  _res: Response,
  next: NextFunction
) {
  try {
    const header = req.headers.authorization
    if (!header || !header.startsWith('Bearer ')) return next()

    const verified = await verifyApiKey(header.slice('Bearer '.length))
    if (!verified) return next()

    req.apiKey = { id: verified.id, organizationId: verified.organizationId }

    // Bookkeeping, deliberately not awaited: `lastUsedAt` is what lets a
    // customer tell a live integration from a forgotten credential, and it is
    // not worth a millisecond on the response path. It writes at most once a
    // minute per key and swallows its own failures.
    void touchApiKey(verified.id, verified.lastUsedAt)

    next()
  } catch (error) {
    next(error)
  }
}

/**
 * Rejects anything that did not arrive with a usable key.
 *
 * One message for every kind of failure - missing, malformed, unknown, wrong
 * secret, revoked. Saying which would let someone probe whether a prefix they
 * found in a log belongs to a real key.
 */
export function requireApiKey(req: ApiKeyRequest, _res: Response, next: NextFunction) {
  if (!req.apiKey) return next(new AppError(401, 'Invalid or missing API key'))
  next()
}

/**
 * The organization this request speaks for.
 *
 * Throws rather than returning `undefined`, so a handler that forgot the
 * middleware fails loudly instead of running an unscoped query - which on this
 * router would be a cross-tenant read.
 */
export function callerOrganizationId(req: ApiKeyRequest): string {
  if (!req.apiKey) {
    throw new AppError(401, 'No API key provided')
  }

  return req.apiKey.organizationId
}
