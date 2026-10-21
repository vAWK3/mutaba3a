# MUT-373 — Co-owners: two people own one Business profile

Status: **PLAN (draft for design review, then eng review).** Nothing is built.
Ticket: MUT-373 (Story, epic MUT-181, Backlog). Phone half: MUT-374 (blocked by this).
Intake decisions (Basel, 2026-10-21): equal partners · Freelancer tier (no firm switch needed) · the operator adds co-owners during the pilot · the creator removes a co-owner, and a co-owner can leave; their records stay.

---

## 1. Neighborhood

| Ticket | Relation | What it means here |
|---|---|---|
| MUT-181 / 182 / 183 / 184 | parent + Done siblings | Owned profiles, the cap of 6, `/v1/me` `owned`, Manage profiles drawer. This ticket changes their "never shared" rule. |
| MUT-193 / 239 | siblings, Backlog | Archive/delete of an owned profile. Not built; a co-owned profile adds a question for MUT-239 (§9). |
| MUT-300 | relates, In Review (merged) | Added `Membership.role` (default OWNER) and `firmOwnersOf`. Firm enable would **demote** a co-owner today (§3.6). |
| MUT-305 / 306 | relates, Backlog (firm v3) | Roles and invites. They build on the same OWNER membership. `LAST_OWNER` is reserved for them in firm-books.md:99. |
| MUT-358 | relates, branch `feature/mut-358-billing-core` | Its `entitlement.ts` keys coverage on the single column owner. Comment only, no code here (§9). |
| MUT-333 / `purge-user` | neighbor | Purging the creator would delete a co-owned profile from under the co-owner (§3.9). |

There are no blockers. MUT-300 is merged on local main.

### Decision conflict that must be resolved, not only logged
ADR-099 "Alternatives considered" **rejected** "lifting MUT-182's 'owned is never shared' rule" because it would create *two kinds of shared organization*. This plan avoids that. A co-owned profile and a firm-enabled owned profile are **the same kind**: an owned organization whose members carry `Membership.role`. Co-owners are its OWNER members, and MUT-305/306 later add BOOKKEEPER/SUBMITTER members to that same organization. The ADR records this as a partial override of ADR-099's alternative, of ADR-037 + its MUT-182 amendment ("never granted to or provisioned into another user"), and of MUT-181 decision 4 ("no sharing").

---

## 2. The model (one rule)

```
ownsProfile(org, userId, role) =                   // corrected after outside voice OV1
     profileOwnerOf(org) === userId                 // the creator (or the personal owner)
  || (canCoOwn(org) && role === 'OWNER')            // a co-owner of an owned BUSINESS profile
canCoOwn(org) = ownerUserId != null && profileType === 'BUSINESS' && personalOwnerUserId == null
```

- **The creator** stays `Organization.ownerUserId`. The column does not change, so no migration and no local snapshot bump are needed.
- **A co-owner** is a `Membership` with `role = OWNER` on an owned **BUSINESS** profile.
- **Why the `profileOwnerOf !== null` guard is load-bearing:** `role` defaults to OWNER on *every* membership (`schema.prisma:353`), including staff on operator and Malafat firms. Without the guard, every firm member would become an "owner" and gain the portal's income/client gates, which reverses ADR-066.
- **Never co-owned:** the built-in personal profile (`PERSONAL_PROFILE`) and owned PERSONAL-type profiles (`NOT_BUSINESS`).
- **Cap:** a co-owned profile counts toward its **creator's** 6 only. `countOwnedBy` is unchanged.
- **The creator can't leave** in v1. Ownership transfer is out of scope. So a profile always has ≥1 owner, and `LAST_OWNER` is never reachable through these routes (see D3).

`ownsProfile` lives in `server/src/personal-profile.ts` next to `profileOwnerOf`. **Every** owner check calls it; none of them compares columns inline.

---

## 3. Server changes (by file)

### 3.1 The rule
- `personal-profile.ts`: add `ownsProfile`, `isCreator(org, userId)` and `canCoOwn(org)` (owned && BUSINESS && !personalOwnerUserId).
- `errors.ts`: new CONFLICT reasons, with **no new error code** (house rule at `errors.ts:11-12`): `NOT_BUSINESS` (reused), `CREATOR_CANNOT_LEAVE`, `NOT_CREATOR`, `CO_OWNED` (refuses a type change to PERSONAL while co-owned), `OWNER_LIMIT`. Update the `ownedProfileConflict` doc comment (`:81-89`) and `schemas.ts:46` ("never … shared").

### 3.2 Granting a co-owner (operator only, pilot path)
- `routes/admin-users.ts:292-324` grant: the body gains optional `role: 'OWNER'`.
  - On an owned profile: allowed **only** with an explicit `role: 'OWNER'` **and** `canCoOwn(org)`. Otherwise the existing 409 `OWNED_PROFILE` / `PERSONAL_PROFILE` / `NOT_BUSINESS` applies. This keeps S4 ("never granted") true for every grant that doesn't ask for co-ownership.
  - Owner limit: `MAX_PROFILE_OWNERS` (config constant, see D2). Above it, 409 `OWNER_LIMIT`.
  - On a firm-enabled owned profile the grant also lands as OWNER, so `roleForNewMembership`'s BOOKKEEPER default is bypassed only when `role: 'OWNER'` is explicit.
  - Audit `membership.granted` gets `{ role: 'OWNER', coOwner: true }`.
- `memberships.grant` port: takes an optional `role`. Prisma (`prisma.ts:477`) + memory (`memory.ts:633`). An existing membership with a different role is reported, not silently kept (D7).
- `scripts/users.ts grant`: `--role owner`. Usage text updated.
- `routes/admin-users.ts:326-353` revoke: still refuses the creator. Revoking a co-owner was already allowed.

### 3.3 Session routes: leave / remove (portal)
- **`DELETE /v1/profiles/{profileId}/owners/{userId}`** in `routes/profiles.ts` (session or device session; `identityIdempotent`; no profile header).
  - `userId === caller`: **leave**. Refused for the creator (409 `CREATOR_CANNOT_LEAVE`).
  - `userId !== caller`: **remove**. The caller must be the creator (403 `READ_ONLY_PROFILE` reason `NOT_CREATOR`); the target must be an OWNER member who is not the creator.
  - It deletes the membership only. Records keep `createdByUserId`, and access ends on the next request because `memberships.find` runs per request (`middleware.ts:331`). No session revoke is needed.
  - Audit actor USER: `owner.left` / `owner.removed`, on the profile.
  - The path has no `invite|register|sign-up` words, so `no-self-registration.test.ts` passes unchanged. The pinned public-operations list at `:64` gains this route deliberately.
- Store port: `memberships.removeOwner(orgId, userId, actorId)` is `sessionOnly` in `store-guard.ts:82`. It does the check and the delete in one transaction with `FOR NO KEY UPDATE` on the org row, the same lock as `updateOwned`.

### 3.4 Every existing owner check → `ownsProfile`
| Site | Change |
|---|---|
| `routes/profiles.ts:53-60` `ownedBy` (PATCH, type-change preview, firm-request) | owner = `ownsProfile` |
| `repositories/prisma.ts:157-181` + `memory.ts:277` `updateOwned` | the SQL filter accepts the creator, OR (`ownerUserId IS NOT NULL AND profileType = 'BUSINESS' AND personalOwnerUserId IS NULL` AND an OWNER membership). The `:172` stamp runs only on the creator branch. `CO_OWNED` is checked here, under the lock (OV2, OV3) |
| `routes/profiles.ts` PATCH type → PERSONAL | 409 `CO_OWNED` while there is more than one owner |
| `serializers.ts:77` `owned` | `ownsProfile` (needs the membership, which `buildMe` already passes) |
| `serializers.ts:101` `firmRequestedAt` | visible to every owner |
| `income/compose.ts:139` `isOwnProfile` → `routes/income.ts:172`, `payments.ts:334` | `ownsProfile`. The `createdByUserId === user` rule stays: each person re-dates their own captures only |
| `terms-acceptance.ts:31` | a co-owner's acceptance is audited on co-owned profiles too |
| `firm.ts:31-34` `firmOwnersOf` | on an owned profile: the creator **plus every current OWNER member**, so firm enable never demotes a co-owner |
| `records-file/export.ts:48-53` `localProfileOf` | use `profileOwnerOf`/`ownsProfile` instead of inline columns (the behaviour stays the same) |

