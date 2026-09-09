# 0050 — Marquee selection and multi-field delete

**Status:** done
**Priority:** P3 (rows *There is no marquee selection* and the multi-delete half named in [`features/0048`](0048-multi-select-duplicate-and-keyboard-nudge.md), `docs/BACKLOG.md`; task 08 of the *Editor PDF* track in the product plan)
**Branch:** feature/0050-marquee-selection-and-multi-field-delete
**Related:** [05-frontend-patterns §8](../docs/sot/05-frontend-patterns.md) · [06-api-reference](../docs/sot/06-api-reference.md) · [04-backend-patterns §5](../docs/sot/04-backend-patterns.md) · [`features/0044`](0044-field-delete-archives-its-answers.md) · [`features/0048`](0048-multi-select-duplicate-and-keyboard-nudge.md) · [`features/0049`](0049-every-field-write-re-embeds-the-pdf.md)

## Context

[`features/0048`](0048-multi-select-duplicate-and-keyboard-nudge.md) made a selection a **set** —
`selectedFieldIds` in `frontend/src/stores/formFields.store.ts`, with `selectFields(ids)`,
`toggleFieldSelection`, `moveFieldsBy`, align, distribute, duplicate and the keyboard in
`frontend/src/composables/useFieldKeyboard.ts`. It deliberately stopped in two places, and
this spec is both halves.

**There is no way to select a set with the mouse.** The only gesture is
`Shift`/`Ctrl`/`Cmd`+click, one field at a time (`FormFieldItem.vue:167`,
`isMultiSelectClick`). For the thirty-checkbox government form this product exists for, that
is thirty modifier clicks before the align button becomes useful.

**And there is no way to delete a set.** `FieldPropertiesPanel.vue` renders only for
`formFieldsStore.selectedField` — the single anchor — and `confirmRemoveField` (line ~688)
removes exactly that one field through `deleteFieldFromServer`. With six fields selected,
the author deletes them one at a time, reading a confirmation each time.

The marquee is not a missing call, which is why it was left out rather than rushed: it is a
**layering decision**. `FormFieldsOverlay.vue` is `pointer-events: none` at `z-index: 8`
(`FormFieldsOverlay.vue:279`), sitting directly above `.text-layer` at `z-index: 7`
(`PDFViewer.vue:592-599`), which is `pointer-events: auto` and owns the PDF's selectable text
and everything `usePDFSearch` highlights. That is also why the "click the page to deselect"
handler of 0048 is bound on `.pdf-canvas-wrapper` rather than on the overlay — the comment at
`PDFViewer.vue:39-43` says so out loud.

## Why the obvious approach is wrong

**Making the overlay take the pointer.** `pointer-events: auto` on
`.form-fields-overlay` is one line and it is how the marquee "just works" — by taking text
selection and search highlighting away from the entire canvas, permanently, for everybody who
never draws a marquee. The overlay covers the whole page. Whatever this feature does, **the
text layer must keep the pointer while the marquee is not being used**, and there has to be a
test that says so.

**Starting the marquee from `mousedown` on `.pdf-canvas-wrapper`.** The wrapper does receive
clicks today, and a `mousedown` on the text layer bubbles to it — so this looks like the free
option. It is not: the same gesture is already the browser's text selection, so dragging
would paint a rubber band *and* select the text under it, and suppressing the text selection
means `preventDefault` on the text layer, which is the previous mistake by another route.

**The recommended answer is an explicit mode**, and the editor already has the concept:
`frontend/src/components/toolbars/DrawingToolbar.vue` holds `general` tools
(`search`, `text`, `image`) and the five field tools, dispatching through
`handleToolSelection` in `PDFViewer.vue:310`. A `select` tool joins that list, turns the
overlay's pointer events on **while it is active and only then**, and turns them off when it
is dismissed — the same shape `isAddingField` already uses on `.adding-mode`
(`FormFieldsOverlay.vue:281-284`), which is the existing precedent for the overlay taking the
pointer temporarily. If you choose differently, write down why in the spec's Outcome; do not
choose silently.

