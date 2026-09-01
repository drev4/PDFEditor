import { Router, Response } from 'express'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { prisma } from '../services/db.js'
import { AppError } from '../middleware/errorHandler.js'
import { authenticate, AuthRequest } from '../middleware/auth.js'
import { requireMembership, requireRole, assertNotLastOwner } from '../middleware/membership.js'
import { invitationRateLimit } from '../middleware/rateLimit.js'
import { issueRefreshToken } from '../services/refresh-token.js'
import { setRefreshCookie } from '../services/session-cookie.js'
import { assertCanInvite, assertHasApiAccess, getEntitlements } from '../services/entitlements.js'
import { mintApiKey } from '../services/api-key.js'
import { mintWebhookSecret, isWebhookSigningConfigured } from '../services/webhooks.js'
import { assertDeliverableUrl } from '../services/webhook-egress.js'
import { isRedisConfigured } from '../services/redis.js'
import { subscriptionFor } from '../services/stripe.js'
import {
  createInvitation,
  findRedeemable,
  invitationLink,
  normalizeEmail
} from '../services/invitation.js'

export const organizationsRouter = Router()

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['owner', 'admin', 'member']).default('member')
})

const roleSchema = z.object({
  role: z.enum(['owner', 'admin', 'member'])
})

const acceptSchema = z.object({
  token: z.string().min(1),
  // Only used when the invited address has no account yet.
  password: z.string().min(6).optional(),
  name: z.string().optional()
})

/**
 * GET /api/organizations — the caller's organizations, and which one is active
 * (features/0023).
 *
 * Any member, because it is what the sidebar switcher reads and everyone has a
 * sidebar. It carries names and slugs, which are the customer's own — one
 * organization's name is not a secret from somebody who is inside it, and the
 * list is scoped to memberships the caller holds.
 *
 * `activeOrganizationId` here is the **resolved** one, from
 * `requireMembership`, and not the raw column: a stale choice falls back, and a
 * screen that showed the raw value would highlight an organization the API is
 * not actually acting in.
 */
organizationsRouter.get('/', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const { organizationId } = await requireMembership(req)

    const memberships = await prisma.membership.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: 'asc' },
      select: {
        role: true,
        organization: { select: { id: true, name: true, slug: true } }
      }
    })

    res.json({
      organizations: memberships.map(m => ({
        id: m.organization.id,
        name: m.organization.name,
        slug: m.organization.slug,
        role: m.role
      })),
      activeOrganizationId: organizationId
    })
  } catch (error) {
    next(error)
  }
})

const activeSchema = z.object({
  organizationId: z.string().min(1)
})

/**
 * POST /api/organizations/active — switch which organization the caller acts in.
 *
 * The membership check is the authorization: writing an organization the caller
 * does not belong to would be storing a claim, and `requireMembership` would
 * ignore it anyway — but answering `404` here says so at the moment it is asked
 * rather than leaving a switcher that appears to work and silently does not.
 *
 * `404` and not `403`, like every other cross-tenant answer in this codebase: a
 * `403` would confirm the organization exists.
 */
organizationsRouter.post('/active', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const validation = activeSchema.safeParse(req.body)
    if (!validation.success) {
      return res.status(400).json({ error: 'Validation error', details: validation.error.errors })
    }

    const { organizationId } = validation.data

    const membership = await prisma.membership.findFirst({
      where: { userId: req.userId, organizationId },
      select: { role: true }
    })

    if (!membership) throw new AppError(404, 'Organization not found')

    await prisma.user.update({
      where: { id: req.userId },
      data: { activeOrganizationId: organizationId }
    })

    res.json({ activeOrganizationId: organizationId, role: membership.role })
  } catch (error) {
    next(error)
  }
})

