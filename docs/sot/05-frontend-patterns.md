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

## 8. Visual design

**Built** ([`features/0011`](../../features/0011-adopt-the-design-system.md)). The design that existed only as a canvas is now the running app: the stock Tailwind palette, `system-ui` type, the gradients and the glass are gone, and so is the "PDF Editor Pro" name, which appeared nowhere in the design or the product.

**Source of truth for the design:** the *VuePDF Forms* canvas at <https://claude.ai/code/artifact/be7f6015-4f99-46aa-9a61-8c051d4637b4>. It is **not in this repository** — it is a published Claude Design canvas. It holds 11 artboards on four pages: **Landing** (`Landing`, `LandingMobile`), **Product** (`Main`, `Editor`, `Responses`, `PublicForm`, `PublicFormMobile`), **SaaS layer** (`Plans`, `Members`, `LimitReached`), and **System**.

Reading it is not obvious and is worth recording, because the first attempt fails: the artboards are lazily offloaded, so the published page looks like a 2.6 MB runtime shell. The artboard sources are in it, as JSON string values keyed by `<Name>.dc.html`. Read the artifact with the Artifact tool, which saves the page to a local file, then slice each value out and `json.loads` it — what comes back is the original artboard as plain inline-styled HTML.

### Where the values live now

| | |
|---|---|
| Palette, type scale, radii, control heights, shadows | `frontend/tailwind.config.cjs` |
| PrimeVue component tokens | `frontend/src/theme.ts` (`VuePDFPreset`), applied in `main.ts` |
| `.num`, `.col-label`, `.pill` and the base layer | `frontend/src/style.css` |

`tailwind.config.cjs` **replaces** `colors`, `fontFamily` and `fontSize` rather than extending them. That is deliberate — leaving the stock ramps reachable is how a screen ends up half in `slate-500` and half in `muted` — and it has a consequence worth knowing before editing any component: **an undefined utility is dropped by Tailwind silently.** There is no build error and no warning. `npm run build` passing says nothing about whether a class name still resolves; `grep`, or a check of the generated CSS, is the only signal.

Colours are named by role, not by hue: `ink` / `muted` / `faint` / `disabled` for text, `accent` (+`.pressed`, `.soft`), `published`, `limit`, `danger`, `neutral` for status, `surface` (+`.subtle`, `.sunken`, `.track`), `line` (+`.strong`, `.soft`, `.paper`), and `field` (`.idle`, `.underline`, `.guide`). Type is named by role too — `title`, `section`, `row`, `body`, `meta`, `micro`, `label`, `mono` — so a screen cannot invent a fourteenth size.

### The three rules, and where each is enforced

- **Accent is rationed** — one primary action per screen, the active nav item, the selected field. It is the reason `FormFieldItem.vue` no longer gives each field type its own hue: five saturated colours over a document leave nothing for the selection to say with.
- **Numbers are always mono.** The `.num` class in `style.css`, plus `frontend/src/utils/formatDate.ts`, which holds the three date shapes the design uses (`relativeTime`, `submittedAt`, `calendarDate`).
- **A field looks different in the two places it appears.** `FormFieldItem.vue` is a bordered rectangle with a type tag; `PublicFormFieldItem.vue` drops to a single underline. They share no styling, on purpose.

### Fonts are self-hosted, and have to be

Instrument Sans and JetBrains Mono come from `@fontsource/*` and are bundled as same-origin assets, imported at the top of `style.css`. A `<link>` to `fonts.googleapis.com` is **blocked twice** by the SPA's own CSP — `style-src 'self' 'unsafe-inline'` rejects the stylesheet and `font-src 'self' data:` rejects the font files (`frontend/vite.config.ts`, and [07-security-and-privacy](./07-security-and-privacy.md)). It fails silently into the fallback font. Adopting the design required no CSP change at all, and should not be allowed to.

### The shape of the app

`/dashboard` is the **list of forms** — the canvas's `Main` artboard — not the editor. It used to be the editor, so signing in dropped you into an empty workspace instead of into your work.

