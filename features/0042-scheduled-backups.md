# 0042 — El backup tiene reloj, sitio donde caer y una imagen donde correr

**Status:** done
**Priority:** P0 — último bloqueo de la beta que es trabajo y no decisión (OPS-004)
**Branch:** `feature/0042-scheduled-backups`
**Related:** [08-operations](../docs/sot/08-operations.md) · [`docs/runbooks/backup-and-restore.md`](../docs/runbooks/backup-and-restore.md) · [`features/0037`](0037-backups-with-a-tested-restore.md) · [`features/0031`](0031-production-deployment.md)

## Contexto

[`features/0037`](0037-backups-with-a-tested-restore.md) construyó las herramientas y ensayó la restauración. Lo que dejó abierto, y sigue abierto, es lo que convierte una capacidad en un control: **no hay horario, así que no hay RPO** — el RPO *es* el intervalo, y no hay intervalo. Hoy la respuesta a «cuántos datos perderíamos» es «todos desde el último backup manual», y no ha habido ninguno.

El backlog decía que esto **no necesitaba construir el planificador, sino que el despliegue lo asumiera**. Al ir a escribir esa entrada de cron aparecieron dos cosas que lo impedían, y ninguna estaba fichada.

**Los artefactos caen en disco local.** `backup:db` escribe en `--out` o, por defecto, en `./backups` bajo el directorio de trabajo. Un job programado corre en un contenedor que se descarta al terminar, así que ese valor por defecto produce **un job que sale con 0 todas las noches y no conserva nada**. Un job en verde es peor que uno ausente: quita la presión de arreglarlo.

**Y no había dónde correrlo.** Ninguna de las tres imágenes trae `postgresql-client`. El runbook exige `pg_dump` de al menos la versión del servidor — PostgreSQL 16, y Debian bookworm trae 15, que no vale — pero ninguna imagen lo satisface. La entrada de cron no tenía contenedor que ejecutar.

## Por qué el enfoque obvio no basta

**Dos líneas en el cron no encadenan.** `backup:objects` necesita el manifiesto que produjo `backup:db`, y el nombre del manifiesto lleva dentro la marca de tiempo del volcado. Encadenarlos exige parsear la salida estándar o adivinar el nombre, y las dos cosas funcionan hasta el día que importa.

**Añadir `pg_dump` a la imagen de runtime es la tentación y es peor.** La imagen que sirve tráfico de clientes cargaría un cliente de base de datos y un repositorio apt de terceros que no usa nunca. El objetivo `backup` es hermano del de `migrations`, que ya existe con la misma lógica: misma build, nunca sirve tráfico.

**Subir los artefactos a algún sitio automáticamente sería peor que no hacerlo.** El runbook es explícito: una copia que vive con el proveedor que tiene la base de datos no es una copia off-site. Inventar aquí un destino de subida haría *parecer* que esa casilla está marcada. Durable dentro del proveedor es el paso honesto que esto cierra; el off-site sigue siendo un acto documentado y deliberado.

**Y no debe podar.** Borrar backups viejos no es algo que se deduzca de un valor por defecto.

## Objetivo

1. `npm run backup --workspace=backend` hace el backup entero en orden y sale distinto de cero si cualquiera de las dos mitades falla.
2. Cada ejecución tiene **su propio directorio** con marca de tiempo, de forma que el manifiesto de dentro es inequívoco por construcción y podar es `rm -rf` de un directorio.
3. **`BACKUP_DIR` es obligatoria y no tiene valor por defecto.** Sin ella el comando se niega y explica la trampa del contenedor efímero, no solo el nombre de la variable.
4. `Dockerfile.backend` gana un objetivo `backup` con `postgresql-client-16` de PGDG, que nunca sirve tráfico y falla al construir si el cliente falta.
5. Si el volcado falla, **la segunda mitad no se ejecuta**, y se dice.
6. `validate-env.ts` conoce `BACKUP_DIR`, para que `config-coverage` siga siendo cierto.
7. Las cuatro suites y los dos type checks pasan.

## Fuera de alcance

- **Subir a ningún sitio**, por lo dicho arriba. El off-site sigue siendo manual y documentado.
- **Podar backups viejos.** Es una decisión de retención del operador; el runbook la plantea.
- **Los avisos.** El control más barato no es código: que el job programado de la plataforma avise ante salida distinta de cero. Esto le da algo con lo que hacerlo — un código de salida honesto.
- **`restore:verify`** y las herramientas de [`features/0037`](0037-backups-with-a-tested-restore.md), que no se tocan.

## Resultado

**Hecho.** Los siete objetivos cumplidos, y los dos hallazgos de arriba aparecieron **al ejecutar**, no al planificar: la entrada de cron que el backlog daba por trivial no tenía ni dónde escribir ni dónde correr.

