# 0041 — El seguimiento de errores llega de verdad a la SPA, y se puede comprobar

**Status:** done
**Priority:** P0 — bloquea la beta privada del 2026-09-30 (OPS-003)
**Branch:** `feature/0041-sentry-reaches-the-spa`
**Related:** [08-operations](../docs/sot/08-operations.md) · [`features/0034`](0034-error-tracking-on-api-and-spa.md) · [`features/0031`](0031-production-deployment.md)

## Contexto

`VITE_SENTRY_DSN` se configuró en Railway el 2026-09-03 y **la SPA sigue sin reportar nada**. Comprobado desde fuera, con dos señales independientes sobre `https://app.docaiflow.com`:

- El `connect-src` de la CSP es `'self' https://api.docaiflow.com blob:`. No aparece ningún origen de Sentry.
- El bundle servido es `index-BIsfna8W.js` — **el mismo hash antes y después** de configurar la variable — y no contiene el DSN.

La causa no es la caché de Railway ni un redeploy que faltara. Es `Dockerfile.frontend`: declara `ARG VITE_API_URL` y **no declara `VITE_SENTRY_DSN`**. En una build de Docker las variables del servicio no entran al build salvo que estén declaradas como `ARG`, así que Vite nunca la ve y el bundle sale idéntico por muchas veces que se reconstruya.

Es un hueco entre dos features que no se cruzaron: [`features/0031`](0031-production-deployment.md) escribió el Dockerfile cuando la única variable de compilación era `VITE_API_URL`, y [`features/0034`](0034-error-tracking-on-api-and-spa.md) añadió `VITE_SENTRY_DSN` sin volver a él. Falla como el resto de esta familia: sin error, sin aviso y con el despliegue en verde.

**Y hay una segunda mitad.** Esto solo se descubrió porque el bundle y la CSP son inspeccionables desde fuera. La API y el worker tienen exactamente el mismo modo de fallo — una variable que no llega, un DSN que el SDK descarta en silencio — y **no hay forma equivalente de mirarlos**. `isErrorTrackingEnabled()` existe y no se publica en ninguna parte.

## Por qué el enfoque obvio no basta

**Copiar la validación de `VITE_API_URL` rompería a quien no use Sentry.** Ese `ARG` se valida con un `RUN node -e` que **lanza si falta**, y es correcto para él: sin `VITE_API_URL` la SPA no habla con nada, así que la imagen no debe construirse. Sentry es lo contrario y a propósito — sin DSN el seguimiento está apagado, que es un despliegue con menos visibilidad, no uno roto ([`features/0034`](0034-error-tracking-on-api-and-spa.md), y `validate-env.ts` lo trata como opcional por la misma razón). Aplicarle la misma regla haría imposible construir la imagen sin una cuenta de Sentry.

Lo que sí hay que validar es la **forma cuando está presente**, porque el modo de fallo de un valor mal escrito no es un error: el SDK se desactiva solo y el origen que se deriva para el `connect-src` sale mal, así que los informes se bloquean en el navegador sin que nada lo diga.

**Un evento en cada arranque es la forma equivocada de comprobarlo.** La tentación es emitir siempre un evento al botar. Railway reinicia los servicios por su cuenta, Sentry cobra por evento, y un proyecto lleno de mensajes de arranque es un proyecto en el que nadie ve el fallo real. La comprobación tiene que ser **algo que se enciende, se mira y se apaga**.

**Y no vale exponerlo en `/health/ready`.** Es público por diseño, y su comentario dice qué puede llevar: estados y contadores de cola, nunca texto de excepción ni cadenas de conexión. Añadir ahí si el seguimiento está configurado es divulgar configuración en un endpoint anónimo para ahorrar una mirada al log.

## Objetivo

