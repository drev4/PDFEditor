# 📡 API Documentation - VuePDF Forms Platform

Base URL: `http://localhost:3000/api`

## 🔐 Autenticación

Todos los endpoints protegidos requieren un token JWT en el header:
```
Authorization: Bearer <token>
```

---

## Auth Endpoints

### POST /api/auth/register
Registrar un nuevo usuario.

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

**Errores:**
- `400 Bad Request` - Validación falló
- `409 Conflict` - Email ya existe

---

### POST /api/auth/login
Iniciar sesión con credenciales existentes.

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

**Errores:**
- `400 Bad Request` - Validación falló
- `401 Unauthorized` - Credenciales inválidas

---

### GET /api/auth/me
Obtener información del usuario autenticado.

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

**Errores:**
- `401 Unauthorized` - Token inválido o expirado

---

## Forms Endpoints

### GET /api/forms
Obtener todos los formularios del usuario autenticado.

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

**Errores:**
- `401 Unauthorized` - No autenticado

---

### POST /api/forms
Crear un nuevo formulario.

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

**Errores:**
- `400 Bad Request` - Validación falló
- `401 Unauthorized` - No autenticado

---

### GET /api/forms/:id
Obtener un formulario específico.

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

**Errores:**
- `401 Unauthorized` - No autenticado
- `403 Forbidden` - No es dueño del formulario
- `404 Not Found` - Formulario no existe

---

### PUT /api/forms/:id
Actualizar un formulario.

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

**Errores:**
- `400 Bad Request` - Validación falló
- `401 Unauthorized` - No autenticado
- `403 Forbidden` - No es dueño del formulario
- `404 Not Found` - Formulario no existe

---

### DELETE /api/forms/:id
Eliminar un formulario.

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

**Errores:**
- `401 Unauthorized` - No autenticado
- `403 Forbidden` - No es dueño del formulario
- `404 Not Found` - Formulario no existe

---

### GET /api/forms/public/:shareId
Obtener un formulario público por su shareId (sin autenticación).

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

**Errores:**
- `404 Not Found` - Formulario no existe o no está publicado

---

## Fields Endpoints

### GET /api/forms/:id/fields
Obtener todos los campos de un formulario.

**Headers:**
```
Authorization: Bearer <token>
```

**Response:** `200 OK`
```json
{
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
```

---

### PUT /api/forms/:id/fields/bulk
Actualizar o crear múltiples campos a la vez (operación bulk).

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request:**
```json
{
  "fields": [
    {
      "id": 1,
      "type": "text",
      "name": "fullName",
      "label": "Full Name",
      "required": true,
      "x": 100,
      "y": 200,
      "width": 300,
      "height": 40,
      "page": 0
    },
    {
      "type": "email",
      "name": "email",
      "label": "Email Address",
      "required": true,
      "x": 100,
      "y": 260,
      "width": 300,
      "height": 40,
      "page": 0
    }
  ]
}
```

**Response:** `200 OK`
```json
{
  "fields": [
    {
      "id": 1,
      "formId": 1,
      "type": "text",
      "name": "fullName",
      ...
    },
    {
      "id": 2,
      "formId": 1,
      "type": "email",
      "name": "email",
      ...
    }
  ]
}
```

**Notas:**
- Si el campo tiene `id`, se actualiza
- Si no tiene `id`, se crea nuevo
- Los campos existentes que no estén en el array NO se eliminan

---

### DELETE /api/forms/:id/fields/bulk
Eliminar múltiples campos a la vez.

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request:**
```json
{
  "fieldIds": [1, 2, 3]
}
```

**Response:** `200 OK`
```json
{
  "message": "3 fields deleted successfully"
}
```

---

## Upload Endpoint

### POST /api/upload
Subir un archivo PDF.

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

**Restricciones:**
- Tamaño máximo: 10MB
- Tipos permitidos: `application/pdf`
- Requiere autenticación

**Errores:**
- `400 Bad Request` - No se envió archivo o tipo inválido
- `401 Unauthorized` - No autenticado
- `413 Payload Too Large` - Archivo muy grande

---

## Error Responses

Todos los endpoints pueden retornar estos errores comunes:

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

Actualmente no hay rate limiting implementado.
**TODO Sprint 4:** Implementar rate limiting con express-rate-limit.

---

## Paginación

Los endpoints que retornan listas (como GET /api/forms) actualmente no tienen paginación.
**TODO Sprint 4:** Implementar paginación con cursor o offset.

Formato planeado:
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

## Filtros y Búsqueda

Actualmente no implementados.
**TODO Sprint 4:** Implementar filtros y búsqueda.

Formato planeado:
```
GET /api/forms?status=published&search=contact
```

---

## Webhooks

No implementados actualmente.
**TODO Sprint 5:** Implementar webhooks para notificar de nuevas respuestas.

---

## Versionado de API

Versión actual: `v1` (implícito en `/api/*`)

En futuras versiones se usará:
```
/api/v2/forms
```

---

## Ejemplos de Uso con cURL

### Registro
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

### Obtener Formularios
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

## Ejemplos de Uso con Axios (Frontend)

### Setup Cliente
```typescript
import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Interceptor para agregar token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});
```

### Registro
```typescript
const response = await api.post('/auth/register', {
  name: 'John Doe',
  email: 'john@example.com',
  password: 'SecurePassword123!',
});

const { user, token } = response.data;
localStorage.setItem('token', token);
```

### Obtener Formularios
```typescript
const response = await api.get('/forms');
const { forms } = response.data;
```

### Upload con Progress
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

Ver el schema completo en [`backend/prisma/schema.prisma`](backend/prisma/schema.prisma).

### Modelos Principales:

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

**Última actualización:** 2026-01-29
**Versión API:** v1
**Base URL:** http://localhost:3000/api
