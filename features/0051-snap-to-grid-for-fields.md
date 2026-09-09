# 0051 — Snap to grid for fields

**Status:** done
**Priority:** P3 (row *Snap to grid does nothing for a form field*, `docs/BACKLOG.md`; task 13 of the *Editor PDF* track in the product plan)
**Branch:** feature/0051-snap-to-grid-for-fields
**Related:** [05-frontend-patterns §8](../docs/sot/05-frontend-patterns.md) · [`features/0047`](0047-undo-covers-field-edits.md) · [`features/0048`](0048-multi-select-duplicate-and-keyboard-nudge.md) · [`features/0050`](0050-marquee-selection-and-multi-field-delete.md)

## Context

`PDFEditor.vue:165` renders a **Snap to Grid** toggle, and in an editor whose main object is
the form field it does nothing to a single field. The magnet is written —
`snapToGridValue` in `frontend/src/composables/useDragAndDrop.ts:48` — but
`FormFieldItem.vue` **does not use that composable at all**: it has its own `onMouseDown` /
`onDrag` / `onResize` (lines ~199–332) and never calls it. So the toggle moves the text and
image previews, which do go through `useDragAndDrop`, and leaves every field where the mouse
dropped it.

It was found on 2026-09-04 while doing [`features/0048`](0048-multi-select-duplicate-and-keyboard-nudge.md)
and deliberately left alone: it changes what **every existing field drag does**, and folding
that into a change that already touched six files would have made its regressions ambiguous.
[`features/0050`](0050-marquee-selection-and-multi-field-delete.md) then finished the
selection arc — marquee, align, distribute, nudge — which is exactly the workflow a working
magnet completes.

The one thing to understand before writing any code is that **the fields do not live in the
space the grid is drawn in**. `useGridOverlay.ts` draws a line every `drawingStore.gridSize`
pixels on a canvas sized like the main one, so the grid is in **canvas pixels at the current
scale**. Field positions are stored in **base-scale units** (`BASE_SCALE = 1.5`,
`FormFieldsOverlay.vue`) and drawn through `rotateFieldRect(position, …, scaleFactor)`. The
text and image previews *are* in canvas pixels, which is why the existing helper is right for
them and wrong here.

## Why the obvious approach is wrong

**Calling `snapToGridValue` on the stored coordinate.** It is the one-line version and it is
wrong except at one zoom level: it rounds a *stored* value to a multiple of `gridSize`, while
the visible line is every `gridSize` **drawn** pixels. A field only lands on a line the author
can see when `scaleFactor === 1`. At any other zoom the field snaps to a grid that is not on
the screen, which looks like the magnet is broken in a new and more confusing way than it
being absent. The step in stored units is `gridSize / scaleFactor`, or the snap happens in
drawn space and is mapped back.

**Routing `FormFieldItem.vue` through `useDragAndDrop`.** The backlog row offers it as an
option and it is the wrong one. That composable moves **one** element from `getElementPosition`
to `onUpdatePosition`; the field drag moves a **set** by one clamped delta
(`features/0048`), begins and commits exactly one undo entry, decides whether a release was a
click that should collapse a multi-selection, and refuses geometry on a rotated page. Rewriting
it as a `useDragAndDrop` caller would put all of that back through a callback interface that
does not have it. Extract the *snapping* instead — a pure function — and leave both drags
where they are.

**Snapping each field of a multi-selection.** `onDrag` clamps the **delta**, not the fields,
and `moveFieldsBy` does the same, for a stated reason: stopping one field at the edge while the
rest keep going deforms the layout the author lined up. Snapping each field separately is that
same bug — six fields that were 7px apart become six fields all on the same line, and the
relative arrangement the author built is destroyed by a magnet. **Snap the delta**: work out the
snapped position of the field under the pointer, and move every other field by the same offset.

