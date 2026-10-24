# MUT-291 — Bring your records from the old web app to the new address

Epic MUT-284 (one app). Blocked by MUT-286 (Jira In Review, but shipped in api-v0.3.14, so resolved in practice). Blocks MUT-292 (retire the web app, at least 90 days after this ships).
Also owns MUT-112's leftovers (Jira comment 12471): stage `redirect`, then dropping the phone's legacy run.app link host.
Builds on ADR-097 (local mode), ADR-155 (domain move, §7 of `.claude/designs/mut-326-domain-move.md`), MUT-287 (records zip, Restore) and MUT-285 §11 (bridge constraints).
Status: **planned 2026-10-24, not built.** Owner decisions D1–D4 were answered by Basel on 2026-10-24.

## 1. Problem

Two groups of people have records in a browser origin the new address can't read:

| Move | Old origin | What's there | Who |
|---|---|---|---|
| **A** | `mutaba3a.netlify.app/app` | the free web app's Dexie database | every free-app user (the free app sends no analytics, so the count is unknown) |
| **B** | the run.app portal | portal local-mode records (format of `src/hosted/local`) | anyone who used the signed-out portal on run.app between api-v0.3.14 (2026-10-19) and stage `live` (2026-10-21), so probably very few |

IndexedDB belongs to its origin, so without a bridge both groups lose their records when they move. Move B also gates stage `redirect`: the server already sends every old-host page visit to `/carry-over` at that stage (`server/src/app.ts:508-514`), and that page doesn't exist yet.

## 2. Acceptance criteria

| AC (ticket) | Met by |
|---|---|
| A real Dexie dataset arrives with matching record counts and per-currency totals | §3.4 totals gate; integration test T-I1 (fixtures made by the real free app over fake-indexeddb); QA `web.carry-over` |
| Records that can't be mapped are listed for the user, not dropped silently | §3.3 `CarryOverReport` (`notCarried` + `changed`), shown before anything is written; T-U4..U9 |
| The bridge's mapping is tested against fixtures | `mapFreeAppBackup` unit suite, T-U1..U12 |
| Landing "Open app" links point to the portal | **already true**: the landing links only to `hostedPortalUrl()` (HeroSection, GetItSection, LandingHeader). Pinned by T-U14 |
| Guardrail: the landing stays on Netlify | unchanged; the netlify origin serves the landing and the old app's carry-over screen |
| Guardrail: RTL, Arabic default | both screens use the existing dictionaries (free app `src/lib/i18n/translations/{ar,en}`, portal `src/hosted/i18n/{ar,en}.json`), Arabic first |
| Guardrail: release-QA feature + passing tagged spec (web) | §8 |
| From MUT-112: stage `redirect`, then drop the phone's legacy link host | §6 steps 3–4 |

## 3. Design

### 3.1 One receiver, two senders, one way in

```
 Move A  mutaba3a.netlify.app/app                     Move B  run.app/carry-over?next=…
 ┌──────────────────────────────┐                    ┌──────────────────────────────┐
 │ CarryOverScreen (free app)   │                    │ CarryOverPage (portal)       │
 │ serializeAllTables() → JSON  │                    │ exportRecords() → records zip│
 └──────────────┬───────────────┘                    └──────────────┬───────────────┘
                │ window.open(app.mtb3a.com/carry-over/receive?from=web|portal)
                │ ← "ready"   → { kind, payload: Blob }   ← "done" + counts/totals
                ▼                                                   ▼
 ┌──────────────────────────────────────────────────────────────────────────────────┐
 │ app.mtb3a.com/carry-over/receive  (ReceivePage, portal)                          │
 │  kind "free-app-backup" → parse (zod) → mapFreeAppBackup → replay into a THROWAWAY │
 │                           in-memory createLocalApp → snapshot + files + report   │
 │  kind "records-file"    → decodeRecordsArchive (existing)                        │
 │  → summary screen (counts, totals, changed, not carried, JOD warning)            │
 │  → existing applyRestore (replace; D3 confirm if this device already has records)│
 └──────────────────────────────────────────────────────────────────────────────────┘
```

**Why the mapping runs on the receiving side (decision E1).** The free web app's bundle may carry nothing of the portal: `scripts/bundle-rules.ts` `LOCAL_RULES` refuses `X-Mutaba3a-Profile`, `/v1/me` and `/v1/sessions` in `dist-web`. Replaying through the server's routes in the old app would ship those strings. So the old app only sends what it can already make, its own backup (`serializeAllTables()`, `src/db/backup.ts:20`). The portal maps it inside its lazy local chunk, which already carries the server routes. This has three more benefits:
- the mapping lives in `src/hosted`, which MUT-292 keeps, not in `src/`, which MUT-292 deletes;
- **Your data › Restore can also take the old app's backup file**, so the fallback (and moving to another browser or computer) needs nothing new on the old side;
- the receiver writes only through the path that already exists, `applyRestore`: one atomic replace, never a half-written store.

**Why a throwaway app, not POSTs into the live store (E2).** Every write to the live local app saves the whole snapshot to IndexedDB under the cross-tab lock (`transport.ts:97-115`), so replaying n records costs O(n²) bytes written, and an interrupted replay leaves half the records. The replay instead runs `createLocalApp` over a fresh `MemoryLedgerStore` with an in-memory attachment store and no persistence. Every server rule still runs on every record. Then `store.snapshot()` plus its receipt files go through `applyRestore` once. A failure anywhere before that changes nothing on the device. Replay protection (Idempotency-Keys) is still sent, because every create requires it; the keys are `carry:<dexieId>:<op>`. Carrying twice can't duplicate anything, because a carry-over *replaces* (D3).

### 3.2 The protocol (`src/hosted/carryOver/protocol.ts`, pure, shared by both senders and the receiver)

- **Naming (R4).** Nothing in `src/hosted` says "Dexie": `HOSTED_RULES` refuses `\bDexie\b` in `dist-hosted`. The old app's data is the "free app backup" everywhere in the portal.
- **Origins are baked in at build time and never read from the URL.**
  - The free app's build knows `HOSTS.portalOrigin`; it is already baked as `__PORTAL_URL__`.
  - The portal build gains `__CARRY_OVER_SOURCES__`: `{ web: HOSTS.legacy.landingOrigin, portal: HOSTS.legacy.portalOrigin }` from `config/hosts.json`. It is `{}` unless the stage is `live` or `redirect`, and the receiver refuses everything while it is empty.
  - The sender adds `?from=web|portal`, and the receiver maps that to a baked origin. An unknown or missing `from` means file-only mode (§3.5).
