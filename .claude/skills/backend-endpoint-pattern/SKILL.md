---
name: backend-endpoint-pattern
description: Add or change an Express endpoint in backend/src/routes/ following this project's established patterns - Zod validation at the edge, ownership as an explicit call, AppError plus next(error), transactions for multi-write handlers, and a supertest integration test. Use for any backend route work.
---

# Write a backend endpoint the way this project writes them

Full reasoning with examples: `docs/sot/04-backend-patterns.md`. This is the operational checklist.

## Before writing

1. Read the route file you are about to change **and one neighbour**. Handlers here are meant to look alike; the neighbour shows you what "alike" means.
2. Decide the resource's authorization story before writing the handler: public, authenticated, or authenticated plus ownership. There is no fourth option today, and inventing one is a design decision worth raising rather than an implementation detail.

## The shape

```ts
const createThingSchema = z.object({ /* declared next to the route, not in a shared file */ })

thingsRouter.post('/:formId/things', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  const formId = req.params.formId as string
  const form = await verifyFormOwnership(req, formId)   // returns the form; do not refetch

  const validation = createThingSchema.safeParse(req.body)
  if (!validation.success) {
    return res.status(400).json({ error: 'Validation error', details: validation.error.errors })
  }

  const thing = await prisma.thing.create({ data: { formId, ...validation.data } })
  res.status(201).json({ thing })
}))
```

Non-negotiable points in that shape:

- **`safeParse`, not `parse`** — the 400 is produced deliberately at the call site.
- **Only `validation.data` reaches Prisma.** Never spread `req.body` into a write.
- **Ownership is an awaited call inside the handler**, not middleware — it needs a route param. It returns the resource, so use it.
- **Ownership failure is `404`, not `403`.** A 403 confirms that someone else's resource exists.
- **`asyncHandler` wraps every handler, and there is no `try`/`catch`.** Express 4 does not forward a rejected promise, so an unwrapped `async` handler leaves the request unanswered until it times out (`features/0026`). The wrapper sends it to the shared error handler, which is where `next(error)` was going. `tests/async-handler-coverage.spec.ts` fails if you forget. Async middleware mounted with `.use()` needs it too. A handler that formats its own error response is still breaking the shared error contract — the exception is an inner `catch` that swallows a best-effort failure on purpose, and those are rare and commented.
- **Derive update schemas**: `const updateThingSchema = createThingSchema.partial()`. Do not restate fields.
- Response bodies are wrapped in a named key — `{ thing }`, `{ things }` — matching the existing routes.

## Multi-write handlers

If a handler performs more than one write, or a read whose result decides a write, it runs inside `prisma.$transaction`. Without it, two concurrent requests interleave into a state neither one intended. The bulk field save is the cautionary example — see `docs/sot/03-domain-model.md`.

Before adding any `delete` or `deleteMany`, check the cascade map in `docs/sot/03-domain-model.md` and answer explicitly: **what customer data does this destroy, and did the user ask for that?** Editing something is not consent to delete data collected through it.

## Side effects on files

Effects on the PDF on disk (`embedFieldsInPDF`, `syncFieldsFromPDF`) are best-effort: wrapped in `try/catch`, logged, never allowed to fail the request. Follow that pattern, and remember it leaves the database and the file able to disagree silently. If you add a new one, make the failure observable to the user somehow — a flag on the resource, not just a console line.

## Public endpoints

A route with no `authenticate` needs, at minimum:

- An explicit note in the PR that it is public and why.
- Rate limiting. There is none in the codebase yet; if you are adding the first public endpoint since, you are adding the rate limiter too (`docs/BACKLOG.md`, P0).
- No leakage of internal identifiers. `GET /forms/public/:shareId` strips `userId` by destructuring; do the same for anything you return.
- No unbounded work driven by attacker-controlled input — see the author-supplied-regex finding in `docs/sot/07-security-and-privacy.md`.

## Tests

Every endpoint gets an integration test in `backend/tests/<resource>.spec.ts`, driving the real router with `supertest` and mocking only Prisma and `authenticate`:

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

Cover the happy path, the validation failure, and the ownership failure (404).

**A mocked Prisma cannot show you cascades, constraints or transaction rollback.** If the handler's correctness depends on what the database does — anything that deletes, anything with a unique constraint, anything transactional — it needs a test against a real PostgreSQL instance. Do not let a green mock stand in for that; that is exactly how the answer-loss defect shipped. See `docs/sot/09-quality-and-testing.md`.

Backend tests live in `backend/tests/`, never beside the source.

## On the way out

- Update `docs/sot/06-api-reference.md` after **re-reading** your own route (`api-contract-guard`).
- If you added personal data or a public surface, update `docs/sot/07-security-and-privacy.md`.
- Run the `ship-checklist` skill before opening the PR.
