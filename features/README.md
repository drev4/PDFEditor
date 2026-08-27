# Features

Cada fichero de esta carpeta es una feature o fix concreto, listo para ejecutarse: describe el qué y el porqué, y trae el prompt exacto que se le da a Claude Code para implementarlo. Es el paso intermedio entre `docs/NEXT_TASKS.md` (backlog, una línea por tarea) y una sesión de trabajo real.

## Cuándo crear un fichero aquí

Cuando una tarea de `docs/NEXT_TASKS.md` se va a abordar a continuación (no antes — no crear specs para todo el backlog de golpe, se desactualizan). Al terminarla, no se borra el fichero: se marca como hecha en la cabecera (ver plantilla) y queda como registro de qué se pidió y por qué, junto al commit/PR que lo implementó.

## Naming

`NNNN-slug-corto.md`, numeración secuencial de 4 dígitos sin reutilizar (`0001-...`, `0002-...`), slug en kebab-case describiendo el resultado, no el ticket (`0001-fix-bulk-save-data-loss.md`, no `0001-bug-123.md`).

La misma pareja número+slug nombra la rama de git de la feature (ver "Flujo completo" abajo): el fichero `0001-fix-bulk-save-data-loss.md` se implementa en la rama `feature/0001-fix-bulk-save-data-loss`. Esto hace que, dado un PR o una rama, se pueda encontrar su spec sin buscar, y viceversa.

## Plantilla

```markdown
# NNNN — Título

**Estado:** backlog | en curso | hecho
**Prioridad:** P0 | P1 | P2 (ver docs/NEXT_TASKS.md)
**Rama:** feature/NNNN-slug-corto (se rellena al pasar a "en curso")
**Relacionado:** enlaces a docs/sot/*.md relevantes

## Contexto

Por qué existe esta tarea. Qué se descubrió, qué la motiva. 2-4 frases — el detalle largo ya vive en el SOT, aquí solo el resumen necesario para que el prompt de abajo tenga sentido sin releer todo.

## Objetivo

Qué tiene que ser verdad cuando esto esté terminado. Criterios de aceptación concretos y verificables, no una descripción vaga.

## Prompt de ejecución

> El prompt exacto, listo para pegar en una sesión de Claude Code nueva o para lanzar como tarea. Debe ser autocontenido: rutas de fichero concretas, qué leer primero, qué NO tocar, cómo verificar que quedó bien (tests a correr, comando a ejecutar).
```

## Reglas para escribir el prompt de ejecución

- Autocontenido: quien lo ejecute puede no tener el contexto de esta conversación. Nombrar ficheros y funciones concretas, no "el bug que encontramos antes".
- Incluir cómo verificar el resultado (qué test correr, qué comando), no solo qué construir.
- Acotar el alcance explícitamente ("no tocar X", "no tocar Y") cuando el cambio podría tentar a un refactor más amplio del que se pidió.

## Flujo completo: de backlog a merge

Encaja con el flujo de ramas ya usado en el repo (`feature/* → PR → develop → PR → main`, ver `docs/sot/07-conventions.md`).

1. **Backlog** — la tarea vive como una fila en `docs/NEXT_TASKS.md`.
2. **Spec** — cuando se va a abordar a continuación, se crea `features/NNNN-slug.md` (skill `feature-spec-writer`) con `Estado: backlog` y sin `Rama` todavía.
3. **Arranque** — al empezar a implementarla, se crea automáticamente la rama desde `develop`:
   ```
   git fetch origin
   git checkout -b feature/NNNN-slug origin/develop
   ```
   Esto lo hace Claude directamente al empezar a trabajar la feature, sin pedir confirmación explícita cada vez (es una acción reversible y de bajo riesgo — crear una rama no toca nada existente). Se actualiza el fichero: `Estado: en curso`, `Rama: feature/NNNN-slug`.
4. **Implementación** — se ejecuta el prompt del fichero sobre esa rama, aplicando las skills que correspondan (`vue-composable-pattern`, `prisma-schema-migration`, `api-contract-guard`).
5. **Commits** — Conventional Commits sobre la rama, como ya es el patrón del repo (ver `docs/sot/07-conventions.md`).
6. **Pull Request** — contra `develop` (no contra `main` directamente — así se hizo históricamente en este repo). Push y creación de PR siguen necesitando confirmación explícita, igual que cualquier acción que publique algo fuera del entorno local.
7. **Cierre** — al mergear el PR: `Estado: hecho` en el fichero de feature, `sot-sync` actualiza `docs/sot/` si el cambio fue estructural, se tacha/quita la entrada de `docs/NEXT_TASKS.md`. La rama local y remota se pueden borrar tras el merge (confirmar antes de borrar la remota).
8. **Release** — periódicamente `develop → main` vía PR, igual que los PRs #2 y #3 ya mergeados en este repo — esto no cambia con el flujo de features individuales.

### Qué pasa si la tarea es tan pequeña que no justifica un fichero de spec

No todo cambio necesita pasar por `features/` (un typo, un ajuste de una línea no lo necesita). Pero **toda rama `feature/*` que sí tenga fichero de spec debe nombrarse igual que él** — si se crea una rama para algo sin fichero de spec, usar igualmente el prefijo `feature/` con un slug descriptivo corto, sin número.
