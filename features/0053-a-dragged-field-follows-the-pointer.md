# 0053 — A dragged field follows the pointer

**Status:** done
**Priority:** P3 (row *A field does not follow the cursor at any zoom but the base one*, `docs/BACKLOG.md`; task 14 of the *Editor PDF* track in the product plan)
**Branch:** feature/0053-a-dragged-field-follows-the-pointer
**Related:** [05-frontend-patterns §8](../docs/sot/05-frontend-patterns.md) · [`features/0047`](0047-undo-covers-field-edits.md) · [`features/0048`](0048-multi-select-duplicate-and-keyboard-nudge.md) · [`features/0051`](0051-snap-to-grid-for-fields.md) · [`features/0052`](0052-stored-positions-round-trip.md)

## Context

`FormFieldItem.vue`'s `onDrag` takes the pointer's movement in **screen** pixels
(`e.clientX - dragStart.value.x`) and adds it straight to a **stored** coordinate. Those are
not the same unit, and the gap has two factors in it:

- `scaleFactor` — `renderScale` in `FormFieldsOverlay.vue`, the zoom over the base scale
  (`activeDocument.scale / BASE_SCALE`). It is already a prop on `FormFieldItem`, used by
  `rotateFieldRect` to *draw* the field.
- `displayScale` — `canvasSize.displayScale` in `PDFViewer.vue`, which is
  `canvas.clientWidth / canvas.width`. `canvas { max-width: 100% }` means the canvas is drawn
  smaller than the pixels it holds whenever the column is narrower than the page. The overlay
  carries it as one `transform: scale(...)`, so **every** field inside is drawn through it, and
  `FormFieldItem` is not given it at all.

So a field moves `screenDelta / (scaleFactor × displayScale)` on screen while the pointer moves
`screenDelta`. At the default zoom in a wide window both factors are 1 and it is exact, which is
why nobody has filed it in a year of use. Zoom in and the field crawls; make the window narrow
and it runs ahead.

The symptom is already written down in this repository, from the other side and without the
cause: [`features/0047`](0047-undo-covers-field-edits.md)'s E2E comment says *"the overlay is
drawn scaled, so a 110px mouse delta is a smaller delta on screen"* — 46px, in that run. That is
this bug being measured and accepted as a quirk of the test.

`onResize` has it too: the same raw `dx`/`dy` are added to a stored width and height.

The row was filed by [`features/0051`](0051-snap-to-grid-for-fields.md) and said it wanted the
round-trip test written first. [`features/0052`](0052-stored-positions-round-trip.md) wrote it,
and more usefully gave the two meanings of "scale" names and a section in the SoT — which is the
part this change needs, because the whole bug is that both are called scale.

## Why the obvious approach is wrong

**Dividing by `scaleFactor` alone.** It is the factor `FormFieldItem` already has, so it is the
fix that presents itself, and it is half of one. At the default zoom `scaleFactor` is exactly 1
while `displayScale` is whatever the window makes it — so the half-fix leaves the drag wrong in
precisely the configuration most people use it in, and *feels* fixed to anybody testing at zoom
levels rather than window widths. The evidence is 0047's measurement: the combined factor was
about 0.42 with the zoom untouched.

**Computing `displayScale` inside `FormFieldItem.vue`.** It would have to measure the canvas,
which it cannot see, or read a store that does not hold it. `FormFieldsOverlay.vue` already
receives it as a prop and already divides by it in three places (`overlayPoint`,
`handleMouseMove`, `handleOverlayClick`). Pass it down.

**Mapping the pointer instead of the delta.** Converting each pointer position to overlay space
and diffing is equivalent arithmetic with an extra rounding, and it loses the property
[`features/0048`](0048-multi-select-duplicate-and-keyboard-nudge.md) built the drag around:
every field moves by *one* delta from its own start, never by an accumulated step. Convert the
delta, keep everything else.

**Touching the arrow keys.** `useFieldKeyboard.ts` nudges in stored units by definition — one
press is one stored pixel, and that is what makes it the precise tool. It has no screen delta to
convert. Do not "make it consistent".

