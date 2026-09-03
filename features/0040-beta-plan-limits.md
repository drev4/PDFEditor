# 0040 — Free lleva límites de beta, y el límite deja de estar escrito en los tests

**Status:** done
**Priority:** P0 — bloquea la beta privada del 2026-09-30 (BET-006)
**Branch:** `feature/0040-beta-plan-limits`
**Related:** [10-saas-roadmap](../docs/sot/10-saas-roadmap.md) · [04-backend-patterns §10](../docs/sot/04-backend-patterns.md) · [`features/0012`](0012-plan-catalogue-and-entitlements.md) · [`features/0015`](0015-team-plan-and-purchased-seats.md) · [`features/0027`](0027-atomic-plan-limits.md)

## Contexto

La beta privada arranca sin Stripe configurado. Eso no rompe nada — las rutas de facturación responden `503` y no hay selector de planes — pero tiene una consecuencia que no estaba en ningún documento: **`Organization.planKey` tiene por defecto `free` y su único escritor es el webhook de Stripe** (`services/stripe.ts:349`), así que toda organización se queda en Free de forma permanente.

Free son `maxPublishedForms: 1`, `maxResponsesPerMonth: 50`, `seats: 1` (`services/plans.ts:96-104`). Una cohorte de beta sobre esos números puede publicar **un** formulario, recibir 50 respuestas al mes y no invitar a nadie. El segundo formulario es un `402`, y el primer compañero otro.

`DEV_PLAN_KEY` no sirve para esto y es importante entender por qué: solo se honra cuando `NODE_ENV` es exactamente `development` o `test` (`plans.ts:242`, lista blanca deliberada), de forma que un `NODE_ENV` ausente o mal escrito **aplica** los límites en vez de levantarlos. En producción se ignora en silencio, que es la dirección correcta para un fallo y también la razón de que no sea la salida aquí.

De las tres salidas evaluadas — subir Free, añadir un plan `beta` con un script que escriba `planKey`, o configurar Stripe en test y suscribir a mano — se eligió **subir Free**, porque es la única que no añade un segundo escritor de `planKey` ni mete Stripe en el camino crítico de septiembre.

## Por qué el enfoque obvio no basta

**Cambiar la constante rompe los tests, y arreglarlos mal borra la prueba de que el límite existe.**

`tests/integration/entitlements.spec.ts` codifica el límite de formularios publicados como *«el segundo se rechaza»* en tres tests, y `seats.spec.ts` hace lo propio con el primer invitado. Esos tests no comprueban el catálogo: comprueban el número **1**, escrito a mano. Subir Free los pone en rojo, y la tentación entonces es relajar la aserción — con lo que se pierde exactamente lo que demuestra que la puerta cierra.

El límite de respuestas ya está bien hecho y sirve de modelo: usa `FREE.maxResponsesPerMonth` y siembra el medidor hasta el borde, así que sube sin tocar nada. **La corrección es hacer que formularios y asientos se comporten igual**, y hasta que eso esté hecho, la promesa de que los límites viven en una sola constante es falsa: viven en una constante y en cuatro tests.

Las dos mitades van en un solo cambio porque comparten una razón para cambiar y **ninguna se puede verificar sin la otra**: derivar del catálogo sin subir el número no prueba nada nuevo, y subir el número sin derivar deja la suite roja.

**No se toca `DEV_PLAN_KEY` ni su lista blanca.** Es tentador ampliarla a `production` para la beta y sería el peor cambio posible: convierte un fallo silencioso en producción en la forma normal de operar, y el día que se configure Stripe el override ganaría a la suscripción real (`plans.ts:201-206`).

**Los límites de beta son temporales y tienen que decirlo en el sitio donde alguien los leerá**, que es el propio catálogo — no solo en este fichero. Un número temporal sin condición de reversión escrita al lado se queda para siempre.

## Objetivo

Cada punto es cierto o falso al terminar.