// GET /api/organizations/entitlements — any member may see the plan and usage.
//
// Not owner-only: the sidebar card and the plan screen are visible to everyone
// in the organization, and a member who cannot see why publishing was refused
// has no way to understand the product. It carries no organization id and no
// Stripe identifier — only what the plan allows, what has been used, and (since
// features/0013) the subscription's status and period end, which are things a
// screen displays rather than things a limit is computed from.
organizationsRouter.get('/entitlements', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const { organizationId } = await requireMembership(req)
    const { plan, usage, seatLimit } = await getEntitlements(organizationId)
    const subscription = await subscriptionFor(organizationId)

    res.json({
      plan: {
        key: plan.key,
        name: plan.name,
        maxPublishedForms: plan.maxPublishedForms,
        maxResponsesPerMonth: plan.maxResponsesPerMonth,
        // The **effective** seat limit, not the catalogue's (features/0015).
        // Team's seats are bought rather than declared, so `plan.seats` is only
        // the floor there; sending it would show a Team customer who paid for
        // eight seats a meter that says three. Every other plan's catalogue
        // value passes through unchanged, and the client is deliberately not
        // told which of the two it received — one number, one meaning.
        seats: seatLimit,
        // Whether this organization may mint an API key (features/0021).
        //
        // It is here so the screen knows what to *draw*, and for nothing else:
        // `assertHasApiAccess` inside `POST /api-keys` is still the only thing
        // that decides what is allowed, and the client's `402` handler stays.
        // A capability the UI cannot see produces a create button that is
        // guaranteed to answer `402`, which tells a customer the product is
        // broken when it is enforcing a rule (05-frontend-patterns §8).
        //
        // Safe to send here and **not** on `GET /api/forms/public/:shareId`:
        // this endpoint is member-authenticated, so the plan state reaches the
        // customer who is paying for it rather than every respondent
        // (features/0014).
        hasApiAccess: plan.hasApiAccess
      },
      usage,
      // Only what a screen has to render, and **no Stripe identifier**
      // (features/0013). The customer and subscription ids are credentials for
      // a third-party API; the client never needs them, because every billing
      // action goes through `POST /api/billing/*`, which resolves the
      // organization from the caller's own membership.
      //
      // `null` until a subscription actually exists at Stripe. A row created by
      // an abandoned checkout holds a customer id and nothing bought, and
      // reporting that as a subscription would put "Manage billing" in front of
      // someone who never completed a payment.
      subscription: subscription?.stripeSubscriptionId
        ? {
            status: subscription.status,
            currentPeriodEnd: subscription.currentPeriodEnd,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd
          }
        : null
    })
  } catch (error) {
    next(error)
  }
})

// GET /api/organizations/members — any member may see who else is here.
organizationsRouter.get('/members', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const { organizationId } = await requireMembership(req)

    const memberships = await prisma.membership.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
      // Explicit select: a `passwordHash` must not be able to escape by
      // someone adding an `include` later.
      select: {
        role: true,
        createdAt: true,
        user: { select: { id: true, email: true, name: true } }
      }
    })

    res.json({
      members: memberships.map(m => ({
        id: m.user.id,
        email: m.user.email,
        name: m.user.name,
        role: m.role,
        joinedAt: m.createdAt
      }))
    })
  } catch (error) {
    next(error)
  }
})

// PATCH /api/organizations/members/:userId — owner only.
organizationsRouter.patch('/members/:userId', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const { organizationId } = await requireRole(req, ['owner'])

    const validation = roleSchema.safeParse(req.body)
    if (!validation.success) {
      return res.status(400).json({ error: 'Validation error', details: validation.error.errors })
    }

    const userId = req.params.userId as string
    const target = await prisma.membership.findFirst({ where: { organizationId, userId } })

    // 404 rather than 403: someone in another organization does not exist as
    // far as this one is concerned.
    if (!target) throw new AppError(404, 'Member not found')

    if (target.role === 'owner' && validation.data.role !== 'owner') {
      await assertNotLastOwner(organizationId, userId, 'demote')
    }

    await prisma.membership.update({
      where: { id: target.id },
      data: { role: validation.data.role }
    })

    res.json({ member: { id: userId, role: validation.data.role } })
  } catch (error) {
    next(error)
  }
})

