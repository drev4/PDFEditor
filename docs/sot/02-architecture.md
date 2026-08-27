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
| Uploads | Multer, local disk | `^2.0.2` |
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
                  ├── /uploads/*  express.static  ← serves raw PDFs, unauthenticated
                  └── Prisma ──> PostgreSQL (docker-compose in dev)

Filesystem: backend/uploads/pdfs/  ← PDFs live on the local disk of this process
```

Three properties of this topology are load-bearing and each is a constraint on scaling:

1. **PDFs live on the local filesystem of the API process.** `middleware/upload.ts` writes to `process.cwd()/uploads/pdfs`, and `app.ts` serves that directory statically. The API therefore cannot be run as more than one replica, and cannot be redeployed on ephemeral disk without losing every uploaded PDF. This is the single biggest blocker to a real deployment. See [08-operations.md](./08-operations.md).
2. **PDF processing is synchronous and inline in the request.** `extractFieldsFromPDF` on upload and `embedFieldsInPDF` on bulk save both run inside the HTTP handler. A large or pathological PDF blocks the Node event loop for every other request, not just its own.
3. **The static `/uploads` mount has no authorization.** Anyone who has a PDF URL can fetch it, forever, with no token. Filenames are `nanoid(12)-<timestamp>.pdf`, which is unguessable in practice but is still an object-capability URL with no expiry and no revocation. Recorded as a finding in [07-security-and-privacy.md](./07-security-and-privacy.md).

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

## Where this architecture breaks next

In the order the load will actually hit it:

1. **Local disk storage** — breaks on the first horizontal scale-out or the first redeploy on ephemeral storage. Move to S3/R2 behind signed URLs.
2. **Synchronous PDF work** — breaks on the first genuinely large PDF, as a request timeout. Move to a job queue (BullMQ + Redis) with the editor polling for completion.
3. **No rate limiting** — breaks on the first bot that finds `POST /api/responses` or `POST /api/auth/login`.
4. **Single-tenant data model** — breaks the moment a B2B customer wants two people to share a form. This is the schema change with the longest lead time, which is why [10-saas-roadmap.md](./10-saas-roadmap.md) puts it ahead of billing.