1. `PLANS.free` pasa a `maxPublishedForms: 10`, `maxResponsesPerMonth: 1000`, `seats: 5`. `hasBranding` y `hasApiAccess` **no cambian**: la marca del producto sigue visible en la beta, y el acceso a la API sigue siendo de Team.
2. `PLANS.pro` y `PLANS.team` **no cambian**.
3. Junto a la entrada `free` queda escrito que son límites de beta, cuáles eran los valores anteriores (1 / 50 / 1) y cuál es la condición de reversión: configurar Stripe y abrir el registro público.
4. Ningún test codifica el límite de formularios publicados ni el de asientos como un número literal. Los dos derivan de `PLANS.free`, igual que el de respuestas ya hacía.
5. La suite falla si alguien cambia un límite y deja un test contradiciéndolo — es decir, los tests siguen siendo tests: publicar hasta el límite pasa, uno más da `402`, y el que sobra queda en `draft`.
6. Las cuatro suites y los dos type checks pasan.

## Fuera de alcance

- **`DEV_PLAN_KEY`, su lista blanca y `effectivePlan`.** No se tocan, por lo dicho arriba.
- **Las variables de Stripe.** Configurarlas es OPS y no bloquea la beta.
- **La contradicción de asientos de Team** (D-025 dice usuarios ilimitados, el código cobra por asiento con suelo 3). Es PRD-011 y bloquea publicar precios, no la beta.
- **Los números definitivos de Free.** BIZ-007 sigue abierta: esto es la configuración de la beta, no la validación del packaging.
- **Cualquier cambio en `entitlements.ts`.** Las funciones que aplican los límites ya son correctas y atómicas ([`features/0027`](0027-atomic-plan-limits.md)); este cambio solo mueve números.

## Prompt de ejecución

> Lee primero `backend/src/services/plans.ts` entero — el bloque de `DEV_PLAN_KEY` explica por qué no es la salida — y después `backend/tests/integration/entitlements.spec.ts` y `backend/tests/integration/seats.spec.ts`, fijándote en cómo el límite de respuestas ya deriva de `FREE.maxResponsesPerMonth` mientras el de formularios está escrito a mano.
>
> **Paso 1 — derivar antes de subir.** En `entitlements.spec.ts`, reescribe los tests de formularios publicados para publicar `PLANS.free.maxPublishedForms` formularios y comprobar que el siguiente da `402` y queda en `draft`. En `seats.spec.ts`, haz lo mismo con `PLANS.free.seats`. **Ejecuta la suite con los números actuales todavía puestos**: tiene que pasar en verde antes de tocar el catálogo, porque eso es lo que demuestra que la reescritura conserva el significado y no lo relaja.
>
> **Paso 2 — subir los números** en `PLANS.free`, con el comentario del objetivo 3 al lado. Vuelve a ejecutar: la suite tiene que seguir verde sin más cambios. Si algún test falla ahora, es un test que seguía codificando un número — arréglalo igual que los anteriores, no relajando la aserción.
>
> **Paso 3 — comprobar el borde de verdad.** Añade a `entitlements.spec.ts` un test que fije lo que el objetivo 5 pide: con el límite en `n`, el formulario `n` publica y el `n+1` da `402`. Tiene que ser evidente al leerlo que si mañana alguien pone `maxPublishedForms: 3` el test sigue midiendo el borde.
>
> **No toques**: `entitlements.ts`, `DEV_PLAN_KEY`, la lista blanca `OVERRIDE_ENVIRONMENTS`, `effectivePlan`, ni las entradas `pro` y `team`.
>
> **Verifica** y reporta la salida real de cada uno: `npm run check:node`, `npm run test:backend`, `npm run test:frontend`, `npm run test:integration`, `npm run test:e2e`, `npm run build --workspace=frontend`, `cd backend && npx tsc --noEmit`, `cd backend && npm run typecheck:tests`.
>
> **Al salir**: ejecuta `sot-sync`. Actualiza la tabla de planes de [10-saas-roadmap](../docs/sot/10-saas-roadmap.md) y de [04-backend-patterns §10](../docs/sot/04-backend-patterns.md) si citan los números, y **añade en [08-operations](../docs/sot/08-operations.md) qué hay que revertir al configurar Stripe**, porque ese es el momento en que estos números dejan de ser correctos y nadie se acordará. Cierra BET-006 en `PDFSaaS/docs/planning/BACKLOG.md` y registra la decisión con su condición de reversión en `PDFSaaS/docs/ssot/DECISIONES.md`. Pon este fichero en `**Status:** done` con una sección de Resultado.

