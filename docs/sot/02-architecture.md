# Architecture

## Shape of the repository

```
backend/    Express REST API — auth, forms, fields, responses, upload
            Prisma ORM -> PostgreSQL
            Independent npm workspace (backend/package.json)
frontend/   Vue 3 SPA — editor, dashboard, public form viewer
            Independent npm workspace (frontend/package.json)
e2e/        Playwright specs, run against a live frontend + backend
docs/       This SoT, end-user guides, archived historical docs
features/   Execution specs for work in flight
poc/        Throwaway experiments — never imported by production code
.claude/    Skills and agents that encode how work is done here
```

Orchestration is plain **npm workspaces**. The root `package.json` delegates every script with `--workspace=`. There is no Nx or Turborepo, deliberately: at this size the build graph fits in your head, and the tooling would cost more than it saves. Reconsider when a third deployable appears — a PDF worker is the likely first one.

## Stack, as verified in `package.json`

| Layer | Technology | Version |
|---|---|---|
| Frontend framework | Vue 3, Composition API, TypeScript | `vue ^3.5.22` |
| Frontend build | Vite | `^7.1.7` |
| State | Pinia + `pinia-plugin-persistedstate` | `pinia ^3.0.3`, plugin `^4.5.0` |
| UI | PrimeVue + Tailwind CSS | `primevue ^4.4.1`, `tailwindcss ^3.4.18` |
| PDF rendering (browser) | PDF.js | `pdfjs-dist ^5.4.296` |
| PDF manipulation (both sides) | pdf-lib | `^1.17.1` |
| API | Express | `^4.21.2` |
| ORM | Prisma + PostgreSQL 16 | `@prisma/client ^6.2.1` |
| Auth | `jsonwebtoken` + `bcrypt` | `^9.0.2`, `^5.1.1` |
| Validation | Zod | `^3.24.1` |
| Uploads | Multer (in memory) → `services/pdf-storage.ts` | `^2.0.2` |
| Object storage | `@aws-sdk/client-s3`, only on the `s3` driver | `^3.1122.0` |
| Public identifiers | nanoid | `^5.0.9` |
| Frontend tests | Vitest + Testing Library + `@pinia/testing` | `vitest ^4.0.16` |
| Backend tests | Vitest + supertest + `vitest-mock-extended` | `vitest ^4.0.18` |
| E2E | Playwright | `^1.58.0` |

Both workspaces are ESM (`"type": "module"`); backend imports carry explicit `.js` extensions because TypeScript is compiled for Node ESM resolution. This is why you will see `from '../services/db.js'` in `.ts` files — it is correct, not a mistake.

## Runtime topology today

```
Browser ── Vite dev server / static build (Vue SPA)
   │
   └── HTTP ──> Express (single Node process, default port 3000)
                  ├── /api/*      JSON API
                  ├── /health     liveness probe
                  ├── /uploads/pdfs/:token/:filename  ← signed, expiring (0006)
                  └── Prisma ──> PostgreSQL (docker-compose in dev)

Storage:    services/pdf-storage.ts  ← `local` (backend/uploads/pdfs) or `s3`
```

Three properties of this topology are load-bearing and each is a constraint on scaling:

