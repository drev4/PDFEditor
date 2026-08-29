import jwt from 'jsonwebtoken'
import { prisma } from '../../src/services/db.js'

/**
 * A user with their personal organization, exactly as registration creates it.
 *
 * The organization is not optional: every authorization check resolves the
 * caller's membership, so a user built without one is not a user this
 * application can produce, and a test using it would prove nothing.
 */
export async function createUser(email = `user-${Date.now()}-${Math.random()}@example.com`) {
  const user = await prisma.user.create({
    data: { email, passwordHash: 'not-a-real-hash', name: 'Test User' }
  })
  const organization = await prisma.organization.create({
    data: { name: `Org for ${email}`, slug: `org-${Math.random().toString(36).slice(2, 12)}` }
  })
  await prisma.membership.create({
    data: { organizationId: organization.id, userId: user.id, role: 'owner' }
  })
  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET!, { expiresIn: '1h' })
  return { user, organization, token, authHeader: `Bearer ${token}` }
}

/**
 * A form owned by the organization the given user belongs to.
 *
 * Takes a user id rather than an organization id so call sites read the way the
 * product does — a person makes a form — while ownership lands where the schema
 * puts it.
 */
export async function createForm(userId: string, overrides: Record<string, unknown> = {}) {
  const membership = await prisma.membership.findFirstOrThrow({ where: { userId } })
  return prisma.form.create({
    data: {
      organizationId: membership.organizationId,
      createdByUserId: userId,
      title: 'Test Form',
      shareId: `share-${Math.random().toString(36).slice(2, 11)}`,
      status: 'published',
      ...overrides
    }
  })
}

export function fieldPayload(overrides: Record<string, unknown> = {}) {
  return {
    type: 'text',
    name: 'field_1',
    label: 'Field 1',
    required: false,
    position: { x: 10, y: 20, width: 100, height: 30, page: 1 },
    order: 0,
    ...overrides
  }
}

export async function createField(formId: string, overrides: Record<string, unknown> = {}) {
  const { type, name, label, required, position, order } = { ...fieldPayload(), ...overrides } as any
  return prisma.field.create({
    data: { formId, type, name, label, required, position, order }
  })
}

/** Creates a submitted response with one answer per entry of `answers` ({ fieldId: value }). */
export async function createResponse(formId: string, answers: Record<string, string>) {
  return prisma.response.create({
    data: {
      formId,
      ipAddress: '127.0.0.1',
      answers: {
        create: Object.entries(answers).map(([fieldId, value]) => ({ fieldId, value }))
      }
    },
    include: { answers: true }
  })
}
