---
name: frontend-state-pattern
description: Add a Pinia store, a composable, or an HTTP service to the Vue frontend following the project's established patterns - useAsyncAction for async state, the store-versus-composable split, explicit persistence, one service per resource. Use for any new state or orchestration logic in frontend/src/.
---

# Write frontend state the way this project writes it

Full reasoning with examples: `docs/sot/05-frontend-patterns.md`. This is the checklist.

## First: store, composable, or neither?

- **Pinia store** (`stores/<name>.store.ts`) — the state must be shared between components that are not related in the tree, or must survive a component unmount.
- **Composable** (`composables/use<Name>.ts`) — orchestration of an operation across stores and services, or state genuinely local to one flow.
- **Neither** — if it is a pure function, it belongs in `utils/`, where it is far easier to test.

`useFormManagement.ts` is the reference: it owns no business state, only UI refs, and sequences three stores.

**The line has been crossed when** a composable needs its own state to survive between mounts. That is a store that has not been written yet. Do not paper over it with a module-level `ref` in the composable file — that is a store with no devtools, no persistence decision and no test seam.

## Async actions

Always wrap async work with `useAsyncAction` from `composables/useAsyncAction.ts`. Never hand-roll `loading` / `try` / `catch` / `finally`:

```ts
async function doThing(arg: string) {
  return useAsyncAction({ loading, error }, async () => {
    const result = await thingService.doThing(arg)
    thing.value = result
    return result
  }, { fallbackMessage: 'Failed to do the thing' })
}
```

It re-throws, so the caller still decides whether the failure ends the flow. What it guarantees is that `loading` and `error` behave identically everywhere in the app. `fallbackMessage` is user-facing English — write it as something a user could act on.

## Persistence

Decide explicitly, per store, and write the decision down even when it is the default:

```ts
}, { persist: { key: 'vuepdf-<name>', storage: localStorage, pick: ['onlyWhatIsNeeded'] } })
// or
}, { persist: false })
```

Always `pick` the specific keys. Never persist tokens, secrets, or anything you would not want readable by any script on the origin — and note that the auth token already is, which is a known finding, not a pattern to copy (`docs/sot/07-security-and-privacy.md`).

## Talking to the backend

- Never call `fetch` or `api` from a component or a view. The path is view → store/composable → service.
- One service file per resource in `services/<resource>.ts`, exporting a typed object over the shared `api` client.
- Request and response types live **beside the service**. That file is the frontend's definition of the HTTP contract.
- **Verify the endpoint before inventing its shape** — read the route file, per the `api-contract-guard` skill. Do not infer the contract from what would be convenient.

## Naming

- Composable: `use<Name>.ts`, one per file, named export matching the filename.
- Store: `<name>.store.ts`, `use<Name>Store`, `defineStore('<name>', …)` lowercase and without the `store` suffix.
- Test: `<name>.spec.ts` **beside** the file it tests — the opposite convention from the backend.

## Tests

Vitest with `@testing-library/vue` and `@pinia/testing`, asserting observable behaviour:

```ts
expect(api.post).toHaveBeenCalledWith('/forms/form-1/fields', mockFieldData)
```

Test what the unit caused, not how it is built. Do not mount a whole view to test logic that lives in a composable, and do not assert on internal refs when an effect says the same thing.

## Watch out for

**Anything touching PDF render scale or zoom is a cross-workspace change.** `usePDFRendering.ts` and the backend's `DEFAULT_SCALE = 1.5` in `pdf-processor.ts` must agree, and nothing enforces it. Changing one silently misplaces every field in the exported PDF, and no test will catch it. If your diff touches scale, say so explicitly in the PR.