| Route | Screen | Chrome |
|---|---|---|
| `/dashboard`, `/dashboard/forms` | `FormsManagementView` | `AppShell` sidebar |
| `/dashboard/responses` | `ResponsesIndexView` | `AppShell` sidebar |
| `/dashboard/team` | `MembersView` | `AppShell` sidebar |
| `/dashboard/settings` | `SettingsView` — **General** and **API keys** tabs, the tab in `?tab=` | `AppShell` sidebar |
| `/dashboard/forms/:id/responses` | `ResponsesView` | `AppShell` sidebar |
| `/dashboard/editor` | `EditorView` | none — its own top bar and left rail |

`AppShell.vue` is the 232px sidebar and is where the four nav destinations live. The **editor has no app sidebar**, as the `Editor` artboard draws it: one document, and the chrome gets out of the way. Its left rail is **one fixed rail** — the field types, then the page thumbnails, as the `Editor` artboard draws it (`components/editor/EditorRail.vue`). It replaced a tabbed rail (Documents / Forms / Pages), and it has no disclosure of its own; it collapses into a drawer only below `lg`, where it cannot sit beside the document.

The floating toolbar keeps the field types too. Both read and write the same `fieldTypeToAdd` in the store, so arming a type in one lights it up in the other and cancelling in either cancels once — which is what makes two entry points defensible rather than two sources of truth.

The editor's menu button opens the **application's** navigation, not the rail: from inside a form there was otherwise no way to reach anything else without going through the back link. Both it and the dashboard sidebar read `composables/useAppNav.ts`, because a navigation that disagrees with itself depending on where it was opened is worse than one that is merely incomplete.

### What the canvas has that the app does not

Nobody should read the canvas as a description of the product. What is drawn and not built:

- **The organization switcher** in the sidebar. No endpoint returns an organization's name — `frontend/src/services/organization.ts` can list members and invitations and nothing else — so there is nothing to render.
- **The prices — and only the prices.** The purchase actions are built as of [`features/0013`](../../features/0013-stripe-subscriptions.md): the `Plans` artboard's *Change plan* control is on `SettingsView.vue`, *Manage billing* appears beside it once a subscription exists, and the `LimitReached` artboard's *Upgrade to Pro* is on `LimitReachedDialog.vue`. **No price is rendered anywhere**, and that is now a permanent rule rather than a gap: the amount lives in Stripe, the application stores only a price id in configuration, and the customer sees the real figure on Stripe's own Checkout page — which is the only place it is true. A constant here would quote a number [`docs/BACKLOG.md`](../BACKLOG.md) records that nobody has agreed to. `LimitReachedDialog.spec.ts` asserts that no currency figure appears in the dialog at all.
- **The mark is now conditional.** `PublicFormView.vue` renders "Made with VuePDF" only when the server says so ([`features/0014`](../../features/0014-close-the-subscription-surface.md)). Nothing in the SPA computes it: the client is deliberately given no plan to compute it from, because the endpoint is anonymous. Note for local work — `DEV_PLAN_KEY=dev` grants the entitlement, so the mark disappears in development. That is the override working.
- **The saved card, the billing history and *Update card*** on the `Plans` artboard. Deliberately not built: they live in Stripe's hosted Customer Portal, which *Manage billing* opens. Building them here would mean handling card data on this origin, which is a security decision and not a UI one ([07-security-and-privacy](./07-security-and-privacy.md)).
- **Team is buyable, and there is still no plan picker.** [`features/0015`](../../features/0015-team-plan-and-purchased-seats.md) put *Upgrade to Pro* and *Upgrade to Team* on `SettingsView.vue` — but only for a **first** purchase, and only for an owner. Changing an existing subscription is Stripe's portal: it needs proration previews, confirmation and 3-D Secure, all of which already exist there and none of which should be rebuilt here.
- **Seats are bought, so the SPA has no seat control.** There is no quantity field anywhere in this client, and there must not be: the customer sets the number in Stripe's portal, `Subscription.quantity` is only ever read back off the webhook, and this application never sends Stripe a quantity ([04-backend-patterns §10](./04-backend-patterns.md)). What the SPA does instead: the *Members* meter on Settings shows seats used against the **effective** limit the server resolved (`plan.seats`, which on Team is what was bought, not the catalogue floor), the Settings copy says where seats are bought and that lowering the number removes nobody, and a `402` from inviting opens `LimitReachedDialog` in its `limit="seats"` mode — the same "a limit is not a failure" treatment a publish limit gets, with *Add seats* opening the portal rather than an *Upgrade* that would sell a second subscription. `MembersView.vue` branches on `ApiError.status === 402`, never on the message.
- **Purchase controls are owner-only, matching the API.** `POST /api/billing/*` answers `403` to anyone but an owner, so the UI reads the caller's role — through `organizationStore.currentRole`, the same way `MembersView.vue` does, never a second source — and shows a member the plan and the usage with no way to spend money. A button guaranteed to fail tells someone the product is broken when it is enforcing a rule.
- **Returning from Checkout asserts nothing.** `?checkout=complete` on the Settings screen says activation is in progress and re-reads entitlements a few times; it never writes and never claims success on its own, because the redirect is a URL anyone can visit and a customer who closes the tab never visits it at all. The plan on screen is always the one the server reported.
- **The `webhooks` tab.** The endpoints exist (`POST`/`GET`/`DELETE /api/organizations/webhooks`) and no screen reaches them, so an endpoint is still configured through the API alone. Its delivery log needs an endpoint of its own: the only one that exists, `GET /api/v1/webhooks/deliveries`, is authenticated by an API key, and a customer cannot be asked to mint a key in order to see whether their webhook works. Filed in [`docs/BACKLOG.md`](../BACKLOG.md).
- **The role semantics** on the `Members` artboard, which say a member sees "only the forms they created". `backend/src/routes/forms.ts` scopes forms to the organization and checks membership, not role. `MembersView.vue` therefore prints what the route guards actually enforce. Filed in [`docs/BACKLOG.md`](../BACKLOG.md).
- **Responses and Settings as screens.** Both are in the navigation, because the navigation is the shape of the product and a hole in it is harder to read than an admitted gap. Both render `NotBuiltYet.vue`, which names what is missing and where it is tracked. **Neither renders an empty table or an invented number** — an empty table says "you have no data", which is a different and false claim. Settings does show the signed-in account, because that part is real.