### 3.5 `/v1/me`
- `HostedProfile` gains **`owners`** on owned profiles: `[{ userId, name, email, creator: boolean }]`, ordered creator first then by grant date. It is `null` on non-owned profiles and `[self]` on a solo owned profile (D4: always vs only when >1).
- One batched read: `memberships.listOwnersOf(orgIds)` joins users for **all owned profiles in the response** in one query. No N+1 (the cap ≤6 + co-owned keeps it small, but batch anyway).
- `limits.ownedProfiles` is unchanged (creator count).
- `schemas.ts` docs: `owned` now means "you own it, alone or with others"; `owners` is "Additive since 1.43.0-mut373".

### 3.6 Firm interplay
- Any owner may request firm features. Enable keeps every OWNER (§3.4).
- A later MUT-306 invite into an owned firm adds BOOKKEEPER/SUBMITTER: one kind of organization.

### 3.7 Contract
- `API_VERSION` → `1.43.0-mut373 (MUT-358 holds 1.42.0-mut358)` (`app.ts:141`, `routes-m6.test.ts:248`). `openapi:generate`; `hosted:types:check` regenerates `src/hosted/api/schema.d.ts`.
- Additive for Malafat: the new reasons ride on the existing CONFLICT/READ_ONLY_PROFILE codes.

### 3.8 Local mode
- No snapshot bump: `owners` is derived at read time from the `members` + `people` maps that already exist. Local mode has one person, so `owners = [self]` or is hidden. Leave/remove UI is hidden with `useIsLocalMode()`.
- Records export of a co-owned profile writes the exporter as the sole owner (existing behaviour); co-owners are not exported. Documented, no TD.

### 3.9 Operator scripts
- `scripts/profile-rows.sh purge-user` (`:274`): **refuse** when a profile the user created has another OWNER member. The message tells the operator to remove the co-owner or to wait for MUT-333 transfer rules. Test in `profile-rows.test.ts`.

---

## 4. Portal changes (`src/hosted/**`)

> UX direction below is the draft the design review (Apple design pass) will reshape.

- **Where:** an **Owners** section in the profile's edit pane (`ProfileEditForm`), beside `FirmRequestSection` (outside the form, so it never touches If-Match/Save). Shown for owned BUSINESS profiles, hosted only.
- **Rows:** reuse `hp-profile-list` / `hp-profile-row`: name (`dir="auto"`), email, "You", and "Created this profile" for the creator.
- **Actions:**
  - The creator sees **Remove** on each co-owner.
  - A co-owner sees **Leave this profile** on their own row.
  - Both use the in-place confirm (GroupDrawer pattern: `hp-confirm role="group"`, Cancel + danger). The confirm says what stays: "Their records stay on {profile}" / "Your records stay. You'll lose access."
  - Never native `confirm()`.
- **Adding a partner:** no UI in v1. A quiet hint, "To add a partner, write to us", links to support email (D5).
- **List cue:** the Manage list and the switcher sub-line read "Business · shared with {name}" / "Business · 3 owners" (`profileKindKey` + plural forms) (D6).
- **Leaving the active profile:** drop it from the `ME_KEY` cache → navigate to the first remaining profile → `removeQueries(['p', id])` → plain info toast "You left {name}" (ExpenseGroupDetail pattern). Removing someone: toast "{name} removed from {profile}". No SaveFeedbackIcon.
- **Errors:** add `CREATOR_CANNOT_LEAVE`, `NOT_CREATOR`, `CO_OWNED`, `OWNER_LIMIT` to `profileApiErrors.ts`, as banners, never toasts. A co-owner who was removed elsewhere gets 404 → `refetchMe` → the existing "gone" banner.
- **Type change:** on a co-owned profile the PERSONAL card is disabled, with "A shared profile stays Business".
- **Data:** `profileQueries.ts` gets `useLeaveProfile` / `useRemoveOwner` (attempt key from `createAttemptKey`, `keyFor({profileId, userId})`). `client.ts` gets `removeProfileOwner`.
- **i18n:** `hosted.profiles.owners.*` in en + ar, plural objects with all Arabic forms, `{name}`/`{profile}` vars, RTL checked.
- **Registry:** register `ProfileOwnersSection`. Fix the drift where the registry names a `TypeChangeConfirm` component that doesn't exist.

---

### 4.1 Apple design pass (2026-10-21): applied over the draft above

Each finding names the Apple design principle it rests on. Where a finding and the draft above disagree, **the finding wins**.

- **AD1 — Familiarity: copy the shared-album / shared-note pattern.**
  - People are listed as rows. The creator removes someone with a trailing **Remove** on that person's row.
  - A co-owner does **not** get a button on their own row. Their **Leave Profile** is a single danger button at the bottom of the section, where iOS puts "Leave Shared Album" / "Stop Sharing".
  - Things that look the same behave the same: there is one destructive verb per role, always in the same place.
