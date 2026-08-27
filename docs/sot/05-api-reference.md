# Referencia de API (canónica, verificada contra el código)

Base URL: `${VITE_API_URL}` en frontend, por defecto `http://localhost:3000/api`.

Esta referencia sustituye a la de `API_DOCUMENTATION.md`, que describía endpoints de fields que nunca existieron (`GET .../fields`, `PUT .../fields/bulk`, `DELETE .../fields/bulk`). Verificado línea a línea contra `backend/src/app.ts` (montaje de routers) y cada fichero en `backend/src/routes/` el 2026-08-28.

Montaje de routers (`app.ts`):
```
/api/auth       -> authRouter
/api/forms      -> formsRouter
/api/forms      -> formFieldsRouter   (mismo prefijo que formsRouter)
/api/upload     -> uploadRouter
/api/responses  -> responsesRouter
```

## Auth (`/api/auth`) — `routes/auth.ts`

| Método | Ruta | Auth | Body | Respuesta |
|---|---|---|---|---|
| POST | `/register` | No | `{email, password (min 6), name?}` | `201 {user, token}` — `400` si email ya existe o validación falla |
| POST | `/login` | No | `{email, password}` | `200 {user, token}` — `401` credenciales inválidas |
| GET | `/me` | Bearer | — | `200 {user}` — `401` sin token/token inválido |

`token` es un JWT firmado con `JWT_SECRET`, expira según `JWT_EXPIRES_IN` (default `7d`).

## Forms (`/api/forms`) — `routes/forms.ts`

| Método | Ruta | Auth | Notas |
|---|---|---|---|
| GET | `/` | Bearer | Lista forms del usuario, incluye `_count.fields` y `_count.responses` |
| POST | `/` | Bearer | Body `{title, description?, pdfUrl?}`. Genera `shareId` con `nanoid(12)` |
| GET | `/:id` | Bearer, ownership | Incluye `fields` ordenados. **Efecto secundario:** si `pdfUrl` existe y no hay `fields` en BD, intenta extraer y sincronizar campos del PDF físico antes de responder (`syncFieldsFromPDF`) |
| PUT | `/:id` | Bearer, ownership | Body parcial `{title?, description?, status?, pdfUrl?, settings?}` |
| PATCH | `/:id/status` | Bearer, ownership | Body `{status: 'draft'\|'published'\|'closed'}` |
| DELETE | `/:id` | Bearer, ownership | Cascada: borra fields y responses del form |
| GET | `/public/:shareId` | No | Solo si `status === 'published'`; incrementa `viewCount`; **nunca** incluye `userId` en la respuesta |
| GET | `/:id/responses` | Bearer, ownership | Query `limit`, `offset` (paginación). Responde `{responses, pagination: {total, limit, offset}}` |
| GET | `/:id/responses/export` | Bearer, ownership | Descarga CSV (`Content-Disposition: attachment`), generado por `csv-exporter.ts`, BOM UTF-8 |

"Ownership" = `verifyFormOwnership` (middleware/formOwnership.ts): 404 (no 403) si el form no existe o no es del usuario autenticado.

## Fields (`/api/forms/:formId/fields`) — `routes/form-fields.ts`

No existe un `GET` de listado de fields por separado — se obtienen embebidos en `GET /api/forms/:id`.

| Método | Ruta | Auth | Notas |
|---|---|---|---|
| POST | `/:formId/fields` | Bearer, ownership | Crea un campo. Body validado por `createFieldSchema` (ver tipos abajo) |
| PUT | `/:formId/fields/:fieldId` | Bearer, field ownership | Body parcial (`.partial()` del schema de creación) |
| DELETE | `/:formId/fields/:fieldId` | Bearer, field ownership | ⚠️ Borra en cascada las `Answer` de respuestas ya recibidas para ese campo (ver `03-backend-patterns.md`, riesgo de pérdida de datos) |
| POST | `/:formId/fields/bulk` | Bearer, ownership | Body `{fields: CreateFieldData[]}`. **Reemplaza todos los campos del form** (`deleteMany` + `createMany`) y reembebe el AcroForm en el PDF físico. Mismo riesgo de pérdida de datos que el DELETE individual, mucho más fácil de disparar por accidente porque es el guardado normal del editor |

Tipo `CreateFieldData` (igual en frontend `services/fields.ts` y backend `createFieldSchema`):
```ts
{
  type: 'text' | 'textarea' | 'checkbox' | 'radio' | 'dropdown',
  name: string,           // max 255
  label: string,          // max 255
  required: boolean,      // default false
  position: { x: number, y: number, width: number, height: number, page: number },
  options?: string[],     // para radio/dropdown
  validation?: { minLength?: number, maxLength?: number, pattern?: string },
  order: number           // default 0
}
```

## Responses (`/api/responses`) — `routes/responses.ts`

| Método | Ruta | Auth | Notas |
|---|---|---|---|
| POST | `/` | No (público) | Body `{formId (uuid), shareId, answers: Record<fieldId, value>}` |

Validaciones aplicadas en orden antes de persistir: (1) form existe y `shareId` coincide, (2) `status === 'published'` (si no, `403`), (3) todos los `required` presentes y no vacíos, (4) valor coherente con `type` del campo (`checkbox` debe ser boolean; `radio`/`dropdown` deben estar en `options`; `text`/`textarea` deben cumplir `minLength`/`maxLength`/`pattern` si están definidos), (5) se descartan silenciosamente (con `console.warn`) answers cuyo `fieldId` no pertenece al form. Guarda `ipAddress`/`userAgent` de la petición.

## Upload (`/api/upload`) — `routes/upload.ts`

| Método | Ruta | Auth | Notas |
|---|---|---|---|
| POST | `/` | Bearer | Multipart, campo `pdf` (Multer, límite y tipo validados también en frontend antes de enviar). Valida que sea un PDF real (`pdfProcessor.validatePDF`, `400` si es inválido o está corrupto). Best-effort: intenta `extractFieldsFromPDF` — si falla, continúa sin campos (`console.warn`, no bloquea la subida) |

Respuesta: `201 {url, filename, size, fields: ExtractedField[]}`. El array `fields` puede venir vacío si el PDF no tenía AcroForm o la extracción falló — el frontend (`useFormManagement.uploadPDF`) lo trata como opcional.

## Errores — formato uniforme (`middleware/errorHandler.ts`)

```
400 Bad Request           { error: "Validation error", details: [...] }   // ZodError
401 Unauthorized          { error: "..." }                                 // AppError
403 Forbidden             { error: "..." }                                 // AppError
404 Not Found             { error: "..." }                                 // AppError
500 Internal Server Error { error: "Internal server error" }               // nunca filtra el mensaje real
```
