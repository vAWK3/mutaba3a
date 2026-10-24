# MUT-254 — Vendors saved automatically from any typed vendor (server, portal, phone)

Epic MUT-252 (firm-v1). It blocks MUT-256 (reader vendor learning), MUT-257,
MUT-260 (drawer typeahead), MUT-303 (vendor defaults) and MUT-308 (bills).

Tracker: Jira · barmajiyat · MUT via atlassian-barmajiyat · Backlog → Planned →
In Progress → In Review (after both parts and their QA flows pass).

Delivered in two parts on one ticket:
- **A, mini-crm:** server + portal. Merged first.
- **B, flutter:** phone, built on A.

## Binding decisions

- **Epic D4:** one vendor record per profile, matched by registration number
  first. Any typed vendor on any hosted expense is saved automatically, on
  personal profiles too.
- **V1 (Basel, 2026-10-24):** saving matches **exactly**:
  1. registration no.;
  2. then the normalised name or an alias.

  Near-misses only show as **typeahead suggestions** the person may pick.
  The server never fuzzy-merges on save. Duplicates are possible; merging is
  logged tech debt.
- **V2 (Basel, 2026-10-24):** phone scope is a Vendor field in the capture
  Details sheet and in the expense edit sheet, with suggestions from the
  server while online. Offline the person types plain text and the server
  resolves it on upload. The vendor list is not cached on the phone.
- **Malafat's API key stays out of vendors** (MUT-298 D1; firm-books.md:434).
  Vendors are session-only, like expenses.
- **The local web/desktop app is untouched** (epic D5, ADR-024). Its Dexie
  vendors and fuzzy `findOrCreate` stay as they are. The signed-out portal
  runs this server on the memory store, so it gets the server behaviour.
- **Out of scope:** a vendor management page, merging vendors, MUT-303
  defaults (currency/VAT), and editing a vendor's regNo/phone/email by hand.

## Data model (Prisma; one migration)

```
Vendor        id, organizationId, canonicalName, registrationNo?, registrationKey?,
              phone?, email?, lastCategoryId? (FK SetNull), createdAt, updatedAt, version
              @@unique([organizationId, registrationKey])   -- partial: registrationKey IS NOT NULL
VendorName    id, organizationId, vendorId (FK Cascade), name, nameKey, createdAt
              @@unique([organizationId, nameKey])           -- canonical name + every alias
Expense       + vendorId? (FK SetNull), @@index([organizationId, vendorId])
```

- `VendorName` holds the canonical name **and** every alias. The unique
  `(organizationId, nameKey)` makes "exactly one vendor per name" safe under
  concurrency: two saves of a new name race on the unique index, and the loser
  re-reads the winner.
- `Expense.vendor` (free text) stays as written: it is history and display.
  `vendorId` is the link.
- **Keys** (`server/src/vendors/keys.ts`, pure, unit-tested):
  - `vendorNameKey(raw)`, in order:
    1. NFKC, then lowercase.
    2. Strip Arabic tashkeel and tatweel.
    3. Fold `أإآٱ→ا`, `ى→ي`, `ة→ه`.
    4. Strip ASCII and Arabic punctuation (`، ؛ ؟ « »` and the ASCII set the
       local normaliser strips); `-` and `_` become spaces; collapse
       whitespace.
    5. Strip one trailing legal suffix: llc, inc, ltd, co, corp, corporation,
       company, llp, plc, gmbh, ag, sa, sarl, בע"מ, בע״מ, בעמ, ش.م.م, ذ.م.م,
       ش.م.ع.
    6. Strip a leading English "the". Never strip Arabic "ال": it is part of
       names.
    7. An empty key means "no vendor".
  - `registrationKey(raw)`: digits only, Arabic-Indic digits folded. Fewer
    than 5 digits means none.
- `canonicalName` keeps the person's first spelling, trimmed. No title-casing,
  which means nothing in Arabic or Hebrew.

## Resolution (`server/src/vendors/resolve.ts` + store `vendors.resolve`)

`resolveVendor({ organizationId, name, registrationNo?, phone?, email?, categoryId? }, at)`
returns `vendorId | null`. It runs in one store transaction:

1. `nameKey` is empty → `null` (no link; the free text is kept if the client
   sent any).
2. If a registrationKey is given, look it up. **Hit:** add `name` as an alias
   if its key is new; fill a missing phone/email (never overwrite); return
   the vendor.
