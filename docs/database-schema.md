# Database Schema - VuePDF Forms

## Relationship Diagram

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

## Tables

### 1. users
Platform users (form creators).

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | PK |
| email | VARCHAR(255) | Unique, not null |
| password_hash | VARCHAR(255) | Bcrypt hash |
| name | VARCHAR(100) | User's name |
| created_at | TIMESTAMP | Default now() |
| updated_at | TIMESTAMP | Auto-update |

### 2. forms
Forms created by users.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | PK |
| user_id | UUID | FK → users.id |
| title | VARCHAR(255) | Form title |
| description | TEXT | Optional description |
| share_id | VARCHAR(12) | Unique, public URL (e.g. "abc123xyz") |
| status | ENUM | 'draft', 'published', 'closed' |
| pdf_url | VARCHAR(500) | URL of the base PDF in storage |
| settings | JSONB | Additional configuration |
| created_at | TIMESTAMP | Default now() |
| updated_at | TIMESTAMP | Auto-update |

**Indexes:**
- `share_id` (unique) - For public URLs
- `user_id` - For listing a user's forms

### 3. fields
Form fields (text, checkbox, radio, dropdown).

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | PK |
| form_id | UUID | FK → forms.id |
| type | ENUM | 'text', 'textarea', 'checkbox', 'radio', 'dropdown' |
| name | VARCHAR(100) | Internal name (for pdf-lib) |
| label | VARCHAR(255) | Label shown to the user |
| required | BOOLEAN | Default false |
| position | JSONB | { x, y, width, height, page } |
| options | JSONB | For radio/dropdown: ["op1", "op2"] |
| validation | JSONB | Rules: { minLength, maxLength, pattern } |
| order | INTEGER | Tab order |
| created_at | TIMESTAMP | Default now() |

**Indexes:**
- `form_id` - To fetch a form's fields
- `form_id, order` - To sort fields

### 4. responses
Form submissions from end users.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | PK |
| form_id | UUID | FK → forms.id |
| submitted_at | TIMESTAMP | Default now() |
| ip_address | VARCHAR(45) | IPv4/IPv6 |
| user_agent | VARCHAR(500) | Browser info |
| pdf_url | VARCHAR(500) | Filled-in PDF (optional) |

**Indexes:**
- `form_id` - To list a form's responses
- `form_id, submitted_at` - To sort by date

### 5. answers
Individual answers to each field.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | PK |
| response_id | UUID | FK → responses.id |
| field_id | UUID | FK → fields.id |
| value | TEXT | Answer value |

**Indexes:**
- `response_id` - To fetch all answers of a submission

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
  options    Json?     // For radio/dropdown
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

## Design Notes

### Why JSONB for position/options/validation?
- Flexibility to add properties without migrations
- PostgreSQL has good support and can index JSONB
- Simplifies the code (no need for extra tables)

### Why separate answers from responses?
- Enables efficient queries by specific field
- Makes exporting to CSV/Excel easier
- Standard normalization

### Future considerations
- **Soft delete:** Add `deleted_at` if a trash/recovery feature is needed
- **Versioning:** `form_versions` table for history
- **File uploads:** `attachments` table for file-type fields
- **Teams:** `teams` + `team_members` tables for collaboration
