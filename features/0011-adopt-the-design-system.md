# 0011 — Adopt the design system across the product

**Status:** in progress
**Priority:** P2 (see [docs/BACKLOG.md](../docs/BACKLOG.md))
**Branch:** `feature/0011-adopt-the-design-system`
**Related:** [05-frontend-patterns §8](../docs/sot/05-frontend-patterns.md) · [10-saas-roadmap build order, step 6](../docs/sot/10-saas-roadmap.md#build-order) · [07-security-and-privacy](../docs/sot/07-security-and-privacy.md) · [`features/0007`](0007-security-headers-and-csp.md)

## Context

A complete design for this product exists and **none of it is built**. The canvas — *VuePDF Forms*, <https://claude.ai/code/artifact/be7f6015-4f99-46aa-9a61-8c051d4637b4> — holds 11 artboards on four pages (Landing, Product, SaaS layer, System). The app it is a design *for* still runs PrimeVue Aura's stock preset, Tailwind's stock palette, `system-ui` type, and a blue-to-indigo gradient brand called **"PDF Editor Pro"** (`frontend/src/layouts/AuthLayout.vue:10`, `frontend/src/views/DashboardView.vue:23`, `frontend/src/components/auth/RegisterForm.vue:175`) — a name that appears nowhere in the design, the SoT, or the product.

This is **step 6 of the [build order](../docs/sot/10-saas-roadmap.md#build-order)**, and it sits ahead of `Plan` + entitlements for one reason only: the canvas already contains the **Plan & usage** and **Plan limit reached** screens that step 7 has to build. Adopting the system first means building those once instead of twice. Step 7 is not *blocked* by this — it is made cheaper.

The token values are already recorded in [05-frontend-patterns §8](../docs/sot/05-frontend-patterns.md) and are **not restated here**; that section is the executor's reference for colours, type scale, control heights, geometry and the three rules the canvas states (accent is rationed, numbers are mono, a field looks different in the editor than on the public form). The canvas itself is the source of truth for *layout*. Its artboards are lazily offloaded, so at first glance the published HTML looks like a 2.6 MB runtime shell with no design in it — but the artboard sources **are** in there, embedded as JSON string values keyed by `<Name>.dc.html`. The eleven keys are `Main`, `Editor`, `Responses`, `PublicForm`, `PublicFormMobile`, `Plans`, `Members`, `LimitReached`, `System`, `Landing`, `LandingMobile`. Reading the artifact with the Artifact tool saves the whole page to a local file; slicing each JSON value out of it and `json.loads`-ing it gives back the original artboard HTML, which is plain inline-styled markup and is the most precise form of the design available. That is how the numbers below were read.

No previous attempt exists. `git log --all` has no design, theme or token commit; `b90d85f` only put the design into the roadmap.

## Why the obvious approach is wrong

**1. Writing CSS overrides instead of a PrimeVue preset gives you two palettes.** Nine of the ten views are built from PrimeVue components. `frontend/src/main.ts:23` passes `preset: Aura` unmodified, so every `Button`, `InputText`, `DataTable` and `Dialog` renders Aura's own primary ramp. If the accent is applied only to hand-written Tailwind markup, the app ends up with the canvas accent `#3554d1` next to Aura's default on the same screen. The fix is `definePreset` from `@primevue/themes` — the canvas states *"PrimeVue Aura keeps the component behaviour"*, which means **override Aura's design tokens, do not replace or bypass the component layer**.

**2. A Google Fonts `<link>` is silently blocked by our own CSP, twice.** The design calls for Instrument Sans and JetBrains Mono. `frontend/vite.config.ts` sets `'font-src': ["'self'", 'data:']` (line 57) and `'style-src': ["'self'", "'unsafe-inline'"]` — `fonts.googleapis.com` fails the second, `fonts.gstatic.com` fails the first, and the page renders in the fallback font with only a console entry to show for it. **Self-host the fonts as bundled same-origin assets** (`@fontsource-variable/*`, or the woff2 files under `frontend/src/assets/`). Do **not** widen the CSP: the current policy was measured, not guessed, in [`features/0007`](0007-security-headers-and-csp.md), and adding two third-party origins to buy a webfont is a bad trade this project has already reasoned about.

**3. Replacing Tailwind's palette fails silently, so the order of operations matters.** `frontend/tailwind.config.cjs` uses `theme.extend`, so the stock palette is fully available and the existing markup is soaked in it — `bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50`, `border-gray-200`, `text-gray-600`, `ring-blue-600`. Moving the palette to `theme.colors` (replacing rather than extending, which is what the canvas asks for) makes every one of those class names unknown, and **Tailwind drops unknown utilities without an error** — no build failure, no warning, just unstyled elements. So: convert the markup first, replace the palette second, then grep for survivors. A build that passes proves nothing here.

**4. Restyling breaks tests that assert on classes and on brand copy.** Two concrete hits, both of which must move in the same commit as the change that breaks them:

- `e2e/pdf-workflow.spec.ts:39` asserts `page.locator('text=PDF Editor Pro')`. Renaming the brand to *VuePDF Forms* turns that red.
- `frontend/src/components/pdf/PageThumbnails.spec.ts:115` asserts `classes()).toContain('ring-blue-600')` — a stock-palette class name.

And these class hooks are load-bearing for the E2E suite even though they look decorative: `.dashboard-view` (`e2e/form-management.spec.ts:55`), `.text-input` and `.public-field-item` (`e2e/public-form-flow.spec.ts:21,24,45,56`), `.pdf-viewer-container` (`e2e/pdf-workflow.spec.ts`). Keep them, or change the selector in the same commit. Do not discover this by running the suite at the end.

**5. `:style` bindings in the editor are geometry, not styling.** `FormFieldItem.vue`, `FormFieldsOverlay.vue`, `PublicFormFieldItem.vue` and `PDFViewer.vue` use `:style` to position overlays over the PDF canvas at a scale coupled to the backend's stored coordinates — the highest-risk implicit coupling in the repo ([05-frontend-patterns §4](../docs/sot/05-frontend-patterns.md)). Restyling a field's *appearance* is in scope. Converting its *positioning* to classes, or touching `DEFAULT_SCALE`, is not, and would be a field-placement bug wearing a design change as a disguise.

**6. Do not invent a dark theme.** `main.ts` configures `darkModeSelector: '.dark-mode'` and nothing in the app ever sets that class. The canvas has one palette. Leave the option in place; do not build a second theme nobody designed.

## Goal

Checkable when finished:

1. `frontend/tailwind.config.cjs` defines the canvas palette, type families, type scale, radii and spacing as the theme — replacing Tailwind's stock colour palette, not extending it. `grep -rE 'slate-|indigo-|gray-[0-9]|blue-[0-9]' frontend/src` returns nothing.
2. `frontend/src/main.ts` passes a `definePreset(Aura, …)` preset whose primary ramp is the canvas accent `#3554d1`, with surface and content tokens matching Ink / Muted / Faint / Line. No PrimeVue component renders Aura's stock primary anywhere in the app.
3. Instrument Sans and JetBrains Mono load from our own origin. The app renders in them with the CSP in `frontend/vite.config.ts` **unchanged**, and the browser console shows zero CSP violations on the dashboard, the editor, the responses table, the members screen and a public form.
4. Every number in the UI — counts, dates, ids, coordinates — renders in JetBrains Mono. Every screen has at most one accent-coloured primary action.
5. The brand is **VuePDF Forms** everywhere it appears — `AuthLayout.vue`, `DashboardView.vue`, the `RegisterForm.vue` welcome toast, and `frontend/index.html`'s `<title>` (currently `vuepdf`) — with no gradient text and no `pi-file-pdf` gradient tile.
6. `MembersView.vue` is rebuilt against the **Members & roles** artboard, replacing its hand-written CSS. This closes the P3 row saying it was built without the design.
7. A field in the editor is a bordered rectangle with a type tag; the same field on the public form is a single underline. The two do not share a component's styling.
8. All four suites green: `npm run test:frontend`, `npm run test:backend`, `npm run test:integration`, `npm run test:e2e`. `npm run build --workspace=frontend` passes (it runs `vue-tsc`).
9. Field positions in the editor and in the embedded AcroForm are unchanged — verified by hand against a real PDF, because nothing automated covers it (P3 row: *PDF round-trip test*).

## Out of scope

- **The landing page.** A [parallel track](../docs/sot/10-saas-roadmap.md#parallel-track-the-landing-page), blocked on a technology decision nobody has taken ([02-architecture](../docs/sot/02-architecture.md#the-landing-page-an-open-decision-not-implemented)) and on facts that are not engineering work. Its artboards are in the same canvas; ignore them.
- **The Plan & usage and Plan limit reached screens.** They are designed, and step 7 builds them. Do not build screens for entitlements that do not exist.
- **Narrowing `style-src` off `'unsafe-inline'`.** The backlog says to do that only alongside a deliberate styling change — and this *is* one, which is exactly why it must be resisted here: 373 of the 423 measured violations come from `style` attributes that this change does not remove.
- **Replacing PrimeVue, adding a component library, or extracting a component kit.** Token and layout change only.
- **i18n**, TanStack Query, and moving the canvas/PDF scale into the data. Separate P3 rows.
- **Backend anything.** No route, schema or response shape changes.

## Execution prompt

> Adopt the VuePDF Forms design system across the existing frontend. This is step 6 of the build order in `docs/sot/10-saas-roadmap.md`.
>
> **Read first, in this order:** this spec end to end; `docs/sot/05-frontend-patterns.md` §8 for the token values and the three rules; then get the artboards out of the canvas at <https://claude.ai/code/artifact/be7f6015-4f99-46aa-9a61-8c051d4637b4> as described in Context — read the artifact, then slice the `<Name>.dc.html` JSON values out of the saved file. `System` is the token reference; `Main`, `Editor`, `Responses`, `PublicForm`, `PublicFormMobile` and `Members` are the screens in scope.
>
> Work in this order, committing at each phase so a regression is bisectable:
>
> **Phase 1 — foundation, no visible screen work.**
> - Self-host Instrument Sans (400/500/600) and JetBrains Mono (400/500). Bundle them; do not link a font CDN — `frontend/vite.config.ts:57` sets `font-src 'self' data:` and a CDN font fails silently. Do not edit `buildCsp`.
> - `frontend/tailwind.config.cjs`: put the canvas palette in `theme.colors` (replacing the stock palette), the two families in `theme.fontFamily`, and the type scale, radii (10/7/999) and control heights in `theme.extend`.
> - `frontend/src/main.ts`: replace `preset: Aura` with `definePreset(Aura, {...})` from `@primevue/themes`, mapping the accent and the neutral ramp onto Aura's semantic tokens. Keep `darkModeSelector`.
> - `frontend/src/style.css` and the `<style>` block in `frontend/src/App.vue`: replace `system-ui` with the design families, and drop the hard-coded `#f1f5f9` / `#cbd5e1` scrollbar colours in favour of tokens. `shimmer`, `float` and the gradient helpers belong to the old visual language — `grep` for each, delete what nothing uses.
>
> **Phase 2 — the shell and the brand.** `DashboardView.vue`, `AuthLayout.vue`, `index.html`, `RegisterForm.vue:175`. Rename **PDF Editor Pro** → **VuePDF Forms**, remove the gradient logo tile and the gradient text, build the 232 px sidebar and 32 px gutter from the canvas. **In the same commit**, update `e2e/pdf-workflow.spec.ts:39`, which asserts on the old name. Keep the `.dashboard-view` class — `e2e/form-management.spec.ts:55` selects on it.
>
> **Phase 3 — the product screens**, against their artboards: `FormsManagementView.vue` + `FormsList.vue` (Forms), `PDFEditor.vue` + `FormFieldsOverlay.vue` + `FormFieldItem.vue` + `FieldPropertiesPanel.vue` (Field editor), `ResponsesView.vue` (Responses — 56 px rows, mono numbers), `PublicFormView.vue` + `PublicFormFieldItem.vue` + `PublicFormConfirmationView.vue` (Public form, desktop and phone, 48 px hit targets). Style the fields, not their positions: leave every `:style` binding that computes a coordinate alone, and do not touch `DEFAULT_SCALE`. Keep `.text-input`, `.public-field-item` and `.pdf-viewer-container` — the E2E suite selects on them.
>
> **Phase 4 — `MembersView.vue`** against the **Members & roles** artboard, deleting its hand-written CSS. Keep every `data-testid` in it; `e2e/team.spec.ts` depends on `members-table`, `invite-form`, `invitation-link` and `members-error`.
>
> **Phase 5 — sweep.** `grep -rE 'slate-|indigo-|gray-[0-9]|blue-[0-9]|bg-gradient|backdrop-blur' frontend/src` must come back empty. Then fix `frontend/src/components/pdf/PageThumbnails.spec.ts:115`, which asserts `ring-blue-600`, to assert the new selected-state class.
>
> **Verify:**
>
> ```
> npm run test:frontend
> npm run test:backend
> npm run test:integration
> npm run test:e2e
> npm run build --workspace=frontend
> ```
>
> Then run the app (`docker-compose up -d && npm run dev`) and check by hand, because no suite covers any of it: zero CSP violations in the console on dashboard / editor / responses / members / public form; the fonts are actually the design fonts and not a fallback; and **a field placed in the editor lands in the same place in the embedded AcroForm as it did before this change** — open a real PDF, place a field, submit, download.
>
> **On the way out:**
> - Run the `sot-sync` skill. `docs/sot/05-frontend-patterns.md` §8 is titled `[NOT IMPLEMENTED]` and says *"none of it is built"* — rewrite it to describe what now exists and where the tokens live, keeping the canvas URL. Mark step 6 done in `docs/sot/10-saas-roadmap.md#build-order` and update the paragraph under it that says step 6 is next.
> - In `docs/BACKLOG.md`: remove the P2 *Adopt the design system* row and the P3 *The members screen was built without the design* row. File anything you found and did not fix, with a priority and a why.
> - Set this file to `**Status:** done` and add an Outcome section.
> - Run the `ship-checklist` skill before opening the PR.