- **AD2 — Agency: confirm only what can't be undone, and anchor the confirm to its source.**
  - Neither action can be undone self-service, since only the operator re-adds a person. So both confirm.
  - The confirm opens **in place**, under the row or button that triggered it (GroupDrawer's `hp-confirm`). There is no modal and no scrim, so the drawer's flow isn't broken.
  - Cancel collapses it back along the same path, and focus returns to the trigger.
- **AD3 — Direct, specific labels.**
  - Buttons name the outcome: **"Remove Sara"** and **"Leave {profile}"**, never "Confirm" / "OK".
  - Each confirm says the consequence in one line:
    - remove: "Sara loses access to {profile}. What Sara recorded stays."
    - leave: "You'll lose access to {profile}. What you recorded stays."
- **AD4 — Wayfinding: a predictable landing.**
  - Leaving the open profile lands on **your personal profile**, which always exists, not on the "first remaining" profile (firms sort first). Then the info toast "You left {name}" appears.
  - There is no Undo action, because it would promise something we can't do.
- **AD5 — Purpose / discoverability.**
  - The section shows on **every owned Business profile**, including a solo one. There it reads "Only you own this profile." followed by a quiet hint, "To add a partner, write to us" (a mailto link to the support address in config) → resolves D4 (`owners` always present, `[self]` when solo) and D5.
  - It is hidden on personal profiles, non-owned profiles and in local mode.
- **AD6 — Consistency of the shared cue** → resolves D6.
  - The switcher and the Manage list sub-line read "Business · Shared with Sara" (two owners) or "Business · Shared · 3 owners" (plural forms, all Arabic forms).
  - A small two-person glyph sits before the text, `aria-hidden`; the text carries the meaning.
  - The same words appear in both places.
- **AD7 — Privacy is transparent, not hidden** → resolves D1.
  - Rows show name (primary) and email (secondary, `dir="ltr"` inside `<bdi>`). Partners were added together by the operator, and the email tells two people with the same name apart.
  - The creator's row reads "Created this profile". Your own row adds "You".
- **AD8 — Response and motion.**
  - The `press` feedback fires on pointer-down (already in the kit).
  - While the request runs, the action button shows its pending state and stays in place; the layout doesn't jump.
  - On success the removed row collapses (height + opacity, critically damped, ~0.3 s) **after** the server answers. It is not optimistic, because a refusal would have to un-collapse.
  - `prefers-reduced-motion`: the row disappears with a short cross-fade.
  - Focus moves to the next row, or to the section heading if none is left.
- **AD9 — Feedback kinds.**
  - Completion is an info toast (remove/leave).
  - Refusal (`CREATOR_CANNOT_LEAVE`, `NOT_CREATOR`, `OWNER_LIMIT`) is an inline `ProfileBanner` in the section.
  - A type-change block is explained **at the control**: the PERSONAL card is disabled with "A shared profile stays Business", next to the card and not in a later error.
- **AD10 — Flexibility.**
  - Row actions are always visible (no hover-only reveal) and the targets are ≥44 px.
  - Trailing actions mirror in RTL.
  - Name/email truncate with an ellipsis and keep the full text in the accessible name.

### 4.2 Design review (gstack /plan-design-review, 2026-10-21) — decisions approved by Basel

DR items override §4 / §4.1 where they differ.

- **DR1 (D3 → 1A) Edit pane order.**
  - The pane reads: form (name, currency, time zone, type cards) → **Owners** → Firm features last.
  - **Leave** is a quiet danger *link-style* button (`hp-link-button hp-danger`) at the end of the Owners section. It is never a filled button and never next to the footer Save.
- **DR2 (D4 → 4A) Cap hint.**
  - Under the Manage list's "used N of M" counter: "Profiles shared with you don't count."
  - Shown only when the viewer co-owns at least one profile they didn't create.
- **DR3 (D5 → 5A) A removed co-owner is told what happened.**
  - When a profile-scoped request for the **open** profile returns 404, the shell remembers that profile's name (from the cached `me`), refetches `me`, and if the profile is gone, navigates to the personal profile.
  - It then shows a persistent dismissible `ProfileBanner` (info): "You no longer have access to {profile}. What you recorded stays."
  - This lives in `AuthGate`/`ProfileLayout`, replacing the bare `ProfileUnavailable` for this case. A deep link to a profile you were never on still gets `ProfileUnavailable`.
- **DR4 (D6 → 6A) After Leave, the whole drawer closes.**
  - It navigates to the personal profile only if the left profile was open. Otherwise the user stays where they are, and the "You left {name}" toast still shows.
  - Opening the leave confirm hides the form footer (Save/Cancel), so nothing can be half-saved. Unsaved edits are discarded, because the confirm already says access ends.
  - The Owners section and Firm section are hidden during the type-change confirm step, as `FirmRequestSection` is today.
- **DR5 (D7 → 7A) Pending and error states.**
  - **Pending:** the action button shows a spinner and keeps its label. The confirm's Cancel and the drawer's close/Escape are disabled until the request answers.
  - **Network error:** the confirm stays open, with the existing network banner and the action re-enabled as retry, reusing the same attempt key.
  - **Remove → 404** (already gone) is treated as success: refetch, then toast.
  - `CREATOR_CANNOT_LEAVE` / `NOT_CREATOR` are inline banners in the section. `OWNER_LIMIT` maps to the generic banner, with no dedicated copy, because the portal can't add owners.
- **DR6 (D8 → 8A) Exit animation actually plays.**
  - On success, the row id joins a local `exiting` set. The row collapses: height + opacity, critically damped, ~0.3 s (a 150 ms cross-fade under reduced motion). On `transitionend`, or after a 400 ms fallback, the new owners are written to `ME_KEY` and a refetch follows.
  - **Focus order:** the next row, else the previous row (the creator's), else the "Owners" heading (`tabIndex=-1`).
- **DR7 (D9 → 9A) Conflict copy names the partner.** On a co-owned profile, `VERSION_MISMATCH` reads "Another owner or device changed this profile. Here is the latest." Solo profiles keep today's copy.
- **DR8 (D10 → 10B) Arrival is told by the operator, not the app.**
  - `grant:user --role owner` prints a paste-ready en + ar note for both partners. The note says which profile is now shared, that both have full rights, and that personal profiles stay private.
  - No in-app "shared with you" banner (declined: pilot scope).
- **DR9 (D11 → 11A) Row anatomy reuses `hp-profile-row`.**
  - Line 1: the name (brand ink, `dir="auto"`).
  - Line 2: the email (`<bdi dir="ltr">`) · "Created this profile" (for the creator), in the secondary ink.
  - Your own row adds the "You" pill, which reuses the "Open now" pill style.
  - No avatars or initials; no new tokens. List semantics: `<ul aria-labelledby="owners-heading">`.
- **DR10 (D12 → 12A) Long names and fallbacks.**
  - A person with no display name shows their email on line 1 and nothing on line 2 except the creator note.
  - Names truncate to one line with an ellipsis, and the full name goes in `title` and the accessible name.
  - The visible row buttons read **"Remove"** / **"Leave"** (sentence case), with `aria-label` "Remove {full name}" / "Leave {profile}".
  - The in-place confirm's danger button names the person or profile in full and may wrap.
  - This settles the AD1/AD3 label conflict.
- **DR11 (D13 → 13A) `MAX_PROFILE_OWNERS = 3`** (config constant; creator included). It resolves plan D2.
- **DR12 (D14 → 14A) The shared cue names the *other* owners.**
  - 2 owners: "Business · Shared with Sara". 3 owners: "Business · Shared with Sara and Omar" (`Intl.ListFormat`, the viewer's locale).
  - It never names the viewer and falls back to email. It truncates in the switcher, with the full text in `title`/aria.
  - The same string appears in the switcher and in the Manage list. A solo profile shows "Business" as today.
  - Plan D6 and AD6 are superseded.
- **DR13 (D15 → 15A) The firm request says who asked.**
  - "Requested by Sara on {date}", or "by you".
  - `/v1/me` adds `firmRequestedBy: { userId, name }` (owners only), read from the stored `firmRequestedByUserId`.
- **DR14 (D16 → 16A) "Add a partner" hint.**
  - `mailto:` with a localized subject "Add a partner to {profile}" and a body asking for the partner's name and email, encoded with `encodeURIComponent`.
  - The plain support address (from config) shows beside it, selectable, for machines with no mail app.

#### Journey storyboard (accepted requirements)

| Step | User does | User feels | Plan specifies |
|---|---|---|---|
| 1 | Sara gets Basel's note (DR8), then opens the portal | expectant | the shared profile is in the switcher: "Business · Shared with Basel" (DR12) |
| 2 | Opens it and records income | trusted, at home | full rights: `owned: true` (§3.4), same gates as her own profiles |
| 3 | Both edit the name at once | mildly surprised | DR7 conflict copy names "another owner" |
| 4 | Opens Manage → the profile | oriented | form → Owners (DR1, DR9) → Firm; the cap hint explains the count (DR2) |
| 5 | Basel removes Sara | deliberate | in-place confirm, a full-name danger button, pending lock (DR5), the row collapses (DR6) |
| 6 | Sara, on Income, loses access | informed, not alarmed | lands on her personal profile with a banner that names the profile and says her records stay (DR3) |
| 7 | (alt) Sara leaves herself | in control | the confirm names the consequence, then the drawer closes and she lands on her personal profile with a toast (DR4) |

5-second (visceral): the shared cue says who. 5-minute (behavioral): she can do everything. 5-year (reflective): leaving or being removed never loses records and never surprises anyone.

#### What already exists (reuse)
`hp-profile-list` / `hp-profile-row`, the "Open now" pill, GroupDrawer's in-place `hp-confirm` + `hp-link-button hp-danger`, `ProfileBanner`, the info `Toast`, `profileApiErrors.ts`, `createAttemptKey`, `FirmRequestSection` placement, `ExpenseGroupDetail` navigate-then-forget, `ProfileUnavailable`, Brand v2 tokens (`docs/brand/README.md`).

#### NOT in scope (design)
- In-app "shared with you" arrival banner: declined (DR8). Revisit when self-service invites (MUT-306) land.
- Avatars/initials: declined (DR9).
- Any "Add co-owner" UI: operator-only in v1.
- Ownership transfer / creator leaving: goes to the eng review (plan D3).

## 5. Tests (TDD: written first)

Server (`npm --prefix server test`, `test:db` on a fresh scratch DB):
- `personal-profile.test.ts` (new): the `ownsProfile` truth table covers creator, co-owner, OWNER member of an operator firm (**false**), Malafat member (**false**), personal profile, no membership.
- `routes-owned-profiles-standalone.test.ts`:
  - S4 stays green for a grant without a role.
  - New: a grant with `role: OWNER` on a Business profile → 201; on personal → `PERSONAL_PROFILE`; on owned PERSONAL type → `NOT_BUSINESS`; past the limit → `OWNER_LIMIT`.
- `routes-profiles.test.ts`:
  - A co-owner can PATCH (rename/currency/type), preview, and request firm.
  - Type → PERSONAL while co-owned → `CO_OWNED`.
  - The cap counts the creator only.
- New `routes-profile-owners.test.ts`:
  - Leave as co-owner → 200, then `/v1/me` drops the profile and the next profile-scoped request returns 404.
  - Creator leave → `CREATOR_CANNOT_LEAVE`; a co-owner removing the creator or another co-owner → `NOT_CREATOR`; removing a non-owner → 404.
  - Records survive with `createdByUserId`; audit rows have actor USER.
- `routes-me` / serializer: `owned` is true for a co-owner and `owners` is ordered with the creator first. A query-count assertion makes `/v1/me` one owners query, whatever the number of profiles.
- Income/payments re-date: a co-owner re-dates their own capture and gets 404 on the other owner's.
- `routes-admin-firm.test.ts`: enabling a co-owned profile keeps both OWNER and makes others BOOKKEEPER.
- `terms.test.ts`: a co-owner's acceptance is audited on the co-owned profile.
- `store-contract-*`: prisma + memory parity for `grant(role)`, `removeOwner`, `listOwnersOf`, `updateOwned` by a co-owner.
- `users-cli.test.ts` (`--role owner`), `profile-rows.test.ts` (purge refusal), `no-self-registration.test.ts` (pinned list updated).

Portal (`npm run test:run`):
- `profileRules.test.ts`: owners-section visibility, Remove vs Leave per viewer, kind key with owner counts.
- `ProfileOwnersSection.test.tsx`: confirm flow, focus return, error banners, local mode hides it.
- `profileQueries` leave-active-profile: navigation happens before the cache drop (no `ProfileUnavailable` flash).
- i18n parity (ar plural forms).

Release-QA (`qa/features/portal/profiles.yaml` + `qa/specs/portal/profiles.spec.ts`):
- `@portal.profiles.co-owner-write`: the co-owner sees the profile and adds income + a client.
- `@portal.profiles.co-owner-leave`: leave → toast → switched away.
- `@portal.profiles.co-owner-remove`: the creator removes the co-owner.
- `qa/support/portalApi.ts` gains owners + DELETE handling; `StubProfile` gets `owners`.

Gate: `npm run lint && npm run typecheck && npm run test:run && npm run build` + server typecheck/lint/openapi:check/test (Node 22).

---

## 6. Cost / scale
- One extra indexed query on `/v1/me` (memberships by orgIds where role = OWNER, join users). Owned profiles per user ≤ 6 + co-owned. Negligible.
- No new tables, columns or migrations. A partial index on `memberships(organizationId) WHERE role='OWNER'` is not needed at this size (`@@unique(userId, organizationId)` + the org index exist).

---

## 7. Knowledge + docs at build time
ADR-163 (claimed with the MUT-358 session on 2026-10-21; MUT-358 holds ADR-162, so re-check main at build), TD-194 if one is needed, with override logs (§1). DECISIONS amendments on ADR-037/MUT-182 and ADR-099. CHANGELOG, SYSTEM_OVERVIEW, COMPONENT_REGISTRY, PATTERNS (the `ownsProfile` rule), TEST_PLAN, and a TD only if something is deferred. Admin runbook: how to add a co-owner (`npm run grant:user -- --email … --organization-id … --role owner`).

---

## 8. Out of scope (ticket)
Invites (MUT-306), staff roles (MUT-305), sharing personal profiles, Malafat/operator firms, "recorded by" on rows, ownership transfer, phone (MUT-374), billing code (MUT-358).

---

## 9. Ticket gaps the plan revealed (to note on Jira)
1. **AC "last owner can never leave (409 LAST_OWNER)"** becomes "the creator can't leave (409 `CREATOR_CANNOT_LEAVE`)", because the creator always stays (no transfer in v1). LAST_OWNER stays reserved for MUT-305.
2. **MUT-358:** coverage must treat any OWNER of an owned profile as covering it (`entitlement.ts:37-38, 85, 104, 120` key on the column owner today).
3. **MUT-239 / MUT-333:** archiving or deleting a co-owned profile, and closing the creator's account, need a rule (transfer vs refuse). For now `purge-user` refuses.

---

## 10. Open decisions for the reviews
- ~~D1~~ Resolved by AD7: name + email.
- ~~D2~~ Resolved by DR11: limit of 3.
- **D3** The creator can't leave in v1 (no transfer): accept, or build transfer now? → **eng review**
- ~~D4~~ Resolved by AD5: `owners` is always present (`[self]` when solo).
- ~~D5~~ Resolved by AD5 + DR14: a prefilled mailto hint.
- ~~D6~~ Resolved by DR12: the shared cue names the others.
- **D7** Granting OWNER to an existing non-owner member (e.g. a future BOOKKEEPER): promote, or refuse until MUT-305? → **eng review**

Design-driven additions to the server scope:
- `/v1/me` gains `firmRequestedBy` (DR13).
- `MAX_PROFILE_OWNERS = 3` (DR11).
- The grant CLI prints the partner note (DR8).

Additions to the portal tests and QA:
- DR3 removed-while-open banner: unit test + QA `@portal.profiles.co-owner-removed`.
- DR5 pending lock and network retry.
- DR6 exit ordering + focus.
- DR12 `Intl.ListFormat` en/ar.
- DR14 mailto encoding.

---

## Business / product impact
- Two partners can run one business's books together while each keeps a private personal profile. That makes the Freelancer tier sellable to two-person practices.
- It unblocks MUT-374 (phone) and gives MUT-305/306 their base: one shared-organization model, not two.
- It is low-risk: no migration, operator-gated adds, and a single `ownsProfile` rule that the tests pin to deny firm and Malafat members.

## Implementation Tasks (design review)

These come from the design review's findings. Effort assumes the features ratio (~30x).

- [ ] **T1 (P1, human ~4h / CC ~10min)** — ProfileOwnersSection — build the section with the DR1 order, the DR9 anatomy, DR10 truncation/labels and the AD1 actions.
  - Files: `src/hosted/components/ProfileOwnersSection.tsx` (new), `ProfileEditForm.tsx`, `hosted.css`.
  - Verify: `ProfileOwnersSection.test.tsx`.
- [ ] **T2 (P1, human ~4h / CC ~10min)** — Remove/Leave flows — in-place confirm, the DR5 pending lock + network retry, DR4 drawer close/route, DR6 exit-then-commit + focus.
  - Files: `profileQueries.ts`, `client.ts`, `ProfilesManageDrawer.tsx`.
  - Verify: unit tests + QA `co-owner-leave` / `co-owner-remove`.
- [ ] **T3 (P1, human ~3h / CC ~8min)** — Removed-while-open banner (DR3).
  - Files: `session/AuthGate.tsx`, `components/QueryView.tsx`, `ProfileBanner`.
  - Verify: unit test + QA `co-owner-removed`.
- [ ] **T4 (P2, human ~2h / CC ~5min)** — Shared cue (DR12) + cap hint (DR2) + conflict copy (DR7).
  - Files: `profileRules.ts` (`profileKindKey`), `ProfileSwitcher.tsx`, `ProfilesManageDrawer.tsx`, `profileApiErrors.ts`.
  - Verify: `profileRules.test.ts`.
- [ ] **T5 (P2, human ~2h / CC ~5min)** — Firm "requested by" (DR13), server + portal.
  - Files: `server/src/serializers.ts`, `schemas.ts`, `FirmRequestSection.tsx`.
  - Verify: `routes-profiles-firm.test.ts`.
- [ ] **T6 (P2, human ~1h / CC ~3min)** — Add-a-partner mailto (DR14) + grant CLI partner note (DR8).
  - Files: `ProfileOwnersSection.tsx`, `server/src/scripts/users.ts`.
  - Verify: an encoding unit test, plus `users-cli.test.ts`.
- [ ] **T7 (P2, human ~1h / CC ~3min)** — en/ar strings: `hosted.profiles.owners.*`, plural/list forms.
  - Files: `src/hosted/i18n/en.json`, `ar.json`.
  - Verify: i18n parity test.

## Design Review Completion Summary

```
  +====================================================================+
  |         DESIGN PLAN REVIEW — COMPLETION SUMMARY                    |
  +====================================================================+
  | System Audit         | no DESIGN.md; Brand v2 kit; UI = portal only |
  | Step 0               | 7/10; focus: all 7 passes + mockups          |
  | Pass 1  (Info Arch)  | 6/10 → 9/10 after fixes                      |
  | Pass 2  (States)     | 4/10 → 9/10 after fixes                      |
  | Pass 3  (Journey)    | 6/10 → 8/10 after fixes (in-app arrival     |
  |                      |   declined)                                  |
  | Pass 4  (AI Slop)    | 9/10 → 9/10 (no issues, OPERATE surface)     |
  | Pass 5  (Design Sys) | 6/10 → 9/10 after fixes                      |
  | Pass 6  (Responsive) | 7/10 → 9/10 after fixes (relies on MUT-357)  |
  | Pass 7  (Decisions)  | 4 resolved, 2 handed to eng review           |
  +--------------------------------------------------------------------+
  | NOT in scope         | written (4 items)                            |
  | What already exists  | written                                      |
  | TODOS.md updates     | 0 items proposed                             |
  | Approved Mockups     | 0 generated (no OpenAI key), 0 approved      |
  | Decisions made       | 14 added to plan (DR1–DR14)                  |
  | Decisions deferred   | 2 (plan D3, D7, eng questions)               |
  | Overall design score | 4/10 → 8/10                                  |
  +====================================================================+
```

Outside voice: one Claude subagent ran (14 findings, all folded into DR1–DR14 or the eng hand-off). Codex coverage is unavailable because the CLI is not installed.

Unresolved decisions:
- D3 (whether the creator can leave, with ownership transfer) goes to the eng review.
- D7 (promoting an existing non-owner member to OWNER) goes to the eng review.

## Eng review (/plan-eng-review, 2026-10-21)

Target: this plan (`.claude/designs/mut-373-co-owners-plan.md`), as it stands after the design review.

**Scope record:**
- Feature answers: no cuts were proposed.
- Structure: D1, Original arrangement: `listOwnersOf` + `removeOwner` + `grant(role)` port methods, 1 component, 1 route.
- Accepted scope: the plan as written plus DR1–DR14.
- Pending remedies: A1, D3, D7, A6, R1.
- Scope Challenge result: scope accepted as-is.

**Scope Challenge findings:**
- S1 (P3, 9/10) — factual correction, no question. DR14's "support address from config" is `SUPPORT_EMAIL` at `src/hosted/terms.ts:26` (`export const SUPPORT_EMAIL = 'info@malafat.app';`). Reuse it.

## Decision ledger

### A1: Where a request's membership role comes from
Finding: A1, P1, 9/10, `server/src/auth/middleware.ts:323-332` (reviewer: in-host).
- `selectProfile` already loads the membership (`await store.memberships.find(identity.user.id, requested)`), but it returns only the organization. `SessionAuth` has no role.
- `ownsProfile` needs the role at the re-date routes (`income.ts:172`, `payments.ts:334`).

Plan baseline: §3.4 says to swap `isOwnProfile` for `ownsProfile`, with no source for the role (original proposal).

Runtime evidence: `namedMemberOrganization` returns `store.organizations.getById(membership.organizationId)` and drops `membership.role`.

Comparison grid:

| Choice | Current | A | B |
|---|---|---|---|
| A1 role source | none (dropped) | `SessionAuth.membershipRole`, set in `selectProfile` (0 extra queries) | each owner-gated route calls `memberships.find` again (+1 query on re-date) |
| D3, D7, A6, R1 | pending | pending | pending |

Question D2: Where should a request get the caller's membership role? The middleware already loads it and throws it away. Recommendation: A.

Header: Role source

Options:
- **A) Carry on auth (Recommended):** `selectProfile` keeps `membership.role` on `SessionAuth`, so every route can call `ownsProfile(org, user, role)` with no extra query, and the device-session path is covered the same way. The cost is a small widening of the `SessionAuth` type and its test fixtures.
- **B) Look up per route:** the owner-gated routes call `memberships.find` themselves. That leaves the auth type untouched, but it adds a query on re-dates and makes it easy for a future route to forget the lookup.

State: approved
Actual answer: A) Carry on auth (D2, 2026-10-21)
Accepted scope: `selectProfile` puts `membershipRole` on `SessionAuth` (session and device session), taken from the membership it already loads. `ownsProfile(org, userId, role)` reads it at every owner gate. The `SessionAuth` fixtures and the middleware test are updated.