3. Look up `nameKey` in VendorName. **Hit:** fill a missing
   registrationNo/phone/email. If the vendor already has a *different*
   registrationKey, keep the vendor's own and log it at info (no merge, no
   error). Return the vendor.
4. Otherwise create the Vendor and its VendorName. On a unique violation
   (a concurrent create), re-read and return the winner.
5. If `categoryId` is set, `lastCategoryId = categoryId`: the last edit
   becomes the default (firm-books §6.2).

Callers resolve **before** the expense write, then pass `vendorId`. If the
expense write fails afterwards, the vendor stays: it is harmless and still
right.

**Writers** (every path that sets `Expense.vendor`):
- `POST /v1/expenses`;
- `PATCH /v1/expenses/{id}`: only when `vendor` or `categoryId` is in the
  patch. `vendor: null` clears `vendorId`. A category change updates the
  linked vendor's `lastCategoryId`;
- inbox `file-as-expense`;
- receipts `approve`.

All four go through one `withResolvedVendor()` helper in
`expenses/compose.ts`. MUT-389 `file` changes no expense field, so it is not
a writer.

**API additions** (additive; minor bump to the next free version, ADR claimed
at build):
- Create, update, file-as-expense and approve requests take an optional
  `vendorDetails: { registrationNo?, phone?, email? }`, used only for
  resolution. MUT-257 sends the reader's values here.
- `ExpenseSchema` gains `vendorId: uuid | null`.
- `GET /v1/vendors?q=&limit=` (typeahead), session-only, `expenses:read`:
  - `q` empty → the 10 most recently used (`updatedAt desc`);
  - otherwise score the profile's names in JS with one shared scorer: a
    prefix on any name key 1.0, contains 0.8, Levenshtein similarity ≥ 0.6
    (fuzzy, suggestions only);
  - best name per vendor, top `limit` (default 10, max 25);
  - each item:
    `{ id, name, matchedName, registrationNo, phone, email, lastCategoryId }`;
  - per-profile scan, capped at 2,000 names. A profile with more gets the
    prefix/contains matches from SQL `LIKE` on `nameKey` instead (noted as
    a limit).

## Platform plumbing

- Store ports, Prisma and memory get a `vendors` repo (`resolve`, `search`,
  `getById`, `listRecent`). The **store guard** classifies them under the
  `expenses` domain (session-only; API key `none`).
- **Local mode:**
  - `CURRENT_STORE_SNAPSHOT_VERSION` → next.
  - A local migration that adds the vendors and vendorNames maps and
    `vendorId: null` on expenses.
  - Fingerprint test, `everyRecord` fixture, and the hosted export.
  - Records export: vendors are included (with parity test).
  - The local-format number is coordinated with the live sessions
    (MUT-302/307/308 lines in ADR-167).
- **Backfill** (`server/src/scripts/backfill-vendors.ts`):
  - Idempotent, with `--dry`.
  - For each expense with non-empty `vendor` and `vendorId` null, run
    `resolveVendor` (no categoryId, so it never moves `lastCategoryId`).
  - Wired into `post-roll.ts` (deploy step 7), so rows the old revision writes
    during the roll are linked too.
- Docs:
  - ADR (next free number, checked against live worktrees at build).
  - TECH_DEBT: no vendor page or merge; the typeahead's 2,000-name cap.
  - CHANGELOG, TEST_PLAN, COMPONENT_REGISTRY (VendorPicker), DEPLOYMENT
    (backfill step).

## Portal (part A)

- `src/hosted/components/VendorPicker.tsx`, on `EntityTypeahead` like
  `ClientPicker`:
  - debounced `GET /v1/vendors?q` (a react-query hook in
    `src/hosted/data/expenseQueries.ts`);
  - free text allowed: the typed text is the vendor;
  - picking a suggestion fills the name and, **if no category is chosen
    yet**, its `lastCategoryId` (archived categories are skipped).
- `ExpenseDrawer` swaps the plain input for VendorPicker, on create and edit.
  The `:32` comment goes.
- i18n keys in `en.json` and `ar.json`; RTL checked.
- Playwright:
  - `FakeApi` gains a `vendors` handler and resolves vendors on expense POST
    like the server.
  - New feature `portal.expenses.vendor-typeahead`: type a new vendor → save
    → reopen → the suggestion shows → picking it prefills the category.
  - The existing `create` spec stays green.

## Phone (part B)

