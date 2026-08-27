# Quality and testing

## What exists

| Level | Count | Tooling | Location |
|---|---|---|---|
| Frontend unit / component | 29 specs | Vitest, `@testing-library/vue`, `@pinia/testing`, jsdom (`frontend/vitest.config.ts`) | Beside the code, `frontend/src/**/*.spec.ts` |
| Backend integration | 7 specs | Vitest, `supertest`, `vitest-mock-extended` | `backend/tests/*.spec.ts` |
| End to end | 6 specs | Playwright, Chromium | `e2e/*.spec.ts` |

The two placement conventions are different on purpose and must not be mixed: **frontend tests sit next to their subject, backend tests sit in `backend/tests/`.**

> **Node version.** The frontend suite needs Node `^20.19.0 || >=22.12.0` — Vite 7 and jsdom 27 both require it. Below that the whole suite fails to start with `ERR_REQUIRE_ESM`, and component specs fail on a missing `crypto.hash`. A `.nvmrc` pins the version; `engines` in the root `package.json` previously claimed `>=18.0.0`, which is why npm never warned. Backend tests (58, all passing) have no such constraint.

## Backend: integration tests over the real router

Backend specs drive the actual Express app with `supertest` and mock only the two edges — the database and authentication:

```ts
vi.mock('../src/services/db', async () => {
  const { mockDeep } = await import('vitest-mock-extended')
  return { prisma: mockDeep<PrismaClient>() }
})

vi.mock('../src/middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => { req.userId = 'user-1'; next() }
}))

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>
beforeEach(() => { mockReset(prismaMock) })
```

This is a good trade: routing, Zod validation, ownership logic, status codes and the error handler are all genuinely exercised, while the tests stay fast and need no database.

It has one failure mode worth naming, because the current data-loss defect lives in exactly that blind spot: **a mocked Prisma cannot show you what the database would actually do.** `deleteMany` on a mock has no cascade, so a test asserting "bulk save replaces the fields" passes cheerfully while the real database deletes every answer. Referential behaviour — cascades, constraints, transaction rollback, unique violations — needs a test against a real PostgreSQL instance. There is one available in CI already, used only by the E2E job.

## Frontend: behaviour, not internals

Assert what a unit caused, not how it is built:

```ts
expect(api.post).toHaveBeenCalledWith('/forms/form-1/fields', mockFieldData)
```

Test stores and composables through their public surface — call an action, assert the resulting state and the requests made. Do not reach into internal refs when an observable effect says the same thing, and do not mount a whole view to test logic that lives in a composable.

## Where a test belongs

| Question the test answers | Level |
|---|---|
| Does this pure function compute the right value? | Unit, beside the code |
| Does this endpoint validate, authorize and respond correctly? | Backend integration with `supertest` |
| **Does the database do what this handler assumes** — cascades, constraints, transactions? | Integration against a real PostgreSQL (**missing today**) |
| Does a store or composable produce the right state and requests? | Frontend unit |
| Does a full user journey work across both apps? | Playwright E2E |
| Does the PDF that comes out actually have the fields where the editor put them? | **No test exists at any level** |

The bottom two rows are the real coverage gaps, and both hide a defect class that shipped: the answer-cascade bug and the canvas-versus-PDF scale coupling from [02-architecture.md](./02-architecture.md).

## Gaps

| Gap | Consequence |
|---|---|
| **No ESLint at all.** The root `npm run lint` calls `--workspaces --if-present`, and no workspace defines a `lint` script. There is no `eslint.config.js` | The lint command silently succeeds while linting nothing, which is worse than having no command |
| **No type check in CI.** `vue-tsc` and `tsc` only run inside builds, and CI never builds | Type errors reach `develop` |
| **No database-backed integration tests** | Cascade and constraint behaviour is untested — this is how the bulk-save defect shipped |
| **No PDF round-trip test** | Nothing verifies that embedded AcroForm positions match what the editor showed |
| **Coverage collected but not enforced** | Coverage can fall silently; Codecov failures are ignored |
| **No test for the current known defect** | Whatever fix lands next needs the failing test written first |

When lint is added, use flat config (`eslint.config.js`) — the rest of the toolchain is on versions that assume it.

## Definition of done

A change is done when all of these are true. This is the checklist the `ship-checklist` skill runs before a PR.

1. The change does what its `features/` spec or issue said, and nothing else. Scope that grew is either removed or acknowledged in the PR description.
2. **Tests were added at the level that would have caught the bug.** For a fix, that means a test that fails without the change — write it first and watch it fail.
3. `npm run test:frontend` and `npm run test:backend` pass. E2E if the change touches a user-visible flow.
4. Type checking passes in both workspaces: `npm run build --workspace=frontend` and `npx tsc --noEmit` in `backend/`.
5. The API contract is unchanged, or [06-api-reference.md](./06-api-reference.md) was updated **after re-reading the route file** (`api-contract-guard`).
6. Schema changes carry a migration and an explicit written statement of the `onDelete` behaviour of every new relation ([03-domain-model.md](./03-domain-model.md)).
7. New personal data is recorded in the inventory in [07-security-and-privacy.md](./07-security-and-privacy.md); new public endpoints have rate limiting.
8. Affected SoT documents are updated in the same commit (`sot-sync`), and new debt created by the change is filed in [`docs/BACKLOG.md`](../BACKLOG.md) rather than left in someone's head.
9. Commit messages follow [11-conventions.md](./11-conventions.md), with no AI-authorship trailer.

## Review priorities

In order. A reviewer who only has time for the first two is still adding most of the value.

1. **Can this destroy or expose customer data?** Cascades, bulk writes, missing ownership checks, anything newly public.
2. **Is the failure mode acceptable?** What happens on a partial write, a timeout, a malformed PDF, a duplicate submit.
3. **Does it match the patterns in [04](./04-backend-patterns.md) and [05](./05-frontend-patterns.md)?** Divergence is a question to ask, not automatically a defect — but it must be a decision.
4. **Is the test at the right level**, and would it have caught the bug it claims to fix?
5. Naming, structure, readability.
