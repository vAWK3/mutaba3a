# MUT-183: Hosted portal — profile management (new, rename, currency, type) (design brief)

- **Status:** plan, awaiting approval (`/eng-ticket`, 2026-10-14).
- **Epic:** MUT-181 (Users create and manage their own hosted profiles).
- **Blocker:** MUT-182 (the API) is merged to local main at `86c3539` and is In Review in Jira. Its contract is live in `src/hosted/api/schema.d.ts` (API `1.22.0-mut182`). Main has since moved to `184d454` (MUT-194, conversion edit/delete), and this plan was re-checked against it.
- **Branch:** `feature/mut-183-portal-profile-management`, in the worktree `.claude/worktrees/mut-183-portal-profile-management`. The worktree is fresh from main, one ticket per worktree.
- **Builds on:** hosted-portal.md §7.1–7.3, MUT-44 (drawer, error mapping), MUT-133 (attempt keys, D5), MUT-91 (after-save feedback), ADR-037 + MUT-182 amendment.
- **Consumed by:** MUT-191 C1 ("a note after a Business profile is created"). This ticket keeps the create success path to one function, `onCreated`, and does not build C1.
- **Server:** untouched. This is a portal-only ticket.

## 1. Acceptance criteria → tests

| # | AC (ticket) | Tests (§5) |
|---|---|---|
| A1 | ProfileSwitcher gets "+ New profile" and "Manage profiles" | SW1–SW4 |
| A2 | Create drawer: name, type, currency, timezone (browser-prefilled); disabled with an explanation at 6/6 | CR1–CR7, RU1 |
| A3 | Manage view lists every profile; owned ones get rename, currency and type; firm and Malafat-fed ones are read-only with the reason | MG1–MG5, RU2–RU4 |
| A4 | A type change confirms "N expenses will become uncategorized" using the server preview count; categories are refetched afterwards | TC1–TC6 |
| A5 | Drawer-first: there is no create page | CR1, route inventory (RT1) |
| A6 | en + ar copy, RTL | i18n parity test, RTL render (MG6) |
| A7 | Attempt-scoped Idempotency-Key (`useAttemptKey`) | CR4, CR5 |
| A8 | Error states for 409 `PROFILE_LIMIT`, 403 and offline | ER1–ER8 |
| A9 | The empty-state copy is updated | EM1, EM2 |

## 2. Solution

```
HostedShell
├─ ProfileSwitcher            (+ separator, "+ New profile", "Manage profiles")
├─ …nav, UserMenu, page
└─ ProfileDrawers             (URL: ?newProfile=1 | ?manageProfiles=1 | ?editProfile=<id>; ADR-008)
    ├─ ProfileCreateDrawer    POST /v1/profiles      (tab-lifetime create attempt → Idempotency-Key, R6)
    └─ ProfilesManageDrawer   list → edit pane       (one drawer, "All profiles" back link)
         └─ ProfileEditForm   PATCH /v1/profiles/{id} (If-Match = version captured at open)
              └─ TypeChangeConfirm (inline step)  GET /v1/profiles/{id}/type-change?to=
```

### 2.1 Where the drawer state lives (decision)

**In the URL, per ADR-008** (eng review R1 = A, D2). The keys are:
- `?newProfile=1` opens the create drawer.
- `?manageProfiles=1` opens the manage list.
- `?editProfile=<id>` opens the edit pane.

`ProfileDrawers` in `HostedShell` reads them with `useSearch({ strict: false })` and opens or closes with `navigate({ to: '.', search: (prev) => ({ ...prev, newProfile: '1' }) })`. Closing removes the key. Because the state is in the URL, Back closes the drawer, a reload keeps it, and `/?newProfile=1` works as a link.

**The leak this has to stop** (live probe, 2026-10-14): TanStack merges every raw query key into each route match's `search`. Pages pass that search on whole:
- `queries.ts:95/110/123` key the receivables, payments and attachments lists on the whole `filters` object, so a stray key reloads the list.
- `filters.ts:205` `isNarrowed` counts every key, so the list would show the "no matches for these filters" empty state.

**The fix:** one helper, `omitShellOverlay(search)`, in `data/filters.ts` next to `splitIncomeDrawer`. `router.tsx` applies it at all 8 page routes (`overviewRoute.useSearch()` → `omitShellOverlay(overviewRoute.useSearch())`), so no page sees the shell's keys. The same helper keeps `useReplaceSearch` from carrying them, and the drawer is closed anyway when a filter changes. This is the MUT-44 e0ed4fd lesson (DECISIONS.md:1847) applied at the shell level.

### 2.2 Switcher (A1)

`ProfileSwitcher.tsx` keeps its `role="menu"`. After the profile radios it adds a `role="separator"`, then two `menuitem`s:
- **"+ New profile"**. At the cap, `canCreateProfile(me)` is false. The item then gets `aria-disabled="true"` and stays focusable. Its sub-line reads "Your profiles: {owned} of {max}" (Issue 11 wording), from `limits`. Activating it does nothing.
- **"Manage profiles"** is always enabled.

Both items close the popover, then call `open(...)`.

The sub-line under each profile is also corrected. Today every non-Malafat profile says "Expenses only", which is false for an owned profile, because owned profiles take income since MUT-182. The new rule, `profileKindKey(profile)`:
- Malafat-fed: "Income recorded by Malafat"
- the built-in profile (`isPersonalDefault`): "Your built-in profile" / "ملفك الأساسي" (design review Issue 4 = A)
- other owned PERSONAL: "Personal"
- owned BUSINESS: "Business"
- operator firm (writer null, not owned): "Expenses only", unchanged

The Manage list uses the same helper, so the two never disagree.

### 2.3 Create drawer (A2, A7)

