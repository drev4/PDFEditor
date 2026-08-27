# Patrones de frontend (con ejemplos reales del repo)

## 1. Composables para lógica, Pinia stores para estado compartido

Separación consistente en `frontend/src/composables/` (17 composables) vs. `frontend/src/stores/` (9 stores Pinia). Regla observada: si el estado necesita ser visible desde varios componentes no relacionados (toolbar + canvas + panel lateral), va en un store; si es orquestación de una operación (subir un PDF, guardar un formulario) que usa uno o más stores, va en un composable. Ejemplo, `useFormManagement.ts` no tiene estado propio de negocio — solo `ref`s de UI (`isInitializing`, `isUploading`, `uploadProgress`) y coordina tres stores (`useFormsStore`, `useFormFieldsStore`, `useDocumentStore`):

```ts
export function useFormManagement() {
  const formsStore = useFormsStore()
  const formFieldsStore = useFormFieldsStore()
  const documentStore = useDocumentStore()
  const isInitializing = ref(false)

  async function loadForm(formId: string) {
    try {
      isInitializing.value = true
      const form = await formsStore.fetchForm(formId)
      formFieldsStore.setCurrentForm(form.id)
      if (form.fields?.length) formFieldsStore.loadFieldsFromForm(form.fields)
      return form
    } finally {
      isInitializing.value = false
    }
  }
  // ...
}
```

No crear un composable "god object" que mezcle estado propio complejo con orquestación — si un composable empieza a necesitar su propio store para persistir estado entre montajes de componente, es una señal de que en realidad falta un store.

## 2. Manejo de errores async centralizado: `useAsyncAction`

En vez de repetir `try/loading/catch/finally` en cada acción de cada store, se envuelve con `useAsyncAction` (`composables/useAsyncAction.ts`), que además distingue `ApiError` (mensaje de servidor) de errores genéricos:

```ts
export async function useAsyncAction<T>(
  state: { loading: Ref<boolean>; error: Ref<string | null> },
  action: () => Promise<T>,
  options: { fallbackMessage?: string; skipLoading?: boolean } = {}
): Promise<T> {
  if (!options.skipLoading) state.loading.value = true
  state.error.value = null
  try {
    return await action()
  } catch (e) {
    state.error.value = e instanceof ApiError ? e.message
      : e instanceof Error ? (e.message || options.fallbackMessage) : options.fallbackMessage
    throw e
  } finally {
    if (!options.skipLoading) state.loading.value = false
  }
}
```

Uso típico dentro de un store (`auth.store.ts`):

```ts
async function login(email: string, password: string) {
  return useAsyncAction({ loading, error }, async () => {
    const response = await authService.login(email, password)
    user.value = response.user
    return response
  }, { fallbackMessage: 'Login failed' })
}
```

**Al añadir una acción async nueva a cualquier store, usar este wrapper — no reimplementar el try/catch a mano.** Es lo que hace que `loading`/`error` se comporten igual en toda la app.

## 3. Servicios HTTP tipados por dominio, sin cliente genérico "todo-en-uno"

`frontend/src/services/` tiene un fichero por recurso (`auth.ts`, `forms.ts`, `fields.ts`, `upload.ts`, `responses.ts`), cada uno exportando un objeto con métodos tipados que llaman a un `api` compartido (`services/api.ts`, wrapper de fetch/axios con manejo de `ApiError`). Los tipos de request/response (`CreateFieldData`, `UpdateFieldData`, `FieldResponse`) viven junto al servicio, no en un fichero central de tipos — así el servicio es la fuente de verdad de la forma del contrato HTTP, y `05-api-reference.md` se verifica contra estos ficheros, no al revés.

`upload.ts` es la excepción deliberada: usa `XMLHttpRequest` en vez del cliente `api` compartido porque necesita el evento `progress` para la barra de subida, que `fetch` no expone de forma nativa.

## 4. Coordenadas: canvas vs. PDF

Los campos se posicionan y guardan en **coordenadas de canvas** (`position: {x, y, width, height, page}` en `Field`, ver [02-architecture-and-domain.md](./02-architecture-and-domain.md)), pero `pdf-processor.ts` en el backend trabaja en coordenadas de página PDF (origen abajo-izquierda, en puntos) al extraer/embeber AcroForm. La conversión usa un factor de escala fijo (`DEFAULT_SCALE = 1.5`) coherente con cómo PDF.js renderiza la página en el frontend. **Si se cambia el zoom/escala de renderizado en el frontend (`usePDFRendering.ts`), hay que revisar que siga siendo consistente con `DEFAULT_SCALE` en el backend** — hoy es un acoplamiento implícito entre dos ficheros en dos workspaces distintos, no hay un valor compartido ni un test que lo verifique end-to-end.

## 5. Persistencia de estado selectiva con Pinia

`pinia-plugin-persistedstate` se usa por store, no globalmente (`editor.store.ts` declara explícitamente `{ persist: false }` en sus opciones). Al crear un store nuevo, decidir explícitamente si su estado debe sobrevivir a un refresh (ej. sesión de auth: sí; preview de una imagen a medio arrastrar: no) en vez de dejar el default implícito.

## 6. Testing: Testing Library sobre comportamiento, no implementación

29 specs en `frontend/src/**/*.spec.ts` con Vitest + `@testing-library/vue` + `@pinia/testing`. El patrón es testear composables/stores/servicios por su contrato público (inputs → llamadas HTTP esperadas → estado resultante), como en `fields.spec.ts` (`expect(api.post).toHaveBeenCalledWith('/forms/form-1/fields', mockFieldData)`), no el detalle interno de cómo se construye el payload.

## 7. Tecnologías avanzadas a incorporar (frontend)

1. **TanStack Query (Vue Query)** para el estado de servidor (`forms`, `responses`) en vez de que cada store gestione manualmente `loading`/`error`/cache — daría invalidación automática, refetch en background y deduplicación de requests gratis, sustituyendo buena parte de `useAsyncAction` para las llamadas de lectura.
2. **VueUse** — varios composables ad-hoc (`useDragAndDrop`, `useGridOverlay`, `useToolbarDrag`) reimplementan lógica que VueUse ya resuelve de forma testeada (`useDraggable`, `useElementBounding`); evaluar reemplazo caso a caso, no en bloque.
3. **Web Workers para `pdf-lib`/PDF.js en el cliente** — el embebido/parseo de PDFs grandes bloquea el hilo principal hoy; mover a un worker mejora la percepción de rendimiento del editor sin cambiar la lógica.
4. **Compartir los tipos de dominio con el backend** (ver punto 5 de `03-backend-patterns.md`) para que `CreateFieldData` en el frontend y el Zod schema del backend no puedan divergir en silencio como ya pasó con la documentación.
5. **Vue DevTools + tracing de Pinia en producción (con flag)** para depurar reportes de bugs de clientes B2B sin acceso a la consola del navegador del cliente.