### D3: Can the creator leave a co-owned profile?
Finding: D3, P2, 8/10, plan §2 "the creator can't leave in v1" + `server/src/routes/admin-users.ts:345-347` (revoke refuses the column owner) (reviewer: in-host / plan hand-off).

Plan baseline: the creator can't leave; there is no transfer (original proposal, §2).

Runtime evidence: `Organization.ownerUserId` is the creator. The cap (`countOwnedBy`) and "who may remove" both key on it. There is no transfer route today.

Comparison grid:

| Choice | Current | A | B |
|---|---|---|---|
| D3 creator leave | refused (`CREATOR_CANNOT_LEAVE`) | refused in v1. A follow-up ticket adds an operator-run transfer (`users transfer-owner`) | build now: the creator hands creator status to a co-owner, then leaves (session route + UI step) |
| A1 | approved A | approved A | approved A |
| D7, A6, R1 | pending | pending | pending |

Question D3: Can the creator leave a co-owned profile? Recommendation: A.

Header: Creator leave

Options:
- **A) Not in v1 (Recommended):** the creator can't leave (409 `CREATOR_CANNOT_LEAVE`), and a Jira follow-up adds an operator-run transfer. This is the smallest pilot scope, with no cap re-count. The cost is that a creator who wants out must ask the operator or remove the partners. (human ~0 / CC ~0 now)
- **B) Transfer now:** the creator picks a co-owner to become the creator and then leaves, in one transaction that re-checks the new creator's cap of 6. Nobody is ever stuck. The cost is a new route, a picker step in the UI, cap re-count edge cases and more QA. (human ~1.5d / CC ~30 min)

