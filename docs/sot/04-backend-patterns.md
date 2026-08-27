# Backend patterns

How an Express route is written in this codebase, with real examples. Follow these; if a new route does not look like the existing ones, that is a finding, not a style preference.

## 1. Validate at the edge with Zod and `safeParse`

Every handler that reads a body validates it with a Zod schema declared next to the route. There is no central `schemas/` file and there should not be one — the schema and its only consumer stay in the same file, so they cannot drift.

```ts
const createFormSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  pdfUrl: z.string().optional()
})

formsRouter.post('/', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const validation = createFormSchema.safeParse(req.body)
    if (!validation.success) {
      return res.status(400).json({ error: 'Validation error', details: validation.error.errors })
    }
    const { title, description, pdfUrl } = validation.data
    // ...
  } catch (error) { next(error) }
})
```

`safeParse` rather than `parse`, so the 400 is produced deliberately at the call site instead of thrown into the error handler. Update schemas are derived, never duplicated: `const updateFieldSchema = createFieldSchema.partial()`.

**The parsed value is the only thing that reaches Prisma.** Never spread `req.body` into a write.

## 2. Auth and ownership are composable functions, not middleware layers

`middleware/auth.ts` does exactly one thing — decode the JWT and hang `req.userId` on the request:

```ts
export function authenticate(req: AuthRequest, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) throw new AppError(401, 'No token provided')
  const token = authHeader.split(' ')[1]
  try {
    req.userId = (jwt.verify(token, process.env.JWT_SECRET!) as { userId: string }).userId
    next()
  } catch { throw new AppError(401, 'Invalid token') }
}
```

Ownership is **not** Express middleware, because it needs a route parameter that is only meaningful inside the handler. It is an awaited function call:

```ts
// middleware/formOwnership.ts
export async function verifyFormOwnership(req: AuthRequest, formId: string) {
  const form = await prisma.form.findFirst({ where: { id: formId, userId: req.userId } })
  if (!form) throw new AppError(404, 'Form not found')
  return form
}
```

Two deliberate choices to preserve:

- It **returns the form**, so the handler does not fetch it twice.
- It returns **404, not 403**, when the form exists but belongs to someone else. A 403 confirms the resource exists, which is an enumeration oracle. Apply the same rule to every future owned resource.

The cost of ownership-as-a-call is that a new route can simply forget it. That is a real risk and it is mitigated by review and by the `saas-readiness-reviewer` agent, not by the framework. Accept the trade knowingly.

## 3. One error class, one handler, one response shape

`AppError extends Error` carries a `statusCode`. A single `errorHandler` at the end of the chain distinguishes three cases: `AppError` (use its status), `ZodError` (400 with `details`), everything else (500 with a fixed `Internal server error` string that never leaks the internal message).

Every handler ends with `catch (error) { next(error) }`. **A handler that formats its own error response in a catch block is breaking the pattern** — that is how response shapes start diverging between endpoints, and it is worth flagging in review even when the output happens to look right.

Note the current error handler also `console.error`s the full error object. That is the only observability there is, and it is a log-hygiene risk — see [07-security-and-privacy.md](./07-security-and-privacy.md).

## 4. Services: a class when there is configuration, a function when there is not

`services/pdf-processor.ts` is a class with internal constants (`DEFAULT_SCALE = 1.5`) and public methods (`validatePDF`, `extractFieldsFromPDF`, `embedFieldsInPDF`), instantiated once and exported as a singleton: `export const pdfProcessor = new PDFProcessor()`.

`services/csv-exporter.ts` is a plain function, because it is pure and configuration-free.

Pick by that rule, not by habit. A future `BillingService` or `EntitlementsService` holds configuration and belongs in the first shape.

## 5. Side effects on the physical PDF are explicit and best-effort

Two operations mutate the PDF file on disk rather than only the database, and both are wrapped so they cannot fail the request:

- `GET /api/forms/:id` re-syncs fields from the PDF when the form has a `pdfUrl` and has never had a field, archived ones included (`syncFieldsFromPDF`).
- `POST /api/forms/:formId/fields/bulk` rewrites the PDF from the resulting live field set, embedding them as an AcroForm (`embedFieldsInPDF`). It runs **after** the transaction commits, so a failed embed cannot roll back a saved field set.

Both are `try/catch` around a `console.error` that then continues. The UX reasoning is sound: a user should not get a 500 because a post-processing step failed.

The consequence is an observability hole. When embedding fails, the database and the physical PDF silently disagree, the user is told the save succeeded, and the only trace is a line in stdout that nobody is reading. **These two call sites are the first things to instrument** when structured logging lands, and they need a user-visible signal — the saved form should be able to report that its PDF is out of sync.

## 6. Transactions

Multi-write operations use `prisma.$transaction`. The rule: **any handler that performs more than one write, or a read whose result decides a write, runs inside a transaction.**

The bulk field save is the canonical example. It reads the live fields, decides what to update, create, delete and archive, then does all four inside one `prisma.$transaction(async tx => …)`; without it a failure part-way leaves a half-written field set, and a concurrent save interleaves into a corrupt one.

It also shows the one place raw SQL earns its keep. Before deciding whether a removed field can be hard-deleted, the handler locks those rows with `SELECT … FOR UPDATE`. Inserting an `Answer` takes a `FOR KEY SHARE` lock on the field it references, which conflicts: a response submitted while the save is deciding either lands first and gets the field archived, or blocks until the save commits. Without the lock, a submission arriving between the answer count and the delete has its answer cascaded away — the same data loss, through a narrower window. **A read whose result decides a destructive write must lock what it read.**

It is also the canonical example of the pattern that belongs with it: **a routine edit must never issue a delete against data a customer produced.** The handler diffs on a client-supplied `id` rather than replacing the set, and a removal that has answers is archived (`deletedAt`) instead of deleted. Note what is *not* there — there is no branch on whether the form has responses. A conditional safe path is the wrong shape, because the destructive branch is then the one exercised in development and by tests. One algorithm, safe on every form. See [03-domain-model](./03-domain-model.md#the-deletedat-lifecycle).

## 7. Adding a new endpoint

The checklist is the `backend-endpoint-pattern` skill. In short: route file per resource under `routes/`, Zod schema beside the handler, `authenticate` then `verifyFormOwnership` (or its equivalent for the resource), all errors via `next(error)`, an integration test in `backend/tests/<resource>.spec.ts` with `supertest` against the real router, a database-backed test in `backend/tests/integration/` if the handler depends on what the database does (cascades, constraints, rollback), and `docs/sot/06-api-reference.md` updated in the same commit after reading the route back.

## 8. What the backend is missing

Ordered by impact on being able to sell this, not by effort. Each has an entry in [`docs/BACKLOG.md`](../BACKLOG.md).

1. **Rate limiting.** `POST /api/auth/login` and `POST /api/responses` are unauthenticated and completely unthrottled. This is the most exposed surface in the system.
2. **Structured logging with request correlation** (pino), replacing `console.*`. Without a request id you cannot answer a B2B customer's "what happened to our submission at 14:32".
3. **Object storage** (S3/R2) instead of local disk, behind signed URLs. Prerequisite for more than one replica and for revocable PDF access.
4. **A job queue** (BullMQ + Redis) for PDF extraction and embedding, so a large document cannot block the event loop or time out a request.
5. **Shared request/response types between backend and frontend**, generated from the Zod schemas. The frontend currently redeclares the shapes by hand in `frontend/src/services/`, and the two can diverge silently — which is exactly how the API documentation drifted before.
6. ~~**Stable field ids.**~~ Done — see [03-domain-model.md](./03-domain-model.md).
