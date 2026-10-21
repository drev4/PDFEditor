# 0045 — Los campos archivados se ven, se distinguen y se pueden recuperar

**Status:** done
**Priority:** P3 — la otra mitad del agujero que [`features/0044`](0044-field-delete-archives-its-answers.md) acaba de cerrar: ahora se archiva desde dos sitios y sigue sin haber dónde verlo
**Branch:** `feature/0045-archived-fields-are-visible-and-restorable`
**Related:** [`features/0001`](0001-stable-field-ids-and-safe-bulk-save.md) · [`features/0044`](0044-field-delete-archives-its-answers.md) · [03-domain-model](../docs/sot/03-domain-model.md#the-deletedat-lifecycle) · [04-backend-patterns](../docs/sot/04-backend-patterns.md) · [05-frontend-patterns](../docs/sot/05-frontend-patterns.md) · [06-api-reference](../docs/sot/06-api-reference.md)

## Contexto

Archivar un campo funciona y está probado. Verlo, no. `docs/sot/03-domain-model.md:167` lo dice sin rodeos:

> There is no un-archive path, and no UI that lists archived fields.

Hoy un campo archivado se le comunica al autor de **una sola manera**: un toast que aparece una vez, en el momento del guardado (`FormSavePanel.vue:322`) o del borrado individual (`FieldPropertiesPanel.vue:544`), y desaparece a los ocho segundos. Después de eso el campo no existe en ninguna pantalla. No hay lista, no hay forma de recuperarlo, y en la tabla de respuestas su columna se dibuja **exactamente igual** que la de un campo vivo: `dynamicColumns` en `frontend/src/views/ResponsesView.vue:222` mapea `responseFields` a `{ fieldId, header }` y nada más. Quien lee esa tabla no puede saber que esa pregunta dejó de hacerse.

El backend ya hizo su parte y hay que aprovecharla antes de escribir nada nuevo. `GET /api/forms/:id/responses` (`backend/src/routes/forms.ts:370`) devuelve **todos** los campos del formulario, sin filtro de `deletedAt`, y lo hace con un `prisma.field.findMany` que selecciona todas las columnas — así que `deletedAt` **ya viaja en esa respuesta hoy**. Lo que falta en la mitad de Respuestas es puramente cliente: `frontend/src/services/forms.ts:14`, la interfaz `Field`, no declara el campo, así que la vista no puede leer lo que ya está recibiendo.

Y falta la mitad del editor, que sí es backend: no hay ningún endpoint que liste los campos archivados de un formulario (`06-api-reference.md:196` — «There is no list endpoint»), ni ninguno que desarchive. `verifyFieldOwnership` (`backend/src/middleware/formOwnership.ts:66`) filtra por `deletedAt: null` a propósito, así que para el `PUT` y el `DELETE` un campo archivado es un `404`, y eso tiene que seguir siendo verdad.

Por qué recuperar importa y no es un adorno: hoy la única forma de «volver a poner» un campo archivado es colocar uno nuevo, que recibe un **id nuevo**. Las respuestas viejas siguen colgando del id viejo, así que el CSV sale con dos columnas para la misma pregunta y ninguna herramienta las puede juntar nunca. Los ids estables son el trabajo de [`features/0001`](0001-stable-field-ids-and-safe-bulk-save.md); desarchivar es lo que hace que sirvan para algo cuando alguien se equivoca.

## Por qué el enfoque obvio está mal

**Desarchivar y no meter el campo en la lista local del editor lo vuelve a archivar en el guardado siguiente.** Éste es el fallo que este spec existe para evitar, y es silencioso. `POST /:formId/fields/bulk` calcula las bajas así (`backend/src/routes/form-fields.ts:219-235`): lee los campos **vivos** del formulario, y todo id vivo que no venga en el payload es una baja. Si el usuario recupera un campo y a continuación pulsa *Save all*, el editor envía la lista que tiene en `formFieldsStore.fields` — donde el campo recuperado no está — y el servidor lo interpreta como una baja, ve que tiene respuestas y **lo archiva otra vez**. El usuario ve cómo lo que acaba de recuperar desaparece sin ningún error. Por eso el endpoint de restore tiene que devolver **la fila entera** (posición, opciones, validación, orden) y la store tiene que insertarla en `fields` con su id de servidor, no limitarse a refrescar la lista de archivados.

**Y no marca el documento como sucio.** Restaurar es una escritura de servidor que ya ocurrió: dejar `hasUnsavedChanges` a `true` diría que hay algo pendiente que no existe, y el diálogo de «tienes cambios sin guardar» al salir del editor pasaría a mentir.

**«Que el guardado masivo acepte un id archivado y lo resucite» es la simplificación tentadora y está mal.** Ahorra un endpoint y rompe dos cosas. La primera es la validación de `unknownIds` (`form-fields.ts:237-246`), que hoy responde `400` a cualquier id que no sea un campo vivo de este formulario **precisamente porque eso significa que el cliente está confundido**; aceptar los archivados convierte esa red en un colador. La segunda es que la resurrección pasaría a ser implícita: un cliente con una lista caducada revive campos que nadie pidió revivir. Recuperar es un acto del autor y tiene que ser una petición que dice justo eso.

**No aflojes `verifyFieldOwnership` con un flag.** Es tentador añadirle `{ includeArchived: true }` y reutilizarlo. Ese helper es lo único que garantiza que el `PUT` y el `DELETE` individuales no alcanzan un campo archivado (`06-api-reference.md:205`), y un parámetro opcional en el sitio donde vive esa garantía es exactamente la clase de cosa que alguien pone a `true` por comodidad tres meses después. El restore hace su propia búsqueda, con `deletedAt: { not: null }` explícito, después de `verifyFormOwnership`.

**La cuenta de respuestas no la puede calcular el cliente.** La pantalla de respuestas tiene una página de veinte entregas; la lista de archivados tiene que decir cuántas respuestas conserva **cada** campo, que es el número que hace que la lista signifique algo. Sale de un `_count: { answers: true }` en el endpoint nuevo, no de contar lo que hay en pantalla.

**No marques las cabeceras del CSV.** Es la simetría aparente con la tabla, y es un cambio de contrato: `csv-exporter.ts` produce hoy la etiqueta del campo tal cual, y cualquiera que tenga un script leyendo esas cabeceras se rompe cuando pasen a decir «Teléfono (archived)». La marca va en la pantalla, que es donde hay alguien mirando. Si el export tiene que decirlo algún día, se decide con el spec del streaming del CSV, que ya toca ese fichero.

**No construyas una papelera con «borrar definitivamente».** Un botón que destruye respuestas a propósito es la funcionalidad que [`features/0044`](0044-field-delete-archives-its-answers.md) acaba de quitar del producto, y ponerla en una pantalla nueva la devuelve por la puerta de atrás. Esta lista tiene una acción y solo una: recuperar.

**Y ojo con el orden de las rutas.** `formFieldsRouter` y `formsRouter` montan los dos sobre `/api/forms`, y una ruta estática debajo de una familia parametrizada es donde ocurre el shadowing — el comentario de `POST /fields/check-pattern` (`form-fields.ts:57-97`) ya lo cuenta y `backend/tests/fields.spec.ts` lo verifica. Hoy no hay ningún `GET /:formId/fields/:fieldId` con el que `/:formId/fields/archived` pueda chocar, pero declararla arriba cuesta cero y un test que la afirme evita que el choque llegue el día que alguien añada ese `GET`.

## Objetivo

1. `GET /api/forms/:formId/fields/archived` devuelve los campos archivados del formulario — la fila entera más `answerCount` y `deletedAt` — ordenados por `deletedAt` descendente. `404` si el formulario no es alcanzable por el llamante, con la misma regla de siempre.
2. `POST /api/forms/:formId/fields/:fieldId/restore` pone `deletedAt` a `null` y devuelve `{ field }` con la fila completa. Un campo **vivo** por esa ruta es `404`; un campo de otra organización, `404`.
3. El rail del editor (`EditorRail.vue`) tiene una sección **Archived** debajo de Fields: aparece solo cuando hay alguno, dice cuántos son, lista cada uno con su etiqueta y cuántas respuestas conserva, y ofrece **Restore**.
4. Restaurar mete el campo en `formFieldsStore.fields` con su id de servidor, lo saca de la lista de archivados y **no** marca el documento como sucio. Un *Save all* inmediatamente después lo mantiene vivo.
5. Si al restaurar ya existe un campo vivo con el mismo `name`, la interfaz lo advierte antes de confirmar. El servidor no lo rechaza: dejar una respuesta huérfana para siempre es peor que dos columnas con el mismo nombre.
6. `frontend/src/services/forms.ts` declara `deletedAt: string | null` en `Field`, y `ResponsesView.vue` marca visualmente las columnas archivadas — en la cabecera de la tabla y en el diálogo de detalle — con una explicación al pasar por encima. Las respuestas siguen viéndose exactamente igual que ahora.
7. Tests de integración contra PostgreSQL real cubren los dos endpoints, sus `404`, y el viaje completo **archivar → listar → restaurar → guardado masivo**, comprobando que el campo sigue vivo al final. Ese último es el que reproduce la trampa descrita arriba: escríbelo y compruébalo.
8. Tests de frontend para la sección del rail y para la marca de la columna archivada.
9. Las cuatro suites y los dos type checks pasan.

## Fuera de alcance

- **Re-embeber el PDF.** Ninguna escritura individual de campo llama a `requestEmbed` hoy, y restaurar tampoco lo hará: añadirlo solo a la ruta nueva empeora la asimetría que ya está fichada («An individual field change never re-embeds the PDF»). El siguiente guardado masivo lo arregla, como en las otras tres rutas. **La copia de la interfaz no debe prometer que el PDF descargable se actualiza.**
- **Marcar las columnas archivadas en el CSV** — argumentado arriba.
- **Borrar definitivamente un campo archivado**, o cualquier acción destructiva en esta lista.
- **Editar un campo archivado.** Restaurar y luego editarlo son dos pasos, y está bien que lo sean: `PUT` y `DELETE` siguen respondiendo `404` a un campo archivado, y `verifyFieldOwnership` no se toca.
- **La lista de archivados en la vista de respuestas.** Ahí la marca es la columna, nada más; la lista vive en el editor, que es donde se actúa sobre ella.
- **El handler bulk**, salvo que no haya más remedio. Sus tests (`backend/tests/integration/fields-bulk-save.spec.ts`) tienen que seguir pasando **sin tocarlos**.
- **La capa de i18n.** La copia nueva se escribe en inglés, como el resto del sistema de diseño, y no se traduce nada más.
- **La store de respuestas organizativas** y `ResponsesIndexView.vue`, que no dibujan columnas por campo.

## Prompt de ejecución

> Vas a hacer visible y reversible algo que hoy ocurre a espaldas del cliente: el archivado de un campo. Son dos endpoints nuevos, una sección en el rail del editor y una marca en la tabla de respuestas.
>
> **Lee primero, en este orden:**
> - `backend/src/routes/form-fields.ts` entero. En especial el handler bulk (líneas 204-316) — cómo calcula las bajas a partir de los campos **vivos** es lo que explica el objetivo 4 — y el comentario de `POST /fields/check-pattern` sobre el orden de las rutas.
> - `backend/src/middleware/formOwnership.ts`, las dos funciones. `verifyFieldOwnership` no se toca.
> - `backend/src/routes/forms.ts:370` (`GET /:id/responses`) — fíjate en que ya devuelve los campos archivados y en que la fila lleva `deletedAt`.
> - `docs/sot/03-domain-model.md`, el apartado *the `deletedAt` lifecycle* (líneas 150-170). Es el que este cambio deja obsoleto en dos frases.
> - `frontend/src/components/editor/EditorRail.vue`, `frontend/src/stores/formFields.store.ts` (`archivedFieldIds`, `saveAllFields`, `deleteFieldFromServer`), `frontend/src/services/fields.ts`, `frontend/src/services/forms.ts` (la interfaz `Field`) y `frontend/src/views/ResponsesView.vue` (`dynamicColumns`, línea 222, y el diálogo de detalle, línea 135).
> - `backend/tests/integration/fields-visibility.spec.ts` y `field-delete-archives.spec.ts`, para el estilo de test.
>
> **El backend.** Aplica la skill `backend-endpoint-pattern`.
>
> - `GET /:formId/fields/archived`, **declarada por encima de las rutas `/:formId/fields/:fieldId`**, con un comentario que diga por qué y un test en `backend/tests/fields.spec.ts` que afirme que se alcanza. `verifyFormOwnership` primero; después un `findMany` con `deletedAt: { not: null }`, `include: { _count: { select: { answers: true } } }` y `orderBy: { deletedAt: 'desc' }`. Devuelve `{ fields: [...] }` donde cada elemento es la fila más `answerCount`.
> - `POST /:formId/fields/:fieldId/restore`. `verifyFormOwnership`, después una búsqueda **propia** con `{ id, formId, deletedAt: { not: null } }` — no reutilices `verifyFieldOwnership` ni le añadas un flag —, `404` si no aparece, y un `update` que ponga `deletedAt: null`. Devuelve `{ field }` con la fila completa. No llames a `requestEmbed`.
> - No hace falta transacción ni bloqueo aquí: restaurar no cuenta nada y no destruye nada, así que no tiene la carrera que hizo interesante al `DELETE` de [`features/0044`](0044-field-delete-archives-its-answers.md). Si te tienta añadir el `FOR UPDATE` por simetría, no lo hagas — pon un comentario diciendo por qué no hace falta.
>
> **El frontend.** Aplica `frontend-state-pattern`.
>
> - `services/fields.ts`: `listArchived(formId)` y `restore(formId, fieldId)`, con su tipo `ArchivedField` (la fila más `answerCount` y `deletedAt`).
> - `services/forms.ts`: añade `deletedAt: string | null` a `Field`.
> - `stores/formFields.store.ts`: estado `archivedFields` y la acción de restaurar. **Al restaurar, mete el campo en `fields` con su id de servidor y no marques `hasUnsavedChanges`** — lee otra vez el objetivo 4 y el apartado de por qué el enfoque obvio está mal antes de escribir esto, porque hacerlo a medias produce un fallo silencioso. Ojo con el mapeo: la store trabaja con `FormField`, que no es la `Field` del servidor.
> - `EditorRail.vue`: sección **Archived** debajo de Fields, oculta cuando la lista está vacía, con la cuenta, cada campo con su etiqueta y `N responses kept`, y un botón **Restore**. Antes de confirmar, si algún campo vivo tiene el mismo `name`, avísalo en el propio diálogo. La copia, en inglés y en el tono del resto del rail.
> - `ResponsesView.vue`: marca las columnas cuyo campo tiene `deletedAt`, en la cabecera de la tabla y en el diálogo de detalle, con un tooltip que explique que esa pregunta ya no se hace y que las respuestas se conservan. Sin tocar los valores ni la paginación.
>
> **Los tests.** Aplica la skill `test-author`.
>
> - Integración, `backend/tests/integration/fields-archived.spec.ts`: la lista trae solo archivados y con el `answerCount` correcto; el formulario de otra organización es `404`; restaurar un campo vivo es `404`; restaurar uno archivado lo devuelve a `GET /forms/:id` y lo saca de la lista de archivados.
> - **Y el caso que importa**, en ese mismo fichero: archivar un campo con respuestas, restaurarlo, y a continuación mandar un `POST /:formId/fields/bulk` con el conjunto que el editor tendría **incluyendo** el campo restaurado. Al final el campo sigue vivo y sus respuestas siguen ahí. Escribe también la versión sin incluirlo y comprueba que se vuelve a archivar: eso es lo que pasa si la store se implementa mal, y verlo ocurrir en un test es lo que justifica el objetivo 4.
> - Frontend: la sección del rail (aparece, lista, restaura, no ensucia el documento) y la marca de la columna archivada en `ResponsesView`.
>
> Si el entorno local no tiene la base de integración: `docker exec vuepdf-db psql -U postgres -c "CREATE DATABASE vuepdf_test;"` y después `DATABASE_URL=…/vuepdf_test npx prisma migrate deploy`. Nada la crea ni la migra automáticamente todavía.
>
> **No toques:** `verifyFieldOwnership`, el handler bulk, `csv-exporter.ts`, `DELETE /forms/:id`, ni ninguna cadena en español fuera de la copia que escribas.
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
> - `docs/sot/06-api-reference.md`: las dos rutas nuevas en la tabla de *Fields* (línea 200), y la frase «There is no list endpoint» de la línea 196, que deja de ser verdad. Pasa la skill `api-contract-guard`.
> - `docs/sot/03-domain-model.md`: la línea 167 («There is no un-archive path, and no UI that lists archived fields») y la 152 («archived by exactly one code path: the bulk save»), que además ya estaba desactualizada desde [`features/0044`](0044-field-delete-archives-its-answers.md). La tabla de *quién ve un campo archivado* gana dos filas.
> - `docs/sot/05-frontend-patterns.md`: el párrafo de la línea 124 describe el toast como el único aviso. Ya no lo es.
> - Skill `sot-sync` para lo que quede.
> - Quita la fila del backlog («No UI for archived fields»), que cubre las dos mitades.
> - Pon `**Status:** done` en este fichero, con un apartado **Resultado** que diga qué se encontró — incluido si el test del guardado masivo tras restaurar falló como se esperaba en la versión «sin incluir el campo», y con qué salida.
> - Skill `ship-checklist` antes de abrir el PR.


## Resultado

**Hecho.** Los nueve objetivos cumplidos.

**Lo que la mitad de Respuestas resultó costar: nada de backend.** Estaba en el spec y se confirmó al abrirlo: `GET /forms/:id/responses` ya devolvía los campos archivados **con su `deletedAt`**, porque el `findMany` no lleva `select`. El dato llevaba ahí desde siempre y el cliente lo tiraba — `Field` en `services/forms.ts` no lo declaraba. La marca de columna archivada son tres líneas de plantilla y un booleano en `dynamicColumns`.

**Los dos tests que se comprobó que muerden**, rompiendo el código a propósito y viéndolos fallar:

- Quitando el `fields.value.push(toFormField(restored))` de la store, fallan *puts a restored field into the editor list* y *sends the restored field back with the next save*. Es la trampa entera del spec: sin esa línea el campo restaurado no viaja en el siguiente guardado, el servidor lo lee como baja y lo archiva otra vez con un `200`.
- Poniendo `archived: false` en `dynamicColumns`, falla *marks the column of a field that is no longer collected*.

**Y la carrera de esa trampa está probada desde los dos lados**, en `fields-archived.spec.ts`: restaurar y guardar **incluyendo** el campo lo deja vivo; restaurar y guardar **sin incluirlo** lo vuelve a archivar, con `200` y sin ningún error. El segundo test documenta el fallo que produce un frontend mal escrito, y sus respuestas siguen ahí después del segundo archivado.

**Una decisión que se tomó al escribir la copia.** El toast de restaurar dice *«Save the form to put it back in the PDF»* en vez de dar el trabajo por terminado. Ninguna escritura individual de campo llama a `requestEmbed`, así que el PDF descargable no tiene el campo hasta el siguiente guardado masivo; decir otra cosa sería una mentira que el autor descubre al descargar. La fila del backlog ahora dice que son **cuatro** rutas en esa clase, no tres.

**Y una que se dejó a medias a propósito.** La tabla marca la columna archivada y el CSV no. Cambiar `Phone` por `Phone (archived)` en la cabecera rompe el script de cualquiera que parsee el export, por una ganancia cosmética. Las dos superficies discrepan ahora y hay fila nueva en el backlog que dice dónde se resuelve: en la reescritura en streaming de `csv-exporter.ts`, que ya toca ese fichero, y probablemente con una columna de metadatos en vez de cabeceras decoradas.

**Un detalle de test que costó dos intentos.** `ResponsesView.spec.ts` monta el `DataTable` de verdad, con `plugins: [PrimeVue]`, porque la marca vive en un slot `#header` de `<Column>` y con la tabla stubbeada no se estaría afirmando nada de lo que ve quien lee la tabla. Sin el plugin, el `Paginator` de PrimeVue revienta con `Cannot read properties of undefined (reading 'config')`.

**Una cosa que no se pudo identificar y queda escrita.** En la primera pasada de `npm run test:backend` salió `1 failed | 31 passed`, y la salida no llegó a decir cuál. Las tres pasadas siguientes dieron 403/403 en verde, y también las suites de integración y frontend completas. No se ha fichado fila porque «algún test del backend falló una vez, no se sabe cuál» no es accionable; queda aquí por si reaparece.

### Verificación

```
npm run test:integration    31 ficheros (28 + 3 saltados), 286 tests (276 + 10 saltados)
npm run test:backend        32 ficheros, 403 tests
npm run test:frontend       58 ficheros, 497 tests
cd backend && npx tsc --noEmit    limpio
npm run build --workspace=frontend    limpio (vue-tsc)
```