1. `Dockerfile.frontend` declara `ARG VITE_SENTRY_DSN` y lo expone como `ENV` antes de `npm run build`.
2. **Ausente sigue siendo válido**: la imagen se construye sin la variable, exactamente como hoy.
3. **Presente pero no una URL rompe el build**, con un mensaje que diga por qué, en vez de producir una CSP que tiraría cada informe en silencio.
4. `SENTRY_VERIFY_ON_BOOT` emite **un** evento marcado por proceso al arrancar, solo cuando el seguimiento quedó activo. Ausente o `false`, no emite nada.
5. Los dos procesos registran en el log de arranque en cuál de los tres estados están: sin configurar, configurado pero apagado, o reportando. Sin variable nueva y sin coste.
6. `validate-env.ts` conoce `SENTRY_VERIFY_ON_BOOT`, para que `tests/config-coverage.spec.ts` siga siendo cierto.
7. Las cuatro suites y los dos type checks pasan.

## Fuera de alcance

- **Qué se envía a Sentry.** La lista de permitidos, el `beforeSend` y la exclusión del formulario público no se tocan ([`features/0034`](0034-error-tracking-on-air-and-spa.md)).
- **`SENTRY_ENVIRONMENT`.** Se evaluó y no hace falta: el entorno de desarrollo de Railway deja las variables vacías, así que no hay nada que separar. Si algún día dev reporta, entonces sí.
- **La CSP.** El origen se deriva del DSN y esa lógica ya existe; este cambio solo hace que el DSN llegue.

## Prompt de ejecución

> Lee `Dockerfile.frontend` entero — fíjate en cómo `VITE_API_URL` se valida y por qué esa validación **no** debe copiarse — y después `backend/src/services/error-tracking.ts`, `backend/src/index.ts` y `backend/src/worker.ts`.
>
> **Paso 1 — el Dockerfile.** Añade `ARG VITE_SENTRY_DSN` y su `ENV` junto a los de `VITE_API_URL`, antes del `npm run build`. Valida solo la forma y solo si hay valor: vacío o ausente construye igual. Explica en un comentario por qué la regla es distinta de la de arriba, porque es justo lo que un lector va a querer cambiar.
>
> **Paso 2 — el estado en el log.** En `initErrorTracking`, registra al terminar cuál de los tres estados quedó, incluyendo el rol. Hoy solo hay línea para el caso de `NODE_ENV` de desarrollo; los otros dos son silencio, y "configurado" y "reportando" son estados distintos que es exactamente lo que se rompe callado.
>
> **Paso 3 — la comprobación opcional.** `SENTRY_VERIFY_ON_BOOT` a `true` emite un evento por proceso con el rol como etiqueta y una línea de log diciendo que lo hizo. Solo si `enabled`. Documenta en `.env.example` que es de un solo uso: se enciende, se confirman los dos procesos en Sentry y se apaga.
>
> **Paso 4 — tests.** Cubre: build sin la variable, con una válida y con una inválida (el comportamiento del Dockerfile puede razonarse en el test del script de validación si no hay forma barata de construir la imagen en CI); los tres estados del log; que la verificación no emite nada con `enabled` falso ni con la variable ausente. Añade la variable a `validate-env.ts` para que `config-coverage` siga pasando.
>
> **No toques**: `beforeSend`, la lista de permitidos, la exclusión del formulario público, `captureError`, ni la validación de `VITE_API_URL`.
>
> **Verifica** y reporta la salida real: `npm run check:node`, `npm run test:backend`, `npm run test:frontend`, `npm run test:integration`, `npm run test:e2e`, `npm run build --workspace=frontend`, `cd backend && npx tsc --noEmit`, `cd backend && npm run typecheck:tests`. Construye además `Dockerfile.frontend` de las tres maneras — sin la variable, con una válida y con una inválida — y comprueba que el bundle resultante contiene o no el DSN según corresponda.
>
> **Al salir**: `sot-sync`. En [08-operations](../docs/sot/08-operations.md) documenta que `VITE_SENTRY_DSN` es un **build arg** y no una variable de runtime, con las dos señales que lo comprueban desde fuera (hash del bundle y `connect-src`), y `SENTRY_VERIFY_ON_BOOT` con su ciclo de encendido y apagado. Pon este fichero en `**Status:** done` con Resultado.