Fields:
- **Name:** required, trimmed, 1–80 characters (the server's rule).
- **Type:** **radio cards** (design review Issue 7 = A). These are two native `<input type="radio">` in a `role="radiogroup"`, styled as bordered `hp-type-card`s:
  - **Selected:** a `primary-hover` border on a lavender tint.
  - **Layout:** two side by side on desktop, stacked under 760px.
  - **Card text:** each card carries its label plus the first three category names of its preset, from i18n rather than the server: Personal "Groceries, rent, car, health…", Business "Office rent, software, travel, taxes…".
  - **Not `SegmentedControl`:** it requires a `value`, so it can't start empty.
  
  The type field has **nothing preselected**. It is required (R5 = A, D7). Under it, a hint: "Picks the starting expense categories. Changing it later replaces them." Saving without a type shows "Choose Personal or Business".
- **Currency:** `HOSTED_CURRENCIES` (USD, ILS, EUR, JOD; R4). It defaults to the active profile's `defaultCurrency`, or ILS when there is none. A hint says it only applies to new records.
- **Timezone** (design review Issue 10 = A):
  - It shows as a quiet fact row: "Time zone: {zone} (this browser) · Change", with the hint "It can't be changed later." (MUT-181 decision 4).
  - **Change** reveals the native `Select` of `timezoneOptions()` in place, prefilled with `browserTimezone()`, and moves focus to it.
  - A 422 on `timezone` auto-reveals the select and shows the inline error.

Submit:
1. `body → attempt.keyFor(body)`, then `api.createProfile(body, key)`. `attempt` comes from `useProfileCreateAttempt()`: one `AttemptKey` per tab, not per mount (R6 = A, D4). Closing the drawer mid-request (Cancel, Escape or browser Back) and saving the same body again replays the first 201 instead of creating a twin.
2. On 201, `attempt.succeeded()`, then `queryClient.setQueryData(ME_KEY, …)` (R2 = A, D3):
   - Append the returned `HostedProfile` unless its id is already there; an idempotent replay returns the same profile.
   - Set `limits.ownedProfiles + 1` only when it appended.
3. Close, then `navigate('/p/<new.id>')` to its Overview at once.
4. Then `invalidateQueries({queryKey: ME_KEY})` in the background, so the server's order replaces the appended one.

A failed background refetch can no longer strand the user on "This profile isn't available". Section-keeping, as the switcher does, is skipped: a brand-new profile has nothing in any section.

At the cap, the drawer may be opened with the cap already reached, for example from a stale `me` while the user created one on the phone. It then shows the explanation with Save disabled. A 409 `PROFILE_LIMIT` from the server leads to the same state after a `me` refetch (ER1).

**After-save feedback:** a toast, "{name} is ready". The MUT-91 `savedFlashStore` doesn't fit here:
- It is a closed union, `'income' | 'payment' | 'expense' | 'conversion'` (`src/lib/savedFlashStore.ts:16`).
- It is shared with the local app, and it drives list-row highlighting.

A profile has no list row to flash, so the union is not widened. MUT-191 C1 (a note after a Business profile is created) adds its own hook when it is built. This ticket only makes sure the create success path is one function (`onCreated(profile)`) that MUT-191 can extend.

### 2.4 Manage drawer (A3)

**List pane.** It shows every `me.profiles` entry in `/v1/me` order (§2.6 of MUT-182). Row anatomy (design review Issue 1 = A; wireframe §3):
- **Line 1:** the name, on one line with an ellipsis and the full name in `title`. The active profile carries an "Open now" mint pill.
- **Line 2:** the `profileKindKey` line.
- **Trailing:** the currency, in Plex Mono.
- **Owned rows** are buttons with a chevron, which flips in RTL.
- **Firm and Malafat rows** are plain rows with `LockIcon` plus the reason on line 2.
- Rows are at least 56px tall. The counter under the title reads "Your profiles: {owned} of {max}" / "ملفاتك: {owned} من {max}", from `me.limits` (design review Issue 3 = A, worded per Issue 11). Firm and Malafat rows never count toward it, so it can differ from the row count on purpose. It is always shown, beside a "+ New profile" button that follows the same disabled rule.
- Editable rows (`owned`) are buttons that open the edit pane.
- Read-only rows are plain rows with a reason line:
  - `writerOfRecord === 'MALAFAT'`: "Managed in Malafat. Change it there."
  - Otherwise: "Set up for you by your account administrator."

**Edit pane** (`ProfileEditForm`). The order follows design review Issue 2 = A (wireframe §3):
1. The back link.
2. Name.
3. Currency, with the hint "Only new records use it. Existing ones keep their currency."
4. The time zone, as a read-only fact row.
5. A divider, then a **"Profile type"** group: the type cards and "Changing it replaces this profile's expense categories." On the built-in Personal profile, this group holds the lock line instead. The pane snapshots `profile.version` when it opens, and that snapshot is the If-Match value. VERSION_MISMATCH's "Reload" re-snapshots in its click handler (`form.reset(fresh)`), never in a `useEffect`, per the react-hooks v7 set-state-in-effect rule. `?editProfile=<id>` for an id that isn't in `me`, or isn't owned, falls back to the list pane (RT5). It never re-reads the version at save time; that is MUT-196's lost-update bug. The type control is hidden on `isPersonalDefault`; instead a line says "Your built-in Personal profile is always Personal" (MUT-182 D2/R1, server 409 `DEFAULT_PERSONAL_PROFILE`).

Save:
- **Type unchanged:** `PATCH {name?, defaultCurrency?}` with only the changed fields. With no changes, Save stays disabled; the server answers 422 to an empty body.
- **Type changed:** switch to the **inline confirm step** (§2.5) first. On confirm, send one `PATCH {…changed, type}`. A single write keeps it atomic on the server.
- **Success:** `invalidateQueries(ME_KEY)`, then back to the list pane.
  - A rename or currency change, or a type change that affected 0 expenses: a toast, "Profile saved".
  - A type change that left N > 0 expenses uncategorized: an **info banner at the top of the Manage list** (design review Issue 6 = A), "Now Business. Uncategorized expenses: 12" (Issue 11 wording) with the link **"Open Expenses"** → `/p/<id>/expenses`, which closes the drawer. N comes from `typeChange.uncategorizedExpenses` in the response, not the preview. The banner stays until the drawer closes.

### 2.5 Type change confirm (A4)

No `window.confirm`: the confirm is a step inside the drawer.
1. On Save with a changed type, call `api.profileTypeChangePreview(id, to)`. It is a plain `queryClient.fetchQuery` with `staleTime: 0`, so the count is fresh at the moment of asking.
2. Render: "Switching to Business replaces this profile's expense categories with the Business set." Then **"Expenses that will become uncategorized: N"** / "المصاريف التي ستصبح بلا تصنيف: N", worded per Issue 11 so the number never sits beside a plural noun. With N = 0, the second line becomes "No expenses use a category yet." Buttons: "Back" (secondary) and "Switch to Business" (`Button variant="danger"`, as the expense and conversion deletes use).

   **Look** (design review Issue 8 = A; wireframe §4): an `hp-confirm` panel with a 1px rose border, a 25% rose tint and `radius-md`. The heading "Switch to Business?" is Serif Display and is the focus target. Then the one-line consequence, then the count in bold Plex Mono.
3. On confirm, PATCH. On success, `invalidateQueries({queryKey: ['p', id]})`, the whole profile prefix: categories, expense lists and detail, and summaries all change. Then `ME_KEY`.

If the preview fails, the confirm doesn't render and an error shows (ER5). The UI never claims a count it doesn't have.

**Counts and plurals (design review Issue 11 = A).** Until MUT-179's `tp()` lands, no count sits next to a noun that would need a plural form; the number follows a colon or parentheses. When MUT-179 ships, these keys move to `tp()`.

### 2.5b Journey storyboard (design review Pass 3)

| Step | User does | User feels | Plan specifies |
|---|---|---|---|
| 1 | Opens the switcher and sees "+ New profile" | relief: "I can do this myself" | §2.2 |
| 2 | Names it and picks a type from the seed hints | confident, informed | §2.3 (D7, Issue 7) |
| 3 | Creates it and lands on the new Overview | "it worked" | R2, toast "{name} is ready" |
| 4 | Later renames it or changes the currency | routine, low stakes | Issue 2 (routine fields first) |
| 5 | Changes the type and sees "12 expenses…" | cautious, then informed | §2.5 |
| 6 | Wants to re-file the 12 expenses | "now what?", answered | Issue 6 banner + "Open Expenses" |
| 7 | Hits the cap | blocked, but told why | the cap banner; freeing a slot is MUT-193 |

### 2.6 Empty state (A9)

`NoProfiles` (AuthGate.tsx) and `NoProfilesBody` get the new copy:
- Title: "You don't have a profile yet".
- Body: "Create one to start recording income and expenses."
- A primary "+ New profile" button opens the create drawer through the shell provider, with Sign out kept as secondary.

`NoProfilesBody` (the S12 fallback inside `ProfileUnavailable`) gets the same button. The old "Ask the person who set up your account…" line is removed.

### 2.7 Errors (A8): `profileApiErrors.ts`

The mapping follows the shape of `expenseApiErrors.ts`. Reasons come from `details.reason`.

| Response | Where | Behaviour |
|---|---|---|
| 409 CONFLICT `PROFILE_LIMIT` | create | Top info banner "You've reached your profile limit ({max})." / "وصلت إلى الحد الأقصى للملفات ({max})." (Issue 11 wording); Save disabled; refetch `me` |
| 409 VERSION_MISMATCH | edit | Inline "This profile was changed elsewhere." + "Reload" re-snapshots from refetched `me`; the user's edits are not silently overwritten |
| 409 CONFLICT `DEFAULT_PERSONAL_PROFILE` | edit | Defensive (UI hides the control): inline message, refetch `me` |
| 403 READ_ONLY_PROFILE `NOT_OWNER` | edit / preview | "You can't change this profile." Refetch `me` (ownership changed); the pane returns to the list, where the row is now read-only |
| 404 NOT_FOUND | edit / preview | "This profile is no longer on your account." Refetch `me`, back to the list |
| 422 VALIDATION_FAILED `{field}` | both | Inline on `name` / `timezone` / `defaultCurrency`; else generic |
| NETWORK (offline) | all | Top-of-drawer error banner (Issue 5): "Can't reach Mutaba3a. Nothing was saved. Try again." The drawer stays open with values kept. Retry reuses the attempt key, so a create that landed replays instead of duplicating |
| other | all | Generic error in the same top-of-drawer banner (Issue 5), not a toast |

**Where these appear (design review Issue 5 = A):**
- **Pending labels:** buttons disable and change their text while waiting:
  - "Creating…" / "جارٍ الإنشاء…" on create
  - "Saving…" (`common.saving`) on edit
  - "Checking…" / "جارٍ التحقق…" while the type-change preview loads
- **Banner slot:** each drawer has one at the top of its body.
  - `PROFILE_LIMIT` uses `hp-banner-info` and disables Save.
  - NETWORK, VERSION_MISMATCH, NOT_OWNER, NOT_FOUND and DEFAULT_PERSONAL_PROFILE use `hp-banner-error` with `role="alert"`. The values stay, and Save stays enabled so the user can retry.
  - A banner persists until the next submit or until it is resolved. These states use no toasts.
- **Toasts** are kept only for success.

"Offline" is the existing `ApiError` code `NETWORK`, with no `navigator.onLine` polling.

**Interaction states** (design review Pass 2; wireframe `.claude/designs/mut-183-portal-profiles-wireframe.html`):

| Feature | Loading | Empty | Error | Success | Partial / limit |
|---|---|---|---|---|---|
| Switcher entries | none (reads `me`) | no profiles: switcher hidden; the empty state carries "+ New profile" | n/a | n/a | at cap: "+ New profile" is aria-disabled with "Your profiles: N of N" |
| Create drawer | "Creating…", Save disabled | fresh form, no type chosen | top banner (offline / validation inline) | close, land on the new profile, toast "{name} is ready" | at cap: info banner, Save disabled |
| Manage list | none (reads `me`) | zero profiles: never reached; the empty state owns it | n/a | n/a | the counter "Your profiles: N of M" |
| Edit pane | "Saving…" | n/a | top banner (conflict with Reload, 403, 404, offline) | back to list, toast "Profile saved" | no changes: Save disabled |
| Type-change confirm | "Checking…" on Save while the preview loads | count 0: "No expenses use a category yet." | preview failed: banner, no confirm, no count | N > 0: Manage list banner with the count and "Open Expenses"; N = 0: toast | n/a | The portal has none today and stores nothing locally (hosted-portal.md §8).

## 3. Files

**New** (all under `src/hosted/`):
- `data/profileRules.ts`: pure functions:
  - `canCreateProfile(me)`
  - `profileEditability(profile)` → `{editable: false, reason: 'MALAFAT' | 'FIRM'} | {editable: true, typeLocked: boolean}`
  - `profileKindKey(profile)`
  - `changedFields(profile, values)`
- `data/profileQueries.ts`:
  - `useCreateProfile()`
  - `useProfileCreateAttempt()`: the module-scope `createAttemptKey()` for creation (R6)
  - `useUpdateProfile(id)`
  - `fetchTypeChangePreview(queryClient, id, to)`
  - the invalidation helpers (`ME_KEY`, `['p', id]`)
- `format/timezones.ts`:
  - `browserTimezone()`, which falls back to `'UTC'`
  - `timezoneOptions(selected)`: `Intl.supportedValuesOf('timeZone')` where available, always including `selected` (some engines omit `UTC` / legacy aliases), else `[selected]`. The roughly 420-entry list is computed once per module (lazy constant), not on every render (eng review Section 4).
- `format/currencies.ts`: `HOSTED_CURRENCIES = ['USD','ILS','EUR','JOD'] as const satisfies readonly Currency[]`, in ExpenseDrawer's existing order, plus a compile-time exhaustiveness check against `Currency` (R4 = A, D6).
- `components/profileFormSchema.ts`: zod for create and edit.
- `components/profileApiErrors.ts`
- `components/ProfileCreateDrawer.tsx`
- `components/ProfilesManageDrawer.tsx`: the list pane, plus the edit pane routing.
- `components/ProfileEditForm.tsx`: includes the inline `TypeChangeConfirm`.
- `shell/ProfileDrawers.tsx`: `useProfileDrawers()` (reads and writes the URL keys) and the renderer.

**Touched:**
- `api/client.ts`: `createProfile`, `updateProfile`, `profileTypeChangePreview`, and the type aliases `CreateProfileRequest`, `UpdateProfileRequest`, `ProfileTypeChange`, `ProfileType`.
- `shell/ProfileSwitcher.tsx`: the two entries and `profileKindKey`.
- `shell/HostedShell.tsx`: mounts `<ProfileDrawers />`. The switcher stays hidden with zero profiles; the empty state carries its own button (§2.6).
- `data/filters.ts`: `SHELL_OVERLAY_KEYS` and `omitShellOverlay(search)` (R1).
- `router.tsx`: the 8 page routes pass `omitShellOverlay(route.useSearch())` (R1).
- `session/AuthGate.tsx`: the empty-state button and copy.
- `components/ExpenseDrawer.tsx`: import `HOSTED_CURRENCIES` and drop its local `CURRENCY_OPTIONS` (R4). The order is unchanged, and `ExpenseDrawer.test.tsx` passes unmodified as the regression proof.
- `components/conversionFormSchema.ts` and `ConversionDrawer.tsx`: use `HOSTED_CURRENCIES` instead of their own identical list (R4 reopened, D10). `conversionFormSchema.test.ts` and `ConversionDrawer.test.tsx` pass unmodified.
- `i18n/en.json`, `i18n/ar.json`:
  - `hosted.profiles.*` (new)
  - `hosted.shell.switcher.{newProfile, manage, capReached, kindPersonal, kindBusiness}`
  - `hosted.auth.noProfiles.*` (rewritten)
- `src/index.css`: `.drawer` width capped at `100vw` (Issue 9; shared by both apps).
- `hosted.css`: the list rows, the disabled menu item, the confirm step `hp-type-card` (Issue 7) and `hp-confirm` (Issue 8). Logical properties only (`margin-inline-*`, `inset-inline-*`) for RTL.

**Uses, does not fork:**
- `Drawer` (DrawerFrame)
- `Button`
- `Select` from `components/ui/Input` (never the ui barrel; see the select-migration memory)
- `useToast`
- `createAttemptKey` / `AttemptKey` (creation, R6) and `useAttemptKey` (not used: PATCH is If-Match, not idempotency-keyed)
- `profileKey`, `ME_KEY`
- `usePopover`

The `reasonOf` helper is duplicated three times (expense, income and conversion errors), and this ticket would add a fourth. The build extracts `apiErrorReason(error)` into `api/client.ts` and points all four at it (R3 = A, D5). The existing mapper tests pass unmodified as the regression proof.

**Also touched (R3):** `components/expenseApiErrors.ts`, `components/incomeApiErrors.ts` and `components/conversionApiErrors.ts` (import only).

## 4. Scalability, cost and constraints

- **Reads.** Opening Manage costs nothing: it reads `me`, which is already cached for 60 s. The only extra call is the preview, made once per Save with a changed type. A create costs one POST plus one `me` refetch; an edit costs one PATCH plus one `me` refetch. A type change also refetches whatever `['p', id]` queries are mounted, which is at most the current page's list.
- **No server change, no new environment variables, no infrastructure.** The cap is read from `me.limits.maxOwnedProfiles`, never hard-coded as 6 in the portal. The copy interpolates it.
- **i18n/RTL.** Every string goes through `t()` in the portal dictionaries, and the parity test enforces en/ar. **The copy deck is `.claude/designs/mut-183-portal-profiles-wireframe.html`** (design review Issue 12 = A). Its en/ar strings are built as written, and the builder may only fix typos. Business is أعمال and Personal is شخصي. Names render with `dir="auto"`. Counts use `{count}`; the plural forms wait for MUT-179's `tp()`, and the build uses the portal's existing count phrasing.
- **Accessibility:**
  - Menu items stay operable by keyboard.
  - The disabled item uses `aria-disabled` plus visible text, not `disabled`, so screen readers still announce why.
  - The confirm step moves focus to its heading.
  - "Back" returns focus to the Save button.
- **Phone** (design review Issue 9 = A):
  - The shared `.drawer` (`src/index.css:2312`, `width: var(--drawer-width)` = 480px, no cap) becomes `width: min(var(--drawer-width), 100vw)`. Every drawer in both apps currently overflows a 375px screen by 105px; this one rule fixes them all.
  - `hp-type-card`s stack under 760px.
  - Drawer footer buttons are at least 44px tall under `pointer: coarse`.
  - Verify at 375px, in en and ar, on a portal drawer and on one local-app drawer.
- **Landing order (MUT-182 R-4):** a user who creates a Business profile now lands on it at `/` instead of Personal. MUT-182 left a "last opened" override to MUT-183 as optional. **It is out of scope here**, because no AC asks for it; see §7.

## 5. Tests (TDD, written first). Run: `npx vitest run src/hosted`

**Pure** (`data/__tests__/profileRules.test.ts`, `format/__tests__/timezones.test.ts`, `components/__tests__/profileFormSchema.test.ts`, `components/__tests__/profileApiErrors.test.ts`):
- RU1: `canCreateProfile` is false at owned = max and true below. The fixtures use `maxOwnedProfiles: 3`, so a hard-coded 6 fails.
- RU2: `profileEditability`:
  - Malafat-fed ⇒ MALAFAT
  - writer-null unowned firm ⇒ FIRM
  - owned ⇒ editable
  - `isPersonalDefault` ⇒ `typeLocked`
- RU3: `profileKindKey` for all five kinds: Malafat, operator firm, built-in, owned Personal, owned Business.
- RU4: `changedFields` sends only the diff and returns empty when nothing changed.
- TZ1: The browser zone is prefilled. A zone missing from `supportedValuesOf` is still offered. Without `supportedValuesOf`, the list falls back to `[zone]`.
- FS1: The name is trimmed, empty is rejected, and 81 characters is rejected. The currency and type enums are enforced.
- FS2 (R5): A missing type is rejected with the "Choose Personal or Business" message.
- ER1–ER8: one case per row of §2.7.
- AR1 (R3): `apiErrorReason` returns the string reason, and `undefined` for a missing reason, a non-string reason or null details. Its regression contract: the existing `expenseApiErrors.test.ts`, `incomeApiErrors.test.ts` and conversion drawer tests pass **unmodified**.

**Drawers and shell** (`components/__tests__/ProfileCreateDrawer.test.tsx`, `ProfilesManageDrawer.test.tsx`, plus a `Profile switcher` block in `pages/__tests__/views.test.tsx`; all on the real router harness with a `fetch` stub):
- SW1: The menu shows both entries after the profiles, behind a separator.
- SW2: At 6/6, "+ New profile" is `aria-disabled`, shows "6 of 6", and activating it opens nothing.
- SW3: "Manage profiles" opens the manage drawer and closes the popover.
- SW4: Owned profiles show Personal/Business, and a writer-null firm still shows "Expenses only".
- CR1: The create drawer opens over the current page. The URL path and search are unchanged, so it is not a page.
- CR2: The timezone is prefilled from a stubbed `Intl` zone. The currency defaults to the active profile's.
- CR2b (Issue 10): The zone shows as a fact row with no select. Change reveals the select and focuses it. A 422 `{field: 'timezone'}` auto-reveals it with the error.
- CR3: Submit POSTs the exact body. On 201, the app is on `/p/<new>` with the new name in the switcher, and `/v1/me` is refetched in the background.
- CR3b (R2): With `/v1/me` failing after the 201, the user still lands on the new profile's Overview, not "This profile isn't available". A replayed 201 for an id already in `me` doesn't duplicate it or double-count `limits`.
- CR4: Retry after NETWORK sends the **same** Idempotency-Key.
- CR5: An edited body after a failure sends a **new** key.
- CR4b (R6): POST in flight → Cancel → reopen → same body → the second POST carries the **same** Idempotency-Key. After a 201, the next create gets a new key.
- CR6: A 409 PROFILE_LIMIT shows the cap banner and disables Save.
- CR7: A deep state already at the cap opens with Save disabled and the explanation shown.
- CR9: Double-clicking Save sends exactly one POST, because Save is disabled while pending.
- CR8 (R5): The type radio starts with nothing selected. Save without a type shows "Choose Personal or Business" and sends no POST.
- MG1: All profiles are listed in `me` order.
- MG2: Malafat and firm rows aren't buttons and show their reasons.
- MG3: Rename PATCHes `{name}` only, with `If-Match: <version at open>`.
- MG4: A `me` refetch that bumps the version mid-edit still sends the **opened** version (the MUT-196 regression guard). A 409 VERSION_MISMATCH then shows the conflict and Reload.
- MG5: On the built-in Personal profile there is no type control, and the locked line is shown.
- MG6: In `ar`, the drawer has `dir="rtl"` and the Arabic strings render.
- MG7: A PATCH answering 403 `NOT_OWNER` refetches `me`. The pane returns to the list, where that row is now read-only with its reason.
- TC1: Changing the type and pressing Save GETs the preview with `?to=BUSINESS` and renders "12 expenses will become uncategorized".
- TC2: Back returns to the form with no PATCH sent.
- TC3: Confirm sends one PATCH with `type` and the other changed fields.
- TC4: After success, `['p', id, 'expense-categories']` is refetched (assert a second GET of `/v1/expense-categories`), and the list banner uses the **response** count.
- TC4b (Issue 6): With N > 0, the Manage list shows the banner, and "Open Expenses" lands on `/p/<id>/expenses` with the drawer closed. With N = 0, a "Profile saved" toast shows and there is no banner.
- TC5: Count 0 shows the zero copy.
- TC6: A preview failure shows no confirm and no count.
- TC7: Focus moves to the confirm step's heading when it opens. "Back" returns focus to Save (§4 accessibility).
- EM1 (R7, edits `auth-states.test.tsx:223` in place): renamed "offers New profile and Sign out". It **keeps** "no Sections nav" and "Sign out offered", **changes** the copy to "You don't have a profile yet", and **adds** that "+ New profile" opens `?newProfile=1` with the create drawer.
- EM1b (R7, edits `auth-states.test.tsx:373` in place): `/capture` with no profiles still renders the empty state, with no crash or 404. Its new copy and "+ New profile" open the create drawer.
- EM2: The S12 fallback (`ProfileUnavailable` with no profiles left) shows the same copy and button.
- RT1: The route inventory is unchanged: no `/profiles/new` route exists (snapshot of the route ids).
- RT2 (R1 regression, CRITICAL): on `/p/<id>/receivables`, opening "+ New profile" fires no second `GET /v1/receivables`, and the empty state stays the unfiltered one. Repeat for `/payments`.
- RT3: `omitShellOverlay` drops the three keys and keeps every other key (unit test in `filters.test.ts`).
- RT4: Back after opening the drawer closes it. A deep link to `/?newProfile=1` with zero profiles opens the create drawer over the empty state.
- RT5: `?editProfile=<id>` for an id that isn't in `me`, or isn't owned, renders the manage list pane, never an edit form.

**Gate** (Node 22, per TD-054):
```bash
npm run lint && npm run typecheck && npm run test:run && npm run build
```

The server is untouched, so the server gates are not needed. `hosted:types:check` is still run to confirm the schema is current.

**QA:** add a `qa/` catalog entry mapping `src/hosted/shell/**` and the new components to a portal "profiles" spec (create → lands on the new profile; type change confirm). It runs on a preview build, per the QA-on-preview memory.

## 6. Knowledge files at the end

- **CHANGELOG** gets an entry.
- **COMPONENT_REGISTRY** registers:
  - ProfileCreateDrawer
  - ProfilesManageDrawer / ProfileEditForm
  - ProfileDrawers
  - profileRules
  - timezones
  - HOSTED_CURRENCIES
  - apiErrorReason
- **PATTERNS:**
  - Shell-global drawers use URL keys stripped at the page boundary by `omitShellOverlay` (§2.1, ADR-008).
  - An edit form snapshots `version` at open.
- **DECISIONS:** an ADR-037 note: the portal now creates and edits owned profiles; the empty state no longer says "ask your operator".
- **TEST_PLAN:** the rows above.
- **TECH_DEBT:** TD-125 records its currency (`format/currencies.ts`) and `reasonOf` parts as resolved by MUT-183 (R3, R4). `fieldOf`, `parseIncomeAmount` and the picker ids stay open. Add new entries only if the build leaves something.
- **SYSTEM_OVERVIEW:** the portal capability line.

## 7. Out of scope, and gaps the plan revealed

- **Landing order (MUT-182 R-4).** After creating a Business profile, `/` opens it instead of Personal. There is no ticket. Offer: a small follow-up, "portal remembers the last opened profile", if Basel wants it.
- **Archive / delete** belongs to MUT-193. The cap copy doesn't promise a way to free a slot.
- **MUT-191 C1** gets a hook only (§2.3).
- **The Flutter equivalent** is MUT-184.

---

# Eng review (`/plan-eng-review`, 2026-10-14)

Target: this file, `.claude/designs/mut-183-portal-profile-management.md` (the MUT-183 plan). Report file: the same file.

## Scope record

- Feature answers: none proposed (no cuts).
- Structure: A "Original arrangement" (D1, answered 2026-10-14).
- Accepted scope: the plan as written, in the 10-new-file layout of §3.
- Pending remedies: R1, R2, R3, R4, R5, R6.
- Scope Challenge result: scope accepted as-is.

## Decision ledger

### R1: Where the shell-global profile drawers keep their open state
Finding: SC-1, P1, confidence 9/10, plan §2.1 vs `.claude/DECISIONS.md:246` ADR-008 "URL-Driven Drawer State" (Active); Claude review.
Plan baseline: §2.1 proposes shell-local React state with no URL. It is unapproved, and it contradicts ADR-008 without an override log.
Runtime evidence:
- Live probe (2026-10-14): `/p/<id>/receivables?status=OPEN&newProfile=1` puts `newProfile` in `match.search` for `__root__`, `/authed`, `/authed/p/$profileId` and `/authed/p/$profileId/receivables`. TanStack merges raw keys into every route's search.
- Two consumers break on that:
  - `src/hosted/data/queries.ts:95`: `profileKey(profileId, 'receivables', filters)` (also :110 payments, :123 attachments). The query key changes, and the list reloads behind the drawer.
  - `src/hosted/data/filters.ts:205`: `Object.entries(filters).some(([key, value]) => value !== undefined && …)`. The list reads as "filtered".
- Requests themselves send explicit params (`queries.ts:96-104`), so the server never sees the key.
- DECISIONS.md:1847 names this exact class of bug ("the MUT-44 e0ed4fd bug").

Comparison grid:

| Choice | Current | A | B |
|---|---|---|---|
| R1 drawer state | shell-local, unapproved, contradicts ADR-008 | URL keys `?newProfile=1`, `?manageProfiles=1`, `?editProfile=<id>`; one `omitShellOverlay(search)` helper strips them at the 8 page routes in `router.tsx`, so no list sees them; the shell reads them with `useSearch({ strict: false })` and opens/closes with `navigate({ search: prev => … })`; test: opening the drawer on Receivables fires no second list GET and keeps the unfiltered empty state | shell-local state; DECISIONS gets an ADR-008 override log for shell-global drawers in the portal; PATTERNS note; no deep link |
| R2 me cache after create | pending | pending | pending |
| R3 apiErrorReason extraction | pending | pending | pending |
| R4 HOSTED_CURRENCIES extraction | pending | pending | pending |
| R5 create type default | pending | pending | pending |
| R6 create attempt across remount | pending | pending | pending |

Question D2:
D2 — Should the profile drawers live in the URL like every other portal drawer?
Project/branch/task: MUT-183 plan on main; the profile drawers open from the switcher on every page and from the empty state.
ELI10: The project has a standing rule (ADR-008) that drawers are opened by the address bar, so a link can open them and Back closes them. My plan broke that rule for the profile drawers, because putting `?newProfile=1` in the address makes the Receivables and Payments lists reload and think they are filtered. I checked this with a live probe. We can keep the rule and fix the leak in one place, or break the rule on purpose and write it down.
Stakes if we pick wrong: Break the rule quietly and the next person to touch drawers trips over an undocumented exception. Keep the URL without the fix and lists flash and show a wrong empty state every time someone opens the drawer.
Recommendation: A because it honours ADR-008, and the same one-helper fix stops any stray URL key from leaking into list caches.
Completeness: A=9/10, B=7/10
Pros / cons:
A) URL keys + strip at the router (recommended)
  ✅ Follows ADR-008: Back closes the drawer and `/?newProfile=1` works as a link from the empty state, email or app
  ✅ A single `omitShellOverlay` helper in router.tsx also fixes the latent leak for any stray query key
  ❌ It touches all 8 page routes in router.tsx and needs a regression test that lists don't reload (human ~2h / CC ~15min)