// DELETE /api/organizations/members/:userId — owner only.
organizationsRouter.delete('/members/:userId', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const { organizationId } = await requireRole(req, ['owner'])

    const userId = req.params.userId as string
    const target = await prisma.membership.findFirst({ where: { organizationId, userId } })

    if (!target) throw new AppError(404, 'Member not found')

    await assertNotLastOwner(organizationId, userId, 'remove')

    // Only the membership goes. The person keeps their account, and the forms
    // they created stay with the organization — `Form.createdByUserId` is
    // provenance, never ownership (features/0009).
    await prisma.membership.delete({ where: { id: target.id } })

    res.status(204).send()
  } catch (error) {
    next(error)
  }
})

// GET /api/organizations/invitations — pending only. Owner or admin.
organizationsRouter.get('/invitations', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const { organizationId } = await requireRole(req, ['owner', 'admin'])

    const invitations = await prisma.invitation.findMany({
      where: { organizationId, revokedAt: null, acceptedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      // No `tokenHash`. It is not secret in the way the token is, but nothing
      // needs it and a hash that never leaves the database cannot be misused.
      select: { id: true, email: true, role: true, expiresAt: true, createdAt: true }
    })

    res.json({ invitations })
  } catch (error) {
    next(error)
  }
})

// POST /api/organizations/invitations — owner, or admin inviting a member.
organizationsRouter.post('/invitations', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const caller = await requireRole(req, ['owner', 'admin'])

    const validation = inviteSchema.safeParse(req.body)
    if (!validation.success) {
      return res.status(400).json({ error: 'Validation error', details: validation.error.errors })
    }

    const { role } = validation.data
    const email = normalizeEmail(validation.data.email)

    // An admin manages forms and members; handing out `admin` or `owner` is an
    // owner's decision, because it is how an organization changes hands.
    if (caller.role === 'admin' && role !== 'member') {
      throw new AppError(403, 'This action requires the owner role')
    }

    const alreadyIn = await prisma.membership.findFirst({
      where: { organizationId: caller.organizationId, user: { email } }
    })
    if (alreadyIn) {
      throw new AppError(400, 'That person is already a member of this organization')
    }

    // The seat limit, last of the checks and deliberately so (features/0015).
    //
    // After the role check and after "already a member": re-inviting someone who
    // is already here must not be refused for money, and an admin trying to hand
    // out `owner` must hear that it is not their decision rather than that the
    // plan is full. `402` — a plan limit — never `403`, which is what
    // `requireRole` throws a few lines above for a permission failure.
    //
    // It **buys nothing**. On a per-seat plan the seats are bought by the owner
    // in Stripe's portal and this only refuses the one that was not; see
    // `assertCanInvite` for why pushing a quantity from here was rejected.
    await assertCanInvite(caller.organizationId)

    const { id, token, expiresAt } = await createInvitation({
      organizationId: caller.organizationId,
      email,
      role,
      invitedByUserId: req.userId!
    })

    // The token is returned exactly once, here. There is no email service in
    // this application: the inviter copies this link and sends it themselves,
    // and nothing can recover it afterwards.
    res.status(201).json({
      invitation: { id, email, role, expiresAt, link: invitationLink(token) }
    })
  } catch (error) {
    next(error)
  }
})

// DELETE /api/organizations/invitations/:id — owner or admin.
organizationsRouter.delete('/invitations/:id', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const { organizationId } = await requireRole(req, ['owner', 'admin'])

    const invitation = await prisma.invitation.findFirst({
      where: { id: req.params.id as string, organizationId }
    })

    if (!invitation) throw new AppError(404, 'Invitation not found')

    await prisma.invitation.update({
      where: { id: invitation.id },
      data: { revokedAt: new Date() }
    })

    res.status(204).send()
  } catch (error) {
    next(error)
  }
})

