# Patrones de backend (con ejemplos reales del repo)

## 1. Validación en el borde con Zod + `safeParse`

Todo endpoint que recibe body valida con un schema Zod definido junto a la ruta (no en un fichero central de "schemas" — no existe tal fichero) y responde `400` con `validation.error.errors` si falla. Patrón repetido en `auth.ts`, `forms.ts`, `form-fields.ts`, `responses.ts`:

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

Para "actualizar", el schema de creación se reutiliza con `.partial()` en vez de duplicar campos (`form-fields.ts`: `const updateFieldSchema = createFieldSchema.partial()`). Seguir este patrón al añadir endpoints nuevos, no inventar uno paralelo.

## 2. Autenticación y ownership como funciones componibles, no como capas rígidas

`middleware/auth.ts` solo decodifica el JWT y cuelga `req.userId`:

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

La comprobación de **ownership** (¿este form es del usuario autenticado?) es una función aparte, no un middleware de Express — se llama explícitamente dentro del handler, porque necesita el `id` de la ruta que solo se conoce dentro del handler:

```ts
// middleware/formOwnership.ts
export async function verifyFormOwnership(req: AuthRequest, formId: string) {
  const form = await prisma.form.findFirst({ where: { id: formId, userId: req.userId } })
  if (!form) throw new AppError(404, 'Form not found')  // 404, no 403 — no revela que el form existe
  return form
}
```

Nota deliberada: devuelve `404` y no `403` cuando el form existe pero no es del usuario — evita filtrar existencia de recursos ajenos. Mantener esto al añadir nuevos recursos con ownership (ej. futuros `Organization`).

## 3. Errores: una clase, un middleware, un formato

`AppError extends Error` con `statusCode` + `message`. Un único `errorHandler` al final del middleware chain distingue `AppError` (respeta su código), `ZodError` (400 con `details`), y todo lo demás (500 genérico, sin filtrar el mensaje interno al cliente). Todas las rutas hacen `catch (error) { next(error) }` — nunca formatean el error ellas mismas. Mantener esta disciplina: si una ruta empieza a hacer `res.status(...).json(...)` en un catch en vez de `next(error)`, es una señal de que se está rompiendo el patrón.

## 4. Servicios como clases con estado mínimo, no funciones sueltas cuando hay configuración

`PDFProcessor` (`services/pdf-processor.ts`) es una clase con constantes internas (`DEFAULT_SCALE = 1.5`) y métodos públicos (`validatePDF`, `extractFieldsFromPDF`, `embedFieldsInPDF`), instanciada una vez y exportada (`export const pdfProcessor = new PDFProcessor()`). Este es el patrón a seguir para cualquier servicio con lógica no trivial (ej. un futuro `BillingService`), en vez de un objeto literal con funciones sueltas como se hace en `csv-exporter.ts` (que es correcto ahí porque es una función pura sin estado).

## 5. Efectos secundarios sobre el PDF físico, explícitos y best-effort

Dos operaciones tocan el archivo PDF en disco directamente (no solo la base de datos), y ambas están diseñadas para **no romper la petición si fallan**:

- Al leer un form (`GET /:id`) que tiene `pdfUrl` pero 0 campos en BD, se intenta re-sincronizar extrayendo campos del PDF (`syncFieldsFromPDF` en `forms.ts`) — envuelto en `try/catch` que solo hace `console.error`, nunca lanza.
- Al guardar campos en bulk, se reescribe el PDF en disco embebiendo los campos como AcroForm (`embedFieldsInPDF` en `form-fields.ts`) — mismo patrón: `try/catch` que loguea y continúa.

Esto es correcto para UX (el usuario no debería ver un 500 porque el post-proceso del PDF falló) pero es una brecha de observabilidad: hoy esos fallos solo van a `console.error`/`console.warn`, sin métricas ni alertas. Al introducir logging estructurado (ver sección 6), estos son los primeros puntos a instrumentar.

## ✅ Riesgo de pérdida de datos en `bulkSave` de campos — resuelto

`POST /:formId/fields/bulk` (`form-fields.ts`) diferencia ahora dos casos según `prisma.response.count({ where: { formId } })`:

- **Form sin respuestas**: se mantiene el comportamiento original, `prisma.field.deleteMany` + `prisma.field.createMany` — no hay nada que perder.
- **Form con al menos una respuesta**: en vez de borrar y recrear, el endpoint hace upsert por `id` dentro de `prisma.$transaction(...)`: los campos del payload con `id` existente se `update`an in-place, los que no tienen `id` (o su `id` ya no existe en BD) se `create`an, y los campos que existían en BD pero ya no vienen en el payload solo se `delete`an si no tienen ninguna `Answer` asociada (`prisma.answer.count`). Si un campo "eliminado" por el usuario en el editor sí tiene respuestas ya recibidas, **no se borra** — se conserva y su `id` se devuelve en un array `preserved: string[]` en la respuesta JSON, para que el frontend pueda avisar de que ese campo no se pudo eliminar por tener datos asociados.

El schema Zod del body de `bulk` (`bulkFieldSchema`) añade `id: z.string().uuid().optional()` solo para este endpoint; `createFieldSchema` (usado por el `POST` individual) sigue sin aceptar `id` del cliente. Tests en `backend/tests/fields.spec.ts` (`describe('POST /api/forms/:formId/fields/bulk', ...)`) cubren los cuatro escenarios: sin respuestas, update in-place, preservación de campo con respuestas, y creación de campo nuevo. El `DELETE /:formId/fields/:fieldId` individual sigue teniendo cascada directa — es un borrado explícito de un campo concreto, decisión consciente del usuario, y queda fuera de este fix (ver `features/0001-fix-bulk-save-data-loss.md`).

## 6. Tecnologías avanzadas a incorporar (backend)

No son parte del código hoy — son la dirección recomendada, priorizada por impacto en el objetivo SaaS:

1. **Logging estructurado (pino) + tracing (OpenTelemetry)** — hoy todo es `console.log`/`console.error` sin correlación de request. Bloqueante para dar soporte serio a clientes B2B.
2. **Cola de trabajo (BullMQ + Redis)** para `extractFieldsFromPDF`/`embedFieldsInPDF` — hoy son síncronas dentro del request; con PDFs grandes o AcroForms complejos esto es un cuello de botella y un riesgo de timeout.
3. **Storage en S3/R2 en vez de disco local (`Multer` a disco)** — bloqueante para desplegar en más de una instancia; hoy el PDF vive en el filesystem del proceso Express.
4. **Rate limiting (`express-rate-limit` o equivalente en gateway)** en `POST /api/responses` (público, sin auth) y `POST /api/auth/login` — hoy no hay ningún límite, son los dos endpoints más expuestos a abuso.
5. **Zod como contrato compartido**: generar el tipo del cliente HTTP del frontend a partir de los mismos schemas Zod del backend (ej. con `zod-to-ts` o moviendo los schemas a un paquete compartido en el workspace) para que el desfase que hubo entre `API_DOCUMENTATION.md` y las rutas reales no pueda volver a pasar silenciosamente.
6. **IDs de campo estables** — más allá del fix de correctness ya señalado arriba, un `fieldId` que sobrevive a los guardados es un prerrequisito para cualquier integración externa (API pública B2B, webhooks) que necesite referenciar un campo concreto de forma persistente.
