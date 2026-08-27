# API Documentation - VuePDF Forms Platform

> **Nota (2026-08-28):** la sección de Fields de este documento estaba desactualizada respecto al backend real; se ha corregido. A partir de ahora, [`docs/sot/05-api-reference.md`](./docs/sot/05-api-reference.md) es la referencia canónica de la API (se verifica contra `backend/src/routes/` en cada actualización) — este fichero se mantiene por compatibilidad con enlaces existentes, pero ante cualquier duda o discrepancia futura, el SOT manda.

Base URL: `http://localhost:3000/api`

## Authentication

All protected endpoints require a JWT token in the header:
```
Authorization: Bearer <token>
```

---

## Auth Endpoints

### POST /api/auth/register
Register a new user.

**Request:**
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "SecurePassword123!"
}
```

**Response:** `201 Created`
```json
{
  "user": {
    "id": 1,
    "name": "John Doe",
    "email": "john@example.com",
    "createdAt": "2026-01-29T10:00:00.000Z"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Errors:**
- `400 Bad Request` - Validation failed
- `409 Conflict` - Email already exists

---

### POST /api/auth/login
Log in with existing credentials.

**Request:**
```json
{
  "email": "john@example.com",
  "password": "SecurePassword123!"
}
```

**Response:** `200 OK`
```json
{
  "user": {
    "id": 1,
    "name": "John Doe",
    "email": "john@example.com",
    "createdAt": "2026-01-29T10:00:00.000Z"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Errors:**
- `400 Bad Request` - Validation failed
- `401 Unauthorized` - Invalid credentials

---

### GET /api/auth/me
Get information about the authenticated user.

**Headers:**
```
Authorization: Bearer <token>
```

**Response:** `200 OK`
```json
{
  "id": 1,
  "name": "John Doe",
  "email": "john@example.com",
  "createdAt": "2026-01-29T10:00:00.000Z"
}
```

**Errors:**
- `401 Unauthorized` - Invalid or expired token

---

## Forms Endpoints

### GET /api/forms
Get all forms belonging to the authenticated user.

**Headers:**
```
Authorization: Bearer <token>
```

**Response:** `200 OK`
```json
{
  "forms": [
    {
      "id": 1,
      "userId": 1,
      "title": "Contact Form",
      "description": "Customer contact form",
      "pdfUrl": "/uploads/pdf-1234567890.pdf",
      "shareId": "abc123def456",
      "status": "published",
      "settings": {},
      "createdAt": "2026-01-29T10:00:00.000Z",
      "updatedAt": "2026-01-29T10:00:00.000Z",
      "_count": {
        "fields": 5,
        "responses": 12
      }
    }
  ]
}
```

**Errors:**
- `401 Unauthorized` - Not authenticated

---

### POST /api/forms
Create a new form.

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request:**
```json
{
  "title": "Contact Form",
  "description": "Customer contact form",
  "pdfUrl": "/uploads/pdf-1234567890.pdf"
}
```

**Response:** `201 Created`
```json
{
  "form": {
    "id": 1,
    "userId": 1,
    "title": "Contact Form",
    "description": "Customer contact form",
    "pdfUrl": "/uploads/pdf-1234567890.pdf",
    "shareId": "abc123def456",
    "status": "draft",
    "settings": {},
    "createdAt": "2026-01-29T10:00:00.000Z",
    "updatedAt": "2026-01-29T10:00:00.000Z"
  }
}
```

**Errors:**
- `400 Bad Request` - Validation failed
- `401 Unauthorized` - Not authenticated

---

### GET /api/forms/:id
Get a specific form.

**Headers:**
```
Authorization: Bearer <token>
```

**Response:** `200 OK`
```json
{
  "form": {
    "id": 1,
    "userId": 1,
    "title": "Contact Form",
    "description": "Customer contact form",
    "pdfUrl": "/uploads/pdf-1234567890.pdf",
    "shareId": "abc123def456",
    "status": "published",
    "settings": {},
    "createdAt": "2026-01-29T10:00:00.000Z",
    "updatedAt": "2026-01-29T10:00:00.000Z",
    "fields": [
      {
        "id": 1,
        "formId": 1,
        "type": "text",
        "name": "fullName",
        "label": "Full Name",
        "placeholder": "Enter your full name",
        "required": true,
        "x": 100,
        "y": 200,
        "width": 300,
        "height": 40,
        "page": 0,
        "properties": {}
      }
    ]
  }
}
```

**Errors:**
- `401 Unauthorized` - Not authenticated
- `403 Forbidden` - Not the owner of the form
- `404 Not Found` - Form does not exist

---

### PUT /api/forms/:id
Update a form.

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request:**
```json
{
  "title": "Updated Contact Form",
  "description": "Updated description",
  "status": "published",
  "settings": {
    "allowMultipleSubmissions": true
  }
}
```

**Response:** `200 OK`
```json
{
  "form": {
    "id": 1,
    "userId": 1,
    "title": "Updated Contact Form",
    "description": "Updated description",
    "pdfUrl": "/uploads/pdf-1234567890.pdf",
    "shareId": "abc123def456",
    "status": "published",
    "settings": {
      "allowMultipleSubmissions": true
    },
    "createdAt": "2026-01-29T10:00:00.000Z",
    "updatedAt": "2026-01-29T11:00:00.000Z"
  }
}
```

**Errors:**
- `400 Bad Request` - Validation failed
- `401 Unauthorized` - Not authenticated
- `403 Forbidden` - Not the owner of the form
- `404 Not Found` - Form does not exist

---

### PATCH /api/forms/:id/status
Update only the status of a form.

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request:**
```json
{
  "status": "published"
}
```

**Response:** `200 OK`
```json
{
  "form": {
    "id": "uuid-123",
    "status": "published",
    "updatedAt": "2026-02-11T10:00:00.000Z"
  }
}
```

---

### DELETE /api/forms/:id
Delete a form.

**Headers:**
```
Authorization: Bearer <token>
```

**Response:** `200 OK`
```json
{
  "message": "Form deleted successfully"
}
```

**Errors:**
- `401 Unauthorized` - Not authenticated
- `403 Forbidden` - Not the owner of the form
- `404 Not Found` - Form does not exist

---

### GET /api/forms/public/:shareId
Get a public form by its shareId (no authentication required).

**Response:** `200 OK`
```json
{
  "form": {
    "id": 1,
    "title": "Contact Form",
    "description": "Customer contact form",
    "pdfUrl": "/uploads/pdf-1234567890.pdf",
    "status": "published",
    "fields": [...]
  }
}
```

**Errors:**
- `404 Not Found` - Form does not exist or is not published

---

## Fields Endpoints

> Corregido el 2026-08-28: esta sección describía endpoints que nunca existieron (`GET .../fields`, `PUT .../fields/bulk` con semántica de upsert, `DELETE .../fields/bulk`). Lo de abajo está verificado contra `backend/src/routes/form-fields.ts`. No hay endpoint de listado separado: los fields de un form se obtienen embebidos en `GET /api/forms/:id`. Referencia completa y siempre verificada contra el código: [`docs/sot/05-api-reference.md`](./docs/sot/05-api-reference.md).

### POST /api/forms/:formId/fields
Create a single field on a form.

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request:**
```json
{
  "type": "text",
  "name": "fullName",
  "label": "Full Name",
  "required": true,
  "position": { "x": 100, "y": 200, "width": 300, "height": 40, "page": 0 },
  "options": null,
  "validation": { "minLength": 2, "maxLength": 100 },
  "order": 0
}
```
`type` must be one of `text | textarea | checkbox | radio | dropdown`. `options` (array of strings) is used by `radio`/`dropdown`.

**Response:** `201 Created`
```json
{ "field": { "id": "uuid", "formId": "uuid", "type": "text", "name": "fullName", "...": "..." } }
```

---

### PUT /api/forms/:formId/fields/:fieldId
Update a single field. Body is a partial version of the create payload (any subset of the same fields).

**Response:** `200 OK` — `{ "field": { ... } }`

---

### DELETE /api/forms/:formId/fields/:fieldId
Delete a single field.

⚠️ Because of the `onDelete: Cascade` relation from `Answer` to `Field`, deleting a field also deletes every `Answer` already submitted for it. There is no confirmation or undo.

**Response:** `200 OK` — `{ "message": "Field deleted" }`

---

### POST /api/forms/:formId/fields/bulk
Replace **all** fields of a form in one call — this is what the editor calls on every "save".

**Request:**
```json
{
  "fields": [
    { "type": "text", "name": "fullName", "label": "Full Name", "required": true,
      "position": { "x": 100, "y": 200, "width": 300, "height": 40, "page": 0 }, "order": 0 }
  ]
}
```

**Response:** `200 OK` — `{ "fields": [ ... ] }` (newly created, with new `id`s)

**Notes (important, differs from what this doc used to say):**
- This is **not** an upsert. The backend deletes every existing field of the form (`deleteMany`) and recreates the ones sent in the request (`createMany`). Fields not included in the array **are deleted**, not preserved.
- ⚠️ Same cascade risk as the single `DELETE` above, but easier to trigger by accident: saving the editor on a form that already has responses deletes the `Answer` rows tied to the old field `id`s. See `docs/sot/03-backend-patterns.md` for the known-issue writeup and planned fix.
- Also re-embeds the fields as AcroForm into the physical PDF file on disk.

---

## Responses Endpoints

### POST /api/responses
Submit a response to a public form. No authentication required.

**Request:**
```json
{
  "formId": "form-uuid",
  "shareId": "form-share-id",
  "answers": {
    "field-id-1": "Text value",
    "field-id-2": true,
    "field-id-3": "Option 1"
  }
}
```

**Response:** `201 Created`
```json
{
  "success": true,
  "responseId": "response-uuid",
  "message": "Response submitted successfully"
}
```

**Errors:**
- `400 Bad Request` - Validation failed (required fields, invalid format)
- `403 Forbidden` - The form is not published
- `404 Not Found` - Form not found or incorrect shareId

---

## Upload Endpoint

### POST /api/upload
Upload a PDF file.

**Headers:**
```
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

**Request:**
```
POST /api/upload
Content-Type: multipart/form-data

------WebKitFormBoundary...
Content-Disposition: form-data; name="file"; filename="document.pdf"
Content-Type: application/pdf

<binary data>
------WebKitFormBoundary...
```

**Response:** `200 OK`
```json
{
  "fileUrl": "/uploads/pdf-1706524800123-document.pdf",
  "filename": "document.pdf",
  "size": 245678
}
```

**Restrictions:**
- Maximum size: 10MB
- Allowed types: `application/pdf`
- Requires authentication

**Errors:**
- `400 Bad Request` - No file sent or invalid type
- `401 Unauthorized` - Not authenticated
- `413 Payload Too Large` - File too large

---

## Error Responses

All endpoints can return these common errors:

### 400 Bad Request
```json
{
  "error": "Validation error",
  "details": [
    {
      "field": "email",
      "message": "Invalid email format"
    }
  ]
}
```

### 401 Unauthorized
```json
{
  "error": "Authentication required",
  "message": "No token provided"
}
```

### 403 Forbidden
```json
{
  "error": "Access denied",
  "message": "You don't have permission to access this resource"
}
```

### 404 Not Found
```json
{
  "error": "Not found",
  "message": "Resource not found"
}
```

### 500 Internal Server Error
```json
{
  "error": "Internal server error",
  "message": "An unexpected error occurred"
}
```

---

## Rate Limiting

Rate limiting is not currently implemented.
**Planned:** Implement rate limiting with express-rate-limit.

---

## Pagination

Endpoints that return lists (such as GET /api/forms) do not currently support pagination.
**Planned:** Implement pagination using cursor or offset.

Planned format:
```
GET /api/forms?page=1&limit=20
```

Response:
```json
{
  "forms": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

---

## Filtering and Search

Not currently implemented.
**Planned:** Implement filtering and search.

Planned format:
```
GET /api/forms?status=published&search=contact
```

---

## Webhooks

Not currently implemented.
**Planned:** Implement webhooks to notify of new responses.

---

## API Versioning

Current version: `v1` (implicit in `/api/*`)

Future versions will use:
```
/api/v2/forms
```

---

## Usage Examples with cURL

### Register
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe",
    "email": "john@example.com",
    "password": "SecurePassword123!"
  }'
```

### Login
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@example.com",
    "password": "SecurePassword123!"
  }'
```

### Get Forms
```bash
curl http://localhost:3000/api/forms \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

### Upload PDF
```bash
curl -X POST http://localhost:3000/api/upload \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -F "file=@/path/to/document.pdf"
```

---

## Usage Examples with Axios (Frontend)

### Client Setup
```typescript
import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Interceptor to attach the token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});
```

### Register
```typescript
const response = await api.post('/auth/register', {
  name: 'John Doe',
  email: 'john@example.com',
  password: 'SecurePassword123!',
});

const { user, token } = response.data;
localStorage.setItem('token', token);
```

### Get Forms
```typescript
const response = await api.get('/forms');
const { forms } = response.data;
```

### Upload with Progress
```typescript
const formData = new FormData();
formData.append('file', file);

const response = await api.post('/upload', formData, {
  headers: { 'Content-Type': 'multipart/form-data' },
  onUploadProgress: (progressEvent) => {
    const progress = (progressEvent.loaded / progressEvent.total) * 100;
    console.log(`Upload: ${progress}%`);
  },
});

const { fileUrl } = response.data;
```

---

## Database Schema

See the full schema in [`backend/prisma/schema.prisma`](backend/prisma/schema.prisma).

### Main Models:

```prisma
model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique
  name      String
  password  String
  forms     Form[]
  createdAt DateTime @default(now())
}

model Form {
  id          Int       @id @default(autoincrement())
  userId      Int
  user        User      @relation(fields: [userId], references: [id])
  title       String
  description String?
  pdfUrl      String
  shareId     String    @unique
  status      String    @default("draft")
  settings    Json?
  fields      Field[]
  responses   Response[]
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
}

model Field {
  id          Int     @id @default(autoincrement())
  formId      Int
  form        Form    @relation(fields: [formId], references: [id])
  type        String
  name        String
  label       String?
  placeholder String?
  required    Boolean @default(false)
  x           Float
  y           Float
  width       Float
  height      Float
  page        Int
  properties  Json?
}

model Response {
  id        Int      @id @default(autoincrement())
  formId    Int
  form      Form     @relation(fields: [formId], references: [id])
  data      Json
  createdAt DateTime @default(now())
}
```

---

**Last updated:** 2026-01-29
**API Version:** v1
**Base URL:** http://localhost:3000/api
