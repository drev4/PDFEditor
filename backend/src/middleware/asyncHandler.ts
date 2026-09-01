import type { NextFunction, Request, RequestHandler, Response } from 'express'

/**
 * Sends a rejected promise to the error handler (features/0026).
 *
 * **Express 4 does not do this.** An `async` handler that rejects tells Express
 * nothing: the request is never answered and the caller waits for a timeout,
 * while Node raises `unhandledRejection` — survived since features/0017 by
 * `process-guards.ts`, so the process lives and the request does not. It has
 * shipped once, on the *unauthenticated* signed-PDF route (features/0016).
 *
 * Every handler is wrapped, so the outer `try`/`catch` whose only body was
 * `next(error)` is gone from all of them. What is **not** gone, and must not be:
 * the inner `catch` blocks that swallow a best-effort failure on purpose — the
 * PDF field sync in `routes/forms.ts`, extraction in `routes/upload.ts` — and
 * `callerFromHeader`'s bare `catch` in `routes/organizations.ts`, where an
 * expired token means "not signed in" rather than an error. Those are decisions,
 * not omissions.
 *
 * ## Why this is not enough on its own, and what carries the rest
 *
 * A wrapper somebody has to remember fails exactly like a `try`/`catch`
 * somebody has to remember. `tests/async-handler-coverage.spec.ts` is the other
 * half: it reads these route files and fails when an `async` handler is not
 * wrapped. That is a lint rule in the only shape this repository can run one
 * today — there is no ESLint config, which is its own backlog row.
 *
 * ## And why this file is temporary
 *
 * Express 5 forwards rejections natively and needs no wrapper and no scan. The
 * route syntax here was checked against `path-to-regexp` v8 and is already
 * compatible; the upgrade is filed in `docs/BACKLOG.md`, and whoever does it
 * should delete this file and the scan with it.
 */

/**
 * The handler shape as the routes actually write it.
 *
 * Generic over the request so `asyncHandler(async (req: AuthRequest, …) => …)`
 * needs no cast at any call site — `AuthRequest` and `ApiKeyRequest` both flow
 * through unchanged.
 */
type AsyncRequestHandler<Req extends Request = Request> = (
  req: Req,
  res: Response,
  next: NextFunction
) => void | Promise<void | Response>

export function asyncHandler<Req extends Request = Request>(
  handler: AsyncRequestHandler<Req>
): RequestHandler {
  return (req, res, next) => {
    // `Promise.resolve().then(...)` rather than calling and catching, so a
    // **synchronous** throw takes the same path as a rejection. Express catches
    // the synchronous case itself, but the two must not answer differently.
    Promise.resolve()
      .then(() => handler(req as Req, res, next))
      .catch(next)
  }
}