**Multi-delete is not a loop over `DELETE /forms/:formId/fields/:fieldId`.** The backlog row
predates [`features/0049`](0049-every-field-write-re-embeds-the-pdf.md) and says six fields
are six requests with six possible answers. That is still true of the *rule* — a field with
answers is archived, one without is deleted, and only the server knows which — but the loop
now costs something it did not: **every one of those requests re-embeds the whole PDF.**
Deleting thirty checkboxes would be thirty read-modify-writes of the same document, serialised
one behind another by the per-form lock, while the author waits.

So this feature adds **one endpoint**: `POST /api/forms/:formId/fields/delete` taking
`{ fieldIds: string[] }`, applying 0044's rule per field inside **one** transaction, and
requesting **one** embed after it commits. That is not scope creep — it is the same shape the
bulk save already has (`form-fields.ts`, the `/bulk` handler), for the same reason, and it
turns "six possible answers" into one answer the UI can actually summarise.

**The transaction must lock before it counts.** `SELECT … FOR UPDATE` on the fields being
removed, *before* `answer.count`, exactly as the single `DELETE` and the bulk save do
(`form-fields.ts:245`). Counting first restores the race in full: a submission accepted
between the count and the delete gets a `201` and has its answer cascaded away.

**A partial failure must not leave half a deletion.** One transaction is what makes the undo
entry honest: either all of them went or none did, and the client has one list to put back.

## Goal

1. A **select tool** (or a documented alternative) exists in the drawing toolbar. While it is
   active, dragging on empty page area paints a rubber band and selects every field of the
   current page whose box intersects it, through `formFieldsStore.selectFields`.
2. **While it is not active, nothing changes**: `.text-layer` keeps `pointer-events: auto`,
   text is selectable, and search highlighting works. A test asserts the overlay is not taking
   the pointer in the default state.
3. A marquee that selects nothing clears the selection rather than leaving the previous one.
4. `POST /api/forms/:formId/fields/delete` exists, takes `{ fieldIds }`, is `authenticate` +
   `verifyFormOwnership`, applies the archive-or-delete rule per field in one transaction that
   takes `SELECT … FOR UPDATE` on those rows **before** counting answers, calls
   `requestEmbed(formId, { allowEmpty: true })` once after it commits, and answers
   `{ archived: [{id, answerCount}], deleted: string[] }`.
5. An id that is not a live field of this form is a **`400`** for the whole request, the same
   rule the bulk save applies — never a silent skip.
6. The editor deletes a multi-selection in one gesture, with **one** confirmation that says
   how many fields and how many of them are known to hold answers, **one** toast summarising
   the mixed outcome ("4 removed, 2 archived, 37 responses kept"), and **one** undo entry.
7. The undo entry follows 0047's id rule: fields the server really deleted come back with new
   local ids and `editorStore.forgetFieldId` is called for each; archived ones are not revived
   locally, because their way back is the rail's Restore.
8. Integration tests for the endpoint against a real PostgreSQL, including the mixed case
   (some fields with answers, some without) and the race the lock exists for.

## Out of scope

- **Snap to grid for fields** — the `FormFieldItem.vue` / `useDragAndDrop` gap. Its own row,
  and it changes every existing drag.
- **Redo, and undo for the properties panel** — the two gaps [`features/0047`](0047-undo-covers-field-edits.md) left.
- **Rotated pages.** `canEditGeometry` is `false` when the page is turned; the marquee must
  respect that the same way the keyboard does (selection is fine, moving is not), and the
  rotation fix itself stays filed.
- **A bulk *update* endpoint.** The bulk save already is one.
- **Anything in `services/pdf-embed.ts` or `pdf-processor.ts`.** 0049 has just settled the
  embed contract, including `allowEmpty`; this feature is a caller.
- **Multi-field editing in the properties panel** (changing `required` for six fields at
  once). File it if the work makes it tempting.

## Execution prompt