- **Drift v10:** `money_event.vendor TEXT NULL`, migration test.
- `CaptureDraft.vendor`, with `setVendor`, following the `setNote` pattern.
- **Details sheet:** a Vendor row (`DetailsSheet.vendorKey`) opens
  `VendorPickerSheet`, modelled on `category_picker_sheet.dart`:
  - a search field, and online, suggestions from `VendorsRepository.search(q)`;
  - an offline note ("Type the name; it's matched when you're back online");
  - picking a suggestion sets the vendor and, if no category is set yet, its
    last category, when it is in the cached categories.
- Outbox: the create payload sends `vendor` (`outbox_uploader.dart:886`).
  Unconfirmed edits carry it. Inbox `fileAsExpense(vendor:)` is wired, and
  the saved-expense edit PATCHes `vendor`.
- Recent rows already fall back to the vendor for a row title. Unchanged.
- en/ar arb strings; RTL.
- **Release-QA:** `qa/features/ios/capture.yaml` feature `vendor`:
  1. type a new vendor in Details → save;
  2. a second capture's vendor search suggests it;
  3. picking it prefills the category;
  4. the server's expense carries the `vendorId`.

  The flow file is `integration_test/qa/capture_vendor_test.dart`, with
  `qaStep`s per AC. Run on the QA simulator with `--wait`.

## Tests

| Layer | What | Command |
| --- | --- | --- |
| Unit | `vendors/__tests__/keys.test.ts`: case, spacing, punctuation (ASCII + Arabic), Arabic folding, tashkeel/tatweel, legal suffixes (Latin, Hebrew, Arabic), leading "the" only, empty; registrationKey digits incl. Arabic-Indic; scorer ranks prefix > contains > fuzzy | `npm --prefix server test` |
| Store contract (memory + Prisma) | `store-contract-vendors.ts`: new name creates one; case/spacing reuses; regNo hit with a new name adds an alias; name hit fills a missing regNo, never overwrites a different one; lastCategory moves only with a category; per-profile isolation; concurrent creates of one new name yield one vendor (Prisma); search prefix/contains/fuzzy and recent | `test` + `test:db` (private DB) |
| Routes | `routes-vendors.test.ts`: all four writers link `vendorId`; PATCH vendor:null clears it; category change moves lastCategory; vendorDetails used; API key refused (403/none); another profile's vendors never listed; typeahead in ar/he/Latin | `test` |
| Backfill | idempotent (second run links 0), `--dry` writes nothing, never touches lastCategory | `test:db` |
| Local mode | snapshot migration, fingerprint, export parity | `npm run test:run` (root) |
| Portal | VendorPicker unit (free text, pick, prefill only when empty, Arabic) + Playwright feature | `npm run test:run`, `release-qa run --only portal.expenses.vendor-typeahead` |
| Phone | drift v10 migration; CaptureDraft vendor; picker sheet widget (online, offline, prefill rule); outbox payload carries vendor; QA flow `ios.capture.vendor` | `flutter test`, `release-qa release --only ios.capture.vendor --wait` |

## Acceptance criteria → proof

| AC | Proof |
| --- | --- |
| New vendor on phone or portal creates exactly one; different case/spacing reuses it | contract + routes; Playwright `portal.expenses.vendor-typeahead`; iOS `ios.capture.vendor` |
| Matching regNo reused when the name differs; the new name becomes an alias | contract + routes (vendorDetails) |
| Typeahead suggests the profile's vendors in ar/he/Latin; choosing one prefills last category | routes (scripts) + portal and iOS flows (prefill step) |
| One profile's vendors never visible on another | contract + routes |
| Backfill idempotent | backfill test |
| OpenAPI, openapi:check, test:db green; release-QA specs for portal and phone | commands + the two flows |

## Risks

- **Size.** About 30 files across two repos. Commits go by layer (keys →
  store → routes → backfill → local mode → portal), then the phone.
- **The rolling deploy:** the old revision writes expenses without
  `vendorId`. The post-roll backfill covers it.
- **Local-format version collisions** with concurrent mini-crm sessions:
  claimed at build, under the lock rules.
- **ADR and API version numbers:** both claimed at build. ADR-182 is earmarked
  for MUT-253's engine ADR (drafted in the flutter repo, lands after Basel's
  device run), so MUT-254 takes the next number after a fresh check.

## Business / product impact

- No more retyping vendors. Every expense remembers who it was paid to,
  which is the base for reading receipts (MUT-256), firm vendor defaults
  (MUT-303) and bills (MUT-308).
