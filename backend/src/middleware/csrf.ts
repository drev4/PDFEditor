import { Request, Response, NextFunction } from 'express'
import { AppError } from './errorHandler.js'

/**
 * CSRF protection for the two routes that authenticate with a cookie.
 *
 * Everything else in this API authenticates with an `Authorization: Bearer`
 * header, which a cross-site request cannot set — so the rest of the API needs
 * nothing here, and mounting this globally would suggest a threat that does not
 * exist. `POST /api/auth/refresh` and `POST /api/auth/logout` are different:
 * they read the refresh cookie, and the browser attaches that by itself no
 * matter who caused the request.
 *
 * Applied at the route, next to the handler it guards, like `authenticate` —
 * see docs/sot/04-backend-patterns.md §2 and §9.
 *
 * Two checks, because neither covers every client on its own:
 *
 *  - `Sec-Fetch-Site` is set by the browser and cannot be forged by page script.
 *    `cross-site` is rejected outright. This is the strong check where it exists.
 *  - `Origin`, compared against the configured frontend. Present on every
 *    cross-origin request a browser makes.
 *
 * A request with neither header is allowed. That is deliberate rather than a
 * gap: CSRF is an attack that needs a browser to carry it out, and a browser
 * always sends at least one of these on a cross-site POST. Rejecting their
 * absence would break curl, the health checks and the test suite while adding
 * no protection. The `SameSite=Lax` attribute on the cookie is the third layer
 * underneath both.
 */
export function verifySameOrigin(req: Request, _res: Response, next: NextFunction) {
  const fetchSite = req.get('Sec-Fetch-Site')
  if (fetchSite === 'cross-site') {
    throw new AppError(403, 'Cross-site request rejected')
  }

  const origin = req.get('Origin')
  if (origin && origin !== allowedOrigin()) {
    throw new AppError(403, 'Cross-site request rejected')
  }

  next()
}

function allowedOrigin(): string {
  // The same value the CORS policy in app.ts is pinned to. Read per request
  // rather than at import so a test can drive it through process.env, the way
  // the rate limiters are configured.
  return process.env.FRONTEND_URL || 'http://localhost:5173'
}