B) Shell-local state + ADR-008 override log
  ✅ No router change at all, and the drawer state can never leak into any list's cache key
  ✅ A slightly smaller diff, confined to the shell and the new components (human ~1h / CC ~5min)
  ❌ Breaks a standing ADR (needs an override log), and there is no deep link, so a reload or Back loses the drawer
Net: A keeps the house rule for about 10 extra minutes of work; B is smaller but leaves a documented exception.
Header: Drawer state
Options:
A) URL keys + strip at router (recommended)
URL keys ?newProfile=1, ?manageProfiles=1, ?editProfile=<id>. One omitShellOverlay(search) helper strips them at the 8 page routes in router.tsx, so no list sees them. The shell reads them with useSearch({strict:false}). Test: opening on Receivables fires no second list GET and keeps the unfiltered empty state. (human ~2h / CC ~15min)
B) Shell-local state + ADR override
Shell-local React state, no URL. DECISIONS gets an ADR-008 override log for portal shell-global drawers, plus a PATTERNS note. No deep link; reload or Back closes the drawer. (human ~1h / CC ~5min)

State: approved
Actual answer: A "URL keys + strip at router (recommended)" (D2, answered 2026-10-14)
Accepted scope: URL keys `?newProfile=1`, `?manageProfiles=1`, `?editProfile=<id>`. An `omitShellOverlay(search)` helper strips them at the 8 page routes in `router.tsx`, so no list's filters, query key or `isNarrowed` sees them. The shell reads them with `useSearch({ strict: false })` and opens/closes with `navigate({ search: prev => … })`. Regression test RT2: opening the drawer on Receivables fires no second list GET and keeps the unfiltered empty state. ADR-008 is honoured, so no override log is needed. Plan §2.1, §3, §5 and §6 are amended.
History: none

