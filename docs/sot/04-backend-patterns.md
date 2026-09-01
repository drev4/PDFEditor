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

Two operations mutate the stored PDF rather than only the database, and both are wrapped so they cannot fail the request:

- `GET /api/forms/:id` re-syncs fields from the PDF when the form has a `pdfUrl` and has never had a field, archived ones included (`syncFieldsFromPDF`).
- `POST /api/forms/:formId/fields/bulk` rewrites the PDF from the resulting live field set, embedding them as an AcroForm. It runs **after** the transaction commits, so a failed embed cannot roll back a saved field set. The handler calls `requestEmbed(formId)` from `services/embed-queue.ts` and does not know where the work runs; the work itself is `embedFormFields` in `services/pdf-embed.ts`.

The embed is a read-modify-write of the whole document, which made it a lost update as soon as two saves overlapped: both read, both embedded their own view, and the later write silently discarded the earlier one's fields — a save the author was told had succeeded, on a PDF that did not contain their work. [`features/0016`](../../features/0016-object-storage-for-uploaded-pdfs.md) fixed it with two halves that do not work alone: it is **serialised per form** (`services/organization-lock.ts`, keyed by form), and it **re-reads the fields inside that serialisation**. Taking the caller's already-read field list would only move the race, since whichever request was queued second would still embed what it read before it started waiting. The local driver's `put` is also atomic — temporary file plus rename — so no reader can see a half-written document.

**Where that serialisation lives is now configuration** ([`features/0017`](../../features/0017-job-queue-for-pdf-embedding.md)), and this is the part to read before changing anything here:

- **`REDIS_URL` unset (the default, and what every test suite runs):** the embed runs inline in the request, serialised by the in-process lock exactly as described above.
- **`REDIS_URL` set:** the handler enqueues a job carrying `formId` and nothing else, and a worker process runs it. The in-process lock is **not** used on this path and must not be added back to it — it would serialise the *enqueue*, which is instant, while the ordering that matters moved to workers it cannot see. The serialiser there is a Redis lock per form, taken inside the job.

What that buys is the cross-replica case: two API replicas can no longer lose an update, because one lock now spans every process. What it costs is **two code paths for one operation**, and the inline one is the path every existing suite exercises — which is exactly why the queued one carries `backend/tests/integration/pdf-embed-queue.spec.ts`, run against a real Redis, asserting the same invariant.

One thing about the queued path is easy to get wrong and was: **do not deduplicate with a stable job id per form.** BullMQ ignores an `add` whose id belongs to a job that is already *running*, so a save made during an in-flight embed would be discarded in silence and the document would be permanently behind the database — the same lost update, reached from the other direction. Every save enqueues its own job; duplicates are harmless because the job re-reads the fields and the embed is idempotent.

Both are `try/catch` around a `console.error` that then continues. The UX reasoning is sound: a user should not get a 500 because a post-processing step failed.

The consequence is an observability hole. When embedding fails, the database and the physical PDF silently disagree, the user is told the save succeeded, and the only trace is a line in stdout that nobody is reading. **These two call sites are the first things to instrument** when structured logging lands, and they need a user-visible signal — the saved form should be able to report that its PDF is out of sync.

The queue narrows that hole without closing it. A transient failure — a storage blip, an S3 throttle — is now retried instead of lost. What it adds is a state that did not exist before: a job that has **exhausted its retries**, which is a form whose PDF is permanently behind its fields. That is logged distinctly (`EMBED GAVE UP`, naming the form) rather than mixed in with failures that will retry, and [08-operations.md](./08-operations.md) says what a human does about one. The user-visible signal is still missing, and is still the instrumentation row.

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

**Where the count lives is configuration** ([`features/0018`](../../features/0018-shared-rate-limit-store.md)). `REDIS_URL` unset means an in-memory store per process — correct at one replica, and what every suite runs on; set, it means one shared store, so the limit belongs to the service rather than to whichever replica answered. The pattern above does not change: a new public endpoint still adds a named limiter and applies it at the route, and it inherits the store automatically.

Three things about it are worth knowing before touching that file. Limiters are built **on their first request, not at import**, because `dotenv.config()` runs in `app.ts`'s body and ES imports evaluate first — choosing a store at import would ignore a developer's `.env` and silently pick memory. Each limiter gets **its own key namespace**, so a burst of public submissions cannot consume the login budget. And a store failure **rejects** the request (`passOnStoreError: false`), which is a security decision argued in [07-security](./07-security-and-privacy.md) rather than a default nobody chose.

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