// POST /api/organizations/invitations/accept
//
// Unauthenticated by design — the invited person may not have an account yet —
// which makes it a token-guessing surface, hence the limiter. Every failure
// answers the same way, for the reason in `services/invitation.ts`.
organizationsRouter.post('/invitations/accept', invitationRateLimit, async (req: AuthRequest, res, next) => {
  try {
    const validation = acceptSchema.safeParse(req.body)
    if (!validation.success) {
      return res.status(400).json({ error: 'Validation error', details: validation.error.errors })
    }

    const { token, password, name } = validation.data
    const invalid = new AppError(400, 'This invitation link is invalid or has expired.')

    const invitation = await findRedeemable(token)
    if (!invitation) throw invalid

    const caller = await callerFromHeader(req)
    const existing = await prisma.user.findUnique({ where: { email: invitation.email } })

    if (caller) {
      // Signed in. The invitation names an address, and it must be theirs — a
      // link forwarded to a colleague must not quietly put the colleague inside
      // the customer's organization instead.
      if (normalizeEmail(caller.email) !== invitation.email) {
        throw new AppError(
          409,
          `This invitation was sent to ${invitation.email}. Sign in as that account to accept it.`
        )
      }
      await joinOrganization(invitation, caller.id)
      return res.status(200).json({ organizationId: invitation.organizationId })
    }

    if (existing) {
      // The account exists but nobody is signed in. Accepting here would mean
      // granting access on a link alone, so it stops and asks for the password.
      throw new AppError(401, 'Sign in as ' + invitation.email + ' to accept this invitation.')
    }

    if (!password) {
      throw new AppError(400, 'A password is required to create your account.')
    }

    // Register and join as one act. Deliberately NOT the personal-organization
    // path in routes/auth.ts: this person is joining someone else's
    // organization, and giving them a second one would put them in two — which
    // `requireMembership` is not built for and would resolve arbitrarily.
    const created = await prisma.$transaction(async tx => {
      const user = await tx.user.create({
        data: {
          email: invitation.email,
          passwordHash: await bcrypt.hash(password, 10),
          name
        },
        select: { id: true, email: true, name: true, createdAt: true }
      })

      await tx.membership.create({
        data: { organizationId: invitation.organizationId, userId: user.id, role: invitation.role }
      })

      await tx.invitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() }
      })

      return user
    })

    // Sign them straight in; they have just proved they hold the invitation and
    // set their own password.
    const { token: refresh } = await issueRefreshToken(created.id)
    setRefreshCookie(res as Response, refresh)

    res.status(201).json({
      user: created,
      // @ts-expect-error - Type definition issue with jsonwebtoken expiresIn
      token: jwt.sign({ userId: created.id }, process.env.JWT_SECRET!, {
        expiresIn: process.env.JWT_ACCESS_TTL || '15m'
      }),
      organizationId: invitation.organizationId
    })
  } catch (error) {
    next(error)
  }
})

/** The signed-in user, if the request carries a usable access token. */
async function callerFromHeader(req: AuthRequest) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return null

  try {
    const { userId } = jwt.verify(header.split(' ')[1]!, process.env.JWT_SECRET!) as {
      userId: string
    }
    return await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } })
  } catch {
    // An expired or forged token is treated as "not signed in" rather than as
    // an error: the person may simply be opening the link in a browser where
    // their session has lapsed.
    return null
  }
}

/** Joins an existing account to the organization, once. */
async function joinOrganization(
  invitation: { id: string; organizationId: string; role: 'owner' | 'admin' | 'member' },
  userId: string
) {
  await prisma.$transaction(async tx => {
    const already = await tx.membership.findFirst({
      where: { organizationId: invitation.organizationId, userId }
    })

    // Accepting twice must not create a second membership. The unique
    // constraint would refuse it anyway; this turns that into a no-op rather
    // than a 500.
    if (!already) {
      await tx.membership.create({
        data: { organizationId: invitation.organizationId, userId, role: invitation.role }
      })
    }

    // Land them where they were invited (features/0023). Without this, somebody
    // who already had an account keeps acting in their personal organization —
    // the invitation appears to have done nothing, which is exactly the defect
    // this feature exists to fix. It is a *choice* being recorded, not a grant:
    // the membership created above is what grants anything.
    await tx.user.update({
      where: { id: userId },
      data: { activeOrganizationId: invitation.organizationId }
    })

    await tx.invitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } })
  })
}

