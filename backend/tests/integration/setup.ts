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
  // `refresh_tokens`, `invitations` and `usage_counters` are named explicitly
  // rather than left to the cascade, so a reader can see that sessions,
  // outstanding invitations and the usage meter are cleared between tests too.
  // A counter surviving into the next test would silently spend the next
  // organization's monthly allowance. `stripe_events` is named for the same
  // reason and is *not* reached by any cascade — it deliberately has no
  // relation to an organization — so a Stripe event id left behind would make
  // the next test's replay look like a duplicate and write nothing.
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "answers", "responses", "fields", "forms", "usage_counters", "subscriptions", "stripe_events", "invitations", "memberships", "organizations", "refresh_tokens", "users" RESTART IDENTITY CASCADE'
  )
})

afterAll(async () => {
  await prisma.$disconnect()
})