`services/pdf-url.ts` follows the same shape for a different kind of untrusted-adjacent value. A `Form.pdfUrl` is a client-supplied string that ends up as a filesystem path and as a URL handed to a browser, so exactly one module produces, parses and verifies it — `pdfFilenameFrom`, `canonicalPdfUrl`, `signPdfUrl`, `verifyPdfToken`. **Nothing else may split a `pdfUrl` on `/` or build an `/uploads` path by hand.**

`services/pdf-storage.ts` is the third, and it owns the **bytes** ([`features/0016`](../../features/0016-object-storage-for-uploaded-pdfs.md)). The division with `pdf-url.ts` is worth keeping straight: that module owns what a URL may contain and how a filename is safely got out of one; this module owns where the bytes live and how they move. **Nothing outside it may join an `uploads` path or open a PDF by name** — six call sites used to do exactly that (four routes, `app.ts`, and a maintenance script no test covers), and leaving any one of them behind in a move to object storage gives a deployment where uploads work and one read silently 404s depending on which replica answered.

Two rules it encodes that are not obvious:

- **The key is re-validated at the boundary**, even though every caller is supposed to have run the name through `pdfFilenameFrom` first. It is the last thing between a request-supplied string and a path, and it throws rather than returning a falsy value — an `exists` that answered `false` for an unsafe key would send the caller down the silent "no PDF, skip the work" path with a name that should have stopped the request. That was a real bug in the first draft, caught by its own test.
- **An unknown driver refuses to boot**, which is the opposite of how `resolvePlan` and `envInt` treat bad configuration. The difference is what the mistake costs. A bad plan key degrades to free and somebody is briefly on the wrong tier; a storage driver that quietly fell back to local disk would accept uploads and lose them at the next deploy. Degrading safely requires a safe direction to degrade in, and here there is none.

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

New resources get their organization from `requireOrganizationId(req)` in `middleware/membership.ts` — the single place that will have to learn how an active organization is chosen once a user can belong to more than one.

**Roles are a second, different check.** `requireRole(req, ['owner'])` returns the caller's membership or throws, and it distinguishes two rejections that must not be collapsed: **`404`** when the caller is not in the organization at all, **`403`** when they are but their role does not allow the action. Collapsing them either leaks existence or tells a legitimate member their own organization does not exist. Anything that could remove an owner calls `assertNotLastOwner` first — an organization with no owner cannot be administered or deleted, and nothing here can repair one.

## 10. Plan limits are explicit calls, and `402` is not `403`

`backend/src/services/entitlements.ts` is where every plan limit is checked, and it is called the way §2 calls ownership: **explicitly, inside the handler**, never mounted as a layer. Each resource has a different limit and a middleware cannot know which one applies without re-deriving the route.

The plan catalogue is a **frozen constant** in `backend/src/services/plans.ts`, not a table — a table is a second source of truth that can drift from the code enforcing it, and it earns its place only when a customer needs limits nobody else has. `Organization.planKey` says which entry applies, and `resolvePlan` degrades an unknown key **downward** to free, because the failure mode of guessing high is giving the product away silently.

Two rejections that must never be collapsed:

- **`402 Payment Required` — a plan limit.** The caller could have this if they paid.
- **`403 Forbidden` — a permission failure.** What `requireRole` throws. Paying changes nothing.

The frontend shows "upgrade your plan" for one and "you do not have access" for the other, and it must be able to tell them apart **without parsing a message string** — `FormsManagementView.vue` branches on `ApiError.status === 402`.

**A `402` must never reach a respondent.** This is the rule that shapes the whole design. The person filling in a public form is not the customer: telling them the plan is exhausted is meaningless to them, and it publishes the customer's billing state to anyone holding a share link. So the two public paths borrow the answers they already had:

| Path | When the month's responses are spent | Why |
|---|---|---|
| `GET /forms/public/:shareId` | `404 Form not found` | Same as a closed form. It refuses **before** anybody fills the form in — enforcing only at submit would mean the respondent types everything and then loses it |
| `POST /responses` | `403 Form is not accepting responses` | Byte-identical to the unpublished-form rejection, so an exhausted plan is indistinguishable from a closed form |