State: approved
Actual answer: A) Not in v1 (D3, 2026-10-21). Decision log `dec-cd1b5570`.
Accepted scope:
- The creator's leave is refused with 409 `CREATOR_CANNOT_LEAVE`, and the portal shows the Leave link only to non-creators.
- Code marker at the refusal: `gstack-shortcut(dec-cd1b5570): creator can't leave, upgrade when MUT-306 lands or a pilot creator asks`.
- A Jira follow-up covers operator-run ownership transfer.

### D7: Granting OWNER to someone who is already a member with another role
Finding: D7, P3, 7/10, `server/src/repositories/prisma.ts:477-494` (`grant` is idempotent and returns the existing row whatever its role) (reviewer: in-host / plan hand-off).

Plan baseline: open (§10 D7).

Runtime evidence: today no owned profile can have a non-owner member, because `admin-users.ts:316-318` refuses every grant on owned profiles. A BOOKKEEPER or SUBMITTER on an owned profile only becomes possible once MUT-306 invites ship. So this path can't be reached now.

Comparison grid:

| Choice | Current | A | B |
|---|---|---|---|
| D7 existing non-OWNER member granted OWNER | unreachable today; `grant` would silently return the old row | 409 CONFLICT reason `ROLE_CHANGE_NOT_SUPPORTED`; MUT-305 owns role changes | promote in place (update role to OWNER) |
| A1, D3 | approved | approved | approved |
| A6, R1 | pending | pending | pending |

Question D4 (ledger id D7): What happens if the operator grants OWNER to someone already on the profile with another role? Recommendation: A.

Header: Promote member

Options:
- **A) Refuse for now (Recommended):** 409 reason `ROLE_CHANGE_NOT_SUPPORTED`, so the operator can't silently "succeed". MUT-305 decides role changes. The cost is one test for a path that can't be reached until MUT-306. (human ~15m / CC ~2 min)
- **B) Promote in place:** the grant updates the role to OWNER. This works ahead of MUT-305, but it decides a role-change rule that belongs to the firm-roles ticket, and it needs an audit `role_changed` row. (human ~1h / CC ~5 min)

State: approved
Actual answer: A) Refuse for now (D4, 2026-10-21)
Accepted scope: a grant with `role: OWNER` to someone who is already a member with a different role gets 409 CONFLICT reason `ROLE_CHANGE_NOT_SUPPORTED`; one store-contract test covers it. A re-grant to an existing OWNER stays idempotent (200).

### A6: Audit action names for leave/remove
Finding: A6, P3, 7/10.
- `server/src/routes/admin-users.ts:62`: `type AuditAction = … 'membership.granted' | 'membership.revoked'`.
- Plan §3.3 proposes new `owner.left` / `owner.removed`.
(reviewer: in-host)

Plan baseline: new actions `owner.left` / `owner.removed` (original proposal).

Runtime evidence:
- Operator revokes already write `membership.revoked` (actor ADMIN) at `admin-users.ts:350`.
- Grants write `membership.granted` (`personal-profile.ts:43`, `post-roll.ts:106`).

Comparison grid:

| Choice | Current | A | B |
|---|---|---|---|
| A6 action names | `owner.left` / `owner.removed` (proposed) | reuse `membership.revoked` (actor USER) with `metadata.reason: 'left' \| 'removed'`, and `membership.granted` with `metadata.role: 'OWNER'` | new actions `owner.left` / `owner.removed` |
| A1, D3, D7 | approved | approved | approved |
| R1 | pending | pending | pending |

Question D5 (ledger id A6): What should the audit log call a leave or a removal? Recommendation: A.

Header: Audit names

