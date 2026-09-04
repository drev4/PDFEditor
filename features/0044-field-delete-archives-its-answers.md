# 0044 — Borrar un campo suelto archiva sus respuestas, como ya hace el guardado

**Status:** done
**Priority:** P3 — es el último camino del editor que destruye datos de un cliente sin poder deshacerse
**Branch:** `feature/0044-field-delete-archives-its-answers`
**Related:** [`features/0001`](0001-stable-field-ids-and-safe-bulk-save.md) · [03-domain-model](../docs/sot/03-domain-model.md) · [04-backend-patterns](../docs/sot/04-backend-patterns.md) · [06-api-reference](../docs/sot/06-api-reference.md) · [09-quality](../docs/sot/09-quality-and-testing.md)

## Contexto

`backend/src/routes/form-fields.ts:143` — el handler `formFieldsRouter.delete('/:formId/fields/:fieldId', …)` — hace `await prisma.field.delete({ where: { id: fieldId } })` y nada más. `Answer.field` es `onDelete: Cascade`, así que esa línea destruye **todas las respuestas dadas a ese campo**, en todas las entregas pasadas, sin contarlas, sin decirlo y sin vuelta atrás.

El guardado masivo del mismo fichero (`POST /:formId/fields/bulk`, líneas 210-260) hace exactamente lo contrario y lo hace con cuidado: bloquea las filas que va a quitar con `SELECT … FOR UPDATE`, pregunta cuáles tienen respuestas, **archiva** esas (`Field.deletedAt`) y borra de verdad solo las que no tienen ninguna. Ese es el trabajo de [`features/0001`](0001-stable-field-ids-and-safe-bulk-save.md), y fue la respuesta al defecto de pérdida de datos que este repositorio ya envió una vez.

`features/0001` dejó fuera el borrado individual **a propósito**, y dijo por qué en su línea 47:

> `DELETE /api/forms/:formId/fields/:fieldId`, the individual delete. Its cascade is an explicit, deliberate act by the user rather than a side effect of saving. **Revisit separately once soft delete exists.**

El borrado suave existe desde entonces: `Field.deletedAt` está en el esquema, el formulario público filtra por él (`backend/src/routes/responses.ts:41`), y `backend/tests/integration/fields-visibility.spec.ts` lo cubre. La condición que aquel spec puso se cumple, así que esto es exactamente el «revisit» que pidió.

Y el «acto explícito y deliberado» tampoco se sostiene mirando la interfaz. El botón vive en `frontend/src/components/form-fields/FieldPropertiesPanel.vue:167` y llama a `deleteField()` (línea 465), cuya confirmación entera es:

```js
if (!confirm(`¿Eliminar el campo "${fieldName}"?`)) return
```

Un `window.confirm` que no menciona las respuestas, no dice cuántas hay y no distingue un campo recién colocado de uno que lleva tres meses recogiendo datos. Nadie que pulse *Aceptar* ahí ha consentido borrar nada más que un rectángulo.

## Por qué el enfoque obvio está mal

**«Llamar al mismo código que el guardado masivo» no es copiar el `if`.** Lo que hace correcta a la rama de archivado del bulk no es contar respuestas: es el `SELECT … FOR UPDATE` que va **antes** de contarlas. Insertar una `Answer` toma un `FOR KEY SHARE` sobre el campo al que apunta, y eso choca con ese bloqueo — así que una entrega que llegue mientras decidimos, o aterriza primero (y vemos su respuesta, y archivamos), o espera a que confirmemos. Sin el bloqueo, una respuesta enviada entre el `count` y el `delete` se va en la cascada, que es justo la clase de fallo por la que existe todo esto. **El bloqueo primero, la cuenta después, todo dentro de la misma transacción.**

**«Archivar siempre» está mal, y es la simplificación tentadora.** Un campo sin respuestas tiene que borrarse de verdad. Si no, cada campo colocado y descartado durante el diseño deja una fila permanente, y la tabla de respuestas acumula columnas que nadie rellenó nunca. La regla es la del guardado masivo, ni más ni menos: **con respuestas, se archiva; sin ninguna, se borra**.

**La cuenta no la puede dar el frontend.** Lo tentador es pedir un contador antes de abrir el diálogo y enseñarlo en la pregunta. Ese número está caducado en el momento en que el usuario lee el diálogo — el formulario está publicado y puede recibir una entrega mientras lo piensa — y además obliga a un endpoint nuevo para algo que el servidor ya sabe dentro de su propia transacción. **La decisión: el diálogo pregunta en términos de lo que va a pasar, y el toast posterior informa de lo que pasó**, leyendo la respuesta del servidor (`archived`, `answerCount`). Es la misma forma que ya tiene el guardado masivo, que también avisa de los campos archivados después de hacerlo.

**No hay que quitar el `window.confirm` construyendo una capa de i18n.** La copia nueva se escribe en inglés, como el resto del sistema de diseño, y no se toca ninguna otra cadena en español del editor. La capa de i18n es su propia fila del backlog y meterla aquí convierte un arreglo de pérdida de datos en un refactor de toda la interfaz.