- It unblocks the reader and the portal gallery's typeahead. Firm v1 needs
  it.

## Amendments after eng review (2026-10-24) — these override the sections above where they differ

**Server resolution**

- **A1. Retry the whole resolve on a unique violation.**
  - The `vendors.resolve` transaction is retried once, as a whole, on P2002
    (Vendor `registrationKey` or VendorName `nameKey`), following
    `paymentWrite`'s retry (prisma.ts:1379).
  - No read follows a failed insert inside the same transaction: Postgres has
    aborted it by then.
  - The memory store mirrors this (create checks under one synchronous
    section).
- **A2. Link first, touch after.** Resolve runs only after all validation
  (`prepareExpenseCreate` / `expensePatch` / the approve and file checks). It
  creates or links and returns `vendorId`.
  - A separate `vendors.touch(vendorId, { categoryId?, at })` runs only after
    the expense write succeeded. It sets `lastUsedAt` and, when given,
    `lastCategoryId`.
  - A refused request (stale 409, already_filed, an archived category) never
    moves a default.
  - `touch` doesn't bump `version`.
- **A3. "Other" never becomes a default.** `touch` ignores a categoryId that is
  the profile's automatic Other category (the phone saves Other when nothing
  was picked, `capture_providers.dart:1169`). Prefilling Other is never
  useful, so no client flag is needed.
- **A5. Name collisions don't error.**
  - On a regNo hit, add `name` as an alias only if its nameKey is absent in
    the profile. If another vendor already holds that name, keep it there and
    log at info.
  - Filling a missing regNo, phone or email uses a conditional `updateMany`
    (`… IS NULL`). A P2002 there means "skip", never a 500.
- **A6. The order of key rules is fixed.** Legal suffixes are matched in their
  post-punctuation forms (`בעמ`, `שמם`-style: `شمم`, `ذمم`, `شمع`), with tests.
  - A suffix or a leading "the" is stripped only if something remains, so
    "Company", "SA" and "The Inc" stay valid names.
  - `&` folds to a space, so `H&M` and `H & M` match.
  - `registrationKey` also folds Extended Arabic-Indic digits (۰-۹).
- **A7. Recent means recently used:** `Vendor.lastUsedAt`, set by `touch`. The
  typeahead with an empty `q` sorts by `lastUsedAt desc`.
- **A8. Deadlock path through the category FK.**
  - `Vendor.lastCategoryId` gets `@@index([lastCategoryId])`.
  - `replaceCategories` (profile type change, prisma.ts:2297) clears
    vendors' `lastCategoryId` for the categories it deletes first, after
    locking the vendors `FOR NO KEY UPDATE` in a fixed order. The memory store
    does the same.
  - A lock-order test, modelled on the MUT-182 one.
- **A9. Rolling deploy and rollback.** Post-roll also re-links rows whose
  `nameKey(vendor)` isn't among the linked vendor's names (written by the old
  revision). Documented in DEPLOYMENT.
- **A10. Backfill.**
  - Runs `createdAt asc`, so `canonicalName` is the first spelling.
  - After linking, it sets `lastCategoryId` from each vendor's newest
    non-Other categorised expense, only where it is null. Idempotent.
  - It sets `lastUsedAt` from the newest linked expense.
  - Empty-key rows are skipped. They are rescanned on each run, which is cheap
    and noted.
- **A11. Audit.** Vendor creates and aliases aren't audited in v1; the expense
  audit carries `vendor` as today. If audit is ever added, `'vendor'` must
  join `EXPENSE_ENTITY_TYPES` so API keys can't read it (compose.ts:14). This
  is noted in the ADR.
- **A12. Local mode and export.**
  - Both `vendors` and `vendorNames` maps go into the snapshot and the export:
    `SNAPSHOT_FIELDS` (records-file/codec.ts:15), the profile-owned field map
    (ports.ts:2610), and `prisma-records-export.ts`, where the expense column
    list gains `vendorId`.
  - Snapshot version 5 → 6, plus a local migration, the fingerprint and the
    parity test.
- **A13. Writability.** `GET /v1/vendors` goes into the brief's matrix table and
  `WRITABILITY_MATRIX` (auth/writability.ts), session-only, so the drift test
  stays green.