// ─── API keys (features/0019) ────────────────────────────────────────────────
//
// The management surface lives here, on the session-authenticated router, and
// deliberately not on `/api/v1`: a credential that could mint more credentials
// would turn one leaked key into permanent access. Creating and revoking keys
// is something a person does while signed in.

const apiKeySchema = z.object({
  name: z.string().min(1).max(100)
})

// GET /api/organizations/api-keys — owner or admin.
organizationsRouter.get('/api-keys', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const { organizationId } = await requireRole(req, ['owner', 'admin'])

    const apiKeys = await prisma.apiKey.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      // No `hash`, and no way to get one. The secret was shown once, when the
      // key was created, and this endpoint is the reason there is no "reveal":
      // anything that can return a key twice is storing a password.
      select: {
        id: true,
        name: true,
        prefix: true,
        lastUsedAt: true,
        revokedAt: true,
        createdAt: true
      }
    })

    res.json({ apiKeys })
  } catch (error) {
    next(error)
  }
})

// POST /api/organizations/api-keys — owner or admin. Returns the secret ONCE.
organizationsRouter.post('/api-keys', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const { organizationId } = await requireRole(req, ['owner', 'admin'])

    const validation = apiKeySchema.safeParse(req.body)
    if (!validation.success) {
      return res.status(400).json({ error: 'Validation error', details: validation.error.errors })
    }

    // After the role check and before anything is written. `402` is a plan
    // limit and `403` is a permission failure, and they are never collapsed
    // (features/0012) — so a member who is not an admin hears `403` from
    // `requireRole` above, and an admin on a plan without the API hears `402`
    // here.
    await assertHasApiAccess(organizationId)

    const key = await mintApiKey({
      organizationId,
      name: validation.data.name,
      createdByUserId: req.userId!
    })

    // `secret` appears in this response and nowhere else, ever.
    res.status(201).json({ apiKey: key })
  } catch (error) {
    next(error)
  }
})

// DELETE /api/organizations/api-keys/:id — owner or admin. Revokes; never deletes.
organizationsRouter.delete('/api-keys/:id', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const { organizationId } = await requireRole(req, ['owner', 'admin'])
    const id = req.params.id as string

    // Scoped to the caller's organization in the `where`, not checked
    // afterwards: a key id belonging to another tenant must be a `404` and must
    // never be revoked. Same rule as every other tenant-scoped read
    // (docs/sot/04-backend-patterns.md §9).
    const key = await prisma.apiKey.findFirst({
      where: { id, organizationId },
      select: { id: true, revokedAt: true }
    })

    if (!key) throw new AppError(404, 'API key not found')

    // Revoking twice is not an error: the customer wanted it dead and it is.
    // Re-stamping the timestamp would rewrite the record of when access
    // actually stopped.
    if (!key.revokedAt) {
      await prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } })
    }

    // No plan check here, on purpose: an organization that has *lost* API
    // access — a downgrade, a lapsed subscription — must still be able to
    // revoke the keys it minted while it had it. Turning off a credential is
    // never something to charge for.
    res.json({ message: 'API key revoked' })
  } catch (error) {
    next(error)
  }
})

// --- Webhook endpoints (features/0020) --------------------------------------
//
// Managed from the session-authenticated API, like API keys and for the same
// reason: a credential that could add a new place for customer data to be sent
// would turn one leaked key into an exfiltration channel.

const webhookSchema = z.object({
  url: z.string().min(1).max(2000),
  // Only one event exists. A list rather than a boolean so that adding the
  // second one is not a migration and not a breaking change.
  events: z.array(z.enum(['response.created'])).min(1).default(['response.created'])
})

/**
 * Webhooks need two things this deployment may not have, and **both refusals
 * are loud**.
 *
 * This is the deliberate inverse of the hole features/0017 left and documented:
 * there, a queue configured with no worker running fails silently and every
 * PDF quietly falls behind. A feature whose entire purpose is to tell somebody
 * that something happened must never accept a configuration it cannot deliver.
 */