### R2: How the new profile reaches the `me` cache before navigating
Finding: A-1, P2, confidence 8/10, `src/hosted/session/AuthGate.tsx:99-107` (`const profile = profiles.find(…); if (!profile) { … <ProfileUnavailable /> }`) with plan §2.3; Claude review.
Plan baseline: §2.3: on 201, `await queryClient.invalidateQueries({queryKey: ME_KEY})`, then navigate to `/p/<new.id>`. Unapproved.
Runtime evidence: TanStack Query v5 `invalidateQueries` resolves without throwing when the refetch fails (default `throwOnError: false`). It is unverified in this repo, so it is treated as likely. A failed refetch leaves `me` without the new profile, and `ProfileLayout` renders "This profile isn't available. It may have been removed." A retry would create a duplicate that permanently uses one of the 6 slots (TODOS #13, MUT-193 unbuilt).
Comparison grid:

| Choice | Current | A | B |
|---|---|---|---|
| R1 drawer state | approved A (D2) | approved A (D2) | approved A (D2) |
| R2 me cache after create | await refetch, then navigate | `setQueryData(ME_KEY)`: append the 201 `HostedProfile` and set `limits.ownedProfiles + 1`, navigate at once, then `invalidateQueries(ME_KEY)` in the background to pick up the server's order; test CR3b: with the `/v1/me` refetch failing, the user lands on the new profile, not "isn't available" | keep the awaited refetch; if `me` still lacks the profile afterwards, stay in the drawer with "Created. Reload to open it." and no navigation; test CR3b asserts that message |
| R3–R6 | pending | pending | pending |

Question D3:
D3 — After creating a profile, put it in the cache ourselves or wait for the server's list?
Project/branch/task: MUT-183 plan on main; the create drawer opens the new profile right after a successful save.
ELI10: After the server says "created", the portal needs the new profile in its list of profiles before it can open it. The plan re-downloads the whole list and then opens the profile. If that re-download fails, the user lands on "This profile isn't available, it may have been removed" for a profile they just made. They will likely make it again, and the duplicate eats one of their 6 slots for good, because there is no archive yet.
Stakes if we pick wrong: A user who loses a slot to a phantom duplicate can only get it back by an operator editing the database.
Recommendation: A because the server already returned the exact profile object, so writing it into the cache removes the failure instead of explaining it.
Completeness: A=9/10, B=7/10
Pros / cons:
A) Write the 201 into the cache (recommended)
  ✅ The user always lands on the profile they just created, even if the follow-up refresh fails
  ✅ Saves a round-trip, so the drawer closes instantly; the background refresh still fixes the order
  ❌ For a moment the list order is the client's (new profile appended) until the background refresh lands (human ~1h / CC ~10min)
B) Wait for the refresh, then explain on failure
  ✅ The cache only ever holds the server's own list, never a client-built copy
  ✅ Failure is explained in place instead of on a misleading page (human ~1h / CC ~10min)
  ❌ The user still can't open the profile they made until they reload, which is a dead end at the best moment
Net: same effort; A removes the failure, B only labels it.
Header: Me after create
Options:
A) Write 201 into me cache (recommended)
setQueryData(ME_KEY): append the returned HostedProfile and bump limits.ownedProfiles, navigate to /p/<new> at once, then invalidate ME_KEY in the background. Test CR3b: with the /v1/me refetch failing, the user still lands on the new profile. (human ~1h / CC ~10min)
B) Await refresh, explain on failure
Keep the awaited me refetch. If me still lacks the profile, stay in the drawer with "Created. Reload to open it." and don't navigate. Test CR3b asserts that message. (human ~1h / CC ~10min)

State: approved
Actual answer: A "Write 201 into me cache (recommended)" (D3, answered 2026-10-14)
Accepted scope: On 201, `setQueryData(ME_KEY)` appends the returned `HostedProfile`, skipping it if the id is already present (an idempotent replay returns the same profile), and sets `limits.ownedProfiles + 1` only when it appended. Then navigate to `/p/<new>` at once, then `invalidateQueries(ME_KEY)` in the background. Test CR3b: with the `/v1/me` refetch failing, the user lands on the new profile. Plan §2.3 and §5 are amended.
History: none

### R6: Does a create attempt survive the drawer closing mid-request?
Finding: A-2, P2, confidence 8/10, `src/hosted/data/attemptKey.ts:42-45` (`/** The attempt for one mounted drawer; a remounted drawer starts a new one. */ export function useAttemptKey(): AttemptKey { const [attempt] = useState(createAttemptKey);`) with plan §2.3 and R1 = A (URL drawers, so Back unmounts them); Claude review.
Plan baseline: §2.3 uses `useAttemptKey()` inside `ProfileCreateDrawer`. Unapproved.
Runtime evidence: the key lives in the drawer's `useState`. Back or Cancel while a slow POST is in flight unmounts it. Reopening and saving the same body mints a new key, so the server creates a second profile. Each duplicate permanently uses a slot of 6 (TODOS #13; MUT-193 is unbuilt). The browser's Back can't be blocked, because the drawer is URL-driven (R1).
Comparison grid:

| Choice | Current | A | B | C |
|---|---|---|---|---|
| R1 drawer state | approved A (D2) | approved A (D2) | approved A (D2) | approved A (D2) |
| R2 me after create | approved A (D3) | approved A (D3) | approved A (D3) | approved A (D3) |
| R6 create attempt across remount | per-mount `useAttemptKey()` | one tab-lifetime `AttemptKey` for profile creation in `profileQueries.ts` (`createAttemptKey()` at module scope, exposed as `useProfileCreateAttempt()`): reopen + same body ⇒ same key ⇒ server replays the first 201; a changed body or a success starts a new attempt; a full page reload still starts fresh. Test CR4b: POST in flight → close → reopen → same body → same Idempotency-Key | per-mount key, and Cancel/close/Escape are disabled while the POST is pending; browser Back still unmounts it, so the gap stays for Back. Test CR4b: Cancel disabled while pending | keep per-mount `useAttemptKey()`; accept the duplicate risk until MUT-193 |
| R3, R4, R5 | pending | pending | pending | pending |

Question D4:
D4 — Should "create profile" remember its attempt if the drawer closes mid-save?
Project/branch/task: MUT-183 plan on main; the create drawer uses an idempotency key so a retried save can't create twice.
ELI10: Each save sends a one-time ticket number, so if the save is sent twice the server knows it's the same request. Today that ticket lives inside the drawer. If someone presses Save on a slow connection, gets impatient, closes the drawer and tries again, the reopened drawer gets a new ticket and the server makes a second profile. Each extra profile uses up one of only 6 slots, and nobody can delete one yet.
Stakes if we pick wrong: Impatient users on slow connections end up with duplicate profiles and a permanently smaller limit.
Recommendation: A because keeping the ticket for the whole tab closes the gap even when Back is used, at no extra cost.
Completeness: A=10/10, B=7/10, C=3/10
Pros / cons:
A) Keep one attempt per tab (recommended)
  ✅ The same body after closing and reopening replays the first save; the server never creates a twin
  ✅ Works for browser Back too, which can't be blocked on a URL-driven drawer (human ~1h / CC ~10min)
  ❌ One more module-level object, used only by profile creation, sitting beside the shared useAttemptKey
B) Lock the drawer while saving
  ✅ No new state at all: Cancel, close and Escape stay disabled while the POST is in flight
  ✅ Easy to see and test in the drawer itself (human ~30min / CC ~5min)
  ❌ Browser Back still unmounts the drawer, so the duplicate path stays open for exactly the impatient user
C) Leave it as is
  ✅ Zero work, and the plan matches the existing expense and conversion drawers exactly
  ✅ The duplicate becomes recoverable once MUT-193 (archive) ships
  ❌ Until then a duplicate profile permanently costs the user one of six slots