**Publishing is what is metered, not creating.** Drafting is always free; the limit is on how many forms are `published` at once, which is what the design canvas draws and what makes "unpublish another one" a real alternative to upgrading. It is checked in `PATCH /forms/:id/status` *and* `PUT /forms/:id`, because `updateFormSchema` accepts `status` and gating only one of them leaves the limit reachable through the other.

**The meter is claimed atomically, never read-then-written.** `assertResponseWithinLimit(tx, organizationId)` upserts the counter with an `increment` and compares the value it gets back, inside the same transaction as the `Response`. The upsert takes the row lock, so a second concurrent submission blocks and then reads `limit + 1` and throws — and the throw rolls back the increment and the response together. Read-compare-increment would let two submissions both pass at `limit - 1`, and a compensating decrement is a thing to get wrong. Nothing may catch that throw before the transaction boundary.

**One function resolves a plan, and it is `effectivePlan`.** `resolvePlan` maps a stored key to a catalogue entry and stays pure; `effectivePlan` is that plus the temporary `DEV_PLAN_KEY` override ([08-operations](./08-operations.md)). Every limit check calls the latter, so the override has exactly one way in and one way out — and so that deleting it later is a local edit rather than a hunt.

**Every limit comes from the catalogue — except one, and the exception is contained on purpose.** Team's seats are **bought rather than declared** ([`features/0015`](../../features/0015-team-plan-and-purchased-seats.md)): the customer sets the quantity in Stripe's portal, so no constant in `plans.ts` can know it. `seatLimitFor` in `entitlements.ts` is the single function that resolves it, and the containment is worth stating precisely, because the general version of this would dissolve the property that makes §10 work:

- It applies to **one plan family**, `PER_SEAT_PLANS` in `plans.ts`, currently just `team`. Every other plan's seat limit, and every other limit of every plan, still comes wholly from the frozen catalogue.
- It reads **one column**, `Subscription.quantity`, which is what Stripe *reported*. `entitlements.ts` still does not import Stripe and still does not know a webhook exists.
- The catalogue value stops being the answer and becomes a **floor**: the limit is `max(floor, quantity)`. Every unreadable case — no subscription, `null`, `0`, a quantity below the floor — degrades **downward** to the floor, never to `null`, because `null` means unlimited and would give the product away. Same discipline as `resolvePlan`.
- **Nothing here writes a quantity.** The only quantity this application sends Stripe is the opening one on a Checkout line item, and `adjustable_quantity` lets the buyer change it on Stripe's own page. Pushing a quantity on every invitation was rejected: seats include pending invitations, an invitation expires on a clock, and there is no scheduler — so the quantity would drift from the truth with no code running, silently, for every organization that ever let an invitation lapse.

The consequence for the product, stated so nobody re-litigates it by accident: **adding a person to a full plan is two steps, buy then invite**, and `assertCanInvite` answers `402` in between. And **a downgrade removes nobody** — an organization that drops from eight seats to one keeps all eight memberships and every pending invitation, and only the ninth invitation is refused. The same rule as published forms, and sharper: unpublishing is reversible in a click, a removed membership loses the record of who was here and since when.

Finally, the boundary, which survived step 8: **nothing in `routes/` imports anything from a billing provider except `routes/billing.ts`.** Domain routes ask the entitlements service a question about limits; `services/stripe.ts` is the only module that imports the Stripe SDK, and `grep -rn "from 'stripe'" backend/src` finds it and nothing else.

## 10a. A webhook is not like any other route here

`POST /api/billing/webhook` breaks four of this document's own rules, and every one of them is deliberate ([`features/0013`](../../features/0013-stripe-subscriptions.md)). If you are adding a second webhook, copy this shape rather than the shape in §12.

**1. It reads a raw body, and its mounting position is load-bearing.** Stripe signs the exact bytes it sent. `express.json()` consumes the stream and hands the handler a parsed object, and re-serialising it does not reproduce those bytes — so under the global parser *every* signature check fails. The webhook router is therefore mounted in `app.ts` **above** `app.use(express.json())` with `express.raw({ type: 'application/json' })` of its own, behind a comment saying so. The failure it prevents is silent and total: the endpoint still answers, and every subscription is bought and never activated. `tests/integration/billing.spec.ts` posts genuinely-signed events over HTTP, which is what makes the ordering testable at all — nine of its twelve tests fail if the mount is moved.

