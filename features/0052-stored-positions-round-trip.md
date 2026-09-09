# 0052 — A stored position round-trips, and the base scale has one name

**Status:** done
**Priority:** P3 (rows *PDF round-trip test: editor position → embedded AcroForm position* and *Move the canvas/PDF scale into the data instead of two hard-coded constants*, `docs/BACKLOG.md`; task 11 of the *Editor PDF* track in the product plan)
**Branch:** feature/0052-stored-positions-round-trip
**Related:** [04-backend-patterns §5](../docs/sot/04-backend-patterns.md) · [05-frontend-patterns §8](../docs/sot/05-frontend-patterns.md) · [09-quality-and-testing](../docs/sot/09-quality-and-testing.md) · [`features/0049`](0049-every-field-write-re-embeds-the-pdf.md) · [`features/0051`](0051-snap-to-grid-for-fields.md)

## Context

A field's position is stored **once**, in canvas pixels at a base scale of `1.5`, with the
page upright. Everything that draws or embeds a field divides or multiplies by that number,
and **the number is written as a bare literal in nine places across the two workspaces**:
`DEFAULT_SCALE` in `backend/src/services/pdf-processor.ts:33`, `BASE_SCALE` in
`FormFieldsOverlay.vue:121` and `PublicFormFieldItem.vue:99`, and a plain `1.5` in
`PublicFormFieldsOverlay.vue:48`, `PDFViewer.vue:281`, `useDownloadPDF.ts:38`,
`useFormFieldsExport.ts:16`, `usePDFFieldsLoader.ts:21`, `document.store.ts:55` and
`utils/pdfFieldEmbedder.ts:152`.

**Nothing verifies the trip.** `backend/tests/pdf-processor.spec.ts` embeds fields and
extracts them back — and asserts only the *name* and the *type*. The position is never
checked, in either direction, anywhere in this repository. There is no spec at all for
`frontend/src/utils/pdfFieldEmbedder.ts`.

And with no test, the two embedders have already drifted. **The frontend one divides the
stored position by the current zoom.** `useDownloadPDF.ts:38` and `useFormFieldsExport.ts:16`
both read `documentStore.activeDocument.scale || 1.5` and pass it to `embedFieldsInPDF`,
where `canvasToPDFCoords` divides by it — but `activeDocument.scale` is the **zoom**, written
by `setScale` from the viewer's zoom buttons and clamped to 0.5–3.0. The stored position is at
1.5 whatever the zoom is. So downloading the document after zooming in puts every field in the
wrong place, and at 3.0 it puts them at half their correct distance from the origin. It is
invisible at the default zoom, which is exactly 1.5.

The backend does the same arithmetic against the fixed `DEFAULT_SCALE` and is correct. Two
implementations of one mapping, one right and one wrong, and no test that compares them.

## Why the obvious approach is wrong

**Doing the refactor first.** The backlog row says *"the work is the test before the refactor:
without it, moving the scale into the data is changing something nobody is looking at"*, and
that is more true than it was when it was written — the drift above is what "nobody is
looking at" produced. Write the round-trip test first, then the assertion that the two
embedders agree, and only then touch the constant. A refactor that moves nine literals with no
test is a change whose only verification is that the app still starts.

**Making the base scale configurable, or storing it per document.** "Move the scale into the
data" reads like a column. It must not become one: every field position already in the
database was written against `1.5`, so a per-document scale is a migration of every row plus a
default that has to stay `1.5` for ever. What the row is really asking for is **one named
constant per workspace instead of nine literals**, with the two names documented as the same
number and the reason they cannot be imported from each other (`backend/` and `frontend/` are
separate workspaces with no shared package, and inventing one for a single number is worse than
the comment).

**Assuming `activeDocument.scale` is the base scale.** It is the zoom. Anything that converts a
stored position must use the base constant; anything that positions something on the visible
canvas uses `scale / BASE_SCALE` (`renderScale` in `FormFieldsOverlay.vue` is the example to
copy). Both meanings are called "scale" in this code, which is how the drift happened.

**Fixing the download by passing `1.5` at the call site.** That trades one literal for another
and leaves the parameter's default (`scale: number = 1.5`, `pdfFieldEmbedder.ts:152`) as a
third place to get it wrong. The embedder converts *stored* coordinates: it should not take a
scale from its caller at all.

**Turning this into the cursor fix.** The row *A field does not follow the cursor at any zoom
but the base one* ([filed by `features/0051`](0051-snap-to-grid-for-fields.md)) is the next
thing on top of this test and is **not** in this spec. It changes every drag and resize; this
one changes an export path and adds tests. Keep them separately revertable.