1. **PDF bytes go through one module, and where they land is configuration** ([`features/0016`](../../features/0016-object-storage-for-uploaded-pdfs.md)). `services/pdf-storage.ts` is the only thing in the backend that reads or writes them; `PDF_STORAGE_DRIVER` chooses `local` (this process's own disk, the default) or `s3` (any S3-compatible store — AWS, R2, MinIO). On `local` the old constraint still applies in full: one replica, and a redeploy on ephemeral disk loses every PDF. On `s3` it does not, which is what makes more than one replica possible. Two things to know before switching: **the files already on disk are not moved by the switch** — `npm run storage:migrate` copies them, and it is run *before* — and an unrecognised driver name **refuses to boot** rather than falling back, because falling back to local disk would accept uploads and lose them. See [08-operations.md](./08-operations.md).
2. **PDF processing is synchronous and inline in the request.** `extractFieldsFromPDF` on upload and `embedFieldsInPDF` on bulk save both run inside the HTTP handler. A large or pathological PDF blocks the Node event loop for every other request, not just its own. **Still true, and the other half of build-order step 9** — [`features/0016`](../../features/0016-object-storage-for-uploaded-pdfs.md) moved the bytes and deliberately did not move the work. The embed is now serialised per form and re-reads the fields inside that serialisation, which makes it converge instead of losing an update, but it is still in the request and still in this process.
3. **Reading a PDF is a capability carried in the URL, not a session.** The `express.static` mount is gone ([`features/0006`](../../features/0006-signed-expiring-urls-for-uploaded-pdfs.md)): the only way to the bytes is `GET /uploads/pdfs/:token/:filename`, whose token `services/pdf-url.ts` mints per read and which expires after `UPLOAD_URL_TTL_SECONDS`. It is deliberately unauthenticated, because an anonymous respondent has to load the PDF of a published form. What is still open is *per-file* revocation — withdrawing one document today means rotating `JWT_SECRET`, which invalidates every outstanding link ([`docs/BACKLOG.md`](../BACKLOG.md)).

## Data flows

**Authoring a form**

```
Editor (Vue)
  → POST /api/upload            multipart, Multer to local disk
      pdfProcessor.validatePDF  reject non-PDF / corrupt          (hard failure -> 400)
      pdfProcessor.extractFieldsFromPDF                            (best effort -> [] on failure)
  → POST /api/forms             create the Form, generate shareId = nanoid(12)
  → POST /api/forms/:id/fields/bulk
      persist fields
      embedFieldsInPDF          rewrite the PDF on disk as AcroForm (best effort)
```

**Filling a form publicly**

```
GET  /api/forms/public/:shareId   no auth; published forms only; increments viewCount
                                  never returns userId
  → render fields over the PDF in the browser
POST /api/responses               no auth; validates required, type, options, length, pattern
                                  stores ipAddress + userAgent
```

**Reading results**

```
GET /api/forms/:id/responses          owner only, paginated by (formId, submittedAt)
GET /api/forms/:id/responses/export   owner only, csv-exporter.ts, UTF-8 BOM, attachment
```

## Layering rules

The backend has **no controller layer and no repository layer**, on purpose. An Express handler contains its own logic and calls Prisma directly. Non-trivial logic that is not about HTTP lives in `services/`. Keep it that way: adding a controller layer that only forwards to a service adds a file to read without adding a decision point.

What that costs, and what compensates for it, is spelled out in [04-backend-patterns.md](./04-backend-patterns.md): validation, ownership and error handling are **composable functions called explicitly inside the handler**, not framework magic. When a handler stops looking like the others, that is the signal something is wrong, and it is visible in review because there is nowhere to hide it.

The frontend layering is stricter, because there is more state: `services/` own the HTTP contract, `stores/` own shared state, `composables/` orchestrate, `views/` and `components/` render. A component never calls `fetch`. See [05-frontend-patterns.md](./05-frontend-patterns.md).

## The coupling that is not visible in either workspace

Field coordinates are stored in **canvas space** (`{x, y, width, height, page}`), while `pdf-processor.ts` works in **PDF page space** (origin bottom-left, in points). The conversion depends on a scale factor that exists twice: `DEFAULT_SCALE = 1.5` in `backend/src/services/pdf-processor.ts`, and the render scale used by `frontend/src/composables/usePDFRendering.ts`.

Nothing enforces that these agree. No shared constant, no test, no type. Changing the editor's render scale silently misplaces every embedded AcroForm field in the exported PDF, and the failure is invisible until someone opens the PDF in Acrobat. This is the highest-value untested seam in the codebase — see [09-quality-and-testing.md](./09-quality-and-testing.md).

## The landing page — an open decision, `[NOT IMPLEMENTED]`

There is no marketing site. The design exists ([05-frontend-patterns §8](./05-frontend-patterns.md)); the technology has not been chosen, and **that is the decision, not a detail of it**. Left open, it gets made by whoever opens an editor first.

What makes it a real choice rather than "put it in the SPA": the landing has requirements the application does not.

| Requirement | Why the SPA does not satisfy it |
|---|---|
| Indexable by search engines | `frontend/` is a client-rendered Vite SPA. A crawler gets an empty `<div id="app">` and whatever it chooses to execute |
| Fast on a cold first visit | The current build ships a 400 kB entry chunk plus an 880 kB PDF.js chunk. A first-time visitor who has never heard of the product should not pay for the editor |
| Reachable without an API | The SPA's first paint is fine, but the app assumes a backend. A landing must be servable when the API is down — it is what a prospect sees |
| Its own release cadence | Copy and prices change on a marketing rhythm, not a product one. Coupling them means a typo fix rebuilds and redeploys the application |

The options, with the honest cost of each:

| Option | For | Against |
|---|---|---|
| **Static HTML/CSS**, built from the artboard | The artboard already *is* HTML. Nothing to learn, nothing to run, deployable to any static host, indexable and instant | Duplicates the design tokens by hand. No component reuse with the app |
| **Astro** | Ships zero JS by default, can import Vue components if the app's ever want sharing, first-class content collections for a blog later | A second framework and a second build in the repo, for a page that may stay one page |
| **Nuxt** | One framework with the app; SSR gives indexability | Much heavier than the problem. Would pull the SPA toward a migration nobody has asked for |
| **A route in the existing SPA** | Zero new infrastructure | Fails every row of the table above. It is the option that looks cheapest and costs the most |

**A recommendation, not a decision:** static HTML, because the design canvas already produces exactly that, and because a landing page is the one artefact whose requirements are best met by having no runtime at all. The tokens duplicated by hand are eight colours and a type scale — cheaper than a second build system. Revisit if a blog or a docs site appears, which is the point Astro starts paying for itself.

Whatever is chosen, two things follow from the rest of this document: the landing needs its own **CSP header** from whatever host serves it ([08-operations](./08-operations.md)), and if it shares a registrable domain with the app then the session cookie's `SameSite=Lax` keeps working ([07-security-and-privacy](./07-security-and-privacy.md)).

## Where this architecture breaks next

In the order the load will actually hit it:

1. **Local disk storage** — solved as of [`features/0016`](../../features/0016-object-storage-for-uploaded-pdfs.md): S3/R2 behind the existing signed URLs, chosen by `PDF_STORAGE_DRIVER`. It remains the default and therefore remains the constraint for any deployment that has not switched.
2. **Synchronous PDF work** — breaks on the first genuinely large PDF, as a request timeout. Move to a job queue (BullMQ + Redis) with the editor polling for completion.
3. **No rate limiting** — breaks on the first bot that finds `POST /api/responses` or `POST /api/auth/login`.
4. **Single-tenant data model** — breaks the moment a B2B customer wants two people to share a form. This is the schema change with the longest lead time, which is why [10-saas-roadmap.md](./10-saas-roadmap.md) puts it ahead of billing.