**Snapping the arrow keys.** `useFieldKeyboard.ts` nudges by 1px, or 10px with Shift. That is
the *precise* tool — the one an author reaches for when the magnet is not what they want — and
a 1px nudge that jumps 20px is not a nudge. The keyboard stays exact whatever the toggle says.

**Snapping align and distribute.** They align fields to *each other*, which is a different
intent from aligning them to the page grid; `utils/fieldGeometry.ts` is pure and stays that
way. Out of scope, deliberately.

**Assuming the grid is visible.** `drawingStore` has `gridEnabled` **and** `snapToGrid`, and
they are independent: the magnet can be on with no lines drawn. That is a real state a user can
reach from the toolbar today, and it is worth deciding rather than discovering — the
recommendation is that turning the magnet on turns the grid on, so what a field snaps to is
something the author can see.

## Goal

1. With **Snap to Grid** on, dragging a field drops it on the grid the author can see, at any
   zoom level — not on a grid that only coincides with it at `scaleFactor === 1`.
2. With it **off**, every existing drag, resize and nudge behaves exactly as it does today.
3. Dragging a **multi-selection** with the magnet on keeps the relative arrangement of the set:
   one snapped delta for all of them, never one snap per field.
4. Resizing snaps the edges being dragged and still respects `minSize` (30).
5. The arrow keys are unaffected by the toggle. Align and distribute are unaffected.
6. `snapToGridValue` has **one** definition, used by both the field drag and
   `useDragAndDrop`'s existing callers — not a second copy in `FormFieldItem.vue`.
7. Turning the magnet on makes the grid visible (or the decision is written down in the
   Outcome with its reason).
8. A test asserts what the backlog row asks for and what has never been asserted: **with the
   toggle on, a dropped field lands on a grid multiple**, and with it off it lands where it was
   dropped. Plus a unit test for the pure helper at a scale other than 1.

## Out of scope

- **Rotated pages.** `isRotated` already refuses drag and resize; the magnet inherits that and
  the rotation fix stays filed.
- **Align, distribute, and the keyboard**, as argued above.
- **The grid size as a setting.** `gridSize` stays 20 and stays in `drawing.store.ts`.
- **The canvas/PDF scale constants** (`DEFAULT_SCALE = 1.5` in both workspaces) and the
  editor→AcroForm round-trip test. Its own row, and this feature must not quietly become that
  one — but if the arithmetic here makes the missing test obvious, say so in the Outcome.
- **`PublicFormFieldItem.vue`.** Respondents do not move fields.

## Execution prompt