function assertWebhooksConfigured() {
  // `isRedisConfigured` from `services/redis.js`, deliberately, and not the
  // embed queue's own helper: that one is a bare alias for this today, and a
  // webhook route inheriting a future embed-specific condition is a coupling
  // nobody would think to look for here.
  if (!isRedisConfigured()) {
    throw new AppError(
      503,
      'Webhooks require the job queue. Set REDIS_URL and run a worker; delivering ' +
      'inline is not an option, because retries cannot happen inside a request.'
    )
  }

  if (!isWebhookSigningConfigured()) {
    throw new AppError(
      503,
      'Webhooks require WEBHOOK_SIGNING_KEY (32 bytes, base64), which encrypts ' +
      'endpoint secrets at rest.'
    )
  }
}

/** What a customer sees. Never the secret, encrypted or otherwise. */
const webhookSelect = {
  id: true,
  url: true,
  events: true,
  disabledAt: true,
  lastError: true,
  consecutiveFailures: true,
  createdAt: true
} as const

// GET /api/organizations/webhooks - owner or admin.
organizationsRouter.get('/webhooks', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const { organizationId } = await requireRole(req, ['owner', 'admin'])

    const webhooks = await prisma.webhookEndpoint.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      select: webhookSelect
    })

    // Listing works even when the deployment cannot deliver, on purpose: seeing
    // what is configured is how somebody diagnoses why nothing is arriving.
    res.json({ webhooks, deliverable: isRedisConfigured() && isWebhookSigningConfigured() })
  } catch (error) {
    next(error)
  }
})

/**
 * GET /api/organizations/webhooks/:id/deliveries - owner or admin.
 *
 * The same log as `GET /api/v1/webhooks/deliveries`, for the other audience
 * (features/0022). That one answers an integration asking *did you send me
 * everything?* and is authenticated by an API key; this one answers a person
 * looking at a screen asking *is my endpoint working?*, and requiring them to
 * mint an API key to find that out would be absurd.
 *
 * **This one is internal.** `/api/v1` is a contract; this lives under
 * `/api/organizations` and may change shape whenever the screen needs it to.
 *
 * No plan check and no queue check: history is readable on a deployment that
 * can no longer deliver, and that is exactly when somebody is reading it.
 */
const DELIVERIES_DEFAULT_LIMIT = 50
const DELIVERIES_MAX_LIMIT = 200