Net: A closes the hole for about ten minutes of work; B and C leave it open through Back.
Header: Create attempt
Options:
A) One attempt per tab (recommended)
Module-scope createAttemptKey() for profile creation in profileQueries.ts (useProfileCreateAttempt). Reopen + same body reuses the key, so the server replays the first 201; a changed body or a success starts fresh; a page reload starts fresh. Test CR4b: in-flight POST → close → reopen → same Idempotency-Key. (human ~1h / CC ~10min)
B) Lock drawer while saving
Keep the per-mount key; disable Cancel, close and Escape while the POST is pending. Browser Back still unmounts the drawer, so that gap stays. Test CR4b: Cancel disabled while pending. (human ~30min / CC ~5min)
C) Leave as is
Keep the per-mount useAttemptKey() like the expense and conversion drawers; accept duplicate risk until MUT-193 ships archive. No new test. (human 0 / CC 0)

State: approved
Actual answer: A "One attempt per tab (recommended)" (D4, answered 2026-10-14)
Accepted scope: Profile creation uses one tab-lifetime `AttemptKey` (`createAttemptKey()` at module scope in `profileQueries.ts`, exposed as `useProfileCreateAttempt()`) instead of the per-mount `useAttemptKey()`. Reopening with the same body reuses the key, so the server replays the first 201. A changed body or a success starts a new attempt, and a page reload starts fresh. Test CR4b: POST in flight → close → reopen → same body → same Idempotency-Key. It is still an attempt-scoped key built on the same `AttemptKey` contract, so AC A7 holds. Plan §2, §2.3, §3 and §5 are amended.
History: none

### R3: Extract the shared `details.reason` reader
Finding: Q-1, P3, confidence 9/10. Three byte-identical copies of `function reasonOf(error: ApiError): string | undefined { const details = error.details as { reason?: unknown } | null; return typeof details?.reason === 'string' ? details.reason : undefined; }` (md5 match): `src/hosted/components/expenseApiErrors.ts:23`, `incomeApiErrors.ts:29`, `conversionApiErrors.ts:20`. The plan's `profileApiErrors.ts` would be the fourth (proposed caller). Claude review.
Plan baseline: §3 proposes extracting `apiErrorReason(error)` into `api/client.ts` and migrating all four. Unapproved.
Runtime evidence: the three are identical. Rubric accounting:
- Implementation: about 12 lines removed and about 6 added (helper plus 3 imports), so about 6 saved.
- Tests: about 8 added for the helper, so the total grows by about 2.
- Reliability: if the server ever moves `reason`, it is fixed once instead of four times.
- Blast radius: all four error mappers. Their existing test files are the regression proof.
Comparison grid:

| Choice | Current | A | B |
|---|---|---|---|
| R1, R2, R6 | approved A (D2, D3, D4) | unchanged | unchanged |
| R3 reason reader | 3 private copies | `export function apiErrorReason(error: ApiError)` in `api/client.ts`; migrate expense/income/conversion mappers + new profile mapper; regression contract: `expenseApiErrors.test.ts`, `incomeApiErrors.test.ts` and the conversion drawer tests pass **unmodified**; one helper test (reason string / missing / non-string / null details) | `profileApiErrors.ts` keeps its own private `reasonOf` (4th copy); the 3 existing files untouched |
| R4, R5 | pending | pending | pending |

Question D5:
D5 — Pull the four identical "read the error reason" helpers into one?
Project/branch/task: MUT-183 plan on main; the new profile error mapper needs the same 4-line helper three other mappers already copy.
ELI10: Three files already contain the exact same tiny function that reads why the server refused something. The new profile code needs it too, which would make four copies. We can move it into one shared place and point all four at it, or just add a fourth copy and leave the others alone.
Stakes if we pick wrong: Extract and a slip breaks error messages in the expense, income and conversion drawers. Copy and the next server change to error details has to be fixed in four places.
Recommendation: A because the copies are proven identical, and the existing mapper tests pass unmodified as the safety net.
Completeness: A=9/10, B=8/10
Pros / cons:
A) One shared helper (recommended)
  ✅ One definition instead of four; a server change to error details is fixed in exactly one place
  ✅ Existing mapper tests run unmodified as the regression proof, plus one small helper test (human ~30min / CC ~5min)
  ❌ The diff touches three error files that otherwise have nothing to do with profiles
B) Fourth private copy
  ✅ Zero risk to the expense, income and conversion drawers, because none of their files change
  ✅ Matches the existing per-mapper convention exactly (human ~0 / CC ~0)
  ❌ Four copies of the same function, and the next copy will be five
Net: about 6 lines saved and one place to change, for touching three files under existing tests.
Header: Error reason helper
Options:
A) Extract apiErrorReason (recommended)
Export apiErrorReason(error) from api/client.ts; migrate the expense, income and conversion mappers plus the new profile mapper. Their existing tests pass unmodified (regression contract); add one helper test. (human ~30min / CC ~5min)
B) Keep a fourth private copy
profileApiErrors.ts gets its own private reasonOf; the three existing mapper files stay untouched. (human ~0 / CC ~0)

State: approved
Actual answer: A "Extract apiErrorReason (recommended)" (D5, answered 2026-10-14)
Accepted scope: `export function apiErrorReason(error: ApiError): string | undefined` in `src/hosted/api/client.ts`. The expense, income and conversion mappers drop their private `reasonOf` and import it, and so does the new `profileApiErrors.ts`. Regression contract: `expenseApiErrors.test.ts`, `incomeApiErrors.test.ts` and the conversion drawer tests pass unmodified. A new helper test covers a string reason, a missing reason, a non-string reason, and null details. Plan §3 and §5 are amended.
History: none

### R4: One shared list of the portal's currencies
Finding: Q-2, P3, confidence 9/10, `src/hosted/components/ExpenseDrawer.tsx:30` (`const CURRENCY_OPTIONS = ['USD', 'ILS', 'EUR', 'JOD'] as const;`), used at :38 (`z.enum(CURRENCY_OPTIONS)`) and :241. The proposed second caller is the profile create/edit forms (plan §2.3, §2.4). Claude review.
Plan baseline: §3 proposes `format/currencies.ts` `HOSTED_CURRENCIES = ['ILS','USD','EUR','JOD']` with an exhaustiveness check against the API `Currency` type (`schema.d.ts`: `Currency: "ILS" | "USD" | "EUR" | "JOD"`), and points ExpenseDrawer at it. Unapproved.
Runtime evidence:
- The draft order `ILS, USD, …` differs from ExpenseDrawer's `USD, ILS, EUR, JOD`. Adopting it would silently reorder the expense currency dropdown.
- `conversionFormSchema.ts:16` has a 3-currency list on purpose (TD-117) and is out of scope.
- Reliability gain: a currency added to the API fails `typecheck` until the pickers list it, instead of silently going missing.
Comparison grid:

| Choice | Current | A | B |
|---|---|---|---|
| R1, R2, R3, R6 | approved A (D2, D3, D5, D4) | unchanged | unchanged |
| R4 currency list | ExpenseDrawer private const | `format/currencies.ts` exports `HOSTED_CURRENCIES = ['USD','ILS','EUR','JOD'] as const` (ExpenseDrawer's existing order kept) with a compile-time check that it covers every API `Currency`; ExpenseDrawer and both profile forms import it; regression contract: `ExpenseDrawer.test.tsx` passes unmodified, including the JOD test at :139 | profile forms declare their own `['USD','ILS','EUR','JOD']`; ExpenseDrawer untouched; no exhaustiveness check |
| R5 | pending | pending | pending |

Question D6 (superseded, see History):
D6 — Share one currency list between the expense drawer and the new profile forms?
Project/branch/task: MUT-183 plan on main; the profile forms need the same four-currency list the expense drawer already declares privately.
ELI10: The expense drawer has its own private list of the four currencies the server accepts. The new profile forms need the same list. We can move it into one shared file with a type check that fails the build if the server ever adds a currency we forgot. Or we can copy it. Also, my draft had the currencies in a different order, which would have quietly reshuffled the expense dropdown; whichever option you pick keeps today's order.
Stakes if we pick wrong: Copy it, and the next new currency (JOD was just added in MUT-140) has to be remembered in two places or a picker silently lacks it.
Recommendation: A because the type check turns "forgot a currency" from a silent gap into a failed build.
Completeness: A=9/10, B=7/10
Pros / cons:
A) Shared list + type check (recommended)
  ✅ A currency added to the API breaks typecheck until every picker lists it; no silent gaps
  ✅ Keeps today's USD, ILS, EUR, JOD order, so the expense dropdown looks exactly the same (human ~20min / CC ~5min)
  ❌ Touches ExpenseDrawer.tsx, a file otherwise outside this ticket, under its existing tests
B) Copy the list
  ✅ ExpenseDrawer stays untouched, so there is zero risk to expense capture
  ✅ The smallest possible change (human ~0 / CC ~0)
  ❌ Two hand-kept lists, and nothing warns when the API's currency list grows
Net: a five-minute move buys a build-time guard against the exact mistake MUT-140 nearly made.
Header: Currency list
Options:
A) Shared list + type check (recommended)
format/currencies.ts exports HOSTED_CURRENCIES = ['USD','ILS','EUR','JOD'] (today's order) with a compile-time check against the API Currency type. ExpenseDrawer and both profile forms import it. ExpenseDrawer.test.tsx passes unmodified. (human ~20min / CC ~5min)
B) Copy the list
Profile forms declare their own ['USD','ILS','EUR','JOD']; ExpenseDrawer untouched; no exhaustiveness check. (human ~0 / CC ~0)

Reopened 2026-10-14 after main moved to `184d454` (MUT-194 merged during this review). New evidence:
- `src/hosted/components/conversionFormSchema.ts:16` now reads `export const CURRENCY_OPTIONS = ['USD', 'ILS', 'EUR', 'JOD'] as const;`. Its comment says "MUT-194 (D7, closes TD-117): JOD joins the set". It is used at :28, :30 and `ConversionDrawer.tsx:13/237/279`.
- So the conversion list is no longer different on purpose, which falsifies D6's assumption ("`conversionFormSchema.ts` is untouched (TD-117)").
- `.claude/TECH_DEBT.md` TD-125 (Open) prescribes this fix: "one `src/hosted/format/currencies.ts` (the wire enum) … share `reasonOf`/`fieldOf`".

Reopened comparison grid:

| Choice | Current (approved D6) | A | B |
|---|---|---|---|
| R1–R3, R5–R8 | approved | unchanged | unchanged |
| R4 currency list | `format/currencies.ts` `HOSTED_CURRENCIES` (USD, ILS, EUR, JOD) + exhaustiveness check; ExpenseDrawer + profile forms import it; conversionFormSchema untouched | same as D6 **plus** `conversionFormSchema.ts` drops its own list and imports `HOSTED_CURRENCIES` (keeping `CURRENCY_OPTIONS` as a re-export only if ConversionDrawer imports it, otherwise ConversionDrawer imports `HOSTED_CURRENCIES` too); regression contract: `conversionFormSchema.test.ts` and `ConversionDrawer.test.tsx` pass unmodified; TD-125 notes the currencies + reasonOf parts resolved | keep D6 as approved: conversions keep their own identical list (two lists: shared + conversion) |

Question D10:
D10 — Now that conversions use the same four currencies, point them at the shared list too?
Project/branch/task: MUT-183 plan on main; MUT-194 merged during this review and gave the conversion form the same four-currency list.
ELI10: When you approved a shared currency list, the conversion form had a different, shorter list on purpose, so I left it alone. While we were talking, MUT-194 landed and gave conversions exactly the same four currencies. Leaving it out now just keeps a second identical copy. There's also an existing tech-debt item, TD-125, that asks for exactly this single shared file.
Stakes if we pick wrong: Leave it out and the next new currency has to be added in two places again, which is the gap the shared list was meant to close.
Recommendation: A because the evidence that justified leaving conversions alone no longer exists, and TD-125 already asks for this.
Completeness: A=10/10, B=7/10
Pros / cons:
A) Include conversions (recommended)
  ✅ One currency list for every portal picker, guarded by the build-time check against the API
  ✅ Closes the currency half of TD-125 instead of leaving it half done (human ~15min / CC ~5min)
  ❌ Touches conversionFormSchema.ts and ConversionDrawer.tsx, which MUT-194 changed today, under their fresh tests
