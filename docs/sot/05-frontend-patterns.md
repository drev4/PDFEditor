# Frontend patterns

Real patterns from `frontend/src`, with the reasoning. The operational checklist for writing new state code is the `frontend-state-pattern` skill.

## 1. Composables orchestrate, stores hold shared state

There are 17 composables in `composables/` and 9 Pinia stores in `stores/`. The dividing line, observed consistently:

- **A store** when the state must be visible to components that are not related in the tree (toolbar, canvas and side panel all reading the same selection), or must outlive a component unmount.
- **A composable** when it is the orchestration of an operation across one or more stores and services, or state that is genuinely local to one flow.

`useFormManagement.ts` is the reference example. It holds no business state — only UI refs (`isInitializing`, `isUploading`, `uploadProgress`) — and sequences three stores:

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
}
```

**Signal that the line has been crossed:** a composable that needs its own state to survive between component mounts is a store that has not been written yet. Do not solve it with a module-level `ref` inside the composable file — that is a store with no devtools, no persistence policy and no test seam.

## 2. Async state goes through `useAsyncAction`

Instead of repeating `loading` / `try` / `catch` / `finally` in every store action, everything async is wrapped by `composables/useAsyncAction.ts`, which also distinguishes a server-supplied `ApiError` message from a generic failure:

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

Used from a store:

```ts
async function login(email: string, password: string) {
  return useAsyncAction({ loading, error }, async () => {
    const response = await authService.login(email, password)
    user.value = response.user
    return response
  }, { fallbackMessage: 'Login failed' })
}
```

Note that it **re-throws**. The caller still decides whether a failure is fatal to the flow; the wrapper only guarantees that `loading` and `error` are consistent everywhere in the app. Never hand-roll this.

## 3. One HTTP service per resource, no god client

`services/` holds a file per resource — `auth.ts`, `forms.ts`, `fields.ts`, `upload.ts`, `responses.ts` — each exporting a typed object of methods over the shared `api` client in `services/api.ts`. Request and response types (`CreateFieldData`, `FieldResponse`) live **beside the service**, not in a central `types/` dump: the service file is the frontend's definition of the HTTP contract, and [06-api-reference.md](./06-api-reference.md) is verified against it.

`services/api.ts` centralizes three things worth knowing: the `Authorization` header, `ApiError` construction from the response body, and a 401 handler that clears the stored token.

`upload.ts` is the deliberate exception — it uses `XMLHttpRequest` rather than the shared client, because it needs upload `progress` events, which `fetch` does not expose.

**A component must never call `fetch` or `api` directly.** If a view needs data, the path is view → store or composable → service.

## 4. Canvas coordinates versus PDF coordinates

Fields are positioned and persisted in **canvas** coordinates. The backend's `pdf-processor.ts` writes AcroForm widgets in **PDF page** coordinates (origin bottom-left, in points). The bridge is a scale factor that is hard-coded in two places at once: `DEFAULT_SCALE = 1.5` in the backend service, and the render scale in `composables/usePDFRendering.ts`.

There is no shared constant and no test spanning both. **Changing the editor's render scale silently misaligns every field in the exported PDF.** If you touch rendering scale or zoom, you are also touching the backend, whether or not the diff says so. Fixing this properly means the scale travels with the data — storing the scale the positions were captured at on the form — rather than being agreed on by coincidence.

## 5. Server ids are the field's identity, local ids are a placeholder

`formFields.store.ts` mints an id for every field the user draws: `` `${LOCAL_ID_PREFIX}${Date.now()}-${random}` ``, where `LOCAL_ID_PREFIX = 'field-'`. It is a client-side key so the canvas, the side panel and the selection can all refer to a field that the server has never seen. `isLocalFieldId(id)` distinguishes the two.

**The distinction is load-bearing on save.** `saveAllFields` sends `id` for a field whose id came from the server, and omits it for a local one — that is what makes `POST /forms/:formId/fields/bulk` a diff rather than a replacement, and it is why a save no longer destroys the answers collected against those fields ([06-api-reference](./06-api-reference.md)). Dropping the ids on the way out is exactly the bug that shipped: the store received server ids from `loadFieldsFromForm` and then built its payload as a plain `CreateFieldData[]`, discarding them.

The rule that follows: **anything that builds a payload from `fields` must decide, explicitly, what it does with the id.** Local ids must never be sent, server ids must never be dropped.

The endpoint answers with `archived: string[]` — fields the user deleted that the server kept because they hold responses. The store parks them in `archivedFieldIds` and `FormSavePanel.vue` shows them as a non-blocking toast, then clears them. A response the frontend receives and silently ignores is how the previous attempt at this fix confused everyone: fields reappeared in the editor with no explanation.

## 6. Persistence is decided per store, explicitly

`pinia-plugin-persistedstate` is applied per store, never globally, and with an explicit `pick`:

```ts
}, {
  persist: { key: 'vuepdf-auth', storage: localStorage, pick: ['user'] }
})
```

`editor.store.ts` declares `{ persist: false }` even though that is the default, so the decision is visible to the next reader. Do the same: state a persistence decision explicitly in every new store.

Note what persistence implies for security: the auth token itself is in `localStorage`, readable by any script on the origin. That is a known finding, not a pattern to copy — see [07-security-and-privacy.md](./07-security-and-privacy.md).

## 7. Tests target behaviour, not implementation

29 specs live beside the code they test, using Vitest, `@testing-library/vue` and `@pinia/testing`. The convention is to assert the observable contract — which request went out, what state resulted — rather than internals:

```ts
expect(api.post).toHaveBeenCalledWith('/forms/form-1/fields', mockFieldData)
```

Do not assert on the internal shape of a composable's refs when the same thing can be asserted on what it caused.

## 8. Visual design — `[NOT IMPLEMENTED]`

**A full design exists and none of it is built.** The UI in `frontend/src` today is the original one: PrimeVue defaults, Tailwind's stock palette, gradients and glass in places. Everything in this section is target design, and nothing should be described elsewhere as though it ships.

**Source of truth for the design:** the *VuePDF Forms* canvas at <https://claude.ai/code/artifact/be7f6015-4f99-46aa-9a61-8c051d4637b4>. It is **not in this repository** — it is a published Claude Design canvas, and this section exists so the next session can find it rather than rediscovering it. It holds 11 artboards on four pages: **Landing** (desktop + phone), **Product** (Forms, Field editor, Responses, Public form + phone), **SaaS layer** (Plan & usage, Members & roles, Plan limit reached), and **System**.

The values, read out of the `System` artboard:

| | |
|---|---|
| Type | **Instrument Sans** 400/500/600; **JetBrains Mono** 400/500 |
| Ink / Muted / Faint / Line | `#191b21` / `#6a6f7b` / `#9ba1ac` / `#e7e8ec` |
| Accent / Accent soft | `#3554d1` / `#eef1fd` |
| Published / At limit | `#12704f` / `#8a5c0a` |
| Type scale | 21/600/-0.015em title · 15/600 section · 13.5/500 row title · 13/400 body · 11/600/0.06em column label · mono 12 |
| Controls | 36 px primary, 34 px secondary, 32 px compact |
| Geometry | radius 10 / 7 / 999 (card / control / pill) · gutter 32 · sidebar 232 · table row 56 · mobile hit target 48 |
| Elevation | paper and menus only |