**Forgetting that `minSize` is in stored units.** `onResize` clamps to `30`, which is 30 stored
pixels. Convert the delta first, then clamp — clamping a screen delta against a stored minimum
is the same class of mistake as the one being fixed.

**"Fixing" the test that will fail.** [`features/0051`](0051-snap-to-grid-for-fields.md)'s
`snaps to the grid the author can see, not to the stored units` drags 47 screen pixels at
`scaleFactor: 2` and expects the field at 150 — a number that assumes the delta is *not*
converted. After this change the same drag is 23.5 stored pixels and lands on 120. **That test
is not wrong, it is out of date**: update its expectation and its comment to say the delta is
mapped now. Do not weaken it, and do not delete it — it is the only test pinning the snap step
to the visible grid.

## Goal

1. Dragging a field moves it under the pointer at any zoom **and** any window width: the field's
   drawn position tracks the cursor one-to-one.
2. Resizing does the same, and still refuses to go under `minSize` in stored units.
3. A multi-selection drag still moves every field by one delta from its own start, and the
   existing clamp and grid snap still work on top of the converted delta.
4. The arrow keys, align, distribute and the marquee are unchanged.
5. Rotated pages still refuse both gestures (`isRotated`), unchanged.
6. Tests written first and seen to fail: a drag at `scaleFactor: 2` moves the field half as far
   in stored units as the pointer moved; a drag with `displayScale: 0.5` moves it twice as far;
   the two together compose. A resize case for the same.
7. `features/0051`'s snap test is updated with its expectation recomputed, not removed.

## Out of scope

- **The text and image previews.** They drag through `useDragAndDrop.ts` and are positioned on
  `.pdf-canvas-wrapper` rather than inside the scaled overlay, so their arithmetic is a different
  question with a different answer. **Check whether they have the same defect and file what you
  find**; do not fix it here.
- **Rotated pages.** Still refused, and mapping the deltas per handle stays its own row.
- **The browser embedder's stale fields** ([filed by `features/0052`](0052-stored-positions-round-trip.md)).
- **Anything on the server.** This is one component and one prop.

## Execution prompt