B) Keep D6 as approved
  ✅ The newly merged conversion code stays untouched, with zero risk to it
  ✅ The scope stays exactly what you already approved (human 0 / CC 0)
  ❌ Two identical hand-kept lists remain, and TD-125 stays half open
Net: about five minutes buys a single source for currencies; B only avoids touching code merged an hour ago.
Header: Conversions list
Options:
A) Include conversions (recommended)
D6 scope plus conversionFormSchema.ts imports HOSTED_CURRENCIES instead of its own list (ConversionDrawer follows). conversionFormSchema.test.ts and ConversionDrawer.test.tsx pass unmodified. TD-125 marks the currencies + reasonOf parts resolved. (human ~15min / CC ~5min)
B) Keep D6 as approved
Conversions keep their own identical list; HOSTED_CURRENCIES serves ExpenseDrawer and the profile forms only. (human 0 / CC 0)

State: approved
Actual answer: A "Include conversions (recommended)" (D10, answered 2026-10-14; reopened from D6)
Accepted scope: `src/hosted/format/currencies.ts` exports `HOSTED_CURRENCIES = ['USD','ILS','EUR','JOD'] as const` with a compile-time check against the API `Currency`. These import it:
- `ExpenseDrawer.tsx`, which drops its private `CURRENCY_OPTIONS`.
- `conversionFormSchema.ts`, which drops its own list; ConversionDrawer follows by importing `HOSTED_CURRENCIES`, or through a thin re-export if that keeps the diff smaller.
- Both profile forms.

Regression contract: `ExpenseDrawer.test.tsx` (including the JOD test at :139), `conversionFormSchema.test.ts` and `ConversionDrawer.test.tsx` pass unmodified. TD-125 records its currency and `reasonOf` parts as resolved. Plan §3 and §6 are amended.
History: Prior approved result (D6), superseded by D10 after MUT-194 merged: State: approved Actual answer: A "Shared list + type check (recommended)" (D6, answered 2026-10-14) Accepted scope: `src/hosted/format/currencies.ts` exports `HOSTED_CURRENCIES = ['USD','ILS','EUR','JOD'] as const`, in today's ExpenseDrawer order, with a compile-time check that it covers every API `Currency`. ExpenseDrawer and both profile forms import it. Regression contract: `ExpenseDrawer.test.tsx` passes unmodified, including the JOD test at :139. `conversionFormSchema.ts` is untouched (TD-117). Plan §2.3 and §3 are amended. History: none

### R5: What the create drawer's type field starts as
Finding: Q-3, P3, confidence 7/10, plan §2.3 ("**Type:** a two-option segmented radio, Personal | Business, defaulting to Business") with the MUT-182 contract (`schema.d.ts:8090`: "A changed type replaces the profile's expense categories … and leaves every expense that had one uncategorized"). Claude review.
Plan baseline: preselect Business. Unapproved.
Runtime evidence:
- The type is the one create field whose later change is destructive: it wipes the categories and uncategorizes expenses.
- A user with zero profiles reaches create from the empty state (§2.6), and for them Business is a guess.
- `me.profiles` carries `owned` and `type`, so a contextual default is computable with no extra call.
Comparison grid:

| Choice | Current | A | B | C |
|---|---|---|---|---|
| R1–R4, R6 | approved (D2–D6) | unchanged | unchanged | unchanged |
| R5 type default | preselect Business | nothing preselected; the field is required (zod), Save shows "Choose Personal or Business"; hint "Picks the starting expense categories. Changing it later replaces them." | preselect Business when the user already owns a PERSONAL-type profile, otherwise Personal | always preselect Business (plan baseline) |

Question D7:
D7 — Should the new-profile form pre-pick Personal or Business?
Project/branch/task: MUT-183 plan on main; the create drawer's type field decides which expense categories the new profile starts with.
ELI10: Personal vs Business picks the starter expense categories. Switching it later wipes those categories and leaves the profile's expenses uncategorized. My draft pre-picked Business, which is a guess, and a wrong guess gets clicked straight through. We can make people choose explicitly, guess smarter from what they already have, or keep Business pre-picked.
Stakes if we pick wrong: Someone saves a profile with the wrong type, records expenses, then fixing it uncategorizes all of them.
Recommendation: A because the one field that is costly to change later should be a conscious choice, and it costs one click.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Make them choose (recommended)
  ✅ Nobody ends up with the wrong categories by clicking through a default they never read
  ✅ The hint states the consequence right where the choice is made (human ~15min / CC ~5min)
  ❌ One extra click on every create, and the Save attempt errors if they skip it
B) Smart default from existing profiles
  ✅ Usually right: someone who already owns a Personal profile is most likely adding a business
  ✅ No extra click in the common case (human ~20min / CC ~5min)
  ❌ Still a guess that gets clicked through, and it is wrong for a second personal budget
C) Always Business
  ✅ The simplest code: one constant, no rule and no validation message
  ✅ Matches the likeliest case for users who already have the built-in Personal (human ~0 / CC ~0)
  ❌ Wrong for every first-profile user arriving from the empty state, who then faces a destructive fix
Net: A trades one click for never shipping a wrong preset; B and C trade correctness for speed.
Header: Type default
Options:
A) Make them choose (recommended)
No preselection; type is required (zod). Save without it shows "Choose Personal or Business". Hint: "Picks the starting expense categories. Changing it later replaces them." Test FS2 + CR8. (human ~15min / CC ~5min)
B) Smart default
Preselect Business when the user already owns a PERSONAL-type profile, otherwise Personal. Test CR8 for both branches. (human ~20min / CC ~5min)
C) Always Business
Keep the plan baseline: Business preselected for everyone. Test CR8 asserts the default. (human ~0 / CC ~0)

State: approved
Actual answer: A "Make them choose (recommended)" (D7, answered 2026-10-14)
Accepted scope: The type field has no preselection and is required (zod). Saving without it shows "Choose Personal or Business". The hint reads "Picks the starting expense categories. Changing it later replaces them." Tests: FS2 (the schema rejects a missing type) and CR8 (Save without a type shows the message and sends no POST). Plan §2.3 and §5 are amended.
History: none

### R7: Regression contract for the empty state (S11) the ticket changes
Finding: T-1, CRITICAL regression risk, confidence 9/10:
- `src/hosted/session/__tests__/auth-states.test.tsx:223-229` (`it('offers only Sign out', … expect(await screen.findByText("Your account isn't connected to a profile yet")) … getByRole('button', { name: 'Sign out' }) … queryByRole('navigation', { name: 'Sections' })).toBeNull()`)
- `:373-378` (`/capture` with no profiles "offers only Sign out, same as S11, not a crash or 404")

AC A9 changes the copy on purpose, and §2.6 adds "+ New profile". Claude review.
Plan baseline: §2.6 plus tests EM1/EM2. The plan didn't name these two existing tests or what they must keep proving. Unapproved.
Runtime evidence: both tests assert the old copy, and the S11 test's name and intent are "only Sign out". Both would fail on the new copy, and they could be "fixed" by deleting the assertions that still matter: no Sections nav, Sign out still offered, `/capture` neither crashing nor returning 404.
Comparison grid:

| Choice | Current | A | B |
|---|---|---|---|
| R1–R6 | approved (D2–D7) | unchanged | unchanged |
| R7 S11 regression contract | unspecified | edit both tests in place: **keep** "no Sections nav", "Sign out offered", "/capture with no profiles renders the empty state, no crash/404"; **change** copy to the new strings and rename "offers only Sign out" → "offers New profile and Sign out"; **add** "+ New profile" opens the create drawer (`?newProfile=1`) from both `/` and `/capture` | leave both existing tests' preserved assertions in place and only swap the copy strings; put all new-button assertions in separate EM tests in `auth-states.test.tsx` |

Question D8:
D8 — How should the two existing "no profile" tests change when the empty state gains a New profile button?
Project/branch/task: MUT-183 plan on main; the ticket rewrites the "your account isn't connected" screen, and two existing tests pin the old one.
ELI10: Two tests check the screen people see when they have no profile: it says "ask whoever set up your account" and offers only Sign out. The ticket changes exactly that screen on purpose. The danger is the builder "fixing" those tests by deleting lines that still matter, like "no menu shows" and "the /capture link doesn't crash". This decision pins what stays proven and what changes.
Stakes if we pick wrong: A careless test edit could let /capture start crashing for profile-less users with no test noticing.
Recommendation: A because one test per screen, saying what it now offers, is clearer than an old name ("only Sign out") that is no longer true.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Edit both tests in place (recommended)
  ✅ Each test's name says what the screen now offers, so nobody reads "only Sign out" and believes it
  ✅ The kept checks (no menu, Sign out, /capture no crash) sit right next to the new button check (human ~20min / CC ~5min)
  ❌ The diff edits two long-standing tests, which a reviewer must read carefully
B) Swap copy only; new checks elsewhere
  ✅ The old tests change by only their strings, so the preserved checks are obviously untouched
  ✅ New behaviour lives in its own clearly named EM tests (human ~20min / CC ~5min)
  ❌ The S11 test keeps the name "offers only Sign out", which becomes false the day this ships
Net: both preserve the same guarantees; A keeps test names honest, B keeps the old diff minimal.
Header: S11 tests
Options:
A) Edit both in place (recommended)
Keep: no Sections nav, Sign out offered, /capture with no profiles renders the empty state (no crash/404). Change: new copy; rename "offers only Sign out" → "offers New profile and Sign out". Add: "+ New profile" opens ?newProfile=1 from / and /capture. (human ~20min / CC ~5min)
B) Swap copy, new tests elsewhere
Keep both tests' assertions and names; replace only the copy strings. Put the "+ New profile" assertions for / and /capture in separate EM tests in auth-states.test.tsx. (human ~20min / CC ~5min)

State: approved
Actual answer: A "Edit both in place (recommended)" (D8, answered 2026-10-14)
Accepted scope: `auth-states.test.tsx:223` and `:373` are edited in place.
- **Keep:** no Sections nav; Sign out offered; `/capture` with no profiles renders the empty state, with no crash or 404.
- **Change:** the copy, to the new strings; the test name "offers only Sign out" becomes "offers New profile and Sign out".
- **Add:** "+ New profile" opens `?newProfile=1` from both `/` and `/capture`.

These edits are EM1/EM2. Plan §5 is amended.
History: none

### R8: TODO — portal remembers the last opened profile
Finding: TODO-1, P3, confidence 8/10, `src/hosted/session/AuthGate.tsx:62-64` (`function FirstProfileRedirect … return <Navigate to={`/p/${profiles[0].id}${to}`} replace />;`) with the MUT-182 order contract (brief §2.6: operator firms, then owned BUSINESS and extra PERSONAL by createdAt, then the `isPersonalDefault` profile last; R-4). Claude review.
Plan baseline: plan §7 lists it as out of scope with no ticket and no TODO. Unapproved.
Runtime evidence: after MUT-183 ships, a user who creates a Business profile lands on it at `/` every time, instead of Personal. MUT-182 R-4 left a "last opened" override to MUT-183 as optional, and no MUT-183 AC asks for it.
- **What:** `/` (and `/capture`) open the profile the user last had open in this browser, falling back to `profiles[0]`.
- **Why:** once a user owns several profiles, always opening the first business one is surprising.
- **Pros:** small (a `localStorage` key read in `FirstProfileRedirect`, guarded by membership in `me.profiles`).
- **Cons:** per-browser only; adds a stored value to a portal that otherwise stores nothing (hosted-portal.md §8 allows only per-viewer conveniences); the default order may be what Basel wants.
- **Context:** start at `FirstProfileRedirect` in AuthGate.tsx. Needs a try/catch around storage.
- **Depends on:** MUT-183.
Comparison grid:

