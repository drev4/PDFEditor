# Próximas tareas

Backlog vivo del proyecto. Cuando una tarea pasa de aquí a "en construcción", se le crea un fichero en [`features/`](../features/README.md) con su prompt de ejecución, y se enlaza desde su fila. Prioridad = impacto en poder vender esto como SaaS de forma segura, no orden de aparición.

Contexto y razonamiento detrás de cada bloque en [`docs/sot/`](./sot/README.md) — en particular [`06-saas-target-architecture.md`](./sot/06-saas-target-architecture.md) para el orden de construcción del bloque SaaS.

## P0 — Correctness, bloquea vender esto en serio

| Tarea | Por qué | Detalle |
|---|---|---|
| Fix pérdida de datos en guardado de fields (`bulkSave`) | Editar campos de un form con respuestas ya recibidas borra esas respuestas en cascada, sin aviso | [`docs/sot/03-backend-patterns.md`](./sot/03-backend-patterns.md) (sección "Riesgo de pérdida de datos"), fichero de ejecución: [`features/0001-fix-bulk-save-data-loss.md`](../features/0001-fix-bulk-save-data-loss.md) |
| Añadir tests de backend que cubran ese escenario (guardar fields con responses existentes) | Hoy no hay test que lo detecte — así fue como pasó desapercibido | — |

## P1 — Fundamentos SaaS (B2B/B2C)

| Tarea | Por qué |
|---|---|
| Modelo `Organization` + `Membership`, migrar `Form.userId` → `Form.organizationId` | Prerrequisito de todo lo demás — ver orden de construcción en `06-saas-target-architecture.md` |
| Invitar/gestionar miembros de una organización | Primer feature que hace la B2B real |
| `Plan` + capa de entitlements (límites de forms/respuestas por plan) | Permite validar UX de límites antes de meter cobro real |
| Integración de facturación (Stripe) + `Subscription` | Habilita monetización real |
| `fieldId` estable entre guardados (upsert diferencial en vez de `deleteMany`+`createMany`) | Prerrequisito de API pública/webhooks; también resuelve parte del P0 |
| API pública con API keys por organización | Vender a B2B con integraciones (CRM, webhooks) |

## P2 — Deuda técnica y gaps detectados (no bloqueantes, pero reales)

| Tarea | Detalle |
|---|---|
| Configurar lint (ESLint flat config) en frontend y backend | Hoy `npm run lint` no hace nada — ni hay config ni scripts `lint` en los workspaces. Ver `docs/sot/07-conventions.md` |
| Añadir `.env.example` en `backend/` y `frontend/` | El README documenta las variables pero no hay plantilla en el repo |
| Rate limiting en `POST /api/auth/login` y `POST /api/responses` | Únicos endpoints públicos sin límite alguno hoy |
| Logging estructurado (pino) en vez de `console.log`/`console.error` | Necesario para dar soporte a clientes B2B; hoy los fallos silenciosos de post-proceso de PDF solo van a consola |
| Mover uploads de disco local a S3/R2 | Bloqueante para desplegar en más de una instancia |
| Cola de trabajo (BullMQ+Redis) para extracción/embebido de PDF | Hoy son síncronas dentro del request; riesgo de timeout con PDFs grandes |
| Resolver ramas de idioma mezcladas en UI (placeholders en español dentro de una app en inglés) | Real si el producto se vende internacionalmente; ver `docs/sot/07-conventions.md` |
| Escaneo de virus en uploads (ClamAV) | Mencionado como "future" desde 2024, nunca implementado |
| Caché Redis / CDN para PDFs | Mismo caso — mencionado como "future", nunca implementado |

## Housekeeping de repo (detectado en la revisión de ramas del 2026-08-27)

| Tarea | Detalle |
|---|---|
| Decidir sobre `origin/feature/sprint-3-public-forms` | Ya está mergeada a `main` vía PR #3, sigue viva en remoto sin usarse. Pendiente de decisión del usuario: borrarla o dejarla como histórico. |
| Verificar que la suite completa pasa en verde | `node_modules` no estaba instalado al revisar (2026-08-27) — no se pudo correr `npm run test:all` para confirmar estado real de los tests |