- **Steps:**
  1. The sender opens the receiver with `window.open(url, 'mtb3a-carry-over')` **synchronously inside the click handler, before any `await` (R2)**, never with `noopener`. Safari and Firefox block a popup opened after an await. The records are read in parallel, and the payload goes once both `ready` and the read are done.
  2. The receiver posts `{ type: 'mtb3a.carry-over.ready', v: 1 }` to `window.opener`, with `targetOrigin` set to the baked origin.
  3. The sender accepts a message only when `event.origin === portalOrigin && event.source === popup`. It then posts `{ type: 'mtb3a.carry-over.payload', v: 1, kind, payload: Blob, sentAt }` with an explicit `targetOrigin`, never `'*'`.
  4. The receiver accepts it only when `event.origin` equals the baked origin for `from`, `event.source === window.opener`, and `kind` matches `from`: `web` sends only `free-app-backup`, and `portal` sends only `records-file`.
  5. After the person confirms and the write is saved, the receiver posts `{ type: 'mtb3a.carry-over.done', v: 1, counts, totals }`. It posts `{ type: '…declined' }` if the person cancels.
- **Timeouts.**
  - **Sender:** with no `ready` within 10 s, or a popup that is blocked or closes before `done`, it switches to the fallback (§3.5). Waiting while the person reads the summary has no timeout.
  - **Receiver (R8):** with no payload 20 s after `ready`, or once `window.opener.closed`, it switches to the file picker: "The old page closed; choose your records file instead."
- **No COOP anywhere.** `Cross-Origin-Opener-Policy: same-origin` nulls `window.opener`. Neither the portal (`server/src/app.ts:225-229`) nor Netlify sends it today. T-U17 and T-U18 pin that, so a later hardening pass can't silently break the bridge.
- **Message size.** A `Blob` is structured-cloned, never stringified. The receiver refuses a payload over 200 MB (`CARRY_OVER_MAX_BYTES`), well above a free-app backup with receipts.

### 3.3 Mapping the old app's backup (`src/hosted/local/carryOver/`)

`parseFreeAppBackup(text)` (zod) validates the untrusted file. The schema is written here and does not import `src/types` (portal lint bans the local data layer, and MUT-292 deletes it). It accepts Dexie `version` 24 and up to the free app's current `db.verno`; anything newer is refused as `too-new`.

`mapFreeAppBackup(backup, { today, timezone }) → CarryOverPlan` is pure: `{ steps: PlannedRequest[], report }`. Order: profiles → expense categories → customers → projects → income (owed, received) → settles → expenses → receipts → conversions → archive projects → archive customers.

| Old app (Dexie v24+) | Request(s) in the throwaway app | Rule / change (listed in `report.changed` unless noted) |
|---|---|---|
| `businessProfiles` | `POST /v1/profiles {type: BUSINESS, name, defaultCurrency, timezone}` | **D2:** each business becomes a Business profile, at most 5 (the cap of 6 minus the built-in Personal, which stays empty). Order: default first, then by `createdAt`. A 6th business onwards → `notCarried` (`profile-cap`). Timezone = the browser's. Name over 80 characters is cut (changed). Logo, colour, email and phone have no home (changed, one line per profile) |
| rows with no `profileId` (legacy rows, CSV conversions) | — | assigned to the default business (changed, counted) |
| `clients` | `POST /v1/customers`, then `/archive` if `archivedAt` | email that isn't a valid address is dropped (changed); archived after its projects |
| `projects` | `POST /v1/projects {customerId, currency}` | **D4:** currency = the most common currency of its entries, else the profile's. No client → the profile's "No client" customer |
| income `status=unpaid` (receivable) | `POST /v1/income {kind: owed, customerId, projectId?, title, occurredOn, dueDate?}` | **D4:** no client → "No client" customer (one per profile, created on first need, i18n `carryOver.noClient`). Different currency from its project → keeps its client, drops the project. `dueDate` before `occurredOn` → `dueDate = occurredOn`. Owed notes have no home (changed) |
| `paymentRecords` (partial and full) | `POST /v1/receivables/{id}/settle {amount, paidAt}` per record | deleted records skipped. `paidAt` before the entry's date → the entry's date. `method` other than CASH/BANK → none |
| income `status=paid` | client: owed + one settle per payment record (keeps the title, due date and client). No client: `POST /v1/income {kind: received}` | paid amount not covered by records (`uncoveredPaymentAmount`, `database.ts:1032`) settles on `paidAt` |
| `transactions` kind=`expense` (legacy) and `expenses` | `POST /v1/expenses` | category by name into the profile's expense categories. The vendor text comes from `vendors.canonicalName`. A project from another client → drops the project (changed) |
| `expenseCategories`, expense `categories` | `POST /v1/expense-categories` unless the name already exists (case-insensitive; presets are seeded) | colour not `#rrggbb` → none |
| `receipts` with `expenseId` | receipt start → put the bytes into the in-memory store → complete | PDF/JPEG/PNG, ≤10 MB, ≤10 per expense; anything else → `notCarried` (`receipt-file`) |
| `transactions` kind=`conversion` | `POST /v1/conversions` | same currency on both sides → `notCarried` |
| `vendors` (aliases, vendors with no expense), `recurringRules` / `recurringOccurrences`, receipts with no expense, `documents`, `engagements`, `monthCloseStatuses`, `fxRates`, `settings`, income `categoryId`, `needsReview`, `linkedDocumentId` | — | `notCarried`, one summary line per kind with a count. Nothing is dropped without a line |

**Amounts.** Old-app integers become the API's decimal strings through `minorToDecimal` (`src/hosted/format/currencies.ts:23`); JOD has exponent 3 on both sides. A currency outside `ILS, USD, EUR, JOD` → `notCarried` (`currency`).

**Dates.**
- An ISO datetime becomes a local date in the browser's timezone, never a slice of the UTC string.
- Anything before the floor (today minus 3660 days, MUT-227) → `notCarried` (`too-old`).
- A future date the API refuses (received income, a settle, a conversion) → `notCarried` (`future`).

**JOD (TD-112).** CSV-imported JOD income and expenses may be 10× too small, and nothing marks them, so they can't be fixed automatically. If any JOD income or expense row arrives, the summary shows one warning naming the count: "check these amounts". They are carried as they are.

**Anything the API refuses** (a 4xx from the replay) becomes a `notCarried` item with the API's `details.reason`. Its dependants follow it into `notCarried` (`parent-not-carried`). A 5xx stops the whole carry-over with "Something went wrong; nothing was changed" plus the download fallback. That would be a bug, and a partial copy must never be offered.

### 3.4 Totals gate (the AC's "matching counts and per-currency totals")

- `freeAppTotals(backup, plan)` is pure. Per profile and per currency, it counts and sums what was *planned to be carried*:
  - paid income;
  - outstanding Owed;
  - expenses;
  - conversions.
