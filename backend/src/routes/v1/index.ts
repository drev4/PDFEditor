import { Router } from 'express'
import { identifyApiKey, requireApiKey, requireApiAccess } from '../../middleware/apiKeyAuth.js'
import { apiRateLimit } from '../../middleware/rateLimit.js'
import { v1FormsRouter } from './forms.js'

/**
 * `/api/v1` — the published API (features/0019).
 *
 * Mounted in `app.ts` beside the internal routers, and the only one of them
 * whose shape is a promise to somebody outside this repository.
 *
 * The two middlewares are applied here rather than per route, which is an
 * exception to the rule in docs/sot/04-backend-patterns.md §2 that guards go
 * next to the handler. The reason it is safe here and not there: *every* route
 * on this router has the same answer — key required, limit applied — so there
 * is no per-handler decision to make visible, and mounting them once removes
 * the possibility of a future endpoint being added without them. On the
 * internal routers the opposite is true: `GET /api/forms/public/:shareId` is
 * anonymous and sits beside authenticated siblings, so the guard has to be
 * readable per handler.
 *
 * **The order of the three is the interesting part.** Identify, then limit,
 * then require:
 *
 *   - identifying first is what lets the limiter count against the API key
 *     rather than the address, which is the whole point of `apiRateLimit`;
 *   - limiting before *rejecting* is what stops an unauthenticated caller
 *     having an unlimited budget. Rejecting first looks obviously right and is
 *     the cheapest possible bypass: the limiter never runs, so an attacker
 *     spends nothing by simply not sending a key. A test asserts it
 *     (`tests/integration/api-rate-limit.spec.ts`), and it caught exactly that
 *     mistake in the first draft of this router.
 *
 * `requireApiAccess` is last, and it is checked on **every** request rather
 * than only when a key was minted — otherwise a month of Team buys a key that
 * keeps reading respondent data for ever.
 */
export const v1Router = Router()

v1Router.use(identifyApiKey)
v1Router.use(apiRateLimit)
v1Router.use(requireApiKey)
v1Router.use(requireApiAccess)

v1Router.use('/forms', v1FormsRouter)
