# MUT-237 — Change your own password on the hosted portal

Jira: MUT-237 (Story, epic MUT-34, "Hosted Mutaba3a"). Blocks MUT-238 (iPhone Settings screen, Backlog, calls this route). Relates MUT-235 (setup links, In Review, merged to local main at `6390da3`). No open blocker — `/eng-ticket` Step 1b blocker gate passes.
Status: plan. Touches `server/src/routes/sessions.ts`, `server/src/repositories/{ports,memory,prisma}.ts`, `server/src/auth/store-guard.ts`, `server/openapi/openapi.yaml`, `src/hosted/**`.

ADR-088's own Consequences section already named this: "MUT-237/238 (change your own password) reuse `NEW_PASSWORD_POLICY`." `NEW_PASSWORD_POLICY` (`server/src/auth/account-setup.ts:15`) carries the comment "Shared with changing a password while signed in (MUT-237)" — this ticket was anticipated, not improvised.

## 1. Problem and acceptance criteria

No signed-in hosted user can change their own password today; only an operator-issued setup link can set one (MUT-235/236). Ticket's acceptance criteria:

1. A wrong current password is refused and counts toward the lockout.
2. After a change, other web and device sessions are signed out; this one stays signed in.
3. The new password must meet the policy (12–128 chars), enforced on the server and shown inline in the portal.
4. Passwords never appear in a log line.
5. Release-QA: a feature plus a passing spec.
6. (Non-functional) Auth change, so tests come first.
7. Amend ADR-037 for the new route; bump the OpenAPI version.

## 2. Where the code belongs (reuse-first)

Nothing here is a new subsystem — every piece has a direct precedent from MUT-235/236/38/64.

