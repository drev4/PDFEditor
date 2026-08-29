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
  // `refresh_tokens` is named explicitly rather than left to the cascade, so a
  // reader can see that sessions are cleared between tests too.
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "answers", "responses", "fields", "forms", "refresh_tokens", "users" RESTART IDENTITY CASCADE'
  )
})

afterAll(async () => {
  await prisma.$disconnect()
})