| Choice | Current | A | B | C |
|---|---|---|---|---|
| R1–R7 | approved (D2–D8) | unchanged | unchanged | unchanged |
| R8 last-opened profile | not tracked | TODOS.md entry #14 (What/Why/Pros/Cons/Context/Depends) | not tracked anywhere | built in MUT-183: `FirstProfileRedirect` reads a last-opened id, guarded by membership, + test |

Question D9:
D9 — Track "open the last-used profile" as a follow-up?
Project/branch/task: MUT-183 plan on main; after this ships, people with a business profile land on it instead of Personal every time they open the portal.
ELI10: The portal always opens the first profile in the server's list. After this ticket, that's the newest business profile, not Personal. Remembering the last one the person had open would feel more natural, but no part of this ticket asks for it. We can note it as a follow-up, drop it, or build it now.
Stakes if we pick wrong: Drop it and users with two businesses keep landing on the wrong one. Build it now and the ticket grows beyond its acceptance criteria.
Recommendation: A because it's real but outside every AC, and a TODO keeps it visible without growing this ticket.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Add to TODOS.md (recommended)
  ✅ Keeps the observed annoyance visible with enough context to build it in ten minutes later
  ✅ MUT-183 stays exactly its acceptance criteria, with no scope creep (human ~5min / CC ~2min)
  ❌ Users with several profiles live with "opens the first business one" until someone picks it up
B) Skip it
  ✅ No tracking overhead; the server's order may simply be the behaviour you want
  ✅ Avoids adding the portal's first stored per-browser value (human 0 / CC 0)
  ❌ The landing change from MUT-182 R-4 goes unrecorded and may surprise users later
C) Build it in this ticket
  ✅ Users land where they left off from day one
  ✅ Small: one storage read in FirstProfileRedirect plus a test (human ~1h / CC ~10min)
  ❌ Scope creep against the ticket's ACs, and it adds storage to a portal that keeps nothing locally
Net: A records a real UX wrinkle without stretching this ticket.
Header: Last profile TODO
Options:
A) Add to TODOS.md (recommended)
Add TODOS.md #14 "Portal remembers the last opened profile" with What/Why/Pros/Cons/Context/Depends on MUT-183. No code in this ticket. (human ~5min / CC ~2min)
B) Skip
Don't track it; the server's profile order stays the landing rule. (human 0 / CC 0)
C) Build it in MUT-183
FirstProfileRedirect reads a last-opened profile id from localStorage (try/catch, must be in me.profiles), falling back to profiles[0]; add a test. (human ~1h / CC ~10min)

State: approved
Actual answer: A plus a Jira ticket. The user replied "add to todos and file jira ticket" (D9, answered 2026-10-14).
Accepted scope: Add TODOS.md #14, "Portal remembers the last opened profile" (What/Why/Pros/Cons/Context/Depends on MUT-183), and file a Jira story in MUT under epic MUT-181, linked "relates to" MUT-183. No code in MUT-183.
History: none