> **Read first:** `frontend/src/components/form-fields/FormFieldsOverlay.vue` (the whole file
> — the coordinate mapping in `handleOverlayClick` is what a marquee has to reuse),
> `FormFieldItem.vue:160-215` (how selection is settled on mousedown/mouseup),
> `frontend/src/components/pdf/PDFViewer.vue:30-80` and `:592-620` (the layer stack and the
> comment explaining why the deselect click is bound where it is),
> `frontend/src/stores/formFields.store.ts` (`selectedFieldIds`, `selectFields`,
> `deleteField`, `deleteFieldFromServer`, `refreshArchivedFields`),
> `frontend/src/composables/useFieldEditing.ts`, `useFieldKeyboard.ts`,
> `frontend/src/components/form-fields/FieldPropertiesPanel.vue` around `confirmRemoveField`
> and `recordRemovalForUndo`, and `backend/src/routes/form-fields.ts` in full.
>
> **Backend first**, following the `backend-endpoint-pattern` skill. Add
> `POST /:formId/fields/delete` to `backend/src/routes/form-fields.ts`, declared **above** the
> `/:formId/fields/:fieldId` routes for the shadowing reason the file already documents twice.
> Zod schema: `{ fieldIds: z.array(z.string().uuid()).min(1).max(200) }`. One
> `prisma.$transaction`: `SELECT … FOR UPDATE` on all of them first, then count answers per
> field, then archive the ones with answers and delete the ones without. Reject the **whole**
> request with `400` if any id is not a live field of the form. After the commit — never
> inside — `await requestEmbed(formId, { allowEmpty: true })`.
> Write `backend/tests/integration/fields-bulk-delete.spec.ts`: the mixed case, the `400`, the
> single embed (assert the stored PDF matches the surviving live fields, the way
> `field-writes-embed.spec.ts` does), and the concurrency case — a submission racing the
> deletion, in one `Promise.all`, the way `plan-limit-races.spec.ts` does it. **Run the race
> test against a version without the lock and see it fail**, then put the lock back.
>
> **Then the frontend**, following `frontend-state-pattern`. Add
> `fieldsService.deleteMany(formId, fieldIds)` to `frontend/src/services/fields.ts` with the
> result type, and `deleteFieldsFromServer(ids)` to the store beside
> `deleteFieldFromServer` — it removes them locally, refreshes the archived list once if
> anything was archived, and returns the server's answer. Do not change the single-field path.
>
> **Then the marquee.** Add the `select` tool to `DrawingToolbar.vue` and a case in
> `handleToolSelection`. Hold the mode in the store or the editor store — wherever
> `isAddingField` lives is the precedent — and let `FormFieldsOverlay.vue` turn its own
> `pointer-events` on for that mode only, the way `.adding-mode` already does. Draw the band
> in overlay-local pixels and hit-test in the same space the fields are laid out in; the
> `displayScale` division in `handleMouseMove` is the arithmetic to copy, and getting it wrong
> shows up as a band that lags the cursor on a narrow window.
>
> **Then the delete gesture.** One confirmation and one toast, built from the endpoint's
> answer; and one undo entry, applying `recordRemovalForUndo`'s existing rule per field —
> really-deleted fields come back with a fresh local id and `forgetFieldId` is called, archived
> ones are not revived. Read the comment above that function before writing it: a dead id left
> in one old undo entry breaks **every later save** of the form with a `400` until reload.
>
> **Tests.** Frontend specs beside the source for the store action and the overlay's marquee
> geometry (a pure hit-test function is worth extracting, the way
> `utils/fieldGeometry.ts` was in 0048). One E2E in `e2e/` that drags a marquee over two
> fields and deletes them — the E2E is the only place the real layer stack exists, and note
> from 0048 that the overlay is drawn scaled, so 110 px of mouse is 46 px on screen.
>
> **Verify:**
> ```bash
> npm run test:integration
> npm run test:backend
> npm run test:frontend
> npm run test:e2e
> cd backend && npx tsc --noEmit
> npm run build --workspace=frontend
> ```
> Note before you start: **four E2E tests are already red on `develop`** — they assert the old
> brand name (`e2e/example.spec.ts:7`, `form-management.spec.ts:39`, `pdf-workflow.spec.ts:164`,
> `error-handling.spec.ts:178,183`). That is a filed row in `docs/BACKLOG.md`, not yours. 51
> passed / 4 failed is the baseline; anything else is this branch.
>
> **On the way out:** `api-contract-guard` over the new endpoint, then `sot-sync` —
> [06-api-reference](../docs/sot/06-api-reference.md) gains the endpoint and
> [05-frontend-patterns §8](../docs/sot/05-frontend-patterns.md) gains the layering decision and
> what it cost. Remove the *There is no marquee selection* row from `docs/BACKLOG.md`. Set this
> file to `**Status:** done` with an Outcome, and run `ship-checklist` before the PR.


