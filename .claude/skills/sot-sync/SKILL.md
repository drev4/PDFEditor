---
name: sot-sync
description: Mantener docs/sot/ (Source of Truth del proyecto) actualizado tras cambios que afecten al modelo de datos, la API, la arquitectura o el stack. Usar al terminar cualquier feature que toque backend/prisma/schema.prisma, backend/src/routes/, o introduzca un patrón nuevo de frontend/backend digno de documentarse.
---

# Sincronizar el SOT tras un cambio de código

`docs/sot/` es la fuente única de verdad del proyecto (ver `docs/sot/README.md`). Se degrada si el código avanza y la documentación no. Esta skill es el checklist a correr antes de dar una tarea por terminada cuando el cambio toca algo estructural.

## Cuándo aplica

- Se añadió, quitó o modificó un modelo en `backend/prisma/schema.prisma` → revisar `docs/sot/02-architecture-and-domain.md`.
- Se añadió, quitó o cambió la forma de un endpoint en `backend/src/routes/*.ts` → revisar `docs/sot/05-api-reference.md`. **No se documenta un endpoint sin abrir el fichero de la ruta y leer el código real** — así se detectó y arregló el desfase de `API_DOCUMENTATION.md` con la implementación real en 2026-08 (ver skill `api-contract-guard`, que cubre esto en detalle).
- Se introdujo un patrón nuevo de backend (nuevo tipo de servicio, nueva forma de manejar errores, nueva estrategia de validación) → revisar `docs/sot/03-backend-patterns.md`.
- Se introdujo un patrón nuevo de frontend (nuevo tipo de composable/store, nueva librería de estado de servidor, etc.) → revisar `docs/sot/04-frontend-patterns.md`.
- Se resolvió o se dejó constancia de un riesgo/bug conocido documentado en el SOT (ej. el de `bulkSave` en `03-backend-patterns.md`) → actualizar esa sección para que refleje el estado real, no dejarla como "pendiente" si ya se arregló.
- Se avanzó una pieza de la arquitectura SaaS objetivo (`docs/sot/06-saas-target-architecture.md`, ej. se añadió `Organization`) → mover esa pieza de "target, no implementado" a documentado como real en `02-architecture-and-domain.md`, y actualizar `06` para que dependa de lo siguiente en el orden de construcción.

## Cómo hacerlo

1. Identifica qué fichero(s) de `docs/sot/` hablan de la zona de código que cambió (usa el índice en `docs/sot/README.md`).
2. Relee la sección afectada del SOT y compárala línea a línea con el código nuevo — no confíes en tu memoria de lo que decía antes.
3. Edita solo lo que cambió. No reescribas el documento entero ni le añadas relleno — el resto del SOT sigue siendo válido.
4. Si el cambio resuelve una tarea listada en `docs/NEXT_TASKS.md`, quítala de ahí (o márcala hecha) y, si tenía fichero en `features/`, actualiza su `**Estado:**` a `hecho`.
5. Si el cambio introduce deuda técnica nueva o un riesgo nuevo (no lo arregla, lo crea), añádelo a `docs/NEXT_TASKS.md` en la prioridad que corresponda, con una frase de "por qué" — no lo dejes solo en la cabeza de quien hizo el cambio.

## Qué NO hacer

- No documentar features que "van a construirse pronto" como si ya existieran — eso es exactamente el tipo de desfase que esta skill existe para evitar. Lo aspiracional va en `06-saas-target-architecture.md` marcado explícitamente `[TARGET — no implementado]`.
- No crear ficheros nuevos en `docs/sot/` sin necesidad — si el contenido encaja en un documento existente, va ahí. Un fichero nuevo solo si es un dominio temático que ninguno de los 7 documentos actuales cubre.