Options:
- **A) Reuse membership.\* (Recommended):** `membership.revoked` / `membership.granted` with actor USER or ADMIN and a `reason` or `role` in metadata. One query finds every access change, whoever made it, and no new enum values. The cost is that readers must look at the metadata to tell a leave from a removal. (human ~15m / CC ~2 min)
- **B) New owner.\* actions:** `owner.left` / `owner.removed` read at a glance in the audit trail. The cost is two new action values, and access changes are then split across two names. (human ~30m / CC ~3 min)

State: approved
Actual answer: A) Reuse membership.* (D5, 2026-10-21)
Accepted scope:
- Leave and remove write `membership.revoked` (actor USER, `metadata.reason: 'left' | 'removed'`, `metadata.role: 'OWNER'`) on the profile.
- A co-owner grant writes `membership.granted` (actor ADMIN, `metadata.role: 'OWNER'`).
- There are no new action values. §3.3's `owner.left` / `owner.removed` are dropped.

### R1: Regression contract for single-owner profiles and non-owned members
Finding: R1, CRITICAL regression, 9/10. Existing behavior is at risk from the changed gates:
- `server/__tests__/routes-owned-profiles-standalone.test.ts:89` ("S4 never granted");
- `routes-profiles.test.ts` (`NOT_OWNER`);
- `routes-admin-firm.test.ts:150` ("later grant becomes BOOKKEEPER");
- `serializers.ts:77` (`owned`), `income/compose.ts:139` (`isOwnProfile`).
(reviewer: in-host)

Plan baseline: §5 lists new tests; no explicit regression contract yet (original proposal).

Runtime evidence: the existing suites pin today's single-owner behavior. `ownsProfile` replaces `profileOwnerOf === userId` at 7 sites (server map, A1).

Comparison grid:

| Choice | Current | A | B |
|---|---|---|---|
| R1 preserved behavior | implicit in existing suites | explicit contract: (1) solo owned profiles behave exactly as today, every existing profiles/firm/income-redate test unchanged and green; (2) a grant without `role` on an owned profile → 409 as today (S4); (3) an OWNER-role member of an operator firm or a Malafat profile is **never** `owned` and never passes an owner gate (the `ownsProfile` truth-table rows); (4) enabling firm on a solo owned profile → owner OWNER, others BOOKKEEPER as today | the same contract (1)–(4) **plus** a portal Playwright regression: a solo Business profile's edit pane looks and behaves as before (no Owners rows besides "Only you…", Save works) |
| Intentional changes | — | a co-owner is `owned: true`; a grant with `role: OWNER` on a Business profile is allowed; firm enable keeps every OWNER | same |
| A1, D3, D7, A6 | approved | approved | approved |

Question D6 (ledger id R1): How should the regression contract protect today's single-owner behavior? Recommendation: A.

Header: Regression

Options:
- **A) Server contract (Recommended):** pin (1)–(4) in the server suites. The existing tests stay untouched and must pass, and `ownsProfile` gets a table-driven test with explicit firm, Malafat and personal rows. This catches the dangerous regression (firm staff becoming "owners") at its source. The cost is that the solo-profile portal UI is covered only by the existing `profiles.spec.ts` flows. (human ~3h / CC ~10 min)
- **B) Server + portal regression:** everything in A plus one new Playwright test for the solo Business edit pane. Belt and braces on the UI side, at the cost of one more QA spec to keep. (human ~4h / CC ~14 min)

State: approved
Actual answer: A) Server contract (D6, 2026-10-21)
Accepted scope: regression contract (1)–(4) as in the grid.
- Every existing server test that touches profiles, firm, income/payment re-date, terms and grant/revoke stays unchanged and green.
- New table-driven `ownsProfile` test with these rows: creator, co-owner (OWNER on owned Business), OWNER member of an operator firm → false, Malafat-fed member → false, built-in personal non-owner → false, no membership → false.
- No new portal regression spec; the existing `@portal.profiles.edit` and `@portal.profiles.firm-request` stay green.

### Review sections

**1. Architecture** (in-host):
- `[P1] (9/10) server/src/auth/middleware.ts:331` — membership loaded then dropped → A1, approved A.
- `[P1] (9/10) server/prisma/schema.prisma:351-352` — "inert elsewhere (the OWNER default included)" becomes false for owned profiles. The doc comment + ADR-099 decision 2 are amended under the planned ADR override. This is a factual correction carried with the approved model; no question.
- `[P2] (8/10) server/src/repositories/prisma.ts:477-494` — `grant` has no transaction or lock, so concurrent operator grants could exceed `MAX_PROFILE_OWNERS = 3` (DR11). Necessary proof of the approved limit: the OWNER count + insert run in one transaction under `FOR NO KEY UPDATE` on the org row, the same lock `removeOwner` and `updateOwned` take. Carried, no question.
- D3 → A, approved. D7 → A, approved. A6 → A, approved.
- Failure, noted for MUT-374, not this ticket: a removed co-owner's phone outbox replays writes that now 404. MUT-374 must drop them with a clear message.

Diagram, the owner gate (one rule, every door):

```
request ──► authenticate ──► selectProfile ─┬─ membership? no ──► 404
                                            └─ yes ─► SessionAuth{org, user, membershipRole}  (A1)
                                                         │
             ownsProfile(org, user, role) ◄──────────────┘
               profileOwnerOf(org) == user        ──► true    (creator / personal owner)
               canCoOwn(org) && role == OWNER     ──► true    (co-owner; owned BUSINESS only)
               else                               ──► false   (operator firm, Malafat, personal members)
                 │
   ┌─────────────┼───────────────┬──────────────────┬────────────────────┐
 PATCH/type   income/payment   /v1/me owned +     terms acceptance    firm enable
 firm-request  re-date          owners, firmBy     audit rows          keeps all OWNERs
```

**2. Code quality** (in-host):
- `[P2] (8/10) server/src/income/compose.ts:139` — `isOwnProfile` duplicates the ownership rule. It is replaced by `ownsProfile` (plan §3.4).
- `[P2] (8/10) server/src/records-file/export.ts:48-53` — inline column logic is replaced by the helper (plan §3.4).
- `[P2] (7/10) repositories/prisma.ts:164` + `memory.ts:277` — the rule exists twice, in TS and in SQL (`updateOwned`). A store-contract test with a co-owner pins the two together (part of R1).
- `[P3] (9/10) .claude/COMPONENT_REGISTRY.md:1862` — `TypeChangeConfirm` is listed but doesn't exist. Fix the drift when registering `ProfileOwnersSection`.

No new choices.

