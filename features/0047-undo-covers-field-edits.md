# 0047 — Undo covers field edits, on one stack

**Status:** done
**Priority:** P3 (product gap — task 04 of the *Editor PDF* track in the product plan; it has **no row in `docs/BACKLOG.md`**, see *Context*)
**Branch:** feature/0047-undo-covers-field-edits
**Related:** [05-frontend-patterns](../docs/sot/05-frontend-patterns.md) · [06-api-reference](../docs/sot/06-api-reference.md) · [09-quality-and-testing](../docs/sot/09-quality-and-testing.md) · [`features/0044`](0044-field-delete-archives-its-answers.md) · [`features/0045`](0045-archived-fields-are-visible-and-restorable.md)

## Context

The editor has an Undo, and it only undoes the document. `editorStore.undoLastEdit`
(`frontend/src/stores/editor.store.ts:22`) pops an `EditAction` and returns the latest
document snapshot, so placing a text or an image can be taken back. **Moving a field,
resizing it, placing it or deleting one cannot be undone by anything.** The only way
back is to redo the work by hand. In an editor where every field is placed by dragging,
that is the first key a user reaches for — and there is no keyboard shortcut either:
the whole SPA binds no `keydown` outside `SearchSpotlight.vue`.

Two defects sit inside the document half of the same mechanism, and both are the reason
this cannot be built as a second, separate undo:

1. **`undoLastEdit` pops the history but never the snapshot.** `snapshots.store.ts:31`
   `getLatestSnapshot` returns the newest snapshot and leaves it in place, so pressing
   Undo twice returns the *same* bytes. Undo is one level deep in practice, and it looks
   like the button stopped working.
2. **`addBlankPage` (`PDFEditor.vue:439`) saves a snapshot and pushes no `EditAction`.**
   The button's `:disabled` reads `editHistory.length`, so after adding a blank page
   there is an undoable change and a disabled Undo button. `editHistory` and `snapshots`
   are two parallel lists that only line up by accident.

So the shape of the work is not "add undo for fields". It is: **the editor gets one
ordered undo stack**, and document edits and field edits both push onto it.

This item came from the product plan (`Producto antes de la beta`, Editor task 04) and
was never filed as a backlog row, so there is no row to remove on the way out — there
are rows to **add** for what this deliberately leaves undone.

## Why the obvious approach is wrong

**Do not undo a delete by putting the field back with the id it had.** This is the trap,
and it fails loudly and totally. `FieldPropertiesPanel.confirmRemoveField` calls
`formFieldsStore.deleteFieldFromServer`, which for a saved field issues
`DELETE /api/forms/:formId/fields/:fieldId` **immediately** — the row is already gone
(or archived) by the time an undo could run. The bulk save then validates every id it is
sent against the form's *live* fields (`backend/src/routes/form-fields.ts:302-319`:
`where: { formId, deletedAt: null }`, then `unknownIds` → `400 Validation error`). An id
that no longer names a live row does not fail quietly for that one field — **it fails the
entire `Save all` and takes every other unsaved edit on the form with it**, on every
subsequent attempt, until the author reloads the page. The same is true of an archived
field's id, because archived rows are excluded by `deletedAt: null`.

The consequences, which are the actual design:

- A field the server **hard-deleted** (`archived: false`, meaning it had collected no
  answers) may come back — but only as a **new local field**, with a fresh `field-…` id
  from `LOCAL_ID_PREFIX`. There are no answers to orphan, so a new id costs nothing.
- A field the server **archived** (`archived: true`) must push **no undo entry at all**.
  Its recovery already exists and is the correct one: the Archived section of
  `EditorRail.vue` and `POST /forms/:formId/fields/:fieldId/restore`
  ([`features/0045`](0045-archived-fields-are-visible-and-restorable.md)), which brings
  the row back *with its id* so the answers stay attached. Undo must skip past it to the
  previous entry rather than produce a second, worse way to recover the same field.
- Therefore an undo entry cannot be a naive snapshot of `fields` taken before the
  action. A pre-delete snapshot contains the dead id. **Build the entry after the server
  has answered**, with the deleted field already carrying the id it should come back
  with — or not at all. Then undo is a plain array assignment with no special cases at
  the moment it runs.

