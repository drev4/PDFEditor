# VuePDF Forms Platform

A full-stack platform for creating fillable PDF forms, sharing them via a public link, and collecting structured responses. Users upload a PDF, place interactive fields directly on the page (text, textarea, checkbox, radio, dropdown), publish the form, and collect answers through a public, no-login-required flow — with results exportable to CSV.

Built as a monorepo: a Vue 3 SPA for the editor/dashboard and a Node/Express REST API backed by PostgreSQL.

## Features

**Authentication & accounts**
- Email/password auth with JWT, route guards, persisted sessions
- Per-user dashboard and forms management screen

**PDF editor**
- Canvas rendering of PDF pages with page navigation and thumbnail reordering
- Drag-and-drop placement of five field types: text, textarea, checkbox, radio group, dropdown
- Text and image annotation tools, in-document search
- Undo/redo via editor snapshots
- Bulk field operations (move, resize, delete multiple fields at once)

**Publishing & public forms**
- One-click publish/unpublish behind a unique `shareId`
- Public, unauthenticated form-filling view with client-side field validation
- Confirmation screen after submission

**Responses**
- Per-form responses dashboard
- CSV export of collected answers

**Persistence**
- PDF upload with progress tracking, stored server-side
- Forms, fields, and responses persisted to PostgreSQL via Prisma

## Tech stack and why

Rather than a generic checklist, here's the reasoning behind the main choices:

| Layer | Choice | Why |
|---|---|---|
| UI framework | **Vue 3** (Composition API) + **TypeScript** | The editor shares a lot of stateful logic (drag placement, snapshots, field validation, coordinate math between PDF space and screen space) across several views. Composables make that logic reusable and unit-testable in isolation from components; the Options API doesn't compose as cleanly for that. |
| Build tool | **Vite** | Fast HMR matters when iterating on a canvas-heavy editor — full-page reloads on every tweak to field positioning logic would slow that loop down considerably. |
| State management | **Pinia** | Editor state (selected tool, active field, drawing mode), form fields, and undo/redo snapshots need to be shared across the toolbar, canvas, and side panels without prop-drilling. Pinia is the current official store for Vue 3, with straightforward TypeScript inference. |
| UI components | **PrimeVue** + **Tailwind CSS** | PrimeVue supplies the non-trivial widgets (dialogs, dropdowns, data tables for the responses view) so they don't have to be hand-built and re-tested; Tailwind handles layout and spacing without fighting a full design system for everything else. |
| PDF rendering | **PDF.js** | The de-facto standard for rendering arbitrary PDFs to a `<canvas>` in the browser without a plugin. |
| PDF manipulation | **pdf-lib** | Needed to read and write PDF structure programmatically — embedding form fields, flattening pages — and it's pure JavaScript, so the same library works both in the browser editor and on the Node backend for AcroForm export. |
| API framework | **Express** | The API surface (auth, forms, fields, responses, upload) is small and REST-shaped; Express keeps the routing and middleware explicit rather than introducing a heavier framework's conventions for a service this size. |
| ORM / database | **Prisma** + **PostgreSQL** | The domain is relational (`User → Form → Field`, `Form → Response → Answer`) and benefits from real foreign keys and cascades rather than a document store. Prisma generates types from the schema, so the schema, the query layer, and the TypeScript types can't drift out of sync silently. |
| Auth | **JWT** + **bcrypt** | Stateless tokens fit a SPA-to-API architecture without server-side session storage; bcrypt is the standard for password hashing. |
| Validation | **Zod** | Request payloads are parsed and validated at the API boundary with the same schema-first approach used for form-field definitions, instead of scattering manual `if` checks through route handlers. |
| File uploads | **Multer** | Standard multipart/form-data middleware for handling PDF uploads in Express. |
| Public IDs | **nanoid** | Short, URL-safe, collision-resistant IDs for the public `shareId`, so form links stay compact. |
| Testing | **Vitest** + **@testing-library/vue** | Vitest reuses the Vite config and transform pipeline, so unit tests run against the same module resolution as the app; Testing Library encourages testing components by user-visible behavior rather than internal implementation. |
| E2E testing | **Playwright** | Covers the flows that matter end-to-end — auth, PDF upload, field placement, public form submission — across a real browser instead of mocked component trees. |
| Local infra | **Docker Compose** | Reproducible local PostgreSQL without installing/configuring it on the host machine. |

## Architecture

```
frontend/  Vue 3 SPA — editor, dashboard, public form viewer
backend/   Express REST API — auth, forms, fields, responses, upload
           Prisma ORM -> PostgreSQL
e2e/       Playwright end-to-end test suite
docs/      Feature-specific guides (PDF upload, database schema)
```

Data model (simplified): `User` owns `Form`s; each `Form` has many `Field`s (the placed, positioned form controls) and many `Response`s submitted by the public; each `Response` has many `Answer`s, one per field.

## Getting started

### Prerequisites
- Node.js >= 18
- PostgreSQL >= 14 (or Docker)
- npm >= 9

### Setup

```bash
git clone <repository-url>
cd VuePDF
npm install
```

Start PostgreSQL locally with Docker:

```bash
npm run docker:up
```

Create `backend/.env`:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/vuepdf?schema=public"
JWT_SECRET="change-me"
PORT=3000
NODE_ENV=development
UPLOAD_DIR=./uploads
MAX_FILE_SIZE=10485760
```

Create `frontend/.env`:

```env
VITE_API_URL=http://localhost:3000/api
```

Generate the Prisma client and run migrations:

```bash
npm run db:generate
npm run db:migrate
```

Run the app:

```bash
npm run dev              # frontend + backend together
# or
npm run dev:frontend     # http://localhost:5173
npm run dev:backend      # http://localhost:3000
```

## Testing

```bash
npm test                 # frontend unit tests
npm run test:backend     # backend unit/integration tests
npm run test:e2e         # Playwright E2E (requires the app running)
npm run test:all         # everything
```

E2E setup details: [e2e/README.md](e2e/README.md).

## Project structure

```
VuePDF/
├── backend/
│   ├── src/
│   │   ├── routes/         # auth, forms, form-fields, responses, upload
│   │   ├── middleware/     # auth guard, form ownership, error handling, upload
│   │   ├── services/       # Prisma client, CSV export
│   │   └── app.ts / index.ts
│   └── prisma/schema.prisma
├── frontend/
│   └── src/
│       ├── components/     # auth, editor, form-fields, forms, pdf, toolbars, ui
│       ├── composables/    # shared editor/upload/validation logic
│       ├── stores/         # Pinia stores (auth, forms, fields, editor, drawing, snapshots)
│       ├── services/       # API clients
│       └── views/          # Dashboard, FormsManagement, Login, Register,
│                            # PublicForm, PublicFormConfirmation, Responses
├── e2e/                     # Playwright specs
├── docs/                    # PDF upload guide, database schema
└── docker-compose.yml       # local PostgreSQL
```

## Additional documentation

- [Source of Truth](docs/sot/README.md) — architecture, domain model, API reference, security, operations
- [API reference](docs/sot/06-api-reference.md)
- [Domain model](docs/sot/03-domain-model.md)
- [Backlog](docs/BACKLOG.md)
- [User guide: uploading and publishing a form](docs/guides/uploading-and-publishing-a-form.md)
- [Backend Migration Guide](backend/MIGRATION_GUIDE.md)

## License

MIT