**3. Tests** — coverage diagram (proposed paths; ★ marks are the existing tests that pin today's behavior):

```
CODE PATHS                                              USER FLOWS
[+] personal-profile.ts ownsProfile()                    [+] Co-owner works on the shared profile
  ├── [GAP→new] creator / co-owner / firm OWNER /          ├── [GAP→QA] sees profile + "Shared with Basel"
  │     Malafat / personal / none (table, R1)              └── [GAP→QA] adds income + client  @co-owner-write
[+] admin grant(role OWNER)                               [+] Creator removes co-owner
  ├── [★★★ S4 :89] no role → 409 (kept)                    ├── [GAP→QA] confirm → row exits → toast  @co-owner-remove
  ├── [GAP] Business → 201; Personal → NOT_BUSINESS        └── [GAP] pending lock; network retry; 404=success (DR5)
  ├── [GAP] 4th owner → OWNER_LIMIT (under lock)          [+] Co-owner leaves
  └── [GAP] existing BOOKKEEPER → ROLE_CHANGE_NOT_SUPPORTED├── [GAP→QA] leave open profile → personal + toast @co-owner-leave
[+] DELETE /v1/profiles/{id}/owners/{userId}              └── [GAP] leave non-open profile → stay put (DR4)
  ├── [GAP] leave ok / creator → CREATOR_CANNOT_LEAVE     [+] Removed while on Income
  ├── [GAP] co-owner removes other → NOT_CREATOR          └── [GAP→QA] banner on personal profile  @co-owner-removed
  ├── [GAP] non-member caller / unknown target → 404      [+] Concurrent edit
  └── [GAP] records kept; audit membership.revoked (A6)   └── [★★ edit :19] reload copy; [GAP] co-owned wording (DR7)
[+] updateOwned / PATCH by co-owner                        [+] Solo profile (regression R1)
  ├── [★★★ routes-profiles] NOT_OWNER for non-owner (kept) └── [★★★ @portal.profiles.edit/:firm-request] unchanged
  ├── [GAP] co-owner rename/currency/type
  └── [GAP] type→PERSONAL while co-owned → CO_OWNED
[+] /v1/me owners + firmRequestedBy (one query)
  └── [GAP] order creator-first; query-count assertion
[+] firm enable on co-owned → both OWNER  [GAP]; solo [★★★ admin-firm :77/:150 kept]
[+] income/payment re-date by co-owner [GAP]; other owner's capture → 404 [GAP]
[+] terms acceptance audited on co-owned [GAP]
[+] purge-user refuses creator with co-owners [GAP]
[+] portal: profileRules (kind key, cap hint) [GAP]; ProfileOwnersSection [GAP]; DR3 banner [GAP]; ListFormat en/ar [GAP]; mailto encoding [GAP]

COVERAGE (proposed): every new branch has a planned test; regression rows pinned by the existing ★★★ suites.
QUALITY: each new test carries a value card in the test plan artifact. E2E: 4 QA specs (write, remove, leave, removed).
```

Tests made obsolete: none. `routes-owned-profiles-standalone` S4 stays, unchanged (no-role grant).

**4. Performance** (in-host):
- `/v1/me` gains one indexed query (`memberships` by `organizationId IN (...) AND role = 'OWNER'`, joined to users; uses `@@index([organizationId])`). Scale: ≤ 6 owned + operator-limited co-owned profiles per user [estimated].
- Owner gates cost 0 extra queries (A1).

No issues found.

### Outside voice (native Plan subagent; Codex not installed)
It completed inside the 5-minute timer. There were 9 findings: 2 Critical/High, 5 Medium, 2 Low. Dispositions:

- **OV1, Critical (verified):** the §2 formula fails the approved R1 truth table. A non-creator member of a built-in personal or owned PERSONAL profile has `profileOwnerOf !== null` and the default role OWNER, so it evaluates to true.
  - **Correction under R1 (no new choice):** the role branch also requires `canCoOwn(org)`:
    ```
    ownsProfile = profileOwnerOf(org) === userId
               || (canCoOwn(org) && role === 'OWNER')
    canCoOwn    = ownerUserId != null && profileType === 'BUSINESS' && personalOwnerUserId == null
    ```
    §2 and the Architecture diagram read this way from now on.
  - The pre-deploy legacy check is a separate choice (OV1b, below).
- **OV2, High (verified):** the §3.4 `updateOwned` SQL membership branch could match an operator firm, and `prisma.ts:172` would then stamp `ownerUserId = caller`.
  - **Correction (needed to keep the approved model safe):** the membership branch also requires `ownerUserId IS NOT NULL AND profileType = 'BUSINESS' AND personalOwnerUserId IS NULL`. The `:172` stamp runs only on the creator branch (unstamped MUT-120 personal rows).
  - The memory twin (`memory.ts:277,287`) mirrors this.
  - Store-contract test: an operator-firm member calling `updateOwned` directly gets not_found and the org is unchanged.
- **OV3, Medium:** the `CO_OWNED` and grant BUSINESS checks are time-of-check/time-of-use races.
  - **Correction (proof of approved rules):** `CO_OWNED` is checked inside `updateOwned` under its `FOR NO KEY UPDATE` org lock. The grant's `canCoOwn` and owner-count checks run in the grant transaction under the same lock (with the Architecture P2 item).
- **OV4, Medium:** POST/PATCH responses lack `owners`, so the cached `ME_KEY` loses it on every rename. This is a choice (OV4, below).
- **OV5, Medium:** a co-owner who recorded an expense or requested firm features can't be purged (`Expense.createdByUserId` Restrict, `schema.prisma:1030`; `profile-rows.sh:281-303`). This is a choice (OV5, below).
- **OV6, Medium (scope challenge): rejected, not reopened.** The thinner portal scope reverses DR3/DR6/DR12/DR13/DR14, which Basel approved one by one in D5–D16 of the design review. The pilot size and the existing operator revoke were both known then, so there's no new evidence. Recorded here so Basel can overrule it.
- **OV7, Low:** DR3 refetches `me` on any 404. This is a choice (OV7, below).
- **OV8, Low:** A1's "every gate" is too broad. `/v1/profiles/*` (`profiles.ts:53-60`), `buildMe` and `termsAcceptedAudit` (`terms-acceptance.ts:28-31`) read their own membership.
  - **Correction:** these sites pass the role from their own membership read, and the plan lists them so nothing passes `undefined`.
- **OV9, Low:** Malafat suggestions (`malafatSuggestions.ts:13,23`) start counting co-owned profiles once `owned` flips. This is a choice (OV9, below).

### Outside-voice choices (ledger)

All five rows below keep A1, D3, D7, A6, R1 and the OV1/OV2/OV3/OV8 corrections fixed.

**OV1b: pre-deploy check for legacy non-creator memberships on owned profiles** (OV1, outside voice)
- Current: none.
- Options:
  - **A) Apply:** before deploy, a read-only check (`profile-rows.sh` or a post-roll step) counts memberships on owned orgs whose user isn't the creator, and the release stops if any exist.
  - **B) Keep current:** no check, relying on MUT-182's refusal having held since 2026-10-14.
  - **C) Investigate:** run that count once on prod now (read-only) and decide afterwards.
  - **D) Defer:** decide later.
- Question D7. State: approved. Actual answer: A) Apply (D7). Accepted scope: a read-only pre-deploy check (beside `profile-rows.sh` / post-roll) counts memberships on owned orgs whose user is not the creator, and the release stops if the count is > 0. Test in `profile-rows.test.ts` or `post-roll.test.ts`.

**OV4: `owners` on POST/PATCH responses** (OV4, outside voice)
- Current: only `/v1/me` carries `owners`.
- Options:
  - **A) Apply:** POST/PATCH `/v1/profiles` responses include `owners` (same builder, one owners query per write), so the cache stays complete.
  - **B) Keep current:** the portal's `withProfileReplaced` keeps the cached `owners` when the response lacks them, with `owners` optional in the schema.
  - **C) Investigate.**
  - **D) Defer.**
- Question D8. State: approved. Actual answer: A) Apply (D8). Accepted scope: POST/PATCH `/v1/profiles` responses carry `owners` (and `firmRequestedBy`) from the same `hostedProfileFor` builder; `owners` is required on owned profiles in the schema; route tests assert it on create and rename.

**OV5: a co-owner's account can't be purged after recording on a shared profile** (OV5, outside voice)
- Current: not addressed.
- Options:
  - **A) Apply:** note it on MUT-333 (Jira comment) and in the operator runbook beside `purge-user`, with no code change here.
  - **B) Keep current:** say nothing.
  - **C) Investigate:** design the reassignment now (e.g. records move to the creator on purge).
  - **D) Defer.**
- Question D9. State: approved. Actual answer: A) Apply (D9). Accepted scope: a Jira comment on MUT-333, plus a runbook note beside `purge-user`, saying that records a co-owner made on a shared profile block their purge (Restrict FKs), so MUT-333 must choose reassign or anonymize. No code here.

**OV7: what triggers DR3's refetch** (OV7, outside voice)
- Current: any 404 on the open profile.
- Options:
  - **A) Apply:** `selectProfile`'s not-a-member 404 gains `details.reason: 'PROFILE_NOT_FOUND'` (an additive contract), and DR3 reacts only to it.
  - **B) Keep current:** any 404 refetches `me` (cheap; `me` is small) and the banner shows only if the profile is really gone.
  - **C) Investigate.**
  - **D) Defer.**
- Question D10. State: approved. Actual answer: B) Keep current (D10). Accepted scope: unchanged DR3 — any 404 on the open profile refetches `me`, and the banner shows only when the profile is really gone. No API change.

**OV9: Malafat suggestions and co-owned profiles** (OV9, outside voice)
- Current: suggestions count every `owned` BUSINESS profile, which would now include co-owned ones.
- Options:
  - **A) Apply:** suggestions count only profiles the viewer created (`owners[0].userId === me`, or a `creator` flag).
  - **B) Keep current:** a co-owner also sees "second business" prompts for the shared profile.
  - **C) Investigate.**
  - **D) Defer.**
- Question D11. State: approved. Actual answer: A) Apply (D11). Accepted scope: Malafat suggestion eligibility (`malafatSuggestions.ts:13,23`) counts only Business profiles the viewer created (the `owners` entry with `creator: true` is the viewer), with a unit test.