### API keys

**Built** ([`features/0021`](../../features/0021-api-keys-screen.md)) — the `API keys` tab the Settings artboard draws, over the endpoints [`features/0019`](../../features/0019-api-keys-and-read-only-public-api.md) shipped without one.

| | |
|---|---|
| `services/apiKeys.ts` | `list`, `create`, `revoke` over `/organizations/api-keys` — the session API, never `/api/v1`, because a credential that could mint credentials would turn one leaked key into permanent access |
| `stores/apiKeys.store.ts` | The list and `lastCreatedKey`. `persist: false`, deliberately |
| `components/settings/ApiKeysPanel.vue` | The tab itself |

Four things about it are load-bearing:

- **The secret lives in the store, not in the component.** `POST` returns it once and the server keeps only `sha256(secret)`, so a value lost to an unmount is a key that can never be used — only revoked. Same decision, same reason, as `lastCreatedInvitation` in `organization.store.ts`, down to the clipboard fallback: a rejected `navigator.clipboard` leaves selectable text rather than a dead button.
- **`plan.hasApiAccess` chooses what is drawn; the server chooses what is allowed.** The flag hides the create form on a plan that would refuse it, and the `402` handler stays anyway — the plan can change between the page loading and the button being pressed. The panel branches on `ApiError.status`, never on a message.
- **`403` and `402` are different screens.** An owner or admin without the plan sees the upgrade state; a plain member sees *ask an owner or admin*. Collapsing them sends the customer to the wrong place, and the panel does not even request a list the server would refuse.
- **A revoked key keeps its row.** The server revokes rather than deletes, and the row plus its timestamp are the only record of when access stopped. `lastUsedAt` is rendered as relative time or *never used* and nothing finer, because it is written at most once a minute and its failures are swallowed.

### Plan and usage

**Built** ([`features/0012`](../../features/0012-plan-catalogue-and-entitlements.md)). The sidebar plan card, the **Plan & usage** section on Settings, and the `LimitReached` screen are real, driven by `GET /api/organizations/entitlements`.

