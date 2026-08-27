---
name: api-contract-guard
description: Verify that an endpoint documented in docs/sot/06-api-reference.md exactly matches the real implementation in backend/src/routes/ and the real usage in frontend/src/services/. Use before documenting any endpoint, when reviewing a change that touches routes, and whenever frontend and backend appear to disagree.
---

# API contract guard

The archived `API_DOCUMENTATION.md` described three field endpoints — `GET .../fields`, `PUT .../fields/bulk` with upsert semantics, `DELETE .../fields/bulk` — that **never existed** in any version of the backend. It was written once from intent and never checked again. This skill exists so that cannot recur.

## The rule

**An endpoint is documented only after reading its route file. Never before, never from memory, never from the frontend's expectations.**

Sources of truth, in this order:

1. `backend/src/app.ts` — the real mount prefix. `formFieldsRouter` is mounted on `/api/forms`, not `/api/fields`, whatever its name suggests.
2. `backend/src/routes/*.ts` — the handler: its HTTP method, its path, the Zod schema that validates the body. The schema defines the request shape; what looks reasonable does not.
3. `frontend/src/services/*.ts` — how the real client calls it. If the frontend calls a different URL or a different shape than the backend implements, that is a **live bug**, not a documentation problem. Report it as one.

## Checklist per endpoint

- [ ] Method and path match the `router.<method>('<path>', …)` exactly, including the mount prefix from `app.ts`.
- [ ] The auth and ownership middleware is reflected accurately — `authenticate`, `verifyFormOwnership`, `verifyFieldOwnership`. Do not assume every route has auth, and do not assume none does. A public route must be documented as public, loudly.
- [ ] The body shape matches the Zod schema field by field, including which fields are optional and which have defaults.
- [ ] Documented status codes are the ones the handler actually returns, including those raised through `AppError` and the generic `errorHandler`.
- [ ] **Non-obvious side effects are documented.** A consumer needs to know that `GET /forms/:id` can write fields to the database, that `bulk` rewrites the PDF on disk, and that `GET /forms/public/:shareId` increments a counter.
- [ ] **Destructive semantics are called out with a warning**, not buried in a notes column. `bulk` currently destroys collected answers; that belongs in a blockquote, not a footnote.
- [ ] The frontend service really uses this shape.

## When you find a mismatch

1. **The code wins.** Never change the backend to match a document. The one exception is when the document recorded an explicit product requirement that was never implemented — then it is a backlog item, not a docs fix, and it goes in `docs/BACKLOG.md`.
2. Fix `docs/sot/06-api-reference.md` first; it is canonical.
3. If the mismatch is between frontend and backend rather than between code and docs, treat it as a bug: decide which side is correct, fix the other, and do **not** document both as if they coexist.
4. If the endpoint's real behaviour is dangerous, say so in the reference where a consumer will see it, and file it in `docs/BACKLOG.md` with a priority.