- The replayed records give the carried side (R3): `snapshotTotals(maps)` is a pure function over the throwaway store's snapshot that computes the same four figures. Outstanding is also cross-checked against the throwaway app's own `GET /v1/summaries/organization` per profile, which gives outstanding, overdue and unallocated per currency only (`server/src/routes/summaries.ts:22`).
- **They must match exactly.** A mismatch means the mapping or the replay is wrong. The receiver then shows "We couldn't check your records; nothing was changed", offers the download fallback and reports nothing anywhere (no telemetry signed out, ADR-097 §10). It never applies a copy that doesn't add up.
- After `applyRestore`, the receiver computes `snapshotTotals` over the live local store and sends it in `done`. The old app shows them next to its own figures.

### 3.5 Fallback, and the file door

- **Old app (A):** "Download my records file" saves `serializeAllTables()` as `mtb3a-free-app-<date>.json`. That's the old app's existing backup format, so the free app needs no new code. Then: "Open app.mtb3a.com › Your data › Restore."
- **Portal (B):** "Download my records" (the existing zip), then Restore on the new host.
- **Your data › Restore (`YourDataDrawer.tsx`)** now also accepts the old app's `.json` backup. `readRecordsFile` recognises it (a top-level `tables` object plus `version`) and routes it through the same parse, map and replay. The confirm then shows the same summary as the carry-over. This also covers a person moving to another browser.
- **The receive page opened directly** (no opener, or an unknown `from`) shows that same file picker.

### 3.6 The screens

**Old app (A), `src/pages/carryOver/`** — the gate sits in front of the app shell, only when the baked stage is `live` or `redirect`:
- **No records on this device:** `location.replace(portalOrigin)`. There's nothing to carry, and new people shouldn't start in an app that is being retired.
- **An installed old app (R7, `matchMedia('(display-mode: standalone)')`):** the popup can't reach back from a home-screen app, so the screen leads with **Download my records file** and the restore steps for app.mtb3a.com, in its own copy. One-click is not offered there.
- **Records, never carried (D1):** the carry-over screen opens first. It names what's on this device (counts per kind), then offers:
  1. **Carry my records over** (primary);
  2. **Download my records file**;
  3. **Keep using the old app for now**. This lasts for this tab (sessionStorage), so the screen asks again on the next visit.
- **Records, already carried (D1):** the app opens, with a banner that stays: "Your records were carried to app.mtb3a.com on <date>. Changes here won't follow." It links to **Carry over again**. The banner's date is a new `Settings.carriedOverAt` field. It is set only on `done`, and its absence is the default, so the field needs no Dexie migration.
- **After `done`:** both sides' figures side by side, "Open MTB3A" (it focuses the receiver window), and the banner from then on.

**Portal (B), `src/hosted/pages/carry-over/CarryOverPage.tsx`, route `/carry-over`** (public, outside `authedRoute`):
- It reads this origin's local records count without booting a session: `persistence.load()` only.
- **None:** `location.replace(PORTAL_ORIGIN + safeNext(next))`, using the existing `src/hosted/session/safeNext.ts`.
- **Some:** "Your records on this device are moving to app.mtb3a.com", with the same three buttons.
- **On the new host** (`location.origin === PORTAL_ORIGIN`), `/carry-over` just goes to `next`.

**Receiver, `src/hosted/pages/carry-over/ReceivePage.tsx`, route `/carry-over/receive`** (public):
- **Waiting:** "Getting your records…".
- **Summary:**
  - counts per kind and per-currency totals;
  - **Changed** (expandable, one line per kind of change, with a count);
  - **Not carried** (expandable, the same);
  - the JOD warning when it applies.
- **This device already has records (D3):** "This device already has N records. Carrying over replaces them." Then **Download what's here first** (the existing export), and **Replace with the carried records** (danger) on a second confirm. **Cancel** sends `declined`.
- **Signed in on the new host (E3):** the summary says the records go to this browser's signed-out space, and that the person can see them after signing out. Moving them into the account is MUT-290 (Backlog). The mode hint is never changed.
- **Done:** "Your records are here", then a link to the first profile. That link is the same one `YourDataDrawer.restoredHome()` builds; it moves into a shared helper.

### 3.7 Where it plugs in

- **Local backend contract** (`src/hosted/session/localBackendContract.ts`): `readRecordsFile(file)` now returns a `PendingRestore` that may carry a `carryOver?: CarryOverReport`. Another method, `prepareCarryOver(kind, payload)`, does the same from a message. No other contract changes.
- **The replay app** (`src/hosted/local/carryOver/replay.ts`):
  - `createLocalApp({ store: new MemoryLedgerStore(), now, attachments: new MemoryAttachmentStorage(), fxRates: null, rateLimitPerMinute: Infinity })`. `rateLimitPerMinute` is a new optional `CreateLocalAppOptions` field that defaults to today's 10,000 (R1): without it, a device with more than about 10k records gets 429s partway through;
  - it yields to the browser every 200 requests and reports `Checking N of M` to the summary screen (R5). It is measured on a 20k-record fixture before shipping, and moves to a Web Worker only if that measurement is too slow;, where `MemoryAttachmentStorage` is a small `Map`-backed `AttachmentStorage` in `src/hosted/local/attachments.ts`;
  - the person and session come from `mintLocalSession`;
  - requests go through `app.request()` directly, never through `transport.ts`, so nothing persists.
- **Records-archive collection** (`collectRecordsArchive`) takes a narrow `{ getFile(key) }` reader instead of `IndexedDbBlobStore`, so the in-memory store can feed `applyRestore` too.

## 4. Decisions

| # | Decision | By |
|---|---|---|
| D1 | The old app offers the move on every visit and allows staying until MUT-292. Once carried, it shows a lasting "changes here won't follow" banner. A device with no records goes straight to the portal | Basel 2026-10-24 (the no-records redirect is derived from it) |
| D2 | Each old business → a Business profile, at most 5; the built-in Personal stays empty | Basel 2026-10-24 |
| D3 | The receiver already has records: show both counts, offer "Download what's here first", replace on a second confirm | Basel 2026-10-24 |
| D4 | Unpaid with no client → a "No client" client. An entry in another currency than its project → keeps the client, drops the project. Every change is listed | Basel 2026-10-24 |
| E1 | Mapping runs in the receiver's lazy local chunk; the old app sends its own backup (bundle rules forbid portal code in `dist-web`) | plan |
| E2 | Replay into a throwaway in-memory app, then one `applyRestore`; never POSTs into the live store | plan |
| E3 | Signed in on the new host: carry into this browser's signed-out space and say so; never switch the mode | Basel 2026-10-24 (D10) |
| E4 | A totals mismatch blocks the write, it never just warns | plan |
| E5 | Your data › Restore also accepts the old app's backup `.json` | plan |

ADR-181 records E1/E2/E4/E5 and the protocol. Its alternatives considered:
- sender-side mapping (refused by `LOCAL_RULES`);
- POSTs into the live store;
- snapshot merge;
- an iframe (refused by `frame-ancestors 'none'`);
- a URL-carried payload (too large).