| | |
|---|---|
| `stores/plan.store.ts` | The plan and the usage. A store rather than a composable: the sidebar shows it on every signed-in screen, so it must outlive any one component |
| `services/plan.ts` | One service for the endpoint. `null` in a limit means **unlimited**, matching the backend |
| `components/plan/UsageMeter.vue` | One "used / limit" row with a bar. Shared by the card, the Settings section and the dialog |
| `components/plan/PlanCard.vue` | The sidebar card. Renders **nothing** until the plan has loaded |
| `components/plan/LimitReachedDialog.vue` | What a `402` from publishing looks like |

Four things about it are load-bearing:

- **`AppShell.vue` is the only fetcher.** It wraps every signed-in screen, so the plan is loaded once there and every other screen reads the store. A failure is swallowed and the card simply does not draw — an error toast about the plan, on a screen someone opened to do something else, is noise they cannot act on.
- **Nothing renders a placeholder number.** The card draws only when `plan` is set, and `responsesFraction` is `null` rather than `0` when the limit is unlimited. This is the same rule `NotBuiltYet.vue` exists for, and it matters more here: an invented usage figure is the number someone checks before deciding whether they can publish.
- **A `402` is caught by status, never by message.** `useAsyncAction` rethrows, so `FormsManagementView.vue` catches `ApiError` and branches on `error.status === 402` into the `LimitReached` dialog. Parsing the sentence would couple the screen to backend copy. The other two publish call sites — `FormsList.vue` and `FormSavePanel.vue` (the editor) — do not have the dialog; they show the server's own sentence as a **warning**, not an error, because nothing failed and nothing was lost.
- **Publishing and unpublishing call `planStore.refresh()`.** Both move a number the sidebar shows, and a card showing yesterday's usage is worse than no card. `refresh` skips the loading flag and swallows failures, because it runs after an action that already succeeded.

### Editor edits are held, then saved explicitly

The editor's tools modify the PDF in the browser with pdf-lib and write the result to `documentStore.activeDocument.arrayBuffer`. Nothing sent it anywhere, so **every text and image edit was lost on reload** while the UI showed it as applied.

They are now held deliberately, not accidentally. `documentStore.hasUnsavedEdits` records that there is something to commit; `useFormManagement().persistEditedDocument()` commits it, from **`Save all` in the editor panel and nowhere else**. The first attempt at this uploaded on every placement, which is worse than it sounds: it makes a stray click a fact on the server and leaves someone who is experimenting with no way back.

**Field geometry works the same way**, and did not used to. Placing, moving or resizing a field wrote to the server on mouseup (`formFieldsStore.saveField`), so one screen had two save models and the user could not know what was stored without remembering which tool they had used. `formFieldsStore.hasUnsavedChanges` is the field-side flag; `Save all` clears it through `saveAllFields`. The editor's warning and its button read both flags as one.

### One thing ends an editor session

`useFormManagement().resetEditorSession()` closes the document, clears the fields, and forgets the form — the three together. They live in stores that outlive the route and each other, and ending only one of them has been a bug every time: closing the document on its own left the fields behind, so the next PDF opened with the previous form's fields drawn on it, and saving would have written them into the new form. Everything that abandons a document goes through it: the editor's close button, discarding on the way out, `New form`, and opening an existing form.

Because the edits are held, three things have to exist together and are easy to drop one of:

- `Save all` saves the fields **first**, then the document bytes. The field save embeds the AcroForm into the PDF on the server; uploading the browser's copy afterwards is the only order that does not overwrite it.
- The editor says the edits are unsaved, next to the button that saves them.
- `EditorView.vue` guards both exits — `beforeunload` for closing the tab, `onBeforeRouteLeave` for **every** in-app navigation, whichever control started it.

The in-app guard is `UnsavedChangesDialog.vue`, in the product's own styling rather than a `window.confirm`. That matters less than what it offers: the browser dialog had two answers, *lose the work* or *stay*, and the one people want is **Save and leave**, which is the accent action.

