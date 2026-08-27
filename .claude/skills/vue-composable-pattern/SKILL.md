---
name: vue-composable-pattern
description: Crear un composable o store Pinia nuevo en el frontend siguiendo los patrones ya establecidos en el proyecto (useAsyncAction para estado async, separación composable-vs-store, persistencia selectiva). Usar al añadir cualquier lógica de estado o de orquestación nueva en frontend/src/.
---

# Crear un composable o store nuevo (patrón del proyecto)

Ver `docs/sot/04-frontend-patterns.md` para el razonamiento completo con ejemplos reales. Esta skill es el checklist operativo al escribir código nuevo.

## Primero: ¿composable o store?

- **Store Pinia** (`frontend/src/stores/<nombre>.store.ts`) si el estado debe ser visible/compartido entre componentes no relacionados directamente (toolbar + canvas + panel lateral), o si necesita sobrevivir a que un componente se desmonte.
- **Composable** (`frontend/src/composables/use<Nombre>.ts`) si es lógica de orquestación de una operación (llamar a uno o más stores/servicios en secuencia) o estado puramente local a un componente/flujo. Un composable puede usar varios stores; no debería acumular su propio estado de negocio complejo — si empieza a necesitarlo, probablemente falta un store.

Ejemplo real de esta separación: `useFormManagement.ts` no tiene estado de negocio propio, solo `ref`s de UI, y orquesta `useFormsStore`, `useFormFieldsStore`, `useDocumentStore`.

## Al escribir un store con acciones async

Usa siempre `useAsyncAction` (`frontend/src/composables/useAsyncAction.ts`) para envolver acciones que hacen llamadas HTTP, en vez de escribir `try/loading/catch/finally` a mano:

```ts
async function miAccion(arg: string) {
  return useAsyncAction({ loading, error }, async () => {
    const response = await miServicio.hacerAlgo(arg)
    miEstado.value = response
    return response
  }, { fallbackMessage: 'Descripción de qué falló, en inglés, para el usuario' })
}
```

Esto es lo que hace que `loading`/`error` se comporten de forma consistente en toda la app (auth, forms, fields...). No reimplementar el wrapper.

## Persistencia

Decide explícitamente si el store necesita `pinia-plugin-persistedstate`. Si no lo necesita, decláralo explícito (`{ persist: false }` en las opciones de `defineStore`, como hace `editor.store.ts`) en vez de dejarlo implícito — hace la decisión visible para el siguiente que lea el fichero.

## Servicios HTTP

Si el composable/store necesita hablar con el backend, no llames a `fetch`/`axios` directamente desde ahí — usa o crea un servicio en `frontend/src/services/<recurso>.ts` (un fichero por recurso de dominio, ver `services/fields.ts`, `services/forms.ts`). Los tipos de request/response viven junto al servicio. Antes de inventar la forma del request/response, verifica el endpoint real siguiendo la skill `api-contract-guard`.

## Naming y ubicación

- Composable: `use<Verbo/Sustantivo>.ts`, un composable por fichero, export nombrado igual que el fichero.
- Store: `<nombre>.store.ts`, `use<Nombre>Store`, id de `defineStore('<nombre>', ...)` en minúscula sin sufijo `store`.
- Test junto al fichero (`<nombre>.spec.ts`), usando `@testing-library/vue` + `@pinia/testing`, testeando comportamiento observable (qué se llamó, qué estado resultó), no implementación interna — ver ejemplos en cualquier `*.spec.ts` existente en `frontend/src/`.