## 5. Files

**New**
- `src/hosted/carryOver/protocol.ts` (+ `__tests__/protocol.test.ts`): message types, origin checks, the sender and receiver state machines as pure reducers.
- `src/hosted/local/carryOver/freeAppBackup.ts` (zod schema + `parseFreeAppBackup`).
- `src/hosted/local/carryOver/mapFreeAppBackup.ts` (the `CarryOverReport` types live here, D1), `replay.ts`, `totals.ts` (+ `__tests__/` and `__tests__/fixtures/`).
- `src/hosted/pages/carry-over/CarryOverPage.tsx`, `ReceivePage.tsx`, `CarryOverSummary.tsx` (+ tests).
- `src/pages/carryOver/CarryOverScreen.tsx` (the gate rule lives here, D1), `CarriedBanner.tsx` (+ tests).
- `qa/features/carry-over/carry-over.yaml`, `qa/specs/carry-over/carry-over.spec.ts`, `qa/support/carry-over.mjs` (§8).

**Changed**
- `src/hosted/router.tsx`: two public routes.
- `src/hosted/local/index.ts`: `prepareCarryOver`; `readRecordsFile` recognises the old backup.
- `src/hosted/local/attachments.ts`: `MemoryAttachmentStorage`.
- `src/hosted/local/createLocalApp.ts`: optional `rateLimitPerMinute` (R1).
- `scripts/__tests__/check-bundles.test.ts`: a case proving the carry-over chunk passes `HOSTED_RULES` (R4).
- `src/hosted/local/recordsArchive.ts`: the narrow file reader.
- `src/hosted/session/localBackendContract.ts`.
- `src/hosted/components/YourDataDrawer.tsx`: the summary in the confirm; `restoredHome` moves to a shared helper.
- `src/router.tsx` or the free app's root: the gate.
- `src/types` `Settings.carriedOverAt?`.
- Both apps' `ar`/`en` dictionaries.
- `vite.config.ts`: `__CARRY_OVER_SOURCES__` in the hosted define. QA/dev override `MUTABA3A_CARRY_OVER_SOURCES`, dev builds only; production always uses `config/hosts.json`, and the vite-config test pins that.
- `src/vite-env.d.ts`.
- `scripts/__tests__/no-hardcoded-hosts.test.ts` stays green (no literals).
- `server/DEPLOYMENT.md` §5a step 6.
- Knowledge files: ADR-181, TD entries (§9), CHANGELOG, COMPONENT_REGISTRY, PATTERNS (cross-origin handoff), TEST_PLAN, SYSTEM_OVERVIEW.

**Not changed:** no server code and no API contract change (no new route; the portal ships inside the API image, so it still releases with `make release server`). No Dexie schema version.

## 6. Release order

1. **`make release server`** — ships the receiver and the run.app `/carry-over` page. It's inert until someone opens it.
2. **`make release web`** — ships the old app's carry-over gate. From now on, free-app users are offered the move.
3. **After a day-7 check** (one real browser with free-app data, carried to the live domain; Basel): set `config/hosts.json` `stage: "redirect"`, then `make release web` and `make release server` (`server/DEPLOYMENT.md` §5a step 6). The run.app portal pages then go through `/carry-over`, and the old landing pages go to `mtb3a.com`. `/app/*` is never redirected (`vite.config.ts:355-358`), so D1 still holds.
4. **The next phone release after step 3:** drop `MUTABA3A_LEGACY_LINK_HOST` (xcconfig:21, entitlements:9-10, AndroidManifest/strings.xml, the guard test). Flutter repo.
5. MUT-292 can start 90 days after step 2.

## 7. Tests (TDD; this section is the test plan)

| ID | Level | Case |
|---|---|---|
| T-U1 | unit | `parseFreeAppBackup` accepts a v24 backup, refuses a newer `version`, refuses a non-backup JSON, never throws on junk |
| T-U2 | unit | profiles: 1, 5 and 7 businesses (the 6th and 7th → `profile-cap`); the default first |
| T-U3 | unit | rows with no `profileId` go to the default business, counted in `changed` |
| T-U4 | unit | unpaid, no client → "No client" customer, created once per profile |
| T-U5 | unit | a project with ILS and USD entries: the majority currency wins; the others keep their client and drop the project |
| T-U6 | unit | paid with records → owed + one settle per record; partial; paid with an uncovered amount; paid with no client → received |
| T-U7 | unit | dates: an ISO datetime near midnight in UTC+3 and UTC−5 lands on the local day; too old → `too-old`; a future settle → `future` |
| T-U8 | unit | every unmappable kind produces exactly one `notCarried` line with the right count |
| T-U9 | unit | JOD income/expense present → the warning with its count; JOD conversions don't trigger it |
| T-U10 | unit | amounts: USD 2, JOD 3 digits through `minorToDecimal`; zero and negative → `notCarried` |
| T-U11 | unit | steps are in dependency order; Idempotency-Keys are unique and deterministic |
| T-U12 | unit | an API 4xx in replay → `notCarried` with the reason, dependants follow; a 5xx aborts |
| T-U13 | unit | `protocol.ts`: wrong sender origin ignored; wrong `event.source` ignored; `kind` not matching `from` ignored; empty `__CARRY_OVER_SOURCES__` refuses all; never posts to `'*'`; no `ready` in 10 s → fallback |
| T-U14 | unit | the landing has no link to `/app` (only `hostedPortalUrl()`) |
| T-U15 | unit | the free-app gate: stage legacy/proxy → no gate; no records → redirect; records → screen; carried → banner |
| T-U16 | unit | the receiver: non-empty device → D3 two-step confirm; signed in → E3 wording, mode untouched |
| T-U17 | server | no `Cross-Origin-Opener-Policy` on `/carry-over` and `/carry-over/receive`; both serve the portal shell on old and new hosts; `/carry-over/receive` is never redirected |
| T-U18 | unit | `netlify.toml` and any built `_headers` carry no COOP |
| T-U19 | unit | `createLocalApp` with `rateLimitPerMinute: Infinity` takes 12k requests without a 429; the default still answers 429 past 10k (R1) |
| T-U20 | unit | both senders call `window.open` before their first `await` (a spy on the order) (R2) |
| T-U21 | unit | the receiver switches to the file picker on no payload 20 s after `ready`, and on `opener.closed` (R8) |
| T-U22 | unit | `check-bundles`: the built carry-over chunk passes `HOSTED_RULES`; a planted `Dexie` string fails (R4) |
| T-U23 | unit | an installed old app (`display-mode: standalone`) leads with the file path and offers no one-click (R7) |
| T-P1 | perf | replay of a 20k-record fixture: time and peak heap recorded in the PR; over 30 s on a mid laptop, raise the Worker question again (R5) |
| T-I1 | integration | **the AC test:** the free app's own code (demo seed + a CSV import with JOD, over fake-indexeddb) → `serializeAllTables` → map → replay → `applyRestore` into a fresh local store → counts and per-currency totals equal `freeAppTotals` exactly |
| T-I2 | integration | a mutated replay (one settle dropped) fails the totals gate and writes nothing |
| T-I3 | integration | Your data › Restore with the old backup `.json` shows the summary and lands the same totals |
| T-I4 | integration | move B: a local snapshot → `exportRecords` → `prepareCarryOver('records-file')` → identical snapshot |
| T-I5 | integration | carrying the same backup twice gives the same store (replace, not add) |

