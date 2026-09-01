import type { DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'

/**
 * The caller belongs to an organization.
 *
 * Every authenticated route resolves the caller's organization through
 * `requireMembership`, and since features/0023 that means two reads: the
 * `User.activeOrganizationId` column, and the membership it names. A mocked
 * Prisma answers `undefined` to both unless told otherwise, which makes
 * `requireMembership` throw `404` and turns every route test into a 404 for a
 * reason that has nothing to do with what it is testing.
 *
 * So this is the default state of the world for a mocked route test: a signed-in
 * person, in one organization, who has never switched. A spec that cares about
 * the active organization, or about a caller in two, overrides these afterwards
 * — and a spec that cares about *tenancy* should not be here at all: that needs
 * a real database (`backend/tests/integration/tenancy.spec.ts`).
 */
export function mockCallerMembership(
  prismaMock: DeepMockProxy<PrismaClient>,
  organizationId = 'org-1',
  role: 'owner' | 'admin' | 'member' = 'owner'
) {
  // `null` is "never chose", which is every account with one organization.
  prismaMock.user.findUnique.mockResolvedValue({ activeOrganizationId: null } as never)
  prismaMock.membership.findFirst.mockResolvedValue({ organizationId, role } as never)
}