It also covers a second way to lose work that is not an edit at all. A PDF that has been opened but never given a field has **no form row**, so closing the editor discarded the document itself. `saveDocumentToDatabase()` stores it with no fields — the document is the work — and `createFormForCurrentDocument` now uploads the open document's bytes whenever a form is created. Without that, `autoInitializeForm` produced a form with a null `pdfUrl`: listed on the dashboard, and failing to open with *"This form has no PDF"*.

`persistEditedDocument` uploads through the existing `POST /api/upload` and repoints the form with `PATCH /api/forms/:id`; no new endpoint, because those two already do this. It does not re-save the extracted fields — the bytes already carry the embedded AcroForm, so that would duplicate every field — and it does not delete the file it replaced ([`docs/BACKLOG.md`](../BACKLOG.md)).

### Page rotation

Field positions are stored **once**, in canvas pixels at the base scale with the page upright, because that is what the backend embeds against (`pdf-processor.ts`). Rotating the view must never change what is stored — only where the field is drawn.

**Four** faults lived here, and the first fix only removed two of them:

1. pdf.js already renders a rotated page (`getViewport({ scale, rotation })`) and `PDFViewer.vue` **also** applied a CSS `rotate()` to the wrapper, so 90° displayed as 180°.
2. Nothing mapped field geometry through the rotation at all.
3. Removing that CSS binding broke the overlay in a new way. The canvas size reached it as `:canvas-width="canvasRef?.width"`, and **`canvas.width` is a plain DOM property — assigning it tells Vue nothing.** The `:style` binding on `rotation` had been forcing a re-render on every turn and hiding that. `PDFViewer.vue` now keeps a reactive `canvasSize`, and anything needing the canvas size reads it.
4. `canvas { max-width: 100%; height: auto }` means the canvas is usually *drawn* smaller than the pixels it holds — and always is once the page is turned a quarter, because the rotated canvas is wider than the column. `canvasSize.displayScale` carries that ratio, measured with a `ResizeObserver`.

**The overlay applies that ratio once, to itself.** It is sized in the canvas's own pixels and given `transform: scale(displayScale)` with a top-left origin, so everything inside it is laid out in canvas pixels and nothing below needs to know the display ratio exists. The first attempt multiplied it into each field's geometry instead, which is an agreement every call site has to remember — and on a narrow window the fields drifted off the page. A click has to be divided back out (`getBoundingClientRect` reports the *visual* box), and that division lives in one place, next to the transform.

The lesson worth keeping: **a DOM property is not reactive state.** Two of these four were the same mistake, one of them introduced by fixing the other.

`utils/pdfCoordinates.ts` now holds three functions with tests, including the round trip that is the property that matters:

| | |
|---|---|
| `rotateFieldRect` | stored rect → where to draw it |
| `unrotateFieldPoint` | a click on the rotated page → what to store |
| `unrotatedPageSize` | the page's upright size, worked back out of the canvas pdf.js produced |

They are inverses, and a disagreement between them saves fields in the wrong place silently. Dragging and resizing are refused while the page is rotated rather than applying an unmapped screen delta — see [`docs/BACKLOG.md`](../BACKLOG.md).

The **landing page** is designed and unbuilt, and is a [parallel track](./10-saas-roadmap.md#parallel-track-the-landing-page) rather than a step in the chain.

## 9. What the frontend is missing

1. **A server-state library** (TanStack Query for Vue) for reads. Today every store hand-manages `loading` / `error` / caching, and there is no request deduplication or background refetch. `useAsyncAction` stays for writes; reads are where the manual approach is costing the most.
2. **A field-scale contract with the backend.** See section 4 — the highest-risk implicit coupling in the repo.
3. **Shared types generated from the backend Zod schemas**, so `CreateFieldData` cannot drift from the server's validator.
4. **i18n.** The UI is English except for a handful of Spanish placeholders (`"Escribe aquí..."`, `"Buscar en el documento..."`). That is drift, not a decision. Fix it with an i18n layer rather than string-by-string, because it will need one anyway.
5. **VueUse** for the hand-rolled `useDragAndDrop`, `useGridOverlay` and `useToolbarDrag`. Evaluate individually — some of these encode editor-specific behaviour that a generic helper will not cover.
6. **Error reporting from the browser.** When a B2B customer reports "the editor froze", there is currently no way to see what happened on their machine.