**2. The signature is the whole authentication.** No session, no Bearer token, no CSRF guard. `constructWebhookEvent` verifies before anything reads the body as data, throws `400` on failure, and says nothing about *why* — the difference between a stale timestamp, a wrong secret and a forged digest is useful to an attacker and useless to Stripe, which retries either way.

**3. It carries no rate limiter, and §7 requires that to be argued.** The argument: the signature is a strictly stronger gate than a limiter — an unsigned request is rejected before any work, at the cost of one HMAC, so there is no expensive path to protect. A limiter would instead throttle *Stripe's own retries*, and every dropped retry is a subscription state this application never learns about — a customer who paid and did not get the plan, or one who cancelled and kept it. The failure mode of the limiter is worse than the one it prevents. `tests/billing.spec.ts` asserts that 40 unsigned requests all get `400` and none gets `429`, so the absence cannot be "fixed" by accident.

**4. It answers `200` to almost everything, including things it ignored.** Duplicates, event types it does not handle, and events naming an organization it cannot resolve all get `200`. Any other status makes Stripe retry, and retrying an event that will never resolve is a loop that ends with Stripe disabling the endpoint — taking every real customer's subscription updates with it. Only an unverifiable request gets `400`.

And two properties of the handler itself, which are what make it correct under Stripe's actual delivery guarantees (**at least once, and unordered**):

- **Idempotent.** `claimEvent` inserts `event.id` into `stripe_events`, whose primary key *is* Stripe's id, and treats the collision as "already processed". Insert-and-catch, not read-then-insert: two concurrent deliveries of the same event both pass a read check.
- **State-setting, never incremental.** The handler reads the subscription object *on the event* and writes what it says — status, price, period end — and derives `Organization.planKey` from that, in one transaction. It never performs "upgrade the organization" as an action. A state-setting handler is naturally safe under replay and reordering; an incremental one is not, and no amount of idempotency machinery rescues it.

**An event's API version is checked, and a mismatch is logged rather than refused** ([`features/0014`](../../features/0014-close-the-subscription-surface.md)). `STRIPE_API_VERSION` pins only the requests this application *sends*; incoming events are serialised in the webhook endpoint's configured version, or the account default when it pins none. `constructEvent` verifies the signature and never the shape, so a payload from an unexpected version verifies perfectly and reconciles wrong — which is exactly how `current_period_end` moving onto the subscription item would have stored `null` for every customer while failing nothing. `assertKnownApiVersion` logs once per distinct version and lets the event through. **Do not make it fatal**: refusing would answer non-`200`, Stripe would retry until it disabled the endpoint, and a cosmetic drift would become a total billing outage. The failure being guarded against is silence, so the remedy is noise.

**`POST /api/billing/checkout` is serialised per organization, and not with a database lock.** `services/organization-lock.ts` explains why at length; the short version is that `SELECT … FOR UPDATE` locks nothing on a first checkout, because there is no row yet — which is the exact case the race matters in — and a transaction-scoped advisory lock would have to be held across a network call to Stripe, tying a pooled connection to Stripe's latency. It is an in-process lock, covering the realistic threat (a double click on one replica), layered with the Stripe idempotency key that covers the cross-replica case. The handler also hands back an already-open Checkout Session instead of opening a second one, which is what actually prevents an organization ending up with two paid subscriptions of which it can only ever see one.

**Nothing outside `services/stripe.ts` writes `Organization.planKey`.** `grep -rn "planKey" backend/src` finds one write and the rest reads. That is what makes the plan derived rather than duplicated, and it is why `getEntitlements`, `effectivePlan`, `assertCanPublishForm` and `isOverResponseLimit` were not changed by billing at all.

**A billing event never touches customer data.** `services/stripe.ts` does not write to `Form` or `Response`, and must not: an organization dropping to free with five published forms keeps all five, because those URLs are live and were given to respondents. The limit refuses the *sixth*. Downgrading refuses new state and destroys none of the old.

## 11. Response headers are global, except where a route earns an exception

`helmet` is mounted once in `app.ts` and covers every response. A route that needs something different sets it with `res.setHeader` **in the handler, with a comment saying why** — the exception has to be visible next to the code it applies to, like the ownership checks in §2.