## Resultado

**Hecho.** Los siete objetivos cumplidos, y el diagnóstico quedó cerrado por comparación en vez de por argumento.

**La prueba que lo demuestra.** Construida la imagen de la SPA de las tres formas, el `connect-src` que sale es:

| Build | `connect-src` |
|---|---|
| Sin `VITE_SENTRY_DSN` | `'self' https://api.docaiflow.com blob:` |
| Con una válida | `'self' https://api.docaiflow.com blob: https://o…ingest.de.sentry.io` |
| Con una inválida | no construye — `exit code: 1`, con el mensaje que dice qué hacer |

**El primero es idéntico, carácter a carácter, al que `app.docaiflow.com` sirve ahora mismo.** Eso convierte «la variable no llegó al build» de deducción en hecho comprobado. El DSN en el bundle: 0 ocurrencias sin la variable, 1 con ella.

**Por qué la regla es más débil que la de `VITE_API_URL`, que es lo que alguien va a querer «arreglar».** Aquella lanza cuando falta, y está bien: sin ella la SPA no habla con nada. Sentry es opcional a propósito — sin DSN el seguimiento está apagado, que es menos visibilidad y no un despliegue roto, igual que `validate-env.ts` trata el `SENTRY_DSN` del backend. Copiar la validación estricta haría imposible construir la imagen sin cuenta de Sentry. Lo que sí falla es **presente pero mal formado**, porque su modo de fallo es el silencio: el SDK se desactiva solo y el origen derivado sale mal, así que el navegador bloquea los informes sin decir nada.

**Un evento en cada arranque era la forma equivocada**, y se rechazó por escrito: la plataforma reinicia sola, Sentry cobra por evento, y un proyecto lleno de mensajes de arranque es uno donde nadie ve el fallo real. `SENTRY_VERIFY_ON_BOOT` es un interruptor que se enciende, se mira y se apaga. Exponerlo en `/health/ready` también se rechazó — es público y su contrato son estados y contadores de cola, nunca configuración.

**Una observación honesta sobre las suites.** Una tirada del backend dio dos fallos, `process-guards.spec.ts` y `error-tracking.spec.ts`, con duraciones de 8,4 s y 11,5 s frente a ~1 s habitual. No se reprodujeron: la suite completa pasa y los dos specs juntos pasaron tres veces seguidas. Era carga de la máquina, que tenía builds de Docker en paralelo — pero los dos son specs que lanzan procesos hijos, así que la fragilidad es real y ya hay dos filas parecidas en el backlog.

**Los tests del paso 4.** `tests/error-tracking-boot.spec.ts`, 7 casos, con el SDK y el logger mockeados y el módulo real — la otra suite lo mockea entero porque su pregunta es qué decide reportar el manejador de errores, y esta pregunta es qué hace `initErrorTracking`. Cubre los tres estados del log y las cuatro combinaciones del interruptor: ausente, un valor que no es `true`, encendido con el seguimiento apagado (no debe ser una segunda forma de activarlo), y encendido de verdad. Existen porque **el log de arranque es el único sitio donde los tres estados se distinguen** en la API y el worker, y una línea de log que nadie afirma es una línea que deja de escribirse sin que nadie lo note.

**Verificado** (salida real): backend 31 ficheros / 390 tests; frontend 56 / 479; integración 26 + 3 saltados / 260 + 10 saltados; e2e 53; `tsc --noEmit`, `typecheck:tests`, `build --workspace=frontend` y `check:node` limpios; y los tres builds de Docker con su inspección del bundle.

**Lo que queda del lado de la plataforma**: redesplegar la SPA para que el nuevo `ARG` tome el valor, y opcionalmente encender `SENTRY_VERIFY_ON_BOOT` una vez para confirmar `api` y `worker`. Las dos señales de comprobación están en [08-operations](../docs/sot/08-operations.md).