**Y un test secuencial no prueba el bloqueo.** Igual que en [`features/0027`](0027-atomic-plan-limits.md): si el test borra el campo y luego comprueba, pasa también con el código roto. La carrera hay que dispararla con dos peticiones a la vez contra PostgreSQL de verdad, o no se ha probado.

## Objetivo

1. `DELETE /api/forms/:formId/fields/:fieldId` **archiva** (`deletedAt`) el campo que tiene respuestas y **borra** el que no tiene ninguna.
2. Lo decide dentro de **una** transacción cuya primera sentencia sobre esa fila es el `SELECT … FOR UPDATE`, igual que el handler bulk.
3. El cuerpo de la respuesta dice qué ocurrió: `{ message, archived: boolean, answerCount: number }`.
4. Un campo ya archivado no es alcanzable por este endpoint: responde `404`, como cualquier campo que el editor no puede ver.
5. Ninguna `Answer` desaparece por esta ruta. Nunca.
6. La confirmación del editor deja de ser `window.confirm`, está en inglés, y dice lo que va a pasar con las respuestas ya recogidas. El toast posterior dice lo que pasó, con el número que devolvió el servidor.
7. Un test de integración contra PostgreSQL real cubre las dos ramas **y** la carrera, y se ha visto fallar contra el código sin arreglar antes de arreglarlo.
8. Las cuatro suites y los dos type checks pasan.

## Fuera de alcance

- **La pantalla de campos archivados.** Este cambio hace que se archive desde un sitio más; no construye la lista, ni el desarchivar, ni la marca en la tabla de respuestas. Es su propia fila del backlog («No UI for archived fields») y merece su propio spec.
- **La capa de i18n.** Solo se traduce la copia que este cambio escribe.
- **`DELETE /api/forms/:id`**, el borrado del formulario entero, que sigue cascadeando a todas sus respuestas. Fila propia en el backlog («Soft delete or export prompt before `DELETE /api/forms/:id`»).
- **Refactorizar el handler bulk.** Si sale un helper compartido de verdad, bien; pero los tests de `backend/tests/integration/fields-bulk-save.spec.ts` tienen que seguir pasando **sin tocarlos**. Si extraerlo obliga a cambiarlos, no se extrae: se duplican las quince líneas y se pone un comentario que enlace las dos.
- **`PUT /forms/:formId/fields/:fieldId`** y el `POST` individual. No se tocan.

## Prompt de ejecución

