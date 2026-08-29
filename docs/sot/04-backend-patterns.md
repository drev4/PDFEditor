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

## 7. Public write paths carry a named limiter

`middleware/rateLimit.ts` exports one limiter per unauthenticated write path — `loginRateLimit`, `registerRateLimit`, `responseRateLimit` — and each is applied at its route, in the same middleware position `authenticate` occupies:

```ts
authRouter.post('/login', loginRateLimit, async (req, res, next) => { … })
```

Applied at the route, not globally, for the same reason auth is: the guard has to be visible when you read the handler. There is deliberately no global limiter — the authenticated editor legitimately bursts (a bulk field save, a PDF upload), and a global number that does not break it would be a guess.

Three things about them are decisions rather than defaults:

- **Limits come from the environment**, so the test suites and CI can set their own without weakening the production default. The window is fixed at startup; the limit is read per request, which is what lets a test drive the real configuration path instead of reaching into the limiter.
- **The 429 body is an object, not a string.** The library's default handler passes `message` to `res.send`, so an object becomes JSON in this API's `{ error }` shape. A string would be sent as `text/html`, and `frontend/src/services/api.ts` calls `await response.json()` *before* it checks `response.ok` — a non-JSON body throws a `SyntaxError` there instead of producing an `ApiError`, and the user is told nothing useful.
- **Login skips successful requests**, so the limit bites on failures and a person signing in normally cannot lock themselves out.

`req.ip` is only the client if `trust proxy` is right — [08-operations](./08-operations.md#trust_proxy_hops-and-why-it-is-not-a-detail).

## 8. Code-like input is compiled in one audited place

A field's `validation.pattern` is written by a form author and executed against input from an anonymous respondent, on the public endpoint, on the only thread the process has. `services/pattern-validator.ts` is the only module allowed to turn one into something executable — `checkPattern` on write, `compilePattern` on read. **`new RegExp` must not appear at a call site.**

Three things that module encodes, each of which was a live defect:

- **The engine cannot backtrack.** RE2 is linear in input length. `/^(a+)+$/` against 33 characters took 155 s on a native `RegExp` and takes 0.05 ms on RE2. **A timeout is not an alternative** — `test()` is synchronous, so the `setTimeout` that is supposed to interrupt it cannot fire until it has already finished.
- **An unusable pattern degrades to no constraint**, logged, never thrown. Throwing produced a 500 on every submission to that form, permanently, from a single typo.
- **Length checks short-circuit the pattern.** They used to be independent `if`s, so a 100 kB value was still handed to the regex after failing `maxLength: 5`.

RE2 is a native module, so its binary is tied to a Node ABI — see [08-operations](./08-operations.md#configuration). It is loaded defensively: if it will not load, the service still starts and patterns are simply not enforced. Never fall back to `RegExp`, which would reinstate the hang.

`services/pdf-url.ts` follows the same shape for a different kind of untrusted-adjacent value. A `Form.pdfUrl` is a client-supplied string that ends up as a filesystem path and as a URL handed to a browser, so exactly one module produces, parses and verifies it — `pdfFilenameFrom`, `canonicalPdfUrl`, `signPdfUrl`, `verifyPdfToken`. **Nothing else may split a `pdfUrl` on `/` or build an `/uploads` path by hand.** Three call sites used to do that independently; they now all go through the helper, which is also the single seam that a move to presigned object-storage URLs replaces.

## 9. Tenancy is a `where` fragment, not a comparison

Authorization on a form is "is the caller a member of the organization that owns it", and it is expressed as a Prisma filter rather than an equality check on a column:

```ts
// middleware/formOwnership.ts
const memberOfCallerOrganization = (userId?: string) => ({
  organization: { memberships: { some: { userId } } }
})
```

Three rules follow, and all three are easy to lose:

- **Never authorize on `Form.createdByUserId`.** It records who made the form and nothing else. A colleague who did not create a form still gets to work on it. `grep -rn 'createdByUserId' backend/src` should only ever find writes and provenance reads.
- **Ownership failures return `404`, never `403`.** A `403` confirms the row exists and turns the endpoint into an existence oracle for form ids. `backend/tests/integration/tenancy.spec.ts` asserts this on every affected route.
- **Never put `organizationId` in the JWT.** Access tokens live 15 minutes and cannot be revoked, so a membership baked into one outlives the membership itself. Resolve it per request; it costs a join, not a round trip.

New resources get their organization from `requireOrganizationId(req)` — the single place that will have to learn how an active organization is chosen once a user can belong to more than one.

## 10. Response headers are global, except where a route earns an exception

`helmet` is mounted once in `app.ts` and covers every response. A route that needs something different sets it with `res.setHeader` **in the handler, with a comment saying why** — the exception has to be visible next to the code it applies to, like the ownership checks in §2.

There is exactly one exception today, and it is the shape to copy: `GET /uploads/pdfs/:token/:filename` overrides `Cross-Origin-Resource-Policy` to `cross-origin` because the SPA is a different origin, and adds a restrictive `Content-Security-Policy` because the bytes are attacker-supplied. Both are argued in the comment.

**CSRF is guarded the same way.** `middleware/csrf.ts` is applied at `POST /api/auth/refresh` and `POST /api/auth/logout` — the only two routes authenticated by a cookie — and nowhere else. Everything else authenticates with an `Authorization` header, which a cross-site request cannot set, so a guard there would suggest a threat that does not exist while breaking non-browser clients. If you add a route that reads the refresh cookie it needs the guard; if you add one that does not, it does not.

**Do not add a CSP to API responses.** This process serves JSON, not documents; a policy there constrains nothing while making the security posture look better than it is. That absence is asserted in `backend/tests/security-headers.spec.ts` so it cannot be quietly "fixed". The policy that matters is on the SPA — [07-security-and-privacy](./07-security-and-privacy.md#where-the-headers-actually-are).

## 11. Adding a new endpoint

The checklist is the `backend-endpoint-pattern` skill. In short: route file per resource under `routes/`, Zod schema beside the handler, `authenticate` then `verifyFormOwnership` (or its equivalent for the resource), all errors via `next(error)`, an integration test in `backend/tests/<resource>.spec.ts` with `supertest` against the real router, a database-backed test in `backend/tests/integration/` if the handler depends on what the database does (cascades, constraints, rollback), and `docs/sot/06-api-reference.md` updated in the same commit after reading the route back.

## 12. What the backend is missing

Ordered by impact on being able to sell this, not by effort. Each has an entry in [`docs/BACKLOG.md`](../BACKLOG.md).

1. ~~**Rate limiting.**~~ Done — see §7.
2. **Structured logging with request correlation** (pino), replacing `console.*`. Without a request id you cannot answer a B2B customer's "what happened to our submission at 14:32".
3. **Object storage** (S3/R2) instead of local disk, behind signed URLs. Prerequisite for more than one replica and for revocable PDF access.
4. **A job queue** (BullMQ + Redis) for PDF extraction and embedding, so a large document cannot block the event loop or time out a request.
5. **Shared request/response types between backend and frontend**, generated from the Zod schemas. The frontend currently redeclares the shapes by hand in `frontend/src/services/`, and the two can diverge silently — which is exactly how the API documentation drifted before.
6. ~~**Stable field ids.**~~ Done — see [03-domain-model.md](./03-domain-model.md).