**Do not push an entry on every mutation.** `formFieldsStore.moveField` and `resizeField`
are called from `onDrag`/`onResize` in `FormFieldItem.vue`, i.e. on every `mousemove` —
dozens of calls for one drag. A `watch(fields, …, { deep: true })`, or a push inside the
store action, produces a stack where one drag is sixty entries and the user presses Undo
sixty times to move one field back. The commit point is `stopDrag`/`stopResize` — the
same place that already calls `markDirty()` — and a mouse-down that selects without
moving must push nothing.

**Do not build a second undo next to the existing one.** There is one Undo button and,
after this, one `Ctrl/Cmd+Z`. Two stacks means the same control does different things
depending on state the user cannot see: move a field, then place a text, then press
Undo — with two stacks the answer depends on which stack the button happens to read.
One stack, ordered by time, is the only version a user can predict.

**Do not make undo silent about dirtiness.** An undo changes the local field list, so
`hasUnsavedChanges` must be true afterwards. It is not worth computing whether the
result happens to equal the last saved state: a false positive costs one no-op save, a
false negative loses the user's work at the leave-the-editor prompt.

## Goal

Each of these is true or false when the work is done.

1. There is **one** ordered undo stack for the editor. Placing a text, placing an image,
   deleting a page, adding a blank page, placing a field, moving a field, resizing a
   field and deleting an undoable field all push onto it, and Undo takes them back in
   reverse chronological order regardless of kind.
2. Pressing Undo twice after two document edits restores two *different* documents
   (defect 1 above).
3. Adding a blank page enables the Undo button (defect 2 above).
4. One drag of a field pushes exactly **one** entry. A mouse-down that selects a field
   without moving it pushes **none**. The same for one resize.
5. Undoing the deletion of a field that the server hard-deleted brings it back with a
   **local** id (`field-…`), and the next `Save all` sends **no** id for it and succeeds.
6. Deleting a field that the server **archived** pushes no entry; Undo passes over it to
   the previous action, and the Archived section still offers Restore.
7. `Ctrl+Z` / `Cmd+Z` performs an undo while the editor is open, and does **nothing**
   while focus is inside an `input`, `textarea` or `contenteditable` — so the browser's
   own undo still works in the properties panel.
8. After any undo, `formFieldsStore.hasUnsavedChanges` is `true`.
9. The stack is bounded, and evicting an entry that owns document bytes releases those
   bytes. No entry can survive the snapshot it needs.
10. `clearFields()` / closing the document clears the stack — Undo never reaches across
    documents.

## Out of scope

- **Redo.** Not built. File it.
- **Undo of property-panel edits** (label, name, required, options, `pattern`,
  `minLength`). Those are typed into inputs where the browser's own undo already works,
  and a per-keystroke entry would flood the stack. File it.
- **Undo that survives a page reload.** The stack is in memory, like the snapshots. The
  backlog row *The editor keeps only the current document…* already records why a real
  history is its own feature.
- **The backend.** No route, no schema, no migration. This change is entirely in
  `frontend/src/`.
- **Multi-select, duplicate, arrow-key nudge** (Editor task 06) — a separate item, even
  though it will want to push onto this same stack. Leave the stack usable by it; do not
  build it.
- **The rotation refusal** in `FormFieldItem.vue` (`isRotated` blocks drag and resize) —
  a filed backlog row of its own.
- **`PDFEditor.vue`'s "Edit History — N changes" card** may keep its shape; it now counts
  stack entries rather than `EditAction`s. Do not redesign that panel here.

## Execution prompt

