import type { DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'

/**
 * Makes a mocked `prisma.$transaction(fn)` hand the callback the same mock.
 *
 * `POST /api/responses` writes inside a transaction since features/0012, so a
 * spec that only mocks `prisma.response.create` gets `undefined` from
 * `$transaction` and the route 500s — the failure looks like a broken route and
 * is a stale mock. Passing the mock through keeps `prismaMock.response.create`
 * the thing that is called and asserted on, so those specs go on testing what
 * they were written to test.
 *
 * It also answers the two entitlement reads on that path with an organization
 * well inside its plan, because a spec about regex validation should not have
 * to know that plan limits exist. A spec that *is* about the limit sets its own
 * `usageCounter.upsert` afterwards.
 *
 * **This is a mock, and it proves nothing about transactions.** Nothing here
 * rolls back — the callback is simply run. Whether the counter and the response
 * commit or roll back together is database behaviour, and it is tested in
 * `tests/integration/entitlements.spec.ts`.
 */
export function passThroughTransaction(
  prismaMock: DeepMockProxy<PrismaClient>,
  { planKey = 'free', responses = 1 }: { planKey?: string; responses?: number } = {}
): void {
  prismaMock.organization.findUnique.mockResolvedValue({ planKey } as any)
  prismaMock.usageCounter.upsert.mockResolvedValue({ responses } as any)
  prismaMock.$transaction.mockImplementation((fn: any) => fn(prismaMock))
}
