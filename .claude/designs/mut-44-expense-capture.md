# MUT-44 — Hosted UI: expense capture (design brief)

**Status:** draft, awaiting owner approval. **Epic:** MUT-34. **Blocked by:** MUT-42 (Done — server routes, schema, scopes all merged to `main`). **Builds on:** `.claude/designs/hosted-portal.md` §2, §7; `.claude/designs/mut-42-hosted-expenses.md`; ADR-037 (+ MUT-39/42/43 amendments). **Branch:** `feature/mut-44-expense-capture` (worktree already created, no commits yet).

## 1. Problem and acceptance criteria

Expenses are the one thing a hosted tenant may write (ADR-037 decision 7; `expenses` row of the writability matrix). MUT-42 built the server side — routes, scopes, receipts, categories, summary — and it's merged. Nothing in the portal calls any of it: `src/hosted/api/client.ts` has no expense methods, `src/hosted/data/queries.ts` has no expense hooks, there is no expense route, list or form anywhere under `src/hosted/`.

Acceptance criteria (ticket, re-cut 2026-10-11 wins over the original text):
1. An expense can be recorded from a drawer-like panel without leaving the current view (no create page).
2. The **presentational** form is shared between the local `ExpenseDrawer` and the portal; each supplies its own data hooks. Extracting it must leave the local drawer's existing behaviour and tests unchanged.
3. Personal vs firm-associated reads off the profile (+ optional client/project); no new classification field.
4. The portal panel is deep-linkable: `/p/$profileId/expenses?expense=<id>` (edit) and `?newExpense=1` (create), round-tripping through the URL.
5. RTL/Arabic parity, including amount and date input.
6. An expense recorded on one device is visible after signing in on another (it's a server write — true by construction once the portal calls the real API).
7. Pickers reuse `EntityTypeahead`'s presentational core fed by hosted data, not the local `ClientTypeahead`/`ProjectTypeahead`/`VendorTypeahead` components themselves (those are Dexie-coupled).

Out of scope (ticket + things the re-cut implies): recurring expense rules, bulk import, OCR, category management UI (create/archive), editing a Malafat-owned row (it owns none).

## 2. Current state (read before planning)

- **Local `ExpenseDrawer`** (`src/components/drawers/ExpenseDrawer.tsx`, 625 lines): one form handling both one-time and recurring expenses via a type selector, `react-hook-form` + `zod`, Dexie-backed hooks (`useExpenseQueries.ts`), `ClientTypeahead`/`ProjectTypeahead`/`VendorTypeahead`/plain `<select>` for category.
- **`EntityTypeahead`** (`src/components/ui/EntityTypeahead.tsx`): already pure presentational — options/inputValue/onSelect as props, zero data-layer imports. Reusable as-is by both builds.
- **`ClientTypeahead`/`ProjectTypeahead`/`VendorTypeahead`**: each wraps `EntityTypeahead` with local Dexie hooks (`useClients`, `useCreateClient`, `useProjects`, `useVendors`, `useFindOrCreateVendor`). Not reusable in the portal — lint bans `(^|/)(db|sync|hooks)(/|$)` imports from `src/hosted/**`, and functionally they'd crash (no IndexedDB in the portal, per ADR-037 decision 10).
- **Portal has no write path today.** `src/hosted/api/client.ts`'s `request()` helper has no `Idempotency-Key`/`If-Match` header support (nothing needed it — every existing portal operation is a `GET`). This is the first write.
- **Portal already has client/project directories**: `useCustomerDirectory(profileId)` and `useProjectDirectory(profileId, customerId?)` in `src/hosted/data/queries.ts`, used today to resolve names in read-only lists. These become the data source for the hosted client/project pickers.
- **No vendor directory exists on the server for hosted profiles.** MUT-42's wire schema has `vendor?: string` with no `vendorId` (unlike local's normalized `Vendor` entity + `vendorId`). **Decision: on hosted, vendor is a plain text input**, not a typeahead — there is nothing to look up or create. The re-cut's "reuse EntityTypeahead fed by hosted data" applies to client and project, which have real hosted directories.
- **Category is a plain `<select>` already, on both sides** — not a typeahead today, and MUT-42 scopes category management (create/archive) out. No change to that shape; hosted categories come from `GET /v1/expense-categories` (auto-seeds on first call, D2 of the MUT-42 brief).
- **Amounts are canonical decimal strings on the wire** (`CreateExpenseRequest.amount: string`), not minor units like local's `amountMinor`. The portal's own `check-bundles`/lint rule **bans `Number()`/`parseFloat` outright** (`hosted-portal.md §7.3`) — `DecimalAmount.tsx` already formats decimal strings via `Intl.NumberFormat` without converting to a number. The amount **input** needs the mirror: a text field validated by a decimal regex (currency's fractional digits), submitted as the typed string, no arithmetic.
- **The portal has no `Drawer`.** `src/components/drawers/**` is lint-banned from `src/hosted/**` ("The portal has its own shell and no drawers", `hosted-portal.md §2`). The hosted-portal brief itself calls the thing to build "a portal `ExpenseDrawer`" (§7.3, §7.5) — meaning a portal-owned slide-over component under `src/hosted/`, not an import of the local one.
- **`lib/i18n` is pre-split for exactly this reuse** (ADR-037 MUT-43 amendment): `src/lib/i18n/core.tsx` is translation-free and provider-agnostic; the app's `index.ts` barrel wraps it with `LanguageProvider`. The portal already imports `useT`/`useLanguage` from `lib/i18n/core` directly (see `PaymentsList.tsx`). **The shared form must do the same** — never import the top-level `lib/i18n` barrel.
- **Portal strings are their own dictionaries** (`src/hosted/i18n/{en,ar}.json`, `hosted.*` namespace, parity-tested against the app's files). All new portal copy goes there, not into the app's translation files.

## 3. Component plan

```
src/components/expenses/
└─ ExpenseFormFields.tsx      NEW — shared, presentational. Amount, currency, date,
                               title, vendor (plain input OR injected slot), category
                               select, notes. Takes a react-hook-form `control` typed
                               to a shared Zod schema subset, categories as a prop,
                               and `clientField`/`projectField` as ReactNode slots
                               (each host wires its own Controller + picker).
                               Imports only lib/utils, lib/i18n/core, components/ui/*
                               — nothing from hooks/db/stores, so it's legal in both
                               builds without changes to the hosted lint allowlist.
└─ expenseFormSchema.ts        NEW — the Zod shape the shared fields validate
                               (amount string + regex, currency, occurredOn, title?,
                               vendor?, categoryId?, notes?). Local's existing schema
                               keeps its recurring-only fields (expenseType, frequency,
                               startDate, endMode, endDate) and composes this shape in
                               rather than being replaced by it.

src/components/drawers/ExpenseDrawer.tsx   CHANGED — renders ExpenseFormFields for the
                               one-time-expense block instead of its inline JSX; keeps
                               its own type selector, recurring fields, Dexie hooks,
                               ClientTypeahead/ProjectTypeahead/VendorTypeahead wiring
                               exactly as today. No behaviour change; existing tests
                               (`ExpenseDrawer.projectField.test.tsx` etc.) must pass
                               unmodified — this is the extraction's main constraint.

src/hosted/api/client.ts      CHANGED — add Idempotency-Key (POST) and If-Match (PATCH)
                               support to `request()`; add expense/category/receipt
                               operations to the `api` object (list, get, create,
                               update, delete, categories, summary, receipt
                               start/complete/download/delete).
src/hosted/hooks/useExpenseQueries.ts   NEW — portal's own query + mutation hooks,
                               mirroring the shape of `data/queries.ts` (cursor lists,
                               `profileKey`) plus mutations with cache invalidation,
                               generating an Idempotency-Key per submit (crypto.randomUUID).
src/hosted/components/ClientPicker.tsx     NEW — EntityTypeahead + useCustomerDirectory,
src/hosted/components/ProjectPicker.tsx    NEW — EntityTypeahead + useProjectDirectory,
                               read-only (no "create new" — MUT-42 D6 validates against
                               existing org records only; the create-new branch of
                               EntityTypeahead's option list is simply never produced).
src/hosted/components/ExpenseDrawer.tsx    NEW — the portal's own slide-over chrome
                               (overlay + panel + header + footer, built fresh, not
                               importing src/components/drawers/Drawer.tsx) wrapping
                               ExpenseFormFields + ClientPicker + ProjectPicker + a
                               plain vendor input + ReceiptUploader (§4).
src/hosted/pages/views/ExpensesList.tsx    NEW — list view, same shape as
                               PaymentsList.tsx/ReceivablesList.tsx: FilterBar
                               (date range, client, category), HostedTable, ShowMore,
                               a "+ Record expense" button opening the drawer.
src/hosted/data/filters.ts    CHANGED — add `ExpenseFilters` + `parseExpenses`,
                               `parseExpenseDrawer` (the `?expense=`/`?newExpense=`
                               pair), following the existing `parse*` pattern exactly.
src/hosted/router.tsx         CHANGED — add `/expenses` under `profileRoute`, like
                               `/payments`.
src/hosted/shell/HostedShell.tsx (or wherever the sidebar list lives)  CHANGED — add
                               "Expenses" nav entry (hosted-portal.md §7.2 already
                               names this as pending on MUT-44).
src/hosted/i18n/{en,ar}.json   CHANGED — `hosted.expenses.*` keys; parity test
                               (`i18n/__tests__/parity.test.ts`) catches any gap.
```

**Amount field, concretely:** `<input type="text" inputMode="decimal">` bound to a string, validated by `^\d+(\.\d{1,2})?$` (ILS/USD/EUR all use 2 fractional digits — confirmed against `DecimalAmount`'s formatter, not hardcoded past this ticket's three currencies), submitted verbatim as `CreateExpenseRequest.amount`. No `Number()`/`parseFloat` anywhere in the hosted path (existing lint rule enforces this at build time). Local keeps its existing `parseAmountToMinor` conversion on its own submit path — the shared schema only constrains the *string shape*, not what each host does with it after validation.

**Receipts (§AC: "Receipt attachment using the signed-URL flow"):** `src/hosted/components/ReceiptUploader.tsx`, modeled on the M6 attachment flow already live for documents (`DocumentsList.tsx` reads; no upload precedent exists yet in the portal, so this is new): `POST …/receipts` → `PUT` the file to `upload.url` with `upload.headers` → `POST …/receipts/{id}/complete`. Shown only once an expense exists (create flow: save the expense first, then allow attaching; matches the server's `expenseId` path requirement). At most 10 receipts/expense (server-enforced; client disables "add" past 10 to avoid a round-trip 422).

## 4. Data flow / API wiring

`src/hosted/api/client.ts` additions (same `api.*` object, same typed-schema pattern as the read operations already there):

```
expenses(profileId, query)              GET  /v1/expenses
expense(profileId, expenseId)           GET  /v1/expenses/{id}
createExpense(profileId, body, idemKey) POST /v1/expenses                (Idempotency-Key)
updateExpense(profileId, id, body, version) PATCH /v1/expenses/{id}      (If-Match: version)
deleteExpense(profileId, id)            DELETE /v1/expenses/{id}
expenseCategories(profileId)            GET  /v1/expense-categories
startReceipt(profileId, expenseId, body) POST /v1/expenses/{id}/receipts
completeReceipt(profileId, expenseId, receiptId) POST …/receipts/{id}/complete
deleteReceipt(profileId, expenseId, receiptId)   DELETE …/receipts/{id}
receiptDownload(profileId, expenseId, receiptId) GET …/receipts/{id}/download
expenseSummary(profileId, from, to)     GET  /v1/summaries/expenses
```

`request()` gains an optional `headers` passthrough (or dedicated `idempotencyKey`/`ifMatch` options) rather than a generic escape hatch, keeping the "one function per operation" discipline the file already documents.

Query hooks (`src/hosted/hooks/useExpenseQueries.ts`, new directory — the portal has no `hooks/` dir yet; this is intentionally *not* `src/hosted/data/` because these include mutations, unlike every existing file in `data/`):
- `useExpenses(profileId, filters)` — `useCursorList`, same as `usePayments`.
- `useExpenseCategories(profileId)` — plain `useQuery`, like `useCustomerDirectory`.
- `useCreateExpense(profileId)`, `useUpdateExpense(profileId)`, `useDeleteExpense(profileId)` — mutations; invalidate `profileKey(profileId, 'expenses', ...)` and `profileKey(profileId, 'summary', 'expenses')` on success.
- Receipt mutations compose the three-step flow into one `useAddReceipt` hook that resolves only after `complete` succeeds, so the drawer shows one pending state, not three.

## 5. Reuse and impact (component registry check)

| Existing | Reused as-is | Notes |
|---|---|---|
| `EntityTypeahead` | Yes | Zero changes |
| `Button`, `Badge`, `SegmentedTabs`, `HostedTable`, `QueryView`, `FilterBar`/`DateFilter`/`ClientFilter` | Yes | Already imported this way by every other hosted list view |
| `lib/i18n/core` (`useT`, `useLanguage`) | Yes | Required reuse path per ADR-037 MUT-43 amendment |
| `ClientTypeahead`/`ProjectTypeahead`/`VendorTypeahead` | No — not portable | Dexie-coupled; see §2 |
| `src/components/drawers/Drawer.tsx` | No — lint-banned | Portal builds its own chrome under `src/hosted/components/` |
| `useExpenseQueries.ts` (local) | No | Local-only; portal gets its own under `src/hosted/hooks/` |

New registrations needed in `COMPONENT_REGISTRY.md`: `ExpenseFormFields` (shared), `ClientPicker`/`ProjectPicker` (hosted), hosted `ExpenseDrawer`, `ReceiptUploader`.

## 6. i18n / RTL

- New keys under `hosted.expenses.*` in both `en.json` and `ar.json`; the existing parity test fails the build if one language is missing a key the other has.
- Amount input: `dir="ltr"` inside RTL text direction (matches `DecimalAmount`'s existing `<bdi dir="ltr">` convention for figures).
- Date input: native `<input type="date">`, already RTL-safe elsewhere in the app; no new handling needed.

## 6a. Design resolutions (plan-design-review pass, 2026-10-11)

**1. Field order, hosted drawer.** Mirrors the local drawer's order minus the fields that don't apply in the portal (no profile selector — the active profile is the URL route; no one-time/recurring type selector — recurring is out of scope): **Amount + Currency (one row) → Date → Title → Vendor → Client → Project → Category → Notes.** Reusing the proven order over inventing a new one keeps the mental model identical for anyone who uses both surfaces (Nielsen's consistency heuristic), and it's the cheapest-to-verify choice since the extracted `ExpenseFormFields` renders this sequence for both hosts by construction.

Category stays a **required** field in the hosted UI even though `CreateExpenseRequest.categoryId` is optional on the wire — D2's auto-seeding guarantees at least one category always exists, and an optional category would quietly produce "uncategorized" rows that break the per-category summary (`GET /v1/summaries/expenses`'s `byCategory` block) the same way local's uncategorized expenses already do. Keeping it required in the UI is a product decision, not a schema one; the shared Zod schema enforces it the same way local's does today.

**2. Error surfacing for the MUT-42 422/409 vocabulary.** Split by whether a field clearly owns the error:
| Server code | Surface |
|---|---|
| `CATEGORY_NOT_FOUND`, `CATEGORY_ARCHIVED` | Inline under Category: "This category is no longer available — pick another" |
| `PROJECT_CUSTOMER_MISMATCH` | Inline under Project: "This matter belongs to a different client" |
| `CUSTOMER_NOT_FOUND`, `PROJECT_NOT_FOUND` | Inline under the respective picker (stale selection — the record was archived/deleted between load and submit) |
| `AMOUNT_INVALID`, `DATE_INVALID` | Inline under the respective field (defense in depth; the client-side regex should catch these first) |
| `TOO_MANY_RECEIPTS` | Inline in the receipt uploader, "add" disabled (also handles the race of two tabs adding concurrently past the client-side count check) |
| `409` stale `If-Match` | **`hosted.components.Toast`** ("This expense changed elsewhere — showing the latest version") + refetch and repopulate the form. Never silently overwrite. |
| Network / unknown `ApiError` | Toast, same component |

`src/hosted/components/Toast.tsx` already exists (failure-only, single message, `role="alert"`) and is the right fit — no new toast mechanism needed. Field-level errors use `form.setError(field, { message })` from the `ApiError`'s `code`, the same mechanism `react-hook-form` already uses for client-side validation errors, so the drawer has one error-rendering path, not two.

**3. Loading / empty / error states.**
- **Expenses list:** identical shape to `PaymentsList.tsx` — `QueryView` gates on `[list, categories, customers, projects]`; zero-result empty state is `Empty` with `hosted.expenses.empty.title`/`.body` plus a primary "Record expense" action (Design Principle 1 — empty states need a primary action, not just "no items found"); a narrowed-filter empty state reuses `NoMatch`.
- **Drawer's own data** (categories + client/project directories, and — in edit mode — the expense being fetched by id): block the drawer body behind a spinner until everything resolves, exactly mirroring the local drawer's existing `isLoading` early return (`if (isLoading) return <Drawer title={t('common.loading')}>…spinner…`). Partial data never renders — same rule local already follows.
- **Submit:** disable the save button and swap its label to `t('common.saving')`, verbatim reuse of the local drawer's existing `isSubmitting ? t('common.saving') : t('common.save')` pattern.

**4. RTL on the amount input (not just the display).** `DecimalAmount`'s `<bdi dir="ltr">` solves read-only figures; a live text input needs its own treatment or the cursor and digit order fight the surrounding RTL flow while typing. The amount `<input type="text" inputMode="decimal">` gets `dir="ltr"` set directly on the element, and the amount+currency pair sits inside a `dir="ltr"` sub-container so the two read in natural order ("120.00 · ILS") regardless of page direction — the label itself stays in the page's natural direction. This is the same input-isolation convention `DecimalAmount` already established for display; the gap was that nothing said to apply it to the *input* too.

**5. Chrome: portal's own markup, local's interaction pattern.** The portal's `ExpenseDrawer` mirrors the **local drawer's interaction**, not its code: right-side slide-over panel (left in RTL, via logical `inset-inline-end` — the same logical-property convention `hosted.css` already uses for `.hp-switcher-panel`/`.hp-usermenu-panel`), a dim overlay, Escape-to-close, overlay-click-to-close, header with title + close button, footer with Cancel/Save. Checked for an existing reusable primitive first (`usePopover` is an anchored dropdown panel, not a full-screen overlay — not a fit); nothing else in `hosted.css` provides this, so it's new CSS (`.hp-drawer`, `.hp-drawer-overlay`) built from the portal's existing spacing/elevation tokens, not a copy of the app's `.drawer`/`.drawer-overlay` classes (which live in app-only CSS the hosted bundle doesn't import). Mirroring the *interaction* keeps the product feeling like one app across surfaces (Apple-design-adjacent "spatial consistency" — a user who's used the desktop app shouldn't have to relearn what a slide-over does); owning the *markup and CSS* keeps the portal's bundle genuinely independent, matching ADR-037 decision 10.

## 7. Cost / infra

No new infra (MUT-42 already covers the bucket/TTL/tables). Client-side cost: one more query hook file, a handful of new routes bundled into `dist-hosted` (small — text/select/typeahead inputs, no new heavy dependency; `react-hook-form`/`zod` are already project dependencies, just newly exercised inside the hosted bundle).

## 8. Test plan outline (full plan follows approval, as `mut-44-expense-capture-tests.md`)

- **Extraction regression:** every existing `ExpenseDrawer` test (incl. `ExpenseDrawer.projectField.test.tsx`) passes unmodified after the extraction — this is the hard constraint, not a nice-to-have.
- **`ExpenseFormFields` unit tests:** renders, validates (amount regex, required category), calls `onSubmit`-equivalent with the right shape, independent of any data hook.
- **Hosted API client:** `Idempotency-Key` sent on create, `If-Match` sent on update with the current version, 409/422 surfaced as `ApiError` like every other operation.
- **Hosted query hooks:** cache invalidation on create/update/delete touches the right `profileKey`s (expenses list + expense summary), using the existing MSW-or-equivalent test harness in `src/hosted/__tests__/harness.tsx`.
- **`ClientPicker`/`ProjectPicker`:** options come from the directory query, no "create new" branch ever renders.
- **Routing/deep links:** `?newExpense=1` opens the drawer in create mode; `?expense=<id>` opens it in edit mode; closing clears the param; both round-trip through `parseExpenses`.
- **Receipts:** start → PUT → complete sequence, the 10-receipt cap disables "add" at the boundary, download opens the signed URL.
- **i18n parity:** existing test catches any `hosted.expenses.*` key present in one language and not the other.
- **RTL:** existing visual/aXe-style check (whatever MUT-43 already runs) extended to the new drawer.
- **Local-side coverage beyond "don't regress":** the only existing `ExpenseDrawer` test (`ExpenseDrawer.projectField.test.tsx`) covers one thing — the projects-area toggle. It's behavior-based (RTL queries, real Dexie round-trip, no snapshots), so the extraction is low-risk for *that* test, but "it still passes" is a weak signal on its own: nothing today exercises amount/currency/date/title/vendor/category/notes through the drawer at all. The extraction adds new local-side tests for exactly that surface, run through the real `ExpenseDrawer` (not a bare `ExpenseFormFields` render) so the extraction is verified in its actual host, not just in isolation.

### Cross-ticket risk: receipts depend on CSP that doesn't exist yet

MUT-45 ("Serve the hosted portal: domain, cookies, CSP and Terraform") is still **To Do** and owns the portal's Content-Security-Policy. Right now there is **no CSP anywhere in this repo** (`grep -rn "Content-Security-Policy\|connect-src"` returns nothing) and **no precedent for a cross-origin signed-URL upload anywhere in the client**, local or hosted — the local app's document storage never leaves Dexie, so there's nothing to copy. The receipt flow is `PUT` to a storage-bucket URL that is **not** same-origin with the API, so it must bypass `api/client.ts`'s `request()` (which hardcodes `credentials: 'same-origin'` and only targets `/v1/*`) and use a bare `fetch()` instead.

If MUT-45 ships a `connect-src` that only allows the API's own origin, receipt uploads silently break in the browser with no server-side symptom — the PUT never leaves the page. Two options:
1. **Build receipts now, flag the CSP origin requirement on MUT-45** (add a line to that ticket: "connect-src must include the storage bucket's upload origin") so it's not discovered after the fact.
2. **Land MUT-44 without receipts**, make them a fast-follow once MUT-45's CSP is drafted alongside it, so the two land together and the origin is never missing.

Recommend (1) — the AC explicitly wants receipts, and today's absence of CSP means nothing blocks local dev or testing; the risk is purely "ships broken the day MUT-45's CSP goes live" if the two tickets don't coordinate. Flagging it now costs one sentence on MUT-45 and prevents a silent breakage later.

## 9. Open decisions for review

1. **Vendor on hosted is plain text, not a typeahead** (§2) — a deliberate narrowing of the pre-recut ticket text ("vendor selection reusing the existing typeahead components"), justified by there being no server-side vendor directory for hosted profiles. Flagging explicitly since it reads as scope-reduction.
2. **`src/hosted/hooks/` is a new top-level dir**, parallel to `src/hosted/data/`, specifically because `data/` as named and documented ("query hooks… nothing is placed in the cache ahead of the server") is read-oriented; mutations get their own home rather than overloading that file's stated contract. Alternative: put them in `data/queries.ts` anyway and accept the doc comment going slightly stale. Recommend the new file; cheap to reverse if review disagrees.
3. **Receipts are in-scope per the ticket** but are the most isolable chunk — if time pressure hits, they can land as a fast-follow without blocking amount/category/client/project capture, since the server already supports adding receipts to an existing expense at any time.

## Business / product impact

Expenses are the *only* write a hosted (Malafat-fed) tenant gets in v1 — without this ticket, MUT-34's hosted portal is read-only and the "hosted profile" story (ADR-037) has no action a signed-in partner can actually take beyond looking at numbers Malafat already shows them elsewhere. This is also the one remaining story under epic MUT-34 (MUT-35–43 all shipped); landing it closes the epic's build work, leaving only MUT-45 (serving/infra) before the portal can go live for a real tenant.

## Result (2026-10-11)

Built as approved, with two corrections found during implementation (both recorded as the ADR-037 MUT-44 amendment in `.claude/DECISIONS.md`, both resolving §9's open decisions):

- **No new CSS.** `src/index.css` (with the local `.drawer`/`.drawer-overlay` classes §6a point 5 assumed were app-only) is in fact imported by both builds — confirmed by checking `src/hosted/main.tsx`. `src/hosted/components/Drawer.tsx` renders those exact classes instead of inventing `.hp-drawer`/`.hp-drawer-overlay`, which is simpler and keeps the two drawers visually identical by construction rather than by manual upkeep.
- **`data/`, not `hooks/`.** The lint rule banning `(^|/)(db|sync|hooks)(/|$)` matches the literal path segment anywhere under `src/hosted/**`, not specifically the local app's hooks — `src/hosted/hooks/useExpenseQueries.ts` failed lint on contact. Moved to `src/hosted/data/expenseQueries.ts`, resolving §9 decision 2 in favor of `data/`.

Gates: `npx vitest run` 160 files / 2537 passed / 5 skipped; `npm run lint` 0 errors (17 pre-existing warnings, unrelated); `npm run typecheck` both programs clean; `npm run test:bundles` passed after adding `json-schema.org` (an inert zod string literal, already allowlisted for local/desktop) to the hosted allowlist. Posted a CSP `connect-src` note on MUT-45 (comment 10956) for the receipt-upload origin per §6a's cross-ticket risk.