Three rules the canvas states, which are the ones easiest to lose in implementation:

- **Accent is rationed** — one primary action per screen, the active nav item, the selected field. Everything else neutral, so a selection on the PDF canvas never competes with chrome.
- **Numbers are always mono.** Counts, dates, ids and coordinates line up in a column and are never mistaken for prose.
- **A field looks different in the two places it appears.** In the editor it is a bordered rectangle with a type tag, because the author is manipulating geometry; on the public form it drops to a single underline so the document still reads as a document.

**This is not a rewrite of the component layer.** The canvas says so explicitly: *"Tailwind's default palette is replaced; PrimeVue Aura keeps the component behaviour."* Adopting it is a token and layout change, not a migration away from PrimeVue.

Tracked in [`docs/BACKLOG.md`](../BACKLOG.md); sequenced in the [build order](./10-saas-roadmap.md#build-order).

## 9. What the frontend is missing

1. **A server-state library** (TanStack Query for Vue) for reads. Today every store hand-manages `loading` / `error` / caching, and there is no request deduplication or background refetch. `useAsyncAction` stays for writes; reads are where the manual approach is costing the most.
2. **A field-scale contract with the backend.** See section 4 — the highest-risk implicit coupling in the repo.
3. **Shared types generated from the backend Zod schemas**, so `CreateFieldData` cannot drift from the server's validator.
4. **i18n.** The UI is English except for a handful of Spanish placeholders (`"Escribe aquí..."`, `"Buscar en el documento..."`). That is drift, not a decision. Fix it with an i18n layer rather than string-by-string, because it will need one anyway.
5. **VueUse** for the hand-rolled `useDragAndDrop`, `useGridOverlay` and `useToolbarDrag`. Evaluate individually — some of these encode editor-specific behaviour that a generic helper will not cover.
6. **Error reporting from the browser.** When a B2B customer reports "the editor froze", there is currently no way to see what happened on their machine.