There is exactly one exception today, and it is the shape to copy: `GET /uploads/pdfs/:token/:filename` overrides `Cross-Origin-Resource-Policy` to `cross-origin` because the SPA is a different origin, and adds a restrictive `Content-Security-Policy` because the bytes are attacker-supplied. Both are argued in the comment.

**CSRF is guarded the same way.** `middleware/csrf.ts` is applied at `POST /api/auth/refresh` and `POST /api/auth/logout` — the only two routes authenticated by a cookie — and nowhere else. Everything else authenticates with an `Authorization` header, which a cross-site request cannot set, so a guard there would suggest a threat that does not exist while breaking non-browser clients. If you add a route that reads the refresh cookie it needs the guard; if you add one that does not, it does not.

**Do not add a CSP to API responses.** This process serves JSON, not documents; a policy there constrains nothing while making the security posture look better than it is. That absence is asserted in `backend/tests/security-headers.spec.ts` so it cannot be quietly "fixed". The policy that matters is on the SPA — [07-security-and-privacy](./07-security-and-privacy.md#where-the-headers-actually-are).

## 11a. There are two ways to authenticate, and they resolve different things

`middleware/auth.ts` resolves a **user** from a session token, and every authorization check downstream turns that user into an organization: `callerCanReachForm` is literally `organization: { memberships: { some: { userId } } }` (§9). `middleware/apiKeyAuth.ts` resolves an **organization** from an API key, with no user anywhere ([`features/0019`](../../features/0019-api-keys-and-read-only-public-api.md)).

They are not interchangeable, and a session token on `/api/v1` or an API key on `/api/*` is a `401` in both directions. That is asserted, not assumed (`tests/integration/api-v1.spec.ts`).

**Why the key got its own router rather than a flag on the existing one**, because it is the decision most likely to be undone by somebody being helpful:

- Giving the key a user id — its creator's, say — makes the existing middleware work unchanged, and ties a customer's integration to one employee: remove that person from the organization and production breaks, reporting a missing form. It also makes `Membership.role` apply to a machine.
- Widening `callerCanReachForm` to take either a user or an organization is two lines, and changes the authorization input of **every authenticated route in the product** for the benefit of a handful of new ones.

So `routes/v1/` scopes on `organizationId` directly, reuses the *services* rather than the session middleware, and leaves every existing route untouched. Note the one place it also departs from §2: the guards are mounted on the router rather than per handler, because every route there has the same answer and the risk being managed is a *future* endpoint added without them — the opposite of the internal routers, where an anonymous endpoint sits beside authenticated ones and the guard has to be readable per handler.

## 12. Adding a new endpoint

The checklist is the `backend-endpoint-pattern` skill. In short: route file per resource under `routes/`, Zod schema beside the handler, `authenticate` then `verifyFormOwnership` (or its equivalent for the resource), all errors via `next(error)`, an integration test in `backend/tests/<resource>.spec.ts` with `supertest` against the real router, a database-backed test in `backend/tests/integration/` if the handler depends on what the database does (cascades, constraints, rollback), and `docs/sot/06-api-reference.md` updated in the same commit after reading the route back.

## 13. What the backend is missing

Ordered by impact on being able to sell this, not by effort. Each has an entry in [`docs/BACKLOG.md`](../BACKLOG.md).

1. ~~**Rate limiting.**~~ Done — see §7.
2. **Structured logging with request correlation** (pino), replacing `console.*`. Without a request id you cannot answer a B2B customer's "what happened to our submission at 14:32".
3. **Object storage** (S3/R2) instead of local disk, behind signed URLs. Prerequisite for more than one replica and for revocable PDF access.
4. **A job queue** (BullMQ + Redis) for PDF extraction and embedding, so a large document cannot block the event loop or time out a request.
5. **Shared request/response types between backend and frontend**, generated from the Zod schemas. The frontend currently redeclares the shapes by hand in `frontend/src/services/`, and the two can diverge silently — which is exactly how the API documentation drifted before.
6. ~~**Stable field ids.**~~ Done — see [03-domain-model.md](./03-domain-model.md).
7. ~~**Billing.**~~ Done for Free ↔ Pro — see §10a. **Not** done: the Team plan, which is priced per seat and needs the Stripe quantity kept in step with `Membership`.