> Work in `frontend/` only. Read these first, in this order:
> `frontend/src/stores/editor.store.ts`, `frontend/src/stores/snapshots.store.ts`,
> `frontend/src/stores/formFields.store.ts`,
> `frontend/src/components/form-fields/FormFieldItem.vue` (`onMouseDown`, `stopDrag`,
> `startResize`, `stopResize`),
> `frontend/src/components/form-fields/FormFieldsOverlay.vue` (around the `addField`
> call, ~line 226), `frontend/src/components/form-fields/FieldPropertiesPanel.vue`
> (`confirmRemoveField`, ~line 525), `frontend/src/components/editor/PDFEditor.vue`
> (`undoEdit`, `deletePage`, `addBlankPage`, and the Undo button ~line 216),
> `frontend/src/composables/useTextPlacement.ts`, `useImagePlacement.ts`, and
> `frontend/src/views/EditorView.vue`. Also read
> `backend/src/routes/form-fields.ts:296-335` — the bulk save's id validation is the
> constraint that shapes the whole design; do not change it.
>
> **Write the failing tests first**, run them against the unfixed code, and record in the
> PR that they failed for the right reason. At minimum, in
> `frontend/src/stores/editor.store.spec.ts`: two document edits then two undos must
> return two different buffers (fails today — the snapshot is never popped), and adding a
> blank page must make the stack non-empty (fails today — no `EditAction` is pushed).
>
> Then build it:
>
> 1. **One stack in `editor.store.ts`.** Replace `editHistory: EditAction[]` as the undo
>    source with a stack of discriminated entries — a `document` entry that owns a
>    snapshot id, and a `fields` entry that owns a deep copy of the previous
>    `FormField[]` plus the previous `selectedFieldId`. Keep `snapshots.store.ts` as the
>    byte store; give it removal **by snapshot id** (today `removeSnapshot(documentId)`
>    removes the first match by prefix, which is not enough) and let the stack own the
>    cap: when an entry is evicted, its snapshot goes with it. `undoLastEdit` pops one
>    entry, applies it, and returns a discriminated result so `PDFEditor.vue` triggers
>    `documentStore.triggerPDFReload()` only for a document entry. Applying a `fields`
>    entry writes `fields` and `selectedFieldId` back into `useFormFieldsStore` and calls
>    `markDirty()`. The editor store may import the fields store the same way it already
>    imports `snapshots.store`.
> 2. **Push sites.** `useTextPlacement.ts` and `useImagePlacement.ts` and
>    `PDFEditor.vue`'s `deletePage` already snapshot — route them through the stack.
>    `addBlankPage` must push an entry too. On the field side: after `addField` in
>    `FormFieldsOverlay.vue`; in `stopDrag` and `stopResize` in `FormFieldItem.vue`,
>    capturing the previous list at `onMouseDown`/`startResize` and pushing at stop
>    **only if the position actually changed**; and in `confirmRemoveField` in
>    `FieldPropertiesPanel.vue`.
> 3. **The delete rule, which is where this gets thrown away if it is done wrong.**
>    `deleteFieldFromServer` returns the server's `DeleteFieldResult` (`archived`,
>    `answerCount`). Build the entry *after* that answer: `archived === true` → **push
>    nothing**; otherwise push an entry whose copy of the deleted field carries a **fresh
>    local id** minted the way `addField` mints one, never the server uuid it had. A
>    field that was only ever local (`field-…` id, the store returns nothing for it)
>    keeps its own id. Never place a server id belonging to a deleted or archived row
>    back into `fields` — the next `Save all` would `400` for the whole form.
> 4. **The keyboard.** Bind `Ctrl+Z` / `Cmd+Z` in `EditorView.vue` on `window`
>    (`onMounted`/`onBeforeUnmount`), ignoring the event when
>    `document.activeElement` is an `input`, `textarea` or `[contenteditable]`.
>    Follow the store-versus-composable split in
>    [05-frontend-patterns](../docs/sot/05-frontend-patterns.md): if this grows past a
>    listener, it is a composable, not a store.
> 5. **Lifecycle.** Clear the stack (and its snapshots) when `clearFields()` runs and when
>    the document is closed, so Undo never crosses documents.
>
> Tests — Vitest beside the source, following the existing specs:
> - `stores/editor.store.spec.ts` — the two failing tests above; a `fields` entry
>   restores the list; interleaved document and field entries pop in reverse order; the
>   cap evicts the oldest entry *and* its snapshot.
> - `components/form-fields/FormFieldItem.spec.ts` — one drag pushes exactly one entry; a
>   mouse-down with no movement pushes none; the same for resize.
> - `components/form-fields/FieldPropertiesPanel.spec.ts` — deleting a field the server
>   reports as `archived: false` pushes an entry whose field id starts with `field-` and
>   is not the server uuid; deleting one reported `archived: true` pushes nothing.
> - `stores/formFields.store.spec.ts` — after undoing a hard delete, the payload
>   `saveAllFields` sends carries **no** `id` for the revived field, and
>   `hasUnsavedChanges` is `true` after any undo.
> - One Playwright test in `e2e/` — place a field, drag it, press `Control+z`, assert the
>   field is back at its first position. It is the only thing that proves the key binding
>   works in a browser; the unit tests cannot.
>
> Verify with `npm run test:frontend`, `npm run build --workspace=frontend` (it type
> checks with `vue-tsc`) and `npm run test:e2e`. Show the output.
>
> On the way out: run the `sot-sync` skill and record the editor's undo model in
> [05-frontend-patterns](../docs/sot/05-frontend-patterns.md) — one stack, the commit
> points being drag/resize *end* rather than every mutation, and above all **the id rule
> for a revived field**, next to the existing `restoreArchivedField` note that explains
> the neighbouring trap. Add backlog rows in `docs/BACKLOG.md` (P3) for redo, for undo of
> property-panel edits, and for undo not surviving a reload. There is no backlog row to
> remove. Set this file's `**Status:**` to `done`, and tell the user that Editor task 04
> in the product-plan artifact is now closed so they can mark it there. Run the
> `ship-checklist` skill before opening the PR.