Commands: `npm run lint`, `npm run typecheck`, `npm run test:run`, `npm run build` under Node 22 (TD-054); `npm --prefix server test` for T-U17.

## 8. QA scenarios (release-QA; new app `carry-over`)

**The app.** Three origins on one machine, all on `127.0.0.1` (R6): the free app's dev server on `:5173`, the "old" portal on `:5177` and the "new" portal on `:5178`. `qa/support/carry-over.mjs` starts all three, with `MUTABA3A_PORTAL_URL` and `MUTABA3A_CARRY_OVER_SOURCES` pointing at these origins.

| id | tier | steps (as the person says them) | expect |
|---|---|---|---|
| `carry-over.free-app` | extended | I have clients, income (paid, part-paid, owed), expenses with a receipt, a vendor and a recurring rule in the old app. I open it, choose "Carry my records over", and confirm on the new address | The new address shows the same per-currency totals as the old app. The summary listed the vendor and the recurring rule as not carried. The old app shows the "changes here won't follow" banner |
| `carry-over.fallback` | extended | The popup is blocked. I download my records file from the old app, then restore it in Your data on the new address | Same totals; the same summary in the Restore confirm |
| `carry-over.keep-old` | extended | I choose "Keep using the old app for now" | The old app opens with my records; the next visit asks again |
| `carry-over.replace-existing` | extended | The new address already has records. I carry over, download what's there first, then replace | The download happened; the device now holds only the carried records |
| `carry-over.portal-host` | extended | I used the signed-out portal on the old host. I open an old link | The carry-over page offers the move; after it, the new host shows the same Overview totals and the old link's page |
| `carry-over.installed` | extended | I open the old app from my home screen (the spec stubs `display-mode: standalone`) | The screen leads with downloading my file; restoring it on the new address gives the same totals |
| `carry-over.empty` | extended | I open the old app with nothing in it | I land on the new address |

`paths` cover `src/hosted/carryOver/**`, `src/hosted/local/carryOver/**`, `src/hosted/pages/carry-over/**`, `src/pages/carryOver/**` and the changed lines in `YourDataDrawer.tsx`. `release-qa lint` must report no errors and no new unmapped files.

## 9. Tech debt opened

- **TD-221:** CSV-imported JOD rows can't be told apart (TD-112), so the carry-over only warns.
- **TD-222:** after a carry-over the old app still accepts edits. The banner says they won't follow, but nothing stops it. MUT-292 ends this.
- **TD-223:** the carry-over QA app can reload a page once on a cold dependency cache (§12).

## 10. Cost, privacy, i18n

- **Cost.** No server work and no new network calls. The lazy local chunk already loads on the receiver. A free-app backup with receipts is held in memory once on each side. There's no telemetry signed out (ADR-097 §10), so no counts.
- **Privacy.** Records go browser-to-browser on one device: no server, no URL parameters. The receiver validates every record (zod, then the server's own routes) before showing anything, and writes only on the person's confirm.
- **i18n.** New keys exist in both apps' `ar` and `en` dictionaries, Arabic first, with ICU plurals for the counts. Amounts are plain `<bdi>` (ADR-101). RTL layouts are checked in QA at 375 px.

## Build notes (2026-10-24, `feature/mut-291-carry-over`)

Built to §3–§11, with these departures, each found while building:

- **The protocol and `leaveTo` live in `src/lib/carryOver/`, not `src/hosted/carryOver/`.** The free app and the portal both import them, and `src/lib` is the tree both may reach.
- **Archived clients and projects arrive active, never archived.** Signed out, the archive routes answer `403 READ_ONLY_PROFILE` (probed). The summary lists them as changed (`client-archive-dropped`, `project-archive-dropped`), and there are no archive ops.
- **The old app's done state shows what arrived** (the new address's counts), not both sides' figures side by side. The totals gate (E4) already holds them equal before anything is saved.
- **The replay's in-page requests use `http://localhost`**, the loopback origin the portal bundle is already reviewed for; `http://local` failed `test:bundles`.
- **The web dev server leaves the gate off** unless `MUTABA3A_CARRY_OVER` turns it on, so the app's own QA still opens the app. `off` turns it off on a build.
- **QA's three dev servers each get their own Vite cache** (`qa/support/carry-over.vite.ts`). Sharing one, they reloaded each other's pages mid-test. TD-223 is now the cold-cache reload that remains (the hostname-trick TD was dropped by R6).
- **T-P1:** 20,000 records in 4.3 s, heap +149 MB (Node). No Web Worker (R5).
- **Not verified:** a real cross-host run, which is the operator's day-7 check (§6 step 3, `server/DEPLOYMENT.md` §5a step 6), and iOS standalone on a device (stubbed in QA).

## 11. Eng review (plan-eng-review, 2026-10-24, interactive)

Target: this file, `.claude/designs/mut-291-carry-over.md` (sections 1–10 above are the plan as first written).

**Scope record:** feature answers: none asked (no cuts proposed); structure: A, smaller arrangement (D1, Basel 2026-10-24); accepted scope: the plan's features unchanged, `carryOverGate.ts` folded into `CarryOverScreen.tsx` and `report.ts` into `mapDexieBackup.ts`; pending remedies: R1–R7.

### Findings

