import { describe, it, expect, vi, beforeEach } from 'vitest'
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