## Outcome

Done, both halves, and the spec's recommended answer to the layering question is what
shipped: a `select` tool in `DrawingToolbar.vue` arms the mode, `FormFieldsOverlay.vue` takes
the pointer **only** while it is armed (`.select-mode`), and `Escape` gives it back. The
overlay's default state is asserted by `FormFieldsOverlay.spec.ts` — that is the test that
fails the day somebody decides the mode is ceremony and makes `pointer-events: auto`
permanent, taking text selection and search highlighting from the whole canvas.

Four things worth keeping.

**The race test had to be arranged, not hoped for.** The `Promise.all` shape that
[`features/0044`](0044-field-delete-archives-its-answers.md) used could not be made to fail
against a handler with the lock removed: this transaction is short, so it simply wins the
interleave every time and the test passes for the wrong reason — which is exactly the kind of
test this repository does not want. So the deterministic version holds the *inserting*
transaction open (`prisma.$transaction` with a gate) while the deletion runs, and the
interleave is the one the lock exists for. Removing the `SELECT … FOR UPDATE` and running it
gives `expected [] to have a length of 2`: an answer accepted with a `201` and then cascaded
away. Both tests are kept — the arranged one proves the rule, the concurrent one guards the
handler under a real race.

**The confirm dialog gained a re-entry guard because a test insisted.** The panel's `Button`
stub emits `click` *and* falls through to the native listener, so one press ran
`confirmRemoveSelection` twice — two requests and two undo entries for one gesture. That is a
stub artefact, but the same thing happens to anybody who double-clicks a confirm button, so
the fix is the guard rather than a cleverer stub. The count in the heading is frozen when the
dialog opens for a related reason: the request empties the selection as it succeeds, and a
heading counting down to "Remove 0 fields?" while the button spins tells the author the wrong
thing at the worst moment.

**The dialog is a root-level sibling, not a child of the multi-selection branch.** The panel
is a `v-if`/`v-else-if`/`v-else` chain on the selection, so a dialog inside the first branch
disappears the moment the fields it is removing leave the selection — mid-request. Two failed
attempts at placing it (one broke the `v-else-if` chain, one landed inside another dialog's
`<template #footer>`) are the reason this is written down.

**The E2E band is drawn upwards, from below and right of the fields.** Only the *start* of a
drag has to be on the overlay — the move and the release are tracked on the window — and the
space above the fields is where the floating toolbar lives, so there is nothing free to press
there. The start also has to be outside the fields on both axes or the band spans only part of
the column, which is how the first version selected one field out of two.

Verified: `fields-bulk-delete.spec.ts` 8/8, integration 299 passed / 10 skipped, backend 403,
frontend 584 (64 specs), `tsc --noEmit` and the frontend build clean. E2E **52 passed / 4
failed** — the four are the pre-existing DocAIFlow branding assertions filed in
`docs/BACKLOG.md`, unchanged from the baseline on `develop`; the new marquee test is the
52nd pass.

Filed rather than fixed: nothing new. Multi-field *editing* in the properties panel (changing
`required` for six fields at once) was left out as the spec said and did not become tempting.