1. **[P1] (9/10)** `src/hosted/local/createLocalApp.ts:37` `const LOCAL_RATE_LIMIT_PER_MINUTE = 10_000;` is applied to every request (`:76`, `rateLimiter`). The replay (§3.1 E2) sends one request per record. A free-app device with more than about 10k records answers 429 partway through. §3.3 then lists the refused rows as `notCarried`, or the totals gate fails.
2. **[P1] (8/10)** §3.2 step 1 opens the popup "from a click", but §3.6 reads the records first (`serializeAllTables()`, `exportRecords()`, both async). Safari and Firefox drop user activation across an `await`, so a `window.open` after the read is blocked every time, and every person lands on the fallback.
3. **[P2] (9/10)** §3.4 says the throwaway app "answers `GET /v1/summaries` per profile with the same four figures". `server/src/routes/summaries.ts:22-24` `path: '/v1/summaries/organization'` returns outstanding, overdue and unallocated per currency only: no paid-income, expense or conversion totals.
4. **[P2] (8/10)** `scripts/bundle-rules.ts` `HOSTED_RULES` `{ name: 'Dexie', pattern: /\bDexie\b/ }` applies to `dist-hosted`. Mapping code that keeps the word in a string or a kept identifier fails `check-bundles`.
5. **[P2] (7/10)** The replay runs on the main thread (§3.7). A large backup freezes the receiver page with no sign of progress.
6. **[P3] (6/10)** §8's second portal origin is the `localhost`/`127.0.0.1` trick. On macOS, `localhost` can resolve to `::1` while the dev server binds `127.0.0.1`, so the "old" origin may not answer.
7. **[P2] (7/10)** `vite.config.ts:600` `registerType: "autoUpdate"`: the free app is an installable PWA. An app installed on iOS opens `window.open` in a separate browser with no `opener`, so the bridge always times out there and lands on the fallback. The plan treats the fallback as the rare path.

### Decision ledger

#### R1: the replay's rate limit
Finding: 1, P1, 9/10, `createLocalApp.ts:37`, native review
Plan baseline: §3.7, `createLocalApp({...})` with today's options (no rate-limit option)
Runtime evidence: `LOCAL_RATE_LIMIT_PER_MINUTE = 10_000`, a fixed constant passed to `new SlidingWindowRateLimiter`
Comparison grid: | R1 | current: 10k/min applies to the replay | A: `CreateLocalAppOptions.rateLimitPerMinute` (default 10k); replay passes `Infinity` | B: replay sleeps to stay under 10k/min |
Question D2: should the replay skip the local rate limit? Recommendation: A.
Options: A) Option to lift it (recommended): one optional field, default unchanged, plus a test that 12k requests replay. B) Pace the replay: no code change in createLocalApp; a 20k-record device waits 2+ minutes.
State: approved
Actual answer: A, D2, Basel 2026-10-24
Accepted scope: `CreateLocalAppOptions.rateLimitPerMinute` (default 10,000); the replay passes no limit; test: 12k requests replay with no 429
History: none

#### R2: popup timing
Finding: 2, P1, 8/10, §3.2/§3.6, native review
Plan baseline: §3.2 step 1 "from a click", order unspecified
Runtime evidence: unknown (browser behaviour, not probed here)
Comparison grid: | R2 | current: unspecified | A: `window.open` synchronously in the click handler, then read; payload waits for both `ready` and the read | B: read first, open after |
Question D3: open the popup before reading the records? Recommendation: A.
Options: A) Open first (recommended): works in Safari and Firefox; a unit test pins that open is called before any await. B) Read first: simpler code, blocked in two browsers.
State: approved
Actual answer: A, D3, Basel 2026-10-24
Accepted scope: `window.open` runs synchronously in the click handler; the read runs in parallel; the payload goes once both `ready` and the read are done; a unit test pins open-before-await
History: none

#### R3: where carried totals come from
Finding: 3, P2, 9/10, `summaries.ts:22-24`, native review
Plan baseline: §3.4 "GET /v1/summaries per profile with the same four figures"
Runtime evidence: the organization summary has outstanding/overdue/unallocated only
Comparison grid: | R3 | current: names a route that doesn't exist | A: pure `snapshotTotals(maps)` over the replayed store (paid, outstanding, expenses, conversions), plus outstanding cross-checked against `/v1/summaries/organization` | B: list endpoints per kind and sum them |
Question D4: compute carried totals from the replayed records? Recommendation: A.
Options: A) From the snapshot, plus a summary cross-check (recommended). B) Sum list endpoints: closer to what screens show, many more requests.
State: approved
Actual answer: A, D4, Basel 2026-10-24
Accepted scope: pure `snapshotTotals(maps)` over the replayed store (paid, outstanding, expenses, conversions per currency), plus outstanding cross-checked against `/v1/summaries/organization`
History: none

#### R4: the bundle word
Finding: 4, P2, 8/10, `scripts/bundle-rules.ts` HOSTED_RULES, native review
Plan baseline: §3.3 names (`mapDexieBackup`, "Dexie v24+")
Runtime evidence: the rule matches `\bDexie\b` in `dist-hosted`
Comparison grid: | R4 | current: Dexie in names | A: code and strings say "free app backup"; `check-bundles.test.ts` gains a case | B: allow the word in the local chunk |
Question D5: rename to "free app backup" rather than loosen the rule? Recommendation: A.
Options: A) Rename (recommended): `mapFreeAppBackup`, rule untouched. B) Loosen the rule for the lazy chunk.
State: approved
Actual answer: A, D5, Basel 2026-10-24
Accepted scope: names say "free app backup" (`mapFreeAppBackup`, `parseFreeAppBackup`); HOSTED_RULES unchanged; `check-bundles.test.ts` gains a case for the carry-over chunk
History: none

#### R5: progress during the replay
Finding: 5, P2, 7/10, §3.7, native review
Plan baseline: replay on the main thread, a "Getting your records…" state only
Runtime evidence: unknown, no measurement of replay speed (no code yet)
Comparison grid: | R5 | current: one blocking loop | A: yield to the browser every 200 requests; show "Checking N of M"; measure on a 20k-record fixture | B: a Web Worker for the replay |
Question D6: yield and show progress on the main thread? Recommendation: A.
State: approved
Actual answer: A, D6, Basel 2026-10-24
Accepted scope: yield to the browser every 200 requests; show "Checking N of M"; measure the replay on a 20k-record fixture before shipping; a Web Worker only if that measurement is too slow
History: none

#### R6: QA's second portal origin
Finding: 6, P3, 6/10, §8, native review
Plan baseline: `localhost:5177` and `127.0.0.1:5177` as two origins
Runtime evidence: unknown on this machine (not probed)
Comparison grid: | R6 | current: hostname trick | A: two portal dev servers on two ports (5177 old, 5178 new), both on 127.0.0.1; TD-223 dropped | B: keep the trick |
Question D7: use two ports instead of two hostnames? Recommendation: A.
State: approved
Actual answer: A, D7, Basel 2026-10-24
Accepted scope: QA runs the old portal on 127.0.0.1:5177 and the new on 127.0.0.1:5178; TD-223 dropped
History: none

#### R7: the installed-app case
Finding: 7, P2, 7/10, `vite.config.ts:600`, native review
Plan baseline: fallback after a 10 s timeout; treated as rare
Runtime evidence: unknown on a device (not probed)
Comparison grid: | R7 | current: wait 10 s, then fallback | A: detect an installed app (`display-mode: standalone`) and offer the file path first, with copy for it; a QA spec for the file path stays | B: keep the 10 s wait for everyone |
Question D8: send installed-app users straight to the file path? Recommendation: A.
State: approved
Actual answer: A, D8, Basel 2026-10-24
Accepted scope: an installed old app (`display-mode: standalone`) leads with download + restore, with its own copy; the browser case keeps one-click; QA covers both
History: none