organizationsRouter.get(
  '/webhooks/:id/deliveries',
  authenticate,
  async (req: AuthRequest, res, next) => {
    try {
      const { organizationId } = await requireRole(req, ['owner', 'admin'])
      const id = req.params.id as string

      const requested = Number.parseInt(String(req.query.limit ?? ''), 10)
      const limit =
        Number.isInteger(requested) && requested > 0
          ? Math.min(requested, DELIVERIES_MAX_LIMIT)
          : DELIVERIES_DEFAULT_LIMIT

      // Scoped through the endpoint's organization, in the `where` and not
      // afterwards - another tenant's endpoint id is a 404 and its deliveries
      // are never read (docs/sot/04-backend-patterns.md §9).
      const endpoint = await prisma.webhookEndpoint.findFirst({
        where: { id, organizationId },
        select: { id: true }
      })

      if (!endpoint) throw new AppError(404, 'Webhook endpoint not found')

      const deliveries = await prisma.webhookDelivery.findMany({
        where: { endpointId: endpoint.id },
        orderBy: { createdAt: 'desc' },
        take: limit,
        // Exactly the columns `routes/v1/webhooks.ts` selects. **No payload
        // body**, because there is none stored: `response.created` carries the
        // answers a member of the public typed, and a log holding them would be
        // a second copy of respondent personal data outliving the form it came
        // from (see schema.prisma).
        select: {
          id: true,
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

      res.json({ deliveries })
    } catch (error) {
      next(error)
    }
  }
)

// POST /api/organizations/webhooks - owner or admin. Returns the secret ONCE.
organizationsRouter.post('/webhooks', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const { organizationId } = await requireRole(req, ['owner', 'admin'])

    const validation = webhookSchema.safeParse(req.body)
    if (!validation.success) {
      return res.status(400).json({ error: 'Validation error', details: validation.error.errors })
    }

    assertWebhooksConfigured()

    // Same entitlement as the read API, and checked again on every delivery
    // (`services/webhook-queue.ts`) so a downgrade stops deliveries rather than
    // waiting for somebody to notice - the fix features/0019 needed after review.
    await assertHasApiAccess(organizationId)

    // `https`, no credentials, and no hostname that resolves inside. Refused
    // here so the customer finds out while they are looking at the screen, and
    // checked again at delivery time because DNS can change under a name that
    // was public when it was saved.
    const { url } = await assertDeliverableUrl(validation.data.url)

    const { secret, stored } = mintWebhookSecret()

    const endpoint = await prisma.webhookEndpoint.create({
      data: {
        organizationId,
        url: url.toString(),
        secret: stored,
        events: validation.data.events,
        createdByUserId: req.userId!
      },
      select: webhookSelect
    })

    res.status(201).json({ webhook: { ...endpoint, secret } })
  } catch (error) {
    next(error)
  }
})

/**
 * PATCH /api/organizations/webhooks/:id - owner or admin. Re-enables it.
 *
 * `services/webhook-queue.ts` switches an endpoint off after ten consecutive
 * failures, which is right - a dead endpoint should not be retried for ever -
 * and until this existed nothing could switch it back on (features/0022).
 * `disabledAt` was written in two places and cleared in none, so recovery meant
 * delete-and-recreate, which mints a **new secret** and breaks the receiver the
 * customer already deployed.
 *
 * **It takes no body.** Not a general update endpoint: changing the URL under an
 * existing secret is a different feature with its own decision, and the narrow
 * version cannot become an SSRF vector by accident.
 *
 * Note which guards apply and why they differ from `DELETE`. Re-enabling turns
 * delivery **on**, so it needs the queue and the plan; deleting turns it off and
 * must keep working on a downgraded or unconfigured deployment.
 */
organizationsRouter.patch('/webhooks/:id', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const { organizationId } = await requireRole(req, ['owner', 'admin'])
    const id = req.params.id as string

    assertWebhooksConfigured()
    await assertHasApiAccess(organizationId)

    const endpoint = await prisma.webhookEndpoint.findFirst({
      where: { id, organizationId },
      select: { id: true, url: true }
    })

    if (!endpoint) throw new AppError(404, 'Webhook endpoint not found')

    // The stored URL, re-checked. A hostname that was public when it was
    // configured can resolve inside this network today, and the argument
    // features/0020 makes is that this check belongs at every point where
    // delivery becomes possible - not only at configuration.
    await assertDeliverableUrl(endpoint.url)

    const updated = await prisma.webhookEndpoint.update({
      where: { id: endpoint.id },
      // Three columns, and only these three. `consecutiveFailures` is reset
      // because it counts failures *since the last success*, and leaving it at
      // ten would disable the endpoint again on the very next failure.
      data: { disabledAt: null, consecutiveFailures: 0, lastError: null },
      select: webhookSelect
    })

    res.json({ webhook: updated })
  } catch (error) {
    next(error)
  }
})

// DELETE /api/organizations/webhooks/:id - owner or admin.
organizationsRouter.delete('/webhooks/:id', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const { organizationId } = await requireRole(req, ['owner', 'admin'])
    const id = req.params.id as string

    // Scoped in the `where`, so another organization's endpoint is a 404 and is
    // never touched - the rule from docs/sot/04-backend-patterns.md §9.
    const endpoint = await prisma.webhookEndpoint.findFirst({
      where: { id, organizationId },
      select: { id: true }
    })

    if (!endpoint) throw new AppError(404, 'Webhook endpoint not found')

    // A real delete, unlike an API key's revocation. There is nothing here worth
    // keeping a tombstone for: the deliveries cascade with it, and they hold no
    // payload (see schema.prisma) - only a record that this endpoint was told,
    // which is meaningless once the endpoint is gone.
    await prisma.webhookEndpoint.delete({ where: { id } })

    // No plan check and no queue check: turning delivery off must work on a
    // deployment that can no longer deliver, and after a downgrade.
    res.json({ message: 'Webhook endpoint deleted' })
  } catch (error) {
    next(error)
  }
})