> **Read first:** `frontend/src/components/form-fields/FormFieldItem.vue` from `onMouseDown` to
> `stopResize`; `frontend/src/components/form-fields/FormFieldsOverlay.vue` (the `displayScale`
> prop, `overlayStyle`, and `overlayPoint` — the division this change repeats);
> `frontend/src/components/pdf/PDFViewer.vue` (`measureCanvas` and `canvasSize`);
> [05-frontend-patterns §8](../docs/sot/05-frontend-patterns.md), the section
> [`features/0052`](0052-stored-positions-round-trip.md) added on the base scale and the zoom.
>
> **Write the failing tests first**, in `FormFieldItem.spec.ts` beside the existing drag cases.
> The component takes its factors as props, so this needs no canvas: mount with
> `scaleFactor: 2` and drag 40 screen pixels — the field must move 20 stored pixels, and against
> `develop` it moves 40. Then `displayScale: 0.5` (the new prop) with `scaleFactor: 1` — 40
> screen pixels must move it 80. Then both together. One resize case: with `scaleFactor: 2`, a
> 40-pixel drag on the `e` handle widens the field by 20. Record the failures.
>
> **Then the change.** Add a `displayScale` prop to `FormFieldItem.vue` (defaulting to 1) and
> pass `props.displayScale` from `FormFieldsOverlay.vue`, where the `FormFieldItem` is rendered.
> Convert the delta **once**, at the top of `onDrag` and `onResize`:
> `dx / (props.scaleFactor * props.displayScale)`. Everything downstream — the edge clamp, the
> grid snap from [`features/0051`](0051-snap-to-grid-for-fields.md), `minSize`, the
> multi-selection offsets — already works in stored units and must not change.
> Guard the divisor: a zero or missing factor means "unknown", and dividing by it would send
> every field to `Infinity`; fall back to 1.
>
> **Then update, do not weaken,** `features/0051`'s `snaps to the grid the author can see, not
> to the stored units`: at `scaleFactor: 2` a 47-pixel drag is now 23.5 stored pixels, so the
> field lands on the grid multiple nearest `123.5` rather than `147`. Say in the comment that the
> delta is mapped, so the next reader does not think the step changed.
>
> **Do not** touch `useFieldKeyboard.ts`, `useFieldEditing.ts`, `utils/fieldGeometry.ts`,
> `useDragAndDrop.ts` or anything on the server.
>
> **Check and file, do not fix:** do the text and image previews have the same defect?
> `useTextPlacement.ts` and `useImagePlacement.ts` drag through `useDragAndDrop.ts`, and their
> containers are positioned on `.pdf-canvas-wrapper` in canvas pixels. Work out whether a
> narrow window moves them off the pointer too, and put the answer — either way — in
> `docs/BACKLOG.md`.
>
> **Verify:**
> ```bash
> npm run test:frontend
> npm run build --workspace=frontend
> npm run test:e2e
> ```
> The E2E baseline is **52 passed / 4 failed**, the four being the pre-existing DocAIFlow
> branding assertions. Watch `takes a field drag back with Ctrl+Z` in `e2e/pdf-workflow.spec.ts`
> especially: it asserts the field moved more than 20 pixels after a 110-pixel drag, which this
> change makes *more* true, and it carries the comment that measured this bug — update that
> comment, because it will no longer be describing the code.
>
> **On the way out:** `sot-sync` — [05-frontend-patterns §8](../docs/sot/05-frontend-patterns.md)
> gains the third factor: a screen delta becomes a stored delta by dividing by **both** the zoom
> ratio and the display ratio, and that is now stated once where the two scales are already
> explained. Remove the *A field does not follow the cursor* row from `docs/BACKLOG.md`, add the
> preview row if the check above finds one, set this file to `**Status:** done` with an Outcome,
> and run `ship-checklist` before the PR.


## Outcome

Done, and small in the end: one prop, one computed, and two lines changed inside the gestures.
`FormFieldItem.vue` takes `displayScale` from the overlay that already had it, and
`pointerToStored` converts the delta **once** at the top of `onDrag` and `onResize` — everything
downstream was already in stored units and none of it moved.

Three tests were written first and failed against `develop`: `expected 140 to be 120` at
`scaleFactor: 2`, `expected 140 to be 180` at `displayScale: 0.5`, and `expected 240 to be 220`
for the resize. Two more pin the parts that are easy to lose later — the two factors compose,
and a zero factor falls back to 1 instead of sending every field to `Infinity`.

**The test the spec predicted would fail did fail, and was updated rather than weakened.**
`features/0051`'s `snaps to the grid the author can see, not to the stored units` encoded the
unmapped delta: 47 screen pixels at `scaleFactor: 2` used to be 47 stored ones and landed on 150.
It is 23.5 now and lands on 120. The expectation and its comment were recomputed; the assertion
it exists for — that the step is `gridSize / scaleFactor` and not `gridSize` — is untouched and
still fails if somebody gets the step wrong.

**The E2E comment that had measured this bug is gone.** `e2e/pdf-workflow.spec.ts` carried
[`features/0047`](0047-undo-covers-field-edits.md)'s note that *"a 110px mouse delta is a smaller
delta on screen"* — 46px in that run, which was this defect being observed and written down as a
quirk of the overlay. It now says what the code does and why the assertion stays loose.

**Checked and filed, not fixed: the text and image previews.** They are a *different* defect
with the same root. Their drag is consistent with how they are drawn, so they do follow the
pointer — but they are absolutely positioned on `.pdf-canvas-wrapper` in canvas pixels with no
transform, while the canvas beside them is drawn at `width × displayScale`. In a narrow window a
preview therefore sits further right and further down than the canvas pixel `useTextPlacement.ts`
will write into the PDF, so an author places text where they see it and it lands somewhere else.
The row in `docs/BACKLOG.md` says that the evidence is the CSS and the two coordinate paths read
side by side rather than a run, and that proving it wants an E2E at a narrow viewport — which is
the first thing that fix should write.

Verified: frontend **606 tests / 66 specs**, the build clean, E2E **52 passed / 4 failed** — the
four being the pre-existing DocAIFlow branding assertions. The backend is untouched.