#### R8: the receiver waits forever if the sender goes away
Finding: 8, P2, 8/10, §3.2 "Timeouts" (sender side only), Section 1 architecture review
Plan baseline: only the sender times out; the receiver shows "Getting your records…" until a payload arrives
Runtime evidence: n/a (no code yet)
Comparison grid: | R8 | current: no receiver timeout | A: 20 s after `ready` with no payload, or when `window.opener.closed`, the receiver switches to the file picker (§3.5) with "The old page closed; choose your records file instead" | B: keep waiting |
Question D9: give the receiver its own timeout? Recommendation: A.
State: approved
Actual answer: A, D9, Basel 2026-10-24
Accepted scope: no payload 20 s after `ready`, or `window.opener.closed`, switches the receiver to the file picker with "The old page closed; choose your records file instead"; one unit test per trigger
History: none

Approval readiness: PASS. E3 (D10), R1 (D2), R2 (D3), R3 (D4), R4 (D5), R5 (D6), R6 (D7), R7 (D8) and R8 (D9) are each approved by Basel's own answer on 2026-10-24. The structure is D1. §3–§9 above carry exactly those accepted scopes.

### Section results

- **Step 0, Scope Challenge:** scope accepted as-is (smaller file arrangement, D1). It reused the existing parts: `serializeAllTables` (`src/db/backup.ts:20`), `decodeRecordsArchive` and `applyRestore` (`src/hosted/local/recordsArchive.ts`, `restore.ts`), `createLocalApp`, `safeNext.ts` and the server's existing `/carry-over` redirect (`server/src/app.ts:508-514`). No new dependency.
- **1. Architecture:** findings 1, 2 and 8 → R1, R2, R8, all accepted. Dispositions: accepted.
- **2. Code quality:** finding 4 (bundle word) → R4, accepted. The `restoredHome` helper has two callers: `YourDataDrawer.tsx:96` (existing) and `ReceivePage` (proposed). It is a move, not a new abstraction. No other issues.
- **3. Tests:** finding 6 (QA origins) → R6, and finding 7 (installed app) → R7, both accepted. The diagram is below.
- **4. Performance:** finding 5 → R5, accepted. Not measured (no code yet): memory for a backup with base64 receipts, held as text, then parsed, then as Blobs (roughly 3× the file size at peak). T-P1 records it.

### Test coverage (planned)

```
CODE PATHS                                              USER FLOWS
[+] carryOver/protocol.ts                               [+] Old app → new address (A)
  ├── [PLANNED ★★★] origin/source/kind checks  T-U13      ├── [PLANNED →E2E] one-click        carry-over.free-app
  ├── [PLANNED ★★★] open before await          T-U20      ├── [PLANNED →E2E] popup blocked    carry-over.fallback
  ├── [PLANNED ★★ ] sender 10 s timeout        T-U13      ├── [PLANNED →E2E] keep old app     carry-over.keep-old
  └── [PLANNED ★★★] receiver 20 s / closed     T-U21      ├── [PLANNED →E2E] installed app    carry-over.installed
[+] local/carryOver/freeAppBackup.ts                      └── [PLANNED →E2E] nothing to carry carry-over.empty
  └── [PLANNED ★★★] v24..verno, too new, junk  T-U1     [+] Old portal → new host (B)
[+] local/carryOver/mapFreeAppBackup.ts                   └── [PLANNED →E2E] carry-over.portal-host
  ├── profiles 1/5/7, unscoped rows            T-U2,3   [+] Existing records on new host
  ├── No client, project currency (D4)         T-U4,5     └── [PLANNED →E2E] carry-over.replace-existing
  ├── paid/partial/received                    T-U6     [+] Error states
  ├── dates (tz, floor, future)                T-U7       ├── [PLANNED ★★★] API 4xx → listed     T-U12
  ├── unmappable kinds, JOD warning            T-U8,9     ├── [PLANNED ★★★] 5xx → abort, nothing written T-U12
  ├── amounts                                  T-U10      ├── [PLANNED ★★★] totals mismatch → blocked T-I2
  └── order + idempotency keys                 T-U11      └── [PLANNED ★★ ] signed in (E3) wording T-U16
[+] local/carryOver/replay.ts + totals.ts
  ├── [PLANNED ★★★] no rate limit, 12k          T-U19
  ├── [PLANNED ★★★] real free-app data → equal totals T-I1  ← the AC test
  └── [PLANNED perf] 20k fixture time/heap      T-P1
[+] YourDataDrawer Restore + old .json          T-I3
[+] headers: no COOP (server, Netlify)          T-U17, T-U18
[+] bundles: carry-over chunk passes HOSTED_RULES T-U22

COVERAGE (planned): 28/28 paths have a planned test | none exist yet
```

No existing tests become obsolete. `YourDataDrawer`'s Restore tests are extended (T-I3), not replaced.

### Failure modes

| Path | Realistic failure | Covered by | What the person sees |
|---|---|---|---|
| Popup | blocked, or an installed app | R2, R7, T-U20, T-U23 | the file path, never a dead end |
| Old tab closes mid-way | the receiver has no payload | R8, T-U21 | the file picker, with the reason |
| Replay | a 429 from the local limit | R1, T-U19 | nothing; it can't happen |
| Replay | a rule refuses a row | T-U12 | that row in "Not carried", with the reason |
| Replay | a mapping bug drops money | T-I1, T-I2 | blocked: "nothing was changed", plus the download |
| Restore | the browser refuses the space | existing `applyRestore` rollback (`restore.ts:39-45`) | the existing Restore error; old records kept |
| Large backup | a phone runs out of memory | T-P1 measures it, with no handling beyond the 200 MB cap | the tab crashes, nothing written. **Not silent to the person, but not explained either: watch T-P1** |

Critical gaps (no test, no handling and silent): none.

### NOT in scope

- **Moving carried records into a signed-in account:** MUT-290 (Backlog). E3 only says where they went.
- **Stopping edits in the old app after a carry-over:** TD-222. MUT-292 retires the app.
- **Detecting the 10× CSV JOD rows:** not possible from the data (TD-112, TD-221). The carry-over warns.
- **A Web Worker replay:** only if T-P1 says it's needed (R5).
- **The phone's legacy-host removal itself:** Flutter repo, the next phone release after stage `redirect` (§6 step 4).

### What already exists (reused, not rebuilt)