Approval readiness: PASS. Checked: A1 (D2 A), D3 (D3 A), D7 (D4 A), A6 (D5 A), R1 (D6 A), OV1b (D7 A), OV4 (D8 A), OV5 (D9 A), OV7 (D10 B), OV9 (D11 A); structure D1 Original. OV1/OV2/OV3/OV8 are corrections that the approved R1 and model require.

### Eng review outputs

**NOT in scope**
- Ownership transfer, or the creator leaving: D3. A Jira follow-up adds an operator transfer.
- Role changes on existing members: D7. MUT-305 owns them.
- Thinning the approved portal polish: OV6, rejected because there is no new evidence. Basel can reopen it.
- Billing coverage by a co-owner's own subscription: Basel's call on MUT-358, raised there. No billing code here.
- Phone parity: MUT-374.
- Purge reassignment for co-owners: MUT-333 (OV5).

**What already exists (reuse)**
- Server:
  - `profileOwnerOf`/`profileTypeOf` (`personal-profile.ts:23-30`) and `ownedProfileConflict` (`errors.ts:90`).
  - `memberships.find/grant/revoke/listByOrganization` (`ports.ts:1346-1358`) and `roleForNewMembership` (`firm.ts:11`).
  - The `FOR NO KEY UPDATE` lock pattern (`prisma.ts:140-181`), `hostedProfileFor` (`serializers.ts:76`), `identityIdempotent` and `actorOf` (`middleware.ts:441`).
  - The `membership.granted/revoked` audit actions.
- Portal: the reuse list from the design review (hp-profile-row, hp-confirm, ProfileBanner, Toast, createAttemptKey, `SUPPORT_EMAIL`).

**Failure modes**

| New path | Realistic failure | Covered by | User sees |
|---|---|---|---|
| `ownsProfile` | an operator-firm or personal member is treated as owner (role defaults to OWNER) | OV1 fix + R1 table test + OV1b pre-deploy count | — (prevented) |
| `updateOwned` SQL | a firm is converted into a member's owned profile | OV2 guard + store-contract test | — (prevented) |
| grant(role OWNER) | concurrent grants exceed 3 / retype races | P2 lock + OV3 + test:db | the operator gets 409 `OWNER_LIMIT` |
| DELETE owners route | network drop mid-request | DR5 retry with the same attempt key; idempotent remove | the confirm stays open with a retry |
| removed while open | the next request 404s | DR3 refetch + banner | the banner names the profile |
| `/v1/me` owners query | DB hiccup | the existing 5xx handling | the existing error view (not silent) |
| PATCH response | owners missing → flicker | OV4 (owners on POST/PATCH) | — (prevented) |

Critical gaps (no test AND no handling AND silent): **0**.

**Worktree parallelization:** sequential implementation. The portal depends on the server contract (types regenerated from OpenAPI), so there's no independent lane. Order: server (rule, ports, routes, /v1/me, CLI, checks) → `openapi:generate` + `hosted:types` → portal → QA specs.

## Implementation Tasks (eng review)

These come from the eng review's findings (features ~30x, tests ~50x).

- [ ] **T8 (P1, human ~3h / CC ~8min)** — server rule — `ownsProfile` + `canCoOwn` (OV1 formula), with `SessionAuth.membershipRole` set in `selectProfile` (A1).
  - The sites that read their own membership pass the role (OV8): `profiles.ts` `ownedBy`, `buildMe`, `termsAcceptedAudit`.
  - Surfaced by: A1, OV1, OV8.
  - Files: `server/src/personal-profile.ts`, `auth/middleware.ts`, `routes/profiles.ts`, `routes/me.ts`, `terms-acceptance.ts`, `income/compose.ts`, `serializers.ts`.
  - Verify: the R1 table test + all existing suites green.
- [ ] **T9 (P1, human ~3h / CC ~8min)** — store — guarded `updateOwned` SQL + memory twin (OV2), with `CO_OWNED` under the lock (OV3).
  - `grant(role)` runs in a transaction with the org lock, `canCoOwn`, `MAX_PROFILE_OWNERS = 3`, `ROLE_CHANGE_NOT_SUPPORTED` (D7) and the `metadata.role` audit (A6).
  - `removeOwner` audits `membership.revoked` with a reason (A6), and `listOwnersOf` is added.
  - Files: `repositories/prisma.ts`, `memory.ts`, `ports.ts`, `auth/store-guard.ts`.
  - Verify: store-contract (prisma + memory) + `test:db`.
- [ ] **T10 (P1, human ~2h / CC ~6min)** — route `DELETE /v1/profiles/{id}/owners/{userId}` (`CREATOR_CANNOT_LEAVE` with the `gstack-shortcut(dec-cd1b5570)` marker, `NOT_CREATOR`).
  - Owners on `/v1/me` + POST/PATCH (OV4), `firmRequestedBy` (DR13), `firmOwnersOf` keeps every OWNER.
  - Files: `routes/profiles.ts`, `firm.ts`, `schemas.ts`, `app.ts` (API 1.43.0-mut373), `openapi/openapi.yaml`.
  - Verify: the new `routes-profile-owners.test.ts`, `openapi:check`, `no-self-registration.test.ts`.
- [ ] **T11 (P2, human ~2h / CC ~5min)** — operator.
  - `grant:user --role owner` + the partner note (DR8).
  - The pre-deploy legacy count (OV1b).
  - `purge-user` refuses a creator who has co-owners.
  - The runbook note + a MUT-333 comment (OV5).
  - Files: `server/src/scripts/users.ts`, `server/scripts/profile-rows.sh`, `server/DEPLOYMENT.md`.
  - Verify: `users-cli.test.ts`, `profile-rows.test.ts`.
- [ ] **T12 (P2, human ~30m / CC ~3min)** — Malafat suggestions count created-only profiles (OV9).
  - Files: `src/hosted/data/malafatSuggestions.ts`.
  - Verify: unit test.
- [ ] **T13 (P2, human ~1h / CC ~4min)** — knowledge files.
  - ADR-163 (overrides ADR-037/MUT-182 "never granted", MUT-181 D4, and ADR-099's rejected alternative + "role inert" decision 2), the schema.prisma:351 comment, PATTERNS (`ownsProfile`), CHANGELOG, SYSTEM_OVERVIEW, COMPONENT_REGISTRY (+ fix the TypeChangeConfirm drift), TEST_PLAN.
  - Verify: review.

## Eng Review Completion Summary
- Step 0: Scope Challenge: scope accepted as-is (structure: Original arrangement).
- Reality rows: 7/7 tier-1 rows emitted. premise-table: unverified=0 (every claim has a file:line receipt from the code maps). already-done: pass (no co-owner commits). surface-check: pass. binding-decisions: pass (honours intake + DR1–DR14; overrides are logged for ADR-099/ADR-037). numbers: estimates labelled. deferred-asks: pass (MUT-373's AC "LAST_OWNER" is replaced by CREATOR_CANNOT_LEAVE, D3 — to note on Jira). pr-count: 1.
- Architecture Review: 3 issues (A1, schema doc, grant lock), plus D3/D7/A6 decisions.
- Code Quality Review: 4 issues (all carried as plan work).
- Test Review: diagram produced, ~24 gaps, all mapped to planned tests; 1 regression contract (R1).
- Performance Review: 0 issues.
- NOT in scope: written. What already exists: written.
- TODOS.md updates: 0 proposed (follow-ups go to Jira: operator transfer, MUT-358 coverage, MUT-333).
- Failure modes: 0 critical gaps.
- Unresolved decisions: 0.
- Outside voice: Codex not installed → native Plan subagent completed within the timer; 9 findings (4 corrections, 4 decided, 1 rejected).
- Parallelization: 1 lane, sequential.
- Lake Score: 9/10 answers picked the complete option (D3 took the 7/10 shortcut on purpose, logged dec-cd1b5570).

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | eng outside voice (native Plan subagent; Codex not installed) | Independent 2nd opinion | 1 | unavailable (codex) / completed (in-host) | 9 findings: 4 corrected, 4 decided, 1 rejected |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open | 7 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | issues_open | score: 4/10 → 8/10, 14 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:**
  - Design phase: Codex unavailable, in-host subagent completed (14 findings).
  - Plan-review phase: Codex unavailable, in-host Plan subagent completed (9 findings).
  - Native fallback is not outside coverage.
- **VERDICT:** Eng review is complete with every finding mapped to approved work. Its status is issues_open only because findings were found and resolved into tasks, not because anything is undecided. The design review's two hand-offs (D3, D7) were decided here.

NO UNRESOLVED DECISIONS
