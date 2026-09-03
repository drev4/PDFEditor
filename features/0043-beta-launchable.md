# 0043 — Lo que quedaba de la beta que no era una decisión del fundador

**Status:** done
**Priority:** P0 — cierra los últimos bloqueos de la beta del 2026-09-30 (BET-001, BET-002, BET-005, y la retención de OPS-004)
**Branch:** `feature/0043-beta-launchable`
**Related:** [`docs/runbooks/beta-launch.md`](../docs/runbooks/beta-launch.md) · [08-operations](../docs/sot/08-operations.md) · [`features/0042`](0042-scheduled-backups.md) · [`features/0040`](0040-beta-plan-limits.md) · [`features/0033`](0033-close-public-registration.md)

## Contexto

Tras [`features/0042`](0042-scheduled-backups.md) no quedaba **ningún bloqueo de la beta que fuera trabajo de código**. Quedaban cuatro cosas, y solo dos de ellas eran algo que este repositorio pudiera hacer:

- **BET-001**, el alcance de la beta por escrito con sus exclusiones visibles, soporte, métricas y criterio de rollback.
- **BET-002**, la auditoría del flujo de extremo a extremo — hecha contra producción el 2026-09-03, y **sin registrar en ninguna parte**.
- **BET-005**, el gate de apertura pública.
- La **retención** de los backups, que [`features/0042`](0042-scheduled-backups.md) dejó fuera a propósito.

Las otras dos siguen siendo del fundador y esta feature no las toca: la **dirección profesional publicable** y el **canal de soporte**.

## Por qué el enfoque obvio no basta

**Una lista de comprobación genérica no sirve para este despliegue.** «Registra, sube un PDF, mira que funcione» encuentra lo que se rompe con un error. Lo que ha ido mal en este producto durante toda la puesta en marcha **no produce error en ninguna parte**: un worker ausente llena la cola en silencio, un `VITE_SENTRY_DSN` puesto sin reconstruir no reporta nada, `TRUST_PROXY_HOPS` mal falla en las dos direcciones sin decirlo, y un backup sin credenciales de almacenamiento copia cero documentos y sale con 0. La lista tiene que estar construida **desde los fallos silenciosos**, y cada línea tiene que decir cómo se ve el fallo — o vuelve a ser mirar por encima.

**La retención no puede llegar como valor por defecto.** Es algo que borra copias de seguridad. Un número elegido por mí sería una política que nadie decidió. Lo que sí se puede automatizar es la **tarea**: un directorio por ejecución significaba que podar siempre fue «borra el más antiguo», y una tarea que nadie automatiza es un volumen que se llena.

**Y podar tiene tres propiedades que hay que acertar, no dos.** Solo después de una ejecución **con éxito**, o un backup que falla borraría buenos para hacerse sitio. Solo directorios que **este script reconoce** como suyos, porque en ese volumen puede haber una copia manual o un `lost+found`. Y un fallo al podar **no debe hacer fallar el job**: el backup ya está hecho, y devolver non-zero dispararía la alerta de la plataforma por una ejecución correcta — una alerta que grita sin motivo es una alerta que se silencia.

**El gate tiene que poder fallar.** Un gate cuyas líneas no son comprobables es una sensación. Y tiene que admitir el resultado incómodo: abrir con una línea en rojo es legítimo **como decisión registrada**, no como despiste.

## Objetivo

1. `docs/runbooks/beta-launch.md` existe y cubre alcance, exclusiones visibles, acceso, la comprobación repetible, soporte, rollback y el gate.
2. Cada línea de la comprobación dice **cómo se ve el fallo**, y las que corresponden a un fallo silencioso lo señalan.
3. Cada línea del gate es comprobable, y el documento dice qué hacer cuando una falla.
4. Lo que sigue siendo decisión del fundador aparece marcado como tal, no rellenado a mi criterio.
5. `BACKUP_KEEP` poda a las N ejecuciones más recientes; ausente conserva todo.
6. La poda ocurre solo tras una ejecución con éxito, solo sobre directorios propios, y su fallo no hace fallar el job.
7. Las cuatro suites y los dos type checks pasan.

## Fuera de alcance

- **La dirección profesional y el canal de soporte.** Marcados en el runbook; sin ellos las páginas legales no se publican.
- **Subir los backups a ningún sitio.** Decidido el 2026-09-03 y registrado con su coste aceptado.
- **La deriva PostgreSQL 18 / 16.** Fichada aparte; es mayor que la beta.
- **Métricas de producto.** `ANA-001`/`ANA-002` siguen abiertas y el runbook dice honestamente qué se puede ver hoy.

## Resultado

**Hecho.** Los siete objetivos cumplidos.

**La retención, verificada donde importa.** No solo en test unitario: contra el volumen real que ya llevaba cinco ejecuciones acumuladas, y con un fichero intruso puesto a propósito.

```
antes:  5 ejecuciones + no-me-toques.txt
BACKUP_KEEP=2:
   pruned 2026-09-03T12-47-59-802Z   (×4)
   Kept the 2 most recent backups, removed 4.
después: 2 ejecuciones + no-me-toques.txt
```

`no-me-toques.txt` sigue ahí. **En una función que borra, eso es la aserción que más vale** y tiene su propio test: reconocer el nombre es el permiso para eliminarlo. Los otros nueve casos cubren el orden cronológico por nombre — las marcas ISO ordenan lexicográficamente, así que no hay que parsear fechas — y que `0`, `-1`, `1.5` y `NaN` no puedan pedir borrar todo, porque podar a cero borraría el backup que se acaba de tomar.

**El runbook de la beta está construido desde los fallos silenciosos, y eso es lo que lo diferencia de una checklist.** Ocho comprobaciones, ordenadas para que el fallo de cada una se distinga del de la siguiente, y cada una con su columna de «cómo se ve cuando está mal». Cuatro corresponden a cosas que no producen error en ningún sitio, y las cuatro nos han pasado en las últimas horas: el worker, el DSN compilado, `TRUST_PROXY_HOPS` y el backup que copia cero documentos.

**Las exclusiones se declaran para decirlas al cliente, no para tenerlas apuntadas.** Un beta tester que descubre un hueco se siente engañado; uno al que se le contó evalúa el producto. La tabla incluye la frase con la que decir cada una, y señala la que hay que preguntar activamente: **el PDF cumplimentado por respuesta**, porque averiguar si es requisito de compra es literalmente para lo que existe la beta.

**Dos huecos quedan marcados en vez de rellenados**, y aparecen en el gate como líneas que pueden fallar: la dirección profesional — sin ella las páginas legales están escritas y no publicables — y el canal de soporte, con la consecuencia escrita al lado: **tú eres el sistema de notificaciones**, porque nada avisa a un cliente de que su endpoint se desactivó ni de que se acabó un límite, y una contraseña olvidada no se puede restablecer porque no hay email.

**Verificado** (salida real): backend 32 ficheros / **400** tests; frontend 56 / 479; integración 26 + 3 saltados / 260 + 10 saltados; e2e 53; `tsc --noEmit`, `typecheck:tests`, `build --workspace=frontend` y `check:node` limpios; la imagen `Dockerfile.backup` construye y la poda se ejecutó contra el volumen real.

**Lo que queda para abrir la beta y ya no es código:** el horario del backup y **el aviso ante salida distinta de cero**, decidir el número de `BACKUP_KEEP`, `restore:verify` contra producción cronometrado, la dirección profesional, el canal de soporte, y ejecutar el gate a los siete días.
