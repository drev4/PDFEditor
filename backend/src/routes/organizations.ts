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
import { getEntitlements } from '../services/entitlements.js'
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

// GET /api/organizations/entitlements — any member may see the plan and usage.
//
// Not owner-only: the sidebar card and the plan screen are visible to everyone
// in the organization, and a member who cannot see why publishing was refused
// has no way to understand the product. It carries no billing identifiers and
// no organization id — only what the plan allows and what has been used.
organizationsRouter.get('/entitlements', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const { organizationId } = await requireMembership(req)
    const { plan, usage } = await getEntitlements(organizationId)

    res.json({
      plan: {
        key: plan.key,
        name: plan.name,
        maxPublishedForms: plan.maxPublishedForms,
        maxResponsesPerMonth: plan.maxResponsesPerMonth,
        seats: plan.seats
      },
      usage
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

    await tx.invitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } })
  })
}