> Vas a arreglar el último camino del editor que destruye respuestas de clientes: el borrado de un campo suelto.
>
> **Lee primero, en este orden:**
> - `backend/src/routes/form-fields.ts` entero — el handler `DELETE` en la línea 143 es lo que vas a cambiar, y el bloque de archivado del handler bulk (líneas 210-260) es el patrón que tienes que seguir, incluido su `SELECT … FOR UPDATE` y el comentario que explica por qué va antes de contar.
> - `features/0001-stable-field-ids-and-safe-bulk-save.md`, sobre todo su línea 47, que es la que dejó esta ruta fuera y dijo cuándo volver.
> - `backend/tests/integration/fields-bulk-save.spec.ts` y `backend/tests/integration/fields-visibility.spec.ts` — el estilo de test que tienes que escribir, y lo que ya se garantiza sobre un campo archivado.
> - `frontend/src/components/form-fields/FieldPropertiesPanel.vue` (el botón en la línea 167 y `deleteField()` en la 465), `frontend/src/stores/formFields.store.ts` (`deleteFieldFromServer`, línea 286) y `frontend/src/services/fields.ts` (línea 85).
> - El mapa de cascadas en `docs/sot/03-domain-model.md`, antes de escribir cualquier `delete`.
>
> **El test primero.** Escribe `backend/tests/integration/field-delete-archives.spec.ts` con tres casos, y **ejecútalo contra el código sin arreglar hasta verlo fallar** — si pasa, el test está mal:
> 1. Un campo con respuestas: tras el `DELETE`, el campo tiene `deletedAt`, y todas sus `Answer` siguen ahí. Hoy esto falla porque no queda ninguna.
> 2. Un campo sin respuestas: tras el `DELETE`, la fila no existe.
> 3. La carrera: un `Promise.all` que lanza a la vez el `DELETE` del campo y una entrega pública que responde a ese campo. Termine como termine, el invariante es el mismo — **si la respuesta se aceptó, su `Answer` existe**; el campo estará archivado, o el borrado habrá ocurrido antes de que la entrega existiera. Lo que no puede pasar nunca es un `200` en la entrega y ninguna `Answer`.
>
> Si el entorno local no tiene la base de integración: `docker exec vuepdf-db psql -U postgres -c "CREATE DATABASE vuepdf_test;"` y después `DATABASE_URL=…/vuepdf_test npx prisma migrate deploy`. Nada la crea ni la migra automáticamente todavía (dos filas abiertas del backlog).
>
> **El backend.** Aplica la skill `backend-endpoint-pattern`. Reescribe el handler `DELETE` para que abra una transacción y, dentro y en este orden: bloquee la fila del campo con `SELECT id FROM "fields" WHERE id = … FOR UPDATE`, cuente sus `Answer`, y archive o borre según el resultado. La comprobación de propiedad (`verifyFieldOwnership`) se queda donde está, antes de la transacción. Un campo con `deletedAt` no nulo responde `404` — que es lo que ya significa para el editor un campo que no puede ver. Devuelve `{ message, archived, answerCount }`.
>
> **El frontend.** Sustituye el `window.confirm` de `FieldPropertiesPanel.vue` por un diálogo del sistema de diseño (mira cómo lo hace `LimitReachedDialog.vue`), en inglés, que diga que las respuestas ya recogidas a través de este campo se conservan y el campo se archiva. No pidas ninguna cuenta antes de abrirlo. El toast posterior lee la respuesta del servidor: si `archived`, dice cuántas respuestas se conservan; si no, dice simplemente que el campo se eliminó. `deleteFieldFromServer` en la store tiene que devolver ese cuerpo en vez de descartarlo, y el campo sale de la lista local en los dos casos. Aplica `frontend-state-pattern` si tocas la store.
>
> **No toques:** el handler bulk salvo para extraer un helper que deje sus tests intactos, `PUT`/`POST` de campos, el borrado de formularios, ni ninguna otra cadena en español.
>
> **Verifica, y enseña la salida:**
> ```
> npm run test:integration
> npm run test:backend
> npm run test:frontend
> cd backend && npx tsc --noEmit
> npm run build --workspace=frontend
> ```
>
> **La salida documental**, antes de decir que está hecho:
> - `docs/sot/06-api-reference.md`, línea 202: hoy dice «⚠️ Cascades: deletes every `Answer` given to this field in past responses. The bulk save does **not** do this». Tiene que decir lo que hace ahora, con el cuerpo de respuesta nuevo. Pasa la skill `api-contract-guard`.
> - `docs/sot/03-domain-model.md`: el mapa de cascadas ya no tiene esta ruta como destructora.
> - Skill `sot-sync` para lo que quede.
> - Quita la fila del backlog («`DELETE /api/forms/:formId/fields/:fieldId` still hard-deletes answers»).
> - Pon `**Status:** done` en este fichero, con un apartado **Resultado** que diga qué se encontró al ejecutarlo — incluido si el test de la carrera falló como se esperaba, y con qué salida.
> - Skill `ship-checklist` antes de abrir el PR.


## Resultado

**Hecho.** Los ocho objetivos cumplidos.

**El test falló como tenía que fallar, y el de la carrera falló por el motivo bueno.** Contra el handler sin arreglar, tres de los cuatro casos fallaron. Los dos primeros de forma aburrida — no había cuerpo que leer y la fila desaparecía. El tercero es el que valía:

```
FAIL  never accepts a submission whose answer is then cascaded away
AssertionError: expected [] to have a length of 1 but got +0
```

Es decir: la entrega **devolvió `201`** y su respuesta no estaba en la base de datos. El defecto exacto, reproducido en un `Promise.all`, no razonado. Con el bloqueo delante de la cuenta, la misma prueba pasa: la entrega gana la carrera, su respuesta toma `FOR KEY SHARE` sobre el campo, el `FOR UPDATE` espera, ve la respuesta y archiva.

**Un tropiezo, y merece quedar escrito porque volverá.** El `SELECT … FOR UPDATE` se escribió primero como `WHERE id = ${fieldId}::uuid`, copiando la forma de un `id` que *parece* un UUID. La columna es `text`, y PostgreSQL contestó `operator does not exist: text = uuid` — un `500` en las tres pruebas a la vez. El handler bulk no lleva ningún cast, por eso funciona: **el parámetro va tal cual**.

**Lo que este arreglo no hace, y está fichado en vez de comentado.** Ninguna escritura individual de campo — ni `POST`, ni `PUT`, ni este `DELETE` — llama a `requestEmbed`, así que el PDF guardado sigue describiendo un campo que ya no existe hasta el siguiente guardado masivo. Añadirlo solo aquí habría empeorado la asimetría; hay fila propia en el backlog.

**Y una cosa que se creía tarea y no lo era.** Esta era la segunda de la lista del editor porque la primera —«la herramienta de dibujo a mano alzada no persiste»— resultó no existir: `DrawingToolbar.vue` ofrece Search, Text e Image más los cinco tipos de campo, y nada en el repositorio dibuja a mano alzada. La fila del backlog se corrigió en el mismo cambio.

### Verificación

```
npm run test:integration    30 ficheros (27 + 3 saltados), 274 tests
npm run test:backend        32 ficheros, 397 tests
npm run test:frontend       56 ficheros, 481 tests
cd backend && npx tsc --noEmit    limpio
npm run build --workspace=frontend    limpio (vue-tsc)
```
