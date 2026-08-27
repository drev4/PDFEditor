---
name: feature-spec-writer
description: Crear un fichero nuevo en features/ para una tarea del backlog (docs/NEXT_TASKS.md), y crear la rama de git correspondiente al empezar a implementarla. Usar cuando el usuario pida "preparar", "especificar" o "definir el prompt de" una feature o fix concreto, o pida "empezar"/"implementar" una feature que ya tiene fichero en features/.
---

# Escribir un fichero de feature en features/ y arrancar su rama

Ver `features/README.md` para la convención completa (naming, plantilla, flujo backlog→merge). Esta skill cubre dos momentos distintos del mismo ciclo de vida: crear el spec, y arrancar la implementación.

## Cuándo usarla

Cuando una tarea de `docs/NEXT_TASKS.md` va a abordarse a continuación — no antes (no generar specs para todo el backlog de golpe, se desactualizan antes de ejecutarse) y no después (si ya se implementó, esto no aplica, actualiza el SOT en su lugar vía la skill `sot-sync`).

## Pasos

1. Localiza la tarea en `docs/NEXT_TASKS.md` y confirma su prioridad (P0/P1/P2) y el "por qué" ya anotado ahí.
2. Investiga el código real relevante **antes** de escribir el fichero — lee los ficheros concretos que el cambio va a tocar. Un prompt de ejecución que dice "arregla el bug de X" sin nombrar la función y el fichero exactos no es autocontenido; obliga a quien lo ejecute a redescubrir lo que ya se sabe ahora.
3. Determina el siguiente número secuencial mirando los ficheros existentes en `features/` (`ls features/ | sort`).
4. Escribe el fichero con la plantilla de `features/README.md`: Contexto (2-4 frases, no un ensayo — el detalle largo vive en `docs/sot/`), Objetivo (criterios de aceptación verificables, no vagos), Prompt de ejecución. El campo `Rama` se deja vacío en este paso — se rellena en el siguiente, al arrancar.

## Cómo escribir un buen prompt de ejecución

- **Autocontenido de verdad**: nombra rutas de fichero y funciones concretas (`backend/src/routes/form-fields.ts`, función `formFieldsRouter.post('/:formId/fields/bulk', ...)`), no descripciones aproximadas. Quien lo ejecute puede ser una sesión de Claude Code sin memoria de esta conversación.
- **Incluye verificación**: qué test correr y cómo (`npm run test:backend`, o un fichero de test concreto), no solo qué construir. Si la tarea requiere tests nuevos, dilo explícitamente y sigue el patrón de test ya existente en el área tocada (ver ejemplos reales en `backend/tests/*.spec.ts` o `frontend/src/**/*.spec.ts`).
- **Acota el alcance**: si el cambio podría tentar a un refactor más amplio del pedido, dilo explícitamente ("no toques X", "Y queda fuera de este cambio, es tarea aparte").
- **Cierra el loop de documentación**: el prompt debe terminar pidiendo actualizar `docs/sot/` (vía skill `sot-sync`) si el cambio es estructural, y marcar el propio fichero de feature como `**Estado:** hecho` al terminar.
- Ver `features/0001-fix-bulk-save-data-loss.md` como ejemplo de referencia del nivel de detalle esperado.

## Qué NO hacer al escribir el spec

- No escribir el prompt en abstracto sin haber leído el código real que va a tocar — un prompt inventado sobre cómo "probablemente" funciona el código es peor que no tener prompt, porque da falsa confianza de que la tarea está bien especificada.
- No crear specs para varias tareas del backlog a la vez salvo que el usuario lo pida explícitamente — una por una, cuando se van a abordar.

## Al empezar a implementar una feature (`Estado: backlog` → `en curso`)

Este es el segundo momento en el que aplica esta skill: cuando toca ponerse a construir lo que describe un fichero de `features/NNNN-slug.md` ya existente.

1. `git status` primero — si hay cambios sin commitear que no son de esta feature, no arrancar encima; avisar y resolver antes (stash o commit) siguiendo la protocolo general de seguridad con git.
2. `git fetch origin` y crear la rama desde `develop`, no desde `main` ni desde la rama en la que se esté parado:
   ```
   git checkout -b feature/NNNN-slug origin/develop
   ```
   El nombre de la rama es exactamente `feature/` + el nombre del fichero sin `.md` (mismo número y slug).
3. Esto se hace **sin pedir confirmación explícita** — crear una rama local es reversible y no toca nada compartido. Push del branch y apertura de PR sí requieren confirmación, como cualquier acción que publica algo fuera del entorno local (ver protocolo de acciones arriesgadas).
4. Actualizar el fichero de la feature: `Estado: en curso`, `Rama: feature/NNNN-slug`.
5. A partir de aquí, seguir el "Prompt de ejecución" del propio fichero como guía de implementación.
6. Al terminar y mergear (fuera del alcance de esta skill, pero para cerrar el ciclo): `Estado: hecho`, aplicar `sot-sync` si el cambio fue estructural, tachar la entrada en `docs/NEXT_TASKS.md`.
