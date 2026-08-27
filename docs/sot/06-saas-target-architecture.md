# Arquitectura SaaS objetivo — `[TARGET — no implementado]`

Todo en este documento es visión, no código existente. Su función es guiar el diseño de próximas features (ver `docs/NEXT_TASKS.md` y `features/`) para que cada pieza que se construya encaje con las siguientes, en vez de tener que rehacerse cuando llegue la B2B.

## Decisión estructural: `Organization` como dueño real de los recursos

Hoy `Form.userId` apunta directamente a `User`. Para soportar B2B (varios usuarios de una empresa compartiendo formularios) sin bifurcar el modelo de datos entre "cuentas personales" y "cuentas de equipo", el patrón recomendado es que **todo recurso facturable pertenezca a una `Organization`**, y que una cuenta B2C sea simplemente una `Organization` de un solo miembro creada automáticamente al registrarse.

```
Organization 1───* Membership *───1 User
Organization 1───* Form  (en vez de User 1───* Form)
Organization 1───1 Subscription 1───1 Plan
```

Esto evita el problema clásico de "migrar cuentas personales a equipos después" — Slack, Notion y Linear usan esta forma exactamente para no tener ese problema.

### Nuevas entidades propuestas

- **Organization**: `id, name, slug (para URLs/branding), createdAt`.
- **Membership**: `organizationId, userId, role`. `role` mínimo viable: `owner | admin | member`. `owner` puede facturar y borrar la organización; `admin` gestiona formularios y miembros; `member` solo gestiona sus propios formularios.
- **Plan**: catálogo estático (`free | pro | team`), con límites (`maxForms`, `maxResponsesPerMonth`, `hasBranding: boolean`, `hasApiAccess: boolean`) — puede vivir en código (constante) en vez de tabla mientras haya pocos planes; pasar a tabla el día que haya planes custom por cliente.
- **Subscription**: `organizationId, planId, stripeCustomerId, stripeSubscriptionId, status, currentPeriodEnd`. Es la única entidad que debería tocar el proveedor de pagos (Stripe) — nada en `routes/forms.ts` debería importar nada de Stripe.

### Migración desde el modelo actual

`Form.userId` → `Form.organizationId`, con un `Membership` implícito de cada `User` existente a una `Organization` personal creada en la propia migración de datos (no rompe compatibilidad con los datos actuales, cada usuario existente se convierte en dueño único de su propia organización).

## Entitlements: dónde se comprueban los límites de plan

Igual que `ownership` es una función componible llamada explícitamente dentro de cada handler (ver `03-backend-patterns.md`), los límites de plan deberían serlo también — **no** un middleware genérico que intercepte todas las rutas, porque cada recurso tiene un límite distinto (nº de forms, nº de respuestas/mes, acceso a API):

```ts
// Ejemplo de la forma, no código final
async function assertCanCreateForm(organizationId: string) {
  const { plan, usage } = await getEntitlements(organizationId)
  if (usage.formsCount >= plan.maxForms) {
    throw new AppError(402, 'Plan limit reached: forms')
  }
}
```

`402 Payment Required` como código de estado para "límite de plan alcanzado" (distinto de `403 Forbidden`, que es "no tienes permiso" — son dos motivos de rechazo diferentes y el frontend debe poder distinguirlos para mostrar "actualiza tu plan" vs. "no tienes acceso").

## Roles y permisos

Mínimo viable descrito arriba (`owner/admin/member`). No añadir un sistema de permisos granular tipo RBAC-por-recurso hasta que un cliente B2B real lo pida — es la clase de complejidad que es barata de añadir después y cara de mantener sin uso real.

## API pública para integraciones B2B

Vender a B2B eventualmente implica que un cliente quiera consumir respuestas por API (webhooks a su CRM, exportación automática) en vez de solo por el dashboard. Prerrequisitos que ya están identificados como deuda técnica y que bloquean esto:
- `fieldId` estable entre guardados (ver riesgo de `bulkSave` en `03-backend-patterns.md`) — una integración externa que referencia un `fieldId` no puede sobrevivir a que el usuario edite el formulario en el editor.
- Rate limiting (ya señalado como pendiente en `03-backend-patterns.md`).
- Autenticación de servidor a servidor: API keys por organización (tabla `ApiKey: organizationId, hashedKey, scopes, lastUsedAt`), no JWT de usuario — un JWT de usuario expira y no está pensado para procesos no interactivos.

## White-labeling (B2B)

Quitar la marca "hecho con VuePDF" del formulario público es un feature de plan (`Plan.hasBranding`), no una opción de usuario — coherente con el modelo de negocio del documento 01. Dominio propio para el link público (`forms.tuempresa.com` en vez de `vuepdf.app/f/:shareId`) es la siguiente capa de white-labeling, bastante más cara de construir (certificados TLS por dominio, verificación de propiedad) — no priorizar hasta validar demanda real.

## Orden de construcción recomendado

No es una fecha, es una dependencia lógica — cada paso desbloquea el siguiente:

1. **Fix del riesgo de pérdida de datos en `bulkSave`** (correctness, no SaaS — pero bloquea la confianza para vender esto en serio).
2. **`Organization` + `Membership`** con migración de datos, sin cambiar aún el comportamiento visible (toda `Organization` sigue teniendo un solo miembro).
3. **Invitar miembros a una `Organization`** (esto es lo primero que hace que "B2B" sea real y no solo una tabla vacía).
4. **`Plan` + entitlements** (límites, sin cobro real todavía — permite validar la UX de "límite alcanzado" antes de meter Stripe).
5. **Stripe + `Subscription`** (cobro real).
6. **API pública + API keys** (una vez el `fieldId` es estable).
