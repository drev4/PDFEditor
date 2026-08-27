// Setup for database-backed integration tests.
//
// These specs talk to a real PostgreSQL instance. Nothing here is mocked: the
// point of this level is the behaviour a mocked Prisma client cannot express
// (cascades, constraints, transaction rollbacks).
import { beforeAll, beforeEach, afterAll } from 'vitest'
import { prisma } from '../../src/services/db.js'

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error('Integration tests require DATABASE_URL to point at a real PostgreSQL database')
  }
  await prisma.$connect()
})

beforeEach(async () => {
  // Truncating `users` and `forms` cascades to fields, responses and answers.
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "answers", "responses", "fields", "forms", "users" RESTART IDENTITY CASCADE'
  )
})

afterAll(async () => {
  await prisma.$disconnect()
})
