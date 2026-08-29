# 0010 — Member invitations, and roles that are actually enforced

**Status:** done
**Priority:** P2 (see [`docs/BACKLOG.md`](../docs/BACKLOG.md)) — step 5 of the [build order](../docs/sot/10-saas-roadmap.md#build-order)
**Branch:** `feature/0010-member-invitations-and-role-enforcement`
**Related:** [`10-saas-roadmap`](../docs/sot/10-saas-roadmap.md) · [`03-domain-model`](../docs/sot/03-domain-model.md) · [`04-backend-patterns`](../docs/sot/04-backend-patterns.md) (§9) · [`07-security-and-privacy`](../docs/sot/07-security-and-privacy.md) · [`06-api-reference`](../docs/sot/06-api-reference.md)

## Context

[`features/0009`](0009-organizations-own-resources.md) built `Organization` and `Membership`, and every organization has exactly one member. Step 5 of the build order is the feature that makes that structure mean something: a way to add a second.

**This spec deliberately covers two backlog rows** — *Member invitations* and *Enforce `Membership.role`* — because they fail the unit-of-undo test in [`features/README.md`](README.md). Role enforcement alone is a no-op: every organization has one owner, so there is nothing to deny. Invitations alone are a hole: `Membership.role` is stored and never read ([07-security](../docs/sot/07-security-and-privacy.md)), so the first person invited into an organization can delete it, and with it every form and every response ever collected. Neither could be reverted without the other becoming wrong. The backlog row for roles already says this: *"do it with them or before."*

## Why the obvious approach is wrong

**1. The obvious invitation flow sends an email, and this repository cannot send email.**

There is no mail provider, no dependency, no configuration and no queue — check `backend/package.json` and [08-operations](../docs/sot/08-operations.md) rather than taking this on trust. Adding one is not a detail: it means an account somewhere, deliverability, bounce handling, and a retry path that really wants the job queue at build-order step 8. **Do not add an email provider inside this feature.**

The design that fits what exists: the invitation produces a **link the inviter copies and delivers themselves** — Slack, WhatsApp, whatever they already use. That is the same idiom as the `shareId` public form link this product is built around, so it needs no new concept.

The consequence has to be designed for, not discovered: a copyable link is a **bearer capability**, the same class as the signed PDF URL in [`features/0006`](0006-signed-expiring-urls-for-uploaded-pdfs.md). Whoever holds it can use it. So it must be unguessable, expire, be single-use, and be revocable before it is accepted.

**2. Do not make the invitation token a JWT.**

`jsonwebtoken` is already a dependency, and signing `{organizationId, email, role}` looks like the cheap answer. It is the exact mistake [`features/0008`](0008-session-hardening.md) removed: **a JWT cannot be revoked**. An invitation that cannot be cancelled before it is accepted is not an invitation, it is a permanent key handed to an address someone may have typed wrong.

Copy the shape `RefreshToken` already uses: a random token, stored as a SHA-256, with `expiresAt` and a nullable `revokedAt` / `acceptedAt`. `backend/src/services/refresh-token.ts` is the reference — including *why* a fast hash is correct for a high-entropy random token and wrong for a password.

**3. An invitation bound to an email address must refuse a different one, loudly.**

Bind the invitation to the email it was issued for. Then handle the case that decides whether this is safe: someone is logged in as `b@example.com` and opens a link issued to `a@example.com`. **Refuse it.** Do not silently add the logged-in user — a forwarded link would quietly put the wrong person inside a customer's organization, and nobody would ever see it happen.

There are two acceptance paths and both need deciding in writing: the invited address already has an account (accept while logged in as it), and it does not (register through the invitation). Do not leave the second undefined and discover it in the UI.

**4. Enforcing roles creates the last-owner problem, and it is a permanent lockout.**

Once `owner` is required to invite, remove members, change roles and delete the organization, an organization with **zero owners** is one nobody can administer, bill or delete — and no support tooling exists to repair it. It is reachable in three ways: the last owner demotes themselves, the last owner removes themselves, or the last owner's account is deleted (which cascades their membership away — the row already filed in [`docs/BACKLOG.md`](../docs/BACKLOG.md)).

**An organization must always have at least one owner.** Enforce it on demote and on remove, in the same place, and say what a caller gets when they try. This spec closes the first two; the third depends on account deletion (S8) and stays filed.

**5. `404` and `403` mean different things here, and getting it backwards leaks or confuses.**

[04-backend-patterns §9](../docs/sot/04-backend-patterns.md) requires `404` for a resource in another organization, because `403` confirms it exists. Role enforcement introduces a second, different rejection: the caller **is** a member and simply lacks the role. They already know the resource exists, so hiding it tells them nothing and only makes the product feel broken.

- Not a member of the organization → **`404`**, unchanged.
- A member without the required role → **`403`**, with a message naming what is required.

Two rejections, two codes, both tested. This mirrors the `402` / `403` split the roadmap specifies for plan limits versus permissions.

**6. The accept endpoint is an unauthenticated token-guessing surface.**

It takes a token and grants access to a customer's data. It needs a named per-IP limiter like every other public write path (§7 of [04-backend-patterns](../docs/sot/04-backend-patterns.md)), and a failure must not distinguish *unknown* from *expired* from *revoked* — the same rule `POST /api/auth/refresh` already follows.

## Goal

1. An `owner` can create an invitation for an email address and a role, and receives a **link** containing a token that is not stored in plaintext anywhere.
2. Invitations expire (configurable, with a default in `backend/.env.example`), are **single-use**, and can be revoked before acceptance. A revoked, expired or already-accepted token is refused with the same response as an unknown one.
3. Accepting an invitation while logged in as a different email address **fails**, and a test asserts it.
4. A person without an account can accept: they register and join in one act, atomically. Either both happen or neither does.
5. Accepting creates exactly one `Membership` with the role the invitation named. Accepting twice does not create a second.
6. `Membership.role` is enforced: `owner` may invite, revoke invitations, change roles, remove members and delete the organization; `admin` may manage forms and invite `member`s; `member` may manage forms. Every rule is asserted by a test.
7. **An organization always has at least one `owner`.** Demoting or removing the last one fails with a message that says why.
8. Not a member → `404`. Member without the role → `403`. Both asserted, on the same endpoint where possible.
9. `POST /api/organizations/invitations/accept` carries a named rate limiter.
10. A minimal members UI: list members with their roles, invite by email and role, **copy the link**, revoke a pending invitation, change a role, remove a member. Nothing else.
11. All four suites green: `npm run test:backend`, `npm run test:integration`, `npm run test:frontend`, `npm run test:e2e`, plus `npx tsc --noEmit` in `backend/` and `npm run build --workspace=frontend`.

## Out of scope

- **Any email provider.** Point 1. The link is copied by a human. File the email work as its own row rather than smuggling it in.
- **Organization switching.** Every user still belongs to exactly one organization, so `requireOrganizationId` in `backend/src/middleware/formOwnership.ts` stays correct. The moment a user can belong to two, that function is the single place that has to learn which is active — it says so already. Do not pre-build it.
- **Renaming an organization, or any other organization settings.** Separate.
- **Account deletion** (S8), and therefore the last-owner-deleted case in point 4.
- **Plans, entitlements, seat limits** — step 6. Do not add a seat check now, even though invitations are where one would eventually go.
- **Audit log of who invited or removed whom.** Wants structured logging (S9) first. File it.

## Execution prompt

> Read [04-backend-patterns §9](../docs/sot/04-backend-patterns.md) and `backend/src/services/refresh-token.ts` before writing anything — the second is the shape this feature's token should copy, and the first is the authorization rule it must not break.
>
> **Step 1 — read before writing.** `backend/prisma/schema.prisma` (`Organization`, `Membership`, `MembershipRole`, and `RefreshToken` as the pattern). `backend/src/middleware/formOwnership.ts` in full — `callerCanReachForm`, `verifyFormOwnership` and `requireOrganizationId`, 80 lines. `backend/src/services/refresh-token.ts` (hashing, rotation, the same-401-for-every-failure rule). `backend/src/routes/auth.ts`, especially the transactional registration — the register-through-invitation path is a variant of it. `backend/src/middleware/rateLimit.ts`. Confirm for yourself that no mail dependency exists.
>
> **Step 2 — schema, via the `prisma-schema-migration` skill.** An `Invitation` model: organization, email, role, `tokenHash` (unique), `expiresAt`, `revokedAt?`, `acceptedAt?`, `invitedByUserId?`, timestamps. State every `onDelete` in the PR description with its blast radius, per the cascade map. `Invitation → Organization` is almost certainly `Cascade` (an invitation to a deleted organization is meaningless) but say so rather than defaulting. Index what the accept path and the pending-list query filter on.
>
> **Step 3 — the authorization primitive, in one place.** Add a role check next to `verifyFormOwnership` in `middleware/formOwnership.ts` (or a sibling module if that file stops being about forms — decide and say which). It must express point 5: not a member → `404`; member with the wrong role → `403`. One function, called explicitly inside handlers like `verifyFormOwnership` is, never a blanket middleware.
>
> **Step 4 — the failing tests, before the endpoints.** In `backend/tests/integration/`, because every claim is a database claim. Write these first and **watch them fail**: a `member` cannot invite; a `member` cannot remove anyone; the last `owner` cannot demote or remove themselves; a non-member gets `404` and a member with the wrong role gets `403` on the same endpoint; an invitation accepted twice creates one membership. `backend/tests/integration/tenancy.spec.ts` is the reference for style.
>
> **Step 5 — endpoints**, following `backend-endpoint-pattern`. Suggested shape, adjust with reasons: `GET/POST /api/organizations/members`, `PATCH/DELETE /api/organizations/members/:userId`, `GET/POST /api/organizations/invitations`, `DELETE /api/organizations/invitations/:id`, `POST /api/organizations/invitations/accept`. Zod at the edge, `AppError` plus `next(error)`, and a **transaction** wherever acceptance creates a user and a membership together. Add the limiter from goal 9.
>
> **Step 6 — the two acceptance paths.** Logged in as the invited address: create the membership, mark the invitation accepted. No account: register and join atomically, reusing the registration logic in `routes/auth.ts` — but **do not create a personal organization for them**, or they end up in two and break the assumption in `requireOrganizationId`. That is the trap in this step; call it out in the PR description whichever way you resolve it.
>
> **Step 7 — frontend**, following `frontend-state-pattern`. One members view: the list with roles, an invite form, a copy-link control, revoke, change role, remove. Use `useAsyncAction` and one service per resource. **The copy-link step needs to be obvious** — the user has just created an invitation nobody will ever be told about unless they send it, and a UI that hides the link produces invitations that silently go nowhere.
>
> **Step 8 — verify.** `npm run test:backend`, `npm run test:integration`, `npm run test:frontend`, `npm run test:e2e`, `npx tsc --noEmit` in `backend/`, `npm run build --workspace=frontend`. Remember the integration suite runs against `vuepdf_test` and nothing migrates it locally — `migrate deploy` against it after Step 2. Then by hand with two accounts: invite, copy the link, accept in a second browser profile, confirm the second user sees the first's forms; then try accepting the same link again, an expired one, and a revoked one, and confirm all three give the same refusal. Confirm a `member` cannot invite and the last `owner` cannot demote themselves.
>
> **Step 9 — an E2E test that crosses the boundary.** One Playwright test: an owner invites, the link is accepted by a second account, and that account then loads a form created by the first. Nothing else in the suite proves two people can share an organization, and that is the whole feature.
>
> **Step 10 — document.** Run `sot-sync`. [03-domain-model](../docs/sot/03-domain-model.md): the `Invitation` entity and its cascade row. [07-security-and-privacy](../docs/sot/07-security-and-privacy.md): roles are now **enforced** — correct the row that says they are not — plus the invitation link as a bearer capability with its expiry and revocation, in the style [`0006`](0006-signed-expiring-urls-for-uploaded-pdfs.md) used for the PDF URL, and the `404` / `403` split. [04-backend-patterns](../docs/sot/04-backend-patterns.md): extend §9 with the role check, since §9 currently describes tenancy only. [06-api-reference](../docs/sot/06-api-reference.md) after re-reading the routes (`api-contract-guard`). [08-operations](../docs/sot/08-operations.md): the invitation TTL and limiter variables. [09-quality-and-testing](../docs/sot/09-quality-and-testing.md): spec counts. Remove the *Member invitations* and *Enforce `Membership.role`* rows from [`docs/BACKLOG.md`](../docs/BACKLOG.md); the *organization can outlive its last member* row **stays**, narrowed to the account-deletion case this feature does not close. File the email provider and the audit log. Close step 5 in the [build order](../docs/sot/10-saas-roadmap.md#build-order). Set this file to `**Status:** done` and add an `## Outcome`.


## Outcome

**Done.** All eleven acceptance criteria hold. Verified on Node 22.22.0: backend 12 specs / 115 tests, integration **7 / 72**, frontend **30 / 250**, E2E **8 / 41**, plus `tsc --noEmit` on the backend and the frontend build.

### The no-email constraint held, and shaped everything

Confirmed rather than assumed: no mail provider, dependency or configuration exists. So an invitation returns a **link, exactly once**, and the inviter delivers it. That makes it a bearer capability, and the controls follow from that rather than from a checklist — unguessable, stored only as a SHA-256, expiring (72 h), single-use, revocable, bound to one address, and rate limited with one identical answer for unknown / expired / revoked / spent.

The consequence lands in the UI too: the link panel is the loudest thing on the members page, because losing it means the invitation exists and nobody can ever accept it. `lastCreatedInvitation` lives in the store rather than a component for the same reason.

### Combining the two backlog rows was right

Both negative checks confirm they are one unit of undo:

- Disabling the role check fails exactly the three "may not" tests — a `member` could invite, remove members and change roles. That is what shipping invitations alone would have meant.
- Disabling the last-owner guard fails exactly the two last-owner tests.

Neither touched anything else, which is what makes them useful rather than noisy.

### Things the code decided

- **`admin` may invite only `member`s.** Handing out `admin` or `owner` is how an organization changes hands, so it is an owner's decision.
- **An existing account is asked to sign in rather than joined on the link alone.** Otherwise holding the link would be enough to attach access to somebody else's account.
- **Accepting as a new user does not also create a personal organization** — the trap the spec named. `requireMembership` picks the oldest membership, so a person in two organizations would land in one arbitrarily. Asserted by `does not also give them a personal organization`.
- **Removing a member deletes only the membership.** Their account survives and the forms they created stay with the organization, because `Form.createdByUserId` is provenance ([`0009`](0009-organizations-own-resources.md)).

### Verified in a real browser

`e2e/team.spec.ts` is the only test in the suite that proves the product is more than single-player: an owner invites, a **second browser context** with no session opens the link, sets a password, joins, and then sees the team. Plus the link refusing to be spent twice, and the only owner being refused when they try to demote themselves.

### An honest note on the first test run

Eleven of the fourteen role tests failed before the endpoints existed, as intended — but three passed vacuously, because a missing route also answers `404`. They only became meaningful once the routes existed. That is exactly the ambiguity the `404` / `403` split is there to manage, and it is worth knowing that "asserts 404" is a weak assertion against code that does not exist yet.

### Deferred and filed

In [`docs/BACKLOG.md`](../docs/BACKLOG.md): **email delivery** (wants the job queue at step 8 for retries and a delivery record), and **no audit of who invited, removed or promoted whom** — for a B2B buyer that is a due-diligence question, and after an incident it is the only way to answer "who let them in". It wants structured logging (S9) first.

The *organization can outlive its last member* row **stays**, narrowed: this feature closed both paths reachable from the application, and what remains is user deletion cascading a membership away — which only account deletion (S8) can trigger.