**Probado de verdad, no razonado.** Un backup completo dentro de la imagen `backup`, contra el PostgreSQL real, escribiendo en un volumen montado:

```
Backup 2026-09-03T11-25-54-718Z -> /backups/2026-09-03T11-25-54-718Z
✅ 0.8 MB, migración 20260903075909_uploads_owned_by_organization
✅ Backup complete
```

Y la propiedad que lo hace valer algo: **los artefactos sobrevivieron al contenedor.** Un segundo contenedor leyó el volumen después de que el primero se borrara, y dos ejecuciones dejan dos directorios:

```
/backups/2026-09-03T11-22-38-879Z/   vuepdf-….dump  ….manifest.json  ….dump.objects/
/backups/2026-09-03T11-25-54-718Z/
```

Sin `BACKUP_DIR`, salida `1` y el mensaje que explica por qué se quitó el valor por defecto.

**Lo que los tests sujetan y lo que no.** `tests/backup-run.spec.ts`, 6 casos, cubre el rechazo y la resolución del manifiesto — incluido que **se niegue cuando hay más de uno en vez de adivinar**, porque cada ejecución tiene su directorio precisamente para que eso no pase, y si pasa la suposición está rota. El camino feliz no es testeable sin `pg_dump`, una base de datos y un bucket, y por eso se verificó ejecutándolo: ningún test unitario produce la evidencia de arriba.

**Un hallazgo lateral sobre la base de datos de desarrollo**, no sobre el backup, y el script lo dice con esas palabras: **150 formularios referencian documentos que no están en el almacenamiento**. Restaurarían con un PDF que no se puede abrir. Es de esperar en un entorno de desarrollo donde el almacenamiento se ha reiniciado, y es exactamente lo que la comprobación cruzada de `restore:verify` existe para detectar. En producción sería un incidente.

**Verificado** (salida real): backend 32 ficheros / 396 tests; frontend 56 / 479; integración 26 + 3 saltados / 260 + 10 saltados; e2e 53; `tsc --noEmit`, `typecheck:tests`, `build --workspace=frontend` y `check:node` limpios; la imagen `backup` construye y `pg_dump --version` pasa dentro de ella.

**Un fallo que la primera ejecución en Railway destapó, y que mi verificación no habría encontrado.** El `CMD` era `npm run backup`, y ese script empieza por `npm run build`. En un terminal es lo correcto; en un job programado es **recompilar TypeScript cada noche** sobre un `dist` que el stage `build` ya había producido. Peor: no hay `tsconfig.json` en la raíz del repositorio, así que un `tsc` cuyo directorio de trabajo acabe ahí no compila — imprime su ayuda, que es exactamente lo que apareció en el log del despliegue.

Yo verifiqué ejecutando el script compilado y ejecutando la imagen, y las dos veces funcionó porque la compilación tuvo éxito. Lo que no verifiqué es que **la compilación no debía estar ahí en absoluto**. El `CMD` es ahora `node backend/dist/scripts/backup-run.js`: un trabajo que hace copias de seguridad no debe tener un compilador en su camino crítico. `npm run backup` sigue existiendo para un humano.

**Y un segundo fallo mío, de la misma familia: el job vivía en un sitio que Railway no puede alcanzar.** Lo puse como target `backup` dentro de `Dockerfile.backend`, tres líneas debajo de un comentario que dice que *«las plataformas que construyen el Dockerfile sin un target explícito — Railway entre ellas — reciben la imagen de servicio»*. Lo leí al escribir el stage y no lo apliqué. Railway ignoró los stages, cayó en su propio constructor y ejecutó un `tsc` pelado en la raíz del repositorio, donde no hay `tsconfig.json`: imprimió su ayuda y no construyó nada.

La convención del repositorio ya estaba resuelta y era la contraria: **un fichero por job**, que es por lo que existe `Dockerfile.migrations`. Ahora existe `Dockerfile.backup` como su hermano, y el target desaparece de `Dockerfile.backend`. Se construye **sin target**, que es la única forma en que Railway lo va a construir.

Las dos correcciones comparten forma con las trampas que esta sesión lleva encontrando: la configuración parecía correcta, el despliegue salía en verde, y lo que fallaba no se parecía a lo que estaba roto.

**Lo que sigue siendo del despliegue, y ahora sí puede hacerse:** programar el job con `BACKUP_DIR` apuntando a un volumen montado, y que la plataforma avise ante salida distinta de cero. Y lo que este cambio deliberadamente no resuelve: **la copia off-site sigue sin existir**, y el RPO que esto habilita es «el intervalo que pongas», no un número que el repositorio pueda afirmar.