## Goal

1. `backend/tests/pdf-processor.spec.ts` asserts the **position** round-trips:
   a field embedded at a known stored position comes back from `extractFieldsFromPDF` at the
   same position, within a pixel of rounding, on a page whose height is not the same as its
   width (a square page hides an axis swap).
2. A frontend spec for `utils/pdfFieldEmbedder.ts` asserts the same mapping produces the same
   PDF rectangle as the backend's for one worked example — so the two embedders are pinned to
   each other rather than each to itself.
3. **The download and the export no longer depend on the zoom.** A test zooms the document to
   3.0, exports, and gets the same field rectangle as at 1.5. This is a bug fix and its test is
   written first and seen to fail.
4. `embedFieldsInPDF` in `utils/pdfFieldEmbedder.ts` no longer takes a `scale` parameter, or
   takes one with no default that only the base constant is ever passed to — the call sites do
   not decide this.
5. One exported constant per workspace: `BASE_SCALE` from a single frontend module, imported by
   every frontend file that currently writes `1.5`; `DEFAULT_SCALE` stays the backend's and is
   commented as the same number, with why it is not shared.
6. `document.store.ts`'s initial `scale: 1.5` reads from that constant, and the fact that the
   default zoom happens to equal the base scale is written down — it is why the bug was
   invisible.

## Out of scope

- **The cursor-follow bug** on drag and resize, as argued above. It is the next feature and
  wants this test underneath it.
- **Rotated pages.** `utils/pdfCoordinates.ts` already maps rotation and has its own spec.
- **The frontend embedder's stale fields.** `pdfFieldEmbedder.embedFieldsInPDF` removes only a
  field of the *same name* before adding — the bug [`features/0049`](0049-every-field-write-re-embeds-the-pdf.md)
  fixed in the backend embedder. Check whether a downloaded document can therefore carry a
  question the form no longer has, and **file it** with the answer; do not fix it here.
- **A shared package** for the two workspaces.
- **Anything about how the zoom itself works**, including its 0.5–3.0 clamp.

## Execution prompt