- `serializeAllTables` (`src/db/backup.ts:20`): the old app's whole payload and its fallback file.
- `decodeRecordsArchive` / `applyRestore` (`src/hosted/local/recordsArchive.ts`, `restore.ts`): the one write path.
- `createLocalApp` + `MemoryLedgerStore`: the replay engine, so every server rule runs.
- `exportRecords` (`src/hosted/local/index.ts`): move B's sender.
- `safeNext.ts`, the server's `/carry-over` redirect and `LEGACY_CARRY_OVER_PATH`: move B's routing.
- `netlifyRedirects` (`vite.config.ts:375`): stage `redirect` on Netlify, which never touches `/app/*`.

### Implementation Tasks

- [ ] **T1 (P1, human: ~2h / CC: ~10min):** local app: add `rateLimitPerMinute` to `CreateLocalAppOptions` (R1).
  - Files: `src/hosted/local/createLocalApp.ts`.
  - Verify: T-U19.
- [ ] **T2 (P1, human: ~1d / CC: ~1h):** carry-over: `protocol.ts` with open-before-await and both timeouts (R2, R8).
  - Files: `src/hosted/carryOver/`.
  - Verify: T-U13, T-U20, T-U21.
- [ ] **T3 (P1, human: ~3d / CC: ~2h):** mapping: `parseFreeAppBackup` + `mapFreeAppBackup` (R4 names, D2/D4 rules).
  - Files: `src/hosted/local/carryOver/`.
  - Verify: T-U1..U12.
- [ ] **T4 (P1, human: ~1d / CC: ~45min):** replay + totals: throwaway app, yield/progress, `snapshotTotals`, summary cross-check (R3, R5).
  - Files: `src/hosted/local/carryOver/`.
  - Verify: T-I1, T-I2, T-P1.
- [ ] **T5 (P1, human: ~1d / CC: ~1h):** portal screens: `ReceivePage`, `CarryOverPage`, `CarryOverSummary`, the Your data Restore of the old backup, routes.
  - Files: `src/hosted/pages/carry-over/`, `YourDataDrawer.tsx`, `router.tsx`.
  - Verify: T-U16, T-I3, T-I4, T-I5.
- [ ] **T6 (P1, human: ~1d / CC: ~45min):** old app: `CarryOverScreen` with the gate and the installed-app variant, `CarriedBanner`, `Settings.carriedOverAt` (R7, D1).
  - Files: `src/pages/carryOver/`, `src/types`.
  - Verify: T-U15, T-U23.
- [ ] **T7 (P2, human: ~2h / CC: ~15min):** guards.
  - Files: `server/src/__tests__/`, `scripts/__tests__/`.
  - Verify: no-COOP header tests (T-U17, T-U18) and the bundle case (T-U22).
- [ ] **T8 (P2, human: ~1d / CC: ~1h):** release-QA: app `carry-over` on three `127.0.0.1` ports, seven features, specs (R6, R7).
  - Files: `qa/`.
  - Verify: `release-qa run --attach --only carry-over.*`; `release-qa lint` clean.
- [ ] **T9 (P2, human: ~2h / CC: ~15min):** docs: ADR-181, TD-221/222, CHANGELOG, registry, patterns, `DEPLOYMENT.md` §5a step 6.
  - Verify: review.

### Worktree parallelization

| Step | Modules touched | Depends on |
|---|---|---|
| T1 | `src/hosted/local` (createLocalApp) | — |
| T2 | `src/hosted/carryOver` | — |
| T3 | `src/hosted/local/carryOver` | — |
| T4 | `src/hosted/local/carryOver` | T1, T3 |
| T5 | `src/hosted/pages`, `components`, `session` | T2, T4 |
| T6 | `src/pages/carryOver`, `src/types` | T2 |
| T7 | `server/src/__tests__`, `scripts/__tests__` | — |
| T8 | `qa/` | T5, T6 |

Lane A: T1 → T3 → T4 → T5 (shared `src/hosted/local`). Lane B: T2 → T6. Lane C: T7. Launch A, B and C together, merge them, then T8 and T9. Conflict flag: T5 and T6 both import `protocol.ts` from T2, so land T2 first. Basel's rule is one worktree per repo per epic, so in practice this is one branch with sequential commits in that order.

### Completion summary

- Step 0, Scope Challenge: scope accepted as-is (smaller arrangement, D1).
- Reality rows: 7/7 tier-1 rows emitted; 0 unverified premises.
- Architecture review: 3 issues found (R1, R2, R8).
- Code quality review: 1 issue found (R4).
- Test review: diagram produced; 2 gaps identified (R6, R7).
- Performance review: 1 issue found (R5).
- NOT in scope: written.
- What already exists: written.
- TODOS.md updates: 0 items proposed (the debt is tracked as TD-221/222).
- Failure modes: 0 critical gaps flagged (one watch item: the memory on phones, T-P1).
- Unresolved decisions: 0 in this review (E3 settled by Basel as D10: save into the signed-out space and explain).
- Outside voice: codex, unavailable. Codex is not installed, and the native Plan reviewer gave no complete report within five minutes.
- Parallelization: 3 lanes, 3 parallel / 2 sequential (T8, T9).
- Lake score: 8/8.

REALITY: premise-table pass 9 premises checked, all with receipts (createLocalApp.ts:37, summaries.ts:22, bundle-rules.ts HOSTED_RULES/LOCAL_RULES, app.ts:508-514, backup.ts:20, profiles.ts:30, vite.config.ts:600, restore.ts:28, types/index.ts:529) unverified=0
REALITY: already-done pass no carry-over code on any branch; MUT-326 built only the server redirect (f898d156) server/src/app.ts:508
REALITY: surface-check pass routes /carry-over and /carry-over/receive are new; /v1/summaries/organization verified; no CLI flags named beyond release-qa run/lint server/src/routes/summaries.ts:22
REALITY: binding-decisions pass D1–D9 + Basel's D1–D4 product answers honoured; ADR-097 §6 and §10 kept; gstack decision search returned none for this area .claude/DECISIONS.md:3901
REALITY: numbers finding 10k/min [measured: createLocalApp.ts:37]; the 20k replay time and 3× memory are [estimated], with T-P1 to measure .claude/designs/mut-291-carry-over.md §11
REALITY: deferred-asks pass ticket scope met; "becomes a bridge, then redirects" softened by owner D1; landing links already point to the portal .claude/designs/mut-291-carry-over.md §2
REALITY: pr-count pass one branch, local merge (no ship-policy; Basel merges locally)

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex (not installed); native Plan fallback | Independent 2nd opinion | 1 | unavailable | no complete report within 5 min |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open | 7 issues, 0 critical gaps (all resolved by Basel's answers D2–D9; E3 settled as D10) |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, plan-review phase, unavailable (not installed); the native Plan fallback timed out at 5 minutes with no report. No outside findings.
- **VERDICT:** Eng review run, 7 section findings (8 ledger rows) all resolved into the plan; not CLEAR because issues were found (status issues_open means mapped work, not failure). Three new screens are unreviewed for design: /plan-design-review is recommended before build.

NO UNRESOLVED DECISIONS
