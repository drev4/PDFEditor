# Arquitectura y modelo de dominio

## Monorepo

```
backend/   API REST Express — auth, forms, fields, responses, upload
           Prisma ORM -> PostgreSQL
           npm workspace independiente (backend/package.json)
frontend/  SPA Vue 3 — editor, dashboard, visor de formulario público
           npm workspace independiente (frontend/package.json)
e2e/       Playwright, corre contra front+back levantados
docs/      Guías puntuales (upload, schema) + este SOT
poc/       Pruebas de concepto, no producción
```

Orquestado desde la raíz vía npm workspaces (`package.json` raíz define `dev`, `build`, `test:*` delegando a cada workspace con `--workspace=`).

No hay Nx/Turborepo — es una elección deliberadamente simple para un proyecto de este tamaño. Si el equipo crece o se separan más servicios (ej. un worker de procesamiento de PDFs), reconsiderar.

## Stack real (verificado en `package.json`, no en specs antiguas)

| Capa | Tecnología | Versión aprox. |
|---|---|---|
| Frontend | Vue 3 (Composition API) + TypeScript | vue ^3.5.22 |
| Build frontend | Vite | ^7.1.7 |
| Estado | Pinia + `pinia-plugin-persistedstate` | ^3.0.3 |
| UI | PrimeVue + Tailwind CSS | primevue ^4.4.1, tailwind ^3.4.18 |
| Render PDF | PDF.js | pdfjs-dist ^5.4.296 |
| Manipulación PDF | pdf-lib (browser **y** backend) | ^1.17.1 |
| Backend | Express | ^4.21.2 |
| ORM | Prisma + PostgreSQL | @prisma/client ^6.2.1 |
| Auth | JWT (`jsonwebtoken`) + bcrypt | — |
| Validación | Zod | ^3.24.1 |
| Uploads | Multer (disco local, no S3) | ^2.0.2 |
| IDs públicos | nanoid | ^5.0.9 |
| Tests unit/integración FE | Vitest + @testing-library/vue | vitest ^4.0.16 |
| Tests unit/integración BE | Vitest + supertest + vitest-mock-extended | vitest ^4.0.18 |
| E2E | Playwright | — |

**Importante:** `TECHNICAL_SPECS.md` (2024-12-27) recomendaba Supabase como backend. Eso se descartó — el backend real es Express+Prisma propio, con JWT propio en vez de Supabase Auth. Cualquier mención a Supabase en ese fichero es histórica, no vigente.

## Flujo de datos

**Crear formulario:**
`Editor (Vue) → upload PDF (multipart) → POST /api/upload → pdf-processor.validatePDF + extractFieldsFromPDF → POST /api/forms → POST /api/forms/:id/fields/bulk (embebe AcroForm en el PDF físico) → PostgreSQL`

**Responder formulario público:**
`GET /api/forms/public/:shareId (sin auth, incrementa viewCount) → render campos → POST /api/responses (valida required + tipo + longitud/patrón por campo) → PostgreSQL`

**Ver respuestas:**
`GET /api/forms/:id/responses (paginado, dueño only) → tabla en dashboard` y `GET /api/forms/:id/responses/export → csv-exporter.ts → CSV con BOM UTF-8 descargable`

## Modelo de dominio (Prisma, `backend/prisma/schema.prisma`)

```
User 1───* Form 1───* Field 1───* Answer *───1 Response *───1 Form
```

- **User**: `id, email (unique), passwordHash, name?`. Sin roles, sin organización — hoy es plano.
- **Form**: pertenece a un `User` (`onDelete: Cascade`). `shareId` único (nanoid) es el identificador público — nunca exponer `userId` en la ruta pública (`forms.ts` ya lo excluye explícitamente con destructuring: `const { userId, ...publicForm } = form`). `status`: `draft | published | closed` (enum `FormStatus`). `settings: Json?` sin usar activamente aún — hueco natural para configuración por formulario (branding, límites, webhooks) sin migración.
- **Field**: pertenece a un `Form`. `type` (enum `FieldType`: `text | textarea | checkbox | radio | dropdown`), `position: Json` (`{x, y, width, height, page}` — coordenadas en espacio de canvas, no de PDF; ver [04-frontend-patterns.md](./04-frontend-patterns.md) para la conversión), `options: Json?` (array de strings para radio/dropdown), `validation: Json?` (`{minLength, maxLength, pattern}`), `order: Int` para el orden de tabulación/render.
- **Response**: pertenece a un `Form`. Guarda `ipAddress` y `userAgent` del remitente (sin autenticar). No guarda quién la envió más allá de eso — no hay concepto de "respondente registrado".
- **Answer**: `value: String` — todo se guarda como string (incluso `boolean` de un checkbox se serializa con `String(value)`), la interpretación por tipo ocurre en `csv-exporter.ts` y en la validación de `responses.ts`, no en el esquema de datos.

Índices ya puestos donde importan: `Form.userId`, `Field.formId`, `Response.formId` y compuesto `(formId, submittedAt)` para el listado paginado por fecha.

## Qué falta en el dominio para SaaS (ver documento 06)

No hay `Organization`, `Plan`, `Subscription`, `Role` ni nada de facturación en el schema actual. Añadir esto implica una migración de Prisma no trivial porque `Form.userId` hoy asume "el dueño es un usuario", y en B2B el dueño lógico debería poder ser una organización con varios usuarios.