> **Read first:** `backend/src/services/pdf-processor.ts` — `extractFieldsFromPDF` (the
> PDF→canvas mapping, lines ~55–120) and `embedFieldsInPDF` (canvas→PDF, lines ~166–215);
> `frontend/src/utils/pdfFieldEmbedder.ts` (`canvasToPDFCoords` and `embedFieldsInPDF`);
> `frontend/src/composables/useDownloadPDF.ts` and `useFormFieldsExport.ts` (the two callers
> that pass the zoom); `frontend/src/stores/document.store.ts` (`setScale`, and the initial
> `scale`); `frontend/src/components/form-fields/FormFieldsOverlay.vue` (`BASE_SCALE`,
> `renderScale` — the correct use of both meanings); `backend/tests/pdf-processor.spec.ts`.
>
> **Write the tests first, all three, and run them against `develop`.**
>
> 1. In `backend/tests/pdf-processor.spec.ts`, a `round trip` case: embed one field at a
>    known position into a page that is **not square**, extract, and assert `x`, `y`, `width`
>    and `height` come back equal (allow ≤1px for `pdf-lib`'s rounding). Add a second field near
>    the bottom of the page, because the `y` flip is where an off-by-a-page-height hides.
> 2. A new `frontend/src/utils/pdfFieldEmbedder.spec.ts`: embed the same worked example with
>    `pdf-lib` and read the widget rectangle back, asserting the same numbers the backend test
>    asserts. Both files should name the other in a comment — they are one assertion in two
>    places, and the point is that they cannot drift silently.
> 3. A test for the zoom bug, in whichever of the two frontend specs is the natural home:
>    with `documentStore.setScale(3)`, the exported field rectangle is identical to the one at
>    the default scale. **This one fails against `develop`** — record the output.
>
> **Then the fix.** Take the `scale` argument out of `embedFieldsInPDF` in
> `utils/pdfFieldEmbedder.ts` and have `canvasToPDFCoords` use the base constant directly.
> Update `useDownloadPDF.ts` and `useFormFieldsExport.ts` to stop reading
> `activeDocument.scale`.
>
> **Then the constant.** Export `BASE_SCALE` from `frontend/src/utils/pdfCoordinates.ts` — it
> already documents the storage convention in its header comment, so the number belongs beside
> the prose — and import it in every frontend file that writes `1.5` for this purpose. Be
> careful with the ones that are **not** the base scale: `PDFViewer.vue:281` and
> `document.store.ts:55` are the *default zoom*, which happens to be the same number; they read
> the constant with a comment saying they are the zoom's default and would keep working if the
> two ever differed. In the backend, leave `DEFAULT_SCALE` where it is and comment it with the
> frontend's name and the reason it is duplicated rather than shared.
>
> **Do not** add a column, a setting or a shared package, do not touch the drag or resize
> deltas, and do not change `utils/pdfCoordinates.ts`'s rotation maths.
>
> **Verify:**
> ```bash
> npm run test:backend
> npm run test:frontend
> npm run test:integration
> cd backend && npx tsc --noEmit
> npm run build --workspace=frontend
> npm run test:e2e
> ```
> The E2E baseline is **52 passed / 4 failed**, the four being the pre-existing DocAIFlow
> branding assertions filed in `docs/BACKLOG.md`. Anything else is this branch.
>
> **On the way out:** `sot-sync`. [05-frontend-patterns §8](../docs/sot/05-frontend-patterns.md)
> gains the distinction between the **base scale** and the **zoom**, which is the thing that
> caused this bug and will cause it again; [09-quality-and-testing](../docs/sot/09-quality-and-testing.md)
> gains the round-trip test as the guard for the one property nothing else covers. Remove both
> rows — the round-trip test and the two constants — from `docs/BACKLOG.md`, and add the row for
> the frontend embedder's stale fields if the check above finds it real. Set this file to
> `**Status:** done` with an Outcome, and run `ship-checklist` before the PR.


## Outcome

Done, and it turned out to be **three** bugs of one kind rather than the two the spec named.

The round trip itself was correct on the server and is now asserted: a stored position embedded
into a deliberately non-square page comes back from `extractFieldsFromPDF` where it went in,
including a field low on the page where an off-by-a-page-height in the `y` flip would hide.
`utils/pdfFieldEmbedder.spec.ts` — which did not exist — asserts the **same** worked example and
the **same** PDF rectangle, so the two embedders are pinned to each other rather than each to
itself.

**The zoom bug was real and reproduced before the fix.** `useFormFieldsExport.spec.ts` was
written first and failed against `develop` with the field at `(50, 645)` after
`setScale(3)` and `(300, 370)` after `setScale(0.5)`, where it belongs at `(100, 590)`.

**The third one was found while doing the sweep of literals**: `usePDFFieldsLoader.ts` used the
zoom to convert an AcroForm *into* stored positions, so extracting a PDF's own fields while
zoomed in wrote every one of them scaled by whatever the author happened to be looking through.
Same mistake, opposite direction, and the one with the worse consequence — the other two produce
a wrong download, this one writes wrong data.

Three corrections to what the spec claimed, in the interest of the next person trusting it:

- **The position was not entirely unasserted.** The existing "update without duplicates" test
  checked one axis of one field with `toBeCloseTo(150, -1)` — a five-pixel tolerance on a page
  whose size it never states. Too loose to catch a scale that is out by a factor, which is why
  it never did.
- **The round trip is not exact, and the reason is worth knowing.** `pdf-lib` expands a widget
  rectangle by half its border on each side, so a bordered field returns 0.75 stored pixels up
  and left and 1.5 wider and taller. Fixed, explainable, and it does not accumulate. The test
  states the tolerance and why rather than hiding it in a loose `toBeCloseTo`.
- **It was nine literals, and one of them was not the base scale at all.** `PDFViewer.vue` and
  `document.store.ts` hold the *default zoom*, which is the same number by coincidence; they
  read `BASE_SCALE` with a comment saying they are the zoom's default, so they keep working the
  day the two stop being equal.

Filed rather than fixed, as the spec asked, and confirmed with a throwaway test rather than by
reading: **the browser's embedder keeps fields the form no longer has.** `embedFieldsInPDF`
removes only a field of the same name, so a question deleted in the editor is still in the
document that **Download** produces — the client-side twin of the defect
[`features/0049`](0049-every-field-write-re-embeds-the-pdf.md) fixed on the server. The row is in
`docs/BACKLOG.md` with the reproduction.

Verified: frontend **600 tests / 66 specs**, backend **405**, integration **299 passed / 10
skipped**, `tsc --noEmit` and the frontend build clean, E2E **52 passed / 4 failed** — the four
being the pre-existing DocAIFlow branding assertions.