- **A15/A16. Simpler typeahead.**
  - A plain `@@unique([organizationId, registrationKey])`; NULLs are distinct
    in Postgres, so no partial index.
  - The typeahead always prefilters with SQL `LIKE` on `nameKey` (prefix or
    contains), plus the 50 most recently used, then scores in JS. One path in
    both stores, with no 2,000-name cap.
- **A17. TECH_DEBT** additionally logs that orphan and typo vendors stay in
  suggestions until merge or delete exists.
- **A18. FakeApi** (portal QA) resolves with the exact key only, kept minimal.
- **A19. Demo seeding** writes vendor text. Those rows link through the
  post-roll backfill, which is intended.

**Phone**

- **A4. Unsorted captures have no Vendor row.** InboxEntry is user-scoped, with
  no profile to resolve against, so the row is hidden when the target is
  Unsorted.
  - Filing an Unsorted entry doesn't add a vendor input in v1, but
    `fileAsExpense` keeps its `vendor` parameter for later.
  - The file action's idempotency tuple (recent_providers.dart:676) includes
    `vendor` whenever one is sent.
- **A14. Edit sheets.** The shared `_showAmountNoteSheet` (recent_actions.dart
  :1006-1150) gets a Vendor row for unsent rows and saved feed expenses, not
  for Unsorted entries.
  - `editWaitingOrFailed` and `editSavedExpense` carry vendor.
  - Saved expenses PATCH `vendor` only when it changed.
  - The MUT-132 "alreadySaved" handling covers vendor like note.
  - Drift v10 is claimed at build against parallel branches (MUT-124 is in
    flight).

**Part B ordering:** the phone part starts after MUT-124 merges, since both
touch capture and share providers.

## Decision ledger

Remedies were auto-decided per Basel's standing instruction (2026-10-24); none
changed his V1/V2 decisions, the scope or the cost materially.

| ID | Finding | Source | Disposition |
| --- | --- | --- | --- |
| R1 | Unique violation aborts the transaction; re-read impossible (High, 9/10, prisma.ts:1379 pattern) | outside #1 | A1 |
| R2 | Refused requests move lastCategoryId (High, 9/10, expenses.ts:227, receipts.ts:305) | outside #2 + native | A2 |
| R3 | Automatic Other overwrites defaults (High, 9/10, capture_providers.dart:1169) | outside #3 | A3 |
| R4 | Unsorted captures can't carry a vendor; file tuple (High, 9/10, outbox_uploader.dart:858) | outside #4 | A4 |
| R5 | regNo-hit alias collides with another vendor (Medium) | outside #5 | A5 |
| R6 | Key-rule order defeats suffixes; suffix-only names (Medium, 9/10) | outside #6 | A6 |
| R7 | Recent by updatedAt doesn't track use (Medium) | outside #7 | A7 |
| R8 | lastCategoryId FK deadlock path in replaceCategories (Medium, 8/10, prisma.ts:2297) | outside #8 | A8 |
| R9 | Stale links from old revision/rollback (Medium) | outside #9 | A9 |
| R10 | Backfill sets no defaults/first spelling (Medium) | outside #10 | A10 |
| R11 | Audit and API-key exposure (Medium) | outside #11 | A11 |
| R12 | Export needs vendorNames; field maps (Medium) | outside #12 | A12 |
| R13 | Writability matrix drift test (Medium) | outside #13 | A13 |
| R14 | Phone edit-sheet paths (Medium) | outside #14 | A14 |
| R15 | Partial unique unnecessary (Low) | outside #15 + native | A15 |
| R16 | Two typeahead paths (Low) | outside #16 | A16 |
| R17 | Typo vendors linger (Low) | outside #17 | A17 |
| R18 | Digits, ampersand, FakeApi drift (Low) | outside #18 | A6/A18 |
| R19 | Seed script (Low) | outside #19 | A19 |
| R20 | Old phone builds already send vendor text, which the server links | native | noted (a benefit) |

Structure (complexity gate, about 30 files across two repos): kept as two parts
on one ticket; the parts are already the smaller arrangement.

Approval readiness: PASS.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | native Claude Plan subagent (Codex not installed) | Independent 2nd opinion | 1 | unavailable (native fallback completed) | 19 findings, all dispositioned |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open (all resolved into plan) | 3 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** Codex not installed. A native Claude Plan subagent completed with 19 findings (4 High), all folded in as A1–A19.
- **VERDICT:** Eng review complete, findings folded in; ready for /eng-build (part A first; part B after MUT-124 merges).

NO UNRESOLVED DECISIONS