| need | reused from |
|---|---|
| Route factory, deps shape (`store`, `passwordHasher`, `throttle`, `settings`) | `sessionRoutes` in `server/src/routes/sessions.ts` — **the new route is a sibling of `GET /v1/me`, `DELETE /v1/sessions/current`, `PATCH /v1/me/malafat-suggestions` in this same file**, not a new route module. They already share one `SignInThrottle` instance (`app.ts:186`, passed to `sessionRoutes` at `app.ts:214` and to `accountSetupRoutes` at `app.ts:229`) |
| Org-independent routing | `ORGANIZATION_INDEPENDENT_ROUTES` (`sessions.ts:32`) — add `'POST /v1/me/password'`; the route needs no `X-Mutaba3a-Profile` (ADR-037 §6 only applies to organization-scoped writes) |
| Password policy, schema | `NEW_PASSWORD_POLICY` + `NewPasswordSchema` (`account-setup.ts:15`, `schemas.ts:447`) — exact reuse, no new constant |
| Password verify + throttle pattern | `signIn()`'s shape (`auth/sign-in.ts:59-109`): fetch user → `throttle.isLocked(key, now)` / `user.lockedUntil` → `passwordHasher.verify` → on failure `throttle.recordFailure` + `store.users.recordFailedSignIn` (+ audit `user.locked_out` if it trips the lock) → on success `throttle.clear(key)`. The change-password handler runs the **same shape** against the *current* password, keyed the same way (`normalizeEmail(user.email)`), so a bad guess here counts toward the same lockout a wrong sign-in would (AC 1) |
| Atomic password-set + session-revoke + audit | `store.accountSetup.redeem({ tokenDigest, passwordHash, at, audit })` (`routes/account-setup.ts:116`) is the precedent for "one port method, one transaction, does hash-set + session-revoke + audit." MUT-237 needs the session-authenticated equivalent (§3) |
| Password field UI (toggle, hint, inline error) | `SetupForm` in `src/hosted/pages/auth/SetupPage.tsx:240-276` — visible `hp-password` wrapper, `showPassword` toggle, `hp-field-hint`, `passwordProblem()` from `setupLink.ts` |
| Portal overlay/URL-mirroring pattern | `ProfileDrawers`/`ProfilesManageDrawer` (`src/hosted/shell/ProfileDrawers.tsx`, `src/hosted/components/ProfilesManageDrawer.tsx`) — the portal's own `Drawer` component (`src/hosted/components/Drawer.tsx`), state in the URL (`?manageProfiles=true` etc.), stripped at the page boundary by `omitShellOverlay` (ADR-008). This is this app's GlobalOverlays-equivalent pattern (CLAUDE.md's drawer-first rule, portal flavor) |
| Account menu | `UserMenu.tsx:54-58` — "Change password" is a new `button role="menuitem"` between Sign out and `MalafatMenuItems` |

**Nothing new**: no new route file, no new store-guard category shape, no new UI primitive, no new npm dependency.

## 3. Server design

### 3.1 Route

`POST /v1/me/password` in `sessionRoutes` (`server/src/routes/sessions.ts`), `security: [{ session: [] }]`, added to `ORGANIZATION_INDEPENDENT_ROUTES`.

```
ChangePasswordRequest { currentPassword: string, newPassword: NewPassword }
→ 204 No Content (mirrors DELETE /v1/sessions/current; no body needed — AC asks for no return value)
→ 401 INVALID_CREDENTIALS           (wrong current password, or locked)
→ 422 VALIDATION_FAILED             (newPassword outside 12–128)
→ 403 CROSS_SITE_REQUEST            (same-origin check, like /v1/sessions)
```

Handler shape (mirrors `signIn()`'s verify block, then `redeem`'s commit block):

```ts
const { user, session } = c.get('identity');           // SessionIdentity: org-independent, no profile needed
const key = normalizeEmail(user.email);
const now = c.get('now')();
const locked = throttle.isLocked(key, now) || (user.lockedUntil ? user.lockedUntil.getTime() > now.getTime() : false);
const matches = !locked && await passwordHasher.verify(user.passwordHash ?? await dummyHashFor(passwordHasher), currentPassword);
if (locked || !matches) {
  if (!locked) {
    const lockUntil = throttle.recordFailure(key, now);
    await store.users.recordFailedSignIn(user.id, now, lockUntil);
    if (lockUntil) await auditToMembers(...'user.locked_out'...);   // same helper signIn uses
  }
  throw new ApiError('INVALID_CREDENTIALS', 'Current password is wrong');
}
throttle.clear(key);
const passwordHash = await passwordHasher.hash(newPassword);        // hash before the transaction, same reasoning as redeem
const changed = await store.users.changePassword({ userId: user.id, passwordHash, exceptSessionId: session.id, at: now, audit });
return c.body(null, 204);
```

`dummyHashFor`/`auditToMembers`/`recordFailedSignIn` are not currently exported from `auth/sign-in.ts` (they're module-private or already shared via `store-guard`/`users.ts` helpers) — exporting the two private helpers (`dummyHashFor`, `auditToMembers`) for this second caller is a one-line visibility change, not new logic. `normalizeEmail` is already exported from `auth/users.ts`.

**Build-time correction (qa-reconcile): the wrong-current-password/locked refusal above ships as `403 CURRENT_PASSWORD_WRONG`, not `401 INVALID_CREDENTIALS`.** A `401` on this route would trip the portal's generic session-expired handler (`client.ts`'s `unauthorisedHandler`, wired in `SessionBridge.tsx`) and sign the person out mid-form — the session is still valid, only the typed guess is wrong. `CURRENT_PASSWORD_WRONG` is a new entry in the server's fixed `ERROR_CODES` catalog (403). `dummyHashFor`/`auditToMembers` were not reused as sketched above: `auditToMembers`'s type is hardcoded to `'user.signed_in' | 'user.locked_out'` with an actor mapping specific to the anonymous sign-in flow, so the shipped route writes its own small `lockedOutAudit`/`changePasswordAudit` helpers instead of bending that one; and no dummy-hash timing defense is needed at all — the session already proves identity, so unlike sign-in there's no "unknown email" to hide.

### 3.2 One new store port method: `users.changePassword`

New method (not a reuse of `users.setPassword`, which stays `operator`-only per ADR-037 §7's "one writability matrix" — reclassifying an operator-only primitive to also accept a session principal would blur the invariant the matrix exists to enforce; the precedent since MUT-182 is a parallel `sessionOnly` method, not a reclassified shared one):

```ts
// ports.ts, beside setPassword (ports.ts:1204)
changePassword(input: { userId: string; passwordHash: string; exceptSessionId: string; at: Date; audit: AuditInput }): Promise<{ user: UserRecord; revoked: number } | null>;
```

Implementation (`memory.ts`, `prisma.ts`) does, in one transaction (mirrors `accountSetup.redeem`'s prisma `$transaction` at `prisma.ts` and the row-lock precedent at `prisma.ts:130-132` for the same "concurrent write to this user row" concern `--lock`/redeem already solved):
1. `Object.assign`/`UPDATE users SET passwordHash, passwordChangedAt = at, failedSignIns = 0, lockedUntil = null` (same fields `setPassword` touches — share that assignment logic as a private helper so the two methods don't duplicate the field list)
2. Revoke every session for `userId` **except** `exceptSessionId` — both kinds, web and device (`SessionRecord.kind` is metadata only; `revokeAllForUser` already spans both, so the exclusion logic must too, matching AC 2's explicit "web and device"). (`revokeAllForUser` (`ports.ts:1271`) revokes everything including the caller's own live session — used today only by admin paths (`admin-users.ts:385,408`) where that's correct. Rather than add an optional param to a method two operator call sites already depend on, implement the exclusion inline inside `changePassword`'s own transaction — it owns the `exceptSessionId` semantic and nothing else needs to change)
3. Write the audit event (actor `USER`, mirrors ADR-037 decision 9) inside the same transaction, same shape as `accountSetup.redeem`'s `audit` param
4. **Not optional — same row-lock discipline ADR-088 §7a added for `--lock`/redeem**: take the person's row lock (`FOR UPDATE` in Prisma, matching the pattern at `prisma.ts:130-132`) before writing, so a sign-in racing this transaction either commits first (and its session then gets revoked by step 2, since it's not `exceptSessionId`) or waits and then fails the post-lock hash check. Without this lock, a sign-in using the *old* password could land a valid session in the gap between this transaction's read and write — the same hole ADR-088 closed for setup-link redeem and `--lock`, and change-password is exactly as security-sensitive. Pin it with a concurrency test mirroring whatever `store-contract-account-setup.ts` already has for the redeem-vs-sign-in race.

Store-guard (`store-guard.ts:60-64`): classified `{ write: 'identity' }`, not `sessionOnly` as first sketched — `writability.ts` already declares an `identity` domain matching `/v1/me, /v1/me/*, /v1/sessions/current, /v1/profiles*` with `apiKey: 'none', session: 'read-write'`, the exact shape `users.updateMalafatSuggestions` already uses for the same kind of write (a person's own identity-row field, no organization). `/v1/me/password` falls inside that `/v1/me/*` pattern for free; `sessionOnly` is reserved for resources with no organization at all (MUT-66's inbox, MUT-182's owned profiles), a different category. The compiler-exhaustive `StoreAccess` type still catches a missing entry either way.

### 3.3 Schemas + OpenAPI

```ts
// schemas.ts, beside SetupLinkRedeemRequestSchema
export const ChangePasswordRequestSchema = z.object({ currentPassword: z.string(), newPassword: NewPasswordSchema }).openapi('ChangePasswordRequest');
```

`currentPassword` is unconstrained (not `NewPasswordSchema` — it's whatever the person's existing password already is, which may predate the 12-char floor from an operator-set password before MUT-235, or may itself be exactly at the boundary; constraining it would wrongly reject a correct old password).

Bump: API 1.30.0-mut237 (`API_VERSION` + `.claude/CHANGELOG.md`, per MUT-235/236's precedent).

### 3.4 Logging (AC 4)

Grep confirms the existing pattern already never logs raw credentials (`sign-in.ts`/`account-setup.ts` log no password). The new route must follow the same discipline: no `pino` call anywhere in the handler logs `currentPassword`/`newPassword`/`passwordHash`. A test asserts it the same way `account-setup.test.ts` likely already proves no-token-in-logs for MUT-235 (mirror that test for passwords).

### 3.5 ADR-037 amendment

ADR-037 decision 1 says "no signup, invite or password-reset route exists in any environment" — already overridden once by ADR-088 for the *public* setup-link pair. This ticket adds an **authenticated** route, a different category (a person changing their own already-known password, not a public reset). `no-self-registration.test.ts`'s `FORBIDDEN` regex (`/sign-?up|register|invite|forgot|reset/i`) checks path names outside `/admin/`, not auth status — **the path must not contain "reset"**; `/v1/me/password` avoids it cleanly. Add a short override note to ADR-037 (pattern-matching ADR-088's own override note at `DECISIONS.md:1609`): "decision 1 extended — an authenticated person may change their own known password through `POST /v1/me/password`; this is not a public reset route and the path carries no forbidden word."

## 4. Portal design

### 4.1 Entry point

`UserMenu.tsx:54` gains a second `button role="menuitem"` ("Change password") between Sign out and the separator before `MalafatMenuItems`, calling `useAccountDrawers().open()` (§4.2, D3).

### 4.2 Drawer, URL-mirrored (D3: a sibling controller, not folded into ProfileDrawers)

- `src/hosted/data/filters.ts`: **build-time simplification** — rather than a parallel `AccountDrawerSearch`/`ACCOUNT_OVERLAY_KEYS` as first sketched, `changePassword?: true` was added directly to the existing `ProfileDrawerSearch`/`SHELL_OVERLAY_KEYS`. `pickShellOverlay` is consumed generically by `router.tsx`'s `useReplaceSearch` for every page's filter replace, regardless of which drawer owns a key — a second parallel key list would need that generic code to merge both, for no benefit. One shared registry, a comment explaining the generalization.
- `src/hosted/shell/AccountDrawers.tsx` (new): `useAccountDrawers()` (`open`/`close`, URL-mirrored, same `go()` shape as `useProfileDrawers`) and `AccountDrawers()` rendering `<ChangePasswordDrawer onClose={drawers.close} />` when `state.changePassword`.
- `HostedShell.tsx:58`: `<AccountDrawers />` mounted as a sibling right after `<ProfileDrawers active={profile} />`.
- `UserMenu.tsx`: clicking "Change password" must also close the account popover itself (`usePopover().close(false)`) before opening the drawer — the exact pattern `ProfileSwitcher.tsx`'s `openNew`/`openManage` already use, since nothing in `usePopover` auto-closes on an interior click.

### 4.3 `ChangePasswordDrawer.tsx` (new)

Reuses the portal `Drawer` (`title`, `onClose`), and `SetupForm`'s password-field shape (toggle, `hp-field-hint`, `passwordProblem()`): a current-password field (`autocomplete="current-password"`) + a new-password field (`autocomplete="new-password"`, same visible rule text). `POST /v1/me/password` → `204` closes the drawer with a toast ("Password changed"); a wrong current password (`403 CURRENT_PASSWORD_WRONG`, §3.1) shows an inline banner without closing, same shape as `SignInPage`'s `bannerFor`; `422` refuses the new-password field inline, mirroring `SetupForm`'s `refuseInline('rule')`. No `429` case (D2: no IP limiter on this route).

**qa-reconcile gap, fixed:** the first build dropped the show/hide toggle this section calls for. With no confirm field, a mistyped new password that's never shown fails silently and can lock the person out of a password they don't actually know — the exact failure mode the toggle exists to prevent. Both fields got independent show/hide buttons (`hp-password`/`hp-password-toggle`, reused verbatim from `hosted.css`), with a component test and a QA-spec rerun to confirm.

No sign-out, no redirect: the current session stays live (ADR-037 §3 untouched; this route doesn't touch cookies).

### 4.4 i18n

New keys under `hosted.account.changePassword.*` (EN/AR, RTL unaffected — it's a drawer, not a new page): title, currentPassword label, newPassword label (reuse `hosted.setup.rule`/`tooShort`/`tooLong` wording verbatim rather than duplicating the 12–128 copy), submit, success toast, wrong-current-password banner. `auth-states.test.tsx`'s `BANNED` regex and `check-bundles`'s `HOSTED_RULES` apply unchanged — none of this copy is a self-service *account-creation* door, so no new banned phrase risk; `npm run test:bundles` confirmed it.

## 5. Decision ledger (resolved with Basel, 2026-10-16)

- **D1 — Shared lockout.** A: reuse the same email-keyed `SignInThrottle` as sign-in — a wrong current-password guess here counts toward, and can trip, the same account lockout a wrong sign-in attempt would. One lockout concept for the account, matching the ticket's literal wording. §3.1's handler shape is correct as written; no separate throttle.
- **D2 — No IP limiter.** A: `POST /v1/me/password` gets no per-IP rate limit. Sign-in and the setup-link routes are public/unauthenticated, which is why they need one; this route already requires a valid session cookie. `signInIpLimiter` is not wired into this route.
- **D3 — Sibling `AccountDrawers` controller.** B: a new `src/hosted/shell/AccountDrawers.tsx`, not folded into `ProfileDrawers`/`ProfileDrawerSearch`. Keeps `ProfileDrawers` scoped to profiles, as its name promises; account-level concerns get their own small controller. Full shape in §4.2.
- **D4 — 204 No Content.** A: no response body. The portal already knows it asked to sign out other sessions; no session count needed to satisfy the ticket's acceptance criteria.

## 6. Impact

- No migration: `passwordChangedAt`, `failedSignIns`, `lockedUntil` already exist on `User` (used today by setup-link redeem and sign-in).
- No Flutter change here (MUT-238 is the separate iPhone ticket, blocked by this one).
- `ALLOWED_APPLINKS_PATHS`/app-links: unaffected, this is a `/v1` API route, not a portal page the phone would deep-link into.
- Audit log gains one more `user.*` USER-actor event (`user.password_changed`, distinct from `user.password_set` which MUT-235/236 reserved for the setup-link path — an investigation should be able to tell "operator-issued link redeemed" from "person changed it themselves" apart).

## 7. Tech debt

- None introduced. TD-146/147 (setup-link pruning, operator visibility into "has this person set a password") are pre-existing and out of scope here.

## 8. Files

New: `src/hosted/shell/AccountDrawers.tsx`, `src/hosted/components/ChangePasswordDrawer.tsx` + its test, `server/src/repositories/__tests__/store-contract-change-password.ts` + `store-memory-change-password.test.ts` + `store-prisma-change-password.test.ts` (the same three-file contract-test trio MUT-235 used for `accountSetup`), `qa/features/portal/account.yaml`, `qa/specs/portal/account.spec.ts`.

Touched: `server/src/routes/sessions.ts`, `server/src/repositories/{ports,memory,prisma}.ts`, `server/src/auth/store-guard.ts`, `server/src/schemas.ts`, `server/src/errors.ts` (new `CURRENT_PASSWORD_WRONG` code), `server/src/app.ts` (`API_VERSION`), `server/src/__tests__/{routes-sessions,route-security,routes-m2,routes-m3,routes-m4,routes-m5,routes-m6,routes-m8}.test.ts`, `server/openapi/openapi.yaml`, `.claude/DECISIONS.md` (ADR-037 override note), `src/hosted/shell/{UserMenu,HostedShell}.tsx`, `src/hosted/data/{filters.ts,__tests__/filters.test.ts}`, `src/hosted/api/{client.ts,schema.d.ts}`, `src/hosted/i18n/{en,ar}.json`, `.claude/{CHANGELOG,SYSTEM_OVERVIEW,COMPONENT_REGISTRY,PATTERNS,TEST_PLAN}.md`.

## 9. QA scenarios (release-qa → `qa/features/portal/account.yaml`)

1. **change-password** (secondary) — Open the account menu → Change password → enter the current password and a new one (12+ chars) → submit → drawer closes, toast confirms, still signed in.
2. **wrong-current-password** (secondary) — Enter a wrong current password → inline refusal, drawer stays open, nothing changed.
3. **password-rule** (secondary) — Enter a valid current password and a new one under 12 characters → inline field error, nothing sent.

(The fourth scenario sketched during planning — a second browser session losing access after the change — is proven instead at the server/store layer, where it's the authoritative place to test real session-revocation state: `store-contract-change-password.ts` and `routes-sessions.test.ts`'s "revokes every other session" test.)

## 10. Implementation tasks — all shipped

- [x] **T1** — server — `ChangePasswordRequestSchema`, `users.changePassword` port method (ports/memory/prisma), store-guard entry, OpenAPI bump. Commit `6996391`.
- [x] **T2** — server — `POST /v1/me/password` route in `sessions.ts`, `ORGANIZATION_INDEPENDENT_ROUTES` entry, no-password-in-logs test. Commit `1c9fe00`.
- [x] **T3** — portal — `ChangePasswordDrawer.tsx`, `AccountDrawers.tsx` + `filters.ts` wiring, `HostedShell.tsx`/`UserMenu.tsx` entry, i18n EN/AR. Commit `6f43566`.
- [x] **T4** — release-QA — `qa/features/portal/account.yaml` + spec, run green on the in-place env, `release-qa lint`. Commit `1bf9a9f`.
- [x] **T5** — docs — ADR-037 override note, knowledge files. Commit `b122369`.
- [x] **qa-reconcile fix** — the dropped show/hide toggle, restored. Commit `3b59e1f`.

## Business / product impact

Closes the last gap in the hosted-user auth story (epic MUT-34): every other write to "who can get into this account" already goes through the person themselves (MUT-235/236) or the operator (`/admin`) — password change was the one thing still requiring Basel's manual intervention via a fresh setup link. Unblocks MUT-238 (the iPhone Settings screen), which is the last piece before the phone app and portal have matching account-management surfaces. Low build cost (every primitive it needs already exists, per §2) for a trust signal paying hosted customers expect as table stakes.