Approval readiness: PASS. Every accepted remedy cites its own answer:
- R1: D2 = A
- R2: D3 = A
- R3: D5 = A
- R4: D10 = A (reopened from D6)
- R5: D7 = A
- R6: D4 = A
- R7: D8 = A (regression contract)
- R8: D9 = A plus a Jira ticket (MUT-198 filed; TODOS #14 committed at `0569873`)

Factual corrections, needing no question: the Reload re-snapshot goes in the click handler; `?editProfile` falls back to the list (RT5); the timezone list is computed once; the required proofs CR9, TC7, MG7 and the RU1 fixture are added. Structure: D1 = A.

## Review findings by section

**Scope Challenge:** SC-1 [P1] (9/10) `.claude/DECISIONS.md:246`: §2.1 contradicted ADR-008. Accepted as A (D2). Scope accepted as-is.

**1. Architecture** (2 issues)
- A-1 [P2] (8/10) `src/hosted/session/AuthGate.tsx:99-107`: a failed `me` refetch after create would land the user on "isn't available". Accepted as A (D3).
- A-2 [P2] (8/10) `src/hosted/data/attemptKey.ts:42-45`: the per-mount key lets a close-and-reopen duplicate a profile. Accepted as A (D4).

**2. Code quality** (3 issues)
- Q-1 [P3] (9/10): three identical `reasonOf` copies. Accepted as A (D5).
- Q-2 [P3] (9/10): currency list copies, re-scoped after MUT-194. Accepted as A (D10).
- Q-3 [P3] (7/10): the Business default type. Accepted as A (D7).

**3. Tests** (5 gaps)
- T-1 CRITICAL: the S11 tests pin the copy being changed. Accepted as A (D8).
- Missing proofs added as required work: CR9 double-submit, TC7 focus, MG7 403 path, and an RU1 fixture that rejects a hard-coded 6.

**4. Performance** (1 issue)
- [P3] (8/10): the roughly 420-entry timezone list is computed once per module. Recorded.

**Outside voice:** unavailable. Codex is not installed (`CODEX_MODE: not_installed`), and the native fallback needs TaskOutput and TaskStop, which this session lacks. That is missing coverage, not a clean pass.

### Coverage diagram (planned tests vs planned code)

```
CODE PATHS                                              USER FLOWS
[+] data/profileRules.ts                                [+] Create profile
  ├── canCreateProfile  [★★★ RU1 max=3 fixture]           ├── [★★★ CR3/CR3b] land on new profile, me refetch fails
  ├── profileEditability[★★★ RU2 4 kinds]                 ├── [★★★ CR4/CR4b/CR5] key reuse: retry, close+reopen, edit
  ├── profileKindKey    [★★  RU3, SW4]                    ├── [★★★ CR6/CR7] cap via 409 and via stale me
  └── changedFields     [★★★ RU4 diff + empty]            ├── [★★  CR8/FS2] type required
[+] data/filters.ts omitShellOverlay [★★★ RT3]            ├── [★★  CR9] double-click → one POST
[+] router.tsx (8 routes)  [★★★ RT2 CRITICAL]             └── [→E2E] qa spec on preview build (Enter-to-save)
[+] format/timezones.ts    [★★★ TZ1 3 branches]          [+] Manage / edit
[+] format/currencies.ts   [★★  typecheck + R4 regr.]     ├── [★★★ MG1/MG2] list + read-only reasons
[+] api/client.ts apiErrorReason [★★★ AR1 + 3 regr.]      ├── [★★★ MG3/MG4] If-Match = opened version, 409 Reload
[+] components/profileApiErrors.ts [★★★ ER1–ER8]          ├── [★★  MG5] built-in Personal: no type control
[+] ProfileCreateDrawer / ProfilesManageDrawer /          ├── [★★★ MG7] 403 → me refetch → read-only row
    ProfileEditForm / ProfileDrawers [see flows]          └── [★★  RT5] bad ?editProfile → list
[+] shell/ProfileSwitcher.tsx [★★★ SW1–SW4]              [+] Type change
[+] session/AuthGate.tsx empty state [★★★ EM1/EM1b/EM2]   ├── [★★★ TC1–TC6] preview → confirm → PATCH → refetch
                                                          └── [★★  TC7] focus to heading, Back → Save
                                                         [+] RTL [★★ MG6] + i18n parity test
COVERAGE: all planned paths have a planned test | GAPS: 0 after amendments (1 E2E in qa/)
```

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific finding above. Run with Claude Code or Codex; checkbox as you ship.

- [ ] **T1 (P1, human: ~2h / CC: ~15min)**: router/filters: URL-driven profile drawers with `omitShellOverlay` at all 8 page routes.
  - Surfaced by: Scope Challenge, SC-1 / R1 (D2).
  - Files: `src/hosted/data/filters.ts`, `src/hosted/router.tsx`, `src/hosted/shell/ProfileDrawers.tsx`.
  - Verify: RT2, RT3, RT4 in `npx vitest run src/hosted`.
- [ ] **T2 (P2, human: ~1h / CC: ~10min)**: create flow: write the 201 into the `me` cache, navigate at once, refetch in the background.
  - Surfaced by: Architecture, A-1 / R2 (D3).
  - Files: `src/hosted/data/profileQueries.ts`, `src/hosted/components/ProfileCreateDrawer.tsx`.
  - Verify: CR3, CR3b.
- [ ] **T3 (P2, human: ~1h / CC: ~10min)**: tab-lifetime create attempt via `useProfileCreateAttempt()`.
  - Surfaced by: Architecture, A-2 / R6 (D4).
  - Files: `src/hosted/data/profileQueries.ts`.
  - Verify: CR4, CR4b, CR5.
- [ ] **T4 (P2, human: ~30min / CC: ~5min)**: extract `apiErrorReason`; migrate 4 mappers.
  - Surfaced by: Code Quality, Q-1 / R3 (D5).
  - Files: `src/hosted/api/client.ts`, `src/hosted/components/{expense,income,conversion,profile}ApiErrors.ts`.
  - Verify: AR1 plus the existing mapper tests unmodified.
- [ ] **T5 (P2, human: ~20min / CC: ~5min)**: `HOSTED_CURRENCIES` with an exhaustiveness check; migrate the Expense, Conversion and profile forms.
  - Surfaced by: Code Quality, Q-2 / R4 (D10).
  - Files: `src/hosted/format/currencies.ts`, `ExpenseDrawer.tsx`, `conversionFormSchema.ts`, `ConversionDrawer.tsx`.
  - Verify: typecheck, plus the Expense and Conversion tests unmodified.
- [ ] **T6 (P2, human: ~15min / CC: ~5min)**: the type field is required with no preselection.
  - Surfaced by: Code Quality, Q-3 / R5 (D7).
  - Files: `src/hosted/components/profileFormSchema.ts`, `ProfileCreateDrawer.tsx`.
  - Verify: FS2, CR8.
- [ ] **T7 (P2, human: ~20min / CC: ~5min)**: edit the S11 and `/capture` tests in place per the regression contract.
  - Surfaced by: Test review, T-1 / R7 (D8).
  - Files: `src/hosted/session/__tests__/auth-states.test.tsx`.
  - Verify: EM1, EM1b.
- [ ] **T8 (P2, human: ~30min / CC: ~5min)**: add the required proofs.
  - Surfaced by: Test review (missing proofs for approved behaviour).
  - Files: the drawer tests and `profileRules.test.ts`.
  - Verify: CR9, TC7, MG7, RU1 with max = 3.
- [ ] **T9 (P3, human: ~5min / CC: ~2min)**: compute the timezone list once per module.
  - Surfaced by: Performance.
  - Files: `src/hosted/format/timezones.ts`.
  - Verify: TZ1.

## NOT in scope
- Remembering the last-opened profile: MUT-198 / TODOS #14 (D9).
- Archiving or deleting an owned profile: MUT-193 / TODOS #13.
- MUT-191 C1 (a Malafat note after a Business profile is created): this ticket only keeps the create success path in one `onCreated`.
- The rest of TD-125 (`fieldOf`, `parseIncomeAmount`, picker ids): R3 and R4 resolve only its currency and `reasonOf` parts.
- Flutter profile management: MUT-184.

## What already exists
- Reused as-is:
  - `Drawer`/`DrawerFrame`
  - `Button`
  - `Select` (from `ui/Input`)
  - `useToast`
  - `usePopover`
  - `profileKey`/`ME_KEY`
  - `createAttemptKey`/`AttemptKey`
  - the real-router test harness
  - MUT-133's "opens through the URL without refetching the list" test, as the model for RT2
- Extended:
  - `filters.ts`, with `omitShellOverlay` beside `splitIncomeDrawer`
  - `api/client.ts`, with three profile calls and `apiErrorReason`
- Shared-code choices: R3 and R4, with rubric evidence in their records. Both partly close TD-125.
- The server is untouched. The MUT-182 contract is complete in `schema.d.ts`.

## Failure modes
| New path | Realistic failure | Covered by | User sees |
|---|---|---|---|
| Create → navigate | `me` refetch fails after the 201 | R2 cache write, CR3b | lands on the new profile |
| Create retry | slow POST, then close and reopen | R6 tab attempt, CR4b | no duplicate profile |
| Edit save | edited elsewhere meanwhile | snapshot If-Match, MG4 | "changed elsewhere" + Reload |
| Edit save | ownership revoked | MG7 | "can't change this profile", row turns read-only |
| Type change | preview call fails | TC6 | error, no fake count |
| Shell drawer open | key leaks into a list cache | `omitShellOverlay`, RT2 | list stays put |
| Any save | offline | ER (NETWORK), CR4 | inline "Nothing was saved", values kept |

Critical gaps: 0.

## Worktree parallelization strategy
Sequential implementation, no parallelization opportunity. Everything lives in one module (`src/hosted/`), and T1, T2, T3 and T6 share the create drawer and `profileQueries.ts`. Suggested order: T4 → T5 (shared helpers, under existing tests) → T1 → T2/T3/T6 → manage/edit/type change → T7/T8 → T9.

## Completion summary
- Step 0, Scope Challenge: scope accepted as-is (SC-1 fixed via D2).
- Architecture review: 2 issues found.
- Code quality review: 3 issues found.
- Test review: diagram produced, 5 gaps identified.
- Performance review: 1 issue found.
- NOT in scope: written.
- What already exists: written.
- TODOS.md updates: 1 item proposed; added as #14 plus MUT-198.
- Failure modes: 0 critical gaps flagged.
- Unresolved decisions: 0 in this review.
- Outside voice: codex, unavailable (CLI not installed; native fallback lacks TaskOutput/TaskStop).
- Parallelization: 1 lane, 0 parallel, 1 sequential.
- Lake score: 5/5. All five answers with a completeness score (D2, D3, D4, D5, D10) picked the highest-scored option. D1, D7, D8 and D9 carried kind-notes and are not scored.

### Suppressed findings (appendix)
- [P3] (4/10): two profiles may share a name, which makes the switcher ambiguous. The server doesn't enforce uniqueness, and no AC asks for it. Not raised.


---

# Design review (`/plan-design-review`, 2026-10-14)

Target: this plan. Wireframe and copy deck: [mut-183-portal-profiles-wireframe.html](mut-183-portal-profiles-wireframe.html). It uses real Brand v2 tokens and has en/ar and light/dark toggles; Basel prefers HTML wireframes to generated mockups. Calibrated against the Brand v2 kit (`docs/brand/README.md`); there is no DESIGN.md.

## Design decisions (each answered individually, 2026-10-14)

| Issue | Pass | Decision | Answer |
|---|---|---|---|
| 1 | IA | Manage row anatomy: name and "Open now" / kind / currency; chevron on owned rows, lock and reason on firm and Malafat rows; 56px rows | A (D2) |
| 2 | IA | Edit pane: name and currency first, time zone as a fact, then "Profile type" in its own group last | A (D3) |
| 3 | IA | The counter counts owned profiles only ("Your profiles: N of M", worded per Issue 11) | A (D4) |
| 4 | IA | The built-in profile's sub-line is "Your built-in profile" | A (D5) |
| 5 | States | Pending labels (Creating…, Saving…, Checking…); a top-of-drawer banner for cap and errors; toasts only for success | A (D6) |
| 6 | Journey | A type change with N > 0 shows a Manage-list banner with "Open Expenses" | A (D7) |
| 7 | Design system | Type uses native radio cards with seed examples (`hp-type-card`), not SegmentedControl | A (D8) |
| 8 | Design system | Confirm uses a rose `hp-confirm` panel and `Button variant="danger"` | A (D9) |
| 9 | Responsive | Shared `.drawer` capped at `min(480px, 100vw)`; cards stack under 760px; 44px footer buttons | A (D10) |
| 10 | Responsive | Time zone shows as a fact row with "Change" revealing the select | A (D11) |
| 11 | Decisions | Counts follow a colon, never beside a plural noun, until MUT-179's `tp()` | A (D12) |
| 12 | Decisions | The wireframe's en/ar strings are the copy deck (Business = أعمال) | A (D13) |

Eng decisions D1–D10 from the eng review were not reopened. Issue 7 implements the approved D7 ("type required, no preselection"), and Issue 11 rewords Issue 3's counter without changing what it counts.

## Pass scores

| Pass | Before | After | Remaining gap |
|---|---|---|---|
| 1 Information architecture | 5 | 9 | the switcher entries have no icon spec (accepted) |
| 2 Interaction states | 6 | 9 | toast duration is inherited, not specified |
| 3 Journey | 6 | 9 | at the cap, there's no way to free a slot (MUT-193) |
| 4 AI slop | 8 | 8 | no rendered pixels to check yet |
| 5 Design system | 6 | 9 | no repo DESIGN.md (repo-wide, not this ticket) |
| 6 Responsive / a11y | 6 | 9 | rose confirm contrast to measure in the browser at build |
| 7 Decisions | 12 resolved, 0 deferred | | |

Overall (lowest rated pass): **5/10 → 8/10**.

## NOT in scope (design)
- A way to free a slot at the cap: MUT-193.
- Icons for the switcher's new entries: plain text items, matching the existing menu.
- Plural forms: MUT-179 replaces the colon phrasing with `tp()`.
- A repo-wide DESIGN.md: the Brand v2 kit covers the tokens; portal component rules are a separate effort.

## What already exists (design)
- **Reused patterns:**
  - `hp-option` / `hp-popover-foot` (switcher)
  - `hp-banner-info` / `hp-banner-error`
  - `hp-readonly` + `LockIcon`
  - `hp-empty`
  - `Drawer` / DrawerFrame
  - `Button variant="danger"` (the expense and conversion deletes)
  - `Select` from `ui/Input`
- **Brand v2 tokens:**
  - `primary-hover` for purple text and selected borders
  - lavender, mint and rose tints with their inks
  - Serif Display headings
  - Plex Mono figures
- **New patterns, built from those tokens:** `hp-type-card`, `hp-confirm`, the "Open now" mint pill.

## Implementation Tasks (design review)
Synthesized from this review's findings. Each task derives from a specific finding above. Run with Claude Code or Codex; checkbox as you ship.

- [ ] **DT1 (P2, human: ~1h / CC: ~10min)**: Manage list: row anatomy, the "Open now" pill, and the owned-only counter.
  - Surfaced by: Pass 1, Issues 1, 3 and 11.
  - Files: `src/hosted/components/ProfilesManageDrawer.tsx`, `src/hosted/hosted.css`, i18n.
  - Verify: MG1, MG2, plus a counter test with a firm row present.
- [ ] **DT2 (P2, human: ~30min / CC: ~5min)**: edit pane order and the "Profile type" group.
  - Surfaced by: Pass 1, Issue 2.
  - Files: `ProfileEditForm.tsx`.
  - Verify: MG5 and a DOM-order check.
- [ ] **DT3 (P2, human: ~1h / CC: ~10min)**: pending labels and the top-of-drawer banner slot.
  - Surfaced by: Pass 2, Issue 5.
  - Files: `ProfileCreateDrawer.tsx`, `ProfileEditForm.tsx`, `profileApiErrors.ts`.
  - Verify: ER1–ER8 asserting banner placement, CR6, CR9.
- [ ] **DT4 (P2, human: ~30min / CC: ~5min)**: the after-type-change banner with "Open Expenses".
  - Surfaced by: Pass 3, Issue 6.
  - Files: `ProfilesManageDrawer.tsx`.
  - Verify: TC4b.
- [ ] **DT5 (P2, human: ~1h / CC: ~10min)**: `hp-type-card` radio cards with seed examples, and the `hp-confirm` panel with the danger button.
  - Surfaced by: Pass 5, Issues 7 and 8.
  - Files: `ProfileCreateDrawer.tsx`, `ProfileEditForm.tsx`, `hosted.css`.
  - Verify: CR8, TC1, TC7, and a keyboard arrow test on the radiogroup.
- [ ] **DT6 (P1, human: ~30min / CC: ~5min)**: cap the shared drawer width, stack the cards, and give footer buttons 44px.
  - Surfaced by: Pass 6, Issue 9.
  - Files: `src/index.css`, `src/hosted/hosted.css`.
  - Verify: preview at 375px in en and ar, on a portal drawer and on one local-app drawer.
- [ ] **DT7 (P2, human: ~30min / CC: ~5min)**: time-zone fact row with "Change".
  - Surfaced by: Pass 6, Issue 10.
  - Files: `ProfileCreateDrawer.tsx`.
  - Verify: CR2b.
- [ ] **DT8 (P2, human: ~30min / CC: ~5min)**: copy the wireframe's en/ar deck into the portal dictionaries.
  - Surfaced by: Pass 7, Issues 11 and 12.
  - Files: `src/hosted/i18n/en.json`, `src/hosted/i18n/ar.json`.
  - Verify: the parity test and MG6.

## Design completion summary

```
+====================================================================+
|         DESIGN PLAN REVIEW — COMPLETION SUMMARY                    |
+====================================================================+
| System Audit         | no DESIGN.md; Brand v2 kit used; UI scope   |
| Step 0               | 5/10; all 7 dimensions                      |
| Pass 1  (Info Arch)  | 5/10 → 9/10 after fixes                     |
| Pass 2  (States)     | 6/10 → 9/10 after fixes                     |
| Pass 3  (Journey)    | 6/10 → 9/10 after fixes                     |
| Pass 4  (AI Slop)    | 8/10 → 8/10 (no issues)                     |
| Pass 5  (Design Sys) | 6/10 → 9/10 after fixes                     |
| Pass 6  (Responsive) | 6/10 → 9/10 after fixes                     |
| Pass 7  (Decisions)  | 12 resolved, 0 deferred                     |
+--------------------------------------------------------------------+
| NOT in scope         | written (4 items)                           |
| What already exists  | written                                     |
| TODOS.md updates     | 0 items proposed                            |
| Approved Mockups     | 0 generated (HTML wireframe by preference)  |
| Decisions made       | 12 added to plan                            |
| Decisions deferred   | 0                                           |
| Overall design score | 5/10 → 8/10                                 |
+====================================================================+
```

There are no unresolved design decisions.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex via `/plan-eng-review` | Independent 2nd opinion | 1 | unavailable | codex CLI not installed; native fallback lacks TaskOutput/TaskStop |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open (all resolved) | 11 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | clean | score: 5/10 → 8/10, 12 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, eng plan-review phase, unavailable. The design outside voices were not offered, because the HTML wireframe route was chosen and Codex is not installed. There are no outside findings, and this is not counted as clean.
- **VERDICT:** Design review CLEAR. The eng review found 11 issues and resolved all of them in the plan through D1–D10, but its logged status is issues_open, so it is not CLEAR; eng review required.

NO UNRESOLVED DECISIONS
