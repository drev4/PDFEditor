import { Router } from 'express'
import { prisma } from '../../services/db.js'
import { callerOrganizationId, type ApiKeyRequest } from '../../middleware/apiKeyAuth.js'
import { asyncHandler } from '../../middleware/asyncHandler.js'

/**
 * The delivery log, readable by the customer whose deliveries they are
 * (features/0020).
 *
 * On `/api/v1` rather than on the session API because it answers a question an
 * integration asks — *did you send me everything?* — and the integration is the
 * thing holding an API key. Configuring an endpoint stays on the session API,
 * where a person is looking at a screen: a credential that could add a new place
 * for customer data to be sent would turn one leaked key into an exfiltration
 * channel.
 *
 * **What is not here is the payload.** `webhook_deliveries` deliberately stores
 * no request body (see `schema.prisma`), because the body of
 * `response.created` contains the answers a member of the public typed into a
 * form, and a log holding them would be a second copy of respondent personal
 * data that outlives the form it came from.
 */
export const v1WebhooksRouter = Router()

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

v1WebhooksRouter.get('/deliveries', asyncHandler(async (req: ApiKeyRequest, res, next) => {
  const organizationId = callerOrganizationId(req)

  const requested = Number.parseInt(String(req.query.limit ?? ''), 10)
  const limit = Number.isInteger(requested) && requested > 0
    ? Math.min(requested, MAX_LIMIT)
    : DEFAULT_LIMIT

  // Scoped through the endpoint's organization, in the `where` and not after
  // the fact — the same rule as every other query on this router.
  const where = { endpoint: { organizationId } }

  const [total, deliveries] = await Promise.all([
    prisma.webhookDelivery.count({ where }),
    prisma.webhookDelivery.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        endpointId: true,
        eventId: true,
        eventType: true,
        attempt: true,
        status: true,
        durationMs: true,
        succeeded: true,
        error: true,
        createdAt: true
      }
    })
  ])

  res.json({ data: deliveries, pagination: { total, limit, offset: 0 } })
}))
