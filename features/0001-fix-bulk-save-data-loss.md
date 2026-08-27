# 0001 — Fix pérdida de datos en el guardado de campos (`bulkSave`)

**Estado:** hecho
**Rama:** feature/0001-fix-bulk-save-data-loss
**Prioridad:** P0 (ver `docs/NEXT_TASKS.md`)
**Relacionado:** [`docs/sot/03-backend-patterns.md`](../docs/sot/03-backend-patterns.md) (sección "Riesgo de pérdida de datos"), [`docs/sot/05-api-reference.md`](../docs/sot/05-api-reference.md)

## Contexto

`POST /api/forms/:formId/fields/bulk` (`backend/src/routes/form-fields.ts`) implementa el guardado del editor como `prisma.field.deleteMany({ where: { formId } })` seguido de `prisma.field.createMany(...)`. El schema de Prisma define `Answer.field` con `onDelete: Cascade`. Consecuencia real: si un formulario ya tiene respuestas y su dueño edita los campos desde el editor (el flujo normal de "guardar"), todas las `Answer` de las respuestas ya recibidas se borran en cascada al borrarse los `Field` antiguos — sin aviso, sin confirmación, sin backup. El `Response` sobrevive pero queda vacío de contestaciones. Es un bug de correctness que además bloquea poder vender el producto con confianza.

No hay ningún test hoy que cubra "guardar fields en un form que ya tiene responses" — así pasó desapercibido.

## Objetivo

- Guardar campos desde el editor (`bulk`) **nunca** debe borrar `Answer` de respuestas ya existentes.
- Si el form no tiene respuestas todavía, el comportamiento actual (reemplazar todos los campos) puede mantenerse tal cual — no hay nada que perder.
- Si el form ya tiene respuestas, los campos que sigan existiendo (mismo `id`) deben actualizarse in-place (no borrarse y recrearse); los campos nuevos se crean; los campos eliminados por el usuario solo pueden borrarse si ninguna `Answer` los referencia — si alguna respuesta los referencia, decidir (documentarlo en el PR) entre: (a) rechazar el borrado de ese campo con un error claro, o (b) permitirlo y dejar que la `Answer` huérfana se borre en cascada solo para ese campo puntual, nunca para el form entero. Priorizar la opción que sea menos sorprendente para el usuario del editor.
- Añadir test(s) en `backend/tests/fields.spec.ts` (sigue el patrón ya usado ahí: `vi.mock` de `../src/services/db` con `mockDeep<PrismaClient>()`, mock de `authenticate`) que reproduzcan el escenario: form con responses existentes → bulk save con campos distintos → verificar que las `Answer` de responses previas no desaparecen.
- No tocar el endpoint `DELETE /:formId/fields/:fieldId` individual en este trabajo — ese es un borrado explícito de un campo concreto y su comportamiento cascada, aunque también arriesgado, es una decisión consciente del usuario, no un efecto secundario de "guardar". Si se quiere abordar también, que sea como tarea aparte.

## Prompt de ejecución

> Lee `backend/src/routes/form-fields.ts` (función `formFieldsRouter.post('/:formId/fields/bulk', ...)`) y `backend/prisma/schema.prisma` (modelos `Field` y `Answer`, relación `onDelete: Cascade`).
>
> Problema: ese endpoint hace `prisma.field.deleteMany({ where: { formId } })` + `prisma.field.createMany(...)` en cada guardado del editor. Como `Answer.field` tiene `onDelete: Cascade`, esto borra en cascada las respuestas ya recibidas para los campos existentes cada vez que el usuario guarda cambios en el editor de un formulario que ya tiene respuestas.
>
> Implementa el fix: cambia la lógica de `bulk` para que, en vez de borrar-todo-y-recrear incondicionalmente:
> 1. Si el form no tiene ninguna `Response` (comprobar con `prisma.response.count({ where: { formId } })`), mantén el comportamiento actual (`deleteMany` + `createMany`) — no hay nada que perder.
> 2. Si el form ya tiene al menos una `Response`, en vez de `deleteMany`+`createMany`: actualiza (`update`) los campos existentes por `id` cuando el `id` venga en el payload y siga existiendo en BD, crea (`create`) los que no tengan `id` o no existan, y borra (`delete`) individualmente solo los campos que existían en BD y ya no están en el payload enviado — pero antes de borrar un campo así, comprueba si tiene alguna `Answer` asociada (`prisma.answer.count({ where: { fieldId } })`); si tiene, no lo borres — devuelve ese campo en la respuesta igualmente y añade un array `preserved: string[]` (ids) en la respuesta JSON explicando cuáles no se borraron por tener respuestas. Envuelve las operaciones en `prisma.$transaction(...)` para que no queden a medias si algo falla.
> 3. Ajusta el tipo del body: hoy `createFieldSchema` no incluye `id` opcional — para poder distinguir "actualizar campo existente" de "campo nuevo" en el payload de bulk, añade un `id: z.string().uuid().optional()` al schema usado específicamente en el endpoint bulk (no cambies `createFieldSchema` usado por el POST individual, que no debe aceptar `id` del cliente).
> 4. `embedFieldsInPDF` se sigue llamando igual al final con el set final de campos, sin cambios en su lógica.
>
> Después, añade tests en `backend/tests/fields.spec.ts` para el endpoint `POST /:formId/fields/bulk`, siguiendo el patrón ya usado en ese fichero (mock de `prisma` con `mockDeep<PrismaClient>()` vía `vi.mock('../src/services/db', ...)`, mock de `authenticate` para fijar `req.userId`). Casos a cubrir:
> - Form sin responses: bulk save reemplaza todos los campos (comportamiento actual, no debe romperse).
> - Form con responses: un campo existente enviado con su `id` se actualiza (`prisma.field.update` llamado, no `deleteMany`+`createMany` sobre ese campo).
> - Form con responses: un campo existente que tiene `Answer`s asociadas y NO viene en el payload de bulk no se borra (`prisma.field.delete` no se llama para ese `id`), y aparece en `preserved` en la respuesta.
> - Form con responses: un campo nuevo (sin `id` en el payload) se crea normalmente.
>
> Verifica corriendo `npm run test:backend` desde la raíz del repo (o `cd backend && npx vitest run tests/fields.spec.ts`) — deben pasar todos los tests existentes de ese fichero además de los nuevos. No toques `backend/tests/forms.spec.ts` ni el endpoint `DELETE /:formId/fields/:fieldId` individual — quedan fuera de este cambio. Al terminar, actualiza la sección "⚠️ Riesgo de pérdida de datos conocido" en `docs/sot/03-backend-patterns.md` para reflejar que ya está resuelto (o parcialmente, si se optó por la variante (a) de rechazar el borrado en vez de preservarlo — ajusta la redacción a lo que realmente se implementó), y marca este fichero (`features/0001-fix-bulk-save-data-loss.md`) con `**Estado:** hecho` en su cabecera.
