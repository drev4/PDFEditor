---
name: prisma-schema-migration
description: Cambiar backend/prisma/schema.prisma de forma segura (nuevo modelo, nuevo campo, cambio de relación) y mantener sincronizado el resto del stack (rutas, schemas Zod, tipos del frontend, docs/sot). Usar para cualquier tarea del bloque SaaS objetivo (Organization, Plan, Subscription) o cualquier cambio de modelo de datos.
---

# Cambiar el schema de Prisma sin romper nada alrededor

El dominio actual es `User → Form → Field → Response → Answer` (ver `docs/sot/02-architecture-and-domain.md`). Varios cambios de schema ya están planeados y descritos en `docs/sot/06-saas-target-architecture.md` (añadir `Organization`, `Membership`, `Plan`, `Subscription`). Esta skill cubre cómo ejecutarlos sin dejar cabos sueltos.

## Antes de tocar el schema

1. Lee `docs/sot/02-architecture-and-domain.md` para entender qué asume el código actual sobre el modelo que vas a tocar (ej.: hoy todo el código de ownership asume `Form.userId`; si migras a `Form.organizationId`, cada sitio que hace `where: { userId: req.userId }` sobre `Form` tiene que revisarse, no solo el modelo).
2. Comprueba las relaciones `onDelete` existentes antes de añadir una nueva — ya hay un caso conocido de `onDelete: Cascade` mal pensado (`Answer.field`, ver `docs/sot/03-backend-patterns.md`, riesgo de pérdida de datos en `bulkSave`). No repitas ese patrón: para cualquier relación nueva pregúntate explícitamente qué debe pasar con los datos hijos cuando se borra el padre, no dejes `Cascade` por defecto sin pensarlo.
3. Si el cambio afecta a un modelo que ya tiene datos reales en la base (no solo en desarrollo), planea la migración de datos (no solo el `migrate dev`) — ej. la migración de `Form.userId` a `Form.organizationId` necesita crear una `Organization` personal por cada `User` existente, descrito en `docs/sot/06-saas-target-architecture.md`.

## Al ejecutar el cambio

1. Edita `backend/prisma/schema.prisma`.
2. Genera la migración: `cd backend && npx prisma migrate dev --name <nombre_descriptivo>`.
3. Actualiza todos los sitios que Prisma tipará distinto ahora — `npx tsc --noEmit` en `backend/` para encontrarlos todos de una vez en vez de uno a uno en runtime.
4. Actualiza los schemas Zod en `backend/src/routes/*.ts` que validan el modelo cambiado.
5. Si el modelo se expone en algún endpoint, actualiza el tipo correspondiente en `frontend/src/services/*.ts`.
6. Actualiza los tests en `backend/tests/` que mockean ese modelo (`mockDeep<PrismaClient>()` con `vitest-mock-extended` — buscar el modelo en los mocks existentes de `backend/tests/*.spec.ts`).
7. Aplica la skill `sot-sync`: actualiza `docs/sot/02-architecture-and-domain.md` con el modelo real, y si el cambio completa una pieza descrita en `docs/sot/06-saas-target-architecture.md`, muévela de "target" a "implementado".

## Qué NO hacer

- No usar `prisma db push` en nada que no sea un entorno local desechable — pierde el historial de migraciones que sí necesita `migrate dev`.
- No añadir campos "por si acaso" a un modelo nuevo (ej. no añadir `metadata: Json?` especulativo a `Organization` si nada lo va a usar todavía) — el propio `Form.settings: Json?` ya es un hueco sin usar en el schema actual; no lo dupliques en cada modelo nuevo.
