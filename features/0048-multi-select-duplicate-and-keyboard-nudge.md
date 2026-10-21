# 0048 — Multi-selection, duplicate and keyboard nudge

**Status:** done
**Priority:** P3 (task 06 of the *Editor PDF* track in the product plan; it has **no row in `docs/BACKLOG.md`**, see *Context*)
**Branch:** feature/0048-multi-select-duplicate-and-keyboard-nudge
**Related:** [05-frontend-patterns §8](../docs/sot/05-frontend-patterns.md#undo-is-one-stack-and-it-covers-the-fields-too) · [09-quality-and-testing](../docs/sot/09-quality-and-testing.md) · [`features/0044`](0044-field-delete-archives-its-answers.md) · [`features/0045`](0045-archived-fields-are-visible-and-restorable.md) · [`features/0047`](0047-undo-covers-field-edits.md)

## Context

Placing fields is the work the author actually does in this product, and today it is
done one field at a time with the mouse and nothing else. Read the code and the gap is
exact:

- **Selection is one id.** `frontend/src/stores/formFields.store.ts` holds
  `selectedFieldId: string | null` and a `selectedField` computed. Everything that reads
  a selection reads that one field: `FieldPropertiesPanel.vue:2` renders only when
  `formFieldsStore.selectedField` exists, `FormFieldItem.vue:97` compares against
  `selectedFieldId`. There is no way to express "these six".
- **There is no duplicate.** `grep -rn "duplicate"` over `frontend/src` returns comments
  and `pdfFieldEmbedder.ts`, and nothing else. A field with its label, options, `required`
  and `pattern` set has to be rebuilt by hand every time.
- **There is no keyboard.** The whole SPA binds exactly two `keydown` listeners:
  `SearchSpotlight.vue` (Escape/Enter, on its own input) and `EditorView.vue:346`, the
  `Ctrl/Cmd+Z` that [`features/0047`](0047-undo-covers-field-edits.md) added. Arrow keys
  do nothing anywhere. A field can be positioned to the pixel only by dragging it there.
- **There is no align or distribute**, and there is no way there could be: both operate
  on a set, and there is no set.

For a thirty-checkbox government form — the form this product exists for — that is the
difference between ten minutes and an hour, and [`features/0047`](0047-undo-covers-field-edits.md)
has just built the thing that makes it safe to offer: one ordered undo stack that accepts
**one entry per gesture**, so moving six fields at once is one press of Undo.

This item comes from the product plan (`Producto antes de la beta`, Editor task 06) and is
not filed in `docs/BACKLOG.md`, so there is no row to remove on the way out — there are
rows to **add** for what this deliberately leaves undone.

**One claim in the product plan is wrong and this spec corrects it.** The plan says
`useGridOverlay` gives the grid magnet somewhere to lean. The magnet already exists —
`snapToGridValue` in `composables/useDragAndDrop.ts:48`, wired into both drag and resize —
but **`FormFieldItem.vue` does not use `useDragAndDrop` at all.** It implements its own
drag (`onDrag`, line 175) and resize (`onResize`, line 221) and never calls the snapping
helper, so `Snap to grid` in `PDFEditor.vue:165` today changes nothing whatsoever for a
form field; it only affects the text and image previews, which do go through
`useDragAndDrop`. That is a separate defect, it is filed by this spec, and it is **not**
fixed here — see *Out of scope*.

## Why the obvious approach is wrong

**1. One undo entry per arrow keypress destroys the document history.**
`editor.store.ts` caps the stack at `MAX_UNDO_ENTRIES = 10`, and `push` evicts from the
front — calling `snapshotsStore.removeSnapshotById` on a `document` entry as it goes,
which frees the PDF bytes. So ten arrow presses do not merely fill the stack: they
**permanently discard every document snapshot the session held**, and the text and image
edits behind them become unundoable, silently. Key repeat reaches ten in well under a
second. A nudge must therefore coalesce: **one entry per burst**, captured on the first
key of the burst and closed when the burst ends (key up, a different key, a selection
change, or a short idle timeout). This is the same commit-point rule `FormFieldItem`
already applies to a drag (`beginGesture` / `commitGesture`, lines 84–95) — one gesture,
one entry — and it is the single most important line of this spec.

**2. Duplicating a saved field must never copy its id.**
`saveAllFields` sends `id` for every field whose id is not local
(`formFields.store.ts`, `isLocalFieldId`). Two payload entries carrying the same server id
are two updates to one row: the backend's bulk save resolves them against the form's live
fields, the second overwrites the first, and **one of the two fields is simply never
created** — with a `200` and nothing in any log. A duplicate must get a fresh
`createLocalFieldId()` and a fresh name from `generateUniqueFieldName(type)`. Note that
`addField` does **not** check for a name collision (`updateField` does, line 134), so
copying the name is another silent way to produce two fields the AcroForm cannot tell
apart.

**3. Do not push a multi-selection into `UndoEntry` without reading `forgetFieldId`.**
An entry carries `selectedFieldId`, and `editor.store.ts` rewrites it in two places for
reasons that took a whole feature to establish: `forgetFieldId` scrubs the id of a field
the server destroyed or archived, and `rememberField` puts a restored one back. An array
of selected ids added to the entry and not handled in both would restore a selection
naming fields that no longer exist — and a nudge applied to that selection writes to
nothing while the author watches nothing move. **The cheap correct answer: leave
`UndoEntry` exactly as it is, and have an undo clear the multi-selection**, collapsing to
the single `selectedFieldId` the entry already carries. Selection is not the state worth
restoring; the field list is.

**4. Do not make the fields overlay grab the pointer for a rubber-band marquee.**
`FormFieldsOverlay.vue` is `pointer-events: none` except in adding mode, and it sits at
`z-index: 8` — directly above `.text-layer`, which is `z-index: 7` and
`pointer-events: auto` because it carries the PDF's selectable text and everything
`usePDFSearch` highlights. An overlay that accepts a `mousedown` anywhere on the page to
start a marquee takes text selection and search away from the whole canvas. A marquee is
the right gesture eventually and it needs that layering resolved, which is a design; this
change uses **modifier-click** (`Shift`/`Ctrl`/`Cmd` on a field toggles it into the
selection) and files the marquee.

**5. Nudge and align must refuse on a rotated page, for the reason drag already does.**
`FormFieldItem.vue:127` blocks drag and resize while `rotation % 360 !== 0` because a
screen delta is not a stored delta on a turned page, and writing an unmapped one is
silent corruption of the printed PDF (`docs/BACKLOG.md` carries the row). Arrow keys have
the same problem from the other end: they name a *screen* direction and would write a
*stored* axis, so on a page turned 90° the right arrow moves the field down. Refuse, with
the same tooltip reasoning, rather than inventing a mapping this change is not scoped to
verify.

**6. Arrow keys must be exempt inside inputs, like `Ctrl+Z` is.**
`EditorView.vue:339-341` skips the handler when the event target is an `INPUT`, a
`TEXTAREA` or `isContentEditable`. Without the same guard, pressing Left in the field-name
box moves the field instead of the caret. The nudge handler belongs beside that one, and
the guard is not optional.

## Goal

Checkable when finished:

1. `Shift`-click or `Ctrl`/`Cmd`-click on a placed field toggles it in and out of a
   multi-selection; a plain click still replaces the selection with that one field.
   Clicking the page with no modifier clears it.
2. Every selected field is visibly selected on the canvas. `FieldPropertiesPanel` shows
   the properties of exactly one field as it does today when the selection is one, and
   shows a "6 fields selected" state — with the multi-field actions and no per-field
   inputs — when it is more.
3. Dragging any field in a multi-selection moves **all** of them by the same delta, and
   pushes **exactly one** undo entry for the whole gesture.
4. The arrow keys move the selection by 1px, and `Shift`+arrow by 10px, in stored
   coordinates. A continuous burst of presses is **one** undo entry, and ten presses
   leave every pre-existing `document` entry on the stack (`editorStore.undoDepth` and
   `snapshotCount` prove it).
5. `Ctrl`/`Cmd`+`D` duplicates the selection. Each copy has a new local id from
   `createLocalFieldId()`, a unique name from `generateUniqueFieldName`, is offset from
   its original so it is visible, is the new selection, and pushes one undo entry for the
   whole duplication. `Save all` after duplicating six saved fields creates six new rows
   and updates the six originals — none is lost.
6. Align (left / right / top / bottom / centre-h / centre-v) and distribute
   (horizontally / vertically) act on the multi-selection, in stored coordinates, and
   each is one undo entry.
7. Nudge, drag-the-selection, align and distribute all refuse while the page is rotated,
   consistently with the existing drag refusal, and say why.
8. Every one of these marks the form dirty (`markDirty`) and writes nothing to the
   server: `Save all` remains the only writer of field geometry.
9. Arrow keys, `Ctrl+D` and the modifier-clicks do nothing while focus is in an `input`,
   a `textarea` or a `contenteditable`.
10. No file under `backend/` changes.

## Out of scope

- **Rubber-band marquee selection.** Reason 4 above. **File a backlog row**: it needs the
  `z-index: 8` overlay and the `z-index: 7` text layer to agree on who owns a drag on
  empty page area, which is a design and not a call.
- **Deleting a multi-selection.** `FieldPropertiesPanel.confirmRemoveField` issues one
  `DELETE` per field and branches on whether the server archived or hard-deleted it
  ([`features/0044`](0044-field-delete-archives-its-answers.md)), with a different undo
  consequence for each ([`features/0047`](0047-undo-covers-field-edits.md)). Six fields
  is six requests with six possible answers and one dialog that has to summarise them.
  **File a backlog row.**
- **Snap-to-grid for form fields.** The defect corrected in *Context*: the toggle exists
  and does nothing for fields. **File a backlog row** — it is small (route
  `FormFieldItem`'s drag through `useDragAndDrop`, or call `snapToGridValue`) but it
  changes what every existing drag does, and bundling it here would make this diff's
  regressions ambiguous.
- **Redo**, and **undo for the properties panel**. Both are already filed
  (`docs/BACKLOG.md`), both were deliberately left by 0047.
- **Mapping drag deltas on a rotated page.** Already filed; this change refuses in the
  same places rather than widening that surface.
- **Copy/paste between pages, documents or forms.** Duplicate places its copy on the same
  page. A clipboard is a different feature with its own questions.
- **Anything in `backend/`.** The bulk save already accepts everything this produces.

## Execution prompt

> Read first, in this order: `frontend/src/stores/formFields.store.ts` (selection,
> `addField`, `moveField`, `resizeField`, `generateUniqueFieldName`, `cloneFields`,
> `saveAllFields`), `frontend/src/stores/editor.store.ts` (the whole file — `push`,
> `MAX_UNDO_ENTRIES`, `pushFieldsUndo`, `forgetFieldId`, `rememberField`, the
> `hasUnsavedChanges` watcher), `frontend/src/components/form-fields/FormFieldItem.vue`
> (`beginGesture`/`commitGesture`, `onMouseDown`/`onDrag`/`stopDrag`, `isRotated`),
> `frontend/src/components/form-fields/FormFieldsOverlay.vue` (layering, coordinates,
> `handleOverlayClick`), `frontend/src/views/EditorView.vue:324-347` (the `Ctrl+Z`
> handler and its input guard), and `docs/sot/05-frontend-patterns.md` §8 *Undo is one
> stack*. Then read the *Why the obvious approach is wrong* section of this spec again;
> every one of its six points is a place this has already been reasoned through.
>
> **Build.**
>
> 1. **Selection state** in `formFields.store.ts`. Add `selectedFieldIds: string[]` (or
>    a `Set`) alongside the existing `selectedFieldId`, and keep one invariant that is
>    written down in a comment and enforced in one place: `selectedFieldId` is the field
>    whose properties the panel shows and is always a member of `selectedFieldIds` when
>    that is non-empty. Add `toggleFieldSelection(id)`, `selectFields(ids)` and
>    `clearSelection()`. `selectField(id)` keeps its current meaning — replace the
>    selection with this one field — because six call sites depend on it. `deleteField`
>    and `restoreFieldsSnapshot` must both leave the multi-selection consistent: an id
>    that names no field must never survive in it.
> 2. **Nothing goes into `UndoEntry`.** Applying an undo collapses the selection to the
>    entry's `selectedFieldId` — see reason 3. Do not touch `forgetFieldId` or
>    `rememberField`.
> 3. **Multi-drag** in `FormFieldItem.vue`. When the field under the mouse is part of a
>    multi-selection, `onDrag` applies the same delta to every selected field
>    (`moveField` per field, clamped at 0 as it is now); `beginGesture` still captures
>    the whole list once and `commitGesture` still pushes once, with a label that says
>    how many moved. When it is not part of the selection, a plain mousedown selects it
>    alone exactly as today.
> 4. **A keyboard composable**, `frontend/src/composables/useFieldKeyboard.ts`, following
>    the pattern of `useEditorUndo.ts`: the store holds state, the composable holds the
>    orchestration, and `EditorView.vue` binds it once on the window beside the existing
>    `onEditorKeydown`. It owns the arrow-key nudge, `Ctrl/Cmd+D`, and the input-focus
>    guard, which must be the same three checks the undo handler makes. **The burst
>    coalescing lives here** and is the part to get right: open a gesture on the first
>    arrow key (capture `cloneFields(formFieldsStore.fields)`), keep nudging into it,
>    and commit one `pushFieldsUndo` when the burst ends. Choose the end condition
>    deliberately and comment why.
> 5. **Duplicate**, as a store action (`duplicateFields(ids)`): new local id, unique name,
>    a fixed offset, the copies become the selection, one undo entry for the whole
>    operation, `markDirty`. Reason 2 is the trap.
> 6. **Align and distribute**, as pure functions over positions in
>    `frontend/src/utils/` (they are geometry and they are the easiest thing in this
>    change to unit test), called by a store action that applies the result and pushes
>    one entry. Distribute needs three or more fields; align needs two.
> 7. **The panel**, `FieldPropertiesPanel.vue`: the multi-selection state with a count,
>    the align/distribute controls, and Duplicate. Do not add per-field inputs to it —
>    a rename that writes to six fields is the properties-panel-undo problem this
>    repository has already decided not to solve by accident. Follow the design canvas
>    ([05-frontend-patterns §8](../docs/sot/05-frontend-patterns.md)); no new colours.
> 8. **Rotation.** `isRotated` in `FormFieldItem.vue` is the existing rule; nudge, align,
>    distribute and multi-drag all honour it, and the panel's controls are disabled with
>    a title that explains it, matching the existing tooltip's tone.
>
> **Tests — written before the code they cover, and run against the unbuilt behaviour
> first.** Use the `test-author` agent. At minimum:
>
> - `frontend/src/stores/editor.store.undo.spec.ts` (extend): a burst of ten nudges is
>   **one** entry, and a `document` entry pushed before the burst is still on the stack
>   and its snapshot still resolvable afterwards. This is the regression that protects
>   reason 1, and it must fail before the coalescing exists.
> - `frontend/src/stores/formFields.store.spec.ts`: `duplicateFields` over two saved
>   fields produces two local ids and two unique names; the payload
>   `saveAllFields` builds carries four entries, two with `id` and two without.
> - Unit tests for the align/distribute geometry, including the rotated refusal.
> - `frontend/src/components/form-fields/FormFieldItem.spec.ts`: shift-click toggles;
>   dragging one member of a selection of three moves three and pushes one entry.
> - One Playwright test in `e2e/pdf-workflow.spec.ts` beside the existing undo test —
>   the keyboard is the half a unit test cannot reach. Note what 0047 found there: the
>   overlay is drawn scaled, so a mouse delta is not a screen delta.
>
> **Verify** — run all of them and paste the real output:
> ```bash
> npm run test:frontend
> npm run build --workspace=frontend   # includes vue-tsc
> npm run test:e2e
> ```
>
> **On the way out**, before calling it done:
>
> - Run the `sot-sync` skill. `docs/sot/05-frontend-patterns.md` §8 gains what the editor
>   selection now is and what one undo entry now covers; §8's *What the canvas has that
>   the app does not* may shrink.
> - Add the four backlog rows named in *Out of scope* — marquee selection, multi-field
>   delete, snap-to-grid never reaching form fields, and anything else found on the way —
>   each with its why, per hard rule 7.
> - Set this file to `**Status:** done` and record what was found and what was left, as
>   `0047` does.
> - Run the `ship-checklist` skill before opening the PR.

## Outcome

Built as specified, with one design change made while building and two findings.

**What shipped.** `formFields.store.ts` gained `selectedFieldIds` beside `selectedFieldId`,
with `setSelection` as the only writer of either — which is also where ids that name no
field are dropped, so a delete or a restored snapshot can no longer leave the panel
showing a field that is gone. Selection is confined to one page. `FormFieldItem.vue`
toggles on `Shift`/`Ctrl`/`Cmd`-click and drags the whole set by one clamped delta, still
one undo entry per gesture. `utils/fieldGeometry.ts` is pure align and distribute;
`useFieldEditing.ts` wraps duplicate, align and distribute so each is exactly one undo
entry (and holds the rotation refusal both callers read); `useFieldKeyboard.ts` binds the
arrow keys, `Ctrl/Cmd+D` and `Escape`, bound once in `EditorView.vue` beside the existing
`Ctrl+Z`. The properties panel gained a multi-selection state with align, distribute and
Duplicate, and a Duplicate for a single field. Clearing the selection by clicking the page
is bound on the canvas **wrapper** in `PDFViewer.vue`, not on the overlay, for the layering
reason in *Why the obvious approach is wrong*. **No file under `backend/` changed.**

**The design change: a nudge burst ends on a pause, not on `keyup`.** The E2E test failed
against the first implementation and was right to. Playwright's `keyboard.press` sends a
`keyup`, so ten presses produced ten entries and one `Ctrl+Z` moved the field back by a
single pixel — and that is not a test artefact, it is the real case: ten deliberate taps
evict ten document snapshots exactly as key repeat would. Closing the step on an idle
window (500 ms) or a change of selection covers both. The unit tests were rewritten to
that rule and one was added for each half.

**Finding, filed:** `Snap to Grid` does nothing for a form field. The magnet exists in
`useDragAndDrop.ts`, but `FormFieldItem.vue` never used that composable — it has its own
drag and resize — so the toggle only affects the text and image previews. This corrects
the product plan, which said the grid gave the feature something to lean on. Not fixed
here, because it changes every existing field drag.

**Also filed:** marquee selection (needs the overlay/text-layer layering decided) and
deleting a whole selection (six requests with six possible server answers).

**Verified.** Frontend 62 specs / 564 tests, backend 32 / 403, E2E 55 tests, and
`npm run build --workspace=frontend` (vue-tsc) clean. The new tests were written first and
run against the unbuilt code: 20 failures, then green.