> **Read first:** `frontend/src/composables/useDragAndDrop.ts` (all of it — `snapToGridValue`
> and its two call sites), `frontend/src/components/form-fields/FormFieldItem.vue` from
> `onMouseDown` to `stopResize`, `frontend/src/components/form-fields/FormFieldsOverlay.vue`
> (`BASE_SCALE`, `renderScale`, `scaleFactor` — the space the fields are laid out in),
> `frontend/src/composables/useGridOverlay.ts` (the space the grid is drawn in),
> `frontend/src/stores/drawing.store.ts`, and `frontend/src/stores/formFields.store.ts`
> (`moveField`, `moveFieldsBy`, and the clamping comment).
>
> **Write the failing test first.** In `FormFieldItem.spec.ts`, beside the existing drag tests:
> with `drawingStore.snapToGrid = true`, a drag that ends between two grid lines leaves the
> field on a multiple of the step; with it `false`, it leaves the field exactly where the drag
> put it. Run it against `develop` and record that the first case fails — today the toggle does
> nothing at all, so it will.
>
> **Then the helper.** Put the pure function in `frontend/src/utils/fieldGeometry.ts` beside
> `bandBetween` — it is the same kind of thing, pure geometry with no store — taking the value
> and the step and returning the snapped value. `useDragAndDrop.ts` calls it with
> `drawingStore.gridSize` (it works in canvas pixels), and the field drag calls it with
> `gridSize / scaleFactor` (it works in stored units). Delete the local copy in
> `useDragAndDrop.ts`; there must be one definition.
>
> **Then the field drag.** `FormFieldItem.vue` already receives `scaleFactor` as a prop, so the
> step is available without new plumbing. In `onDrag`, snap the position of **the field under
> the pointer** and apply the resulting offset to the rest of `dragStartPositions` — do not snap
> each field, and keep the existing delta clamp. In `onResize`, snap the edges the handle moves,
> after the `minSize` clamp rather than before it, or a snapped-down edge can go under the
> minimum.
>
> **Then the toggle.** In `drawing.store.ts`, turning `snapToGrid` on turns `gridEnabled` on
> too, so the author can see what their fields are landing on. Turning it off leaves the grid
> as it is.
>
> **Do not** rewrite the field drag as a `useDragAndDrop` caller, do not touch
> `useFieldKeyboard.ts`, `useFieldEditing.ts` or the align/distribute functions, and do not
> change `moveFieldsBy`.
>
> **Verify:**
> ```bash
> npm run test:frontend
> npm run build --workspace=frontend
> ```
> The backend is untouched, so its suites are not the gate here — but run
> `npm run test:e2e` once and check the count against the baseline: **52 passed / 4 failed**,
> where the four are the pre-existing DocAIFlow branding assertions filed in
> `docs/BACKLOG.md`. Anything else is this branch.
>
> **On the way out:** `sot-sync` — [05-frontend-patterns §8](../docs/sot/05-frontend-patterns.md)
> says what the magnet covers and, more importantly, **which space each of the two drags works
> in**, because that is the thing the next person will get wrong. Remove the *Snap to grid does
> nothing for a form field* row from `docs/BACKLOG.md`. Set this file to `**Status:** done` with
> an Outcome, and run `ship-checklist` before the PR.


## Outcome

Done. The toggle moves fields now, `snapToStep` in `utils/fieldGeometry.ts` is the single
definition of the magnet, and the two drags pass different steps —
`useDragAndDrop.ts` passes `gridSize` because the previews are in canvas pixels,
`FormFieldItem.vue` passes `gridSize / scaleFactor` because a field is stored in base-scale
units. Three tests were written first and failed against `develop` with
`expected 147 to be 140`, `expected 147 to be 150` and `expected 147 to be 140`: the field
sitting exactly where the mouse dropped it, which is what the toggle did for as long as it has
existed.

Everything the spec argued for held, and the scale-aware step is the half that would have been
got wrong: the one-line version (`snapToStep(stored, gridSize)`) passes the naive test at the
base zoom and puts the field on an invisible grid everywhere else. `snaps to the grid the
author can see, not to the stored units` is the test that pins it, at `scaleFactor: 2`.

Two things worth carrying forward.

**Snapping needed the edge clamp applied twice.** The drag clamps the delta so a set cannot be
pushed off the top or left of the page; snapping the clamped delta can push it back over, so
the clamp is re-applied after the snap. Resize has the mirror of it — the snap runs **after**
the `minSize` clamp, because rounding a width down can take it back under the minimum, and the
`w`/`n` handles clamp again against the opposite edge.

**Found and filed, not fixed: a field does not follow the cursor at any zoom but the base
one.** `onDrag` applies the *screen* delta straight to a *stored* coordinate, and the two
differ by `scaleFactor × displayScale`. [`features/0047`](0047-undo-covers-field-edits.md) saw
the symptom from the other side and wrote it into an E2E comment — *110 px of mouse is 46 px on
screen* — without naming the cause. It does not affect this feature (the snap works in stored
space and lands on visible lines either way) and fixing it changes every existing drag and
resize, so it is a row in `docs/BACKLOG.md` next to the round-trip test it wants written first.

Verified: frontend **594 tests / 64 specs**, the frontend build clean, and E2E **52 passed / 4
failed** — the four being the pre-existing DocAIFlow branding assertions, unchanged from the
baseline on `develop`. The backend is untouched.
