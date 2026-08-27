# Source of Truth (SOT) — VuePDF Forms Platform

Este directorio es la **fuente única de verdad** del proyecto: conocimiento, contexto de negocio, arquitectura, patrones de código y visión de producto. Sustituye a `TECHNICAL_SPECS.md` (obsoleto, dejado como referencia histórica) como documento de arquitectura, y a la sección de endpoints de `API_DOCUMENTATION.md` como referencia de API.

Está pensado para dos lectores: una persona nueva en el proyecto, y Claude Code trabajando en sesiones futuras (junto con las skills en `.claude/skills/`, que referencian estos documentos).

## Índice

| Documento | Contenido |
|---|---|
| [01-product-and-business.md](./01-product-and-business.md) | Qué es el producto, a quién se vende (B2B/B2C), modelo de negocio, estado actual vs. visión |
| [02-architecture-and-domain.md](./02-architecture-and-domain.md) | Arquitectura del sistema, monorepo, modelo de datos (Prisma), flujos de datos |
| [03-backend-patterns.md](./03-backend-patterns.md) | Patrones reales de Express/Prisma/Zod con ejemplos del código, + tecnologías avanzadas a incorporar |
| [04-frontend-patterns.md](./04-frontend-patterns.md) | Patrones reales de Vue 3/Pinia/composables con ejemplos del código, + tecnologías avanzadas a incorporar |
| [05-api-reference.md](./05-api-reference.md) | Referencia canónica y verificada de todos los endpoints de la API |
| [06-saas-target-architecture.md](./06-saas-target-architecture.md) | Visión objetivo: multi-tenancy, planes, facturación, roles — **aún no implementado** |
| [07-conventions.md](./07-conventions.md) | Convenciones de código, tests, commits y flujo de trabajo observadas en el repo |

## Cómo mantener esto vivo

Esta documentación se degrada si no se actualiza junto con el código. Reglas:

1. **Toda feature que cambie el modelo de datos, la API o un patrón arquitectónico** debe actualizar el documento del SOT correspondiente en el mismo cambio (ver skill `sot-sync`).
2. **Ningún endpoint se documenta en `05-api-reference.md` sin verificarlo contra el código de `backend/src/routes/`** (ver skill `api-contract-guard`) — así es como se detectó y corrigió el desfase con `API_DOCUMENTATION.md` en 2026-08.
3. Las secciones marcadas como **`[TARGET — no implementado]`** describen intención, no realidad. Antes de asumir que algo existe, comprobarlo en el código.
4. El backlog vivo está en [`docs/NEXT_TASKS.md`](../NEXT_TASKS.md). Las features que pasan de "backlog" a "en curso" obtienen un fichero en [`features/`](../../features/README.md) con su prompt de ejecución.

## Estado del código a fecha 2026-08-28

Verificado leyendo el código fuente, no asumido:

- **Implementado y funcionando:** auth (JWT+bcrypt), CRUD de forms, editor de campos con 5 tipos, extracción automática de campos AcroForm existentes al subir un PDF (`pdf-processor.ts`), embebido de campos como AcroForm al guardar (para exportar el PDF rellenable), formulario público sin login, validación de respuestas por tipo de campo, export CSV, dashboard de respuestas.
- **No implementado (mencionado como "future" en specs antiguas):** escaneo de virus en uploads, caché Redis, CDN para PDFs.
- **No implementado (no existe en absoluto, ni mencionado):** multi-tenancy, planes/suscripciones, facturación, roles más allá de "dueño del form", API pública con API keys, cualquier mecanismo de monetización. Esto es relevante porque el objetivo del proyecto es venderlo como SaaS — ver [06-saas-target-architecture.md](./06-saas-target-architecture.md).