## Resultado

**Hecho.** Los seis objetivos cumplidos. Free pasa a 10 / 1000 / 5, y el límite deja de estar escrito a mano en ningún test.

**La sospecha de la sección «por qué el enfoque obvio no basta» se quedó corta, y ese es el resultado que más vale.** La spec contaba con cuatro tests codificando el número. Eran **ocho**, en cuatro ficheros, y los cuatro últimos solo aparecieron al subir la constante:

| Fichero | Qué codificaba |
|---|---|
| `tests/integration/entitlements.spec.ts` | «el segundo formulario publicado se rechaza», ×3, y dos casos de asientos que asumían que el propietario llenaba el plan |
| `tests/integration/seats.spec.ts` | «la primera invitación de una cuenta Free se rechaza» |
| `tests/integration/billing.spec.ts` | «tres formularios publicados — dos más de los que Free permite» |
| `tests/integration/plan-limit-races.spec.ts` | un helper llamado `organizationWithTwoDrafts` cuyo nombre **era** la suposición: dos borradores solo son «uno de más» si el límite es uno |
| `tests/entitlements.spec.ts` (mockeado) | `form.count` a 1, el medidor a 50 y 51, y la tabla de la respuesta de `/entitlements` con 1 / 50 / 1 escritos |

Ocho sitios para un número que la SoT describía como «una constante». **La promesa era falsa y ahora es cierta**: el helper de las carreras se llama `organizationOnItsLastSlot` y llena hasta el límite menos uno, así que la carrera se corre sobre la última plaza esté donde esté.

**El orden de los pasos es lo que hace que esto valga.** Los tests se reescribieron **antes** de tocar el catálogo y se ejecutaron con Free todavía en 1 / 50 / 1: **39 verdes**. Eso es lo que demuestra que derivar del catálogo conservó el significado en vez de relajarlo — un test reescrito y solo ejecutado después del cambio no distingue entre «sigue midiendo el borde» y «ya no mide nada».

**Un test falló correctamente y no se borró.** `tests/entitlements.spec.ts` tenía uno llamado *takes the free plan straight from the design canvas*, cuyo comentario decía «si el canvas cambia, esto falla primero — que es el punto». Al subir Free falló, y tenía razón: el catálogo ya no es el producto diseñado. En vez de eliminarlo se le dio la vuelta — ahora es el **recordatorio de reversión**, afirma los números de beta y dice cuáles son los del canvas y cuándo restaurarlos. La condición de reversión está además en `plans.ts` y en una sección propia de [08-operations](../docs/sot/08-operations.md), porque un número temporal sin condición escrita al lado se queda para siempre.

**Lo que no se tocó, a propósito:** `DEV_PLAN_KEY` y su lista blanca `OVERRIDE_ENVIRONMENTS`, `effectivePlan`, `entitlements.ts`, y las entradas `pro` y `team`. Ampliar la lista blanca a `production` era la salida tentadora y es la peor: convierte un fallo deliberadamente silencioso en la forma normal de operar, y el día que se configure Stripe el override ganaría a la suscripción real.

**Verificado** (salida real): backend 30 ficheros / 383 tests; frontend 56 / 479; integración 26 pasan + 3 saltados / **260** pasan + 10 saltados contra un PostgreSQL real, uno más que antes por el test nuevo del borde; e2e 53; `tsc --noEmit`, `typecheck:tests`, `build --workspace=frontend` y `check:node` limpios.

**Sigue abierto y fichado:** BIZ-007, los números definitivos de Free, que esto no decide — esto es la configuración de la beta, no la validación del packaging.