## Outcome

Built as specified, plus two rules the spec did not foresee and one deletion it did not ask
for. All of it is in `frontend/`; no route, schema or backend file was touched.

**The two defect tests failed first, each for its own reason.** Written against the unfixed
code, in the shape its API had:

```
× defect 1: the second undo returns the same bytes as the first
    AssertionError: expected 2 to be 1
× defect 2: a blank page snapshots but leaves the history empty
    AssertionError: expected 0 to be greater than 0
```

The first is `getLatestSnapshot` handing back the newest snapshot on every press; the second
is `addBlankPage` storing bytes and pushing no `EditAction`. Both are what the single stack
removes by construction, so both tests were then rewritten against the new API and live in
`src/stores/editor.store.undo.spec.ts`.

**Two rules were found while building, and both are silent failures.** The spec said a
deleted field must not come back with the id it had, and stopped at the entry that recorded
the deletion — but an *older* entry holds that id too, so undoing twice would put it back
and `400` every later save of the form. `forgetFieldId` therefore rewrites or removes the
id across the whole stack, and `rememberField` is its mirror for a restore: without it,
undoing past a restore drops the field again and the next save re-archives what the user
just recovered, with a `200` and no error anywhere — the exact trap
[`features/0045`](0045-archived-fields-are-visible-and-restorable.md) documented. The second
rule is that **a save invalidates field history**: `saveAllFields` replaces local ids with
server ones, so an older entry would send no id for a field that now has a row, and the bulk
save would read that as *create* and duplicate it. The store watches `hasUnsavedChanges`
fall — the flag, not the action, so the dependency runs one way and the two stores do not
form a cycle — and drops the field entries while keeping the document ones.

**`EditAction` and `editHistory` were deleted.** Once `saveSnapshot` pushed the entry, the
parallel log had no reader but a `.length` the Undo button was misreading, and its `page`
and `data` fields were never read anywhere. The four call sites now pass a label instead,
which the button shows: *Undo field moved*, *Undo text*. `getLatestSnapshot` went with them,
because it is the engine of defect 1 and leaving it invites its return.

**Verified.** `npm run test:frontend` 59 specs / 513 tests, `npm run test:backend` 32 specs /
403 tests, `cd backend && npx tsc --noEmit`, `npm run build --workspace=frontend` (vue-tsc)
and `npm run test:e2e` 54 tests — all green. The E2E case is the only one that can prove the
key binding: it places a field, drags it, presses `Control+z` and asserts the box returns to
its exact original position. It caught something real on the way — the overlay is drawn
scaled, so a 110px mouse delta is ~46px on screen, and an assertion written in mouse
distance would have been wrong about what it was measuring.

**Filed rather than built:** redo, undo of the properties panel, and undo surviving a
reload — three rows in `docs/BACKLOG.md`, each with why the naive version is worse than
nothing.
