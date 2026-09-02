import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { app } from '../src/app'
import { prisma } from '../src/services/db'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'

// Mock Prisma
vi.mock('../src/services/db', async () => {
  const { mockDeep } = await import('vitest-mock-extended')
  return {
    prisma: mockDeep<PrismaClient>()
  }
})

// Mock bcrypt
vi.mock('bcrypt')

// Mock jwt
vi.mock('jsonwebtoken')

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>

describe('Auth Routes', () => {
  beforeEach(() => {
    mockReset(prismaMock)
    vi.clearAllMocks()
    // Setup JWT mock for authenticated routes
    vi.mocked(jwt.verify).mockReturnValue({ userId: 'user-1' } as any)
  })

  const mockUser = {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
    passwordHash: 'hashed-password',
    createdAt: new Date()
  }

  describe('POST /api/auth/register', () => {
    it('should register a new user', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null)
      vi.mocked(bcrypt.hash).mockResolvedValue('hashed-password' as never)
      vi.mocked(jwt.sign).mockReturnValue('mock-token' as any)

      // Mock should return user without passwordHash (as per select in code)
      const userWithoutPassword = {
        id: mockUser.id,
        email: mockUser.email,
        name: mockUser.name,
        createdAt: mockUser.createdAt
      }
      prismaMock.user.create.mockResolvedValue(userWithoutPassword as any)
      // Registration creates the user, their organization and an owner
      // membership in one transaction — see routes/auth.ts.
      prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock))
      prismaMock.organization.create.mockResolvedValue({ id: 'org-1' } as any)
      prismaMock.membership.create.mockResolvedValue({ id: 'membership-1' } as any)

      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          password: 'password123',
          name: 'Test User'
        })

      expect(res.status).toBe(201)
      expect(res.body).toHaveProperty('token')
      expect(res.body.user).toHaveProperty('email', 'test@example.com')
      expect(res.body.user).not.toHaveProperty('passwordHash')
    })

    it('should return 400 if email already exists', async () => {
      prismaMock.user.findUnique.mockResolvedValue(mockUser as any)

      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          password: 'password123'
        })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('Email already registered')
    })

    it('should validate email format', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'invalid-email',
          password: 'password123'
        })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('Validation error')
    })

    it('should validate password length', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          password: '12345'
        })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('Validation error')
    })
  })

  /**
   * Closed registration for the private beta (features/0033).
   *
   * `vitest.config.ts` pins `REGISTRATION_MODE=open` for every suite, so these
   * tests set it per case and restore it afterwards. They must not leak: a
   * mode left behind would close registration for the four tests above.
   */
  describe('POST /api/auth/register — REGISTRATION_MODE', () => {
    const CODE = 'beta-code-that-is-long-enough'

    function arrangeSuccessfulRegistration() {
      prismaMock.user.findUnique.mockResolvedValue(null)
      vi.mocked(bcrypt.hash).mockResolvedValue('hashed-password' as never)
      vi.mocked(jwt.sign).mockReturnValue('mock-token' as any)
      prismaMock.user.create.mockResolvedValue({
        id: mockUser.id,
        email: mockUser.email,
        name: mockUser.name,
        createdAt: mockUser.createdAt
      } as any)
      prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock))
      prismaMock.organization.create.mockResolvedValue({ id: 'org-1' } as any)
      prismaMock.membership.create.mockResolvedValue({ id: 'membership-1' } as any)
    }

    afterEach(() => {
      delete process.env.REGISTRATION_MODE
      delete process.env.REGISTRATION_CODE
    })

    it('refuses with 403 when the mode is invite_only and no code is sent', async () => {
      process.env.REGISTRATION_MODE = 'invite_only'
      process.env.REGISTRATION_CODE = CODE
      arrangeSuccessfulRegistration()

      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'nobody@example.com', password: 'password123' })

      expect(res.status).toBe(403)
      // Not 402 (a plan limit) and not 400 (the "email already registered"
      // branch) — see features/0033.
      expect(res.body.error).toBeTruthy()
    })

    it('refuses with 403 when the code does not match', async () => {
      process.env.REGISTRATION_MODE = 'invite_only'
      process.env.REGISTRATION_CODE = CODE
      arrangeSuccessfulRegistration()

      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'nobody@example.com',
          password: 'password123',
          code: 'not-the-code-at-all-really'
        })

      expect(res.status).toBe(403)
    })

    it('creates nothing when it refuses', async () => {
      process.env.REGISTRATION_MODE = 'invite_only'
      process.env.REGISTRATION_CODE = CODE
      arrangeSuccessfulRegistration()

      await request(app)
        .post('/api/auth/register')
        .send({ email: 'nobody@example.com', password: 'password123' })

      expect(prismaMock.user.create).not.toHaveBeenCalled()
      expect(prismaMock.organization.create).not.toHaveBeenCalled()
      expect(prismaMock.membership.create).not.toHaveBeenCalled()
    })

    it('does not reveal whether the address is already registered', async () => {
      // The refusal must come *before* the email lookup, or an unadmitted
      // caller can probe which addresses exist by comparing 400 against 403.
      process.env.REGISTRATION_MODE = 'invite_only'
      process.env.REGISTRATION_CODE = CODE
      prismaMock.user.findUnique.mockResolvedValue(mockUser as any)

      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'test@example.com', password: 'password123' })

      expect(res.status).toBe(403)
      expect(prismaMock.user.findUnique).not.toHaveBeenCalled()
    })

    it('registers normally when the code matches', async () => {
      process.env.REGISTRATION_MODE = 'invite_only'
      process.env.REGISTRATION_CODE = CODE
      arrangeSuccessfulRegistration()

      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          password: 'password123',
          name: 'Test User',
          code: CODE
        })

      expect(res.status).toBe(201)
      expect(res.body).toHaveProperty('token')
      expect(prismaMock.membership.create).toHaveBeenCalled()
    })

    it('ignores a wrong code when the mode is open', async () => {
      process.env.REGISTRATION_MODE = 'open'
      arrangeSuccessfulRegistration()

      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          password: 'password123',
          code: 'irrelevant'
        })

      expect(res.status).toBe(201)
    })
  })

  describe('GET /api/auth/registration', () => {
    afterEach(() => {
      delete process.env.REGISTRATION_MODE
    })

    it('reports open, and nothing else', async () => {
      process.env.REGISTRATION_MODE = 'open'

      const res = await request(app).get('/api/auth/registration')

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ mode: 'open' })
    })

    it('reports invite_only without leaking the code', async () => {
      process.env.REGISTRATION_MODE = 'invite_only'
      process.env.REGISTRATION_CODE = 'beta-code-that-is-long-enough'

      const res = await request(app).get('/api/auth/registration')

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ mode: 'invite_only' })
      expect(JSON.stringify(res.body)).not.toContain('beta-code')
    })

    it('needs no authentication', async () => {
      // It is what the signup screen reads before anybody has an account.
      const res = await request(app).get('/api/auth/registration')

      expect(res.status).toBe(200)
    })
  })

  describe('POST /api/auth/login', () => {
    it('should login with valid credentials', async () => {
      prismaMock.user.findUnique.mockResolvedValue(mockUser as any)
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never)
      vi.mocked(jwt.sign).mockReturnValue('mock-token' as any)

      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: 'password123'
        })

      expect(res.status).toBe(200)
      expect(res.body).toHaveProperty('token')
      expect(res.body.user.email).toBe('test@example.com')
    })

    it('should return 401 with invalid email', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null)

      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'wrong@example.com',
          password: 'password123'
        })

      expect(res.status).toBe(401)
      expect(res.body.error).toBe('Invalid credentials')
    })

    it('should return 401 with invalid password', async () => {
      prismaMock.user.findUnique.mockResolvedValue(mockUser as any)
      vi.mocked(bcrypt.compare).mockResolvedValue(false as never)

      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: 'wrongpassword'
        })

      expect(res.status).toBe(401)
      expect(res.body.error).toBe('Invalid credentials')
    })
  })

  describe('GET /api/auth/me', () => {
    it('should return current user', async () => {
      // Mock should return user without passwordHash (as per select in code)
      const userWithoutPassword = {
        id: mockUser.id,
        email: mockUser.email,
        name: mockUser.name,
        createdAt: mockUser.createdAt
      }
      prismaMock.user.findUnique.mockResolvedValue(userWithoutPassword as any)

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer valid-token')

      expect(res.status).toBe(200)
      expect(res.body.user.email).toBe('test@example.com')
      expect(res.body.user).not.toHaveProperty('passwordHash')
    })

    it('should return 404 if user not found', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null)

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer valid-token')

      expect(res.status).toBe(404)
    })

    it('should return 401 without token', async () => {
      const res = await request(app).get('/api/auth/me')

      expect(res.status).toBe(401)
    })
  })
})
