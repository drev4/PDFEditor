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
  passThroughTransactionOnly(prismaMock)
  prismaMock.organization.findUnique.mockResolvedValue({ planKey } as any)
  prismaMock.usageCounter.upsert.mockResolvedValue({ responses } as any)
}

/**
 * The pass-through on its own, for the routes that open a transaction but read
 * no meter.
 *
 * Publishing a form and sending an invitation run their limit check and their
 * write in one transaction since features/0027, so a spec exercising either
 * needs `$transaction` to hand the callback something — but seeding a plan and
 * a usage counter for them would be answering questions they never ask, and the
 * specs that *are* about the published-form limit set `form.count` themselves.
 *
 * Note what the mock silently does not do: `lockOrganization` issues a
 * `SELECT … FOR UPDATE` through `$queryRaw`, and against a mock that resolves
 * to `undefined` and nothing waits on anything. **The lock is the entire point
 * of that feature and this level cannot see it at all** — which is why the
 * race itself is asserted in `tests/integration/plan-limit-races.spec.ts`,
 * against a real PostgreSQL and two concurrent requests.
 */
export function passThroughTransactionOnly(prismaMock: DeepMockProxy<PrismaClient>): void {
  prismaMock.$transaction.mockImplementation((fn: any) => fn(prismaMock))
}
