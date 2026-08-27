# Convenciones observadas

Estas son convenciones **detectadas en el código y el historial de git**, no inventadas — se documentan para que se sigan manteniendo, no para introducir cambios de estilo.

## Commits

Conventional Commits, ya en uso consistente (`git log`): `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, con scope opcional entre paréntesis (`feat(backend): ...`, `feat(frontend): ...`). Predomina `feat` (la mayoría del historial reciente es features nuevas, no arreglos), lo cual es coherente con un proyecto todavía en construcción del MVP.

**Los commits no llevan `Co-Authored-By` ni ninguna otra marca de autoría de IA** — decisión explícita del usuario (2026-08-28): los commits no deben dejar rastro de quién/qué los ha realizado. Cualquier sesión de Claude Code que trabaje en este repo debe omitir ese trailer al hacer commits aquí, aunque su configuración por defecto sea añadirlo.

Merges a `main` vienen de PRs desde `develop` (ver historial: "Merge pull request #N from drev4/develop") — el flujo es `feature branch → develop → main` cuando hay PR de por medio, aunque también hay commits directos.

**Desde 2026-08-28, este flujo está formalizado para toda feature con fichero en `features/`:** la rama se llama igual que el fichero (`feature/NNNN-slug` para `features/NNNN-slug.md`), se crea desde `develop`, y el PR va contra `develop`. Detalle completo y quién crea la rama (automático) en [`features/README.md`](../../features/README.md#flujo-completo-de-backlog-a-merge) y en la skill `feature-spec-writer`.

## Estructura de ficheros

- Backend: un fichero por recurso en `routes/`, sin capa de "controllers" separada de las rutas — el handler de Express contiene la lógica directamente. Servicios con lógica no trivial (`pdf-processor.ts`, `csv-exporter.ts`, `db.ts`) en `services/`. Sin capa de "repositorio" — Prisma se llama directamente desde rutas y servicios.
- Frontend: `composables/` (lógica reutilizable), `stores/` (Pinia, sufijo `.store.ts`), `services/` (HTTP por recurso), `views/` (una por ruta), `components/` agrupados por dominio (`auth/`, `forms/`, `pdf/`, `form-fields/`, `editor/`, `search/`, `toolbars/`).
- Tests junto al código para frontend (`*.spec.ts` al lado del fichero que testean); en backend viven aparte, en `backend/tests/`, no junto a `src/`. **No mezclar estos dos patrones** — al añadir un test de backend va en `backend/tests/`, no junto al fichero de `src/`.

## Naming

- Rutas de Express: kebab-case en la URL (`/fields/bulk`), camelCase en variables/parámetros (`formId`, `fieldId`).
- Componentes Vue: PascalCase (`FormSavePanel.vue`, `PublicFormFieldItem.vue`).
- Stores Pinia: `use<Nombre>Store`, fichero `<nombre>.store.ts`, id de store en `defineStore('<nombre>', ...)` en minúscula sin sufijo.
- Composables: `use<Verbo/Sustantivo>`, un composable por fichero, mismo nombre.
- El código está en inglés (nombres de variables, funciones, comentarios técnicos); algunos placeholders de UI visible al usuario final están en español (`"Escribe aquí..."`, `"Buscar en el documento..."`) — inconsistencia real detectada, no un patrón deliberado. Si el producto se va a vender internacionalmente, esto es candidato a resolverse con i18n (ver `docs/NEXT_TASKS.md`) en vez de arreglarse ad-hoc string por string.

## Testing

- Frontend: Vitest + `@testing-library/vue` + `@pinia/testing`, 29 specs colocados junto al código. Filosofía: testear comportamiento observable (llamadas HTTP esperadas, estado resultante), no implementación interna.
- Backend: Vitest + `supertest` (tests de integración de rutas HTTP reales) + `vitest-mock-extended` (mocks de Prisma), en `backend/tests/`, un fichero por recurso (`auth.spec.ts`, `forms.spec.ts`, `fields.spec.ts`, `responses.spec.ts`, `pdf-processor.spec.ts`, más los middlewares).
- E2E: Playwright, 6 specs en `e2e/`, cubren los flujos completos (auth, gestión de forms, subida de PDF, flujo de formulario público, manejo de errores).

## Gap detectado: no hay lint configurado

El script raíz `npm run lint --workspaces --if-present` existe pero **ningún workspace define un script `lint`**, y no hay `.eslintrc`/`eslint.config.*` en el repo. Hoy `npm run lint` no hace nada en ningún workspace. Esto es una laguna real, no una convención — ver `docs/NEXT_TASKS.md`. Al añadirlo, usar `eslint.config.js` (flat config), no `.eslintrc`, dado que el resto del stack ya está en versiones recientes (Vite 7, TS 5.6/5.7) que asumen tooling moderno.

## Variables de entorno

`backend/.env` y `frontend/.env` (no comprometidos, hay que crearlos a mano según el README) — no hay `.env.example` en el repo pese a que el README documenta las variables esperadas. Añadir `.env.example` en ambos workspaces es trivial y evita que cada desarrollador nuevo tenga que copiar el bloque del README a mano.
