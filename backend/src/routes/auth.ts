import { Router, Response } from 'express'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { prisma } from '../services/db.js'
import { AppError } from '../middleware/errorHandler.js'
import { authenticate, AuthRequest } from '../middleware/auth.js'
import { verifySameOrigin } from '../middleware/csrf.js'
import {
  loginRateLimit,
  registerRateLimit,
  refreshRateLimit
} from '../middleware/rateLimit.js'
import {
  issueRefreshToken,
  rotateRefreshToken,
  revokeSession
} from '../services/refresh-token.js'
import {
  REFRESH_COOKIE,
  setRefreshCookie,
  clearRefreshCookie
} from '../services/session-cookie.js'

export const authRouter = Router()

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().optional()
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string()
})

/**
 * Minutes, not days (finding S4). An access token cannot be revoked — that is
 * the price of verifying it without a database round trip — so its lifetime is
 * the window in which a stolen one is still useful. Everything that ends a
 * session early acts on the refresh token instead.
 */
function accessTokenTtl(): string {
  return process.env.JWT_ACCESS_TTL || '15m'
}

function signAccessToken(userId: string): string {
  // @ts-expect-error - Type definition issue with jsonwebtoken expiresIn
  return jwt.sign({ userId }, process.env.JWT_SECRET!, { expiresIn: accessTokenTtl() })
}

/** Starts a session: a fresh refresh-token family, and the cookie carrying it. */
async function startSession(res: Response, userId: string): Promise<string> {
  const { token } = await issueRefreshToken(userId)
  setRefreshCookie(res, token)
  return signAccessToken(userId)
}

// POST /api/auth/register
authRouter.post('/register', registerRateLimit, async (req, res, next) => {
  try {
    const validation = registerSchema.safeParse(req.body)
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation error',
        details: validation.error.errors
      })
    }

    const { email, password, name } = validation.data

    const existingUser = await prisma.user.findUnique({ where: { email } })
    if (existingUser) {
      throw new AppError(400, 'Email already registered')
    }

    const passwordHash = await bcrypt.hash(password, 10)

    const user = await prisma.user.create({
      data: { email, passwordHash, name },
      select: { id: true, email: true, name: true, createdAt: true }
    })

    const token = await startSession(res, user.id)

    res.status(201).json({ user, token })
  } catch (error) {
    next(error)
  }
})

// POST /api/auth/login
authRouter.post('/login', loginRateLimit, async (req, res, next) => {
  try {
    const validation = loginSchema.safeParse(req.body)
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation error',
        details: validation.error.errors
      })
    }

    const { email, password } = validation.data

    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) {
      throw new AppError(401, 'Invalid credentials')
    }

    const validPassword = await bcrypt.compare(password, user.passwordHash)
    if (!validPassword) {
      throw new AppError(401, 'Invalid credentials')
    }

    const token = await startSession(res, user.id)

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt
      },
      token
    })
  } catch (error) {
    next(error)
  }
})

// POST /api/auth/refresh
//
// Authenticated by the cookie alone, which is why it carries `verifySameOrigin`
// — see middleware/csrf.ts. It is also the one route where a failure must not
// explain itself: "unknown", "expired" and "replayed" all return the same 401,
// or the endpoint becomes an oracle for probing captured tokens.
authRouter.post('/refresh', refreshRateLimit, verifySameOrigin, async (req, res, next) => {
  try {
    const presented = req.cookies?.[REFRESH_COOKIE]
    if (!presented) {
      throw new AppError(401, 'Not authenticated')
    }

    const result = await rotateRefreshToken(presented)

    if (!result.ok) {
      // The cookie is dead whichever way it failed, including the replay case
      // where rotateRefreshToken has just revoked the whole family.
      clearRefreshCookie(res)
      throw new AppError(401, 'Not authenticated')
    }

    setRefreshCookie(res, result.token)
    res.json({ token: signAccessToken(result.userId) })
  } catch (error) {
    next(error)
  }
})

// POST /api/auth/logout
//
// Deliberately not behind `authenticate`: logging out must work when the access
// token has already expired, which is exactly when a user reaches for it. The
// cookie is the credential, so the CSRF guard applies here too.
authRouter.post('/logout', verifySameOrigin, async (req, res, next) => {
  try {
    const presented = req.cookies?.[REFRESH_COOKIE]
    if (presented) await revokeSession(presented)

    clearRefreshCookie(res)
    res.status(204).send()
  } catch (error) {
    next(error)
  }
})

// GET /api/auth/me
authRouter.get('/me', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, email: true, name: true, createdAt: true }
    })

    if (!user) {
      throw new AppError(404, 'User not found')
    }

    res.json({ user })
  } catch (error) {
    next(error)
  }
})
