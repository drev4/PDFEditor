# Database Schema - VuePDF Forms

## Diagrama de Relaciones

```
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│    users    │──1:N──│    forms    │──1:N──│   fields    │
└─────────────┘       └─────────────┘       └─────────────┘
                             │
                             │1:N
                             ▼
                      ┌─────────────┐       ┌─────────────┐
                      │  responses  │──1:N──│   answers   │
                      └─────────────┘       └─────────────┘
```

## Tablas

### 1. users
Usuarios de la plataforma (creadores de formularios).

| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | UUID | PK |
| email | VARCHAR(255) | Único, not null |
| password_hash | VARCHAR(255) | Bcrypt hash |
| name | VARCHAR(100) | Nombre del usuario |
| created_at | TIMESTAMP | Default now() |
| updated_at | TIMESTAMP | Auto-update |

### 2. forms
Formularios creados por usuarios.

| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | UUID | PK |
| user_id | UUID | FK → users.id |
| title | VARCHAR(255) | Título del formulario |
| description | TEXT | Descripción opcional |
| share_id | VARCHAR(12) | Único, URL pública (ej: "abc123xyz") |
| status | ENUM | 'draft', 'published', 'closed' |
| pdf_url | VARCHAR(500) | URL del PDF base en storage |
| settings | JSONB | Configuración adicional |
| created_at | TIMESTAMP | Default now() |
| updated_at | TIMESTAMP | Auto-update |

**Índices:**
- `share_id` (único) - Para URLs públicas
- `user_id` - Para listar formularios del usuario

### 3. fields
Campos del formulario (text, checkbox, radio, dropdown).

| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | UUID | PK |
| form_id | UUID | FK → forms.id |
| type | ENUM | 'text', 'textarea', 'checkbox', 'radio', 'dropdown' |
| name | VARCHAR(100) | Nombre interno (para pdf-lib) |
| label | VARCHAR(255) | Label visible al usuario |
| required | BOOLEAN | Default false |
| position | JSONB | { x, y, width, height, page } |
| options | JSONB | Para radio/dropdown: ["op1", "op2"] |
| validation | JSONB | Reglas: { minLength, maxLength, pattern } |
| order | INTEGER | Orden de tabulación |
| created_at | TIMESTAMP | Default now() |

**Índices:**
- `form_id` - Para obtener campos de un formulario
- `form_id, order` - Para ordenar campos

### 4. responses
Envíos de formularios por usuarios finales.

| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | UUID | PK |
| form_id | UUID | FK → forms.id |
| submitted_at | TIMESTAMP | Default now() |
| ip_address | VARCHAR(45) | IPv4/IPv6 |
| user_agent | VARCHAR(500) | Browser info |
| pdf_url | VARCHAR(500) | PDF rellenado (opcional) |

**Índices:**
- `form_id` - Para listar respuestas de un formulario
- `form_id, submitted_at` - Para ordenar por fecha

### 5. answers
Respuestas individuales a cada campo.

| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | UUID | PK |
| response_id | UUID | FK → responses.id |
| field_id | UUID | FK → fields.id |
| value | TEXT | Valor de la respuesta |

**Índices:**
- `response_id` - Para obtener todas las respuestas de un envío

---

## Prisma Schema

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id           String   @id @default(uuid())
  email        String   @unique
  passwordHash String   @map("password_hash")
  name         String?
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  forms Form[]

  @@map("users")
}

model Form {
  id          String     @id @default(uuid())
  userId      String     @map("user_id")
  title       String
  description String?
  shareId     String     @unique @map("share_id")
  status      FormStatus @default(draft)
  pdfUrl      String?    @map("pdf_url")
  settings    Json?
  createdAt   DateTime   @default(now()) @map("created_at")
  updatedAt   DateTime   @updatedAt @map("updated_at")

  user      User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  fields    Field[]
  responses Response[]

  @@index([userId])
  @@map("forms")
}

enum FormStatus {
  draft
  published
  closed
}

model Field {
  id         String    @id @default(uuid())
  formId     String    @map("form_id")
  type       FieldType
  name       String
  label      String
  required   Boolean   @default(false)
  position   Json      // { x, y, width, height, page }
  options    Json?     // Para radio/dropdown
  validation Json?     // { minLength, maxLength, pattern }
  order      Int       @default(0)
  createdAt  DateTime  @default(now()) @map("created_at")

  form    Form     @relation(fields: [formId], references: [id], onDelete: Cascade)
  answers Answer[]

  @@index([formId])
  @@map("fields")
}

enum FieldType {
  text
  textarea
  checkbox
  radio
  dropdown
}

model Response {
  id          String   @id @default(uuid())
  formId      String   @map("form_id")
  submittedAt DateTime @default(now()) @map("submitted_at")
  ipAddress   String?  @map("ip_address")
  userAgent   String?  @map("user_agent")
  pdfUrl      String?  @map("pdf_url")

  form    Form     @relation(fields: [formId], references: [id], onDelete: Cascade)
  answers Answer[]

  @@index([formId])
  @@index([formId, submittedAt])
  @@map("responses")
}

model Answer {
  id         String @id @default(uuid())
  responseId String @map("response_id")
  fieldId    String @map("field_id")
  value      String

  response Response @relation(fields: [responseId], references: [id], onDelete: Cascade)
  field    Field    @relation(fields: [fieldId], references: [id], onDelete: Cascade)

  @@index([responseId])
  @@map("answers")
}
```

---

## Notas de Diseño

### ¿Por qué JSONB para position/options/validation?
- Flexibilidad para agregar propiedades sin migrations
- PostgreSQL tiene buen soporte y puede indexar JSONB
- Simplifica el código (no necesitas tablas extra)

### ¿Por qué separar answers de responses?
- Permite consultas eficientes por campo específico
- Facilita exportar a CSV/Excel
- Normalización estándar

### Consideraciones futuras
- **Soft delete:** Agregar `deleted_at` si necesitamos papelera
- **Versioning:** Tabla `form_versions` para historial
- **File uploads:** Tabla `attachments` para campos de archivo
- **Teams:** Tabla `teams` + `team_members` para colaboración
