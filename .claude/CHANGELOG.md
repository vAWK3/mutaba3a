# CHANGELOG.md — Change History

> **Purpose**: Track all significant changes to the codebase.
> **Rule**: Update this file after completing any change.

---

## Format

```markdown
## [Version] - YYYY-MM-DD

### Added
- New features

### Changed
- Changes to existing functionality

### Fixed
- Bug fixes

### Removed
- Removed features

### Technical
- Refactoring, dependencies, infrastructure
```

---

## [Unreleased] - 2026-10-20 — MAL-1137 backfill: skip never-seeded personal profiles; one read for all

**Why:** `backfill-personal-expense-categories.test.ts` timed out (5000ms, all tests) under the full `test:db` run. The backfill read each personal profile's categories one query at a time, and the shared test DB never resets, so every test scanned 4,558 profiles: about 2s a test alone, more under parallel load. Behind the slowness was a real bug. A personal profile that had never listed its categories (none seeded yet) got the three new categories added, and then `GET /v1/expense-categories`'s "none yet → seed" check never seeded the full preset for it. 4,351 test-DB profiles were left with exactly those three.

### Fixed
- `server/src/scripts/backfill-personal-expense-categories.ts`: only seeded personal profiles (`expenseCategories: { some: {} }`) are considered, and their categories come back in the same query (no N+1). A never-seeded profile is left empty, so it seeds the current preset itself.
- New test: a never-seeded personal profile stays empty and isn't reported. The file now runs in ~1.5s against the same 4,558 profiles (was ~9.8s).

### Technical
- Production: if `backfill:personal-categories` was ever run without `--dry`, never-seeded personal profiles there have only the three new categories and will never get the full preset. Not repaired here. Check before the next run (see the session notes).

## [Unreleased] - 2026-10-19 — MUT-337: icon save-feedback animation runtime decision + web prototype (ADR-152)

**Why:** MUT-338/339/340 (the epic's actual gamification features, the first marked highest-priority) are all blocked until an animation runtime is chosen for the MUT-335/336 icon system. This ticket decides and proves the mechanism; MUT-338 wires it into a real trigger.

### Added
- `src/lib/motion/iconMotion.ts` — `playIconFeedback(targets, { preset, reducedMotion })`: one scale(0→1) transform played through `ICON_OVERSHOOT_EASE` (playful) or `ICON_RESTRAINED_EASE` (restrained) — the exact same cubic-bezier control points as Flutter's `MMotion.overshoot`/`.spring`. Re-triggering mid-flight stops the prior play and restarts from its live value; reduced motion skips straight to the end state.
- `src/lib/motion/__tests__/iconMotion.test.ts` (7 tests) — including an assertion that the playful preset's live value genuinely exceeds 1 mid-flight (not just "which constant was passed").
- ADR-152 (`.claude/DECISIONS.md`): adopts `motion` + shared easing curves; rejects Rive (new runtime/CSP grant/asset pipeline for capability not needed) and CSS keyframes (loses interruptibility).
- `.claude/designs/mut-337-icon-animation-runtime.md` — the full candidate comparison (AC #1).

### Technical
- No new dependency on either platform. No new UI ships — this is a headless, unit-tested library function; MUT-338 is where it becomes visible.
- Flutter half (wiring `MMotion.overshoot`/`.spring` through an `AnimationController`) not built in this session — needs its own mutaba3a-flutter worktree.

## [Unreleased] - 2026-10-19 — MUT-336: SVG → React icon codegen pipeline (web half)

**Why:** MUT-336 turns the MUT-335 canonical icon set (`assets/icons/source/*.svg`) into usable platform code instead of hand-copying each icon. This is mini-crm's half (React); the Flutter half is its own ticket slice in that repo.

### Added
- `scripts/icon-set.ts` — pure SVG parser/codegen/drift-detection logic (`scripts/__tests__/icon-set.test.ts`, 21 tests).
- `scripts/generate-icons.ts` (`npm run icons:generate`) and `scripts/validate-icon-set.ts` (`npm run icons:check`) — thin CLI wrappers.
- `src/components/icons/generated/*.tsx` — all 61 icons, regenerated from source; a named sub-part (`id="nuqta"`) becomes `data-part="nuqta"`, never a raw `id`, so MUT-337's animation runtime can target one instance without a DOM-id collision across repeated icons on a page.
- `assets/icons/README.md` — the add/update flow end to end (AC #2).
- Pilot (AC #3): `LanguageIcon` (generated) rendered next to the language setting in `SettingsPage.tsx` — a new addition, not a migration of any existing icon call site.

### Technical
- Generation fails the whole run (nothing written) on any source file that doesn't parse — a partial regenerate must not look like a pass.
- Call-site migration of the 16 hand-written `src/components/icons/*` components, or the scattered inline SVG duplicates, is explicitly out of MUT-336's scope.

## [Unreleased] - 2026-10-19 — MUT-335: mini-crm's half of the canonical icon mirror is complete

**Why:** MUT-335 designs one canonical, animatable icon set across mini-crm and mutaba3a-flutter in a shared Claude Design project; mini-crm keeps a byte-identical copy of the source SVGs so MUT-336's web codegen step doesn't need to read across repos.

### Added
- `assets/icons/source/*.svg` — all 61 canonical icons now mirrored (was 26); the remaining 35 copied from mutaba3a-flutter's `mut-335-icon-system` branch (commit `967794eb`) once that repo finished syncing from Claude Design.

### Technical
- No call-site migration yet (that's MUT-336, explicitly out of scope for MUT-335) — `src/components/icons/*` and the hand-drawn per-component SVGs are untouched.

## [Unreleased] - 2026-10-19 — MUT-324 review fixes: the terms link language, release order, the 409 recovery, wording

**Why:** /review pass 1 on MUT-324 (`.claude/designs/mut-324-review-findings.md`) found six must-fix items before release. Branch `fix/mut-324-review-fixes`.

### Fixed
- **Recorded language = read language.** Portal terms links carry `?lang=<portal language>`. `/terms` shows that language for the text only (lang/dir on the text), and never stores it.
- **`make release full`** is web, then server (ADR-102 override log; ADR-043's server-first addendum overridden).
- **The terms guard runs in `scripts/preflight.sh server`**, before the version bump and push. `deploy.sh` checks again every time, and only `SKIP_TERMS_CHECK=1` skips either (pass 2: a `TERMS_CHECKED_BY_PREFLIGHT` flag let `SKIP_REMOTE=1` skip both). A failure names the HTTP status or fetch error.
- **The Updated-terms step recovers from a 409 `TERMS_VERSION_STALE`.** It refetches Me and says the terms changed, and the retry accepts the new version. A success cancels in-flight Me fetches and writes through an updater.
- **Wording (Basel's choices):**
  - privacy: "restore your records to any moment in the last 7 days" (point-in-time recovery is 7 days; backups are kept 14);
  - terms §10: "the next time you open your account on the web, or by email". Version 2026-10-19 has not been released yet, so its sha256 in `server/src/legal.ts` was updated.
- **Should-fix:**
  - the setup checkbox row layout, paragraph gaps, link underlines, and a mailto support link;
  - the manifest skips non-JSON files;
  - a setup 409 without `details.current` asks the link again;
  - only `Me.terms` is nullable in OpenAPI.

- **Review pass 2:**
  - the Updated-terms step never switches version silently: a refetch that names newer terms, or a 409's `details.current`, shows "the terms changed";
  - `Me.terms` is null again in the portal's generated types (an inline nullable object; TD-181 logs the repo-wide 3.0-style `nullable` under the 3.1.0 label);
  - the setup page clears the terms tick when its language changes (Basel), and a 409 with no version followed by a dead or unreachable re-check says so;
  - §10 is reworded again (Basel): "by email or the next time you open your account on the web";
  - the consent row reads at body size; Arabic heading tracking is keyed on the heading's own language;
  - `termsManifest` refuses misnamed files again (dotfiles skipped); `users.acceptTerms` returns only `{ created }`.

### Technical
- `LegalPage` takes `loading` and `textLanguage`.
- `staleTerms` moved to `terms-acceptance.ts`.
- The audit profile reads run in parallel, and the accept route no longer reads back.
- `buildMe` runs its count and the terms status together.
- `FakeApi.bumpTerms` was added for QA.
- Follow-ups: MUT-346 (the draft is lost on a bump), MUT-347 (per-environment guard, rollback), MUT-348 (evidence decisions). The MUT-333 scope now includes purging the terms audit rows.

## [Unreleased] - 2026-10-19 — Terms of service, accepted at setup and on the portal (MUT-324, ADR-102, TD-180)

**Why:** a paying pilot (MUT-322) needs terms people accept, and a privacy policy that says where hosted records live. Basel's D1–D12 are in `.claude/designs/mut-324-terms-plan.md` §0.

### Added
- **Landing:**
  - `/terms` and `/terms/<version>`, with frozen EN/AR texts in `src/content/legal/terms/`. The governing law is England & Wales, and English prevails.
  - A hosted-accounts section in the privacy policy.
  - Terms links in the footer and under the /hosted form.
  - `/legal/terms-versions.json`, emitted by the web build.
- **Server:**
  - `terms_acceptances` (version, locale, sha256, surface), cascade-deleted with the person.
  - `CURRENT_TERMS` in `legal.ts`.
  - The setup check names `termsVersion`; the redeem requires it (409 `TERMS_VERSION_STALE`).
  - `Me.terms`, and `POST /v1/me/terms-acceptance`.
  - The admin `GET /admin/v1/terms-acceptance` and `npm run terms:report`.
  - `deploy.sh` checks that the terms are live (`terms:check-live`). API 1.38.0-mut324.
- **Portal:**
  - A required "I agree" tick on the setup page, linking the exact version.
  - The Updated-terms step for anyone behind on the terms.
  - Terms links in the account menu and on the sign-in page.

### Changed
- `PrivacyPolicyPage` renders through the new shared `LegalPage`.
- The QA fake API, the setup spec, the test `provision` helper and the demo-seed script all accept the terms.

### Technical
- Acceptances are kept out of the local-mode snapshot; signed out, `Me.terms` is null.
- TD-180: acceptance is enforced on the portal only (the phone part is MUT-344).
## [Unreleased] - 2026-10-19 — Signed out: expenses, groups, conversions, receipts and documents on this device (MUT-287, ADR-100 decision 11, TD-171 resolved)

**Why:** MUT-286 brought core records to the signed-out portal but hid Expenses and Conversions, because receipts and exchange rates had no place to go without a server. Epic MUT-284 decision 4: both modes are the same app.

### Added
- **`GET /v1/public/fx-rates`** (server, MUT-285 D3): the cached ECB snapshot `{ rateDate, perEur, fetchedAt, source }`, anonymous, no profile header, 30 per minute per address (`PUBLIC_FX_POLICY`, 429 + Retry-After), same `CachedFxRates` instance as `/v1/fx-rates`. Registered outside `PORTAL_ROUTES`. API `1.37.0-mut287`.
- **Receipt files on this device:** `LocalAttachmentStorage` runs the server's own receipt and attachment routes in the page over a new IndexedDB database, `mut-local-blobs` (`IndexedDbBlobStore`, `{ type, bytes }` per file). Uploads and downloads are signed `local-blob:<key>`; the portal's `putToSignedUrl` and `downloadNavigator.open(url, filename)` branch on it (`localFiles.put`/`read`, object URL + `<a download>`, no preview).
- **Exchange rates signed out:** `PublicFxRateSource` feeds the server's `CachedFxRates` (one fetch per page per hour, no credentials), so the expense-group ≈ line works online and hides offline.
- **"Download my records" is a zip:** `records.json` (the MUT-286 file, unchanged) plus `receipts/<key>` binary entries; jszip loads only on Download/Restore. Restore reads a zip or a MUT-286 `.json`.
- Release-QA `portal.local.expense-receipt` (core), `fx-line`, `conversion`, `documents-empty`.

### Changed
- The nav shows the same sections signed in and out: Expenses (with Groups) and Conversions are back signed out.
- Documents signed out shows its empty state instead of an error (`GET /v1/attachments` needed storage).
- Restore is crash-safe by order across the two databases: add the backup's files, save the records, then delete files no receipt names. A receipt file is deleted only after its request's snapshot saved; boot sweeps orphans.
- The server modules' `Buffer` is bound per module at build time (`scopeServerBufferShim`), no longer installed on `globalThis`.

### Fixed
- "Download my records" crashed in real browsers once jszip loaded: it saw the global partial `Buffer`, took its Node path and broke in its compressor. Caught by release-QA, invisible to unit tests on Node's real `Buffer`.

### Review (pre-landing /review + qa-reconcile, Basel D1–D13, 2026-10-19)
- **Server:** the public FX limiter is built in `index.ts` and pruned each minute (it grew per address without bound); 120/min per address; `EcbSnapshot.upstream` relays a cached source's staleness; the route documents only 429/503.
- **Local backend:** FX fetched before the cross-tab lock and remembered on the device for an hour (`mut-local-fx`); the records zip is copied under the lock and zipped after, receipts STOREd; Restore names missing receipt files in the confirm (new en/ar copy), accepts a zip re-made from Safari's extracted folder, unpacks files only on Replace under the upload rules, and cleans up after a refused save; pending uploads' files expire with their 15-minute link; `head()` reads a `{ type, size }` record; both databases open through `LocalDatabase` (step aside for a newer build's upgrade, reject a blocked one); one `saveBlobAs` for every in-hand download (URL released after 60 s).
- **Tests:** parity for expenses, receipts, groups and conversions; fingerprint fills every nullable field; the Buffer plugin is tested; release-QA `restore-missing-receipts` added, `fx-line` updated.

### Technical
- `format-fingerprint.test.ts` covers all 27 snapshot maps from `helpers/everyRecord.ts` (TD-171 resolved).
- `check-bundles`: jszip must not be statically reachable from the portal's entry (`jszipInEntryGraph`); `stuk.github.io` (a jszip doc link) joins the hosted origins. Local chunk 115.7 KB gzip, jszip chunk 30.1 KB gzip.
- Files: `server/src/routes/fx-rates.ts`, `server/src/schemas.ts`, `server/src/app.ts`, `src/hosted/local/{blobStore,attachments,fxSource,recordsArchive,restore}.ts`, `src/hosted/local/{index,transport,createLocalApp}.ts`, `src/hosted/session/localBackendContract.ts`, `src/hosted/data/{download,expenseQueries}.ts`, `src/hosted/components/{ReceiptUploader,YourDataDrawer}.tsx`, `src/hosted/pages/views/DocumentsList.tsx`, `src/hosted/shell/HostedShell.tsx`, `vite.config.ts`, `eslint.config.js`, `scripts/{bundle-rules,check-bundles}.ts`, `scripts/bundle-origins.json`.

## [Unreleased] - 2026-10-19 — Direction comes from `<html dir>` and the `dir` attribute only (MUT-109, ADR-101, TD-048 resolved)

**Why:** `theme.css` set `direction` on every `:lang()` element, which beat the `dir` attribute: every `dir="ltr"` was ignored in Arabic, and every `dir="rtl"`/`"auto"` in English. Last open child of Brand v2 (MUT-101).

### Changed
- `src/styles/theme.css`: both `:lang()` direction rules removed; `<html dir>` (I18nProvider) is inherited.
- Seven locale-formatted amounts are a plain `<bdi>` (no `dir`): `OwedNowSummary`, `ClientWorkSection`, `ClientsPage`, `HomeRecentPayments`, `HomeAttentionRow`, `OrphanedRecordsDrawer`, portal `DecimalAmount`. Arabic amounts render exactly as before (measured: `$US 1,300`).
- `CurrencyAmounts.css`, `RecurringAttentionList.css`: `direction: ltr` workaround removed; the markup's `dir="ltr"` does it (D2). Comments in `index.css`, `FxRateReadout.css`, `TruncatedTitle.css` and `utils.ts` (`isolateAmount`) no longer cite `:lang(ar)`.
- `index.css`: `:where([dir="rtl"]) :is(input, select)[dir="ltr"] { text-align: right }`. The amount, email, password, date and timezone fields that now type left to right keep their text on the right in Arabic (D3).

### Fixed
- In Arabic, these now type left to right: portal sign-in, setup and change-password fields, the portal's date filter, the portal's income, payment, conversion and expense amounts, the local conversion drawer and the landing request form's email and phone. They used to render right to left despite `dir="ltr"`.
- In English, the Arabic business-name input is right to left, and user-typed names (`dir="auto"`) take their own direction.

### Tests
- `src/styles/__tests__/direction.test.ts`: no `:lang()` direction rule in any CSS; all 45 `dir` sites classified (ratchet); no computed `dir={…}`; the seven amount files use a plain `<bdi>`.
- Updated `OwedNowSummary.test.tsx`, `format.test.tsx`. Added amount and field assertions in `ClientsPage`, `ClientDetailPage`, `HomeAttentionRow.plurals`, `OrphanedRecordsDrawer`, `ConversionDrawer`, `PartialPaymentDrawer` and `RecordPaymentDrawer` tests.
- Release QA: `qa/features/{web,portal}/direction.yaml`, `qa/specs/{web,portal}/direction.spec.ts`, `qa/support/bidi.ts` (`readBidi`/`readField`: on-screen character order and computed direction). The specs were red on main and green on the branch, on preview builds.

## [Unreleased] - 2026-10-19 — Add a matter from the portal's matter picker, signed in or out (MUT-318, ADR-100 decision 10)

**Why:** MUT-286's reconcile gap. Hosted matters came only from the phone app or Malafat, so signed out nobody could ever have one. The matter picker now adds matters the way the client picker adds clients.

### Added
- **"Add matter: «name»"** in the matter picker (income drawer's More details, expense drawer), on a profile the person owns (`canAddClient`), both modes: creates the matter under the chosen client in the drawer's currency (`POST /v1/projects`, attempt-scoped Idempotency-Key, `useCreateProject`) and picks it. The portal's 51st API call.
- **No client chosen:** no Add row; "Choose a client first to add a matter." under the field, the input's `aria-describedby`, in an always-mounted polite live region (design 5A).
- **Whose matter:** with no client chosen, each matter row names its client (EntityTypeahead `secondary`, design 1A).
- **Client ↔ matter cascade in the portal** (design 2A, 3A): picking a matter with no client fills the client; changing or clearing the client empties a matter of another client, silently, as in the local app.
- **Cues (Apple design review A2, A3):** the field's border pulses once when a create succeeds; the client field flashes when a picked matter fills it, in the portal and the local app. Reduced motion gets a still tint for the same span.

### Changed
- `useClientProjectCascade` moved from `src/hooks/` to `src/lib/forms/` (the portal may not import `src/hooks/`), generic over the project type with `ownerOf` and `onAutoFill`; local drawers' imports follow, behaviour unchanged.
- Income drawer's Arabic matter label «الملف (اختياري)» → «القضية (اختياري)», placeholder «اختر ملفاً» → «اختر قضية»: «ملف» means profile everywhere else (design 4A).

### Fixed
- **Saving a picked "Add …" no longer drops keyboard focus** (Apple design review A1): ClientPicker disabled its own focused input while creating, which blurred it (HTML focus fixup) and defeated "Enter held while saving submits". EntityTypeahead now makes the input read-only while a pick saves; neither picker disables on `isPending`.
- The expense drawer's Matter label now names its field (the picker had no `id`).

### Fixed in /qa-reconcile (2026-10-19)
- **No second pick while one is saving.** A1 kept the input focused, so ArrowDown or a refocus could reopen the list mid-save, and the first create, landing later, overwrote the second pick (the record saved under a client or matter the person had replaced). EntityTypeahead now keeps the list shut and ignores a pick while one is saving, as `disabled` did before A1.
- **Save waits for an «Add …» in flight** (Basel D1). Saving meanwhile stored the income or expense without the client or matter being added and left it unlinked. Both hosted drawers hold Save (`usePendingPicks`) until the pickers report the create settled; Enter held in the field still saves once it lands.
- **A Malafat capture in another currency than its matter** now says so under Matter («This matter is in {currency}…», Basel D2) instead of a generic "couldn't save" toast.
- **Arabic option names sit on the right.** An old `[dir=rtl] … text-align: end` rule put them on the left (`start` already follows the direction); a long client chip truncates on one line instead of wrapping the row.
- **«القضية» in the income drawer's matter errors** too (design 4A): «هذا الملف…» → «هذه القضية…».
- Expense drawer default currency (USD whatever the profile's) filed as MUT-319 (Basel D2).

### Tests
- See TEST_PLAN.md › MUT-318.

---

## [Unreleased] - 2026-10-19 — /privacy opens at the hero's height (MUT-251, epic MUT-101)

**Why:** `/privacy` left 160px above its heading (120px at ≤640px), room for a landing bar that floated over the page. MUT-77 moved the sticky bar into the flow, and the hero's top room dropped to `--space-16` (64px; `--space-10` at ≤640px). `/privacy` didn't follow: its heading sat 160px below the bar at 1280px and 120px at 375px, against the hero's 88px and 40px.

### Changed
- `--landing-page-top` is `var(--space-16)` and `--landing-page-top-compact` is `var(--space-10)` (`src/styles/theme.css`), the hero's own steps. Measured after: the heading sits 64px below the bar at 1280px and 40px at 375px, in English and Arabic. The values change only through the tokens (ADR-089); `PrivacyPolicyPage.css` is untouched.
- Before/after screenshots at 375 and 1280, EN and AR, beside the hero's, are attached to MUT-251 for sign-off.

---

## [Unreleased] - 2026-10-19 — A compact table's dates are one width on every day (MUT-250, epic MUT-101)

**Why:** `@web.brand.layout` failed on unchanged main on some days and passed on others. Income at 375px in Arabic measured 718–736px depending on today's date. The compact date column (`12/10/2026`) takes its width from its widest date, and Thmanyah's digits are proportional (`1` is narrow, `0` and `8` are wide), so the 726px cap held on 12/10 and failed on 19/10.

### Fixed
- **Compact dates use the figure face.** New `CompactDate` (`src/components/ui/CompactDate.tsx`) renders `formatDateCompact` in `.num` (IBM Plex Mono, tabular digits; brand: figures in Plex Mono, Thmanyah has no `tnum`). It is used on Income, the Expenses ledger (flat and grouped) and Conversions. Income at 375px in Arabic is now 735px on every date (9 dates measured). Wide tables keep their long dates ("Oct 19, 2026") in the body face; a first try that set every `.date-cell` in mono was reverted because it changed the desktop look.
- **The known-overflow caps are reset** from that stable measurement: `Income@375` and `Income drawer@375` are 735px (were 726). The written reason sits beside them in `qa/specs/web/brand.spec.ts`.

### Added
- QA `@web.brand.date-width`: Income at 375px in Arabic, logged and opened on 11 November, 8 August and 1 October, is the same width each time.

Files: `src/components/ui/CompactDate.tsx` (+ test), `src/components/ui/index.ts`, `src/pages/income/IncomePage.tsx`, `src/pages/expenses/ExpensesLedgerPage.tsx`, `src/pages/conversions/ConversionsPage.tsx`, `qa/specs/web/brand.spec.ts`, `qa/features/web/brand.yaml`; TD-083 updated.

---

## [Unreleased] - 2026-10-19 — Counts read right in English and Arabic (MUT-179, epic MUT-74)

**Why:** counted strings dropped a number into fixed text, giving English "1 clients" and "receipt(s)", and one Arabic noun form for every count ("متأخر 3 يوم", "مستحق خلال 34 يوم"). The landing page opens in Arabic (ADR-077), and its mocks showed 3, 34, 158 and 227 days, all in the wrong form. MUT-74's last open child.

### Fixed
- **18 counted strings are CLDR plural objects read through `tp()`.** English has `one`/`other`; Arabic has all six forms, with `one`/`two` in words. The strings are:
  - day counts: `transactions.status.overdue` and `dueIn`, `clients.index.oldestOverdue`, `expenses.recurring.occurrence.dueIn` and `overdueDays`;
  - entity counts: `clients.summary.clientsCount`, `clients.emptyFilteredCount`, `clients.crossProfileTxCount`, `projects.summary.projectsCount`;
  - receipts: `expenses.receiptsAttached`, `settings.exportReceiptsDesc` and `exportReceiptsDone`;
  - Settings and integrity messages: `settings.importBackupDone`, `orphanedRecords.assigned` and `partialFailure`, `integrity.orphanedRecord`, `checkIssues` and `toastIssues`.
- **Screens touched:**
  - the landing Clients and client-profile mocks;
  - Home Needs attention and the client work list;
  - the project profile;
  - Income (the overdue line, a caller the ticket missed and the grep gate caught);
  - Clients, Projects, the Expenses receipt badge, recurring rows and cards;
  - Settings › Your data;
  - the orphaned-records banner and drawer.

### Removed
- The hand-rolled `…Singular`/`…Plural` pairs (`importBackupDone`, `assigned`, `partialFailure`, `orphanedRecord`, `checkIssues`, `toastIssues`) and `clients.summary.clientsCountOne` / `projects.summary.projectsCountOne`, along with their `count === 1 ?` ternaries.
- `orphanedRecords.groups.*` is kept: the ticket listed it as unused, but the drawer reads it.

### Technical
- The count placeholder is `{count}` (was `{days}`). Test mocks of `lib/i18n` / `lib/i18n/core` now also mock `lib/i18n/plural` (PATTERNS › Plurals).
- No layout, bidi or digit change: strings only.

Files: `src/lib/i18n/translations/{en,ar}/{clients,expenses,integrity,projects,settings,transactions}.json`; the callers above; tests `pluralCountKeys.test.ts`, `HomeAttentionRow.plurals.test.tsx`, `landingMockPlurals.test.tsx` and updates to 9 suites; QA `web.home.attention-day-plurals`, `web.clients.count-plurals`, `web.landing.arabic-day-counts`.

---

## [Unreleased] - 2026-10-19 — Use the portal without an account: the server's routes run in the page (MUT-286, ADR-097, ADR-100)

**Why:** epic MUT-284's load-bearing ticket. Signed out, the portal runs the server's own route modules in the page over IndexedDB, so the free app and the hosted account are one portal with the same figures.

### Added (Phase C, user-visible)
- **A first visit opens the app on this device**, in Arabic, on an empty Personal profile, with no sign-in. One `GET /v1/me` decides: 200 keeps a pre-existing session on its account, 401 saves local mode (`session/mode.ts`, ADR-100). After that a signed-out person sends nothing.
- **Records survive reload and browser restart**, and two tabs see each other's saves (BroadcastChannel → query invalidation in `SessionBridge`).
- **Sign-in page:** "Continue on this device" under the form, so an expired session offers Sign in or this device, never a silent switch.
- **Account menu signed out:** "On this device" instead of an email; Sign in and Your data; no sign-out, password, Malafat, usage or store links. Expenses and Conversions are hidden until MUT-287.
- **Your data drawer** (`?yourData=true`): Download my records (versioned JSON, `mutaba3a-records-<date>.json`) and Restore from file (confirm names the record count; refuses a non-records or newer file; lands on the restored profile). `navigator.storage.persist()` after the first save.
- **Reload screen** when another tab saved records with a newer build (D1).
- **Add client from the picker** (both modes, owned profiles): a typed name no client has offers "Add client: «name»", which creates the client (`POST /v1/customers`) and picks it, in the income and expense drawers. Signed out this is how a client first exists, so money owed can be recorded (TD-172 resolved).

### Fixed (Phase C)
- The expense drawer's Client label now names its field (the picker had no `id`).
- Restore lands on the restored profile (it redirected from a stale `/v1/me`).
- Pre-landing review (ADR-100 decision 9):
  - another tab's sign-in or switch to this device now clears and reopens this tab;
  - a refused save or a newer format stops the page with a reload screen;
  - blocked storage has its own screen;
  - Download includes other tabs' latest saves;
  - Restore saves before switching memory;
  - the local session is never older than the person;
  - a failed Add client clears the previously picked client;
  - a slow earlier file can't override a later Restore pick;
  - the IndexedDB bundle rule is held to the `mut-local` chunk.

### Changed (Phase C)
- `client.ts` `request()` routes by mode through `send()`; sign-in and setup always go to the server; a local 401 never triggers the session-expired handler. The lazy chunk is reached through `@mut/local-backend` (types: `session/localBackendContract.ts`; code: `local/index.ts`).
- Guards: ESLint (portal ⊄ `server/src`, no static `@mut/local-backend`, `LOCAL_SERVER_ALLOWLIST` for `src/hosted/local`, server ⊄ app `src/`); `HOSTED_RULES` drop `indexedDB`, and `localBackendInEntryGraph` bans it from everything the entry loads statically (local chunk: 112.7 KB gzip).
- Release-QA: `qa/features/portal/local-mode.yaml` (`portal.local.*`) and its spec; portal openers default to `mut-mode=remote`; the sign-out and slow-session specs updated for local mode.

### Technical
- **Phase A, server refactor (behavior-preserving):** `server/src/app-shell.ts` `createApiShell`; `GET /v1/me` moved to `routes/me.ts` (sessions.ts keeps argon2, which can't run in a browser); `routes/portal-routes.ts` `PORTAL_ROUTES`, one registration list `createApp` loops over; `MemoryLedgerStore.snapshot()`/`restore()` (27 business maps, the six ephemeral ones left alone).
- **Phase A fixes:** memory `matchesExpense` now lets `unlinked` win over `customerId`, as Prisma does. A store-contract case locks receivable `createdAt` to the supplied `at`.
- **Phase B, `src/hosted/local/`:** `createLocalApp` (same shell, same `authenticate()`, `PORTAL_ROUTES`, no `contextStorage()`, attachments and FX null until MUT-287); `mintLocalSession` (finds or creates `local@device.invalid`, mints a fresh `mds_` device session every boot); `persistence.ts` (`mut-local` DB, snapshot + small version record in one transaction, resolves on `oncomplete`, refuses a newer format); `migrations/` (version = `CURRENT_STORE_SNAPSHOT_VERSION`, empty list); `locks.ts` (Web Locks + `BroadcastChannel`, reload when another tab wrote); `transport.ts` (fetch-shaped; only a 2xx mutating request persists).
- **Browser platform shims:** `platform/crypto.ts` (pure-JS synchronous SHA-256/HMAC, Web Crypto randomness), `buffer-shim.ts`, `async-hooks.ts`. They are aliased for `node:crypto` / `node:async_hooks` in `hostedConfig()` only.
- **Type checking:** new `tsconfig.hosted-local.json` (server strictness, server's `@types/node`), added to `npm run typecheck`. `tsconfig.hosted.json` excludes `src/hosted/local/**`. `server/tsconfig.json` drops `rootDir` so the shim test can import the shims (build output layout unchanged).

### Tests
- See TEST_PLAN.md › MUT-286.

---

## [Unreleased] - 2026-10-19 — Design: firm books brief and ADR-099 (MUT-299, epic MUT-298)

**Why:** small firms (law and accounting offices, agencies) want receipts, vendors, payables and a monthly close. MUT-299 locks the shared rules before any of the 15 build tickets starts.

### Added
- `.claude/designs/firm-books.md`: the brief. It covers:
  - the firm flag and the conversion of an owned profile;
  - the firm role matrix between `firm-role-matrix` markers;
  - approval, payables, VAT (invoice basis), month close and invites;
  - the `ReceiptSuggestion` contract;
  - full v1 contracts for MUT-300 and MUT-301, and names, shapes and error codes for v2–v5;
  - QA scenarios, build order and the pilot gate.
- `.claude/designs/firm-books-tests.md`: cross-cutting contract tests and the minimum tests for each child.
- `.claude/designs/mut-299-firm-books-plan.md`: the eng review (D1–D15, Basel) and the design review (DR1–DR14, approved by Basel with the brief on 2026-10-19).
- `.claude/designs/mut-299-firm-books-wireframe.html`: the RTL wireframe of six screens.
- ADR-099, with override-log rows: minimize-to-core decision 3 (firms only), MUT-252 decision 5, ADR-037 decision 1 (invites), the ADR-037 MUT-182 amendment (conversion), and MUT-298 intake decision 6 (copyable link).
- TODOS.md #16: adjusting entries, the upgrade path from "reopen to correct".

### Technical
- No code changes. The new error codes `ROLE_NOT_PERMITTED` and `PERIOD_CLOSED` are specified; they're added by the ticket that first raises each one.

---

## [Unreleased] - 2026-10-19 — Android app live: the Play Store link on the landing page and the portal

**Why:** the Android app is in production on Google Play, so the "Android coming soon" rows can become real store links.

### Changed
- `MOBILE_APP_LINKS.android` (`src/content/download-config.ts`) is now available, with `https://play.google.com/store/apps/details?id=com.barmajiyat.mutaba3a`. Every reader follows from the config:
  - the landing page's phone chapter links it with `utm_campaign=mutaba3a-landing`;
  - the portal's account menu shows "Get the Android app" with `utm_campaign=mutaba3a-portal`;
  - `/hosted` drops its Android "coming soon" chip but still never links a store (MUT-186, 9A).
- `scripts/bundle-origins.json`: `https://play.google.com` is allowed in the local and hosted bundles.
- The portal's account-menu unit test and the `@portal.account.get-the-app` spec expect the Android link. The `portal/account` and `web/landing` QA catalogs describe both links.

---

## [Unreleased] - 2026-10-18 — Design: the portal's local mode, one app signed in or out (MUT-285, ADR-097)

**Why:** epic MUT-284 retires the free local web app. One portal works on this device when signed out and is the hosted account when signed in, with the same screens either way. This ticket is the design only; MUT-286..292 build it.

### Added
- **Brief** `.claude/designs/mut-285-portal-local-mode.md`:
  - Signed out, `request()` hands each `Request` to an in-page `createLocalApp`: the server's own route modules over `MemoryLedgerStore`, persisted to IndexedDB.
  - The local backend authenticates as a locally seeded person through an ordinary device session, so no new auth code exists.
  - It covers all 49 portal calls, an owner module for every rule, persistence (versioned snapshot, migrations, Web Locks, persist() + download/restore), modes and session expiry, offline (PWA), receipts through a browser `AttachmentStorage`, the public FX route, guard changes, QA scenarios and the test strategy.
- **Plan and eng review** `.claude/designs/mut-285-local-mode-plan.md`, with owner decisions D1 (format version + migrations), D2 (persist() + download/restore) and D3 (anonymous `GET /v1/public/fx-rates`).
- **ADR-097**, with override log rows for ADR-037 §2 and MUT-185 decision 1, plus an override note inside ADR-037 decision 2.

### Changed
- `hosted-portal.md` §2, §7.5, §8 and §12 now point to ADR-097 where it supersedes them.

### Technical
- **Spike** (throwaway, not committed), measured in headless Chromium against the plan's gates:
  - the local chunk is 135.7 KB gzip;
  - no server module changed: `node:crypto` and `node:async_hooks` are aliased at build time, and the shim is byte-identical in 10,000 checks;
  - persist p95 is 23.6 ms at about 9.8k ledger records, once idempotency replay records are kept out of the snapshot (134.5 ms with them);
  - boot restore takes 40 ms, and the summary read 19.4 ms p95.

  Safari/WebKit was not run.

## [Unreleased] - 2026-10-18 — Server: Gulf currencies and a USD-peg table (MUT-280, ADR-098)

**Why:** epic MUT-278. People who bill in the Gulf can record AED, SAR, QAR, BHD and OMR on the hosted side, with rates from fixed USD pegs and the same single ECB provider. **Release:** after the phone (MUT-279) is out, and together with the portal (MUT-281) in one server release.

### Added
- **Currencies:** AED, SAR, QAR (2 decimals) and BHD, OMR (3 decimals) on every money endpoint (`server/src/money.ts`), appended after ILS/USD/EUR/JOD. Over-precision stays 422 `VALIDATION_FAILED`. No migration.
- **`currencies` on `GET /v1/me`, `POST /v1/sessions` and `POST /v1/device-sessions`:** the codes this server accepts, in order (`string[]`, required). The phone offers only these (MUT-279).
- **`docs/fx/pegs.json`:** the peg table for the web and phone tests, checked against the server's.

### Changed
- **Rates:** `JOD_PER_USD` became `USD_PEGS` (JOD, AED, SAR, QAR, BHD, OMR), typed so a currency with no rate source fails typecheck. `crossRates` prices every pair through USD; existing rates are unchanged. `derived` is now "either side pegged" (was "exactly one side JOD"), and its OpenAPI description lists every peg.
- **Analytics contract 1.2.0:** `docs/analytics/events.json` currencies are the nine server codes; new `PINNED_VERSIONS` row (D10).
- **Malafat project import** plans AED/SAR/QAR/BHD/OMR projects; KWD stays `UNSUPPORTED_CURRENCY`.
- **Version:** API 1.35.0-mut280. OpenAPI regenerated; the portal's `schema.d.ts` deliberately is not (TD-170, MUT-281).

### Technical
- Tests: `money.test.ts` (list, exponents, AED/BHD/OMR parsing, over-precision, BHD ceiling, KWD unsupported); `fx-rates.test.ts` (9×9 against a hand-built per-USD table with literal pegs, pegged↔pegged ratios, the `derived` matrix, the peg table, the fixture); `routes-fx-rates.test.ts` (nine ILS rows, base AED/BHD, KWD 422, pegged 503, every peg documented); Me on all three sign-in surfaces; income, expenses, conversions, profiles and import cases; a BHD expense through the Prisma store.
- CI: `server-ci.yml` also runs on `docs/fx/**`.
- Tech debt: TD-170.

## [Unreleased] - 2026-10-19 — Portal: Gulf currencies from one list, "(USD peg)" for every pegged currency (MUT-281)

**Why:** epic MUT-278. MUT-280 made the server accept AED/SAR/QAR/BHD/OMR; this is what makes them usable in the hosted portal. **Release:** together with MUT-280 in one server release (the portal ships inside the API image).

### Added
- **`HOSTED_CURRENCIES`** (`src/hosted/format/currencies.ts`) grows to all nine codes; `INCOME_CURRENCIES`, `FilterControls.tsx`'s and `data/filters.ts`'s own currency lists now derive from it instead of carrying separate hardcoded copies.
- Income, expense, conversion and profile forms offer every Gulf currency; BHD/OMR accept 3 decimals, AED/SAR/QAR cap at 2 (no code change needed in the drawers themselves — they already read their options and precision generically).

### Fixed
- **Expense group peg label**: `ExpenseGroupDetail`'s "≈ … (USD peg)" line tested `currency === 'JOD'` literally, so a BHD/OMR/AED/SAR/QAR pair would have shipped with no peg label at all (an ADR-087/098 honesty-rule violation). `convertTotal` now carries the server's own per-rate `derived` flag through each `used[]` line instead of re-deriving it from a hardcoded string.

### Technical
- **TD-170 resolved**: `npm run hosted:types` regenerated `schema.d.ts`. The resulting type errors forced widening the *shared* `Currency` type (`src/types/index.ts`) and `src/lib/utils.ts`'s exponent/token tables to all nine codes — not just portal-local files — because `src/components/expenses/ExpenseFormFields.tsx` (shared between the local app's and the portal's expense drawers) calls `currencyExponent()` directly; without the widening, BHD/OMR would have silently gotten 2-decimal precision instead of 3 in the portal's own expense form.
- The local app's own drawers (`ExpenseDrawer`, `IncomeDrawer`, `ConversionDrawer`, `LegacyExpenseEditDrawer`) keep offering only their existing narrower currency sets — Gulf entry there is MUT-282's job — so existing-record values are cast at the read boundary (same pattern as `ExpenseFormFields.tsx`'s pre-existing `currency as Currency` cast).
- Three local-app-only exhaustive `Record<Currency, …>` literals (`aggregations.ts`, `currencyAmounts.ts`, `ExpensesLedgerPage.tsx`) patched with zero-value entries — compile-only, no feature work, on pages slated for retirement under MUT-284/292. `landingCopy.ts` gets real ar/en Gulf currency names since the landing page survives that retirement (MUT-291).
- **Follow-up flagged, not resolved here**: MUT-282/283 ("Local web: currency registry", "Local web: any-base conversion") may need re-scoping or cancellation given the local app's planned retirement.

## [Unreleased] - 2026-10-18 — Change an expense's currency together with its amount (MUT-272, ADR-096)

**Why:** logging an expense in the wrong currency meant delete and re-log. This is the server half of MUT-272; the phone's Recent edit sheet (MUT-272 phone half) and the portal (MUT-277) build on it.

### Changed
- **`PATCH /v1/expenses/{id}`** accepts `currency` together with `amount`:
  - a currency alone is 422 `AMOUNT_REQUIRED` (`field: amount`), even when unchanged;
  - the amount is read in the merged currency's digits (JOD 3; "1.234" in USD is refused);
  - the audit adds `currency {from, to}` and `amount {from, to}` when the currency moved;
  - a stale If-Match is a 409 before the body's business rules run (schema validation still first), on this route and on `PATCH /v1/inbox/{id}` (pre-landing review: after a JOD → USD move a stale JOD-shaped amount used to answer 422 AMOUNT_INVALID).
- **Code:** `expensePatch` (`server/src/expenses/compose.ts`), `UpdateExpenseRequestSchema`, and `UpdateExpensePatch.currency` (both stores take it through their generic update).
- **Docs:** the route description; the inbox PATCH description no longer says an expense's currency is fixed (its own `AMOUNT_INVALID` code stays).
- **Docs:** `AMOUNT_REQUIRED` and `SAME_CURRENCY` join the published 422 reasons list (conversions already raised both).
- **Version:** API 1.34.0-mut272. OpenAPI and the portal's `schema.d.ts` are regenerated.

### Technical
- Tests: a new `server/src/expenses/__tests__/compose.test.ts`; `routes-expenses.test.ts` replaces "never changes a row's currency" with the pair rule, the JOD/USD digits, a stale If-Match, the exact per-version audit, the summary moving to the new currency, the same currency resent (no move audited), another profile's expense (404) and the stale-after-move 409; `inbox-routes.test.ts` gets the same stale-after-move 409; `routes-expense-groups.test.ts` checks a moved member regroups under its new currency (summary, day buckets, `?currency=`).
- Comments: the inbox request schema and the portal's `ExpenseDrawer` no longer say an expense's currency can't change.
- Portal: the expense drawer's currency select is disabled on edit (it was live, but the PATCH dropped the pick, so a USD choice silently saved ILS); MUT-277 enables it and sends the pair. Shared `ExpenseFormFields` gains `currencyDisabled`.
- Tests: a write landing between the read and the update is still a 409 from the store (expenses and inbox), proven to fail with the store-stale mapping removed.
- Tech debt: TD-169 (audit appended outside the write's transaction).

## [Unreleased] - 2026-10-18 — Portal: trip groups with daily and category spend (MUT-268, ADR-095)

**Why:** epic MUT-266. On MUT-267's API, a person groups a trip's expenses in the portal, prunes them and sees what the trip cost per currency, per day and per category.

### Added
- **Expenses · Groups** (`SectionTabs`): `/p/:id/expenses/groups` lists groups ongoing → upcoming → past with dates, day count, member count and up to two currency totals (+N); "Still going? Add an end date" after 11 months; "reached a year" once an open group stops collecting.
- **Group drawer** (`?newGroup=1`, `?editGroup=1`): name, From (today), To (capped at From + 365, required unless "Still going"), notes; edit hint; Delete confirmed in place with the member count. A 422 ends the idempotency attempt (TD-163).
- **Group page** `/p/:id/expenses/groups/:groupId` (`?currency=`, `?category=uuid|none`): headline per currency with counts, "≈ <profile currency> at today's ECB rate (<date>)" with per-currency rates and the JOD peg (hidden while loading/unavailable, "rate from" when stale), currency tab, per day, hand-built `DayBars` (daily ≤ 31 days, else weekly; sparse before/after bars past a ⋯ gap; keyboard and RTL arrows; jump to the day) and `CategoryBars` (filters the members), members by day oldest first with Kept, Leave out / Remove, Left out with Bring back, category "Leave out all", every 8A state.
- **Optimistic marks** with Undo/Retry toasts; one save at a time for batches; marks for one expense reach the server in order.
- **Add from outside these dates** (`?addToGroup=1`): the 30 days before (and after, for a closed group) minus members; partial result with Retry of the failed ones.
- **ExpenseDrawer "In groups"**: links, Leave out / Remove per group, "Add to group…".
- `playRowEnter` (`src/lib/motion/rowEnter.ts`): Undo retraces a row's exit.
- Release-QA: `qa/features/portal/expense-groups.yaml` (9 features) + `qa/specs/portal/expense-groups.spec.ts`; FakeApi learns groups, marks, summaries, paging and FX.

### Changed
- `Toast` options gain `action` (both tones); hover/focus holds the toast.
- `Skeleton` takes `rows`. `minorToDecimal` moves to `src/hosted/format/currencies.ts` (re-exported from `incomeForm.ts`). `usePrefersReducedMotion` moves to `src/lib/motion/mediaQuery.ts` (with `useMediaQuery`); `src/hooks/usePrefersReducedMotion.ts` re-exports it.
- Expense create/update/delete also refresh every group read. `request()` accepts PUT; `api.expenses` takes a signal.

### Fixed
- **Every portal page scrolled sideways on a phone** (found by the arabic-375 spec): the phone shell column was `1fr`, so the top bar's nav set its minimum width (~611 px). Now `minmax(0, 1fr)`.
- qa-reconcile and pre-landing review:
  - Left out retries in place.
  - Undo slides a row back in.
  - Day rows are keyed per day, so a later day's rows keep their nodes and focus.
  - The default currency tab is fixed at first load.
  - "Leave out all" clears the category before saving, and its Undo runs the two batches in turn with a failure toast.
  - From is required, and an unknown 422 no longer says "Couldn't reach".
  - Per day ignores days still to come.
  - `?newGroup=1` parses as a number too.
  - A deleted group leaves the cached list before navigation.
  - StrictMode no longer freezes the bar springs in dev.

## [Unreleased] - 2026-10-18 — Hosted expense groups: trips with per-day and per-category totals (MUT-267, ADR-094)

**Why:** epic MUT-266. A person groups a trip's expenses by date, prunes them, and sees what it cost. This is the API that the portal (MUT-268) and the phone (MUT-269) build on.

### Added
- **Tables.** `expense_groups` and `expense_group_overrides`, in the purely additive migration `20261018150000_mut267_expense_groups`.
- **Routes:**
  - `GET/POST /v1/expense-groups`: the list carries per-currency totals and `memberCount`; `?expenseId=` returns the groups an expense belongs to.
  - `GET/PATCH/DELETE /v1/expense-groups/{id}`: the detail carries an in-window `excludedCount`; PATCH uses If-Match; DELETE is soft and leaves the expenses alone.
  - `PUT/DELETE /v1/expense-groups/{id}/expenses/{expenseId}`: keep, leave out, reset.
  - `GET /v1/expense-groups/{id}/summary`: per currency, by category, client and day, with before/after buckets.
- **Ledger filter.** `GET /v1/expenses` gains `groupId` and `groupMembership`.
- **Code:**
  - `server/src/expenses/groups.ts`: the membership window, `isGroupMember`, series bounds, create/patch validation;
  - `summarizeGroup` in `summary.ts`;
  - `ExpenseGroupRepository` and `expenses.totalsByCurrency` on both stores.
- **Version.** API 1.33.0-mut267, numbered after MUT-270's unmerged 1.32.0. OpenAPI and the portal's `schema.d.ts` are regenerated.

### Changed
- Writability matrix: the `expenses` row covers `/v1/expense-groups*`, in both the code and the `hosted-portal.md` brief.
- Store guard: classifies the new methods in the expenses domain.
- Audit: `EXPENSE_ENTITY_TYPES` gains `expense_group`.

### Fixed (pre-landing review)
- **Future dates.** Group dates more than ten years ahead are refused (422 DATE_INVALID, bound future). A year-9999 group's summary used to answer 500.
- **Day loop.** It is a counted walk.
- **Group cap.** At most 200 live groups per profile (422 GROUP_LIMIT). The count and the insert happen in one transaction under the organization row lock, so parallel creates can't overshoot.
- **Ledger.** `groupMembership` without `groupId` is 422 GROUP_ID_REQUIRED.
- **PATCH.** A stale If-Match is a 409 before validation. An unchanged PATCH keeps its version and writes no audit, and the audit lists only changed fields.
- **Marks.** A repeated identical mark writes no audit.
- **Migration.** Renamed to `20261018150000_mut267_expense_groups`, so it no longer shares MUT-270's timestamp prefix.
- **Tests.** Added coverage for:
  - Malafat's audit feed hiding expense_group rows (mutation-checked);
  - the audit trail;
  - 404s on writes;
  - the totals chunks and summary pages;
  - groupPatch name branches.

### Technical
- Prisma's expense list now AND-merges the filter and cursor clauses (Q1).
- Deferred review items are recorded as TD-161 to TD-165.
- The shared store contract pins the Prisma `where` to `isGroupMember` on Postgres.
## [Unreleased] - 2026-10-18 — GET /v1/entries: one newest-first feed across a person's profiles (MUT-270, ADR-093, API 1.32.0-mut270)

**Why:** the phone's Recent (MUT-271) must mirror the portal, not just what the phone itself saved. Brief: `.claude/designs/mut-270-entries-feed.md`.

### Added
- **`GET /v1/entries`** (`server/src/routes/entries.ts`): session-only, no `X-Mutaba3a-Profile`. Expenses, received payments, Owed (ADJUSTMENT) receivables and conversions, newest logged first, `pagination.ts` cursor, optional repeatable `profileId` (404 outside your memberships), `limit` 1..100 default 20.
- **`server/src/entries/merge.ts`**: `mergeNewestFirst`, `isBeforeCursor`, `compareNewestFirst`, shared by both stores.
- **Store:** `entries.list` (memory + Prisma, one typed query per organization and kind) and `expenseReceipts.countReadyByExpenseIds`; store guard `sessionOnly` / `{ read: 'expenses' }`.
- **Migration `20261018120000_mut270_entries_feed_indexes`:** indexes only.
- **Review fixes (2026-10-18):** at most 4 feed queries in flight per request; received items carry `settlesOwedId` and `replacesPaymentId`; the route documents that a page is a snapshot; payment origin mapped exhaustively; the connection budget counts both revisions during a deploy.
- **Tests:** `routes-entries.test.ts` (14), `entries/__tests__/merge.test.ts` (6), `payments/__tests__/allocation-state.test.ts` (2), store contract `store-contract-entries.ts` (4, memory + Postgres), `store-prisma-entries-plan.test.ts` (2, EXPLAIN), `route-security.test.ts` updated.

### Changed
- **`IncomeStatus`** gains `partial`, `allocated`, `reversed`; `serializeIncomeEntry` reads a received payment's status from the record (`incomeStatusOf`). Fresh captures still read `unallocated`.
- **Terraform:** `db_pool_size` (10) as `connection_limit` in the DATABASE_URL, `db_max_connections` (50) as an explicit Cloud SQL flag, with a precondition (2 × pool × instances + 10 ≤ max). Adding the flag restarts Cloud SQL: apply the instance on its own first (INFRA.md).
- **CI:** `terraform test` runs for the GCP module too (`tests/database_pool.tftest.hcl`, mocked providers).
- `API_VERSION` 1.32.0-mut270; `openapi.yaml` and `src/hosted/api/schema.d.ts` regenerated.

## [Unreleased] - 2026-10-18 — Sentry contract 1.1.0: money keys, multi-line values and messages (MUT-147 convergence review, ADR-091 amendment 4)

**Why:** the fresh review after the merge found values the 1.0.0 rules still let through: money fields such as `grossMinor`, pretty-printed JSON, and the event message and breadcrumb messages, which were never scrubbed. 1.0.0 is merged, so the fixes ship as 1.1.0 and the 1.0.0 pin stays.

### Changed
- `docs/observability/sentry-rules.json` 1.1.0:
  - new deny tokens `minor`, `reference`, `label`, `metadata`, and plurals beside their singulars;
  - keys split at letter–digit boundaries (`email2`, `address2Line`);
  - a container value under a sensitive key runs on through the indented lines below it;
  - `messageDropFields` (`params`), and `^FormatException` keeps its first line only.
- `sentry-fixtures.json` 1.1.0: a pretty-printed JSON message (api), and a structured message with a dirty breadcrumb message (capture-app).
- `server/infrastructure/sentry`: the spike alert defaults to 10 an hour, and Terraform rejects a threshold at or above the smallest daily key cap, which could never fire. `backend.hcl.example` names the real bucket shape.
- `server/DEPLOYMENT.md` §1.5 step 4: `terraform init -backend-config=backend.production.hcl`, instead of a `TF_STATE_BUCKET` that step never sets.
- `docs/observability/README.md` rules 3 and 7, ADR-091 amendment 4, INFRA alert row.

### Changed by the second review pass (still 1.1.0, re-pinned before merge)
- **Bare-key containers.** One-line nesting under a bare key (Dart's `Map.toString`, single-line `util.inspect`) stopped at the first `}` and leaked later siblings, and `util.inspect` containers with a prefix (`Set(2) {`, `Client {`, `[Object: null prototype] {`) weren't seen as containers. Both now run to the end of the line and through the indented lines below. A 4,000-object fuzz went from about 700 leaks to none.
- **`==` is not a label**, so Flutter and JS assertion text is left alone.
- **First line only** also matches the start of the value: an obfuscated Flutter build renames `FormatException`.
- **Contexts.** `flutter_error_details.context` and `.information` are always dropped.
- **Plurals** `references`, `labels`, `ibans`, `mobiles`, `usernames`.
- **Fixtures.** A portal `logentry` with `params`; the capture-app fixture gains an obfuscated `FormatException` and `flutter_error_details`.
- **Tests.** Every message shape on an event is checked, not just the first; a `breadcrumbList` helper replaces four copies.
- **Docs.** README rules 3, 4 and 7 (including a new known limit: `;` inside an unquoted Dart map value), and DEPLOYMENT's tools list now says Terraform `>= 1.9`.

### Changed by the third review pass (still 1.1.0; the last fix cycle)
- **Pattern.** Quoted keys accept `=>` (`util.inspect` Map and URLSearchParams) and the `util.inspect` container prefixes; a bare key may be followed by `)`, for Dart's `Invalid argument (amountMinor): …` and `RangeError (amountMinor): …`. Before, all of these passed unchanged.
- **Deny tokens.** Plurals of the lowercase compounds (`phonenumbers`, `apikeys`, `emailaddresses`, …); before, `{"apikeys":["mut_live_x"]}` passed unchanged.
- **Docs.** README forms covered, both branches, the plurals sentence and a new known limit (bracketed form keys). ADR wording on the Terraform version. The capture-app fixture's `flutter_error_details.context` starts with `thrown`, as sentry_flutter writes it.

### Technical
- `sentry-rules.test.ts`: new leak cases (money keys, pretty JSON, `util.inspect`, digit keys, plurals); messages and breadcrumb messages go through the same checks and reproduction as exception values. `sentry-org-settings.test.ts`: a realistic single-page `Link` header passes.

## [Unreleased] - 2026-10-17 — The phone app asks first, then sends anonymous activation events (MUT-157, ADR-090, ADR-092)

**Why:** epic MUT-152's activation funnel on iOS and Android. Built in the Flutter repo on `feature/mut-157-phone-analytics` (its brief: `.claude/designs/mut-157-phone-analytics.md` there).

### Added (Flutter repo)
- **`lib/domain/services/analytics/`**, the app's own PostHog client (ADR-092), no SDK:
  - `analytics_contract.dart`, the phone's slice of `events.json`;
  - `analytics_guard.dart`, which builds every note's properties;
  - `analytics_store.dart`, the Keychain record of owner, choice, first-open flag, install ID and queue;
  - `analytics_transport.dart`, `POST {EU}/batch/`;
  - `product_analytics.dart`, with sync / choose / track / trackEntrySaved / endSession / away / flush, serialised.
- **Events:**
  - `analytics_opted_in {prompt}` + `app_first_opened` (once per person);
  - `client_created` on the server's ok;
  - `income_recorded {currency, paid}` / `expense_recorded {currency}` on the keypad's local save and on widget/Siri ingest;
  - one `analytics_opted_out`.
- **Prompt.** A one-time bottom sheet after the App Lock nudge, with two equal buttons. Settings › Privacy has "Share anonymous usage".
- **The key.** `Env.posthogKey` (`MUTABA3A_POSTHOG_KEY`), used only by release builds with a `phc_` key.
- **Tests:**
  - `test/fixtures/analytics/events.json` (1.1.0, sha256 pinned) and the parity test;
  - guard, service, prompt, Settings and hook tests;
  - release-QA `qa/features/ios/analytics.yaml` with 5 flows.

### Changed
- **Opt-out order:** capture, flush (offline it waits), opt out, delete the install ID. Signing out from Settings forgets the choice, the ID, the first-open flag and any undelivered notes, sending nothing. An expired session keeps them.
- **Docs.** `docs/analytics/README.md` rules 1 and 6 describe the phone's own client; ADR-092 is recorded.
- **Privacy policy.** The phone paragraph and network sentence are on mini-crm branch `feature/mut-157-phone-privacy`, to merge with the phone release.

## [Unreleased] - 2026-10-17 — The portal asks to share anonymous usage, then counts opens and saved money (MUT-155, ADR-090)

**Why:** epic MUT-152's activation funnel. A signed-in portal person can turn on anonymous usage counts; until they do, the portal loads nothing and sends nothing.

### Added
- **`src/hosted/analytics/portalAnalytics.ts`**, the only portal file that loads posthog-js:
  - `syncPortalUsage(userId)`: another account's choice is reset; a stored "on" counts `portal_opened` once per page load;
  - `choosePortalUsage(choice, prompt)`: on sends `analytics_opted_in {prompt}`; off sends one `analytics_opted_out`, then resets the ID and deletes every `ph_*` / `__ph_*` key;
  - `endPortalUsage()` (sign-out) and `trackPortal(event, props)`.
  - The choice is kept as `{owner, choice}` in `localStorage` (`mutaba3a-portal-usage`), never sent.
  - The SDK, the contract and the guard load together, lazily, only after a yes. A build without a key drops the SDK entirely (dead code after the key check).
- **`UsagePrompt`**: a one-time inline notice at the top of the page, two buttons of equal weight (B1, B2).
- **`UsageMenuItem`**: "Share anonymous usage" as a `menuitemcheckbox` in the account menu (B3). Neither shows on a build with no key.
- **Counted saves** (after the server confirms): `income_recorded {currency, paid}`, `payment_recorded {currency}`, `expense_recorded {currency}` (create only, B6).
- **Release-QA:**
  - `qa/features/portal/usage-analytics.yaml` and its spec (5 scenarios);
  - `@portal.account.get-the-app`.

### Changed
- **Sign-out** (this tab or another) forgets the choice and the random ID, sending nothing. Session expiry keeps them (B4).
- **The account menu's store links** carry `ct=mutaba3a-portal`.
- **Privacy policy (en + ar):** the portal sentence in "Anonymous usage counts" and in "What reaches the network".
- **Server:** `PORTAL_CSP` `connect-src` adds `https://eu.i.posthog.com`. This needs a server release; `DEPLOYMENT.md` says why.
- **The portal's key reaches the build:**
  - `Makefile` exports `MUTABA3A_POSTHOG_KEY` to `deploy.sh`'s `npm run build:hosted`;
  - `deploy.env.example` documents it.
- **`check-bundles`:**
  - fails if PostHog is statically reachable from the portal's entry (it loads only after consent);
  - the hosted origin allowlist gains PostHog's library strings.

### Fixed (qa-reconcile review)
- **F1: opting out in one tab now silences every tab.**
  - The portal SDK starts with `opt_out_capturing_by_default` and `opt_out_persistence_by_default`, and is opted in only while the choice is on. Deleting its consent record leaves it opted out everywhere, writing nothing back.
  - Opt-out order is the ticket's: capture the last note, opt out, then `reset(true)`.
  - A `storage` listener makes another tab follow the change. That tab forgets its own sessionStorage keys, sending nothing.
  - `trackPortal` re-reads the record before sending.
- **F2.** An opt-out or sign-out made while the SDK is still loading wins. The load is memoized, and every step re-checks the choice after awaiting it.
- **F3.** A save made right after a reload waits for the SDK instead of being lost.
- **F4.** The opt-out and sign-out sweep covers sessionStorage too.
- **F5.** `portalAnalytics.sdk.test.ts` runs the flow against the real posthog-js.
- **F6.** The prompt's title is a labelled paragraph, not an `h2` above the page's `h1`.
- QA adds `other-tab-silenced`.

### Technical
- Files:
  - `src/hosted/analytics/*`, `src/hosted/components/{UsagePrompt,UsageMenuItem,IncomeCaptureDrawer,RecordPaymentDrawer,ExpenseDrawer,AppDownloadMenuItems}.tsx`;
  - `src/hosted/shell/{HostedShell,UserMenu}.tsx`, `src/hosted/session/endSession.ts`, `src/hosted/hosted.css`, `src/hosted/i18n/{en,ar}.json`;
  - the en/ar `landing.json`, `server/src/app.ts`, `server/DEPLOYMENT.md`, `Makefile`, `deploy.env.example`;
  - `scripts/check-bundles.ts`, `scripts/bundle-origins.json`, `qa/**`.

## [Unreleased] - 2026-10-17 — Landing page counts visits and CTA clicks, cookieless (MUT-154, ADR-090)

**Why:** epic MUT-152's acquisition funnel. The landing pages now count visits and calls to action in PostHog EU, with no cookie and nothing stored on the device. The free local app and desktop still send nothing.

### Added
- **`src/lib/analytics/`**, shared with the portal (MUT-155):
  - `contract.ts`, a typed view of `events.json`;
  - `guard.ts`, the required `before_send` guard;
  - `posthogConfig.ts`, the EU host and every SDK feature off;
  - `posthogKey.ts`.
- **`src/pages/landing/analytics/landingAnalytics.ts`.** `useLandingAnalytics()` in the four landing pages starts posthog-js (a dynamic chunk) after idle, cookieless. One delegated click listener plus `ctaForHref()` sends `landing_cta_clicked`.
- **The key.** `MUTABA3A_POSTHOG_KEY` (a `phc_` key only, validated) becomes `__POSTHOG_KEY__` for the web and hosted builds; desktop gets `""`. `posthog-js` is pinned to 1.435.5.
- **Guards:**
  - ESLint keeps posthog-js in the analytics modules;
  - `check-bundles.ts` fails if PostHog is statically reachable from the web entry or present in desktop;
  - PostHog's library origins are allowlisted.
- **Store links name their campaign** (`storeLinkUrl(link, campaign)`): Apple `ct` (and `pt` once known), Play UTM referrer.
- **Release-QA:**
  - `qa/features/web/landing-analytics.yaml` and its spec;
  - `qa/support/posthog.ts`, which answers PostHog locally in every spec;
  - QA builds use a dummy key.

### Changed
- **Privacy policy (en + ar):**
  - the intro names the hosted portal;
  - "No analytics" is narrowed to the free apps in scope, noTracking (now "No ads, no tracking"), sharing and network;
  - a new "Anonymous usage counts" section;
  - "Last updated" is 17 October 2026.
- **Docs:** `docs/analytics/README.md` and ADR-090 name `MUTABA3A_POSTHOG_KEY` and the fixed EU host; INFRA says where the key is set on each surface.

### Fixed (qa-reconcile review)
- **F1.** The service worker no longer precaches the SDK or the guard:
  - posthog-js is the named chunk `vendor-posthog` (web build only);
  - it and `posthogConfig-*` are in `globIgnores`;
  - `check-bundles` fails if any precached file mentions PostHog.
- **F2.** ESLint forbids importing `landing/analytics` outside the landing and download pages, and `lib/analytics/{posthogConfig,guard}` outside the analytics modules.
- **F3.** The landing guard drops `$os` and `$browser`. The contract allows URL, UTM, referrer and device type, and the policy says PostHog keeps no browser details. The README names the cookieless markers.
- **F4.** The contract, guard and init options load lazily with the SDK. Counting waits for the `load` event, then idle, so first paint carries none of it.
- **F5, F6:**
  - the QA spy answers every `*.posthog.com` host and records paths;
  - the landing spec proves only event posts leave, and catches `__ph_*` keys.
- **F7.** `src/lib/analytics` may import posthog-js types only. The storage-seam patterns are shared as `STORAGE_SEAM_PATTERNS`, so the block that adds this rule keeps them.
- **F8.** The README says release-QA builds carry a dummy key.

### Technical
- Files: `src/lib/analytics/*`, `src/pages/landing/analytics/*`, the four landing pages, `PhoneSection.tsx`, `download-config.ts`, `malafatLinks.ts` (comment), `vite.config.ts`, `src/vite-env.d.ts`, `eslint.config.js`, `scripts/bundle-rules.ts`, `scripts/check-bundles.ts`, `scripts/bundle-origins.json`, `package.json`, the en/ar `landing.json`, `PrivacyPolicyPage.tsx`, `qa/**`, the docs above.

## [Unreleased] - 2026-10-18 — Release QA caps its dev servers' heap

### Changed
- `qa/qa.config.mjs` starts both QA dev servers (web on 5173, hosted portal on 5175) with `--max-old-space-size=2048` (`HEAP_CAPPED`). Node's default lets each grow to about 4 GB. A long recorded run alongside Playwright and an iOS Simulator can then push the laptop into swap until the disk fills, which is what took down the Malafat QA env on 2026-10-17.
- Vite normally stays far below the cap. It only bounds a leak.
- This is the part of the Malafat fix that applies here. Malafat's root cause was `next dev` giving its server half the machine's RAM as heap; this repo has no Next.js.
- Files: `qa/qa.config.mjs`.

---

## [Unreleased] - 2026-10-17 — Sentry foundation: EU org, projects, alerts and error-data rules (MUT-147, ADR-091)

**Why:** epic MUT-146. Production failures were found only when users complained. The four live surfaces (server, portal, landing, phone) need one Sentry setup and one rulebook for what an error report may contain, before any SDK is wired (MUT-148..151). The local app still sends nothing.

### Added
- `docs/observability/sentry-rules.json` and `sentry-fixtures.json` (contract 1.0.0, both sha-pinned).
  - Deny headers and deny key tokens, matched as whole tokens.
  - Allowed tags, user `{ id }` only, safe context keys and `device.name` always dropped.
  - Required SDK options, and the server's status floor of 500.
  - Per-surface ignored errors, in a regex subset JavaScript and Dart read the same way.
  - The org privacy settings, and five dirty-in/clean-out fixtures covering all four surfaces.
- `docs/observability/README.md`:
  - who sends, the rules, how to change the contract, and where each DSN and token lives (with the `VITE_` and Flutter `.env` landmines);
  - the draft en/ar privacy-policy sentences per surface, and the store disclosures.
- `server/infrastructure/sentry/`, a new Terraform root module (own state prefix):
  - team and four projects, `default_key = false`, one rate-limited key each;
  - `allowed_domains` on portal and landing, browser inbound filters, spike protection on all four;
  - new-issue, regression and spike email alerts, and DSN outputs;
  - `tests/sentry.tftest.hcl` runs against a mocked provider.
- `scripts/sentry-org-settings.ts --apply|--check` (logic in `scripts/sentry-org-policy.ts`): sets and verifies the org privacy settings that the provider can't hold.
- ADR-091. `server/DEPLOYMENT.md` §1.5 (one-time Sentry setup). TD-159 (deprecated alert resource), TD-160 (no scheduled privacy check).

### Changed
- `.github/workflows/server-ci.yml`: the Terraform job is a matrix over both modules and runs `terraform test` for the Sentry one.
- INFRA §1 gains an "Error reporting" table. The CI_CD monitoring row now reads "defined, not wired". The env examples list the Sentry variables.
- The Flutter `.env.example` line and its upload-token warning are left to MUT-151 (decision D3); the README documents them.

### Changed by the pre-landing review (`/qa-reconcile` + `/review`, 2026-10-17)

The review was the core pass, 5 specialists, the red team and the adversarial pass. Basel decided D1–D13; contract 1.0.0 was re-pinned before merge. The full list is the ADR-091 amendment.

- **Fixed.** The settings script failed from the folder the runbook leaves you in (QA probes 002–004 reproduced it). It now finds its rules file from its own location.
- **Server-side sensitive fields.** They are a curated `orgSensitiveFields` list, because Sentry wipes any value containing an entry. `--apply` merges with hand-added fields.
- **Fragments.** URL fragments and queries are stripped from every URL field, including navigation breadcrumbs, because the portal's `/setup#token` was the leak.
- **Labelled values.** `key: value` and JSON `"key": value` are caught too, through one shared `labelledValuePattern`. Prisma errors keep their first line only, and the server uses `errorFormat: 'minimal'`.
- **EU region.** It is verified by a Terraform DSN postcondition and by the script's region check. The runbook's `sentry.io` fallback is gone.
- **Daily caps.** Keys are capped per day, and the sum must fit the monthly quota.
- **Org switches.** The script also sets Enhanced Privacy on, shared issues off, 2FA required and no safe fields.
- **Tokens and script.**
  - The admin token is `SENTRY_ADMIN_TOKEN`.
  - The script takes only `--apply`/`--check`, with the org from `SENTRY_ORG`, and sends the token only to `sentry.io` hosts.
  - Requests time out, and an empty PUT body counts as written.
- **Contract rules.** Frame `vars` are dropped and `includeLocalVariables: false`. Lowercase compound keys are denied.
- **CI and checkouts.** New `.github/workflows/contracts-ci.yml`. New `.gitattributes`, so the contract JSON is LF on every checkout.
- **Docs.**
  - The README no longer claims a `check-bundles` guard that doesn't exist (MUT-149/150 add it, TD-084).
  - The phone starts Sentry only in release builds.
  - The Netlify upload token is Production-scoped and secret.
  - The suggested org slug is `mutaba3a`.

### Changed by the re-review (fix cycle 2, D15–D17)

- **Labelled values.** `labelledValuePattern` has a quoted-key branch (compact or spaced JSON) and a bare-key branch whose value runs to the end of the clause, and the scan continues from a harmless label's value. Compact `JSON.stringify` output, `Authorization: Bearer …`, multi-word names and comma amounts are now filtered; before, they leaked. Surfaces truncate a message to `maxMessageLength` (8,192) before scrubbing, which keeps the worst case at about 20 ms; without the cap, rescans after harmless labels go quadratic. A fixed list of leak strings must vanish, so the test no longer grades the pattern with itself.
- **Wrong-org guard.** The settings script refuses an org holding any project that isn't `mutaba3a-…`, before writing.
- **Request fields.** `Referer` is dropped, `fragment` is denied, and whole request fields are listed in `requestDropFields`.
- **Mechanical fixes.**
  - The admin token is a personal (user) token.
  - Terraform `>= 1.9.0`.
  - Requests refuse redirects.
  - The region check ignores a trailing slash.
  - The tfvars example lists daily caps and `monthly_event_quota`.
  - Two stale descriptions are fixed.

### Changed by the final re-review (fix cycle 3, D18–D19)

The review stopped at its three-cycle limit: these changes passed the full gate and QA, but no fourth review pass.

- **Nested and cut-off values.** Under a sensitive quoted key, a nested object or array is filtered to the end of the line, and so is a quoted value cut off by truncation. Before, `{"emails":["a@b","c@d"]}` leaked `c@d`. Under a bare key, a parenthetical no longer ends the value.
- **Domain labels (D18).** `client(s)`, `vendor(s)`, `mobile`, `tel`, `mail`, `title` and `reason` are deny tokens.
- **URLs in text (D19).** `urlInTextPattern` strips query and fragment from URLs inside error text.
- **Fixtures and tests.** The reference scrub must reproduce every fixture. The portal fixture gains `request.fragment`, `request.env` and a URL with a token in its message.
- **Settings script.** It refuses a paginated project list, and its admin-token error names a personal token.
- **Docs.** The runbook checks the org slug in the plan before apply. The README documents the order of operations, the Dart timing and two more limits (keys over 64 characters, `key:value` with no space). TEST_PLAN corrections.

### Technical
- `scripts/__tests__/sentry-rules.test.ts` (99 cases) and `scripts/__tests__/sentry-org-settings.test.ts` (37 cases, including a CLI run from the Sentry module folder). The Terraform tests: 13 runs in two files (`eu_region.tftest.hcl` has its own state).

---


## [Unreleased] - 2026-10-17 — Analytics decision and event contract (MUT-153, ADR-090)

**Why:** epic MUT-152 adds opt-in, anonymous PostHog analytics to the landing page, the portal and the phone app. Every doc said "no analytics of any kind", and the three surfaces needed one list of what they may send. No SDK ships here.

### Added
- `docs/analytics/events.json`: the versioned (1.1.0) event contract.
  - 10 events, with their emitters. Portal and phone both emit income, expense and payment events, because the portal records them since MUT-133.
  - The shared properties: surface, app_version, locale.
  - Typed properties: enum, boolean, integer, currency (the app's four), and semver (app_version only). No free text.
- `docs/analytics/README.md`:
  - who sends, and the rules: a required guard against anything outside the contract, SDK `$` URL properties dropped on the portal and phone, no cookies on the portal, no SDK before consent, the opt-out order, reset on sign-out, no location, no joining, production-only keys, and where the landing SDK may start;
  - suggested opt-in copy, and how to change the contract (and its Flutter copy);
  - the approved en/ar privacy-policy and store-disclosure wording each surface publishes when it ships.
- `scripts/__tests__/analytics-taxonomy.test.ts`: 118 cases. The currency codes live in the contract and are checked against the server's `SUPPORTED_CURRENCIES`.
  - It enforces the contract and pins a sha256 per version.
  - It refuses banned name tokens (whole-token, each with its own row, so `paid` passes and `client_id` fails), error and failure events, and server/web/desktop emitters.
  - It also refuses unknown keys, extra shared properties, and `semver` outside app_version.
- ADR-090. TODOS #15 (move the PostHog config to Terraform).

### Changed
- README: the "No tracking" promise and the "never add analytics SDKs" line now name the free app on Mac, Windows and in the browser.
- SYSTEM_OVERVIEW, INFRA §1 and the CI_CD monitoring table are scoped the same way.
- INFRA §1 gains a PostHog row: project 304889 (EU), which already existed empty.
  - The ADR-090 settings were applied through the PostHog MCP and read back.
  - The default GeoIP transformation was disabled.
  - Restricting project access is listed as Basel's operator step.
- Pre-landing review (`/qa-reconcile` + `/review`, 2026-10-17): the specialists, Red Team and the adversarial pass found that the portal records money (P2 re-decided: portal emits too), that GeoIP was on, plus 30 more wording, rule and test gaps. All were folded in; see the brief's "Pre-landing review" section.
- The public privacy policy and landing copy are deliberately unchanged: each surface publishes its own paragraph (P3).

### Technical
- Files: `docs/analytics/events.json`, `docs/analytics/README.md`, `scripts/__tests__/analytics-taxonomy.test.ts`, `.claude/DECISIONS.md`, `.claude/designs/mut-153-analytics-adr-taxonomy.md`, `README.md`, `.claude/SYSTEM_OVERVIEW.md`, `.claude/INFRA.md`, `.claude/CI_CD.md`, `TODOS.md`, `.claude/TEST_PLAN.md`.

## [Unreleased] - 2026-10-16 — Web test coverage, risk files first, enforced in a new Web CI (MUT-24 §C)

**Why:** coverage was invisible and unenforced. No web CI existed (only `server-ci.yml` and `build-windows.yml`), and the riskiest code was the least tested: the Dexie upgrade history (42.6% lines), migration safety (72.9%), CSV import, the third payment-record writer of MUT-60 (68.2%), and the portal's MUT-227 floor helper (untested).

### Added
- `.github/workflows/web-ci.yml` (decision D2): on PRs, pushes to main and manual dispatch, skipping server-only and docs-only changes. One Node 22 job with the npm cache runs `npm ci`, lint, typecheck and `npm run test:coverage`, then appends a coverage table to the job summary.
- `scripts/coverage-summary.ts` + `coverage-summary-format.ts` (tested): `coverage-summary.json` → markdown with the four totals and the ten files with the most uncovered lines.
- `vitest.config.ts` `coverage.thresholds`: global floors lines 91 / statements 91 / functions 88 / branches 84, plus per-file floors. Pure money, date, overdue and ordering helpers are pinned at 100. Repository, CSV import, expense repository, database, migration safety and the income error map are at 95. Reporters `json-summary` and `text-summary` added, and `reportOnFailure` is on.
- `src/test/legacyDexie.ts`: rebuilds the on-disk schema at any past version from `database.ts`'s own version history. `migration-history.test.ts` uses it to run the v8, v10, v11, v13, v14, v15, v17 and v18 upgrades from their previous shape for the first time, plus the v20, v22, v23 and v24 log-instead-of-throw fallbacks.
- New tests: `migration-safety-paths`, `paymentRecordEdges`, `aggregationFilters`, `csvImportRows`, `expenseRepoPaths`, `CurrencySummaryPopup`, the `moneyDateFloor` pin, and the remaining routes of the income, settle, re-date and conversion error maps. All assert behaviour, with no snapshots.

### Changed
- Six tests that cross the 5 s default only under coverage instrumentation take `SLOW_UNDER_COVERAGE` (15 s, `src/test/timeouts.ts`) as a per-test option. The global timeout is unchanged.

### Technical
- Coverage went from 89.48 / 88.55 / 87.24 / 81.07 to 91.69 / 91.01 / 88.74 / 84.12 (lines / statements / functions / branches). Per-file numbers are in `.claude/designs/mut-24-todo-backlog.md` §C and TEST_PLAN.
- Debt found on the way: TD-153 (a future-dated paid CSV row stops the import halfway and leaves a record-less paid entry), TD-154 (two date-only reads treated as UTC midnight west of UTC), TD-155 (coverage-only timeouts that get worse under host load).

## [Unreleased] - 2026-10-16 — Fix: change-password races and an unbounded current password (MUT-237, MUT-238 review)

**Why:** MUT-238's pre-landing red team and adversarial review found three server problems in `POST /v1/me/password`. The phone sends concurrent requests on one token, and one of them could still revoke the session that just changed the password. Two changes racing from the phone and the portal both answered 204 and signed both out. And `currentPassword` had no length cap, so any signed-in caller could make argon2 verify a multi-megabyte string.

### Fixed
- Session middleware: a session that looks verified before `passwordChangedAt` is read again before it is revoked, so a request that read it just before its own change committed keeps working (`verifiedSincePasswordChange` in `middleware.ts`).
- `users.changePassword` takes `verifiedPasswordHash` and, under the row lock, refuses with `StateConflict('user', 'CREDENTIAL_CHANGED')` and writes nothing when the stored hash moved or the kept session is not the person's live session. The route answers 403 `CURRENT_PASSWORD_WRONG` and does not count a failed attempt. Resolves TD-151.
- `ChangePasswordRequest.currentPassword` is at most 1024 characters (sign-in's ceiling, now a shared constant); a longer one is a 422 and never reaches the hasher.

### Technical
- API 1.31.1-mut237: OpenAPI (`maxLength: 1024`, and the 403/422 descriptions) and `src/hosted/api/schema.d.ts` regenerated (descriptions only). No status code or response shape changed, so MUT-238's client needs nothing. No migration.
- Tests: route +4 (the interleaved session read, a still-stale session read just before a change, racing changes, the 1024 cap); store contract +3 per store, and one changed: a session that isn't the person's own is now refused, not silently skipped.
- New debt TD-158 (the kept session's token is not rotated).
- Files: `server/src/auth/middleware.ts`, `server/src/routes/sessions.ts`, `server/src/schemas.ts`, `server/src/app.ts`, `server/src/repositories/{ports,memory,prisma}.ts`, `server/openapi/openapi.yaml`, `src/hosted/api/schema.d.ts`, `server/src/__tests__/routes-sessions.test.ts`, `server/src/__tests__/routes-m{2,3,4,5,6,8}.test.ts` (pinned version), `server/src/repositories/__tests__/store-contract-change-password.ts`.

## [Unreleased] - 2026-10-16 — Fix: changing your password no longer signs out this session (MUT-237)

**Why:** MUT-238's iPhone release QA found that after `POST /v1/me/password` the caller's own session got `401 SESSION_EXPIRED` on its next request, so the phone and the portal tab both signed out. The session check refused any session older than `passwordChangedAt`, and the kept session was always older. The route tests missed it because their clock never moved between sign-in and the change.

### Fixed
- `sessions.credentialsVerifiedAt` (new, NOT NULL, backfilled from `createdAt`): the session middleware compares `passwordChangedAt` with it instead of `createdAt`. `users.changePassword` re-stamps only the kept session, in the same locked transaction. Other sessions, and racing sign-ins, still fail the check. Neither expiry deadline moves.

### Technical
- Migration `20261016180000_mut237_session_credentials_verified_at` (additive + backfill). `SessionRecord.credentialsVerifiedAt` in the port, memory and Prisma stores. No API or OpenAPI change.
- Tests now advance the clock before the change. Route: +1 test, and 3 changed to assert that the kept web or device session still answers 200, the absolute deadline and `createdAt` are unchanged, and the other sessions get 401. Store contract: +2 per store (the re-stamp; a session belonging to someone else is never re-stamped).
- Files: `server/prisma/schema.prisma`, `server/prisma/migrations/20261016180000_…/migration.sql`, `server/src/auth/middleware.ts`, `server/src/repositories/{ports,memory,prisma}.ts`, `server/src/__tests__/routes-sessions.test.ts`, `server/src/repositories/__tests__/store-contract-change-password.ts`.

## [Unreleased] - 2026-10-16 — Brand v2 spacing guard: spacing comes from tokens (MUT-165, ADR-089)

**Why:** MUT-103 made colours, radii and font sizes token-only, but 175 hard-coded px/rem padding, margin and gap values remained, so the density it set could drift back one value at a time. The brand JSON's spacing scale also disagreed with the web's `--space-*`, and nothing read it.

### Changed
- **One spacing scale (D7/D8).** `mutaba3a.tokens.json` `space` is now the union `[2,4,6,8,10,12,16,20,24,28,32,40,48,56,64,96]`; `mutaba3a-theme.css` gains `--m-space-<n>` (rem), and `theme.css`'s `--space-0-5`…`--space-16` read them. Pixel-identical on the web; Flutter has no scale.
- **Named sizes (D5/D6)** in `theme.css` Layout: `--demo-banner-height` (the banner and both shell offsets), `--checkbox-size` (the recurring drawer's checkbox and its indent), and `--landing-section-pad(-compact)`, `--landing-hero-pad-end`, `--landing-page-top(-compact)`. Pixel-identical.
- **The sweep:** 124 CSS declarations in 16 files and 51 TSX style-object values in 9 files move onto their exact `--space-*` step (`'var(--space-N)'` strings in TSX). `-1px` becomes `calc(var(--space-px) * -1)`, and token px fallbacks go.
- **Visible (D4):** the segmented control's track padding and thumb inset go 3px → 2px together (the control is 2px shorter), as do the cross-profile badge's gap and the Settings section icon's nudge (1px higher).

### Added
- `brand.test.ts` › `literals`: the `spacing` kind. CSS `padding*`/`margin*`/`gap`/`row-gap`/`column-gap` with a non-zero px or rem (negatives, fallbacks, `calc()` terms), one `var()` hop to a component custom property holding a raw length (D10), and TSX style-object spacing keys (`SCRIPT_SPACING`). `KNOWN_LITERALS` froze 175 and is empty again.
- `brand.test.ts` › `drift`/`tokens`: the JSON and `--m-space-*` agree both ways, and every `--space-N` reads the N × 4px step.
- Release QA: `@web.brand.layout` covers the landing page and `/privacy` in every cell (D9), and its Settings step asserts each segmented highlight is centred (D11). `@portal.shell.navigate` attaches shell screenshots in English and Arabic.

### Technical
- Files: `src/styles/brand/mutaba3a.tokens.json`, `src/styles/brand/mutaba3a-theme.css`, `src/styles/theme.css`, `src/test/css/brandCss.ts`, `src/styles/__tests__/brand.test.ts`, `src/index.css`, the 15 other component/page stylesheets and 9 TSX files above, `qa/specs/web/brand.spec.ts`, `qa/specs/portal/shell.spec.ts`, `qa/features/web/brand.yaml`, `qa/features/portal/shell.yaml`, `docs/brand/README.md`.

## [Unreleased] - 2026-10-16 — TODO.md cleared: locale split, key check, What's new (MUT-24, ADR-151)

**Why:** `TODO.md` was a second backlog. MUT-24 tracks its items; this lands A (locale split) and B (What's new). C (coverage, web CI) landed separately above.

### Added
- **What's new** (`WhatsNewModal` + `WhatsNewController`, `src/lib/whatsNew/`). On the first start after an update it shows every version since the one this browser last dismissed, newest first, in the chosen language. Got it, Escape or the backdrop dismiss it, and Settings › About reopens the running version's notes.
  - A fresh install never sees it. It waits while the welcome or the sample setup owns the screen.
  - Storage keys: `whats-new-seen-version`, seeded at start from `handleVersionChange`, which now returns the previous version.
- `release-notes.json` (repo root): user-facing en + ar lines per version, the one place notes are written (ADR-151).
  - `make release-web` stops after the bump without a well-formed entry (`npm run release:notes -- <v>`).
  - `tag-release.sh` puts the English lines in the web tag's message, read from the tagged commit.
  - 0.1.7's entry is a draft from the commits since `web-v0.1.6`.
- `MUTABA3A_APP_VERSION` build override (`appVersion()` in `vite.config.ts`, x.y.z or the build fails), so a QA build can run as the version the notes describe before the bump.
- `npm run i18n:check` / `scripts/i18n-keys.ts`: fails on a key code asks for that the dictionary lacks, and on a key nothing can reach. It gates `test:run` through `scripts/__tests__/i18n-keys.test.ts`.
- Release-QA `qa/features/web/whats-new.yaml` (after-update, fresh-install, reopen-arabic) and `qa/specs/web/whats-new.spec.ts`, passing on a 0.1.7 preview build.

### Changed
- **The app's locale files are split by feature:** `src/lib/i18n/translations/{en,ar}/*.json`, 19 files each, holding whole namespaces, so no key path changed. `index.ts` composes them with `composeDictionary`, which throws if two files define one namespace.
  - `translations.test.ts` checks file/namespace parity and full en/ar parity.
  - The parity checker is shared with the portal (`src/test/i18nParity.ts`). Arabic `…Singular` strings may drop `{count}` (TD-156).
- `compareVersions` moved from `useCheckForUpdates` to `src/lib/whatsNew/releaseNotes.ts`. `APP_VERSION` lives in `src/lib/appVersion.ts`.

### Fixed
- Projects: a search with no match showed `projects.emptyFiltered`, `projects.emptyFilteredCount` and `projects.clearSearch` as raw text in both languages. The keys did not exist, and `t()` returns the key, so the `|| fallback` never ran. The keys now exist; the count is a six-form plural.
- Expenses by category: an uncategorized group was titled `common.noCategory`. It now uses `common.uncategorized`.

### Removed
- 121 orphaned keys in both languages (bulk upload, the old reports page and transaction drawer, profile switcher copy, …) and `bulkUpload.json`.
- The unused hand-written `Translations` interface (`src/lib/i18n/types.ts`).
- `ExpenseDrawer`'s dead `|| 'fallback'` toasts.
- `TODO.md`.

### Technical
- Dictionaries: en 15.4 KB gz, ar 18.3 KB gz (before: 16.6 / 19.7). Both are still loaded eagerly. Lazy-loading would save only the inactive language, and the Arabic default needs `ar` on first paint.
- Debt found on the way: TD-156 (six Arabic `…Singular` strings are pre-plural copies), TD-157 (the key check cannot see a key built from an undotted variable).

---

## [Unreleased] - 2026-10-16 — Change your own password (MUT-237, ADR-037 amendment)

**Why:** setting a password only ever happened through an operator-issued setup link (MUT-235/236); nobody signed in could change one they already knew, so a routine password change meant asking Basel for a fresh link.

### Added
- `POST /v1/me/password` (session or device bearer, organization-independent like `GET /v1/me`): the current password is checked under the same email-keyed `SignInThrottle`/lockout a wrong sign-in would trip, so repeated wrong guesses here lock the account there too. On success: `users.changePassword` (one transaction, the same row-lock discipline ADR-088 §7a added for `--lock`/redeem) sets the hash, revokes every other session — web and device, the caller's own stays live — and audits `user.password_changed` (USER), distinct from `user.password_set`.
- A wrong current password (or a locked account) answers `403 CURRENT_PASSWORD_WRONG`, not `401` — a new error code, since a 401 here would trip the portal's generic session-expired handler and sign the person out mid-form.
- The account menu's "Change password" drawer (`?changePassword=true`, a new `AccountDrawers` controller beside `ProfileDrawers`), reusing the setup page's password-rule field shape — a show/hide toggle on each field included; a wrong current password shows a banner and keeps the form, a short new password is refused inline.
- Release-QA `qa/features/portal/account.yaml` (change-password, wrong-current-password, password-rule) + `qa/specs/portal/account.spec.ts`.
- API 1.31.0-mut237 (stacked on 1.30.0-mut240, below).

## [Unreleased] - 2026-10-16 — Inbox count for the Capture hub (MUT-240, API 1.30.0-mut240)

**Why:** the Capture hub's Recent handle (MUT-230 §6/§17a) wants an exact "N to file" without paging the whole `GET /v1/inbox` list; `countByUser` already existed but was classified `operator`-only.

### Added
- `GET /v1/inbox/count` → `{count}`, session/device-session auth, no `X-Mutaba3a-Profile` — the fifth organization-independent inbox route, next to the four CRUD ones.

### Changed
- `STORE_ACCESS.inboxEntries.countByUser` reclassified `operator` → `sessionOnly`: the same basis as the inbox's other methods. `/admin`'s per-user support lookup still calls it, unaffected — admin routes run with no store guard at all.

### Technical
- Route tests cover zero/non-zero/cross-user isolation and the 401/403 principal checks; `route-security.test.ts`'s generated operation inventory picks the new route up automatically.

## [Unreleased] - 2026-10-16 — Portal: set your password from a setup link (MUT-236, ADR-088)

**Why:** since MUT-235 a new or reset account gets a one-time link `<portal>/setup#<token>`, and the portal had no page for it, so nobody could finish setting up. Ships in the same `make release server` as MUT-235.

### Added
- `/setup` (public, like `/sign-in`): reads the token from the fragment and strips it from the address bar at once (router `replace` = `history.replaceState`), checks the link once, and opens in the account's locale unless this browser holds a chosen language (MUT-209). Expired, used, superseded, unknown and incomplete links each get their own heading in EN and AR and no form; "used" offers Go to sign in.
- The form: the email in a visible read-only `autocomplete="username"` input (D2), one `autocomplete="new-password"` field with Show/Hide, the 12–128 rule always shown and enforced before any request. Save redeems, then signs in through `POST /v1/sessions` and lands on Home; if that sign-in fails, "Your password is saved" with a link to sign in.
- TD-149: Save is disabled while saving; a "used" answer after an attempt that got no answer (network, timeout, 5xx) first signs in with the typed password (D3), and only if that fails says the password is probably saved.
- Release-QA `qa/features/portal/setup.yaml` (set-password, refused-links, password-rule, answer-lost) + `qa/specs/portal/setup.spec.ts`; the in-memory API answers the setup routes.

### Changed
- `CheckingSession` takes an optional `label` ("Checking your link" on `/setup`).
- `SessionBridge`: another tab's sign-out no longer sends a tab on `/setup` to sign-in (it would lose the token).
- `retryMinutes(error)` moved to `src/hosted/api/client.ts`; sign-in and setup share it.

### Fixed (build)
- A second setup link pasted into a tab already on `/setup` changes only the fragment; the page now checks the new token instead of showing the old one's answer.

### Technical
- `src/hosted/pages/auth/setupLink.ts` (policy mirrored from the server and pinned to the OpenAPI `NewPassword` bounds by a test, token reading, redeem-failure mapping); `api.checkSetupLink` / `api.redeemSetupLink`; the check query never refetches (eng review A1). `well-known-routes.test.ts` names `/setup` as never claimed by the AASA paths.

## [Unreleased] - 2026-10-16 — Setup links replace printed passwords (MUT-235, ADR-088, API 1.29.0-mut235)

**Why:** `provision:user` and `rotate:password` printed a password Basel delivered by hand, so until it was used the operator knew a working password to someone's money, and nobody could change their own. Onboarding the first paying hosted users needs something people trust, without self-service signup.

### Added
- `POST /v1/account-setup/check` and `POST /v1/account-setup`: public, same-origin, IP-limited (sharing the sign-in limiter under their own key). Check answers `valid` (email, locale, purpose, expiry) or only `expired | used | superseded | invalid`. Redeem sets a 12–128 character password, signs out every web and device session, issues none, and refuses an unusable link with 410 `SETUP_LINK_UNUSABLE` (`details.state`).
- `POST /admin/v1/users/{id}/setup-link` (`validHours` 1–720, `lock`): an operator reset as a link. The current password works until the link is used; `lock` (a suspected takeover) clears it and revokes every session at once. A disabled user is 409 `USER_DISABLED`.
- `npm run rotate:password -- --lock`, and `--valid-hours` on `provision:user` and `rotate:password`.
- Audit actions `user.setup_link_issued` (ADMIN) and `user.password_set` (USER).

### Changed
- `POST /admin/v1/users` creates the account with no password and returns `setupLink` in place of `initialPassword` (optional `setupLinkValidHours`). The CLI prints the link once.
- `npm run seed:demo-account` sets its fresh password through a setup link, the way a person would; `MUTABA3A_SEED_PASSWORD` behaves as before.
- `no-self-registration.test.ts` pins the public operations to exactly sign-in and the setup-link pair; ADR-037 §1 carries an override note.

### Removed
- **Breaking, admin surface only:** `POST /admin/v1/users/{id}/password` and the `initialPassword` / `PasswordResetResponse` shapes. Only the operator CLI and the seed script called them; both are updated, so run the new CLI only against a server at 1.29.0-mut235 or later (an older CLI against this server gets 404 on reset). Malafat and the phone never call admin routes.

### Fixed (qa-reconcile, before landing)
- Links are https in production: `PORTAL_ORIGIN` is unset there and Cloud Run hands the server plain http, so links came out `http://…`. Now `PORTAL_ORIGIN` when set, else the request host over https (loopback keeps http).
- Disabling a person cancels their open links; re-enabling no longer revives an old one.
- `--lock` stamps `passwordChangedAt`, and sign-in now creates its session only while the hash it verified is still the person's (re-checked under a shared row lock), so a sign-in overlapping a lock is refused instead of keeping a session; redeem uses a fresh instant after hashing.
- Issuing a link re-checks that the person is active under its row lock (409 `USER_DISABLED`), so a racing disable cannot be followed by a fresh link.
- Setting a password clears the in-process sign-in throttle, so the sign-in straight after works even after failed attempts.
- `POST /admin/v1/users` writes the first link in the same transaction as the user.
- A JSON content type with an empty body is 422 `VALIDATION_FAILED` app-wide, not 500 (TD-148).
- `…/setup-link` echoes `lock`, and the CLI prints from the server's answer; `user.password_set` names the link.
- DEPLOYMENT.md: setup-link onboarding, `--lock`, the new audit actions, a "Roll back past MUT-235" row, and the pepper rotation voiding open links.

### Technical
- Migration `20261016090000_mut235_account_setup_tokens` (additive): `account_setup_tokens`, enum `SetupLinkPurpose`, `users.passwordHash` nullable. `AccountSetupRepository` (memory + Prisma): issue cancels open links under a `FOR NO KEY UPDATE` row lock; redeem claims inside the password transaction. Operator-only in the store guard.
- `server/src/auth/account-setup.ts` (`SETUP_LINK_POLICY`, `NEW_PASSWORD_POLICY`, `setupLinkState`, `setupUrl`), `server/src/routes/account-setup.ts`; route suites provision through `server/src/__tests__/helpers/provision.ts`; OpenAPI and `src/hosted/api/schema.d.ts` regenerated; version pins moved to 1.29.0-mut235.
- Release: the `/setup` page is MUT-236, served by the same server build, so ship both in one `make release server`.

## [Unreleased] - 2026-10-15 — Hosted API serves reference exchange rates (MUT-228, ADR-087, API 1.28.0-mut228)

**Why:** the phone (MUT-229) shows what a foreign-currency amount is in the profile's own currency and the market rate beside a logged conversion. The server had no rates, and copying the web's browser-side Frankfurter call into a second client would drift.

### Added
- `GET /v1/fx-rates?base=` for sessions and device sessions (no API keys, no profile header): every supported currency against `base`, the ECB rate date, when this instance fetched them, and `live` or `stale`.
- JOD is derived from the USD peg (0.709) and marked `derived`; the ECB publishes no JOD rate.
- Error code `FX_RATES_UNAVAILABLE` (503): no rates to serve. A missing or unknown `base` is 422 `VALIDATION_FAILED`.
- Config: `FX_RATES_URL` (https; plain http only for a localhost stub), `FX_RATES_TTL_MINUTES` (240), `FX_RATES_TIMEOUT_MS` (3000).

### Technical
- `server/src/fx-rates.ts` (`crossRates`, `FrankfurterSource`, `CachedFxRates`: single-flight, stale on failure, 60 s backoff, a 7-day age cap on the ECB rate date (future or invalid dates refused too), no redirects, per instance like TD-017; filled once at startup by `warm()`, whose failure does not start the backoff), `server/src/routes/fx-rates.ts`, schemas, `app.ts`/`index.ts` wiring; OpenAPI and `src/hosted/api/schema.d.ts` regenerated; version pins in the route tests moved to 1.28.0-mut228.

## [Unreleased] - 2026-10-15 — Money dates have a ten-year floor (MUT-227, ADR-086, API 1.27.0-mut227)

**Why:** the hosted API accepted any valid past date, so a typo like `0001-01-01` or 2006 for 2026 saved silently. Since MUT-223 a settled entry or payment can also be re-dated, so one typo could move it decades back and skew aging, `lastPaymentOn` and month views.

### Fixed
- Every hosted money date is refused more than ten years (3660 days) before the organization's today, on create and on edit: income, settle, both re-dates, `POST /v1/payments` (Malafat's key included), expenses, conversions and inbox filing. The floor day itself is accepted. 422 `DATE_INVALID` with `details.bound: 'past'`.
- Inbox capture and edit refuse a typo year straight away, measured leniently from UTC's yesterday, so capture never refuses a date filing would accept.
- The portal's Add income and Record payment say "The date can't be more than ten years ago" instead of "later than today" for such a date (`hosted.income.errors.dateTooOld`, en + ar).

### Changed
- `DATE_INVALID` from a range check carries `details.bound` (`past` | `future`); the reason enum is unchanged. API 1.27.0-mut227; every floored request field says so in OpenAPI. OpenAPI and hosted types are regenerated.
- Not changed: expense list and summary `from`/`to` filters still take any date, and rows already older than the floor stay readable and editable. Expense, conversion and inbox PATCH skip a resent, unchanged date, because the portal sends it on every save (pre-landing review D1).
- A Malafat correction (`replacesPaymentId`) may keep the reversed payment's date, or a later one, below the floor, so the second step of reverse-and-replace can't strand the money (review D4).
- Expense and conversion forms also say "The date can't be more than ten years ago" (`apiErrorBound` in `src/hosted/api/client.ts`, review D2).
- MUT-224's re-date drawer (landed first) now refuses a date before the floor itself, with `min` on the date input (`moneyDateFloor` in `src/hosted/format/dates.ts`), routes a server refusal by `bound` (`mapRedateError`), and still closes untouched for an entry already older than the floor.
- Still unbounded (follow-up, review D3): an Owed entry's `dueDate`, a credit's `effectiveDate`, an installment trigger date.

### Technical
- `assertNotTooOld` and `DAYS_IN_PAST_LIMIT` beside the ceiling (`server/src/agreements/compose.ts`); `pastMoneyDate` (`server/src/income/compose.ts`) is the one call for income-like dates; `expenseOccurredOn` (`server/src/expenses/compose.ts`); `inboxDate(value, now)`.
- The phone half (too-old labels for an outbox row and File from Recent) is on mutaba3a-flutter `feature/mut-227-date-floor`.
- Files: `server/src/{agreements,income,expenses,inbox}/compose.ts`, `server/src/routes/{income,receivables,payments,expenses,conversions,inbox}.ts`, `server/src/{schemas,app}.ts`, `server/openapi/openapi.yaml`, `src/hosted/api/schema.d.ts`, `src/hosted/components/incomeApiErrors.ts`, `src/hosted/i18n/{en,ar}.json`, `qa/features/portal/income.yaml`, `qa/specs/portal/income.spec.ts`, tests below.

## [Unreleased] - 2026-10-15 — The web QA baseline goes green: the phone bar fits, the slow-route loader is held in builds (MUT-231)

**Why:** nine release-QA cells failed on main (the baseline MUT-226 recorded on a093306), so the web suite could never pass with no retries.
- `@web.landing.375` (4 cells) is an app bug. `f1e8c43` put "Sign in now" in the landing bar beside the switch and the bar's button, whose slot is kept even while it is hidden. On phones that left the wordmark 47 of 110 px at 375 EN (EN at 481–487 px clipped too).
- `@web.brand.loader-slow-route` (5 cells) was a spec problem. `holdInsightsCode` matched only dev-server module paths, and a build's service worker serves the precached chunk with no request. Once the chunk was held, light and dark hit axe's best-practice `page-has-heading-one`: the loader stands in for the whole page, TopBar h1 included. They hit it on the dev server too, so those two cells had never passed.

### Fixed
- At ≤640 px, Sign in and the bar's button share one slot. Sign in shows while the hero's button is on screen; once it has scrolled away, the bar's button fades in over it, and the hidden one leaves the tab order. Wider screens are unchanged. The wordmark fits at 320, 375, 414 and 481 in both languages.

### Technical
- `LandingHeader`: `.landing-header-slot[data-cta-visible]` wraps the sign-in link and `HeaderCta`. It is `display: contents` above 640 px and a one-cell grid below. CSS in `LandingPage.css`.
- `brand.spec.ts`: the slow-route tests sit in a `describe` with `serviceWorkers: 'block'`. `holdInsightsCode` also holds the built chunk that exports `InsightsPage`. `KNOWN_AXE_VIOLATIONS.loader` = `page-has-heading-one`, by design, like `portalBoot`'s `region`.
- `landing.spec.ts` `@web.landing.375` now also checks Sign in is shown at the top and hidden once scrolled.
- Files: `src/pages/landing/components/LandingHeader.tsx`, `src/pages/landing/LandingPage.css`, `src/pages/landing/__tests__/LandingHeader.test.tsx`, `qa/specs/web/{brand,landing}.spec.ts`, `qa/support/axe.ts`, `qa/features/web/landing.yaml`.

## [Unreleased] - 2026-10-15 — Hosted portal: change the date of a saved income entry and a recorded payment (MUT-224)

**Why:** MUT-223 gave the server re-dating; the portal still had no way to fix a wrong day on an Owed entry or a recorded payment. Expenses could already be re-dated. ADR-083 (MUT-224 amendment).

### Added
- `RedateDrawer` (one drawer, two kinds): `?income=<receivableId>` changes an Owed entry's date (PATCH /v1/income) and `?payment=<paymentId>` a recorded payment's received date (PATCH /v1/payments). It reads the record fresh, sends If-Match at that version, refills on a 409 re-read, shows a 422 under the date and a 404 as no longer available. A settled entry lists its payment lines, found by scanning the client's first 50 payments, with a "See this client's payments" fallback (TD-145).
- Receivables: a **Date** column (postingDate) before Due; own Owed rows open the drawer by their row-link. Payments: the user's own posted capture opens it from its Received cell.
- `HostedTable` `linkColumn` and `canOpen`; `redateAffordancesFor`, `canRedateOwed`, `canRedatePayment`; `usePayment`, `usePaymentsForEntry`, `useRedateOwed`, `useRedatePayment`; `api.payment`, `redateIncome`, `redatePayment`.
- Release-QA: `portal.income.redate-{owed,received,payment,no-future,conflict,malafat-readonly}` and `portal.expenses.redate-expense`; the portal stub serves the new routes.

### Changed
- The Record payment note now reads "You can fix the date later; the amount can't be changed yet." (en + ar).
- Record payment and the Payments expander stop propagation, so they never open the re-date drawer.

### Not changed
- Malafat-fed and unowned profiles: no row-link, no clickable look, and `?income=` / `?payment=` deep links render nothing.

### Fixed in review (qa-reconcile)
- A record the server would refuse (an undone payment, someone else's capture, an entry Malafat posted) opened a working Save that did nothing: GET answers 200 there and only the PATCH says 404, which was mapped to a silent re-read. The drawer now checks `canRedateOwed` / `canRedatePayment` on the record it loaded and shows "no longer available"; a 404 on save also toasts it.
- A save that answered after the drawer closed called the old `onClose` and closed whatever drawer was open by then (resetting its filters). It now does nothing once unmounted.
- A background refetch with a new version replaced a typed date, and Save then closed without saving. The date now refills only after a 409's re-read or when nothing was typed.

## [Unreleased] - 2026-10-15 — Expenses Needs attention reaches back to the rule's start (MUT-96, TD-069)

**Why:** `getDueOccurrences` asked only for the last 90 days, so a monthly rule that started six months ago and was never marked silently lost its oldest months, from the row and from the totals.

### Fixed
- Needs attention lists every unresolved payment since the later of the rule's start date and the day after its last resolved payment (paid or skipped). This is option 1 on the ticket, chosen by the owner 2026-10-15. Row amounts and the section total include them all.
- A rule with more than six missed payments reads "37 payments since Oct 2023 not marked" instead of naming every month. Arabic gets its own plural forms. Up to six are still named.
- The window's dates are local calendar dates; they were UTC.

### Technical
- `formatMonthShortYear` added to `recurringAttention.ts`; `notMarkedSince` plural copy in both locales.
- New QA feature `web.expenses.recurring-long-missed`.
- Files: `src/services/recurringExpenseService.ts`, `src/components/expenses/{RecurringAttentionList.tsx,recurringAttention.ts}`, both translation files, tests below, `qa/specs/web/expenses.spec.ts`, `qa/features/web/expenses.yaml`.

## [Unreleased] - 2026-10-15 — The sample's part-paid entries come with payment records (MUT-95, TD-063)

**Why:** payment records own payment state (ADR-039). The sample seeded part-paid entries with a received amount and no record, so the first real payment summed the records alone and Owed now went up (₪4,001.28 left, pay ₪2,000, then ₪4,300 left). The overpayment guard counted records only, too.

### Fixed
- The sample writes one payment record for every paid and part-paid entry, adding up to what it has received, by the v23 backfill's rule. Each is dated on the entry's paid or issue date, never after today.
- A payment on a part-paid sample entry now lowers what is owed by exactly that amount, and the guard uses the true remainder. Payments shows each seeded payment once, with no "Recorded on the entry" fallback row.
- Removing the sample removes every payment on a sample entry, including ones the visitor recorded.

### Technical
- `DEMO_PREFIXES.paymentRecord` = `demo_payment_`. `samplePaymentRecords` lives in `src/db/demoData.ts`, beside the backfill rule it reuses.
- New QA feature `web.record-payment.sample-part-paid`. It failed on the old seed (expected 3001.28, got 5300).
- Files: `src/db/demoData.ts`, `src/demo/constants.ts`, `src/demo/__tests__/seedPayments.test.ts` (new), `qa/specs/web/record-payment.spec.ts`, `qa/features/web/record-payment.yaml`.

## [Unreleased] - 2026-10-15 — Demo mode shows its summary and opens a sample business (MUT-220)

**Why:** `activateDemo` set `showConfirmModal` to false, so AppShell unmounted the dialog before its summary rendered. The switch to the demo business ran before the business list refetched, so `useActiveProfile`'s repair put the person straight back on their own business. The dialog also promised "1 business profile" when it seeds 3.

### Fixed
- After Show Demo the dialog shows the Demo Mode Activated summary, now with a Businesses count. Get Started closes it and reloads.
- The demo seed refetches every query before making the first demo business active, so the repair has nothing to fix and the app opens on the sample business.
- The dialog says how many businesses it creates, from the seed's own list: "{count} business profiles", in English and Arabic.

### Technical
- `activateDemo` no longer closes the dialog.
- QA `web.onboarding.demo-summary` is automated (no `test.fail`, no `manual`). `web.onboarding.demo-mode` follows the new flow: summary, Get Started, already on the sample business.
- Files: `src/demo/demoStore.ts`, `src/components/modals/DemoSeedModal.tsx`, both translation files, the new `DemoSeedModal.test.tsx`, `qa/specs/web/onboarding.spec.ts`, `qa/features/web/onboarding.yaml`.

## [Unreleased] - 2026-10-15 — QA specs wait for Owed now before reading it (MUT-178)

**Why:** `@web.clients.owed-now-parity`, `@web.home` and `@web.brand.type` read Home's Owed now with `allTextContents()` (or checked the loaded font faces) straight after `goto`. That doesn't wait, so the specs raced Home's receivables query and usually failed.

### Fixed
- The Owed now reads in `clients.spec.ts` and `home.spec.ts` are web-first `toHaveText` assertions. `brand.spec.ts` step 1 waits for the amount to show, then polls the loaded faces for IBM Plex Mono.
- No QA spec calls `allTextContents()` any more.

### Technical
- QA specs only, no app code. Run: the three specs pass 45/45 with `--repeat-each 5 --retries 0`. Full web suite (preview build, 2 workers, no retries): 114 passed. The 9 failures are the baseline that MUT-226 recorded on main a093306: five `@web.brand.loader-slow-route` cells and four `@web.landing.375` cells. `demo-summary` is the expected `test.fail` (MUT-220).
- Files: `qa/specs/web/{clients,home,brand}.spec.ts`.

## [Unreleased] - 2026-10-15 — Idempotency compares JSON bodies by meaning (MUT-199, ADR-085, API 1.26.3-mut199)

**Why:** the fingerprint hashed the raw body. The phone widget (Swift: random key order, `\/`) and the app's replay (Dart) send the same capture as different bytes, so the app's replay after a lost widget response was refused as `IDEMPOTENCY_KEY_REUSED`.

### Fixed
- A JSON body is fingerprinted canonically: keys sorted at every depth, with no whitespace or escaping differences. The app's replay of a widget save now gets the stored 2xx. Different values and array order are still a different request.
- Keys stored before the change still replay a byte-identical request, through a fallback to the byte fingerprint (ADR-085 §3).

### Changed
- API 1.26.3-mut199. The API description says how bodies compare. OpenAPI and hosted types are regenerated.

### Technical
- `requestFingerprint` is exported from `server/src/idempotency.ts`.
- Files: `server/src/{idempotency,app}.ts`, `server/src/__tests__/idempotency-fingerprint.test.ts` (new), the `routes-m*` version pins, `server/openapi/openapi.yaml`, `src/hosted/api/schema.d.ts`.

## [Unreleased] - 2026-10-15 — Payment writes lock in id order; a lost lock is a 409 (MUT-130, TD-104, API 1.26.2-mut130)

**Why:** the contingency outcome writes lock upfront receivables in id order. Allocations and reversals locked them in request order, so the two could deadlock, and the payments side answered the loser with a 500.

### Fixed
- Recording, allocating, settling and reversing lock every receivable they touch in id order before writing, so they can no longer deadlock with an outcome write (or with each other).
- A lock conflict that still happens answers 409, never 500: `PREVIEW_STALE` on record and allocate (preview again), `VERSION_MISMATCH` on reverse and settle (send again). Nothing is written.

### Changed
- API 1.26.2-mut130. The reverse route's description names the new 409. OpenAPI and hosted types are regenerated.

### Technical
- `LockConflict` lives in `server/src/repositories/memory.ts`. The Prisma store's `asLockConflict` and `lockReceivablesInIdOrder` are in `prisma.ts`. Pattern added to PATTERNS.md.
- Files: `server/src/repositories/{memory,prisma}.ts`, `server/src/routes/{payments,receivables}.ts`, `server/src/app.ts`, `server/openapi/openapi.yaml`, `src/hosted/api/schema.d.ts`, tests below.

## [Unreleased] - 2026-10-15 — Oversized amounts are a 422, not a 500 (MUT-126, TD-100, API 1.26.1-mut126)

**Why:** `parseMoney` accepted any number of digits. An amount whose minor units overflow Postgres `BIGINT` passed validation, then failed inside the write with a Prisma error, and the caller got a 500.

### Fixed
- Every amount the hosted API parses is refused above 999,999,999,999,999 minor units, either sign (9,999,999,999,999.99 in a 2-decimal currency, 999,999,999,999.999 in JOD), with 422 `AMOUNT_INVALID` naming the field. The headroom below `BIGINT` also keeps sums of many amounts in range.

### Changed
- API 1.26.1-mut126. `AmountSchema`'s OpenAPI description states the bound. OpenAPI and `src/hosted/api/schema.d.ts` are regenerated (descriptions only).

### Technical
- `MAX_AMOUNT_MINOR` is exported from `server/src/money.ts`. The precision test now formats a large value directly rather than parsing one above the bound.
- Files: `server/src/{money,schemas,app}.ts`, `server/openapi/openapi.yaml`, `src/hosted/api/schema.d.ts`, `server/src/__tests__/{money,routes-m2,routes-m3,routes-m4,routes-m5,routes-m6,routes-m8,routes-mut100}.test.ts`.

## [Unreleased] - 2026-10-15 — Conversions list refreshes after a write (MUT-217)

**Why:** `invalidateConversionQueries` refreshed only the transaction queries. The Conversions list is keyed `['conversions', filters]`, so a logged, edited or deleted conversion only showed after a reload.

### Fixed
- Logging, editing and deleting a conversion also invalidates the `['conversions']` prefix, so the list and a reopened drawer show the change straight away.

### Technical
- New `src/hooks/__tests__/useConversionQueries.test.tsx` (real Dexie on fake IndexedDB).
- QA `web.conversions.log` and `web.conversions.edit-delete` are no longer `manual`.
- Files: `src/hooks/useConversionQueries.ts`, the new test, `qa/features/web/conversions.yaml`, `qa/specs/web/conversions.spec.ts`.

## [Unreleased] - 2026-10-15 — Portal expense drawer recovers from a 409 (MUT-221)

**Why:** on `CONFLICT` the portal's ExpenseDrawer only showed a toast. Nothing re-read the expense, so the form kept the stale version, and every later Save sent the same `If-Match` and was refused again.

### Fixed
- On `409 CONFLICT` the drawer refetches the expense, refills at the new version and stays open with the conflict toast. The next Save carries the new `If-Match`. This is the same handling as ConversionDrawer (MUT-194 D6).
- The form refills only when the expense id or version changes, not on every refetch, so a background refetch never wipes what was typed.

### Technical
- `expenseKey(profileId, expenseId)` exported from `src/hosted/data/expenseQueries.ts` and reused by its three invalidations.
- QA `portal.expenses.edit-conflict` is no longer `manual`.
- Files: `src/hosted/components/ExpenseDrawer.tsx`, `src/hosted/data/expenseQueries.ts`, `src/hosted/components/__tests__/ExpenseDrawer.test.tsx`, `qa/features/portal/expenses.yaml`, `qa/specs/portal/expenses.spec.ts`.

## [Unreleased] - 2026-10-15 — "Delete all data" deletes all data (MUT-164, ADR-084)

**Why:** it cleared five of the 19 tables. Businesses, expenses, receipt files and payment records all survived a confirmation that promised "all data".

### Fixed
- Delete all data empties every table except settings, in one transaction. Settings keep currencies, the last-backup time and Malafat suggestions; the optional areas go back off.
- Afterwards every query refetches, and the saved active business, demo mode and the onboarding walkthrough reset. With no business left, the welcome flow opens again.
- The modal says what is deleted and what is kept, in English and Arabic.

### Changed
- `dataset.wipeCoreData` is now `dataset.wipeAllData`.

### Technical
- TODOS #10 removed (done).
- Files: `src/db/{seed,dataset,interfaces}.ts`, `src/components/modals/DeleteAllDataModal.{tsx,css}`, both translation files, `qa/specs/web/data.spec.ts`, `qa/features/web/data.yaml`, the two test files below.

## [Unreleased] - 2026-10-15 — Hosted API: change the date of a saved income entry or payment (MUT-223)

**Why:** on a hosted profile a saved Owed entry or a recorded payment kept its date forever; a payment logged on the wrong day could not be fixed at all, since a settled entry cannot be undone (TD-126). Expenses and conversions could already be re-dated. Server half only; the portal (MUT-224) and phone (MUT-225) build on it. ADR-083.

### Added
- `PATCH /v1/income/{incomeId}` `{ occurredOn }` (session/device session, `capture:write`, If-Match): an Owed entry moves `postingDate` and keeps `dueDate`; a Received entry moves its payment's `receivedOn`. A payment already applied to an entry (a settle) is 409 `ALREADY_ALLOCATED`.
- `PATCH /v1/payments/{paymentId}` `{ receivedOn }` (session/device session, `payments:write`, If-Match): a person's own `CAPTURE` payment, settle payments included; allocations untouched, the settled entry's paid date follows.
- Store: `receivables.redateAdjustment`, `payments.redateCapture` — one conditional write each, the owner/origin/liveness predicate and the version in the WHERE (memory + Postgres, store-guard classified).
- `AuditFilter.excludeActions`; `GET /v1/audit` passes `SESSION_ONLY_ACTIONS` (`income.owed.redated`, `payment.redated`).
- `income/compose.ts`: `isOwnProfile`, `isOwnCapture`, `redateTo`. `routes/payments.ts`: `redateOwnCapture` (shared by both routes).

### Changed
- `IncomeResponse` carries `version` (additive), so a client can send If-Match straight from a create.
- API `1.26.0-mut223`; OpenAPI and `src/hosted/api/schema.d.ts` regenerated; `route-security.test.ts`'s income inventory lists the two PATCHes.

### Not changed
- Amount, client, matter and note stay uneditable; Malafat-fed and firm profiles stay closed (404, or 403 `READ_ONLY_PROFILE` on `/v1/payments`); no migration (`version` already existed on both tables).

## [Unreleased] - 2026-10-15 — CSV import no longer calls new clients and projects duplicates (MUT-218)

**Why:** `validateCSVImport` added the file's own client and project names to the "already exists" list before checking them, so every new client or project row matched itself and showed as Duplicate.

### Fixed
- A client or project row is a Duplicate only when its name already exists in the app, or when an earlier row in the same file has that name. A repeat in the file gets "Client/Project name appears more than once in this file". Names that already exist keep "… with this name already exists".

### Technical
- `src/utils/csvValidation.ts`: `validateCSVImport` checks each row against the app's names, then tracks the names seen in the file. The unused reference sets are gone; income rows never read them.
- QA `web.data.csv-new-client` is no longer `manual`.
- Files: `src/utils/csvValidation.ts`, `src/utils/__tests__/csvValidation.test.ts`, `qa/features/web/data.yaml`, `qa/specs/web/data.spec.ts`.

## [Unreleased] - 2026-10-15 — Financial Planning and local Retainers retired; Dexie v24 drops their tables (MUT-226)

**Why:** both optional areas fell outside the client-accounting core. Planning read nothing and nothing read it; local retainers never fed income or owed totals. The owner chose to drop their data too (ADR-082, an explicit override of ADR-029 for five tables). Server Money v1 retainers are untouched.

### Removed
- Planning: `pages/planning/**`, `PlanAssumptionDrawer`, `planCalculationService`, `planRepository`, `usePlanQueries`, the plan types and the `planning` switch.
- Local Retainers: `pages/retainers/**`, `RetainerDrawer`, `RetainerMatchingDrawer`, `ClientRetainersCard`, `retainerRepository` (schedule generator, matching), `useRetainerQueries`, the store slices, the retainer and projected-income types, the demo seed rows, the matching-drawer CSS in `index.css` and the `retainers` switch.
- Both areas: the sidebar entries, about 210 i18n keys per locale (parity kept), five repository slots and interfaces, the `eslint.config.js` allowlist entries, and the QA areas `planning` and `retainers` (yaml and specs). The brand layout matrix no longer opens Planning.

### Changed
- Dexie **v24**:
  - drops `plans`, `planAssumptions`, `planScenarios`, `retainerAgreements` and `projectedIncome`;
  - removes the `transactions.linkedProjectedIncomeId` index and strips the field from rows;
  - removes the `planning`/`retainers` switches and notices from settings.
- `/planning` and `/retainers` redirect to Home.
- Four optional areas remain: Expenses, Insights, Projects, Currency conversions.

### Fixed (qa-reconcile review)
- `StatusSegment` (the client profile's and project detail's status filter) kept its look. `PlanAssumptionDrawer.css` was imported eagerly through AppShell, and its unscoped `.segment-control`/`.segment-button` rules overrode the base ones in `index.css`. Deleting it shrank the padding and radius, swapped the background and stopped wrapping. Those effective values now live in the `index.css` base rule. Computed style on a built client page matches main exactly.

### Technical
- New tests:
  - `migration-v24.test.ts` (upgrade, cleanup, restore, migration-safety snapshot);
  - `noDeadPlanningRetainerModules.test.ts`;
  - the redirect rows in `router.gateKeys.test.ts`;
  - QA `web.navigation.retired-areas`.
- Tests that used retainers or planning as the example area now use projects, insights or conversions.
- Files: `src/db/database.ts`, `src/router.tsx`, `src/lib/features/features.ts`, `src/types/index.ts`, `src/db/{interfaces,provider,demoData,migration-safety}.ts`, `src/lib/stores.ts`, `src/components/layout/{AppShell,SidebarNav}.tsx`, `src/pages/clients/ClientDetailPage.tsx`, `src/demo/**`, the i18n JSON and `qa/**`.

## [Unreleased] - 2026-10-15 — Dead web code deleted (TD-143)

**Why:** the release-QA coverage pass left 31 web files no feature claims. Most are imported by nothing; they cost review and type-check time and kept `release-qa lint` noisy.

### Removed
- Imported by nothing: `src/assets/react.svg`; `components/filters/{CurrencyTabs,TypeSegment}`; `components/transactions/**`; `components/ui/{InlineStats,StepperInput(.css),UnifiedAmount,ProfileContextChip(.css),VendorTypeahead.css}`; `components/modals/ProfilePickerModal(.css)`; `hooks/{useTransactionActions,useTransactionFilters}`; `lib/aggregations.ts` (the app uses `db/aggregations.ts`); `pages/reports/**` (`/reports` redirects to `/insights`); `pages/retainers/index.ts`. Each was checked with `rg` first: nothing outside its own tests and barrel imported it.
- Their tests (`CurrencyTabs`, `TypeSegment`, `StepperInput`, `InlineStats`, `useTransactionFilters`, `useTransactionActions`, `lib/aggregations`), their exports from the `ui`, `modals` and `filters` barrels, and the `UnifiedAmount` styles in `index.css` (no other user of those classes).
- The `/theme-demo` route and `components/examples/ThemeDemo(.css)`: a dev page that shipped to production, documented nowhere.
- `MacDownloadBanner(.css)`, its test, its `AppShell` slot (and the gate test's mock) and the `downloadBanner.*` strings in `en.json`/`ar.json`: it offered the desktop app to Mac browsers, and the desktop is retired until v2 (Basel's call).

### Changed
- Comments that pointed at `src/lib/aggregations.ts` (`useConversionQueries`, `ConversionsPage`, `InsightsPage.test`), the `reports` QA feature's header, COMPONENT_REGISTRY (StepperInput, TypeSegment, CurrencyTabs, UnifiedAmount entries) and PATTERNS' URL-state example.

### Not changed
- `services/oauth/**` and `services/tokenStore.ts`: ADR-053 keeps the Malafat OAuth client; TD-075 decides its fate with the Rust half. `db/migration-safety.ts`, `db/retained/monthCloseSchema.ts`: intentional.

## [Unreleased] - 2026-10-15 — Release QA: a true baseline, and the catalog covers the whole app

**Why:** `release-qa plan` compared every release against `v0.0.67`, the last desktop tag, because `make release web|server` committed `release: web|api v<x>` but never tagged it, so all 287 commits since were "in scope" and every feature was touched. And 36% of web files / 30% of portal files were claimed by a QA feature, so most changes reached no QA check at all. ADR-081.

### Added
- `scripts/tag-release.sh <web|api> <version> [--push]`: annotated `web-v<x>` / `api-v<x>` tag on HEAD, never moving an existing tag; `--backfill` tags every past `release: <app> v<x>` commit, dated like the commit so `--sort=-creatordate` orders them. Tests: `scripts/__tests__/tag-release.test.ts` (temp git repos + Makefile/qa-config wiring).
- `make release web` tags after the push; `make release server` tags after `deploy.sh` succeeds. Both push the tag.
- 74 release-qa features (146 total in 29 areas): web `foundation` (core: data survives a reload), `expenses`, `retainers`, `conversions`, `projects`, `reports`, `insights`, `planning`, `data` (CSV import, backup/restore, delete all, unassigned records, migration wizard), `onboarding`, `businesses`, and `clients.add-client`; portal `shell` (core), `session` (core), `ledger`, `income`, `expenses`, `conversions`, `profiles`. One tagged spec per feature, each passing twice on preview builds. `qa/support/portalApi.ts` is an in-memory hosted API for portal specs.

### Changed
- `qa/qa.config.mjs`: web reads its baseline from `web-v*`, the portal from `api-v*` (it ships in the API image). Tauri-only `UpdateBanner`/`useTauriUpdater` leave the web watch; the portal-only `SegmentedTabs` moves to the portal's.
- Existing areas claim the shared files their specs already drive (income: typeahead, + Add menu, filters; record-payment; drawer-motion: `ui/drawer/**`; landing; navigation; brand; settings).
- Coverage: web 36% → 92% of watched files mapped, portal 30% → 100%. The 31 web files left are dead code or unreachable (TD-143).

### Found (product bugs, specs written to the correct behaviour and marked `manual: true` until fixed)
- Web Conversions list never refreshes after log/edit/delete (`useConversionQueries` invalidates no `['conversions']` key) — `web.conversions.log`, `.edit-delete`.
- CSV import labels every new client/project "Duplicate" (`csvValidation.ts` seeds the existing-names set with the CSV's own names) — `web.data.csv-new-client`.
- Planning's Projections CSV exports confidence ×100 (7500%) (`exportPlan.ts:42`) — `web.planning.export-confidence` (`test.fail`).
- Demo mode closes before its summary and leaves you on your own business (`DemoSeedModal` + `useActiveProfile` repair effect) — `web.onboarding.demo-summary` (`test.fail`).
- Portal expense drawer never refetches on 409, so every later Save is refused again (`expenseApiErrors.ts`) — `portal.expenses.edit-conflict`.
- Not specced: the retainer schedule panel shows `slice(-6)` (the far future, never the due periods) for open-ended retainers; CSV `conversion` rows import with no profileId.

## [Unreleased] - 2026-10-15 — The boot splash: the mark on the canvas before JS, handing off to the loader (MUT-207)

**Why:** `index.html` and `hosted.html` shipped an empty `#root`, so a cold or slow load painted the browser's white (even in dark mode) for seconds, then a second, different screen: the portal's wordmark that jumped 18 px when its spinner came, or the landing's unlocalised "Loading...". Brief: `.claude/designs/mut-207-boot-splash.md` (eng review R1, design review DR3–DR18). ADR-080.

### Added
- Both heads link `src/styles/brand/boot-splash.css` and put the splash inside `#root`: a hidden `.boot-splash` with a `<picture>` (the dark mark for a dark OS) around an 80 px `<img>`. Markup and a linked stylesheet only, so it passes the portal CSP; React's first render replaces it.
- `boot-splash.css`: a fixed, centred splash on the canvas (`#FCF6ED` / `#221B2D`, pinned to the token file), the page behind it the same, and `data-theme` rules so a forced theme wins once ThemeProvider runs (DR12).
- `BootSplash` (`src/components/brand/BootSplash.tsx`): the same markup from React, as the landing, download, privacy and /hosted Suspense fallback (replacing `LandingLoader`); it blooms into `BrandLoader` 96 in place after `bootDelayMs()` (DR10).
- `bootDelayMs()` (`src/components/brand/bootDelay.ts`): `LOADER_DELAY_MS` counted from page start, so a slow load blooms at once (DR9).
- Portal: `hosted.auth.connectingSlow` ("Still connecting…" / "ما زلنا نتصل…"); `ME_TIMEOUT_MS` (15 s).
- `check-bundles`: every built entry (web, its /hosted copy, desktop, portal) opens `#root` with the splash, and its marks and stylesheets resolve inside the dist or are `data:` URIs.
- QA: `@web.brand.boot-splash`, `@portal.signin.boot-splash`; `@portal.signin.boot-slow-session` updated to the mark-first screen.

### Changed
- Portal S1 (`CheckingSession`) is "the mark becomes the loader" (D4, eng review R1): inside `.boot-splash`, the 80 px `BrandMark` until `bootDelayMs()`, then `BrandLoader` 96 (`delay={0}`, no fade) saying "Checking your session", then "Still connecting…" from 3 s. The wordmark text is gone from the boot screen (BootUnreachable keeps it); the container has no `aria-hidden` (DR14).
- `meQuery` gives up after 15 s (`AbortSignal.any([signal, AbortSignal.timeout(ME_TIMEOUT_MS)])`); the timeout is a network `ApiError` (status 0), so AuthGate shows BootUnreachable with Retry instead of a loader that never ends (DR6). `api.me` forwards a signal.

### Removed
- `LandingLoader` and its inline style (`main.tsx`).

## [Unreleased] - 2026-10-15 — The bloom loader replaces the page and section spinners (MUT-206)

**Why:** the app and the portal showed five unrelated rings and an unlocalised "Loading..." on lazy routes. Brand v2 has a designed loader: the mark folds into drops and blooms back over a 4.5 s loop. Brief: `.claude/designs/mut-206-brand-loader.md` (eng review R1–R5, design review DR1–DR16). ADR-079.

### Added
- `BrandLoader` (`src/components/brand/BrandLoader.tsx` + `.css`): a React port of the delivered SMIL SVG, path data in `bloomLoaderData.ts`. Sizes 24/40/64/96. A `role="status"` region from mount, empty for `LOADER_DELAY_MS` (400 ms), then a fresh SVG (its SMIL clock starts at frame 0) and the label as text; `slowCaption` replaces it at `LOADER_SLOW_MS` (3 s); reduced motion holds the still mark and shows the word; a loader mounting within `LOADER_CHAIN_MS` (100 ms) of a shown one skips its delay and fade. No `style` attribute, no runtime: it runs under the portal CSP.
- Tokens: `markDot`/`markLavender`/`markRose`/`markPeach` in `mutaba3a.tokens.json` (light and dark), `--m-mark-*` in the brand CSS's three blocks, `--mark-*` in `theme.css`; `--duration-fade: 150ms` (zeroed under reduced motion).
- `.loading` is a 50vh centred box; `.loading--section` waits at the top of a section or drawer (120 px, `--space-8`); `.content-enter` fades in what replaces a loader (ClientDetail, ProjectDetail, Settings, the Retainers table, a client's work table, the retainer matching list).
- i18n: `common.loaderLabel` ("Loading" / "جارٍ التحميل") and `common.loadingSlow` ("Still loading…" / "ما زلنا نحمّل…") in the app and portal dictionaries; `useOptionalT()` in `lib/i18n/core` (the loader never throws outside a provider).
- Settings › Import is fully localised: every string moved to `settings.import.*` with Arabic copy, the row count pluralised (eng review R4).
- QA: `@web.brand.loader-slow-route`, `@portal.signin.boot-slow-session`.

### Changed
- Every page, section and drawer wait (11 pages and sections, 13 app drawers, 2 portal drawers, the demo seed modal, the import step) shows `BrandLoader` (64 full-page with the slow caption, 40 in sections and drawers). The router's `PageLoader` is the 64 loader in the page box. The portal's S1 boot screen shows `BrandLoader` 40 after `LOADER_DELAY_MS` (its own `SPINNER_DELAY_MS` is gone). Planning's `.loading-state` is now `.loading`.
- Audit (DR8): every site decides on TanStack `isLoading`/`isPending` (no data yet), so a background refetch keeps the content.

### Removed
- `.spinner` and `@keyframes spin` (index.css), `.hp-spinner`/`hp-spin` (hosted.css), `.demo-spinner` and its `spin`, `.import-step-importing .spinner` and its `spin`, the dead `.table-spinner`/`table-spin`, `.planning-page .loading-state`.

## [Unreleased] - 2026-10-15 — Brand kit: the Loader & Splash delivery (MUT-203)

**Why:** MUT-204/205 (iPhone) and MUT-206/207 (web and portal) build the bloom loader and the splash screens from one committed, as-delivered copy. Docs only; nothing ships.

### Added
- `docs/brand/loader/`: the bloom loader's Lottie JSONs (light and dark; the motion source of truth), plus the delivered SVG web component and Flutter painter as port references.
- `docs/brand/splash/`: the native splash art, `flutter_native_splash.yaml` and the reference screen renders.
- These are byte-identical to the 2026-10-14 export; the hashes are in `.claude/designs/mut-203-loader-splash-kit.md`.
- `docs/brand/README.md` gains a motion source-of-truth paragraph and asset-map rows.

---

## [Unreleased] - 2026-10-15 — Malafat in the phone app's Settings (MUT-192, mutaba3a-flutter)

**Why:** epic MUT-189's last surface. Recorded here because ADR-078 lives here; the code is in the mutaba3a-flutter repo (`feature/mut-192-malafat-suggestions`).

### Added
- The app's Settings shows a Malafat section (link + "Show Malafat suggestions") on iOS and Android to anyone who owns a business profile and is not on Malafat; it uses this server's `PATCH /v1/me/malafat-suggestions`. No server change.

---

## [Unreleased] - 2026-10-15 — Malafat suggestions in the hosted portal (MUT-191, API 1.25.0-mut191)

**Why:** epic MUT-189: people on the hosted portal who run a law firm or an accounting office should meet Malafat at the moments it helps, with one switch to turn it off, and the choice should follow the account (and the phone app next, MUT-192).

### Added
- Account menu (owned business profile only): after Sign out, a "Malafat, for law firms and accounting offices" link (new tab) and a "Show Malafat suggestions" `menuitemcheckbox` that toggles without closing the menu.
- Clients: one card at ten active clients of the profile, else with two or more owned business profiles ("Running more than one office?"); never while searching; a retired card leaves nothing else on that visit; focus returns to the search box.
- A business profile just created opens with a one-line note on its Overview, once.
- Nothing for anyone who belongs to a Malafat-fed firm (they already use Malafat), nor on personal profiles or firms.
- Server: `User.malafatSuggestions Json?` (migration `20261015090000_mut191_user_malafat_suggestions`); `/v1/me` carries the resolved `user.malafatSuggestions { off, dismissed }`; `PATCH /v1/me/malafat-suggestions { off?, dismiss? }` (session or device session, organization-independent) unions dismissals under a row lock, `off` last-write-wins; no audit row.

### Technical
- `src/hosted/components/MalafatPortal.tsx` (`MalafatMenuItems`, `MalafatClientsCard`, `MalafatCreatedNote`), `src/hosted/data/malafatSuggestions.ts`, `src/hosted/session/malafatMoments.ts` (reset by `endSession`). The shared `MalafatSuggestionCard` now imports `useT` from `lib/i18n/core`. `bundle-origins.json` hosted += malafat.app; portal QA watches the shared Malafat files.
- QA: `qa/support/portal.ts` (a signed-in portal with /v1 stubbed), `qa/specs/portal/malafat.spec.ts` (`@portal.malafat.menu|clients|created|none`), `KNOWN_AXE_VIOLATIONS.portalSignedIn` (TD-142).

---

## [Unreleased] - 2026-10-15 — Settings no longer scrolls sideways at 375 px (MUT-187 follow-up)

**Why:** `@web.brand.layout` failed in all four 375 px variants on Settings ("406px content in 375px"; 460 px in Arabic), found while merging MUT-209.

### Fixed
- Settings › Businesses' Hosted account row fits the Settings column at phone width. Its "See hosted accounts" button (`.btn`, nowrap at a fixed 32 px) widened the row's auto grid track to 150 px (EN) / 187 px (AR) inside a 45 px column. The page itself scrolled because the visually hidden "(opens in a new tab)" spans are `position: absolute` with no positioned ancestor: they escaped `.page-content`'s clipping and sat at 405 px (EN) / −85 px (AR).
- `HostedAccountEntry.css`: the row is `position: relative` with one `minmax(0, 1fr)` track and `overflow-wrap: break-word`; the button (`.hosted-account-entry-cta`) wraps and grows taller (`white-space: normal`, `block-size: auto`, `min-block-size: var(--space-8)`); `border-top` became `border-block-start`.

### Technical
- Test: `src/pages/settings/__tests__/HostedAccountEntry.css.test.ts` pins the rules and logical-properties-only. QA: `web.brand.layout` now maps `HostedAccountEntry.tsx/.css`; all 8 cases pass on a built web preview. TD-141 logs the app-wide `.sr-only` escape.

---

## [Unreleased] - 2026-10-15 — Arabic by default in the web app and the hosted portal (MUT-209, ADR-077 amended)

**Why:** Basel: "everything should default to arabic". Brief: `.claude/designs/mut-209-arabic-default-everywhere.md`.

### Changed
- The web app opens in Arabic, right to left, until a person picks a language (Settings, or the landing's switch). A language the app stored by detection before today doesn't count as a choice, so most people see Arabic once and can pick English in Settings.
- The hosted portal opens in Arabic before sign-in instead of following the browser; after sign-in it adopts the account's locale (before the first frame, and remembered as a hint so the next visit boots in it) unless this browser has a choice.
- Server: a new account created without a locale is Arabic, and its personal profile is named شخصي. Existing accounts are unchanged. API **1.24.0-mut209**, OpenAPI regenerated.

### Technical
- One `DEFAULT_LANGUAGE` (`src/lib/i18n/core.tsx`) for landing, app and portal. QA's `openFreshApp` chooses English once, as a person would; three portal test files choose English in setup.
- Tests: core, `HostedLanguageProvider`, server users/sessions/CLI; QA `@web.settings.arabic-default`, `@portal.signin.arabic-default`, and `@web.landing.arabic-default` updated.

---

## [Unreleased] - 2026-10-14 — Malafat suggestions in the web app (MUT-190, ADR-078)

**Why:** the free app's law and accounting users never heard about Malafat inside the product. Epic MUT-189. Brief, eng review and outside voice: `.claude/designs/mut-190-malafat-suggestions-local.md`. **Release only after MAL-1153** (malafat.app recognising the referral).

### Added
- Settings › Businesses: a "Mutaba3a + Malafat" row (one link to Malafat's contact page, `utm_medium=web-local&utm_content=settings`) with a "Show Malafat suggestions" switch; the row stays when off.
- Right after a second business is added (never the first, never in sample or demo data), that row's line becomes a note about the new business, with the same single link tagged `business-profile`.
- Clients: one card at ten clients in the working business (`client-threshold`), else with a second business (`second-business`); only beside a non-empty list, never while searching or with a client open beside it.
- "Don't show this again" retires a suggestion for good; a click on its link does too (the card hides right after the browser follows the link); retiring the note or the second-business card retires both, and the Clients card waits while the Settings note is due; a retired Clients suggestion leaves no other until the app reloads. While a Malafat suggestion is on screen, the Go hosted card steps aside. Copy for law firms and accounting offices, EN/AR; never "automatic" or "sync".

### Technical
- `src/lib/malafatSuggestions.ts` (pure rules, `MALAFAT_CLIENT_THRESHOLD = 10`), `useMalafatSuggestions.ts` (settings-row reads, fresh-row merged writes), `malafatMomentStore.ts` (session flag + one upsell slot); `MalafatSuggestionCard`, `MalafatClientsSuggestion`, `MalafatEntry`; `Settings.malafatSuggestions`. Web build only (`malafatSuggestionsEnabled()`). Links via `malafatUrl` (MUT-174). No network call.
- Tests first (see TEST_PLAN); QA `@web.settings.malafat`, `@web.clients.malafat`. PATTERNS: permanent dismissal on the settings row vs snooze in localStorage; one upsell on screen.

---

## [Unreleased] - 2026-10-14 — Landing: open in Arabic by default (MUT-202, ADR-077)

**Why:** Basel asked for the landing to open in Arabic regardless of system language. Epic MUT-171. Brief: `.claude/designs/mut-202-landing-arabic-default.md`.

### Changed
- `/`, `/hosted`, `/privacy` and `/download` open in Arabic, right to left, for a visitor who hasn't chosen a language. A choice made with the EN/AR switch still wins and is remembered.
- The Arabic default is never stored, so visiting the landing doesn't switch the web app at `/app` (same language key) to Arabic; the app keeps following the system language.

### Technical
- `LanguageProvider` gains `defaultLanguage` (a person's marked choice → default → system); with it, nothing is stored until `setLanguage`, which also writes `mutaba3a-language-chosen`; a language stored by detection (by the app, or by the landing before MUT-202) doesn't beat the default; without the prop, unchanged (the app). Storage access is guarded. `LandingProviders` passes `LANDING_DEFAULT_LANGUAGE = 'ar'`.
- Test helpers: `chooseLanguage()` (`src/test/language.ts`) and `chooseLanguageScript` (`qa/support/i18n.ts`) seed a language as a person's choice; `DownloadPage`/`HostedOfferPage` tests and `@web.brand.type` (English) use them.
- Tests: `core.test.tsx` › defaultLanguage, new `LandingProviders.test.tsx`; QA `@web.landing.arabic-default` (en-US browser: four pages Arabic with nothing stored, `/app` English, EN sticks after reload) and a `preferLanguage` helper for the three landing cases that assert English. PATTERNS: "a surface's default is not a stored preference".

---

## [Unreleased] - 2026-10-14 — Landing: a Malafat band for law firms and accounting offices (MUT-174)

**Why:** the landing never mentioned Malafat, although Malafat's Money section runs on the hosted API in production and a firm's partner can log a payment in the phone app that Malafat then allocates. Epic MUT-171 (last story). Brief, eng review and outside voice: `.claude/designs/mut-174-malafat-section.md`.

### Added
- **The Malafat band** (`MalafatSection`, `data-part="malafat"`, after the phone chapter, before the FAQ; the page now has nine parts), in the privacy band's look: "Run a law firm or accounting office on Malafat? Mutaba3a connects to it." Malafat keeps each firm's fee proposals and agreements and what every client owes and has paid; with a hosted account linked to the firm's Malafat, a payment logged in the phone app reaches Malafat under its client, unallocated, for the firm to apply. The Arabic title names law and accounting offices too. One link, "See Malafat", to malafat.app in the page's language, new tab (announced to screen readers with `common.opensInNewTab`). EN/AR `landing.malafat.*`.
- **`malafatUrl`** (`src/content/malafatLinks.ts`): the one builder for links to Malafat, typed to MUT-189's CTA contract (`/<locale>/contact?topic=mutaba3a&utm_…` with `contact: true`) plus the landing's own `utm_medium=landing`, `utm_content=landing-section` (home page, no topic). MUT-190/191 reuse it. No Mutaba3a-side measurement (ADR-024).

### Technical
- Honesty: `LandingPage.test.tsx` gains shared `BANNED_CLAIMS_EN/AR` (reports, price/pricing/per month/subscription/sign-up, currency amounts, sync/automated/automation/seamless/instant/real-time; AR matched with diacritics stripped by `bare()`, incl. تقرير/إحصا/أسعار/اشتراك/زامن/تلقائ/آليا/فوري/لحظي, while رسوم الأتعاب and آليّة stay allowed), used by the phone and Malafat blocks, plus `MONEY_CORE_EN/AR` (MUT-25's module/core/engine, inside/within/part of Malafat, built into, embedded; داخل/ضمن/جزء من/مدمج/وحدة/نواة/محرك) for the Malafat block only; a self-test proves each regex catches the spellings that slipped past the first draft.
- `.landing-band-link`: a link on the ink band in the page colour, underlined, with its own line (never the body's 0.8 dim) and a `2px solid currentColor` focus outline, because the inset purple brand ring is near-invisible on ink (~2:1 in dark mode). `landingCss.test.ts` pins the dim and the ring.
- `scripts/bundle-origins.json`: `https://malafat.app` joins `local` (a new origin otherwise fails `test:bundles`); MUT-191 must add it to `hosted`.
- QA: `qa/features/web/landing.yaml` `malafat` (+ `src/content/malafatLinks.ts` in the area paths) and `@web.landing.malafat` EN/AR: href from `malafatUrl`, ≥4.5:1 on the band and colour kept on hover, keyboard ring in the link's own colour, in light and dark; 375 px fit; axe.
- INFRA §2: production observed at `eb4a9c8` (2026-10-14).

---

## [Unreleased] - 2026-10-14 — Landing: drop the GitHub footer link, add a header sign-in

**Why:** the footer's "GitHub" link pointed at the source repo, which has no place on a product landing page; separately, the landing page had no way for an existing hosted-account holder to get to the portal — only Settings › Businesses (`HostedAccountEntry`) had a sign-in link.

### Added
- `LandingHeader` now shows a "Sign in now" link to the hosted portal (`landing-header-signin`, `landing.header.signIn`), reusing the existing `hostedPortalUrl()` gate from `lib/goHosted.ts` (MUT-187's build-time `__PORTAL_URL__`) — same pattern as `HostedAccountEntry`, no new config. Sits before the lang toggle in `.landing-header-actions`, so the toggle keeps the end edge; opens in a new tab.

### Removed
- `LandingFooter`'s "GitHub" link (`https://github.com/vAWK3/mutaba3a`) and the `landing.footer.github` EN/AR string. Scoped to the cosmetic link only — the functional GitHub Releases integration (download page version checks, desktop update checks, `netlify.toml` download redirects, and the privacy-policy disclosure of the GitHub network call) is unrelated infrastructure and was left in place.

---

## [Unreleased] - 2026-10-14 — Landing: the phone logs, the portal shows (MUT-173)

**Why:** since MUT-172 the Get it section says a phone app and a hosted account exist, then stops: nothing on the landing said what the phone app is for, what the portal is for, or where to get the phone app. Epic MUT-171. Brief, eng review and outside voice: `.claude/designs/mut-173-phone-portal-section.md`.

### Added
- **The phone chapter** (`PhoneSection`, `data-part="phone"`, after Get it, before the FAQ; the page now has eight parts): "Log it on your phone. See it all in your hosted account." The paragraph says the phone app is for logging (income or expense in seconds, even offline) and the portal, your hosted account in a browser, is where you see every client, what they owe and what they've paid. No reports or analytics claim (tested). `/hosted`'s laptop-and-phone mock is the picture.
- Under the paragraph: "Both come with a hosted account." with one underlined "See hosted accounts" link → `/hosted`, and a "Phone apps" list with one line per platform read from `MOBILE_APP_LINKS` (download-config.ts, never hardcoded): a store link in a new tab once a `url` is set (`.landing-phone-store`, 44 px pill, presses like every landing control); the name beside "with your hosted account" while the app has no public link (iPhone today); "{platform} coming soon" while it does not exist (Android today). Only a real store link looks like a control.
- `ChapterSection` gains an optional `extra` slot (rendered under the paragraph, in the copy column). `IosIcon` (outlined phone) and `AndroidIcon` (robot head, CC BY 3.0 attribution) in `PlatformIcons`.
- EN/AR `landing.phone.*` (title, body, hint, hintLink, storesLabel, store.ios/android, withAccount); platform names and "coming soon" reuse `landing.hostedOffer.platform.*` so `/` and `/hosted` agree.

### Technical
- `HostedDevicesMock`'s base CSS moved from `HostedOfferPage.css` to the **end of `LandingPage.css`** (both pages load it): a `width: 100%; max-width: 560px` on `.hosted-devices` (inside the chapter's flex figure an all-absolute box had zero width) and the two frames at `(0,2,0)` so the rules out-rank `.landing-mock` wherever they sit. `/hosted`'s phone-only ≤640 px rule stays in `HostedOfferPage.css`; the landing chapter stacks laptop, phone and caption on phones.
- Tests first: `LandingPage.test.tsx` (structure → eight parts; a "phone and portal" block with the config swapped through a getter mock as `HostedOfferPage.test.tsx` does; honesty with the mock stripped), `ChapterSection.test.tsx` (`extra`), `landingCss.test.ts` (press and dim enumerations). QA: `qa/features/web/landing.yaml` `phone` + `@web.landing.phone` EN/AR (chapter whole at 1280 and 375, platform states from the config, link to `/hosted`), passing on a built web preview with the neighbouring landing cases.
- **qa-reconcile fixes** (pre-landing review): `storeLinkUrl(link)` in `download-config.ts` is the one reading of a store link (available **and** a real `https:` URL; a placeholder such as `TBD` or a URL on an unavailable app never becomes a link, so `/` can never contradict `/hosted`), with its own unit test; the laptop frame is bounded to `min(72%, calc(100% - 140px))` so the phone frame never covers its amounts in a narrow column (it did at 901–1180 px on `/`, and had on `/hosted`), proved by a 1024 px QA step; the 560 px cap applies only inside the chapter, so `/hosted` keeps its full-width anchor at 641–900 px; `/hosted`'s phone-only ≤640 px override is scoped under `.hosted-hero-layout` (0,3,0) so it wins by weight, not stylesheet order; a space between the app name and "with your hosted account" for assistive tech; `landingCss.test.ts` pins the store link's hover colour; the QA case asserts `dir` and the icons.
- Store URLs stay `null` until Basel sets them (ticket). Auto-decided readings of the AC (no new config file; three states; the balance mock with "is for logging" copy) are on the ticket for him.

---

## [Unreleased] - 2026-10-14 — Hosted portal: profile management, new/rename/currency/type (MUT-183, ADR-037 amendment)

**Why:** MUT-182 shipped the API for a person to create and manage their own standalone profiles, with no portal surface to use it — a freelancer with a second business had to ask an operator. Epic MUT-181. Brief, eng and design reviews: `.claude/designs/mut-183-portal-profile-management.md`.

### Added
- **`ProfileSwitcher`** gains "+ New profile" (disabled with "N of M" at the 6-profile cap) and "Manage profiles", behind a separator after the profile list. Sub-lines are corrected via `profileKindKey`: Malafat-fed, "Your built-in profile", "Personal", "Business" or "Expenses only" (operator firm), so the switcher and the Manage list never disagree.
- **`ProfileCreateDrawer`**: name/type (required radio cards, no default)/currency/timezone (browser-prefilled fact row, Change reveals the select); the 201 writes straight into the `/v1/me` cache so the new profile appears at once, with a background refetch; attempt-scoped Idempotency-Key.
- **`ProfilesManageDrawer` / `ProfileEditForm`**: one drawer, list → edit pane. Every profile is listed; owned ones are clickable, Malafat/firm ones show their reason instead. Edit snapshots `version` at open (`If-Match`), renames/changes currency directly; a type change runs an inline confirm step against the server's uncategorized-expense-count preview before saving, then refetches expense categories.
- The empty-state copy changes from asking an operator to "You don't have a profile yet", with "+ New profile".
- All three drawers are URL-driven (`?newProfile=1` / `?manageProfiles=1` / `?editProfile=<id>`, ADR-008) — still no create page.
- EN/AR strings throughout; RTL verified.

### Fixed
- **A page's own filter rewrite no longer closes a drawer the shell opened** (qa-reconcile finding): `useReplaceSearch` replaced the whole URL search, so a background `setFilters()` call (e.g. an anchored list's stale-anchor refetch) silently dropped an open `newProfile`/`manageProfiles`/`editProfile` key. Fixed with a new `pickShellOverlay`, merged the same way `ProfileDrawers.go()` already did.

### Technical
- `src/hosted/data/filters.ts`: `SHELL_OVERLAY_KEYS`, `omitShellOverlay` (strip at the page boundary) and the new `pickShellOverlay` (carry the shell's keys through a page's own search rewrite).
- `src/hosted/data/profileRules.ts`: `canCreateProfile`, `profileEditability`, `profileKindKey`, `changedFields` — the one source for who can create/edit what, and why not.
- `src/hosted/format/timezones.ts`, `src/hosted/format/currencies.ts` (`HOSTED_CURRENCIES`, shared by Expense/Conversion/profile forms, `satisfies readonly Currency[]`), `src/hosted/api/client.ts` (`apiErrorReason`, replacing three near-identical inline reads).
- Tests: `profileRules.test.ts`, `timezones.test.ts`, `profileFormSchema.test.ts`, `profileApiErrors.test.ts`, `ProfileCreateDrawer.test.tsx`, `ProfilesManageDrawer.test.tsx` (incl. the type-change confirm), `auth-states.test.tsx` (edited in place), `filters.test.ts`, `views.test.tsx` — see TEST_PLAN.md for the full table. `npx vitest run src/hosted`: 304 files, 4312 passed.
- **Known gap**: no `qa/` catalog entry yet for the new profile-management surface (plan §5) — see TECH_DEBT TD-137. Minor DRY cleanup from the qa-reconcile pass tracked as TD-136; TD-125 partially resolved (R3/R4).

---

## [Unreleased] - 2026-10-14 — Landing: the free vs. paid split, with the door to /hosted (MUT-172)

**Why:** the Get it section told every visitor everything is free and never said a hosted account exists. The landing is the third door of the Go hosted funnel (epic MUT-185; parent epic MUT-171). Brief, eng review and outside voice: `.claude/designs/mut-172-landing-free-vs-paid.md`.

### Added
- **Get it, paid half** (`GetItSection`, `data-part="get-it-paid"`): under the three free app cards, "Unlike the apps above, a hosted account and the phone app come with a paid plan." + "Your records on our servers, on every device you sign in on. Tell us what you need and we'll reply with an offer." + a "See hosted accounts" button (the Settings row's words) → `/hosted`, same tab. No heading, no box: the section keeps its one idea. EN/AR `landing.getIt.paid.{lead,hint,cta}`.
- `.landing-get-it-paid-cta`: the hero button's recipe (ink fill, `--landing-hover-dim`, `scale` press, focus ring, 44 px). The landing loads no `Button.css`, so `btn-*` classes would be unstyled on `/`.
- **`qa/features/web/landing.yaml`** (resolves TD-130): the 12 existing `@web.landing.*` tags catalogued, plus `get-it-paid`. `release-qa lint` reports no errors. `qa/support/i18n.ts` now exports `en` beside `ar`.
- QA `@web.landing.get-it-paid`, EN and AR: the lead is visible, the block has one link, 44 px tall, presses to the brand scale and keeps its colour on hover, and opens `/hosted`.

### Changed
- Nothing in the free copy (A1). The honesty cases gain a block-scoped ban on price, `/month`, checkout, sign up, `$`, android, ios (EN) and سعر/اشترك/إنشاء حساب (AR).

### Technical
- Tests: `LandingPage.test.tsx` (EN block + CTA + honesty, the free line intact, AR). The seven-part structure test is untouched.

---

## [Unreleased] - 2026-10-14 — Portal sign-in links out to /hosted (MUT-188)

**Why:** someone who reached the portal's sign-in page without an account hit a dead end. Epic MUT-185, after MUT-186 (`/hosted`) and MUT-187 (the in-app CTA). Brief, eng review and outside voice: `.claude/designs/mut-188-portal-request-link.md`.

### Added
- **Sign-in "No account? Request one"** (`SignInPage`): a second help line under "Can't sign in?" with one outward, underlined link to the landing's `/hosted` page, same tab (axe `link-in-text-block` flagged colour-only in the Arabic QA run). EN/AR `hosted.auth.request.{lead,link}`. The portal still has no inbound door: the bundle rules and the server's no-self-registration test are unchanged.
- QA `@portal.signin.request-link` (EN and AR: the link is visible, its href ends in `/hosted`, it is the only link, axe still passes).

### Changed
- **`DEFAULT_PUBLIC_ORIGIN` is now `https://mutaba3a.netlify.app`.** `mutaba3a.app` has no DNS (checked 2026-10-14), so the landing's `og:url`/`og:image`, the `/hosted` canonical and the portal link all point at the host that answers. MUT-112 flips it back with the custom domain (inventory posted there). The Malafat OAuth client id (`public/.well-known/oauth-client.json`, `CIMD_CLIENT_ID`) keeps `mutaba3a.app` and stays allowlisted.
- `mut-43-auth-states.md` §4 and `hosted-portal.md` §7.6: one outward link is permitted on sign-in; dated note under ADR-037.

### Technical
- `hostedOfferUrl()` in `vite.config.ts` (validated like `portalUrl()`) → `__HOSTED_OFFER_URL__` in the hosted build only, read at render time through a typeof guard (ADR-076 pattern). `https://mutaba3a.netlify.app` added to both lists in `scripts/bundle-origins.json`. `.env.example`, INFRA.md and SYSTEM_OVERVIEW.md name the Netlify origin.
- Tests: `vite-config.test.ts` (hosted define, default pin, override, refusals, local builds carry none), `auth-states.test.tsx` S3b (EN/AR, exactly one link, no banned copy; S3's zero-links case untouched), `brand-head.test.ts` (`hosted.html` keeps `referrer=same-origin`).

---

## [Unreleased] - 2026-10-14 — "Go hosted" in the free web app (MUT-187, ADR-076)

**Why:** free web users never learned that hosted exists, and hosted users had no way from the free app to the portal. Epic MUT-185 (after MUT-186's `/hosted` page). Brief, eng and design reviews: `.claude/designs/mut-187-go-hosted-cta.md`; wireframe `mut-187-go-hosted-wireframe.html`.

### Added
- **Sidebar card** (`GoHostedCard`): an outlined card at the top of the sidebar footer, "Your records, on every device." with a Go hosted button that opens `/hosted` in a new tab. The × ("Hide for 30 days", 44px) hides it for 30 days with a 160ms fade and moves focus to Settings. Web build only, expanded rail only, never during a visitor sample, hidden on windows 640px tall or less.
- **Settings › Businesses "Hosted account" row** (`HostedAccountEntry`): one sentence on hosted, "See hosted accounts" (to `/hosted`) and "Already have an account? Sign in" (to the portal), both in a new tab. Web build only.
- `src/lib/goHosted.ts`: the 30-day snooze rule, localStorage read/write that survive blocked storage, and the render-time gates `goHostedEnabled()` / `hostedPortalUrl()`.
- EN/AR strings `nav.goHosted.*`, `settings.profile.hosted.*`, `common.opensInNewTab`.

### Technical
- `MUTABA3A_PORTAL_URL` (build-time, validated https origin, default the portal's Cloud Run URL) → `__PORTAL_URL__`; `assertHttpsOrigin` now shared with `MUTABA3A_PUBLIC_ORIGIN`. Documented in `.env.example`; origin added to `scripts/bundle-origins.json`. The web/desktop vite-config snapshots gain the define.
- Tests: `goHosted.test.ts`, `GoHostedCard.test.tsx` (EN/AR, keyboard, 30-day return, blocked storage, sample session, no fetch/XHR/beacon), `SidebarNav.goHosted.test.tsx` (web/desktop/collapsed, order, focus), `HostedAccountEntry.test.tsx`, `SettingsPage.goHosted.test.tsx`, `vite-config.test.ts`.

---

## [Unreleased] - 2026-10-14 — Run qa/ specs with Playwright directly (no QA_CONTEXT)

**Why:** without `QA_CONTEXT`, `qa/support/qa.ts` fell back to `require('../qa.config.mjs')` and `__dirname`. Playwright loads the file as ESM (`"type": "module"`), so a direct `npx playwright test -c qa/playwright.config.ts …` crashed on load with "require is not defined in ES module scope". Until now the only workaround was building `QA_CONTEXT` JSON by hand.

### Fixed
- `loadContext()` is async. The fallback finds the qa directory with `fileURLToPath(import.meta.url)` (the same way `qa/support/brand.ts` and `i18n.ts` do), loads the config with `await import('../qa.config.mjs')`, and the module awaits it at the top level. The `QA_CONTEXT` path that the release-qa engine uses is unchanged. Verified with a direct `--project=web settings.spec` run against `npm run dev -- --port 5173`: 3/3 passed. The same spec also passes with a hand-built `QA_CONTEXT`.

### Technical
- Files: `qa/support/qa.ts`.

---

## [Unreleased] - 2026-10-14 — Edit and delete a logged currency conversion (MUT-194, API 1.23.0-mut194)

**Why:** ADR-070 §2 made hosted conversions create + read only, so a mistyped rate or the wrong currency could only be "fixed" with a reversing entry and a corrected one. Malafat's `GET /v1/audit` also listed `conversion.created`. ADR-075 supersedes ADR-070 §2. Brief: `.claude/designs/mut-194-conversion-edit-delete.md`; tests: `-tests.md`.

### Added
- **Server:** `PATCH /v1/conversions/{conversionId}` (If-Match on `version`; 409 `VERSION_MISMATCH` with `currentVersion`; a currency only with its amount, 422 `AMOUNT_REQUIRED`; amounts parsed in the merged currency; `SAME_CURRENCY` on the merged pair; `occurredOn` checked against today only when sent) and `DELETE /v1/conversions/{conversionId}` (soft; 204, 204 again, 404 unknown). Session and device-session only; audited `conversion.updated` / `conversion.deleted`. `Conversion` responses carry `version` and `updatedAt`.
- **Data:** `Conversion.version`, `updatedAt`, `deletedAt`; migration `20261014180000_mut194_conversion_versions` backfills version 1 and `updatedAt = createdAt`, then drops the temporary default. `ConversionRepository.update` / `softDelete` in both stores; get, list and `anchor` hide deleted rows; the store guard classifies both as conversions writes.
- **Portal:** a conversion row click, or Enter/Space on its row button, opens `?conversion=<id>`. `ConversionDrawer` edit mode prefills both legs, the date and the notes, PATCHes both legs at the loaded version, and on 409 refetches and refills the form while the conflict toast shows and the drawer stays open (D6). Delete confirms naming both legs (new en/ar `hosted.conversions.drawer.deleteConfirm`, D7); deleting the anchored conversion drops the anchor. New en/ar `hosted.conversions.drawer.editTitle`.
- **Portal:** opening a conversion that was deleted elsewhere (a 404) says "This conversion no longer exists" with a Close button (new en/ar `hosted.conversions.drawer.gone`) instead of the Unreachable card; every other load error keeps Unreachable with its retry.
- **Portal:** `HostedTable` rows with `onRowClick` get a `row-link` button in the first cell (D8, eng D11), which also makes the expense list keyboard-reachable.

### Changed
- `API_VERSION` 1.22.0-mut182 → 1.23.0-mut194 (MUT-182 took 1.22.0 on main first); `server/openapi/openapi.yaml` and `src/hosted/api/schema.d.ts` regenerated.
- The hosted conversion form takes JOD with per-leg, currency-aware decimals; the portal's currency filters offer JOD (closes TD-117).

### Fixed
- `GET /v1/audit` excludes `SESSION_ONLY_ENTITY_TYPES = [...EXPENSE_ENTITY_TYPES, 'conversion']`, so Malafat's key no longer sees conversion activity, even with `?entityType=conversion`.

### Technical
- Tests: `store-contract-conversions.ts` (memory + Postgres), `migration-mut194.test.ts`, `conversions/__tests__/compose.test.ts` (`conversionPatch`), `routes-conversions.test.ts`, `route-security.test.ts`, `conversions-invisible.test.ts` (new), `HostedTable.test.tsx` (new), `ConversionDrawer.test.tsx`, `conversionFormSchema.test.ts`, `ConversionsList.test.tsx`, `filters.test.ts`. The "has no row click" list test is intentionally replaced.
- Stale "create + read only" comments fixed in `schema.prisma`, `ports.ts`, `store-guard.ts`, `writability.ts`, `schemas.ts`, `routes/conversions.ts`, `api/client.ts`, `conversionQueries.ts`, `ConversionDrawer.tsx`, `ConversionsList.tsx`, `filters.ts`.

---

## [Unreleased] - 2026-10-14 — MUT-182: people create and manage their own hosted profiles (API 1.22.0-mut182)

**Why:** a hosted user got exactly one personal profile (MUT-120); any other profile needed an operator. A freelancer with a second business had nowhere to record it. Epic MUT-181; brief and eng review `.claude/designs/mut-182-profile-management-api.md`; ADR-037 and ADR-066 amended.

### Added
- `POST /v1/profiles` — a signed-in person (cookie or device session) creates a **standalone** profile they own: name, type (PERSONAL | BUSINESS), default currency, IANA timezone. Identity-keyed idempotency, audited as the person. Up to 6 owned profiles, the personal one counted (409 `PROFILE_LIMIT`).
- `PATCH /v1/profiles/{profileId}` — one If-Match write for name, default currency and type. A type change replaces the profile's expense categories with the new type's preset (user's language) and leaves categorized expenses uncategorized; the response reports the counts. The built-in personal profile can be renamed but not retyped (409 `DEFAULT_PERSONAL_PROFILE`). Member-not-owner → 403 `READ_ONLY_PROFILE` / `NOT_OWNER`; non-member → 404.
- `GET /v1/profiles/{profileId}/type-change?to=` — previews those counts.
- `GET /v1/me`: `owned`, `type`, `version` per profile and `limits { ownedProfiles, maxOwnedProfiles }`; order firms → created → personal.

### Changed
- **Standalone guarantee:** every profile a person owns is refused an API key, refused by API-key authentication (so never bound to Malafat), never granted to or provisioned into another user and never revoked from its owner — one helper, `ownedProfileConflict` (`PERSONAL_PROFILE` on the built-in profile, `OWNED_PROFILE` on a created one).
- The expense preset keys on the profile type (ADR-066 amendment); seeding and a type change hold the organization row, so they never mix presets.
- Portal: `incomeAffordancesFor` and `ReadOnlyNotice` key on `owned`, so Add income and Record payment work on a created business profile exactly as on the personal one.
- An expense create/update/filing whose category was deleted by a concurrent type change answers 422 `CATEGORY_NOT_FOUND`, not 500.

### Technical
- Migration `20261014120000_mut182_owned_profiles`: `ProfileType` enum; `organizations.ownerUserId` (indexed FK, not unique), `profileType`, `version`; backfill of every MUT-120 profile as owned + PERSONAL; two CHECKs. `post-roll` creates personal profiles owned + PERSONAL and copies settings only from operator firms.
- Store: `organizations.createOwned` (cap counted under a user-row lock), `countOwnedBy`, `updateOwned` (single versioned transaction, D4), `typeChangeImpact`; all `sessionOnly` in the store guard. Memory store mirrors the expense-category FK; Prisma P2003 names its constraint.
- `hostedProfileFor` (serializers.ts) is the one builder for `/v1/me`, POST and PATCH. Matrix `identity` row covers `/v1/profiles*`.
- Older migration tests (MUT-59/61/100) write organizations/users as raw rows (`fixtures/raw-rows.ts`): today's client selects columns their schemas lack.
- **Tests:** `store-contract-profiles.ts` (memory + Postgres incl. two races), `migration-mut182.test.ts`, `routes-profiles.test.ts`, `routes-owned-profiles-standalone.test.ts`, R17 in `routes-expenses.test.ts`, `post-roll.test.ts`, `presets.test.ts`, route-security inventory, portal `incomeAffordances`/`views`.

### Fixed in qa-reconcile (2026-10-14, owner answers D1–D7)
- **Old-revision personal profiles (D1).** The CHECKs pass an unstamped personal profile (SQL NULL), which the old revision writes during the roll window or after a rollback. One helper, `profileOwnerOf`/`profileTypeOf` (`personal-profile.ts`), now answers "whose profile, what type" everywhere (key issue, key auth, grant/revoke/provision, `/v1/me`, cap count, PATCH, first category seed); the owner's first PATCH stamps it and post-roll's new `repairPersonalOwnership` stamps the rest. The CHECK spells the tolerance out. DEPLOYMENT.md: "Roll back past MUT-182" and "Delete a user who owns profiles" rows.
- **Locks (D2, D5).** `FOR NO KEY UPDATE` on the user and organization rows, so foreign-key inserts are never blocked. Category create/rename take the organization lock; a type change locks the categorised expense rows, then the categories (the expense writers' own order, so no deadlock), and a category update no longer crashes when a type change deleted its row.
- **Audit in the transaction (D3, D4).** `createOwned`/`updateOwned` write their audit rows inside their transactions (a failed audit can no longer leave a profile for a retry to duplicate), in distinct milliseconds; `organization.type_changed` now lists the removed categories and each expense's lost category (TD-133: unbounded, accepted).
- **Contract.** `ProfileType`/`ProfileTypeChange` components are non-null again; the 403 NOT_OWNER doc wins; the preview refuses what PATCH refuses; `/admin` organizations show `ownerUserId`/`profileType`; `expenses_categoryId_idx` for the delete cascade; `/v1/me` sorts on rank only (D7).
- **Tests:** unstamped-profile guards, `/me`, seed and post-roll repair; audit rows in both stores; D2 refusal leaves categories/expenses/audit intact; inbox filing race (R17); C11 category-create race and C12 expense-move race (Postgres); `/me` order. C12 does not reproduce the old deadlock deterministically, so the lock-order fix rests on its reasoning.

---

## [Unreleased] - 2026-10-14 — /hosted: the case for a hosted account, and a request form (MUT-186)

**Why:** free users had no way to learn that a paid hosted tier exists or to ask for it (epic MUT-185, "one front door, not one bundle"). Brief, eng review (D1–D5), design review (1A–9A) and the approved wireframe: `.claude/designs/mut-186-hosted-offer-page.md`, `mut-186-hosted-offer-wireframe.html`.

### Added
- `/hosted` on the web build (`HostedOfferPage`, mounted in `src/main.tsx` like `/privacy`): a hero that names the trade, beside the same client balance on a laptop and a phone (`HostedDevicesMock`); a free-vs-hosted comparison table that stacks per row on phones; the migration promise ("we'll move them… by hand") in the inverted privacy band; the request form.
- `HostedRequestForm`: name and email required, everything else optional; inline errors with focus on the first; a disabled "Sending…" button; on failure an alert beside "Try again" with the answers kept; on success the visitor's own name and email, the 2-working-day reply promise, "edit and send again" and a link back to the free app; a privacy notice under the button; 44px device pills; a hidden honeypot; the page language sent as a hidden field.
- `hostedRequest.ts`: the form's contract with Netlify Forms (name, fields, honeypot, POST to `/__forms.html`, 15 s timeout).
- `vite.config.ts` (web only): `netlifyForms()` emits the hidden static twin `__forms.html` (noindex, out of the SW precache); `hostedOfferDevRoute()` serves the app shell for `/hosted` in dev, where Vite's HTML fallback would otherwise serve the portal's `hosted.html`.
- `download-config.ts`: `HOSTED_OFFER_URL` and `MOBILE_APP_LINKS` (availability flags; `/hosted` never links a store, 9A).
- Privacy policy: a section on what the request form collects, that Netlify receives and emails it, and what it is for.

### Technical
- **Tests:** `hostedRequest.test.ts` (20), `HostedOfferPage.test.tsx` (27, under `LandingProviders`), `hostedOfferKeys.test.ts` (EN/AR parity and placeholders), `PrivacyPolicyPage.test.tsx` (+1), `vite-config.test.ts` (+7; the web snapshot gains two plugin names). QA: `@web.landing.hosted` (axe light and dark, every form state) and `@web.landing.hosted-375` (Arabic at 375).
- **Found in the browser, fixed:** the dev `/hosted`→`hosted.html` collision; the failure alert off-screen above the form (moved beside the button); two phone rules out-ranked by two-class base selectors; an in-text link told apart by colour alone (axe `link-in-text-block`).
- **Manual, before the first deploy:** Netlify form detection and the `hosted-request` email notification (INFRA §1).
- **/qa-reconcile fixes (2026-10-14):**
  - **Spam-trap field.** The honeypot is now Netlify's `bot-field`, hidden with `hidden`. Off-screen `company-website` could be autofilled, silently dropping real requests.
  - **Request id.** A hidden `request-id` is shared by retries and "edit and send again", so duplicates can be matched.
  - **Length limits.** name 200, email 254, phone 40, message 4000, both as `maxLength` and in validation.
  - **Language.** It's read once, at send time.
  - **Trailing slash.** `/hosted/`, `/privacy/` and `/download/` open their pages (`marketingPath`).
  - **Link preview.** `/hosted` gets its own card: `hosted-offer.html`, served by a `netlify.toml` rewrite.
  - **Privacy policy.** It names Netlify and Akismet, the IP and browser details, and 12-month retention. Scope and Network now treat the website form as the explicit exception.
  - **Design.** Success-panel link colour after a visit, hover and keyboard-only focus rings, laptop mock row alignment, and the hero stacks at ≤900px.
  - **Operator steps.** INFRA §1 adds the Spam tab, a usage alert and deletion steps. Spam protection with Turnstile is ticketed as MUT-197.
- **Files:** `src/main.tsx`, `vite.config.ts`, `src/content/download-config.ts`, `src/pages/landing/{HostedOfferPage.tsx,HostedOfferPage.css,hostedRequest.ts,PrivacyPolicyPage.tsx}`, `src/pages/landing/components/{HostedRequestForm.tsx,mocks/HostedDevicesMock.tsx,mocks/index.ts}`, `en.json`, `ar.json`, tests above, `qa/specs/web/landing.spec.ts`.

---

## [Unreleased] - 2026-10-14 — /download renders again: landing chrome instead of the app's TopBar

**Why:** in the web build `/download` crashed into the error boundary ("No QueryClient set"). `src/main.tsx` mounts the marketing routes outside the router and React Query, but `DownloadPage` rendered the app's `TopBar`, which since MUT-79 reads React Query (`FxRateReadout`) and the router (`useActiveProfile` → `useMatches`). The component test mocked TopBar away, so nothing caught it. Brief: `.claude/designs/download-page-crash.md`.

### Fixed
- `/download` wears the landing page's chrome, like `/privacy`: skip link, `LandingHeader` (wordmark home to `/`, no device button), its own `<h1>`, `LandingFooter`. No app provider is pulled onto a marketing page.
- The dead "Legacy single-card styles" in `DownloadPage.css` are gone; their later `.download-title` rule reset the new heading to 20px with no margin.

### Changed
- `src/main.tsx`: `/`, `/download` and `/privacy` share one `LandingProviders` wrapper (theme + language), which tests now render through.

### Technical
- **Tests:** `DownloadPage.test.tsx` drops its TopBar mock and renders under `LandingProviders` (red on main with the production error): landing chrome, no `.topbar`, AR/RTL, tab title. `downloadCss.test.ts`: one `.download-title` rule.
- **Browser:** `qa/specs/web/landing.spec.ts` `@web.landing.download` (bar, footer, CTA, no `.topbar`, no page errors), on a web preview build: red on main, green here; all 12 `@web.landing` cases pass. TD-122's `link-hover.spec.ts` /download case, with its `test.fixme` dropped, passes in light and dark on a scratch merge of both branches.
- **Files:** `src/main.tsx`, `src/pages/landing/LandingProviders.tsx` (new), `src/pages/download/DownloadPage.tsx`, `DownloadPage.css`, `src/pages/download/__tests__/DownloadPage.test.tsx`, `downloadCss.test.ts` (new), `qa/specs/web/landing.spec.ts`.

---

## [Unreleased] - 2026-10-14 — Hovered button-links keep their label colour (TD-122)

**Why:** the global `a:hover` rules (`--link-hover` in `theme.css`, underline in `index.css`) are (0,1,1), so they beat any single-class link's base colour. Several button-links turned link-purple and underlined on hover, some with a purple label on a purple fill: Settings › About's `.btn` links, the landing hero button and Get it cards, /download's buttons, the sidebar mark and Home's Needs attention client link. MUT-77 fixed four landing controls one by one; this fixes the cause. Design: `.claude/designs/td-122-classed-link-hover.md`.

### Fixed
- `src/styles/theme.css`, `src/index.css`: both global hover rules are now `a:not([class]):hover`, matching `a:not([class]):visited`. A classed link owns its hover (ADR-058 amendment, PATTERNS).
- Classed inline text links that relied on the global hover now declare it themselves (colour and underline): `.breadcrumb-link`, `.client-index-name` (placed before the settled and bucket rows' colours, which still win), `.feature-notice-banner-action`, `.hp-back` (portal), `.hero-cta-alt`, `.privacy-policy-back`, `.download-link`, `.download-alt-link`.

### Changed
- On hover, these no longer underline: `.project-tag` (it keeps its colour change), `.profile-switcher` (empty state), `.profile-switcher-action` and `.mac-download-banner-cta`. They are controls; the underline came from the global rule.

### Technical
- `src/styles/__tests__/brand.test.ts`: guards against a bare `a:hover` anywhere in `src/`, and checks the 8 text links' own `:hover`.
- `qa/specs/web/link-hover.spec.ts` (new, `@web.brand.link-hover` in `qa/features/web/brand.yaml`): light and dark, on a vite preview build.
- `/download` crashed on load ("No QueryClient set") when this was built, so the spec's /download test started as `fixme`. Merged onto `fix/download-page-crash`, which fixes the page; the `fixme` is dropped and the test passes in light and dark.
- `.claude/TECH_DEBT.md`: TD-122 resolved (first filed on the MUT-77 branch).

---

## [Unreleased] - 2026-10-14 — The portal presses, tints and shows where a save landed (MUT-91)

**Why:** HP1 of the Apple-design brief: the hosted portal is a separate build, so without this the app and the portal feel like two products. Spring drawers (R2) were already shared by MUT-80. Press feedback (L10) existed nowhere, though its MUT-102 tokens did. After-save feedback (R1) was app-only. Plan and eng review D1–D10: `.claude/designs/mut-91-portal-shared-motion.md`.

### Added
- **Press feedback, app-wide** (D6): every `Button` and any control given `.press` scales to `--press-scale` (0.96, 120ms on the brand spring) on pointer-down. This is a visible change across the whole local app as well as the portal. It uses the CSS `scale` property, never `transform`, so the portal's show-password toggle keeps its `translateY(-50%)` centring (D2). The portal's raw buttons and the shared drawer's close button take `.press`. Tabs don't press.
- **Portal after-save** for expenses and conversions (D7). The drawer marks the save. The list tints the row for 1.5s and announces a polite "Saved". When the list doesn't show the row, a page-local "Expense saved · Show" / "Conversion saved · Show" notice appears; it names no cause (D4/D5). An anchored list says why it's short and offers "Show latest".
- **Server `anchor` param** on `GET /v1/expenses` and `GET /v1/conversions` (D10). The page starts at that record, inclusive, and `nextCursor` continues older. `anchor` with `cursor` returns 422 on `anchor`. An unknown, deleted or other-organization id returns 404. Keyset cursors gain `inclusive` in both stores. `API_VERSION` is `1.21.0-mut91`; OpenAPI and `src/hosted/api/schema.d.ts` are regenerated.
- **Bundle rules:** dist-hosted carries neither `mutaba3a-active-profile` nor the app's `/clients/$clientId` Show route; dist-web/desktop carry no `hp-toast`.

### Changed
- `src/hooks/useSavedFlash.ts` → `src/lib/useSavedFlash.ts`: the portal lint bans `hooks/`. Only the import paths change.
- **The saved-flash backstop waits for lists still fetching** (D3). A portal refetch can outlast 1.2s, which used to raise a false message and drop the tint. After the backstop, a list that settled before the save and never re-rendered no longer holds resolution.
- `SavedFlash.kind` adds `expense` and `conversion`. A new store action, `settleMessage`, marks a notice shown.
- **Row tint:** `.data-table tr.row-flash td` becomes `tr.row-flash > td`, so the portal's `.table` is covered.

### Fixed
- **The tint's leading rail sat mid-row in Arabic** (D8). `inset 3px` is a physical left edge, so it is now mirrored under `[dir="rtl"]`. The comment that called it logical is corrected.
- `.btn-primary:active` no longer nudges 1px down; the press scale replaces it.

### Technical
- **Tests:**
  - `pressFeedback.test.ts` and `rowFlash.test.ts`: CSS contracts.
  - `hosted/pages/__tests__/pressFeedback.test.tsx`: every portal button presses.
  - `afterSave.test.tsx`, `SavedNotice.test.tsx`: portal flows.
  - 5 store cases (backstop and `settleMessage`).
  - Lint boundary, bundle rules and the drawer guard.
  - Inclusive cursors in both store contracts; anchor route tests for both endpoints.
- **Browser check** on preview builds:
  - The sign-in toggle scales to 0.96 with its translate kept (centre moves 0.55px).
  - An app Button scales to 0.96.
  - In Arabic, a save hidden by a filter, with a 1.6s refetch, shows the notice. Show then anchors on the saved record, and the row tints with the rail on the right.
- `test:db` (Postgres store contract) was not run locally (no test database); CI runs it.

### Fixed in review (/qa-reconcile + /review)
- **Stale anchors:** a deleted or bookmarked anchor no longer shows "Can't reach Mutaba3a" and re-checks `/v1/me`. The API's anchor 404 carries `reason: ANCHOR_NOT_FOUND`, and `useAnchoredList` drops the anchor and shows the latest list. A delete of the anchored expense drops it too.
- **Notice:**
  - It holds while hovered or focused (WCAG 2.2.1, as the app toast does).
  - Show moves focus to the anchored note.
  - Show now lands when the list was already anchored on that record.
- **Saves:**
  - A save left before its list answered no longer greets, announces or tints on a later visit.
  - `MAX_WAIT_MS` caps a hung refetch.
  - Sign-out clears the store.
- **Press and tint:**
  - Press feedback skips `aria-disabled` controls.
  - The row tint keeps `.data-table`'s specificity, so the reduced-motion held tint beats hover again.
- **Stale docs:** the registry's row-flash line and the `messaged` doc.
- **Re-review fixes:**
  - A claimed save settled within its 1.5s tint no longer leaves the row tinted for good. The tint timer keys on the save's ids, not the object.
  - A list in error reports no rows, so stale data can't claim an edit and hide D4's notice.
  - The stale-anchor drop navigates once.
- **New debt:** TD-127 (local controls that press outside `.press`) and TD-128 (portal notice follow-ups). MUT-77's landing press rules moved onto `scale` in the merge (see below).

---

## [Unreleased] - 2026-10-14 — Hosted portal: add income and record payments on a personal profile (MUT-133)

**Why:** a personal hosted profile's session could already write income (MUT-65), but the portal rendered no affordance, so a freelancer had to pick up the phone to log what a client owes or paid. MUT-93 fixed the copy and deferred this.

### Added
- **Add income** (`IncomeCaptureDrawer`): Received or Owed via `POST /v1/income`, from Receivables, Payments and Client detail (client prefilled). Fast path (kind, amount, client, what it was for) with the rest behind "More details" and a defaults summary; it opens on a hidden-field error.
- **Record payment** (`RecordPaymentDrawer`): settles an open Owed entry via `POST /v1/receivables/{id}/settle`. The title carries what's left; a live line says paid in full / still owed / exceeds, and blocks Save when over; a note says a recorded payment can't be changed yet.
- One gate, `incomeAffordancesFor`: personal profile only (`isPersonalDefault`); Malafat-fed and non-personal profiles stay exactly as read-only as before (tested).
- A polite "Saved · …" status for each income save (Toast `info` tone in a persistent `aria-live` region).
- `todayInZone`, `useAttemptKey`, `HostedTable` `stickyEnd`, an optional `id` on `EntityTypeahead` and the portal pickers.

### Changed
- `ReadOnlyNotice` shows nothing on a writable personal profile; its fallback copy drops "This view is read-only".
- Receivables/Payments/Client detail parse `?newIncome=` / `?settle=` beside their filters and own the drawers; lists take `onRecordPayment` and an empty-state action.

### Fixed
- Expense and conversion creates were not retry-safe: a Save retried after a timeout that landed recorded twice. All portal creates now reuse one Idempotency-Key per save attempt (D5).
- Expense and conversion drawers default the date to the profile's calendar day (the server checks dates in that zone).
- Pre-landing review (qa-reconcile): Record payment kept its form keyed by receivable *version*, so the re-read after a race (or a focus refetch) remounted it, dropped the typed amount and the "more than what's left now" error, and refilled the new outstanding. The amount now lives in the drawer (keyed by receivable), the sent value is pinned on submit, and Save stays blocked against the fresh figure. Also: an error in collapsed More details reopens it; pending Save is `aria-disabled` (a disabled focused button loses focus in Chromium); after Add, focus returns to the header Add button; an empty Paid on says "Choose a date"; identical Saved messages are re-announced; row buttons name the client.

### Technical
- en/ar keys under `hosted.income.*` and `hosted.settle.*`. ADR-037 MUT-133 amendment; hosted-portal.md §7.4 rewritten; PATTERNS (attempt key, pages own drawers, zone dates, lenient money input, focus before close, pre-rendered live region); TD-056 resolved; TD-123..TD-126 added.
- Plan, reviews and wireframe: `.claude/designs/mut-133-portal-personal-income.md`, `mut-133-portal-income-wireframe.html`.
## [Unreleased] - 2026-10-14 — Edit a payment's date from the ledger and the entry (MUT-169)

**Why:** Fast-added Received income is dated *now* (`nowISO()`), and users fix the date hours or days later from `/income`. A fully paid row there had no way to reach its payment (its Record Payment button hides and its menu had only Duplicate). The income drawer told people to manage payments from the client page. Plan and eng-review decisions D1–D7: `.claude/designs/mut-169-edit-payment-from-ledger.md`.

### Added
- **The payment drawer's `editPayment` intent** (`partialPaymentDrawer.intent`, `PartialPaymentIntent` in `lib/stores.ts`). An entry with one payment opens straight into its edit, with the date open and focused (D3). Several payments are listed to pick from, with no create form. With none, it says so. Saving one payment closes the drawer; with several, the list comes back. `editPaymentRecord` keeps the intent for the same entry, as it does `onRecorded`.
- **/income row menu → Edit Payment** on any row with money received (`IncomeRow.canEditPayment`), paid or part-paid.
- **Income drawer: "Last payment {date} · Edit Payment"** up front on an entry with payments. It hands over to the payment drawer with the intent. While the form has unsaved changes, the button is disabled and a hint says to save first (D2). New `drawer-notice--info` variant (neutral, one row).
- `paymentLocalDay` (`lib/dates.ts`) and `formatPaymentDate` (`lib/utils.ts`).

### Fixed
- **The edit form prefilled a payment's UTC day.** A fast-add saved between local midnight and ~03:00 in Israel opened a day early, and any save moved it back a day. It now prefills the local day (D1).
- **A date-only payment showed a day early west of UTC** in the payment drawer's history and the client's Payments list (`new Date('YYYY-MM-DD')` is UTC midnight). Both now use `formatPaymentDate` (D5).
- Under the intent, a failed payment-records read shows the load-failed notice with Try again, never "No payments recorded yet" (D7).

### Changed
- `drawer.income.paymentsRecordedHint` no longer says "Manage payments from the client page" (en, ar). New keys: `drawer.income.lastPayment`, `drawer.income.saveBeforePayment`.

### Technical
- Tests: drawer intent (1/several/none/loading/failed, save/cancel paths, focus, local-day prefill, future date), store intent, `canEditPayment`, the ledger menu, the income-drawer link and its dirty guard, `paymentLocalDay`/`formatPaymentDate` in UTC+ and UTC− zones, the client Payments list west of UTC, and entry recalculation after a date move (`paymentRecords.test.ts`, D4). QA: `@web.record-payment.edit-payment-date` and `-rtl`.
- Files: `src/lib/{stores,dates,utils}.ts`, `src/components/drawers/{PartialPaymentDrawer.tsx,PartialPaymentDrawer.css,IncomeDrawer.tsx}`, `src/pages/income/{incomeRows.ts,IncomePage.tsx}`, `src/components/clients/ClientPaymentsSection.tsx`, `src/index.css`, `src/lib/i18n/translations/{en,ar}.json`, `qa/specs/web/record-payment.spec.ts`, `qa/features/web/record-payment.yaml`.

### Fixed in pre-landing review (2026-10-14)
- **Editing an unpaid entry to Received now records a payment** (`transactionRepo.update`, no-records branch → `markPaid`), like a Received create (MUT-60). Before this, the edit wrote status/paidAt/received straight onto the entry, so Edit Payment opened on an entry with nothing to edit (TD-029 on the edit path).
- **An edit saves only what changed.** An untouched date keeps its stored instant: a no-op save no longer turns a fast-add's UTC timestamp into a day, which could move it across a month boundary for readers that use the UTC day. A legacy entry recorded over its total (ADR-030) can have its date fixed without tripping the overpayment check.
- **Payment dates show the user's own day everywhere:** Home's Recent payments, the Clients index's Last payment and the CSV export's `paidAt` now go through `formatPaymentDate`/`paymentLocalDay`. `paymentLocalDay` also reads non-ISO stored dates (a CSV import's `1/15/2024`) instead of producing "Invalid Date".
- **Edit Payment from the income drawer:**
  - The guard also waits for a client name typed but not picked.
  - The button uses `aria-disabled`, so it stays focusable and its hint is read.
  - The hand-over opens the payment drawer a tick later, so closing it returns focus to the row that opened the income drawer.
  - "Last payment" breaks a same-day tie by the stored value, so list order never decides.
- **Payment drawer:**
  - A failed records read has its own copy (`transactions.partialPayment.loadFailed`; the income drawer's said "can't be saved yet").
  - Retry shows that it is loading and can't be clicked twice.
  - A failed background refetch keeps the records already loaded.
  - The picker says "Choose the payment to edit."
  - The record row's edit/delete buttons have accessible names.
  - The ledger's Edit Payment has a pencil icon (new `PencilIcon`).
- **Tests are stable under `npm run test:tz`:** the Jerusalem-specific cases pin their zone, and two expectations that encoded the old UTC-midnight output now name the day.

### Known, not fixed here
- The repository orders a transaction's records by raw string (`recalculateReceivedAmount`, `listByTransaction`). West of UTC, a timestamp record and a date-only record on adjacent days can sort against their local days.
- The single-record edit is derived on each render: if another window adds or removes a payment while the form is open, it switches to the picker.
- `OrphanedRecordsDrawer.test.tsx` fails under `npm run test:tz` on main too (unrelated).

---

## [Unreleased] - 2026-10-14 — A retainer's schedule no longer skips months (TD-120)

**Why:** `scheduleGenerator.generateSchedule` walked months with `new Date(retainer.startDate)` and a local `setMonth(+1)` (or `+3`). The date-only start parses as UTC midnight while `setMonth`/`getMonth`/`getFullYear` are local, so a start on the 31st jumped from January to "Feb 31" = 3 March in every timezone, and west of UTC a start on the 1st read as the previous month and then skipped one. A missing row is missing expected income and leaves a payment nothing to match.

### Fixed
- `src/db/retainerRepository.ts` `generateSchedule`: the cursor is an integer month index (`year * 12 + month`) read from the start date's string, stepped by 1 or 3. Each period comes from the existing `getMonthlyPeriod`/`getQuarterlyPeriod`/`getPaymentDate` helpers, so a payment day past the month's end is clamped (Feb 28, or 29 in a leap year). The loop stops when the period start is past `horizon`, compared as strings. The skip rules (period ends before the start date, period already exists, period starts after the end date) and idempotency are unchanged.

### Changed
- The horizon check is now on the period start, not on a cursor carrying the start date's day of month. For a start mid-month, the last month whose first day falls on or before the horizon now always gets its row; before, it was dropped when the horizon's day of month was earlier than the start's.

### Technical
- `src/db/__tests__/retainerRepo.test.ts`: four cases under "every month and quarter gets a row (TD-120)", each at a fixed instant via `atInstantIn`. All four failed on the old loop.
- `.claude/TECH_DEBT.md`: TD-120 resolved.

---

## [Unreleased] - 2026-10-14 — Craft-fix bundle from the Apple-design pass (MUT-92)

**Why:** small defects from the 2026-10-11 review that needed no decision. Plan: `.claude/designs/mut-92-craft-fix-bundle.md` (eng review D1: reuse `useTransactions`; D2: the other count strings get their own ticket). Two of the ticket's nine fixes were already on main: the demo seed's future dates (MUT-78) and the About name (MUT-88); the second now has a regression test.

### Changed
- **Income drawer currency** (`IncomeDrawer.tsx`): a new entry for a client starts in the currency of that client's newest income (archived entries count; deleted entries and expenses do not), else the profile currency. It follows a client or profile change until the user picks a currency. Edit and duplicate keep their own currency. One `useTransactions({clientId, kind:'income', includeArchived:true, limit:1})` read, gated to create mode with a client.

### Fixed
- **Drawer layering** (`DemoBanner.css`): the fixed demo bar drops from z-index 1000 to 150, above content (≤100) and below drawers (200/201) and modals, so it no longer clips the drawer header.
- **Record Payment** (`RecordPaymentButton.tsx`): a space between the label and the remaining amount, so copied and page text reads "Record Payment ₪3,550". The visual gap and the accessible name are unchanged.
- **All Time** (`DateRangeControl.tsx`): no longer prints its sentinel range "01/01/2000 – 31/12/2100", on all seven pages that use the control.
- **Client Payments notes** (`ClientPaymentsSection.tsx`): the notes cell shows only what the user wrote. "Recorded on the entry" and the migration note (on every legacy record since MUT-60's v23 backfill) are hidden, and the Notes column is dropped when no row has a note.
- **Expenses ledger** (`ExpensesLedgerPage.tsx`): row amounts lose their minus sign (flat and by-category), keeping the expense colour. `ProjectDetailPage` keeps it, because its list mixes income and expenses.
- **Relative dates** (`formatRelativeDate`): "1 week ago" instead of "1 weeks ago", and all six Arabic plural forms, via `Intl.RelativeTimeFormat`. Callers (`FxRateReadout`, `ClientsPage`, `ProjectsPage`) pass the locale; the untranslated English fallback is gone.

### Removed
- i18n keys `clients.profile.payments.recordedOnEntry`, `transactions.partialPayment.migratedNote` and `time.daysAgo|weeksAgo|monthsAgo|yearsAgo`, from `en.json`, `ar.json` and `types.ts`. `MIGRATED_PAYMENT_NOTE` stays: it is stored data.

### Technical
- Tests: `src/styles/__tests__/layering.test.ts` (new), `src/lib/i18n/__tests__/craftFixKeys.test.ts` (new), plus cases in `IncomeDrawer`, `RecordPaymentButton`, `DateRangeControl`, `ClientDetailPage`, `ExpensesLedgerPage` and `utils` suites. The MUT-94 "$42 in the strip" test now reads the strip, since the row shows "$42" too.

---

## [Unreleased] - 2026-10-14 — Retainer projections use the local "today", not the UTC one (TD-014)

**Why:** `src/db/retainerRepository.ts` kept a private `todayISO()` built from `toISOString()`, the UTC date that ADR-022 forbids. Between 00:00 and ~03:00 in Asia/Jerusalem it returned yesterday, so a projected retainer payment due today stayed `upcoming` for the first hours of each local day. It surfaced on 2026-10-14 at 02:00 as a failure in `retainerRepo.test.ts` ("refreshes due states…"), which built its "today" from local fields while the code compared against UTC.

### Fixed
- `retainerRepository.ts`: the private UTC helper is deleted; `refreshDueStates`, `end` (the end date), `getSummary` (overdue totals), `projectedIncomeRepo.list` (`daysOverdue`), `unmatch` (back to due/upcoming) and `generateSchedule` (a new row's initial state) all call `todayLocalISO()`. The schedule's 12-month horizon is `formatLocalDate` of the local date, not its UTC date.

### Technical
- `src/test/atInstantIn.ts`: the `atInstantIn(timeZone, instant, fn)` helper moves out of `paymentRecords.test.ts` so both tests share it.
- `retainerRepo.test.ts`: the refresh-due-states test is deterministic (01:30 on 2026-10-14 in Jerusalem), and five new cases pin the other paths at the same instant. All six fail on the old code and pass in Jerusalem, New York, UTC and UTC+14 host timezones.
- `.claude/TECH_DEBT.md`: TD-014 updated (the retainer copy is gone; `recurringExpenseService.ts` keeps its copy). New TD-120: the schedule's month cursor (`new Date(startDate)` + local `setMonth`) skips February for a start on the 29th–31st, and skips a month west of UTC for a start on the 1st. Found here, not fixed here.
- `.claude/PATTERNS.md`: the date pattern's Testing note points at `atInstantIn` for "today" bugs.

---

## [Unreleased] - 2026-10-14 — MUT-77: the landing page's frosted sticky header and restrained motion

**Why:** The landing page had only a floating language toggle: no product name above the fold, an overlap with the hero at 375 in Arabic, no press feedback on most buttons, and an Arabic tab title in English. On top of that, hovering the hero button in OS light mode turned its label purple on its purple fill. MUT-77 (epic MUT-74, Brand v2 re-cut) carries out brief L9/L10 with the MUT-102 tokens. Plan and eng review: `.claude/designs/mut-77-landing-header-motion.md` (D1–D10).

### Added
- **The header bar** (`LandingHeader`):
  - A slim sticky frosted bar with the Brand v2 wordmark, the language switch, and the hero's device-matched button.
  - The button shows only once the hero's own has scrolled out of view, which `useInView` (IntersectionObserver) reports.
  - The background is an 85% `--bg` frost with `backdrop-filter`. It turns solid under `prefers-reduced-transparency` and without `backdrop-filter` support (D3).
  - A top sentinel drives a scroll-edge fade instead of a border.
  - There are no section links.
- `useInView` (`src/hooks`), `useDocumentTitle` (`src/hooks`), `useHeroCta` (`src/pages/landing`), `FakeIntersectionObserver` (`src/test/intersectionObserver.ts`).
- **Chapter visuals rise and fade in once** (`--stagger-rise` over `--duration-nav` on `--ease-spring`):
  - Only below the fold, with motion allowed, and with an observer present to bring them back.
  - **Deviation from L10's "cross-fades only":** under reduced motion the visuals are simply there, with no animation (D4). `theme.css` forces every transition to be instant under reduced motion, so a cross-fade would need an `!important` override.
- **Tab titles follow the language** on `/` (D6), and on `/privacy` and `/download` (D8). The `/privacy` and `/download` titles are Basel's call and go beyond the ticket's AC.
- `qa/specs/web/landing.spec.ts`, covering 375 and 320 in EN and AR, and the privacy bar. `brand.spec.ts` also runs axe with the bar over a chapter.
- i18n keys in EN and AR: `landing.meta.title`, `common.pageTitle`, `landing.header.{wordmark,wordmarkShort,cta.*}` and `landing.langToggle.label`. The web short label is "Web app" / "تطبيق الويب", which keeps it part of the accessible name (WCAG 2.5.3).
- **Pre-landing review fixes** (/review: 5 specialists, red team and an adversarial pass):
  - **The bar on phones:** it keeps its padding. Its rule is now two classes, because the phone `.landing-container` rule out-ranked it. Phones get 44px tap targets, and at 360px and below the bar's button shows only its icon.
  - **Button placement:** the bar's button sits before the language switch, so the switch holds the end edge while the button is hidden.
  - **No dead zone:** the hero button is watched below the bar (`rootMargin` -72px). Without that there was a stretch of scroll where the hero button sat under the bar and neither button was usable.
  - **`/privacy`:** the bar has no button and makes no GitHub call, and the wordmark links home (`homeHref`).
  - **Hover:** only the shown button dims on hover, so hovering never blocks its fade-out.
  - **FAQ rows** dim on press rather than scaling.
  - **Release fetch:** it times out after 10s, so the shared request always settles, and a failed cache write keeps the release.
  - **Smaller items:** the dims come from `--landing-press-dim` / `--landing-hover-dim`; the blur is lighter (12px); unrevealed visuals still print; `scroll-padding-top` keeps jumps below the bar.

### Changed
- **Press feedback:** every landing button presses in with `--press-scale` / `--duration-press`, zeroed under reduced motion. That covers the hero and bar buttons, the language switch, the Get it cards and the FAQ questions; the literal 0.97/0.98 values are gone. Text links dim on press instead.
- **Release fetch:** `fetchLatestRelease` shares one GitHub call between concurrent callers and clears it on settle (D2). A first visit now makes one call instead of two. The contract is pinned first in `useLatestRelease.test.ts` (D7).
- **`Wordmark`** moves from the portal to `src/components/brand`, with the name and classes as props. The portal's `Wordmark` keeps its API.
- **Hero top padding** drops to `--space-16` / `--space-10`, because the bar now sits in the flow.

### Fixed
- **Hover:** `theme.css` `a:hover` (0,1,1) out-ranks a single-class link. The hero button, the bar's button, the wordmark link and the Get it cards now hold their own hover colour and no underline. The app-wide rule is TD-122.
- **The 375 overlap:** the bar is in the flow. Below 480px the wordmark shows only the active language's name, so it never runs under the switch.

### Removed
- The unused `.transition-all` utility (`transition: all`) from `theme.css`.

---

## [Unreleased] - 2026-10-14 — The Settings QA specs find Language and Theme as radiogroups (MUT-160)

**Why:** Since MUT-139, Settings → Language and Theme are `SegmentedControl` radiogroups, each named by its row label. MUT-103 (`5bd1b09`) moved the Language clicks to `radio`, but `qa/specs/web/settings.spec.ts` still waited for a `Language` and a `Theme` heading, and still clicked Dark, Light and System as buttons. So `@web.settings.language` and `@web.settings.theme` timed out on every run.

### Fixed
- `qa/specs/web/settings.spec.ts`: both tests now wait for `radiogroup` named `Language` or `Theme` instead of a heading. The Theme clicks are `radio`s scoped to that group, so the sidebar's `Theme: …` toggle button can never match. After each click, the test also checks that the option is `aria-checked`. The Language radios are still found through `main`, because the group's own name turns Arabic once the page does.

---

## [Unreleased] - 2026-10-13 — MUT-103: no hard-coded colour, size or radius anywhere outside the token file

**Why:** MUT-102 (Brand v2) re-pointed `theme.css` at the new brand tokens, but left the rest of the app on the old system behind shrink-only allowlists: 131 colour literals, 33 px radii, 95 literal font sizes, 496 uses of the legacy `--text-xs…4xl`/`--radius-xl/2xl/full` aliases, 46 dead `var()` names, and amounts outside the shared components still in the body face instead of Plex Mono (TD-079). Nothing stopped a new one from landing. MUT-103 (epic MUT-101) closes that gap app-wide — landing and the hosted portal included (their layout and motion stay with MUT-77/MUT-91) — and turns each allowlist into a guard that fails on a new literal.

### Added
- `src/styles/__tests__/brand.test.ts` › `literals`: a guard (`cssLiterals`/`scriptLiterals`/`tabularWithoutMono` in `src/test/css/brandCss.ts`) that fails on a colour, a px/rem font-size, or a px radius anywhere outside `src/styles/`, on an inline `<style>` element in TSX, and on a `tabular-nums` rule with no `--font-mono` in the same rule. The only exemption is user data (a business's or expense category's own colour), in `ALLOWED_LITERAL_FILES` with a reason.
- `--radius-xs` (4px) and `--text-micro` (11px) in `mutaba3a.tokens.json` → `--m-*` → `theme.css` role (D1), for sizes the original six-step scale had no room for.
- `--m-avatar-mock-fill` (`mutaba3a-theme.css`) / `--landing-mock-avatar-fill` (`theme.css`): the landing business-switcher mock's per-item hue fill, factored out of `LandingPage.css` so the formula (and its `var(--avatar-hue)` dynamic input) lives with the other primitives instead of as a literal `hsl()` call in a component stylesheet.
- `qa/specs/web/brand.spec.ts`: a Clients row is asserted ≥ 48px tall at 1280px (D5).

### Changed
- All 496 legacy alias uses (43 files, including landing and the portal) migrated onto the brand roles (`xs/sm` → label, `base/md/lg` → body, `xl/2xl` → headline, `3xl/4xl` → title; radius `xl/2xl/full` → card/hero/pill); the aliases are deleted from `theme.css` and `FROZEN_THEME_NAMES`.
- Every `*-amount`/`*-total` class that wasn't already on Plex Mono now is: the payment drawer's amount field, `RecurringOccurrenceCard`, `RecordPaymentButton`, `RecurringAttentionList`, the expenses-group/unified/currency-summary totals, and the landing mock's amounts (`.landing-mock-amount/-money/-client-owed/-client-overdue/-input--amount`). Because Plex Mono ships only 400/500, every rule that gained `--font-mono` and asked for 600+ in the same declaration dropped to `--weight-medium` — otherwise the browser fakes a bold.
- `BusinessProfileDrawer`'s three `#3b82f6` literals move into `DEFAULT_BUSINESS_COLOR` (`profileAvatarStyle.ts`), the one constant `ALLOWED_LITERAL_FILES` covers for user data.
- Fluid landing headlines (`landing-section-headline`, `landing-chapter-title`, `landing-privacy-title`, `HeroSection`'s headline and subheadline, `PrivacyPolicyPage`'s title) take their `clamp()` floor and ceiling from `--text-title/figure/display/body/headline` instead of raw rem values.
- `.landing-mock`'s card shadow is `var(--shadow-2)` instead of a literal `rgba()` pair.
- `--table-row-height` goes 44px → 48px (D5); `.data-table td` wires `height: var(--table-row-height)` as a floor (padding unchanged).

### Removed
- `KNOWN_DEAD_REFERENCES` (46 names) and its "lists only dead references" test: `references` now simply fails on any new dead `var()`.
- `KNOWN_LITERAL_PAIRS` (6 CSV-preview literals): `CSVValidationPreview.css` is on tokens.
- The inline `<style>` blocks in `PlanAssumptionDrawer.tsx` and `MonthlyTimeline.tsx`, moved to co-located `.css` files.

### Technical
- `KNOWN_LITERALS` and `KNOWN_TABULAR_WITHOUT_MONO` are both now empty — every file that was in them is clean.
- `.claude/TECH_DEBT.md` TD-079 narrowed to two items the owner chose to leave open (eng review D2): heading weights/roles (`index.css`'s app headings compute 600 but render Thmanyah's 700 file; the app's heading scale is deliberately smaller than the landing page's), and the user-chosen business colour's ink/hex validation (still a flat white ink, still no format check). Everything else in TD-079's original scope is resolved.
- `.claude/DECISIONS.md` ADR-058 amended with the D1 token additions, the alias removal, and the literal/mono guards.
- `.claude/PATTERNS.md`: new "No Literal Colour, Radius or Font Size Outside `src/styles`" pattern; the type-scale snippet gained `--text-micro` and dropped the now-false "legacy aliases" comment; the radius quick-reference row gained `-xs`.

---

## [Unreleased] - 2026-10-13 — Every Received income entry is record-backed, not just Mark-paid ones (MUT-60, TD-029)

**Why:** Fast-adding income and marking it Received wrote `status`/`paidAt`/`receivedAmountMinor` straight onto the Transaction with no `PaymentRecord` (TD-029). ADR-033 papered over it on read (a synthetic `entry` row), but the payment drawer's history, a future statement export, and MUT-169 (editing a payment's date from the ledger) all needed a real record to exist. Plan + eng review: `.claude/designs/mut-60-payment-record-backfill.md`.

### Added
- `transactionRepo.createReceivedIncome(data, paidAt)`: composes the existing `create` + `markPaid` atomically (one `db.transaction`) — zero changes to either. `IncomeDrawer`'s Received create now calls this instead of writing payment fields directly.
- `buildReceivedIncomeEntry` (`src/lib/incomeEntry.ts`), `useCreateReceivedIncome` (`src/hooks/useQueries.ts`).
- Dexie **v23**: backfills one `PaymentRecord` per uncovered paid/part-paid income transaction for data written before this ticket. Generalizes v18's backfill (which assumed zero existing records) to subtract whatever records already exist. Future-dated legacy `paidAt` is clamped to today (MUT-18). Archived, soft-deleted and non-income rows are skipped. `uncoveredPaymentAmount` (`src/db/database.ts`) is exported as a pure function, unit-tested directly.

### Fixed
- CSV import (`src/db/csvImport.ts`, found in eng review): the income loop writes `db.transactions.add()` directly, bypassing `transactionRepo` entirely, so a paid row had the same record-less gap through a third door nothing else in this ticket touches. It now writes the covering `PaymentRecord` too — the v23 backfill only fixes data that exists at migration time, not future imports.

### Changed
- `buildIncomeCreate` no longer handles `incomeStatus: 'received'` — only the unpaid/invoiced write. The edit path needed no change: MUT-5/ADR-039's `hasRecords` branch already does the right thing once a record exists.
- `ITransactionRepository` (`src/db/interfaces.ts`) gains `createReceivedIncome`.

### Technical
- New tests: `database.test.ts` (pure `uncoveredPaymentAmount`), `migration-v23.test.ts` (backfill + migration-safety), `csvImport.test.ts` income cases, plus coverage added to `transactionRepo.test.ts`, `useQueries.test.tsx`, `IncomeDrawer.test.tsx`, `paymentRecords.test.ts`, `aggregations.test.ts` (Owed Now / Recent payments / Last payment proven unchanged by the backfill).
- The current-version assertions in migration-v20/v21/v22, the retained-schema tests, and one stale assertion in `expensesGatingDataSafety.test.ts` (already wrong since MUT-88's v22 bump, caught running the full suite) now expect **23**.
- TD-029 resolved. Full suite: 3693/3697 pass (4 pre-existing skips), 262/262 files. `lint` 0 errors (6 pre-existing warnings, none in touched files). `typecheck` and `build` clean.

---

## [Unreleased] - 2026-10-13 — The storage seam is complete and linted (MUT-47, ADR-071)

**Why:** CLAUDE.md's done-gate named a `test:integration` script that never existed, and TD-013 claimed only five objects sat outside the repository provider. In the code, plans, retainer matching, CSV import, export, delete-all, the migration wizard, demo seeding and five more helpers all reached Dexie around the seam, and nothing checked it.

### Changed
- **CLAUDE.md Phase 4** lists commands that exist and pass: `lint`, `typecheck`, `test:run`, `build`, under Node 22. It adds a line for `server/` that mirrors server CI, and closes the code fence that rendered the rest of the file as code.
- **Provider: 18 → 23 slots.**
  - New slots: `plans`, `planAssumptions`, `planScenarios`, `dataset` (whole-database operations) and `demoData` (`?demo=1` and the visitor sample).
  - New methods: `projectedIncome.refreshDueStates/markMissed/getMatchSuggestions/getAllMatchSuggestions/match/unmatch`, `retainerAgreements.getSummary`, `transactions.listNeedsReview/resolveNeedsReview`, `clientSummaries.getCrossProfileStats` and `expenseCategories.seedDefaults`.
- **Callers:** usePlanQueries, useRetainerQueries, useExpenseQueries, useOrphanedRecords, ClientsPage, DataToolsSection, ImportDataPage, ExportDataModal, DeleteAllDataModal, MigrationWizard, OrphanedRecordsBanner, `src/demo/seedData` and `src/demo/visitorSample` now resolve storage through `getRepositories()`.
- **MigrationWizard's business picker** lists businesses sorted by name, because it now uses `businessProfiles.list()`.

### Fixed
- A legacy (pre-v2) JSON import clears and refills its six tables in one transaction. A failing write now leaves the database as it was, instead of half emptied (D8). Before the fix, the test failed without the transaction.

### Technical
- An ESLint rule (`@typescript-eslint/no-restricted-imports`, app scope) rejects `db`, repository objects and storage modules outside `src/db`. `initDatabase()` in `main.tsx` is the one documented exception. `src/__tests__/seamLint.test.ts` proves the rule.
- New `src/db/dataset.ts` and `src/db/demoData.ts`.
- `src/utils/csvImport.ts` moved to `src/db/csvImport.ts` together with the page's CSV loop, byte-identical apart from one variable name.
- The backup file download moved to `src/utils/backupDownload.ts`.
- `RetainerSummary` moved to `types`.
- `calculateMatchScore` is now a pure export.
- `scheduleGenerator` stays Dexie-internal.
- ExportDataModal derives its single-profile default at render instead of setting it in an effect.
- Main chunk: 205,417 → 207,568 B gzipped (+2.1 KB), from export and import code that moved out of lazy chunks.
- Knowledge files:
  - TD-013 rewritten from the code. Its interface list still named deleted `IDocument*` and `IMonthCloseStatus*` interfaces.
  - TD-073 updated with the D9 IncomeDrawer findings: contention, not a race.
  - PATTERNS and COMPONENT_REGISTRY updated.
- TODOS: item 2 removed; #10–#12 added (the delete-all table set, migration wizard `updatedAt`, and CSV import business scoping).

---

## [Unreleased] - 2026-10-13 — Settings in five groups, one home per action (MUT-88, ADR-072)

**Why:** Settings offered two exports and two restores. Delete all data sat beside them, and its "back up first" step saved CSVs that Restore can't read. The settings column scrolled in its own 600px box. Two Default badges could appear.

### Added
- `YourDataSection`: Back up (with "Last backed up: <date>"), Restore, Export a business, Export receipts and Check data, each once.
- `RestoreBackupModal`: asks before a full backup replaces everything, and names its date and record count (Arabic plural forms included).
- `src/lib/dataFiles.ts`: `classifyDataFile` plus the one-slot hand-off to `/settings/import`.
- `src/db/profileDefault.ts`: `pickDefaultProfileId` / `enforceSingleDefaultProfile`.
- `backUpNow()` (`src/utils/backupDownload.ts`, alongside `downloadBackup` per MUT-47) and `useBackUp()`, and `Settings.lastBackupAt`. Dexie **v22**: a one-time repair of extra defaults, and `demoData.seed` settles it too.

### Changed
- Settings order: Businesses, General (was Preferences), Features (was Advanced features), About ("Mutaba3a", was "Mutaba3a - Mini CRM"), Your data, then Delete all data alone below every card. `.page-content` is the one scroll area; `.settings-column` caps the width.
- Delete all data: step 1 makes the same full backup as Back up; step 2 is a typed word (DELETE / «حذف»).
- Every profile writer (repo, demo seed, profile import, restore) settles "exactly one default" in its own transaction. Real profiles outrank `demo_` sample ones.
- `ExportDataModal` is titled "Export a business". The import page's full-backup message points to Settings › Your data › Restore. The QA export spec follows the new labels.

### Removed
- `DataToolsSection` (its tests moved to `YourDataSection.test.tsx`), the inline Data block, the duplicate Import Backup handler, the CSV "backup" in the delete modal, `.settings-family`, `.settings-section-nested`, `.settings-row-danger`, and the now-unused i18n keys.

### Technical
- New tests: `profileDefault`, `migration-v22`, `backup`, `seedDefault`, `dataFiles`, `RestoreBackupModal`, `DeleteAllDataModal`, `YourDataSection`, `SettingsPage.structure`. ImportDataPage gains three handoff tests. The current-version assertions in migration-v20/v21 and the retained-schema tests now expect 22.
- Gate (per Basel, no full suite): targeted suites (`src/pages/settings`, `src/components/modals`, `src/db`, `src/demo`, `dataFiles`, `src/lib/i18n`): 699/700 pass. The one failure was `ImportDataPage` "reuses the target profile's own project…", which passes when the file runs alone (25/25, twice): a load-sensitive 50 ms wait. `typecheck` is clean; `lint` has 0 errors (6 warnings, all in files this ticket did not touch); `build` and `test:bundles` pass; the page was checked in the browser (EN + AR).
- **Merged onto MUT-47 (ADR-071):** `backUpNow` moved to `src/utils/backupDownload.ts` (the browser-only download helper MUT-47 already introduced) instead of living in `src/db/backup.ts`; its test moved with it to `src/utils/__tests__/backupDownload.test.ts`. `YourDataSection` and `RestoreBackupModal` reach the data layer through `getRepositories().base.dataset` per the storage seam, not direct `db/*` imports. `DeleteAllDataModal` and `demoData.seed()` (not a raw `db.transaction`) likewise. qa-reconcile re-ran lint/typecheck/targeted tests (155/155) post-merge.

---

## [Unreleased] - 2026-10-13 — Brand v2 icons and browser chrome (MUT-104)

**Why:** The Brand v2 icons were placed but not wired: the manifest was still January navy, the heads had a single favicon, which rendered solid black because the delivered SVG had no `<style>`; the desktop app shipped the January icon; the sidebar used a PNG; and the landing had no link preview. Plan, eng review and decisions D1–D9: `.claude/designs/mut-104-brand-chrome.md`; ADR-073.

### Added
- `index.html` / `hosted.html`: SVG favicon + 32/16 PNG fallbacks, apple-touch icon, theme-color per OS scheme. The portal links `./public/…`, bundled to hashed `/assets/*` (D3).
- Link previews (web build only): `socialMetaTags()` + `mutaba3a:social-meta` plugin in `vite.config.ts`; Arabic copy from the landing hero, Claude Design's `public/og-card-ar-1200x630.png`, `summary_large_image`; origin from `MUTABA3A_PUBLIC_ORIGIN` (`.env.example`).
- `BrandMark` (`src/components/brand/`): theme-aware Brand v2 mark in the sidebar and the portal `Wordmark` lockup.
- `syncThemeColorMeta` (`src/lib/theme/themeColorMeta.ts`): browser tab/title bar follows the in-app Light/Dark/System toggle (D6).
- `npm run icons:desktop`: regenerates every Tauri icon from `public/icons/icon-1024.png`.

### Changed
- PWA manifest `theme_color`/`background_color` `#070C16` → `#FCF6ED`; favicons + apple-touch precached; manifest and include list exported (`PWA_MANIFEST`, `PWA_INCLUDE_ASSETS`).
- `public/favicon.svg`: light and dark styles inline; C2PA block removed.
- `src-tauri/icons/*`: Brand v2 full-bleed art (D2, Tahoe grey-box risk).
- Landing headline (en + ar): "Track your finances, securely." / "تابع مالك، بأمان." (Basel, D9).
- `.brand-mark` loses the tile radius and shadow it had for the PNG.

### Removed
- `src/hosted/public/favicon.svg` (duplicate), `src-tauri/icons/android|ios` and the January `icon-1024.png` (unused).
- `public/og-mark-1200.png` → `docs/brand/` (unused once the wide card landed); `docs/brand/og-card-en-1200x630.png` added as a kit reference.

### Technical
- New tests: `brand-head.test.ts`, vite-config manifest + social preview suites, `BrandMark.test.tsx`, `themeColorMeta.test.tsx`, regression tests `SidebarNav.brand.test.tsx` and hosted `Brand.test.tsx` (R6). `src/test/pngSize.ts` and `src/test/osColorScheme.ts` test helpers.
- The vite web snapshot gains `mutaba3a:social-meta`; the portal Documents test now allows only the decorative mark as an image.
- TD-118 (manual Windows/pre-Tahoe/OG checks), TD-119 (icon pixels not machine-checked; Claude Design SVG exports drop `<style>`).

---

## [Unreleased] - 2026-10-13 — Privacy policy covers the iPhone and Android apps

**Why:** `/privacy` covered only the local-only Mac, Windows and browser apps, and said there was no account, no server and that data never leaves the device. None of that holds for the Flutter iPhone/Android apps (`mutaba3a-flutter`). They sign in with email and password against the hosted API (device sessions, MUT-64), store entries on Cloud Run/Cloud SQL (`me-west1`), upload receipts to a private GCS bucket, and keep a Drift cache plus an offline outbox on the phone. Facts were taken from that app's code and `server/infrastructure/terraform`. The apps have no analytics or crash SDKs, and no push or exchange-rate calls.

### Changed
- `landing.privacyPolicy.*` (en + ar): rewritten around the two ways the apps handle data. New sections: `mobile` (account, server storage, offline cache, sign-out behaviour), `sharing` (Google Cloud as the only processor, Malafat-linked profiles, no selling), `security` (argon2 hash, Keychain/EncryptedSharedPreferences, App Lock with on-device biometrics, no camera/contacts/location), and `mobileDeletion` (in-app per-entry delete; full account deletion by emailing info@malafat.app within 30 days; backups expire within 14 days). `scope`, `whatYouEnter`, `network` and `noTracking` now separate desktop/web from mobile and mention server request logs. The desktop/web `dataStorage` and `yourControl` sections now name their platforms.
- `PrivacyPolicyPage.tsx`: four new section keys, and the doc comment no longer says "no hosted product".

### Technical
- `PrivacyPolicyPage.test.tsx`: the "names no hosted product" assertion is replaced by tests for: the intro names all five platforms; a mobile section names the account and Google Cloud; the deletion section gives the contact address.
- Arabic keeps "Malafat" in Latin script, because "ملفات" already means business profiles in this UI.

---

## [Unreleased] - 2026-10-13 — fix flaky test timeouts that broke `make release full`'s web leg (TD-073)

**Why:** `make release full` deployed the API (commit `12492d5`, api v0.3.4) but `release-web`'s `npm run test:run` gate failed with 9 tests timing out at the 5 s default across `ConversionDrawer.test.tsx`, `ExpenseDrawer.oneTimeFields.test.tsx`, `visitorSample.test.ts`, `ProfileSwitcher.test.tsx` and `SavedFlashAnnouncer.test.tsx`. All 9 passed immediately in isolation — this is TD-073 (full-suite CPU contention on an 11-core machine against the 5 s default, logged 2026-10-12), not a product regression, and it blocked the web deploy before any version bump, commit or push (nothing shipped on the web side).

### Fixed
- Added `vi.setConfig({ testTimeout: 15_000 })` to the 5 affected test files, matching the existing `migration-mut*.test.ts` precedent (those use 60 s for DB `createdb`/`dropdb` round-trips; 15 s is proportionate for a Dexie round-trip + userEvent render).
- Verified with a clean, uncontended `npm run test:run`: 238 files, 3479 passed, 4 skipped, 0 failed (149 s). An earlier rerun showed 18 files / 50 tests failing, but that run had `npm run lint` running concurrently in the background — self-inflicted contention, not a real regression; discarded.
- `npm run typecheck` clean.

### Technical
- TD-073 updated with today's instance and partial fix; still open for `IncomeDrawer.test.tsx`, the `routes-m6` ordering race, and the general ceiling (a vitest `projects` config with a higher default timeout for component/demo tests would close this for good instead of patching file by file).

---

## [Unreleased] - 2026-10-13 — Hosted `/v1/conversions` API, server side of MUT-141/MUT-159 (MUT-161)

**Why:** MUT-141 made currency-conversion logging a local/offline-app-only feature (Dexie). Mobile (MUT-159) has no way to log one — conversions were the one kind with zero hosted API surface, while income/expenses already reach the hosted API from any client (device-session bearer, MUT-64).

### Added
- `POST /v1/conversions`, `GET /v1/conversions` (list), `GET /v1/conversions/{id}` — session/device-session only, create + read only (no PATCH/DELETE). Validates both legs' amounts (currency-aware precision), rejects future-dated `occurredOn` (ADR-038) and same-currency legs (422 `SAME_CURRENCY`, ported from the local app's `conversionFormSchema.ts`). `Idempotency-Key` support via the existing middleware.
- New `Conversion` Prisma model (own table, not a kind column — ADR-070), new `conversions` writability-matrix domain, new `conversions:read`/`conversions:write` scopes.
- New hosted portal UI: `/conversions` route, nav entry, `ConversionDrawer` (create-only, two amount/currency legs, implied rate), `ConversionsList`. Not a migration of the local app's `useConversionQueries.ts`/`ConversionDrawer.tsx` — those stay untouched (ADR-070).
- `server/openapi/openapi.yaml` and `src/hosted/api/schema.d.ts` regenerated; `API_VERSION` `1.19.0-mal1118` → `1.20.0-mut161`.

### Fixed
- This ticket's required OpenAPI/`schema.d.ts` regen exposed a dormant, unrelated `tsc` failure in `src/hosted/components/ExpenseDrawer.tsx` (JOD added to the server's `Currency` type since MUT-140, never caught because nothing had regenerated+typechecked the hosted schema since). Superseded same-day by `7428c63` ("hosted currency fix"), which gave `ExpenseDrawer` real JOD support (widened `CURRENCY_OPTIONS`, currency-aware decimal precision) rather than a type-only cast — this branch's own patch was dropped on rebase.

### Technical
- TD-117 recorded: hosted conversions still lack JOD support, now the one hold-out since `ExpenseDrawer` gained it independently the same day.
- Regression test proves a conversion never appears in `/v1/summaries/organization` or `/v1/summaries/expenses`.

**Run on this branch:** `npm run typecheck`, `npm run lint`, `npm run build` (root + `server/`) all clean; `npm run hosted:types:check` confirms no drift; server unit + Postgres contract suite (1763 tests) and hosted suite (170 tests) green mid-build.

---

## [Unreleased] - 2026-10-13 — npm audit: 27 findings → 0 with in-major bumps only (chore/npm-audit-2026-10-13)

**Why:** `npm ci` on main (9000d08) reported 27 vulnerabilities (1 low, 8 moderate, 17 high, 1 critical). All of them predate MUT-145. No major-version bump of a direct dependency was needed, so the release pipeline (`make`, `deploy.sh`, the Tauri build) absorbs nothing new.

### Technical
- Direct devDependencies, each bumped to the lowest patched version in its major: `vite` 7.3.0 → 7.3.6, `postcss` 8.5.6 → 8.5.23 (still an exact pin, per MUT-102), `nanoid` 5.1.6 → 5.1.16, `vitest` and `@vitest/coverage-v8` 4.1.0 → 4.1.11, `vite-plugin-pwa` 1.2.0 → 1.3.0.
- `vite-plugin-pwa` 1.3.0 pulls `workbox-build` 7.4.1, which moves its own tree to `@rollup/plugin-terser` 1.0 and `serialize-javascript` 7.1.2, and drops `lodash` and its private `rollup` 2. These are the only major moves in the lockfile, and all of them sit inside workbox's own dependencies. The service worker builds the same: 69 precache entries, the same `dist-web`/`dist-hosted` file sets as main.
- Critical `seroval` (via `@tanstack/react-router-devtools` → `router-core` and `solid-js`): refreshed to 1.6.8 inside the declared ranges, and `solid-js` 1.9.10 → 1.9.16 (the first line on `seroval ~1.6.8`). `@tanstack/react-router` stays at 1.144.0. Neither package reaches shipped JS, since the devtools are dropped from production builds, so the exposure was dev and build time only.
- Transitive refreshes, all within declared ranges: `rollup` 4.63.5, `ws` 8.22.0, `fast-uri` 3.1.8, `@babel/core` 7.29.7, `browserslist` 4.29.3, `ajv` 6.15.0, `flatted` 3.4.4, `picomatch` 4.0.7, `minimatch` 3.1.5, `brace-expansion` 1.1.21, `source-map-js` 1.2.2. The lockfile has 749 → 716 entries.
- No `overrides` were added.
- Resolution used `npm@11.6.2 … --before=2026-10-01`, so every resolved version is at least 12 days old. The one exception is `solid-js` 1.9.16 (2026-10-06): no older `solid-js` clears the critical. Reason for the cutoff: the unconstrained latest `rollup` (4.64.6) had been published only hours earlier.
- npm 11 was needed because `npm audit fix` and `npm install` crash on the repo's npm 10.9.8 (TD-114). The lockfile is still v3, and a clean `npm ci` on npm 10.9.8 installs from it and audits at 0.
- `rollup` ≥ 4.63.0 adds an optional, Linux-x64-only `@napi-rs/lzma-linux-x64-gnu` (upstream since 2026-08-25). It is in the lockfile, but nothing installs it on macOS or Windows.
- Deferred: `server/` (its own lockfile) has 3 highs from `deepmerge-ts` via Prisma's `@prisma/config`; the only offered fix is a forced Prisma downgrade (TD-115).

**Run on this branch (Node 22.23.1):**
- `npm audit` 0 vulnerabilities (was 27);
- `npm run typecheck` clean; `npm run lint` 0 errors, 5 warnings (the known 5);
- `npx vitest run`: 233 files passed, 3,424 tests passed, 4 skipped;
- `npm run build` and `npm run build:hosted` built. Both print the `Unexpected "@media"` CSS warning and the chunk-size warning, and so does main.
- **Not run:** `npm run build:desktop` / the Tauri bundle, `npm run test:bundles`, QA specs, `npm --prefix server test` (server untouched).

---

## [Unreleased] - 2026-10-13 — Retire document/invoice generation; a ledger-shaped profile; profile import works again (MUT-145, MUT-158)

**Why:** Mutaba3a records what happened (income, expenses, who owes what) and does not issue documents. MUT-2 had gated invoices behind the `invoices` area; MUT-145 removes the feature (ADR-067). Filed receipts and the hosted portal's attachments are a different feature and are untouched.

### Removed
- Document generation: `src/features/documents`, `src/pages/documents`, `DocumentDrawer`, `PdfDownloadChoiceModal`, `DocumentIcon`, `paymentRequestService`, `pdfArchival`, `documentRepo`/`documentSequenceRepo` and their hooks, the document drawer store, demo documents, `@react-pdf/renderer`, and `public/fonts/` (4.3 MB of PDF-only TTFs). The `invoices` optional area and the client-row invoice actions are gone.
- Unrouted dead code: `TransactionsPage` (`/transactions` → `/income`) and `ImportDataModal` (never rendered).
- `ProfileDetailPage`: profiles are edited in `BusinessProfileDrawer` only.
- From `BusinessProfile`: `businessType`, `defaultLanguage`, `website`, template/VAT/allowed-currency defaults, bank/payment details, and the 8 letterhead-only fields. Old rows keep the values; nothing reads them.
- 111 lines of document CSS and 16 document-only i18n keys (en and ar).

### Changed
- No entry is ever locked: the transaction lock guards, `isLocked`, `TransactionLockedError` and the income drawer's locked notice are gone. Legacy-locked entries are editable, and no rows are rewritten.
- `/documents`, `/documents/*` and `/settings/profiles/:id` redirect to Home and Settings.
- `BusinessProfileDrawer` is grouped Identity / Money / Contact (optional). "Document Currency" became "Default currency". Email is optional. Labels are wired to their inputs.
- Copy no longer claims document generation: the Settings empty state, the Data export descriptions, the welcome bullet, the Insights "Entries" column, the landing FAQ and the privacy policy ("receipts you attach").
- A stored feature notice keeps only live areas, so a retired `invoices` key never shows as a raw i18n key.

### Fixed
- **qa-reconcile review fixes (2026-10-13):**
  - F1: a merged project is reused only when its name **and** its client match, so a same-name project under another client is never shared.
  - F5 (pre-existing data loss): choosing a full Data-tools backup on Settings → Import cleared the database and restored nothing. It's now refused with a pointer to Data tools → Restore, and the legacy path never clears for a file with no rows.
  - F3: export now includes archived clients and projects, so their entries stay linked after an import.
  - F2 (re-import duplicates) and F4 (archived profile match) are deferred to TD-111.
- **MUT-158:** Settings → Import ignored v2 profile exports and still said "Import Complete!". The new `src/db/profileImport.ts` imports as a new profile or merges into one, re-mints IDs and remaps every reference. Duplicates are matched inside the target profile only, and email-less profiles never match each other. The page gained the create/merge choice.

### Technical
- Tables retained (ADR-029): `documents`/`documentSequences` at v21, typed by `src/db/retained/documentSchema.ts`. Guards: `noDeadDocumentModules.test.ts`, `retainedDocumentSchema.test.ts`.
- New ADR-067 (renumbered on merge: MAL-1118 took ADR-066). ADR-014 superseded; ADR-030 §2 moot; ADR-032 narrowed to five areas. TD-024, TD-025 and TD-109 resolved; TD-110 and TD-111 added; TODOS #9 (Tauri fs permission).
- `brand.test.ts`'s dead-token ratchet dropped `--color-error`/`--color-muted` (only the deleted modal used them).

**Files:** see `git log pre-mut-145..feat/mut-145-remove-documents`.

---

## [Unreleased] - 2026-10-13 — MUT-141: log currency conversion events

**Why:** Freelancers holding multiple currencies periodically convert money between them; until now that movement either went unrecorded or got miscategorized as a fake expense/income, corrupting P&L. Blocked by MUT-140 (per-currency decimal precision, merged). Two findings reshaped the ticket's own premise mid-build: the "excluded from P&L by construction" claim was false until the aggregation branches were tightened, and the "Transactions ledger" the ticket assumed exists is dead code — see ADR-068.

**Run (Node 22):** `npm run lint` 0 errors (13 pre-existing warnings, unrelated), `npm run typecheck` clean, `npm run build` succeeded, full `npm run test:run` 3,536 passed / 4 skipped (after the qa-reconcile fix below).

### Added
- New Transaction `kind: 'conversion'`, with `toCurrency`/`toAmountMinor` for the destination leg (`currency`/`amountMinor` stay the source leg). No Dexie migration — both are additive, unindexed.
- `ConversionDrawer.tsx` (third sibling alongside `IncomeDrawer`/`ExpenseDrawer`): two independent amount/currency fields, each validated at its own currency's decimal precision; read-only implied rate; always `status: 'paid'`.
- New dedicated `/conversions` page (`ConversionsPage.tsx`), gated by a new `'conversions'` feature flag (7th optional area, `FEATURE_DATA_PROBES.conversions: []` — never auto-enabled by data, a brand-new kind has none to detect). Wired into both Add menus and the sidebar nav.
- `useConversionQueries.ts`: `useConversions`/`useConversionById`/`useCreateConversion`/`useUpdateConversion`/`useDeleteConversion`, wrapping the existing generic `transactionRepo` — no repository changes needed.
- CSV export/import/validation: `toCurrency`/`toAmount` columns, `validateConversion`, a conversion row in the import template; wired into the live `ImportDataPage.tsx` only (`ImportDataModal.tsx` is dead code, not touched).

### Changed
- `src/db/aggregations.ts` (3 functions) and `src/lib/aggregations.ts` (2 functions): tightened bare `else { expensesMinor += ... }` branches to `else if (kind === 'expense')`, so a conversion row contributes to neither income nor expense totals anywhere in the app. Additive — no existing income/expense call site's behavior changes.
- `src/pages/insights/InsightsPage.tsx`: same tightening applied to its own independent `summaryTotals` calculation, found by `/qa-reconcile` re-sweeping every `kind === 'income'` call site in the repo — this page doesn't route through the shared `aggregations.ts` module, so the first pass missed it. Without this fix a logged conversion inflated the Insights page's Expenses KPI by its full amount (`/reports` has the identical duplicate logic but is unreachable dead code — `/reports` redirects to `/insights` — and was left untouched).

### Technical
- ADR-068 records both architecture decisions above (the aggregation fix's shape, and the new-page-plus-feature-flag UI choice) and the alternatives considered. **Renumbered on merge: this branch's ADR-067 → ADR-068, TD-110 → TD-112, TD-111 → TD-113** — MUT-145 (merged to main first) independently claimed ADR-067 and TD-110/TD-111 for unrelated content; see its entry above.
- TD-112 (new): `ImportDataPage.tsx`'s pre-existing income/expense import loops still hardcode base-100 parsing (predates MUT-140); the new conversion branch does not repeat this, flagged rather than fixed (unrelated scope).
- TD-113 (new): `ImportDataPage.tsx` has no render/integration test at all (pre-existing); the new conversion branch inherits that gap, covered only indirectly.

---

## [Unreleased] - 2026-10-13 — MAL-1118: personal profiles seed a household expense-category preset

**Why:** MUT-143 adds expense categories to personal profiles in the iPhone app, and a person's own profile was being seeded the general business list (Office Rent, Bank Fees, Salaries). Since MUT-120 "no Malafat writer" covers both a person's own profile and a firm with no Malafat link, so the new preset keys on `personalOwnerUserId` (ADR-066).

**Run (Node 22):** server `npm run lint` clean, `npm run typecheck` clean, `npm test` 1,575 passed / 18 skipped (DB-only suites; no local `DATABASE_URL`), `openapi:check` up to date; root `npm run typecheck` clean, `npm run test:run` 3,477 passed / 4 skipped, `hosted:types:check` in sync.

### Added
- `server/src/expenses/presets.ts`: `PERSONAL_PRESET` — Transportation, Car, Rent, Groceries, Supplies, Gifts, Investments, Projects, Leisure, Other, in en/ar. Server-only; the offline app has no personal profile.

### Changed
- `presetFor` takes `{ writerOfRecord, personal }`: law-firm for a Malafat-fed profile, personal for a person's own profile, general for any other firm (unchanged for firms). The first `GET /v1/expense-categories` passes `organization.personalOwnerUserId !== null`; the seed audit row can now say `preset: 'personal'`.
- `ProfileWriter` doc comment (`server/src/auth/writability.ts`) separates MUT-65's "personal" (no Malafat writer) from MUT-120's own profile.
- API 1.19.0-mal1118: route description only; `server/openapi/openapi.yaml` and `src/hosted/api/schema.d.ts` regenerated.

### Tests
- `presets.test.ts`: `presetFor` for all three profile kinds, including Malafat winning over the personal mark; the personal preset's order, Other last, translations and hex colours; every preset's names distinct under `categoryNameKey` (Postgres seeds with `skipDuplicates`, so a clash would drop a category silently). Mutation-checked: a `'rent '` entry and a swapped selector each turn the suite red.
- `routes-expenses.test.ts`: the old "general preset on a personal profile" test ran on an unconnected firm — renamed to say so and now checks the audit row (the paging test's title had the same mislabel and is renamed too); new English and Arabic tests seed a real personal profile (via `/admin/v1/users`' `personalProfile.id`) once, as SYSTEM, with `{ preset: 'personal', count: 10, locale }`.

---


## [Unreleased] - 2026-10-13 — Merge MUT-140 into main: renumbering and a JOD/MUT-94 semantic fix

**Renumbered on merge:** MUT-140's ADR-062 → **ADR-065** and TD-105 → **TD-109**. Main already used both numbers (MUT-94 expense totals; seed-demo re-run).
**Fixed (merge-time semantic conflict):** MUT-94 added two `Record<Currency, number>` literals with only USD/ILS/EUR after MUT-140 branched (`db/aggregations.ts` `sumExpensesByCurrency`, `ExpensesLedgerPage` strip totals). With JOD in the union, the build broke. Worse, `getOverviewTotals` would have added `undefined` to the JOD bucket's `expensesMinor` and shown NaN, and JOD expenses would have been dropped from the sum. Both literals now carry `JOD: 0`, and `aggregations.test.ts` pins the JOD bucket.
**Fixed (MUT-140 branch, before merge):** `paymentEntry.test.ts` called `minorToAmountInput` without the currency that ADR-065 made required, and got `'NaN.NaN'`. tsconfig.app excludes tests, so typecheck could not see it. A JOD (exponent 3) case was added.
**Verified on the merged tree (Node 22):** typecheck clean; lint 0 errors; db, expenses, drawers, utils and paymentEntry suites green. The full suite ran on the branch: 229/230 files, the one failure being the test fixed above.

## [Unreleased] - 2026-10-13 — Add JOD as a supported currency for income and expense entry (MUT-140)

**Why:** JOD is a 3-decimal currency (fils), unlike USD/ILS/EUR here (all 2-decimal). The sister Flutter app hit this exact issue: shipped JOD at 2 decimals first (MUT-72), then needed a dedicated follow-up (MUT-119) to rework its money codec because the 2-decimal assumption was baked into shared formatting code. This repo had the identical risk shape — `src/lib/utils.ts`'s formatAmount/parseAmountInput/parseAmountToMinor/parseCurrencyInput hardcoded `/100` and 2 decimals globally, as did several independent duplicate formatters found during the audit (DocumentPdf.tsx, DocumentDrawer.tsx, recurringAttention.ts, paymentEntry.ts).

**Run on this branch (Node 22):** `npm run typecheck` clean, `npm run lint` clean (0 errors; 12 pre-existing warnings unrelated to this change), `npm run build` succeeds. Targeted `vitest run` on every changed test file green (250 tests); the full suite was not re-run this session per explicit instruction — land with a full `npm test` pass before merge.

### Added
- `'JOD'` added to `Currency` (`src/types/index.ts`) and `SUPPORTED_CURRENCIES`/`EXPONENT` (`server/src/money.ts`, already per-currency-aware).
- `currencyExponent()` exported from `src/lib/utils.ts` — the single source for "how many decimal places does this currency carry" (2, or 3 for JOD), reused by `csv.ts`, `DocumentDrawer.tsx`, `recurringAttention.ts`, `paymentEntry.ts` instead of each re-deriving it.
- JOD selectable directly in `IncomeDrawer`/`ExpenseDrawer` (no Settings precondition — matches how EUR already behaves; the Settings "enabled currencies" toggle and per-profile `allowedCurrencies` don't actually gate these dropdowns today).

### Changed
- `parseAmountInput`/`parseAmountToMinor`/`parseCurrencyInput` (`src/lib/utils.ts`): `currency` is now a **required** parameter (no default) — a future JOD call site fails to compile instead of silently rounding to 2 decimals. Every caller updated: `IncomeDrawer`, `ExpenseDrawer`, `RetainerDrawer`, `PlanAssumptionDrawer`, `recurringAttention.ts`, `paymentEntry.ts`.
- `IncomeDrawer`'s amount validation moved from chained `z.string().refine()` to a schema-level `superRefine`, since decimal-precision validity is now currency-dependent (can't be checked on the `amount` field alone without seeing the sibling `currency` field). Schema extracted to `incomeFormSchema.ts` for direct testability and to keep the drawer file component-only (Vite fast-refresh).
- `ExpenseFormFields`'s generic type constraint (shared with the hosted portal's own expense drawer) decoupled from `expenseFormFieldsSchema` so local's wider currency union type-checks without widening the portal's actual runtime validation schema, which has its own hardcoded 2-decimal regex and is out of this ticket's scope.
- Overview/Clients/Projects aggregation totals (`lib/aggregations.ts`, `db/aggregations.ts`) and the landing page's currency FAQ (`landingCopy.ts`) updated for JOD — each an exhaustive `Record<Currency, ...>` that the type widening forced a real decision on, not a mechanical type fix.

### Fixed
- Three real "amount 10x too large" bugs found auditing every hardcoded `/100` conversion in the codebase: `IncomeDrawer`/`ExpenseDrawer`'s edit/duplicate reset handlers, `csv.ts`'s CSV export, and `DocumentDrawer.tsx`'s own independent `formatMinorAmount` — all bypassed the (now currency-aware) shared formatter.
- (qa-reconcile gap) `ExpenseDrawer`'s amount field never validated decimal precision for any currency — only checked non-empty. A USD expense typed with a 3rd decimal silently rounded via `parseAmountToMinor`'s lenient path instead of being rejected. Added the same amount/currency `superRefine` cross-field check `IncomeDrawer` already has; schema extracted to `expenseDrawerFormSchema.ts` (same fast-refresh/testability reasoning as `incomeFormSchema.ts`). `ExpenseDrawer.schema.test.ts` is this drawer's first test file.

### Technical
- Document/invoice generation (`DocumentFormPage.tsx`, `DocumentDrawer.tsx`) was briefly widened to accept JOD, then reverted: the feature is being removed entirely (MUT-145, product direction is digital-ledger-only), so investing JOD support there was pointless. The narrow-cast fixes needed to keep those files type-safe under the now-wider global `Currency` stayed, since that's unavoidable regardless of documents' fate.
- See `.claude/designs/mut-140-jod-currency.md` for the full engineering plan and plan-review findings.

---

## [Unreleased] - 2026-10-13 — CSV-imported expenses land in db.expenses, not db.transactions (MUT-138)

**Why:** Since MUT-14, real expenses live in `db.expenses` only, but `ImportDataModal.tsx`/`ImportDataPage.tsx` still wrote CSV-imported expense rows as `kind:'expense'` transactions into `db.transactions`, so they never appeared on `/expenses`. Separately, `ProjectDetailPage.tsx`'s row-click handler for a legacy `kind:'expense'` row opened `ExpenseDrawer` with the transaction's id, which `ExpenseDrawer` then looked up in `db.expenses` and found nothing. Found during MUT-94's review, tracked as TD-106.

**Run (Node 22, on the merged tree):** `npm run typecheck` clean (both `tsconfig.app.json` and `tsconfig.hosted.json`), `npm run lint` clean, `npm run build`/`build:hosted` clean, `npx vitest run` green — see this merge's own verification note below.

### Added
- `src/utils/csvImport.ts`: `importExpenseRow()` (writes via `expenseRepo.create`, resolves categories against `db.expenseCategories`) and `resolveImportProfileId()` (auto-creates a default profile, mirroring `WelcomeModal`'s "Skip" shape, only when none exists).
- `src/components/drawers/LegacyExpenseEditDrawer.tsx` + `legacyExpenseDrawer` store slot (`openLegacyExpenseDrawer`/`closeLegacyExpenseDrawer`): edits a pre-existing `kind:'expense'` transaction row without risking `IncomeDrawer`'s hardcoded `kind:'income'` save path.

### Changed
- `ImportDataPage.tsx`: CSV import resolves one `profileId` per run and threads it through every entity created (clients, projects, income, expenses) — the profile selector already required a choice, but no entity type had used the selection, so an imported expense could end up visible while its sibling client/project/income from the same import silently dropped out of any profile-scoped view.
- `ProjectDetailPage.tsx`: a `kind:'expense'` row click now opens `LegacyExpenseEditDrawer`, not `ExpenseDrawer`.

### Fixed
- Imported CSV expenses now appear on `/expenses` immediately, with category/client/project wiring.
- A pre-existing legacy expense row opened from a project's transactions tab now loads and saves correctly instead of opening blank.
- (merge with MUT-145/MUT-141) `LegacyExpenseEditDrawer`'s amount-to-input prefill hardcoded `/100`, wrong for a 3-decimal JOD row; now uses `currencyExponent(currency)`. `ExpenseFormFields.tsx` (shared with the hosted portal) hardcoded the amount input's `step="0.01"`, which silently blocked saving any 3-decimal JOD amount in both this drawer and the real `ExpenseDrawer` — a step mismatch fails the browser's native HTML5 constraint check before the submit event fires at all. Step is now computed from the current currency.

### Not changed (intentionally)
- `TransactionsPage.tsx` had the identical row-click bug but was dead code (`/transactions` redirected to `/income`) — left unfixed; MUT-145 (merged the same day, see above) deleted it along with the also-dead `ImportDataModal.tsx` outright.
- `src/demo/seedData/transactions.ts` still writes `kind:'expense'` transactions — explicitly out of scope per the ticket (dev/demo-only).
- `ImportDataPage.tsx`'s own income/expense CSV loops still hardcode base-100 amount parsing, wrong for JOD — pre-existing, tracked separately as TD-112 (filed during MUT-141's build); not fixed here.

### Tests
- `src/utils/__tests__/csvImport.test.ts`: `importExpenseRow`/`resolveImportProfileId` unit coverage.
- `src/pages/settings/__tests__/ImportDataPage.test.tsx`: end-to-end CSV expense import (merged into MUT-145's ported suite for the one live import page).
- `src/components/drawers/__tests__/LegacyExpenseEditDrawer.test.tsx`: load/save/delete, kind preserved, no-category save, deleted-client/project reference doesn't crash, JOD load/save at 3-decimal precision.
- `src/pages/projects/__tests__/ProjectDetailPage.test.tsx`: row click and title click route to the legacy drawer, not `ExpenseDrawer`.

---
## [Unreleased] - 2026-10-13 — Seed script can keep a store-review account's password

**Why:** Basel needs a populated hosted account for App Store / Play reviewers. `seed:demo-account` already builds one, but it rotated the password on every run — which also revokes every session — so re-seeding the reviewer account would break the credentials entered in App Store Connect and Play Console and fail a review in progress.

**Run (Node 22):** `npm run typecheck` clean, `npm run lint` clean, `npm test` 1,571 passed / 18 skipped (DB-only suites; no local `DATABASE_URL`).

### Changed
- `server/src/scripts/seed-demo-account/adminAccount.ts`: `ensureSeedAccount` takes `keepPassword`; for an existing account it uses that password instead of rotating and returns `rotated: false`. A new account still gets an issued password (the admin API can't set a chosen one).
- `server/src/scripts/seed-demo-account.ts`: reads `MUTABA3A_SEED_PASSWORD`; when it's kept, the password isn't printed, and a wrong one fails with a message naming the variable instead of a raw 401.
- `server/README.md`: store-review account runbook.

### Tests
- `adminAccount.test.ts`: kept password still signs in and an existing session survives; a new account ignores `keepPassword`.
- `seed-demo-account.test.ts`: re-seed with `MUTABA3A_SEED_PASSWORD` doesn't print or change it; a wrong one fails clearly and leaves the issued password working.

---

## [Unreleased] - 2026-10-13 — Brand v2 dropdown sweep: every select now uses the real Select component

**Why:** User reported dropdowns/selectors hadn't been customized for the Brand v2 design system. Investigation found a brand-correct `Select` component already existed (`src/components/ui/Input.tsx` + `Input.css` — `--input-*` tokens, 16px body text, custom chevron) but was wired up only on the dev-only `/theme-demo` route; every real dropdown in the app (69 occurrences across 25 files) rendered a raw `<select className="select">` styled by a stale pre-brand rule in `index.css` (13px text, default browser arrow, generic `--surface`/`--border` tokens instead of the dedicated `--input-*` ones). Two page-specific classes (`PlanningPage.css`'s `.plan-select`, used once; `RetainersPage.css`'s `.filter-select`, used 3x) additionally referenced CSS variables (`--border-color`, `--bg-primary`) that don't exist anywhere in the codebase (tracked dead in `brand.test.ts`'s `KNOWN_DEAD_REFERENCES`, part of TD-079/MUT-103's backlog) and so rendered with no styling at all. User chose the full migration over a CSS-only patch.

**Run on this branch (Node 22):** `npm run typecheck` clean (both `tsconfig.app.json` and `tsconfig.hosted.json`), `eslint src` — same 12 pre-existing warnings as `main`, 0 errors, `npm run build` clean, `vitest run` — 3453 passed / 4 skipped across 229 files (includes 150 brand/CSS token tests).

### Changed
- Migrated every raw `<select>` in `src/` (drawers, pages, filters, modals, the hosted portal) to `<Select>` from `src/components/ui/Input.tsx`. Each call site dropped its `className="select"`/`style={{ width: '100%' }}` (the component supplies both) and kept every other prop (`value`, `onChange`, `{...field}`, `id`, `disabled`, `aria-label`, …) unchanged; no `<option>` children or surrounding `<label>`/error markup were touched.
- `Select` gained an `invalid?: boolean` prop — a style-only error border with no rendered message — for the 4 files (`ExpenseDrawer.tsx`, `IncomeDrawer.tsx`, `RetainerDrawer.tsx`, `ExpenseFormFields.tsx`) that already render their own `<p className="form-error">` next to the field via `react-hook-form`; these previously toggled the border with `cn('select', errors.x && 'input-error')`.
- `.claude/COMPONENT_REGISTRY.md`'s `Select` entry corrected: real location (`Input.tsx`, not a nonexistent `Select.tsx`), real API (`children`, not an `options` array), documents `invalid`.

### Removed
- Stale `.select`/`.select:hover` rule in `src/index.css` (pre-Brand-v2: `--text-sm`, generic `--surface`/`--border`, no focus state, no custom chevron) — nothing references it anymore now that every call site renders through the component.
- `.plan-select` (`PlanningPage.css`) and `.filter-select` (`RetainersPage.css`) — both redundant with (or, for `.plan-select`, entirely broken due to dead vars under) the component's own styling.

### Fixed
- `src/hosted/components/FilterControls.tsx` and the local/hosted-shared `src/components/expenses/ExpenseFormFields.tsx` were initially migrated to import `Select` from the `components/ui` barrel (`'../ui'`/`'../../components/ui'`); the barrel re-exports `ProfileQuickPicker`, which transitively imports the app-only `useActiveProfile` hook, which reads `router.tsx`'s `staticData.owedLens` route field via global module augmentation — `tsconfig.hosted.json` deliberately excludes `router.tsx` (hosted has its own routing), so this broke `npm run build`'s `tsc -b` with `Property 'owedLens' does not exist on type 'StaticDataRouteOption'` in `useActiveProfile.ts`. Fixed by importing from the concrete file (`'../ui/Input'` / `'../../components/ui/Input'`) instead, matching how hosted already imports `Button`. Documented as a reusable gotcha in `PATTERNS.md`'s new "Pattern: Select Styling" section.

### Technical
- `.claude/TECH_DEBT.md` TD-079 updated: the dropdown/select portion of Brand v2's component sweep is done; the rest of TD-079 (legacy size/radius aliases, duplicate layout tokens, amount-mono gaps, colour literals, etc.) is unchanged and still open for MUT-103.

---

## [Unreleased] - 2026-10-13 — Privacy policy page for the landing site

**Why:** Basel needed a public privacy-policy link to submit for app distribution. Scoped to exactly what the landing page offers (Mac, Windows, browser — no hosted product, no server change): local-first storage, the two outbound requests the app actually makes (Frankfurter FX rates, GitHub release checks), no accounts/analytics/tracking. Contact: info@malafat.app, Barmajiyat Ltd.

**Run on this branch (Node 22):** `eslint` on touched files clean, `tsc --noEmit` clean, `npm run build:web` clean (new `PrivacyPolicyPage` chunk), `vitest run` on landing tests (23 passed).

### Added
- `src/pages/landing/PrivacyPolicyPage.tsx` + `PrivacyPolicyPage.css`: reuses `LandingHeader`/`LandingFooter` and `LandingPage.css`'s container/section tokens. Served client-side only at `/privacy` (web build), wired in `src/main.tsx` the same way as `/download` — no router, no server route, no `_redirects`/`netlify.toml` change needed (the existing `/* → /index.html` SPA fallback already covers it).
- `landing.privacyPolicy.*` keys in `en.json`/`ar.json` (title, intro, nine sections, back link).
- Footer "Privacy" link (`landing.footer.privacy` — already translated, previously unused) now points to `/privacy`.
- `src/pages/landing/__tests__/PrivacyPolicyPage.test.tsx`: renders the heading/footer, no raw i18n keys, RTL in Arabic, names no hosted product.

---

## [Unreleased] - 2026-10-13 — Settings visual redesign (MUT-139 follow-up, ADR-064)

**Why:** After the IA reorg below, every section was still a flat bordered-title block with no material hierarchy. Basel asked for a visual pass applying the app's existing Brand v2 tokens, then asked to tighten it twice (merge Preferences+Currency into one card; cut every new subtitle to a fragment). Verified against a real Playwright screenshot in both themes, which caught two defects the wireframe alone couldn't show.

**Run on this branch (Node 22):** `npm run lint` 0 errors, `npm run typecheck` clean, `npm run test` settings-scoped suites green (full suite was last run clean at 3470/3474 before this commit's final two CSS/JSX tweaks, which only touched class names and a margin rule). Verified live in a browser (light + dark) via Playwright.

### Added
- `SegmentedControl` (`src/components/ui/SegmentedControl.tsx`) — single-select radiogroup with a sliding thumb, used for Language and Theme. First real consumer of the `--ease-spring`/`--duration-toggle` brand tokens.
- `settings.preferences.title`/`description` i18n keys (en + ar); `settings.profile.description`, `settings.data.description`.

### Changed
- Every `.settings-section` now has real card chrome (surface/border/shadow/radius) instead of a bare bottom-border title.
- Language + Theme + Currency merged into one "Preferences" card (further than the IA pass's reorder) — the "Currency" group inside is a plain-text divider, never a heading.
- `DataToolsSection` moves inside the `page-content` width cap and is wrapped with Data in a new `.settings-family` div — reverses one ADR-063 decision (confirmed with Basel first) after a real screenshot showed the tint alone didn't read as nested.
- Enabled-currencies toggle pills use a soft `accent-subtle` fill instead of solid `btn-primary` — a screenshot showed the solid fill read as too loud next to the segmented controls in the same card.
- Business Profiles list reuses `ProfileBadge` (already used by `ProfileSwitcher`) as the no-logo avatar fallback.

## [Unreleased] - 2026-10-13 — Settings IA reorg (MUT-139)

**Why:** `/settings` grew section-by-section with no IA pass: Theme was briefly suspected to be a duplicate control (investigation found it's an intentional shared-state pattern, MUT-79 — no change made), "Enabled currencies" was commented-out dead code since the initial commit, Data/Data Tools and About/Updates/Desktop App read as fragmented, and "Default Currency"/"Default Language" collided between the global Settings page and two per-profile forms. Design brief: `.claude/designs/settings-ia-reorg.md`.

**Run on this branch (Node 22):** `npm run lint` 0 errors (12 pre-existing warnings, none introduced), `npm run typecheck` clean, `npm run test` 229 files / 3461 passed / 4 skipped, `npm run build` clean.

### Added
- `AboutSection.tsx` — merges the former About/Updates/Desktop App sections under one heading (no h3 subheadings allowed, per `SettingsPage.a11y.test.tsx`); `useCheckForUpdates()` moved in.
- Enabled-currencies toggle restored in `SettingsPage.tsx` (USD/ILS) — i18n keys already existed in both languages, the code was just never uncommented.
- TD-107 (EUR has no toggle control), TD-108 (`/settings/import` doesn't use the shared `TopBar`/breadcrumb pattern) logged in `TECH_DEBT.md`.

### Changed
- `SettingsPage.tsx` section order: Business Profiles → Language → Theme → Currency → Advanced Features → About → Data → Data Tools. Business Profiles moves to the top (everything else is profile-scoped); Data and Data Tools become the last two sections so their proximity costs zero visual change (About gives up the conventional bottom slot instead).
- "Default Currency"/"Default Language" renamed to "Document Currency"/"Document Language" in `ProfileDetailPage.tsx`'s Document Defaults tab and `BusinessProfileDrawer.tsx`, to disambiguate from the global Settings page's identically-named fields (different scope: per-profile document generation vs. interface locale/display currency).

### Technical
- `DataToolsSection` deliberately NOT merged into "Data" — it has its own standalone test asserting its own heading; proximity achieved via page order only, not a header merge.

---

## [Unreleased] - 2026-10-13 — Backfill personal profiles for users provisioned before MUT-120

**Why:** MUT-120 shipped with **no backfill** (ADR-037 amendment: "There were no existing users at the time"). One user has since been provisioned in production without a personal profile, so `/v1/me` lists no `isPersonalDefault` profile for them and the capture app (MUT-121) falls back to Unsorted.

**Run on this branch (Node 22):** `npm run typecheck` clean, eslint on touched files clean, `npm run build` clean, `npm run test:db` 95 files / 1,671 passed.

### Added
- `backfillPersonalProfiles(db)` in `server/src/scripts/post-roll.ts`, run by `npm run post-roll` and so by `deploy.sh` step 6 on every deploy. For each user with no personal profile it creates one exactly as `POST /admin/v1/users` does: named `Personal`/`شخصي` by locale, `personal-<uuid>` slug, currency and timezone from the user's oldest firm, plus the membership. All of this runs in one transaction with two `SYSTEM` audit rows (`organization.created` with `backfill: 'post-roll'`, and `membership.granted`). It is idempotent. A concurrent create loses on the unique `personalOwnerUserId` index and is skipped. Users with no firm (`NO_FIRM`) or a non-IANA firm zone (`INVALID_TIMEZONE`, TD-091) are skipped and printed for hand provisioning.

### Technical
- `PERSONAL_PROFILE_NAME`/`personalProfileFor` moved from `routes/admin-users.ts` to `server/src/personal-profile.ts`, shared by the route and the backfill.
- `server/src/scripts/__tests__/post-roll.test.ts`: three DB cases (legacy `ar` user backfilled from the firm with audit, then a no-op the second run; a current user left alone; a firmless legacy user skipped `NO_FIRM`).
- `server/DEPLOYMENT.md` step 7 now lists the backfill's output.

---

## [Unreleased] - 2026-10-13 — Demo-account seed script for App Store screenshots (MUT-136)

**Why:** The Flutter iOS app (`mutaba3a-flutter`, MUT-137) needs a hosted account that looks populated before it can capture App Store screenshots. `server/` had no demo-data seeding at all — accounts are only operator-provisioned via `provision:user` and start empty — and the web frontend's existing `demo_` seeder (`src/demo/`) only writes to browser IndexedDB, never the Postgres-backed API a native app actually consumes. Discovered along the way: every mutating `/v1/*` route this needed (customers, projects, income, expenses, receivables settle) already requires an `Idempotency-Key` and replays the exact prior response for a matching key+body (`idempotency.ts`), so the script needs no separate list-and-check-by-name logic — it just always POSTs with a deterministic key and lets the server's own idempotency ledger dedupe.

**Run on this branch (Node 22):** `npm run typecheck` clean, `npm run lint` clean, `npm run build` clean, `npm test` (vitest run) 1,566 passed / 18 skipped (one pre-existing, unrelated intermittent flake in `routes-m6.test.ts`'s audit-pagination test, reproduced independently on `main`).

### Added
- `server/src/scripts/seed-demo-account.ts` + `seed-demo-account/{adminAccount,apiClient,fixtures}.ts` (`npm run seed:demo-account`): get-or-create a local `qa@mutaba3a.test` personal profile, rotate its password every run, then seed 8 clients/projects with a realistic spread of received/overdue/upcoming/part-paid/settled income and expenses, all dated relative to "now" (never future, ADR-038).
- README section documenting the script next to `provision:user`/`rotate:password`.

### Technical
- `server/src/scripts/users.ts`: exported `adminClient`/`AdminClient`/`UserSummary`/`CliError` so the seed script can reuse the existing admin-API get-or-create pattern instead of duplicating it. No behavior change (existing `users-cli.test.ts` unaffected).

---


## [Unreleased] - 2026-10-13 — Remove the dead mark-paid income hooks (MUT-98)

**Why:** `useMarkIncomePaid` and `useRecordIncomePartialPayment` (`useIncomeQueries.ts`) were exported and documented but had no caller outside tests -- every live "mark paid" path has gone through `PartialPaymentDrawer` → `useCreatePaymentRecord` since MUT-18/ADR-038 and MUT-86. A second, undocumented-as-dead way to mark income paid (writing `status`/`paidAt` via `transactionRepo.markPaid` directly, bypassing payment records) is exactly the split ADR-039 exists to prevent -- the risk was the next contributor finding a documented hook and wiring it back up.

**Run on this branch (Node 22):** `npm run typecheck` clean, `npm run lint` clean, `npm test` (vitest run) 3,430 passed / 4 skipped.

### Removed
- `useMarkIncomePaid`, `useRecordIncomePartialPayment` (`src/hooks/useIncomeQueries.ts`).
- The doc references to `useMarkIncomePaid` in `useQueries.ts` (the `useTransactions` JSDoc bullet, and `useMarkTransactionPaid`'s `@deprecated` notice -- now points at `PartialPaymentDrawer`/`useCreatePaymentRecord` instead of a hook that no longer exists).
- Three stale test mocks (`ClientDetailPage.test.tsx`, `IncomePage.test.tsx`, `ProjectDetailPage.test.tsx`) -- none of the three components actually called the hook; all three already mark paid through `openPartialPaymentDrawer`.
- The dedicated `useMarkIncomePaid`/`useRecordIncomePartialPayment` test suite in `useIncomeQueries.test.tsx` (not named in the ticket, but it directly imported and exercised both deleted symbols) and the one `useMarkIncomePaid invalidates paymentRecords` case in the "income writes refresh the payment lists" block.
- `transactionRepo.markPaid` is unchanged -- still reachable, still covered by its own repository tests (`transactionRepo.test.ts`, `paymentRecords.test.ts`, `partialPayment.test.ts`).

---

## [Unreleased] - 2026-10-13 — Hosted portal: correct the read-only income copy for personal profiles after MUT-65 (MUT-93)

**Why:** `hosted-portal.md` §7.4 and `hosted.readOnly.none` hard-coded "Income isn't recorded on hosted profiles yet" for any profile Malafat doesn't feed. MUT-65 shipped income capture for the signed-in user's own personal profile via the phone app, making that sentence false for exactly that profile. Flagged (not built) in MUT-65's design doc §9, filed as this ticket. **Copy only** (Basel, 2026-10-13): the portal stays read-only-by-design; unsuppressing "Record payment"/edit affordances for a personal profile is a separate follow-up (MUT-133).

**Run on this branch (Node 22):** `npm run typecheck` clean, `npm run lint` clean, `npm test` (vitest run) 3,434 passed / 4 skipped.

### Added
- `hosted.readOnly.personal` (en/ar): shown on a personal profile instead of the old "isn't recorded yet" copy.

### Fixed
- `ReadOnlyNotice` now checks `profile.isPersonalDefault` **before** its `access.payments === 'read-write'` early return. Without this, a personal profile's notice would have silently vanished once MUT-65 made its session access read-write -- with no replacement guidance, since the portal still has no "Record payment" affordance built. A non-personal, non-Malafat profile (genuinely no income capture) keeps the original "none" copy unchanged.

### Technical
- `src/hosted/pages/__tests__/views.test.tsx`: new case for a personal profile with `access.payments: 'read-write'`, asserting the new copy and that no record/edit affordance appears.
- `hosted-portal.md` §7.4 updated to document the three-way branch and checking order.

---

## [Unreleased] - 2026-10-13 — Arabic amounts inside a sentence read right-to-left (MUT-110)

**Why:** `formatAmount(…, 'ar')` prepends a U+200F RLM (a strong RTL character); the shared `isolate()` (FSI) takes its direction from the first strong character inside it, so an Arabic-formatted amount wrapped in `isolate()` renders right-to-left -- `$US 7,550` instead of `7,550 US$`. MUT-81 moved `OwedNowSummary` from LRI to the shared FSI `isolate()`, reasoning an amount "has no strong character," which doesn't hold once `Intl.NumberFormat('ar', ...)` is in the picture. FSI is right for names (MUT-81's actual case); wrong for amounts.

**Run on this branch (Node 22):** `npm run typecheck` clean, `npm run lint` clean, `npm test` (vitest run) 3,434 passed / 4 skipped.

### Added
- `isolateAmount()` (`src/lib/utils.ts`): wraps an amount in a left-to-right isolate (LRI, U+2066…U+2069), matching the `<bdi dir="ltr">` convention already used for a standalone amount. `isolate()` (FSI) stays for names.

### Fixed
- Six sites wrapped an amount in the wrong isolate -- three (`OwedNowSummary`, `PartialPaymentDrawer` ×3, `HomeNeedsAttention`) via the shared FSI `isolate()`; three (`RecurringAttentionList`, `RecurringMarkPaidDrawer`, `IncomeDrawer`) via a private FSI copy. All six now use `isolateAmount()`. `HomeNeedsAttention`'s client-name wrap (a name, not an amount) keeps `isolate()`.
- `PartialPaymentDrawer.test.tsx`'s `plain()` helper only stripped FSI/PDI; it now also strips LRI so it doesn't leak a stray isolate character into an assertion now that these sites use LRI.
- `IncomeDrawer.test.tsx`'s below-recorded error assertion and `OwedNowSummary.test.tsx`'s MUT-81 tripwire both pinned FSI; both now pin LRI, with the tripwire's comment updated to explain why.

### Technical
- `OwedNowSummary.test.tsx` gained a controllable `mockLanguage` ('en' | 'ar') and a new Arabic render test proving the overdue line reads in the same order as the standalone amount (ticket AC #4).
- TD-064 item 5 ("the bidi isolate helper is copied four times") resolved -- it was actually six sites, all private copies were FSI (the bug), now consolidated to `isolate()` / `isolateAmount()` in `lib/utils.ts`.

---

## [Unreleased] - 2026-10-13 — Both + Add menus open the drawer in place and ask for the profile (MUT-57)

**Why:** since MUT-15 both `+ Add` menus offered the same actions but behaved differently (TD-032): the sidebar's New menu opened the drawer then navigated to the list, and skipped the profile picker for Client/Project; the top bar's Add menu opened every drawer in place and was profile-aware for all four. Decision (Basel, 2026-10-11): both menus open the drawer in place, all four actions profile-aware in both.

**Run on this branch (Node 22):** `npm run typecheck` clean, `npm run lint` clean, `npm test` (vitest run) 3,431 passed / 4 skipped.

### Added
- `useAddMenuActions()` (`src/hooks/useAddMenuActions.ts`): the one set of create handlers behind both menus, returning `{ actions, run, pickers }`.
- `src/hooks/__tests__/useAddMenuActions.test.tsx`: covers all four actions opening their drawer in place with no navigation, profile-aware behaviour under All businesses, and that Income/Expense set the working profile while Client/Project don't (unchanged from before).

### Changed
- `SidebarNav`'s New menu now calls `useAddMenuActions()` instead of its own `incomeAction`/`expenseAction` + inline Client/Project cases; its `navigate(...)` calls after opening a drawer are gone, and it now renders a `ProfileQuickPicker` for all four actions (previously only Income/Expense).
- `TopBar`'s Add menu now calls the same shared hook instead of declaring its own four `useProfileAwareAction` instances; behaviour unchanged (it already opened in place and was profile-aware for all four).
- `SidebarNav.features.test.tsx`'s MUT-89 test updated: asserts no navigation instead of a specific route, and reads the last 4 (not 2) `useProfileAwareAction` calls now that the shared hook always wires up all four actions.
- TD-032 resolved.

---

## [Unreleased] - 2026-10-13 — POST /v1/inbox had no Idempotency-Key protection (MUT-131)

**Why:** found while planning MUT-125 (the phone app's offline outbox): /v1/income and /v1/expenses already dedupe a replayed create by Idempotency-Key (`idempotent()` middleware), but the plain `POST /v1/inbox` capture route (MUT-66) called `store.inboxEntries.create()` directly with no such protection — a client retrying after a lost response could create a duplicate Unsorted entry. Blocks MUT-125's client-side fix, which needs to safely replay a POST to learn whether it already committed. ADR-061.

**Run on this branch (Node 22):** `server/`: `npm run lint` clean, `npm run typecheck` clean, `npm test` 1,523 passed / 18 skipped, `npm run test:db` (Postgres, scratch databases) 1,650 passed, `npm run build` clean. Root: `npm run typecheck` clean (hosted schema types regenerated).

### Added
- **`POST /v1/inbox`** now requires `Idempotency-Key`, same contract as `/v1/income`/`/v1/expenses`: a replay with the same key + body returns the original entry (`Idempotent-Replayed: true`); the same key with a different body is refused 422 `IDEMPOTENCY_KEY_REUSED`.
- `UserIdempotencyKey` table (`userId`, `key` → status/fingerprint/response), the user-scoped twin of `IdempotencyKey` — for routes with no organization at all (ADR-061 explains why this is a new table, not a column added to the existing one). Migration `20261013110000_mut131_user_idempotency_keys`, purely additive.
- `identityIdempotent(store, operation)` middleware (`src/idempotency.ts`), alongside the existing `idempotent()` — partitions by the signed-in person (`c.get('identity')`) instead of an organization, for routes `authenticate()` never sets `auth` on.
- `resolveClaim()` (`src/repositories/idempotency-claim.ts`): the new/in_progress/replay/mismatch state machine, factored out of `memory.ts`/`prisma.ts` so the user-scoped claim implementations didn't copy it a second time; the existing organization-scoped `idempotency.claim()` in both stores now calls it too.

### Technical
- `store-contract-inbox.ts` gained the user-idempotency state-machine test (mirrors `store-contract.ts`'s organization one) plus a cross-user isolation case — run against both `memory.ts` and `prisma.ts` via the existing `store-memory-inbox.test.ts`/`store-prisma-inbox.test.ts` harnesses.
- `inbox-routes.test.ts`, `inbox-filing.test.ts`, `inbox-isolation.test.ts`: every direct `POST /v1/inbox` call now sends an `idempotency-key` header (these pre-dated the requirement); new idempotency-specific cases added to `inbox-routes.test.ts` (missing key, replay, mismatch, cross-user).
- `migration-mut107.test.ts` now applies the rest of the migration history before its final schema diff (matching `migration-mut61.test.ts`'s and `migration-mut100.test.ts`'s existing pattern) — it previously stopped right after its own file, which broke the first time a later migration (this one) was added.
- API `1.18.0-mut131`; `openapi.yaml` and the hosted portal's `schema.d.ts` regenerated. `store-guard.ts` classifies `userIdempotency.*` as `sessionOnly` (an API key has no person behind it, same rationale MUT-66 already gave `inboxEntries.*`).

---

## [Unreleased] - 2026-10-13 — Contingency fee proposals: propose upfront + rate, approval creates the agreement (MUT-107)

**Why:** since M8, approving a fee proposal is how every agreement is born (MUT-40/MAL-943) except CONTINGENCY (MUT-100), which could only be created directly with no client-approval record. Design already reviewed and locked inside MUT-100's plan (§11, decisions D9/D10); deferred there because MAL-1077 excluded it. Server-only; pairs with Malafat ticket MAL-1094 (not yet built) for the UI. Brief: `.claude/designs/mut-107-contingency-fee-proposals.md`. ADR-060.

**Run on this branch (Node 22):** `server/`: `npm run lint` clean, `npm run typecheck` clean, `npm test` 1,505 passed / 18 skipped, `npm run test:db` (Postgres, scratch databases) 1,630 passed.

### Added
- **`POST /v1/fee-proposals`**: optional `contingency { commissionRateBasisPoints 1..10000, upfrontTreatment SEPARATE | CREDITED }`; with it, `amount` is the proposed upfront and may be `0` (FIXED keeps `> 0`).
- **`POST /v1/fee-proposals/{id}/approve`**: `amount` is the agreed upfront (`≥ 0` for a contingency proposal); optional `contingency` override builds the created agreement's terms (ADR-060 — the proposal itself keeps the originally proposed terms). Approval still creates the agreement in one transaction, now via `createAgreementFromPreview`'s existing contingency branch (no change there — it already derived `type` from the preview body).
- `FeeProposal.contingency`, `FeeProposalSummary.contingency`, and the customer summary row's open-proposal `contingency` (nullable) — so Malafat can show "₪1,500 + 20%".
- `fee_proposals.commissionRateBasisPoints` / `upfrontTreatment` (nullable, CHECK both-or-neither), reusing MUT-100's `UpfrontTreatment` enum. Migration `20261013100000_mut107_contingency_fee_proposals`.
- Reason: 422 `SCHEDULE_REQUIRED`.

### Changed
- **`ApproveFeeProposalRequest.schedule`** is now optional, required only when the agreed amount is `> 0` (422 `SCHEDULE_REQUIRED` — intentional, also applies to FIXED, per D10). Every existing approve call in `routes-m7`/`routes-m8` always sends a schedule, so both suites pass unchanged.
- `CurrencySummary.proposed` needed no code change — it already sums the column a contingency proposal's upfront lives in (D9); only a new test pins one FIXED + one CONTINGENCY proposal summing correctly.
- **API `1.17.0-mut107`**.

### Technical
- New test files: `src/__tests__/routes-mut107.test.ts`, `src/repositories/__tests__/migration-mut107.test.ts`; a MUT-107 case added to `store-contract-m8.ts`.
- `migration-mut100.test.ts` now applies the rest of the migration history before its final schema diff (matching `migration-mut61.test.ts`'s existing pattern) — it previously stopped right after its own two files, which broke the first time a later migration (this one) was added.
- `TODOS.md` #7 closed on the API side (MAL-1094 remains); new debt #8 — audit event ordering can tie-break on a random id when two events share a real-clock millisecond (pre-existing, surfaced by this ticket's added test load, not caused by its logic; not fixed here to avoid unrelated scope).

---

## [Unreleased] - 2026-10-13 — Desktop updater capability grant: check() and relaunch() were "not allowed" in every shipped build (MUT-99)

**Scope:** `src-tauri/capabilities/default.json`, `src/lib/__tests__/updater-capabilities.test.ts` (new), `.claude/CI_CD.md`, `.claude/TEST_PLAN.md`. Epic MUT-48.

### Fixed
- `capabilities/default.json` now grants `updater:default` and `process:allow-restart`.
  `tauri-plugin-updater` and `tauri-plugin-process` were registered in `lib.rs`
  and configured in `tauri.conf.json`, but every Tauri v2 plugin command is
  still denied unless the capability file grants it. `check()` failed "not
  allowed" before it ever reached the network; `relaunch()` after an install
  would have failed the same way. Found 2026-10-12 during MUT-73's smoke test
  (recorded in TEST_PLAN.md's desktop-smoke notes), predates MUT-73. Granted
  `process:allow-restart` alone, not the broader `process:default`: the app
  never calls `exit()`.

### Added
- `src/lib/__tests__/updater-capabilities.test.ts`: asserts both grants are
  present, mirroring `updater-config.test.ts`'s pubkey guard. Written red
  against the un-granted capabilities file, green after the fix.

### Technical
- `.claude/CI_CD.md`'s Release Checklist now lists the grant as a prerequisite.
- Full end-to-end verification (an older install finding, downloading,
  installing and relaunching into a real published release) is a release-time
  checklist item, not a unit test — tracked on MUT-99.

---

## [Unreleased] - 2026-10-13 — Contingency fee agreements: upfront plus a % of the award (MUT-100)

**Why:** litigation firms most often charge an upfront fee plus a negotiated percentage of what the court or a settlement awards, and the ledger could not hold it: FIXED and RECURRING both need their total at creation. Server-only; unblocks MAL-1077 (Malafat UI) and MUT-107 (contingency fee proposals). Brief: `.claude/designs/mut-100-contingency-agreements.md` (eng review, CEO review, eng re-review on 2026-10-12; review record alongside). ADR-059.

**Run on this branch (Node 22):** `server/`: `npm run lint` clean, `npm run typecheck` clean, `npm run build` clean, `npm run openapi:check` up to date, `npm test` 1,470 passed / 17 skipped, full suite on Postgres (scratch database) 1,585 passed. Root: `npm run typecheck` clean, `npm run lint` 0 errors (12 pre-existing warnings), `npx vitest run` 3,422 passed / 4 skipped, `npm run hosted:types:check` matches, `npm run build:hosted` OK.

### Added
- **`AgreementType.CONTINGENCY`** through the existing `POST /v1/agreements(/preview)`: an optional `contingency { commissionRateBasisPoints 1..10000, upfrontTreatment SEPARATE | CREDITED }`; `amount` is the upfront, scheduled like a fixed fee's installments; ₪0 with no installments. Preview echoes `type` and `contingency`; the agreement carries `contingency { …terms, outcome AWAITING | AWARDED | NO_RECOVERY, outcomeDate, awarded, note, outcomeRecordedAt }`.
- **`PATCH /v1/agreements/{id}/contingency`** (If-Match): rate and/or treatment before the outcome; audited `agreement.contingency_terms_changed {from, to}`.
- **`POST /v1/agreements/{id}/outcome/preview`, `/outcome`, `/outcome/correct`.** AWARDED posts one commission installment (`isCommission`, DATE on the outcome date, VAT at the rate in force then); CREDITED subtracts the counted upfront and never refunds; NO_RECOVERY posts nothing. The token covers the bill's figures and, for a correction, the replaced receivable's version. A correction credits the old commission in full, voids it and posts the new one in one transaction, may fix the terms, and is refused with 409 `OUTCOME_HAS_PAYMENTS` once the commission has a payment or credit (re-checked under the receivable's row lock). `agreement.outcome_recorded` / `outcome_corrected` audit the figures as decimal strings.
- **`ProjectSummary.contingency`** (the project's latest ACTIVE contingency agreement); **`Installment.isCommission`**.
- Reasons: 409 `OUTCOME_ALREADY_RECORDED`, `OUTCOME_NOT_RECORDED`, `OUTCOME_HAS_PAYMENTS`; 422 `COMMISSION_RATE_INVALID`, `NOT_CONTINGENCY`, `OUTCOME_DATE_INVALID`, `COMMISSION_LABEL_REQUIRED`.
- Migrations `20261013090000_mut100_agreement_type_contingency` (the enum value alone) and `20261013090100_mut100_contingency_terms` (two enums, seven agreement columns, `installments.isCommission`, a CHECK).
- Store: `updateContingencyTerms`, `recordOutcome`, `correctOutcome` (memory + Prisma, classified in `STORE_ACCESS`).

### Changed
- **FIXED with `installments: []`** → 422 `details.reason = NO_INSTALLMENTS` (was the zod issue list) — the one intentional behaviour change (R5/D7).
- Contingency counts as fixed-like for `kind` and `agreed`; such a project is **PENDING, never PAID_IN_FULL, while its outcome is awaited**.
- Cancel accepts a contingency agreement before its outcome (409 `OUTCOME_ALREADY_RECORDED` after); supplements on it stay 422 `NOT_FIXED` with a contingency-specific message.
- **API `1.16.0-mut100`** (the plan said 1.14.0; MUT-120 and MUT-61 took 1.14/1.15). Hosted types regenerated; the portal needs no change.

### Technical
- `AuditEventInput.metadata` is `JsonObject` (R9): seven audit helpers retyped; the retainer-cancel credit audit writes `amount: null` instead of a possibly-undefined value.
- MUT-59's and MUT-61's migration tests apply history one transaction per file (pasted as one script, Postgres refused `CONTINGENCY` in the transaction that added it); MUT-61's applies the rest of the history before its schema diff. Assertions unchanged.
- `TODOS.md` #7 records the deferred proposal flow (MUT-107/MAL-1094). New debt TD-097..099. `server/DEPLOYMENT.md` §6: post-release `pg_enum` check and the rollback rule.

### Fixed in pre-landing review (2026-10-13, `/qa-reconcile` → `/review`: 7 specialists + adversarial; decisions D1–D4 by Basel)
- **Double billing / commission on a cancelled agreement (D1):** `postInstallment` never posts a voided line; a correction locks the agreement row and voids conditionally (a racing loser is 409, never a 500 or `has_payments`); cancel refuses once an outcome is recorded, also when it races the record.
- **Upfront moving between compose and write (D2):** the write re-checks each upfront receivable's version under lock → 409 `PREVIEW_STALE`.
- **`correctionReason` left out of the token (D3).**
- **The terms CHECK refused no NULL rate** (`NULL BETWEEN …` is NULL; a NULL CHECK passes) — explicit `IS NOT NULL`; the unapplied migration is edited in place.
- Credits read in parallel; `COMMISSION_RATE_RULE` from the bounds; due-date override bounded; rollback runbook corrected (an old revision fails reads of CONTINGENCY rows: roll forward only).
- Tests added: cancelled guard, credited-not-paid commission, terms stale after an outcome (store), correcting a never-posted commission, VAT-included CREDITED end to end, read-only key 403 on the three writes, Postgres race of two corrections, voided-line posting, cancel vs record. Each new route test was mutation-checked (fails with its fix reverted). New debt TD-100..103.
- **Re-review (cycle 2, adversarial pass over the fix diff):** versions read before credits in compose; record locks the agreement first; lock conflicts in the outcome writes → 409 (`isLockConflict`); a replaced line that posted since compose → stale; MANUAL trigger voided by a concurrent cancel → 409. Mutation-checked.
- **Re-run:** `server/` lint, typecheck, build, openapi:check clean; `npm test` 1,490 passed / 17 skipped; Postgres 1,613 passed (contract race tests stable over 3 runs); hosted types match.

## [Unreleased] - 2026-10-12 — deploy.sh runs post-roll data repairs (MUT-61 follow-up)

**Why:** a migration's backfill runs before the new revision serves (deploy.sh step 3), so rows the old revision writes in between — or after a rollback — miss it. MUT-61's `origin` backfill had a manual DEPLOYMENT.md step for that window; it is now automatic.

### Added
- **`deploy.sh` step 6:** after the roll and the smoke, the Cloud SQL proxy opens again and `npm run post-roll` (`server/src/scripts/post-roll.ts`) runs idempotent repairs; today one: a payment with a `createdByUserId` still `INTEGRATION` becomes `CAPTURE`. Normally 0 rows. A failure stops with a message that the service is already rolled and healthy; re-running `deploy.sh` is the recovery.
- `start_proxy` / `stop_proxy` in `deploy.sh`, shared by steps 3 and 6 (step 3 now fails fast if the proxy never opens, instead of carrying on to the migration).

### Changed
- `DEPLOYMENT.md`: §2 lists the new step; §6's one-off MUT-61 `UPDATE` row is replaced by "re-run the post-roll repairs by hand".

**Run:** `server/` lint and typecheck clean, `npm test` and `npm run test:db` green, `post-roll.test.ts` (Postgres) passes; step 6's own lines exercised locally against the test database with a stand-in proxy, both the success and the failure path.

## [Unreleased] - 2026-10-12 — Received income on Malafat profiles, allocated by Malafat (MUT-61)

**Why:** a lawyer handed cash or a cheque could not log it on their firm's Malafat-linked profile; the phone and the portal could only record expenses there. The rule existed to prevent double-counting. Now the payment is recorded tagged and unallocated, and Malafat allocates it — Mutaba3a never calls Malafat. Server-only; unblocks MUT-123 (phone) and MAL-1097 (Malafat). Brief: `.claude/designs/mut-61-malafat-received-capture.md` (eng-reviewed, D1–D4). ADR-037 MUT-61 amendment.

**Run on this branch (Node 22):** `server/`: `npm run lint` clean, `npm run typecheck` clean, `npm run build` clean, `npm run openapi:check` up to date, `npm test` 1,354 passed / 14 skipped, `npm run test:db` 1,450 passed. Root: `npm run typecheck` clean, `npm run lint` 0 errors (12 pre-existing warnings), `npx vitest run src/hosted` 145 passed, `npm run build:hosted` OK.

### Added
- **`capture` writability row** (`capture:write`, session-only, every hosted profile). Its whole write surface: `payments.capture` and `payments.undoCapture`.
- **`POST /v1/income` Received on a Malafat-fed profile**, for a client Malafat has linked (422 `CUSTOMER_REQUIRED` / `CUSTOMER_NOT_LINKED`); a matter is optional and must be that client's. Stored POSTED, unallocated, `origin: CAPTURE`, with its `captureSource`.
- **`Payment.origin` (`INTEGRATION | CAPTURE`) and `Payment.captureSource`**; migration `20261012190000_mut61_payment_capture` backfills `CAPTURE` where `createdByUserId` is set.
- **Payment view:** `origin`, `captureSource`, `capturedBy {userId, displayName}`, `allocationState`, `projectId`. **`GET /v1/payments`:** `?origin=` and `?allocationState=` (POSTED only).
- **`GET /v1/me`:** `profiles[].income` (`incomeCaptureRulesFor`), the same rules the route enforces.

### Changed
- **Owed on a Malafat-fed profile** is refused 403 `READ_ONLY_PROFILE { domain: payments }` before any validation (was refused by the route scope).
- **Received with no client on a Malafat-fed profile** → 422 `CUSTOMER_REQUIRED` (was 403). A P-created id undone from M → 404 (was 403).
- **`DELETE /v1/income/{id}`** reverses a Received in one conditional write; any allocation, full or partial → 409 `ALREADY_ALLOCATED`, never an unwound allocation.
- **A captured `projectId` is a hint until allocated:** `?projectId=` matches a payment's own matter only while it has no allocations.
- OpenAPI `1.15.0-mut61` (MUT-120 landed 1.14.0 first); `src/hosted/api/schema.d.ts` regenerated.

### Fixed (from /review, 2 fix cycles, converged)
- **The published `CaptureSource` component had become nullable**, so four request bodies advertised a null the server rejects; it is registered first now, and a spec test pins it.
- **A capture Malafat reversed** answered 204 to the person's undo; now 409 `REVERSED_BY_MALAFAT`, and `capture_undo` is a reserved reversal reason (422 `REASON_RESERVED`).
- **An off-currency capture against a matter** on a Malafat-fed profile could never be allocated; now 422 `CURRENCY_MISMATCH`.
- New reasons published; audit metadata shapes aligned; project-filter relation clauses tenant-scoped; Postgres race test for allocate vs undo (mutation-checked); route tests for settle/inbox/key origin, `capturedBy`, device-session Me; DEPLOYMENT.md post-roll backfill step.
- **`GET /v1/payments?projectId=` lost the project filter from page 2 on** — the cursor's `OR` replaced the project's `OR` in one `where`. OR-shaped conditions now go in `AND`.
- **Migration tests timed out under `test:db` load** (5 s default; replaying history takes longer in parallel) — both now set 60 s.

## [Unreleased] - 2026-10-12 — Every user gets exactly one personal profile (MUT-120)

**Why:** the capture app (epic MUT-63) needs a writable default target on every account, and a "personal" profile was only implied (an org with no Malafat integration), never marked or limited. This is ADR-037's MUT-120 amendment. Brief: `.claude/designs/mut-120-personal-profile.md`. Test plan: `-tests.md`. Jira MUT-120 comment 11080 records the scope changes.

### Added
- `Organization.personalOwnerUserId` (unique, FK users). Migration `20261012170000_mut120_personal_profile` is purely additive.
- `POST /admin/v1/users` creates the user's personal profile in the same transaction:
  - named `Personal`/`شخصي` by locale;
  - `organizationId` is now optional, and new `defaultCurrency`/`timezone` fields override the firm's (both required with no firm);
  - the response gains `personalProfile {id, name}`, and `memberships` lists the personal one first.
- `HostedProfile.isPersonalDefault` on `/v1/me` and `POST /v1/device-sessions`.
- 409 `CONFLICT {reason: 'PERSONAL_PROFILE'}` when a personal profile is granted to another user, used as another user's `organizationId`, issued an API key, or bound.
- `provision:user` takes optional `--organization-id`, plus `--currency` and `--timezone`, and prints `personal <id> <name>`.

### Changed
- `UserRepository.create` takes `personal` and returns `{ user, memberships, personalOrganization }`. Memory and Prisma are both all-or-nothing.
- Admin `Organization` shows `personalOwnerUserId`.
- API `1.14.0-mut120`; `openapi.yaml` and `src/hosted/api/schema.d.ts` were regenerated.
- Tests that pinned one membership or one profile now include the personal one, and "last membership revoked" tests revoke it too. These are intentional changes.

### Fixed (pre-landing review, 2026-10-12)
- `/v1/me` order is now deterministic: firms come first and the caller's personal profile last. Before this, the portal landed firm users on Personal by UUID chance (QA: 1–2 of 20 per firm; 0 of 20 after the fix).
- `CreateUserRequest.timezone` must be an IANA zone (422).
- An owner's own personal-profile membership cannot be revoked (409). This resolved TD-089.
- API-key auth refuses keys on personal profiles (409); this replaces the bind-only check.
- A 409 on create-user says "email" only for an email clash.
- Provisioning docs (`server/README.md`, `server/DEPLOYMENT.md`) are updated.
- New tests:
  - `/v1/me` never marks another user's personal profile;
  - store contract: unknown owner gives ForeignKeyViolation, and a personal-slug clash rolls the user back;
  - CLI: no-firm create makes exactly one membership.
- New debt: TD-091.

### Technical
- Cut from the ticket: the backfill script, since there were no existing users. Before deploying, confirm `SELECT count(*) FROM users` is 0 in production (review action).

**Run on this branch (`feature/mut-120-personal-profile`):**
- server `npm run lint` 0 problems; `npm run typecheck` clean; `npm test` 1,333 passed (12 Postgres files skipped);
- `npm run test:db` against a dedicated database: 82 files, 1,423 passed;
- `openapi:check` up to date; `npm run build` ok;
- root `npm run typecheck` clean, `hosted:types:check` matches, `npx vitest run src/hosted` 145 passed.

## [Unreleased] - 2026-10-12 — Brand v2 foundation: tokens, Thmanyah + Plex Mono and the type scale in every web build (MUT-102)

**Why:** `theme.css` still carried the old look (teal, Inter, Source Serif 4, a 13px body) and repeated every colour in four blocks, while Brand v2 sat unimported. This lands Brand v2 once for the landing page, the app, the desktop app and the portal, with light text at AAA. Epic MUT-101; ADR-058 (amends ADR-018). Plan `.claude/designs/mut-102-brand-v2-foundation.md` (PD0–PD11, eng review D1–D8); test plan `…-tests.md`.

### Added
- `src/styles/brand/fonts.css`: Thmanyah Sans 400/500/700 and Serif Display 400/700 (`swap`), plus Plex Mono 400/500 from `@fontsource`. The five `.otf` files moved, bytes unchanged, from `public/fonts` to `src/assets/fonts` and are bundled (D4).
- Brand roles `--text-label/body/headline/title/figure/display`, `--radius-card/hero/pill`, `--accent-text`, and motion tokens (`--ease-spring`, `--ease-overshoot`, `--duration-press/toggle/nav`, `--stagger-step`, `--press-scale`) that zero under reduced motion.
- `brandFontPreload()` (`vite.config.ts`): every build preloads Thmanyah Sans 400; a missing file fails the build. The PWA caches fonts on first use (CacheFirst, 12).
- `check-bundles`: each dist ships the delivered Thmanyah bytes, bundles no retired face, preloads the body face, and resolves every CSS `url()` inside itself.
- `src/test/css/brandCss.ts` (Node CSS evaluator + OKLCH/contrast maths) and `src/styles/__tests__/brand.test.ts`: fonts, drift, tokens, contrast, names, references, accent-text guard.
- QA: `qa/specs/web/brand.spec.ts`; a `portal` app and `qa/specs/portal/signin.spec.ts`; `qa/support/brand.ts`.

### Changed
- `theme.css` maps every semantic token once onto `--m-*`: no colour literal, 862 → 545 lines. Light text pairs clear 7:1, dark 4.5:1; the placeholder (85% ink2) is the one exemption, at 5.02 / 4.66:1 (D7).
- Body 16; headings Thmanyah Serif Display 700; `--font-en`/`--font-ar` Thmanyah Sans; amounts in Plex Mono (owed-now at the figure weight 500, `CurrencyAmounts`, the portal's `.hp-amount`). Old size and radius names alias the brand scale (TD-079).
- Filled buttons use primary-hover; the selected nav label is lavender-ink; the 41 `color: var(--accent)` sites use `--accent-text`.
- The brand CSS holds primitives only; `--m-shadow-tint`, `--m-press-scale`, `--m-stagger-rise/blur` added from the JSON (PD7).
- TD-048, font half: the `:lang()` font rules style `<html>` only; the landing hero's `font-family: inherit` workaround is gone. The direction half is MUT-109.
- The portal sign-in heading is Serif Display 700 (D5). `KNOWN_AXE_VIOLATIONS` no longer lists `color-contrast`; `expectOnlyKnownAxeViolations` waits for drawers and animations to settle.

### Fixed
- The profile avatar's default fell back to the undefined `--color-accent`: white initials on nothing (1.04:1). It now uses the filled-button pair.
- `CSVValidationPreview.css` declared a global `.text-muted` (slate, italic) that overrode the theme utility app-wide once loaded (Clients "Never paid", Settings' Default badge). Scoped.
- The Mac download banner button (white on dark-mode accent, 1.5:1) and the landing get-it links (axe `link-in-text-block`).
- The web/desktop `vite-config` snapshot no longer embeds the release version (it had failed on main since v0.0.66).

### Removed
- `@fontsource-variable/inter`, `@fontsource-variable/source-serif-4`, `@fontsource/ibm-plex-sans-arabic` and their imports; Plex Mono 600; the Inter `cv02…` feature settings; the brand CSS's partial mapping block.

### Technical
- `postcss` 8.5.6 (already in the tree via Vite) is a pinned devDependency for the harness.
- `bundle-origins.json` and `server/src/__tests__/portal.test.ts` are unchanged.
- New debt: TD-079 (MUT-103's sweep), TD-080 (border non-text contrast), TD-081 (landing LCP +628 ms at Fast 3G), TD-082 (portal sign-in `region`), TD-083 (phone-width layout; on main too).

**Run on this branch (Node 22):**
- `npx vitest run`: 225 files, 3,390 passed, 4 skipped;
- `npm run typecheck` clean; `npm run lint` 0 errors (12 warnings, all pre-existing, in files this ticket did not touch);
- `npm run test:bundles` passed; `npm run build:desktop` built;
- `npm --prefix server test`: 70 files passed, 12 skipped (database suites);
- QA (web + portal) on `vite preview` builds: 45/45, and 90/90 with `--repeat-each=2`;
- PWA: after one online visit, an offline reload still renders Thmanyah (4 faces in the `fonts` cache);
- landing LCP, Fast 3G + 4× CPU, median of 5: 4116 ms on main → 4744 ms.
- **Not run:** the manual desktop check with the network off (`npm run tauri dev`); `check-bundles` proves every `dist-desktop` font `url()` resolves locally.

### Review round (qa-reconcile, 2026-10-12)

`/qa-reconcile` with gstack `/review` used six specialists plus a red-team pass and an adversarial pass. They found that the 7:1 promise held for token pairs but not for the rules components render; the browser check is AA only. The owner chose to fix the blockers and regressions here (D1) and to drop the font preload (D2).

**Fixed:**
- **Purple text on lavender** (5.52:1) now uses `--on-accent-subtle`, which is lavender-ink. This covers the nav, + Add, the open client row, pills, chips, badges and alerts.
- **Fills that turn light in dark mode.**
  - Status fills use `--on-status`.
  - Accent fills use `--accent-solid`/`--on-accent`: the update banner, the sidebar toggle, the download CTA, the PDF icon and the matching hover.
  - Avatars without a business colour use the filled pair through `profileAvatarStyle()`. An unreadable colour is ignored.
- **Focus.**
  - The Clients profile pane had lost its focus ring (`inset var(--focus-ring)` was invalid).
  - Filled buttons get `--focus-ring-on-fill`, and a hovered primary keeps it.
  - Focus rules no longer use literal colours.
- **Blends** across hues mix in oklab. In oklch, cream met lavender-grey at pink.
- **Tints** are capped where ink2 keeps 7:1, and `--surface-3` carries primary text only.
- **No faked bold:** `font-synthesis-weight: none` on `html`, and the mono rules ask for weight 500.
- **Fonts and links.**
  - index.css no longer re-sets the body face.
  - The mono stack falls back to Thmanyah Sans.
  - `:visited` applies only to unclassed links.
- **Small fixes:** a CSS syntax error in `CSVValidationPreview.css`, and a missed `var(--accent, …)` text colour.
- **Font preload dropped.** Landing LCP is now **3964 ms vs 4116 ms on main**; the preload measured 4664. `check-bundles` flags a font preload and reads the pinned hashes from `src/assets/fonts/thmanyah.sha256.json`.
- **New tests:**
  - rendered pairs, with a shrink-only list of literal pairs;
  - token pairs composited over `--bg` and `--surface`;
  - the oklch hue-drift guard;
  - focus guards;
  - font placement, mono weight and synthesis;
  - the visited rule;
  - the accent guard's fallback and multi-line forms;
  - avatar tests;
  - QA: the Clients pane ring, known overflows that fail if they grow, bounded theme toggling, and the portal heading read from translations.

**Deferred** (TD-079 for MUT-103, plus TD-084–088): moving amounts to mono for tabular figures and ₪; AAA axe in the browser; the PWA font cache on first visit; the Safari 16.2 floor; heading sizes; user colour inks; bundle checks on the ship paths; the Serif Display provenance.

**Run after the fixes (Node 22):**
- `npx vitest run`: 226 files, 3,418+ passed;
- typecheck clean; lint 0 errors;
- `test:bundles` passed;
- QA on `vite preview`: 90/90 with `--repeat-each=2`, after one ceiling fix.

---

## [Unreleased] - 2026-10-12 — "All businesses" on Home and Clients (MUT-89)

**Why:** the pitch is "who owes me across my businesses", but the app showed one business at a time. An All Profiles mode was switched off in April (`70b5093`) with no ADR. Decision S2 of the Apple-design brief (epic MUT-74) brings it back for the owed screens only. The owner approved O1–O7 and eng review D1–D8. ADR-051. Brief `.claude/designs/mut-89-all-businesses-lens.md`; test plan `.claude/designs/mut-89-all-businesses-lens-tests.md`.

**Run on this branch (Node 22):**
- `npx vitest run`: 219 files, 3,218 passed, 4 skipped;
- `npm run typecheck` clean, and `npx tsc -b` clean;
- `npm run lint`: 0 errors (12 warnings, all pre-existing, in files and rules this ticket did not touch);
- `npm run test:bundles` passed;
- a browser check on the preview (sample data, three businesses, see TEST_PLAN).

### Added
- **"All businesses" in the switcher**, first, on Home and Clients only, with two or more businesses (AC1, O2). Picking it turns the lens on; picking a business works in it and turns it off. It sticks for Home and Clients while other screens use the working business (O1). The top bar says "All businesses" while it is on.
- **Home in All:** Owed now per currency across every business, never summed. Needs attention and Recent payments rows carry their business tag.
- **Clients in All:**
  - every live business's clients, each row tagged with the businesses its entries are in (a shared client shows each);
  - "No client" and "Archived clients" come one row per business (O4), and a click opens Income in that business with All kept on.
- **`BusinessTags`** (`ProfileBadge.tsx`): one colour-and-name tag per business, the name in `<bdi>`, the full name as a title.
- **AppShell `BusinessesGate`:** pages mount once the businesses have loaded, so no page reads with a blank business (D8).

### Changed
- **`profileStore` v1:** working business + `allBusinesses` + unpersisted `onOwedScreen`; the setters `setActiveProfile` (pick, lens off), `setWorkingProfile` (repair, lens kept) and `setAllBusinesses`. A legacy `'all'` migrates to the lens on.
- **`useActiveProfile`:**
  - `activeProfileId` is always concrete;
  - `isAllProfiles` and `showAllProfilesOption` are real again (lens + owed screen + 2 or more businesses);
  - `setAllBusinesses` is new;
  - the auto-correct repairs without turning the lens off (D5).
- **New `useOwedLens()`** (Home and Clients) and **`useOwedScreenSync()`** (called in AppShell). The `/` and `/clients` routes carry `staticData.owedLens`.
- **`ProfileScope`** (one id or a list) on `transactionRepo.list`, `clientRepo.list`, `paymentRecordRepo.listRecent` and `clientSummaryRepo.listOwedIndex`, and their hooks, which also take an `enabled` gate. A list never matches an unassigned record (O3).
- **`listOwedIndex`** adds `profileIds` per row and `byProfile` for a list. `RecentPaymentRow` carries `profileId`.
- **Home's new-user check** waits on a resolved scope and `isPending` (D2). The Clients spinner uses `isPending`.
- **The `'all'` sentinel is gone** from `ActiveProfileId` and from the checks in `IncomeDrawer`, `useProfileAwareAction` and `PlanningPage` (D6).
- "All Profiles" now reads "All businesses" / "كل الأعمال".

### Fixed
- **The Add menus' business picker** (`ProfileQuickPicker`), which could not open before this ticket, ran about 21 px past the window's inline end from the top bar. It now nudges itself inside with `nudgeInside`.

### Pre-landing review (qa-reconcile + /review, 2026-10-12)
Seven specialists, Red Team and an adversarial pass reviewed the branch; Codex was not installed. Main (MUT-81 after-save feedback, the qa port) was merged in, with two code conflicts in `HomeAttentionRow.tsx` / `HomeNeedsAttention.tsx` (both sides added a prop; kept both).
- **Fixed, a chosen business was being lost** (owner D1):
  - MUT-81's Saved · Show now uses `setWorkingProfile` and keeps All on;
  - the Client and Project drawers prefill the business the Add menu's picker returned (`defaultProfileId`);
  - the sidebar's New → Income/Expense makes the picked business the working one before opening its list.
- **Fixed** (owner D2):
  - the picker is placed from where its menu item was, focuses its first business, moves with arrow keys/Home/End, closes when focus leaves it, and gives focus back to the Add/New button on Escape (`trigger(event, returnFocus)`);
  - the Income drawer asks for the business before the client, and offers "Create new" client only once one is chosen (second pass: order alone didn't stop a new client landing in the default business);
  - the Home/Clients route flag moved to an unsaved `useOwedScreenStore`, so navigating never rewrites the saved choice or overwrites another tab's.
- **Auto-fixed:**
  - Planning reads the resolved working business;
  - the switcher's up/down estimate counts the All row;
  - the All row uses the shared option states and its avatar is a solid tint (readable in dark mode);
  - a badge beside its name is decorative, so screen readers say the business once;
  - one spacing token for the tag lines;
  - doc corrections (`ProfileScope`'s `''` vs `[]`, when `byProfile` is present, archived counts).
- **Tests and cleanups** (owner D3):
  - an AppShell-level gate test (mutation-checked);
  - the hook under the real All state;
  - the Income drawer from a client and when duplicating;
  - QueryGate moved so `@deprecated` is back on `useTransactions`;
  - an unused `enabled` param and a re-export dropped;
  - one shared `POPOVER_EDGE_MARGIN`;
  - `ClientOwedIndexRow` for index rows.
- **Third pass** (informational, applied): while no business is chosen, an unknown client's error says to choose the business first (not "press Enter"), and the project field stays closed too; the picker is one Tab stop; the Arabic hint uses the field's own noun ("الملف التجاري"); the hint key is in the drawer's i18n guard; a test pins that focus going nowhere (WebKit clicks) never closes the picker. The review stopped at its three-cycle cap, recorded as not converged.
- **Recorded as TD-068** (owner D4): the leftovers (cold-start chunk wait, extra renders, middle-click on a muted row, a failed businesses read, re-picking from an off-screen switcher, a drawer kept open across Back, downgrade, the top-bar icon).

### Files
- **Changed source:**
  - routing and shell: `src/router.tsx`, `src/components/layout/{AppShell,ProfileSwitcher,TopBar}.tsx`;
  - state: `src/lib/profileStore.ts`, `src/hooks/{useActiveProfile,useQueries,useIncomeQueries,useProfileAwareAction}.ts`;
  - data: `src/db/{baseQuery,repository,interfaces}.ts`, `src/types/index.ts`;
  - Home: `src/pages/overview/OverviewPage.tsx`, `src/components/home/{HomeNeedsAttention,HomeAttentionRow,HomeRecentPayments}.tsx`;
  - Clients: `src/pages/clients/ClientsPage.tsx`, `src/components/clients/clientIndexRows.ts`;
  - shared UI: `src/components/ui/{ProfileBadge.tsx,ProfileBadge.css,ProfileQuickPicker.tsx}`, `src/components/drawers/IncomeDrawer.tsx`, `src/pages/planning/PlanningPage.tsx`;
  - styles and strings: `src/index.css`, `src/lib/i18n/translations/{en,ar}.json`.
- **New tests:** `src/__tests__/router.owedLens.test.ts`, `src/hooks/__tests__/allBusinessesLens.test.tsx`, `src/components/layout/__tests__/{AppShell.gate,ProfileSwitcher,TopBar.profileIndicator}.test.tsx`, `src/components/ui/__tests__/ProfileQuickPicker.test.tsx`.
- **Changed tests:** `profileStore`, `useActiveProfile`, `baseQuery`, `clientOwedIndex`, `paymentRecords`, `clientIndexRows`, `ProfileBadge`, `OverviewPage`, `HomeNeedsAttention`, `ClientsPage`, `IncomeDrawer`.
- **Knowledge:** ADR-051, COMPONENT_REGISTRY, PATTERNS, SYSTEM_OVERVIEW, TECH_DEBT (TD-065 note), TEST_PLAN.

---

## [Unreleased] - 2026-10-12 — After saving, show where the entry or payment landed (MUT-81)

**Why:** After saving income or a payment, the drawer closed and the list updated with no highlight and no message. With a filter active, another profile selected, or a long list, the entry landed out of view with nothing to say where — the "entered it and can't find it" problem. Two `/plan-eng-review` passes (the second re-verified against MUT-82 and MUT-84 after they landed mid-review) and one `/plan-design-review` pass preceded the build: `.claude/designs/mut-81-after-save-feedback.md`.

### Added
- **`src/lib/savedFlashStore.ts`** (new): the one store carrying a save's ids, kind, client and profile from a drawer to whichever list renders it. Resolution is list-reported settled (every registered list must report before an unclaimed save raises its message), never a global `useIsFetching()` count — that races TanStack Query's own invalidation (ADR-057).
- **`src/hooks/useSavedFlash.ts`** (new): `useSavedFlashRows(listId, ids, queryResult)` — one call per list, registers it and reports its own settled state; `useSavedFlashResolution()` for the announcer.
- **`src/components/layout/SavedFlashAnnouncer.tsx`** (new, mounted once in `AppShell`): a visually-hidden, polite "Saved" when the row is visible; the existing `Toast` naming where the save went, with Show, when it is not. Show switches the active profile through the raw `profileStore` (never `useActiveProfile`'s wrapper, which silently refuses an id its own query has not loaded), navigates to the client profile or `/income` with its filters reset, and re-arms the flash so the message can't repeat.
- **`tr.row-flash`** (`src/index.css`): a 1.5s `--accent-subtle` fade plus a 3px leading rail on the logical inline-start edge — the wash alone is already this app's "selected" look in 15 other places. Reduced motion holds the tint, skips the fade.
- **`isolate()`**, exported from `src/lib/utils.ts` (U+2068 FSI … U+2069 PDI): the shared home for a bidi-isolate helper that existed as four private copies, two of them the wrong codepoint (U+2066 LRI, which always forces left-to-right — wrong for an Arabic client name). `OwedNowSummary.tsx` and `PartialPaymentDrawer.tsx` migrated; `RecurringAttentionList.tsx` and `RecurringMarkPaidDrawer.tsx` (already-FSI) are left for a follow-up (`TODOS.md` #6).
- Five lists wired with one `useSavedFlashRows` call each: `HomeNeedsAttention`, `HomeRecentPayments`, `ClientWorkSection`, `ClientPaymentsSection`, `IncomePage`.

### Changed
- `IncomeDrawer` and `PartialPaymentDrawer` call `markSaved` after a successful create or update, before closing. The client's name is captured from data already in the query cache at save time, never looked up again later.
- `PartialPaymentDrawer`'s call is unconditional: `ClientWorkSection` and `IncomePage` open it with no `onRecorded` callback at all, so the drawer itself is the only place that can know a save happened for those two screens.
- `HomeNeedsAttention`'s full-payment branch calls `useSavedFlashStore.getState().clear()` right after the drawer's unconditional `markSaved` — that row already leaves via `captureRowExit` (ADR-055) with complete feedback (the slide-out, the Undo toast), and without this the flash would otherwise raise a confusing message under it, misfiring specifically for a payment that falls outside `useRecentPayments`'s last-10 window.

### Technical
- `ADR-057` records the mechanism and its five rejected alternatives.
- `TD-077` (accepted): the message is the existing `Toast`, not the design review's anchored strip (5B) — none of the ticket's five acceptance criteria name a presentation surface.
- `TD-078` (accepted): pagination, the Owed-now tick, currency-block collapse, and a non-Home focus chain are approved design-review decisions this build did not implement.

### Verified
- `npm run lint`: 0 errors (12 pre-existing warnings, none in changed files). `npm run typecheck`: clean. `npx vitest run`: 218 files, 3,186 passed, 4 skipped. `npm run build`: clean.
- Not run: `npm run test:e2e` / `release-qa` (no browser spec written for this ticket).

### Files
`src/lib/savedFlashStore.ts` (new), `src/hooks/useSavedFlash.ts` (new), `src/components/layout/SavedFlashAnnouncer.tsx` (new), `src/components/drawers/IncomeDrawer.tsx`, `src/components/drawers/PartialPaymentDrawer.tsx`, `src/components/home/HomeNeedsAttention.tsx`, `src/components/home/HomeAttentionRow.tsx`, `src/components/home/HomeRecentPayments.tsx`, `src/components/clients/ClientWorkSection.tsx`, `src/components/clients/ClientPaymentsSection.tsx`, `src/pages/income/IncomePage.tsx`, `src/components/clients/OwedNowSummary.tsx`, `src/lib/utils.ts`, `src/index.css`, `src/lib/i18n/translations/{en,ar}.json`, `src/components/layout/AppShell.tsx`; knowledge: `DECISIONS.md` (ADR-057), `TECH_DEBT.md` (TD-077, TD-078), `COMPONENT_REGISTRY.md`, `PATTERNS.md`, `TEST_PLAN.md`, `SYSTEM_OVERVIEW.md`, `TODOS.md` (#6)

---

## [Unreleased] - 2026-10-12 — The MUT-82 and MUT-84 browser checks, now in `qa/`

**Why:** MUT-82's five Playwright tests were dropped when MUT-97 retired `e2e/` (TD-064 item 7). MUT-84's split-view spec was planned but never written (TD-067). MUT-86's four checks were not lost: MUT-86 merged before MUT-97, which ported them as `web.record-payment.*`, so nothing was needed there. This adds the missing coverage to `qa/` and changes no app code.

### Added
- **`qa/features/web/home.yaml` + `qa/specs/web/home.spec.ts`: four MUT-82 features.** The original spec was recovered from the pre-rebase checkpoint `660ba96` and ported:
  - `attention-pay-full` (secondary): runs axe on Home with the buttons, then a full payment. The row's copy slides out, Owed now drops, focus moves to the next row, the toast names the payment, and Undo restores the row, Owed now and focus.
  - `attention-pay-partial` (secondary).
  - `attention-pay-reduced-motion` (tertiary): fade only.
  - `attention-pay-rtl` (tertiary): slides left.
  - The separate axe test became a step inside the full-payment flow, as MUT-97 did for every axe check.
  - The Arabic test finds controls by their translated names, not by the CSS classes it used before.
- **`qa/features/web/clients.yaml` + `qa/specs/web/clients.spec.ts`: four MUT-84 features**, written from TD-067's list:
  - `split-view` (secondary): click, ↓/↑ walk, the status line, Enter/Escape and →/←, axe on both panes, Back.
  - `split-view-deep-link` (secondary): a sorted deep link, and a walk that keeps the sort.
  - `split-view-resize` (tertiary): 1280 → 375 → 1280 keeps a typed Work search.
  - `split-view-rtl` (tertiary): the list on the right, ← in and → out.
- **`qa/support/motion.ts`:** `traceExit(page, selector)` and `readExitTrace(page)`. They follow an animated copy frame by frame, for the drawer snapshot and the Home row alike. `drawer-motion.spec.ts` now uses them instead of its private copy.
- **`qa/support/i18n.ts`:** `ar`, the app's Arabic copy read from `src/lib/i18n/translations/ar.json`. A spec can't import the JSON itself, because Node's ESM loader needs `with { type: 'json' }`.
- **`qa/support/app.ts`:**
  - `logIncome({ dueDate })` opens More details and fills the Due Date.
  - `localDateFromToday(days)`.
  - `switchToArabic(page)` switches the language from Settings.
- **`qa/support/axe.ts`:** a `clientsSplit` surface (`color-contrast` only, like the app shell).

### Changed
- `home.yaml` now maps `src/components/home/**` and `clients.yaml` maps `src/components/clients/**`. Before this, no feature claimed either folder, so a change to Needs attention or to the split-view helpers brought nothing into scope.
- The catalog: 21 → 29 features (9 core, 12 secondary, 8 tertiary). `release-qa lint`: no errors, 29/29 automated.

### Verified
- `release-qa pw --record` for the Home, Clients and drawer-motion specs with retries off: 16/16 on the first run. That is the 8 new features plus the 8 existing ones those files hold.
- `release-qa run --all --in-place` (recorded, review page): 29/29 passed, so the shared-helper refactor broke none of the existing features.
- Each new feature also failed against a deliberately broken build, on the assertion that guards the broken behaviour. The code was reverted after each check.
  - Split view: the walk disabled, and the profile keyed by layout.
  - Home: reduced motion ignored, the focus hand-off removed, and the slide forced to the right. The partial feature, which none of these touch, kept passing.

### Files
`qa/features/web/home.yaml`, `qa/features/web/clients.yaml`, `qa/specs/web/home.spec.ts`, `qa/specs/web/clients.spec.ts`, `qa/specs/web/drawer-motion.spec.ts`, `qa/support/app.ts`, `qa/support/axe.ts`, `qa/support/motion.ts` (new), `qa/support/i18n.ts` (new); knowledge: `TECH_DEBT.md` (TD-067 resolved, TD-064 item 7 done), `TEST_PLAN.md`, `PATTERNS.md`, `designs/mut-82-home-inline-payment-tests.md`, `designs/mut-84-clients-split-view-tests.md`

---

## [Unreleased] - 2026-10-12 — Combined check after the parallel lanes (MUT-62, MUT-73, MUT-82, MUT-84)

**Why:** at the owner's request, MUT-62, MUT-73, MUT-82 and MUT-84 landed on main without running lint, typecheck or tests. Everything ran once on the combined tree (main `ff6225e`), in a separate worktree.

### Results
- `npm run lint`: 0 errors, 12 warnings. `npm run typecheck` and `npx tsc -b`: clean.
- `npx vitest run` (Node 22): 214 files, 3,141 passed, 4 skipped. The only failures were the 2 below, now fixed.
- `npm run test:bundles`: passed.
- `cargo test`: 15 passed. `cargo clippy --all-targets -- -D warnings`: clean.
- `release-qa run --attach --all`: 20 of the 21 `qa/` features passed. The 21st failed on a stale spec, fixed below; with the fix, all 5 `web.income` features pass.

### Fixed (tests only, no app change)
- **`exitSnapshot.test.ts`:** MUT-82 strips every id from a drawer's exit snapshot, so a drawer opened during the exit can't pick up the clone's form. Two tests still looked up the clone's fields by id.
  - They now find them by `name` and by class.
  - A new test checks that the clones carry no ids and the originals keep theirs. This is the regression test MUT-82 skipped while tests were paused.
- **`qa/specs/web/income.spec.ts` (`web.income.fast-path`):** on a 1280 px window the client opens beside the list (MUT-84). The spec's `getByText('$1,200').first()` then matched the list's hidden Owed now strip. It now reads the amount off the entry's own row.

### Files
`src/components/ui/drawer/__tests__/exitSnapshot.test.ts`, `qa/specs/web/income.spec.ts`

---

## [Unreleased] - 2026-10-12 — Home: record a payment straight from Needs attention, with Undo (MUT-82)

**Why:** every Needs attention row on Home opened the client's profile, so recording that a client paid took four steps and a page change (Home → profile → find the row → Record payment). Decision H1 of the approved Apple-design brief (`.claude/designs/landing-apple-redesign.md`, epic MUT-74) puts the action on the row. ADR-055; TD-064. Test plan: `.claude/designs/mut-82-home-inline-payment-tests.md`.

**Not run, at the owner's request:** lint, typecheck and tests are left to one combined run on main after every lane has merged. Before that instruction (and before merging main) they passed: vitest 198 files / 3,006 passed / 4 skipped, typecheck clean, lint 0 errors, the five browser specs 5/5. Not re-run since: the exit-snapshot id fix and the merge of main. The full browser suite and `test:bundles` were not run.

### Added
- **Record Payment on every Needs attention row**, always visible, in its own cell. It opens the existing payment drawer in place with the remaining amount and today (ADR-047). Its accessible name carries the amount ("Record Payment — Remaining: ₪3,550"); on Home it shows the label alone (`RecordPaymentButton` `compact`), because the amount cell is beside it.
- **The row slides out** when a payment settles it, and the rows below glide up (`src/lib/motion/rowExit.ts`, the ADR-044 snapshot idea for list rows, on the shared spring). Reduced motion fades it. A partial payment keeps the row with its new amount.
- **Undo** in a toast ("Recorded ₪3,550 from Acme Studio · Undo", `usePaymentUndo`): it deletes the payment record through the repository, which recalculates the entry, so status, remaining and paidAt return exactly. One Undo at a time; it still works after leaving Home; a failure says so.
- **Keyboard:** the client cell is a real link to the client (a button opening the entry when there is no client). A payment that settles a row moves focus to the next row's Record Payment; Undo gives focus back to the restored row.
- i18n (en, ar): `overview.paymentRecorded`, `overview.paymentRecordedNoClient`, `overview.undoFailed`.

### Changed
- **Needs attention reads Owed now's query**, `useReceivables({ profileId })`, and selects its rows with `selectAttentionReceivables` (`src/lib/attention.ts`), so the row and Owed now change in the same render. `transactionRepo.getAttentionReceivables` calls the same selector. Same list, same order; one IndexedDB read fewer on Home.
- `PartialPaymentDrawer` takes `onRecorded(record)`, carried by `openPartialPaymentDrawer({ transactionId, onRecorded })` and passed by `AppShell`; it is called before the drawer closes, for new payments only.
- Toasts: an optional `group` replaces the toast showing in that group; `ToastContainer` pauses a toast while it is hovered or focused; `useToast` no longer re-renders its caller on every toast.
- `src/lib/motion/presets.ts` holds `UI_SPRING` and `REDUCED_MOTION_FADE_SECONDS`; `drawerMotion.ts` re-exports them under its old names.
- Below 400 px of card width the Needs attention row puts its button on a line of its own (container query).
- `e2e/home-record-payment.spec.ts` (5 Playwright tests, written for this ticket, passed 5/5 before main was merged in) was dropped when main retired `e2e/` (MUT-97): **to port to `qa/` (MUT-97 kit)**. It covered, in a real browser: a full payment from a Needs attention row (the row's copy slides toward the inline end, more than 100 px, fading below 0.5, then goes; Owed now drops; focus moves to the next row's Record Payment; the toast reads "Recorded $1,200 from Acme Studio"; Undo brings the row and Owed now back with focus on the row's button); a partial payment (the row stays, named "Remaining: $1,000", Owed now $1,300); reduced motion (the copy only fades, x stays 0); Arabic (the copy slides left, below −100 px); and axe on Home with the buttons (the `home` surface). It needed `logIncome` to take a `dueDate` and a `localDateFromToday(days)` helper, which go with the port.

### Fixed
- A payment drawer opened while another drawer's exit snapshot was still in the page submitted the snapshot's form and reloaded the page: both forms had `id="partial-payment-form"`. Drawer snapshots now strip ids (`exitSnapshot.ts`).

### Files
- New: `src/lib/attention.ts`, `src/lib/motion/rowExit.ts`, `src/lib/motion/presets.ts`, `src/hooks/usePaymentUndo.ts`, `src/components/home/HomeAttentionRow.tsx`, `src/components/home/HomeNeedsAttention.css`; tests `attention.test.ts`, `rowExit.test.ts`, `usePaymentUndo.test.tsx`, `HomeNeedsAttention.test.tsx`, `ToastContainer.test.tsx`, `homePaymentKeys.test.ts`.
- Changed: `src/components/home/HomeNeedsAttention.tsx`, `src/components/drawers/PartialPaymentDrawer.tsx`, `src/components/layout/AppShell.tsx`, `src/components/ui/RecordPaymentButton.tsx`, `src/components/ui/ToastContainer.tsx`, `src/components/ui/drawer/{drawerMotion,exitSnapshot}.ts`, `src/lib/{stores,toastStore}.ts`, `src/db/repository.ts`, `src/lib/i18n/{types.ts,translations/en.json,translations/ar.json}`; tests `OverviewPage.test.tsx`, `PartialPaymentDrawer.test.tsx`, `RecordPaymentButton.test.tsx`, `stores.test.ts`, `toastStore.test.ts`.

---

## [Unreleased] - 2026-10-12 — MUT-84: on a wide window a client opens beside the Clients list

**Why:** opening a client replaced the list with the profile. Working through who owes you was open, check, record, back, next, losing sight of the list each time. Decision C1 in `.claude/designs/landing-apple-redesign.md` (approved 2026-10-11) settles a Mail-style split view. ADR-050. Test plan: `.claude/designs/mut-84-clients-split-view-tests.md`.

**Gates not run, at the owner's request.** The owner asked every lane of the epic to skip lint, typecheck and tests until all lanes have merged, then run them once on main. What did run, before that instruction:
- the targeted suites, once mid-build: 11 files, 178 tests passed. That was before the breakpoint moved to 1280 px and before main was merged in;
- `npm run lint` (0 errors) and `npm run typecheck` (clean), once mid-build, also before those two changes.

Not run at all: the full `vitest` suite, `test:bundles`, and any Playwright or `qa/` run. The split view's browser-level spec was not written (TD-067).

**Scope:**
- `src/router.tsx`: `/clients` is a layout route with `validateSearch: parseClientsSearch`, an index child and a `$clientId` child (`remountDeps: clientProfileRemountDeps`). The URLs are unchanged.
- `src/pages/clients/ClientsLayout.tsx` + `.css` (new): the top bar, the two panes, the profile pane's keys and the status line.
- `src/pages/clients/ClientsPage.tsx`: now the list pane. No top bar. Search and sort come from the URL model. Rows carry `data-client-id`; the open row is marked; the walk and the search box's ↓.
- `src/pages/clients/ClientDetailPage.tsx`: the profile body only; its top bar moved to the layout.
- `src/components/clients/clientsSearch.ts`, `useClientsSearch.ts`, `clientsSplitView.ts` (new).
- `src/lib/breakpoints.ts` (new): `BREAKPOINTS.clientsSplit`. `src/hooks/useMediaQuery.ts`: `useIsSplitView`.
- `src/lib/i18n/translations/{en,ar}.json`, `src/lib/i18n/types.ts`: `clients.split.profile`, `clients.split.showing`.
- Tests (written, not run since the stop): `ClientsLayout.test.tsx` (new), `clientsSearch.test.ts` (new), `useClientsSearch.test.tsx` (new), `clientsSplitView.test.ts` (new), `clientsSplitKeys.test.ts` (new), `useMediaQuery.test.ts`, `ClientsPage.test.tsx`, `ClientDetailPage.test.tsx`.

### Added
- **The split view.** From 1280 px (`BREAKPOINTS.clientsSplit`), opening a client keeps the list as a 360 px column (Client and Owed now) with the profile beside it. In Arabic the list is on the right. Narrower windows keep the full-page profile. Resizing across the breakpoint never remounts the profile: what was typed in it stays. Switching clients never remounts the list: its search, sort and scroll stay.
- **Keyboard, wide windows only:**
  - ↑/↓ on a client row open the previous/next client, and the profile follows. The muted rows are skipped, and the walk stops at either end.
  - Enter on the open row, or → (← in Arabic), moves focus into the profile. Escape, or ← (→ in Arabic), returns to the open row.
  - ↓ in the search box moves to the list.
  - Keys inside the profile's fields, menus and pickers are left alone, and so is Alt+←.
- **The selection is announced**: `aria-current="page"` on the open client's link, a tinted row, and a polite "Showing {name}" when the open client changes after the page loaded.

### Changed
- **The list's search and sort live in the URL** as one model (`?q=&sort=&dir=`), kept on `/clients/:id` and by every client link. The list no longer uses `useSortState`, which wrote behind the router, so a click on a client used to drop the sort.
- **History:** the first client opened from the list pushes; walking with the arrows replaces, so Back closes the profile. A click is still a link and pushes.
- **One top bar for the Clients area**: "Clients", or the open client's name with the breadcrumb and Edit.
- **Each client gets a fresh profile** (route `remountDeps`): Work filters reset and it opens at the top, as before.

### Technical
- Browser check (`web-mut84`, sample data):
  - split at 1440 and 1280 px, full page at 1279 and 375 px. At 1200 px, measured while it was still the token, the profile's tables scrolled sideways, so the token moved to 1280;
  - resized 1440 → 375 → 1440 with a Work search typed in the profile: the same DOM node, and the value kept;
  - the walk, Enter/Escape/←/→, the stop at the last client, the history length unchanged by walks, Back to the list;
  - search and sort kept in the URL through a walk; the list's scroll container is the same node;
  - Arabic (mirrored columns and keys) and dark mode. No console errors from the app (403s from external resources only).
- Debt: TD-067 (no browser-level spec; the unit tests have not run since the stop order).
- Found, not changed: `ProjectsPage` still sorts through `useSortState`, which writes with `window.history.replaceState({}, …)` behind TanStack Router and clears its history state.

---

## [Unreleased] - 2026-10-12 — MUT-73: device-to-device sync is retired (ADR-053)

**Scope (web, desktop and Tauri; the hosted server, the portal, JSON backup and the Flutter app are untouched):**
- Deleted:
  - `src/sync/**` except OAuth: HLC, op-log engine, conflict resolver, synced decorators, sync store, bundle encoder and crypto, with 4 test files and 131 cases;
  - `src/components/sync/**` (12 files);
  - `src/hooks/usePairingSession.ts`;
  - `src-tauri/src/sync/**` except OAuth: 7 files, 2,484 lines, 14 tests.
- Moved: `src/sync/transport/oauth-{client,flow,pkce}.ts` and their 4 test files to `src/services/oauth/`; `src-tauri/src/sync/oauth_callback.rs` to `src-tauri/src/oauth/callback.rs`.
- New:
  - `src-tauri/src/oauth/mod.rs` and `src-tauri/src/retired_sync.rs`;
  - `src/__tests__/noSyncModules.test.ts` and `src/db/__tests__/migration-v21.test.ts`;
  - `.claude/designs/mut-73-retire-sync.md` and its test plan.
- Edited:
  - `AppShell.tsx`, `SettingsPage.tsx`, `provider.ts`, `interfaces.ts`, `database.ts` (v21), `migration-safety.ts`;
  - `useQueries.ts`, `useIncomeQueries.ts`, `features.ts`, `tokenStore.ts`, `lib.rs`;
  - `Cargo.toml` / `Cargo.lock`, `package.json` / `package-lock.json`, `scripts/bundle-rules.ts`;
  - 9 test files, `README.md`, `TODOS.md`.

**Why:** device sync was broken in ways users could not see:
- transaction creates and edits were never captured (MUT-46);
- payments were captured but never applied (MUT-55);
- expenses never synced;
- conflicts could not be resolved from any screen.

The phone app is going hosted-only (MUT-63), so the owner dropped sync product-wide on 2026-10-11. Local↔hosted sync is off the roadmap, not deferred.

### Removed
- **Settings' Sync section** (Wi-Fi pairing, export and import of `.msync` bundles, the conflict count), the **conflict banner** and the **pairing, export-bundle and import-bundle modals**. All of it was hard-coded English, so Arabic users saw it untranslated. The sync status chip was already mounted nowhere.
- The **op-log and everything that wrote it**: `initializeSync()` no longer runs on every app load, and no write appends an op or calls the desktop over IPC.
- **The Tauri sync server:**
  - a plain-HTTP listener on `0.0.0.0` and mDNS discovery;
  - pairing and paired-device persistence;
  - bundle crypto;
  - 17 IPC commands and `SyncState`.
- **15 crates:** `mdns-sd`, `ring`, `argon2`, `base64`, `uuid`, `rand`, `hostname`, `chrono`, `thiserror`, `sha2`, `local-ip-address`, `urlencoding`, and `axum-server`, `rustls`, `rcgen` (nothing used these three). `rustls` is now built with `ring` only, from the updater, and `aws-lc-sys` leaves the build.
- **The `qrcode.react` npm dependency.**
- **Dexie v21 drops the eight sync tables:** `localDevice`, `trustedPeers`, `opLog`, `peerCursors`, `entityFieldMeta`, `moneyEventVersions`, `conflictQueue`, `syncHistory`. This is an explicit, narrow override of ADR-029 (ADR-053). A backup saved before the upgrade still restores: the sync tables are skipped.

### Changed
- **Mark paid, partial payments, payment create/edit/delete and business-profile archive** call the base repository instead of the sync decorator (8 call sites). They write the same rows. A failed op-log append can no longer reject a payment that was already stored.
- `getRepositories()` returns `{ base }`, and `ISyncedRepositories` is gone. TD-013's "synced does not follow a swap" caveat is resolved by deletion.
- **The Malafat OAuth client moved** to `src/services/oauth/` (TS) and `src-tauri/src/oauth/` (Rust, with its own `OAuthState`). Command names and behaviour are unchanged. It has no caller yet (TD-075).
- **Every desktop launch deletes `paired_devices.json` and `paired_devices.tmp`** from the app config directory. This is best effort: a missing file is success, anything else is logged and never blocks startup.
- **`npm run test:bundles` fails** if `.msync`, `start_sync_server` or "Export Sync Bundle" ever ships again.

### Technical
- **Decisions:**
  - ADR-053 supersedes ADR-011, ADR-012 and ADR-013;
  - it overrides ADR-029 for the eight sync tables only;
  - it closes the local↔hosted sync thread in ADR-023, ADR-024 and ADR-037;
  - notes on ADR-029, ADR-032, ADR-038 and ADR-039.
- **Debt and TODOS:**
  - TD-074: `migration-safety`'s hand-kept table list misses five live tables;
  - TD-075: the OAuth client has no caller;
  - TD-003 and TD-037 resolved;
  - TODOS items 1 and 3 retired (MUT-46 and MUT-55 close with this ticket).
- **Found during the desktop smoke, not caused by MUT-73:** the shipped `capabilities/default.json` grants no updater permission, so the in-app update check is rejected with "not allowed" in every build. Reported for a ticket.
- **Gates.**
  - Before the owner's skip instructions arrived, the gates ran once on this branch at `eaedf2f`. Results:
    - vitest: 2,857 passed;
    - Playwright: 26/26 on port 5198, on the `e2e/` suite MUT-97 has since retired in favour of `qa/` (replaced by the combined `qa/` run on main);
    - `test:bundles`: passed;
    - lint: 0 errors;
    - typecheck and `tsc -b`: clean;
    - `cargo test`: 15 passed, 0 warnings;
    - `clippy -D warnings`: clean;
    - debug Tauri build under `com.elmokhtbr.mutaba3a.mut73`: green.
  - After the instructions, **lint, typecheck, clippy and tests were not run at the owner's request**, pending the combined run on main. That covers the final merge of main into this branch. TEST_PLAN lists the acceptance criteria that rest on tests not re-run since.

---

## [Unreleased] - 2026-10-12 — Show what you did in the Income list (MUT-62)

**Why:** since MUT-5 the income entry is the work record, and its title ("What did you do?") is the drawer's first field. The `/income` list still read date · client · project · status · amount, so the work just logged wasn't visible there; only the client profile's Work list showed it. Found in MUT-5's browser pass, ticketed as a follow-up (epic MUT-1).

**Not verified by the gate:** at the owner's request, lint, typecheck and tests were **not run** for this change; they wait for the combined run on main after every lane merges. `npm run typecheck` and `npm run lint` (0 errors) did pass once midway, before the instruction and before the last CSS/class edits and the merge of main. `incomeRows.test.ts` and `TruncatedTitle.test.tsx` passed once at that point. The IncomePage, title-search and project page tests were written but **never run**, and no e2e was written. With no test run on the final tree, every acceptance criterion is unverified by tests. AC4 (RTL) has no automated test at all, and AC1–AC4 were checked only in the browser (TEST_PLAN.md lists each).

### Added
- **A What column on `/income`, right after the date.** It shows each entry's title and reuses the client profile's Work-list label (`clients.profile.work.what`: "What" / "العمل").
  - **Untitled or blank → a dash**, as the acceptance criteria ask. **This differs from the client profile**, which shows "Untitled" for the same entry. The owner chose the dash for `/income` and asked that the profile stay as it is (TD-076).
- **`TruncatedTitle`** (`src/components/ui/TruncatedTitle.tsx` + `.css`): the title on one line, cut with an ellipsis, as a button that opens the entry.
  - **Opening:** it opens the entry once (it stops the row's click), and it gives a titled row a keyboard path.
  - **Full title:** when the title is cut, hover or keyboard focus shows it in full, in a tooltip portalled to `<body>`. The tooltip is hoverable, Escape and blur dismiss it, it flips above near the window's bottom, and it is nudged inside the window. It is `aria-hidden`, because the button's name is the full title.
  - **Direction:** `dir="auto"` plus `unicode-bidi: plaintext`, so an English title in the Arabic UI (or the reverse) starts at its beginning. The attribute alone lost to theme.css's `:lang(ar)` rule (TD-048).
- **`EMPTY_CELL`** (`src/lib/utils.ts`): one dash for an empty cell. `/income`'s missing project now uses it (`'-'` → `'—'`).
- **`src/pages/income/incomeRows.ts`:** `toIncomeRow` (pre-shaped rows, built in `useMemo([transactions])`) and `incomeColumns(compact)`, two module-level column lists that drive both the header and every row (CLAUDE.md performance guardrails).
- **`index.css`:**
  - `td.work-cell` (`width: 40%; max-width: 0`) takes the spare width and cuts the title instead of widening the table.
  - `td.date-cell` (`nowrap`) keeps the date on one line beside it.

### Changed
- **`IncomePage`** renders its table from `incomeColumns` with a `renderCell` switch. The cells and actions behave as before, apart from the new column and the dash.
- **The project page's Transactions tab** (behind the Projects switch) gets the same What column after Date, with an income or expense title opening its own drawer, and `EMPTY_CELL` for a missing client or category. The legacy `/transactions` page is untouched: it redirects to `/income` (dead code, TD-025).
- **Search:** no change. `transactionRepo.list` already matched titles, so a title word typed in `/income`'s search, or carried in `?q=`, finds the entry (checked in the browser with English and Arabic words).

### At 375 px
The Income table already scrolls sideways at this width (557 px of content in a 261 px box, before this change). What stays visible and is cut. It adds about 59 px, mostly its own padding, and shows the first few letters with an ellipsis. Project stays hidden on a compact table, as before. Rows keep the title on one line; the client name still wraps, as before.

### Files
`src/components/ui/TruncatedTitle.tsx`, `src/components/ui/TruncatedTitle.css`, `src/components/ui/index.ts`, `src/lib/utils.ts`, `src/index.css`, `src/pages/income/IncomePage.tsx`, `src/pages/income/incomeRows.ts`, `src/pages/projects/ProjectDetailPage.tsx`. Tests: `src/components/ui/__tests__/TruncatedTitle.test.tsx`, `src/pages/income/__tests__/incomeRows.test.ts`, `src/pages/income/__tests__/IncomePage.test.tsx`, `src/pages/income/__tests__/IncomePage.titleSearch.test.tsx`, `src/pages/projects/__tests__/ProjectDetailPage.test.tsx`. Knowledge: COMPONENT_REGISTRY, PATTERNS, SYSTEM_OVERVIEW, TECH_DEBT (TD-076), TEST_PLAN, `.claude/designs/mut-62-income-work-column-tests.md`. No ADR (ADR-056 unused).

---

## [Unreleased] - 2026-10-12 — Retire `e2e/` for the `qa/` release-qa kit (MUT-97)

**Why:** MAL-1007 built a reusable, stack-agnostic release-qa engine (`~/Work/tools/release-qa`, the `/release-qa` Claude skill) plus a per-repo `qa/` folder, with the explicit goal of also serving Mutaba3a. MUT-97 is that port: a feature catalog that replaces the old hand-run `e2e/*.spec.ts` suite with change-scoped runs, recorded video and an approve/reject review page.

### Added
- `qa/qa.config.mjs`: single `web` app, no personas (mini-crm is local-first, single-user, no auth), git-tag release detection (`v*`), isolated worktree env (`.claude/worktrees/qa-release`) — no docker/Postgres needed, there is no server or shared database to isolate.
- `qa/features/web/*.yaml`: 7 areas, 21 features (9 core / 8 secondary / 4 tertiary) — `navigation`, `home`, `income`, `clients`, `record-payment`, `settings`, `drawer-motion`. Every `e2e/*.spec.ts` file's coverage was ported, including the standalone `accessibility.spec.ts` checks, which were folded into the flow test they exercise rather than kept as a disconnected parallel suite.
- `qa/specs/web/*.spec.ts`, `qa/support/{app,axe,qa}.ts`: the ported Playwright logic, restructured one test per feature id (`@web.<area>.<id>`), with `step()` captions for the recorded video.
- `make check-e2e` now runs `release-qa release --no-open` (was `npm run test:e2e`) — same "not part of a release, run it deliberately" posture, now with an isolated worktree, a dev server it starts itself, and a reviewable report instead of a bare Playwright run.

### Removed
- `e2e/` (8 spec files + `support/`) and the root `playwright.config.ts`. `@playwright/test` and `@axe-core/playwright` stay as root devDependencies — `qa/` resolves them the same way.
- `package.json` scripts `test:e2e`, `test:e2e:ui` (dead: their config no longer exists).

**Verification:** `release-qa lint` — 0 errors, 21/21 features automated. `release-qa run --attach --all` against a live `npm run dev` — 21/21 passed.

**Known gaps, not silently covered:** `release-qa run --all` also reported 142 changed files under `src/**` mapping to no feature — mostly optional/gated areas (expenses, retainers, planning, documents, recurring) that `e2e/` never covered either; MUT-97's scope was porting existing coverage, not writing new. `qa/` is not in any tsconfig program, so `npm run typecheck` doesn't cover it — the same gap `e2e/` had (TEST_PLAN.md, TD-004).

### Technical
- `.claude/PATTERNS.md`, `.claude/COMPONENT_REGISTRY.md`, `.claude/TEST_PLAN.md`: living references to `e2e/*` repointed to `qa/*`. Dated historical narrative (the 2026-10-12 "E2E port-over" section, per-ticket test-plan appendices) left as-is with a superseded note, not rewritten.
- Jira: MUT-97 created, linked (Relates) to MAL-1007.

---

## [Unreleased] - 2026-10-12 — Regenerate stale hosted-portal API types (TD-058, TD-072)

**Why:** `src/hosted/api/schema.d.ts` hadn't been regenerated since MUT-65 made `Payment.customerId` and `Receivable.projectId` nullable (personal-profile captures with no client/matter). `hosted:types:check` was already failing on `main`; mobile work (MUT-68) was about to start leaning on the stale types.

### Fixed
- `src/hosted/api/schema.d.ts`: regenerated via `npm run hosted:types` (1,038 insertions / 129 deletions against the current `server/openapi/openapi.yaml`).
- `src/hosted/pages/views/PaymentsList.tsx`, `src/hosted/pages/views/ReceivablesList.tsx`: guard the now-nullable `customerId`/`projectId` before the `Map.get` lookup, falling back to the existing "—" rendering instead of a type error.

**Scope:** `hosted:types:check`, `typecheck`, `lint`, and the hosted test suite (145 tests) all pass. No CI change needed — `hosted:types:check` was already wired into the Makefile gates.

---

## [Unreleased] - 2026-10-12 — `make release full`

**Why:** `make release web` and `make release server` (ADR-043) had no combined front door; releasing both meant running each by hand.

### Added
- `make release full` (and `make release full` via the `release` dispatcher): runs `release-server` then `release-web` as ordinary prerequisites — server first, so the API a release ships is already live before the frontend calling it goes out. Each half keeps its own preflight, gates, version bump and confirmation; declining one does not block the other.

**Scope:** `Makefile` only. Desktop (DMG, notarization, GitHub release) stays excluded, per ADR-043 — confirmed with Basel, not reopened. See ADR-043 addendum in `.claude/DECISIONS.md`.

---

## [Unreleased] - 2026-10-12 — MUT-83: Owed now on Home and Clients always match

**Why:** Home and the Clients list showed the same-looking Owed now block with different numbers and no explanation.
- Home counts income with no client, income of archived clients and income recorded for a client created in another business.
- The Clients list counted none of those, but did count a client's debts from other businesses.

Owner decision A (2026-10-12) and ADR-049 resolve it. The brief is H2 in `landing-apple-redesign.md`.

**Scope:**
- `src/db/aggregations.ts`:
  - new `owedNowRemaining`, `clientScopeOf` and `partitionOwedNow`;
  - `summarizeOwedByCurrency` now uses `owedNowRemaining`.
- `src/db/repository.ts`:
  - new `clientSummaryRepo.listOwedIndex`;
  - `transactionRepo.list` accepts `clientScope`.
- `src/db/interfaces.ts`, `src/types/index.ts`: added `ClientScope`, `OwedBucket` and `ClientOwedIndex`, plus `QueryFilters.clientScope`.
- `src/hooks/useQueries.ts`: added `useClientOwedIndex`, keyed `['clientSummaries', 'owedIndex', …]`.
- `src/hooks/useIncomeQueries.ts`: added `IncomeFilters.clientScope`.
- `src/lib/incomeSearch.ts` and `src/hooks/useIncomeFilters.ts` (both new).
- `src/router.tsx`: `/income` gets `validateSearch`.
- `src/components/clients/clientIndexRows.ts`: added `toOwedBucketRows`, `orderClientIndex` and `BUCKET_SCOPE`.
- Pages: `src/pages/clients/ClientsPage.tsx` and `src/pages/income/IncomePage.tsx`.
- `src/index.css`: muted rows, the scope chip, and the phone layout of the Clients strip.
- `src/lib/i18n/translations/{en,ar}.json`.
- `e2e/owed-parity.spec.ts` (new).
- Test plan: `.claude/designs/mut-83-owed-parity-tests.md`.

### Changed
- **The Clients strip equals Home's Owed now, per currency.** Both come from the same entries:
  - `listOwedIndex` reads the business's entries through `transactionRepo.list`, the read behind Home;
  - `partitionOwedNow` splits them into the client rows plus two muted rows;
  - the strip is `summarizeOwedByCurrency` over all of them.
- **Each business's Clients list counts only that business's entries.**
  - It lists the business's own clients, plus clients created elsewhere that have an entry here.
  - Owed now, overdue, last payment and activity on a row are this business's only.
  - The client profile page stays all-businesses (TD-065).
- **`/income`'s filters live in the URL as one object**: period, status, search and client scope, written with `replace`. With no parameters the page is as before. A chip names a client scope and clears it. An empty scoped list says nothing matched instead of "No income yet".
- **On a phone the Clients strip wraps.** The client count sits above Owed now, so a five-digit shekel figure no longer runs past the card.

### Added
- **"No client · N entries" and "Archived clients · N" rows** after the clients, muted, shown only when non-zero, and always last under any sort. They are labelled in English and Arabic, with Arabic plural forms. Each opens `/income` on the unpaid entries behind it, over all time.
- `transactionRepo.list({ clientScope: 'none' | 'archived' })`. "None" includes entries whose client row is gone, the same rule as the No client row.

### Technical
- TD-065 (shared client: row vs profile) and TD-066 (Income's strip ignores the page's filters) added.

---

## [Unreleased] - 2026-10-12 — MUT-87: Expenses Needs attention is one row per recurring rule

**Why:** three missed months of one recurring expense were three identical cards and 12 buttons for one decision (decision E1, `.claude/designs/landing-apple-redesign.md`). ADR-052. Test plan: `.claude/designs/mut-87-recurring-rows-tests.md`.

**Scope:**
- `src/components/expenses/recurringAttention.ts` (new: grouping, totals, month labels, snooze dates, amount reading), `RecurringAttentionList.tsx` + `.css` (new)
- `src/components/drawers/RecurringMarkPaidDrawer.tsx` + `.css` (new)
- `src/components/ui/CurrencyAmounts.tsx` + `.css` (new), `src/lib/currencyAmounts.ts` (new)
- `src/services/recurringExpenseService.ts` (`confirmPayments`, `skipOccurrences`, `snoozeOccurrences`; `frequency` on virtual occurrences), `src/db/interfaces.ts` + `src/db/expenseRepository.ts` (`recurringOccurrences.runAtomically`), `src/types/index.ts` (`VirtualOccurrenceDisplay.frequency`)
- `src/hooks/useRecurringExpenseQueries.ts` (batch hooks replace the single-payment ones), `src/hooks/useExpenseQueries.ts` (one additive change, below)
- `src/pages/expenses/ExpensesLedgerPage.tsx`; `src/components/ui/RecurringOccurrenceCard.tsx` + `.css` (read-only)
- Removed: `src/components/modals/RecurringConfirmModal.tsx` + `.css` (both modals), their export from `components/modals/index.ts`
- `src/lib/i18n/translations/{en,ar}.json`: `expenses.recurring.attention.*` added; five orphaned `expenses.recurring.occurrence.*` leaves (`confirmPayment`, `actualDate`, `editAmount`, `notes`, `notesPlaceholder`) removed

### Changed
- **One row per rule.** "Server hosting · $80 monthly · Aug, Sep, Oct not marked · $240", with the oldest payment's lateness under the amount, read like Home's Needs attention. The section header shows the number of rules and the total of each currency side by side (`CurrencyAmounts`), never combined.
- **One primary action, Mark Paid,** opens a small drawer: the rule's missed payments, oldest first, all checked, each with its date and an amount prefilled with the rule's amount. **Mark N paid** writes one expense per checked payment, **dated on its own expected date** (the old modal dated them today), in one all-or-nothing write.
- **Skip, Snooze and Edit rule moved to a ⋯ menu** (`useMenuButton`: focus on open, arrows, Escape returns focus) and apply to all of the rule's missed payments; Skip asks first. In the drawer each payment has its own Skip and Snooze. Snoozing is a view of the same drawer, with quick picks in the user's language.
- The forecast's cards are read-only.

### Fixed
- **Editing or creating a recurring rule now refreshes Needs attention and the forecast.** `invalidateRecurringRuleQueries` (`useExpenseQueries.ts`) didn't invalidate `dueOccurrences` / `virtualOccurrences`, so a rule edited from the row's ⋯ › Edit rule kept its old amount until a reload. Found in the browser check.

### Removed
- `RecurringConfirmModal` and `RecurringSnoozeModal` (no consumer left). The confirm modal's paid-date and notes fields go with it (each expense is dated on its expected date; notes stay editable on the expense).

### Technical
- `recurringOccurrences.runAtomically(work)`: one Dexie `rw` transaction over `recurringRules`, `recurringOccurrences` and `expenses`; the batch service functions loop over the existing single-payment functions inside it.
- Tests (+55 net): grouping and labels (15), currency order (2), batches on fake-indexeddb incl. rollback (12), batch hooks (3, replacing 3), list (5), drawer (10), page (4), i18n keys (5), rule-edit refresh (1), modals-gone guard (1). Full suite: 193 files, 2,930 passed, 4 skipped.
- Debt: TD-069 (Needs attention looks back only 90 days), TD-070 (the shared drawer is 480 px wide on a 375 px phone).
- Found, not changed: the page's "Total expenses" strip sums `db.transactions`, not the ledger's `db.expenses` (also found by MUT-58's smoke test).

---

## [Unreleased] - 2026-10-12 — MUT-66: the unsorted inbox, and filing an entry onto a profile

**Scope (server only; the portal and the offline app are untouched):**
- New: `server/src/routes/inbox.ts`, `server/src/inbox/compose.ts`, `server/src/inbox/cursor.ts`, `server/src/inbox/routes-keys.ts`
- `server/prisma/schema.prisma` + `server/prisma/migrations/20261012140000_mut66_inbox/` (one enum, one table, one index — purely additive)
- `server/src/repositories/ports.ts`, `prisma.ts`, `memory.ts` (the `InboxEntryRepository`)
- `server/src/auth/store-guard.ts` (the `'sessionOnly'` case), `schemas.ts`, `serializers.ts`, `app.ts`, `routes/admin-users.ts`
- Tests: `store-contract-inbox.ts` + its memory/Prisma runners, `inbox-ownership.test.ts`, `inbox/__tests__/compose.test.ts`, `__tests__/inbox-routes.test.ts`, `inbox-filing.test.ts`, `inbox-isolation.test.ts`; `store-guard.test.ts` and `route-security.test.ts` extended
- Design: `.claude/designs/mut-66-unsorted-inbox.md` + `-tests.md`

**Why:** MUT-63's promise is "log it in seconds", and the fastest way to break it is a capture flow that stops to ask which business the money belongs to. "General" at intake now means *unsorted*: a durable place to put an amount the moment it happens, with filing deferred to whenever the person is ready. Named blocker of MUT-68 and MUT-69.

### Added
- **`GET/POST /v1/inbox`, `PATCH/DELETE /v1/inbox/{entryId}`** — a person's own unsorted captures (kind, amount, currency, date, optional note and capture source). They send no `X-Mutaba3a-Profile` and declare no scope, reading `identity` exactly as `GET /v1/me` does, and join the organization-independent route set through their own module. A future `occurredOn` is accepted here on purpose: with no profile there is no timezone in which "today" means anything.
- **`POST /v1/inbox/{entryId}/file-as-expense` and `…/file-as-income`** — the entry becomes a real record on one chosen profile. Amount, currency, date and note come from the entry; only what it could not know is sent in the body, including the Received/Owed choice, which needs a client in the picture and so cannot be made at capture. Both require `Idempotency-Key` and reuse the existing middleware unmodified.
- **`InboxEntry`**, the first user-owned table: no `organizationId`, no FK to `Organization` or `Membership` (ADR-048). Keyset-paged `(createdAt desc, id desc)`.
- **`inboxEntryCount` on `GET /admin/v1/users/{userId}`** — one indexed count for support, never the contents.
- **`'sessionOnly'`** `MethodAccess`, the first guard case that is neither "any principal" nor a per-organization domain. `ENTRY_KIND_MISMATCH` joins `CONFLICT_REASONS`.

### Changed
- `ExpenseRepository.create`'s row insert moved into `createExpenseRow(tx, …)` so filing can compose it inside its own transaction. Behaviour is unchanged. Income reuses MUT-65's `createPaymentTx`/`createAdjustmentTx`, which were built for exactly this.
- API version `1.12.0-mut65` → `1.13.0-mut66`; `openapi.yaml` regenerated with the six operations.

### Fixed
- `store-contract-m4.ts` passed the literal `'user-1'` as `createdByUserId`. That column is a UUID in Postgres, so three MUT-65 cases passed against the memory store and failed against the real one — found because this was the first local `test:db` run with MUT-65's migration applied. See TD-072 and TD-073 for the two related gaps left open.

### Technical
- **Filing is refused in exactly the places a direct create is, and no more.** The design assumed MUT-42 already rejected future-dated expenses; it does not, so `file-as-expense` does not either, while `file-as-income` does because `POST /v1/income` does. Both are asserted against the direct route's own response rather than against a hardcoded status.
- Filing is the store's only cross-repository transaction. The entry is claimed by a delete *inside* the transaction, which proves ownership and kind and holds the row lock until commit: two concurrent filings of one entry yield exactly one record, and a financial write that throws rolls the delete back with it. Both halves are proven against real Postgres, not only the in-memory simulation.
- AC 5 is asserted twice: fifty inbox entries leave both summaries byte-identical, and the summary sources — enumerated from the directory, not hardcoded — contain no reference to the inbox at all.
- Gates: server lint, typecheck, build, `openapi:check`, `npm test` (1310) and `npm run test:db` (1397, all 82 files) green; root lint, typecheck and build green.

## [Unreleased] - 2026-10-12 — MUT-86: the Record payment drawer leads with what's left, with one primary button

**Scope:**
- `src/components/drawers/PartialPaymentDrawer.tsx` (rewritten form; history rows on theme tokens) + `PartialPaymentDrawer.css` (new)
- `src/lib/paymentEntry.ts` (new: `describePaymentAmount`, `minorToAmountInput`)
- `src/lib/dates.ts` (`isFuturePaymentDate`, moved from `src/db/repository.ts`, which now imports it)
- `src/lib/i18n/translations/{en,ar}.json`: new `transactions.partialPayment.titleLeft`, `paidInFull`, `stillOwed`, `addNote`; `markFullyPaid` removed
- `e2e/record-payment.spec.ts` (new); `e2e/support/axe.ts` (`paymentDrawer` surface)
- Tests: `PartialPaymentDrawer.test.tsx` (rewritten, 33), `paymentEntry.test.ts` (new, 19), `paymentDrawerKeys.test.ts` (new, 5), `dates.test.ts` (+5)
- Test plan `.claude/designs/mut-86-payment-drawer-tests.md`; ADR-047 (supersedes ADR-038 §5); TD-062, TD-063; TD-047 updated

### Changed
- **The drawer opens on the answer.** The title names the balance, for example "Record Payment · ₪3,550 left". One large amount field holds that balance, selected so that typing replaces it. A line under the field updates on every keystroke: "Paid in full" or "₪1,775 still owed". It reads Arabic-Indic digits. Typing more than is owed shows the overpayment message straight away.
- **The date reads "Payment date · Today ›"**, or the chosen date. Pressing the row opens the date field in its place. **Notes sit behind "+ Add note"**, which opens a focused Notes field.
- **One primary button.** Record Payment records and closes the drawer, so opening it and pressing Record Payment settles the entry for today ("Paid? Two taps."). Enter in the amount does the same. A partial payment closes the drawer too; before, the drawer stayed open with an empty amount.
- The amount is read with MUT-5's strict parser (`parseAmountInput`), not the lenient filter. "1,2" is refused with "Enter an amount like 1200 or 1,200.50", and "€100" in a dollar entry with the currency-mismatch message.
- Payment history appears below the form, only when the entry has payments. Its rows use theme tokens, so they read in dark mode. Before, they fell back to a light grey.
- With nothing left to record (create mode), the drawer says "Paid in full", lists the history and offers Close, instead of a form whose button could only be refused.

### Removed
- **Mark Fully Paid**, which duplicated Record Payment and dropped the notes, along with its `markFullyPaid` key in both locales.
- The 25 / 50 / 100% chips, which printed "₪887.5".
- The Amount / Received so far / Remaining box (its label and value ran together).
- The empty "No payments recorded yet" history, and the form's "Record Payment" sub-heading.

### Fixed
- **An edit no longer turns into a second payment.** An edit opened before the entry's records had loaded used to mount as a create form, prefilled with the remaining balance and titled "Edit Payment". Pressing its button recorded a new payment. The drawer now waits for the record.
- **An emptied payment date is refused** with "Date is required". Before, it was saved as an empty date.

### Technical
- `isFuturePaymentDate` (ADR-038, as amended) lives in `lib/dates.ts`, and both the repository and the drawer call it. The drawer's own `dateInput > todayISO()` comparison is gone.
- The new classes are prefixed `pay-drawer-`. `index.css` already has global `.payment-row` and `.payment-amount` rules (fixed widths, used by the document forms), and these squeezed the amount field to 120 px.
- Found while checking in the browser, and logged rather than fixed:
  - `formatAmount` prints a lone tenth ("$887.5") everywhere, including the new title (TD-062).
  - Sample-data part-paid entries carry a received amount with no payment record, so the first payment recorded on one drops it and Owed now rises (TD-063).

**Why:** decision P1 of the Apple-design brief. The drawer had two buttons for one outcome, one of which lost the notes. Its labels ran into their values. The chips printed "₪887.5". It showed an empty history.

---

## [Unreleased] - 2026-10-12 — MUT-80: Drawers open, close and drag on springs, and leave the way they came

**Scope:**
- `src/components/ui/drawer/` (new): `DrawerFrame.tsx`, `useDrawerMotion.ts`, `useDrawerFocus.ts`, `drawerGesture.ts`, `drawerMotion.ts`, `exitSnapshot.ts`
- `src/lib/motion/physics.ts` (new), `src/lib/dom/focusable.ts` (new); `src/hooks/useMenuButton.ts` uses `focusablesWithin`
- `src/components/drawers/Drawer.tsx`, `src/hosted/components/Drawer.tsx`: thin wrappers around `DrawerFrame`
- `src/index.css`: the drawer's `slideIn` / `slideInRTL` keyframes and the overlay's `fadeIn` animation removed; `touch-action: pan-y`, `.is-dragging`, no focus outline on the panel
- `package.json`: `motion` 13.4.4 (exact)
- Tests: `physics`, `focusable`, `drawerGesture`, `exitSnapshot`, `DrawerFrame` (new, 66 tests); `e2e/drawer-motion.spec.ts` (new, 3 specs)
- Test plan `.claude/designs/mut-80-drawer-springs-tests.md` (decisions D1–D17); ADR-044

### Added
- **Drawers move on springs.** They spring in from their edge (response 0.3, damping 1.0) with the overlay dimming in step.
- **Drawers leave the way they came.** Escape, ✕, the overlay, Save and Cancel all slide the drawer out along its own edge from wherever it was.
- **Drag to dismiss.** A horizontal drag follows the pointer 1:1 from where it was grabbed and rubber-bands past fully open. On release, momentum is projected: past half the width it closes, otherwise it springs back carrying the release velocity. A press catches a moving drawer where it is.
- Vertical scrolling inside a drawer, text selection in its fields and horizontally scrolling regions still work, because a press only becomes a drag after 10px of mostly horizontal movement.
- In Arabic the edge is mirrored. Under reduced motion, every move is a 150ms cross-fade.
- **Focus trap.** Tab and Shift+Tab wrap inside an open drawer, and focus returns to the button that opened it. There was no trap before.

### Changed
- Closing stays immediate for every caller (`onClose` contract unchanged). The exit is an inert, `aria-hidden` snapshot of the last frame, so it never shows reset or reloading content (ADR-044).
- The local and portal drawers share one frame, so the portal inherits all of the above (brief HP1).

### Technical
- New dependency `motion@13.4.4`, using only the vanilla `animate` and `motionValue`. Web entry chunk 193.93 → 216.51 kB gzip (+22.6 kB).
- Removing the drawer's global `slideIn` keyframe leaves `ProfilePickerModal.css` the only `slideIn`. The two had collided by name.

**Why:** decision R2 of the Apple-design brief. The drawer vanished in one frame on close, and couldn't be dragged or caught.


---

## [Unreleased] - 2026-10-12 — MUT-58: the money-event read side MUT-8 left without a screen is deleted

**Scope:**
- Deleted: `src/hooks/useMoneyEventQueries.ts`, `src/db/moneyEventRepository.ts`, `src/lib/monthDetection.ts`, and their tests `src/db/__tests__/moneyEvent.test.ts`, `src/hooks/__tests__/invalidateMoneyEventQueries.test.ts`, `src/lib/__tests__/monthDetection.test.ts`
- `src/types/index.ts` (the "Money Answers Types" block)
- `src/hooks/useQueries.ts`, `useExpenseQueries.ts`, `useRetainerQueries.ts` (one import and one call each)
- `src/hooks/__tests__/useQueries.test.tsx`, `useIncomeQueries.test.tsx`; `src/__tests__/noDeadMoneyEventModules.test.ts` (new)
- Test plan: `.claude/designs/mut-58-prune-money-events-tests.md`

**Why:** MUT-8 deleted Home's forecast strip, month actuals and guidance feed by decision (D10 = B, ADR-036 §3). They were the only readers of the money-event engine, so its eleven read hooks and the 842-line repository had no consumer. Every income, payment, expense and retainer write still refreshed nine query keys that nothing read. Closes TD-034.

### Removed
- **The money-event read side**: `useMoneyEvents`, `useDailyAggregates`, `useMonthSummary`, `useMonthKPIs`, `useMonthKPIsBothCurrencies`, `useGuidance`, `useDayEvents`, `useYearSummary`, `useYearSummaryBothCurrencies`, `useInvalidateMoneyEvents`, `moneyEventQueryKeys`, `invalidateMoneyEventQueries`, and `moneyEventRepo`, which had no provider or interface slot.
- **The refresh on every write.** `invalidateMoneyEventQueries` had three call sites on main, not the four the ticket counted: `invalidateTransactionQueries`, `invalidateExpenseQueries` and `invalidateProjectedIncomeQueries`. `useIncomeQueries.ts` needed no change, since it has reused `invalidateTransactionQueries` since MUT-5.
- **`src/lib/monthDetection.ts`**: its last importers were the MUT-8 components.
- **The twelve money-event and guidance types**, from `MoneyDirection` to `MoneyEventFilters`, including `GuidanceItem`.
- **Their tests**: 38 cases in three files.

### Changed
- The two MUT-6 tests asserting that a payment and Mark paid refresh the money-event keys now assert that no `money*` key is refreshed. Each sits next to a check that the write's own keys still are.

### Kept
- The `moneyEventVersions` table and the `MoneyEventVersion` type. They belong to sync versioning, not the read side. The Dexie schema and version are unchanged (ADR-029); the guard asserts that the table is still there.
- `src/lib/aggregations.ts` and its forecast types (`ForecastKPIs`, `MonthActuals`, `ForecastOptions`, `AmountByCurrency`, `AttentionItem`). They never had an app consumer, but the money-event files didn't keep them alive either, so they are out of scope and recorded as TD-071.

### Technical
- `noDeadMoneyEventModules.test.ts` guards the deleted paths, any import or call of them anywhere in `src/` (tests included, since they are outside `tsc`), the removed types, and the table's retention.
- Gate (Node 22): vitest 185 files, 2,843 passed, 4 skipped (was 187 / 2,875 / 4); Playwright 19/19 on port 5198; lint 0 errors; typecheck, `tsc -b`, build and `test:bundles` OK. Browser smoke on `web-mut58` covered income, mark paid and an expense across Home, Clients, Income and Expenses, with no console errors.

---

## [Unreleased] - 2026-10-12 — Release: one front door for both deploys (`make release web` / `make release server`)

**Scope:**
- `Makefile` (new): `release web`, `release server`, plus `doctor`, `preflight-web`, `preflight-server`, `check-web`, `check-server`, `check`, `bump-web`, `bump-server`, `migrate-status`, `clean-dist`, `help`
- `scripts/preflight.sh` (new): the release gate, per target
- `scripts/bump-version.sh` (new): the patch/minor/major/custom/keep prompt
- `scripts/confirm.sh` (new): the yes/no gate in front of an irreversible step
- `deploy.env.example` (new) + `.gitignore` (`deploy.env`)

### Added
- **`make release web`** — preflight → lint, typecheck, unit tests, hosted API types → version prompt → the three builds and the bundle guard → confirm → a commit holding only the version files → `git push origin main`, which is what Netlify builds.
- **`make release server`** — preflight → server lint, typecheck, tests, `openapi:check`, build → version prompt → confirm → the version commit → push so the deployed sha is reachable → `server/scripts/deploy.sh` (image, `prisma migrate deploy`, `terraform apply`, smoke), unchanged.
- **`scripts/preflight.sh`** — refuses to release from a tree that does not describe itself: merge/rebase in progress, conflicted files, wrong branch, dirty tree, a branch not merged into `main`, an extra worktree, behind `origin`, the wrong `node` major (TD-054), `node_modules` staler than the lockfile. Then per target: `netlify.toml` and push access; or gcloud + ADC, docker daemon, terraform, cloud-sql-proxy, tfvars, and a readable state bucket. Each override is a named variable (`ALLOW_DIRTY`, `ALLOW_UNMERGED`, `ALLOW_WORKTREES`, `ALLOW_NODE_MAJOR`, `SKIP_REMOTE`).
- **`make doctor`** — the same checks for both targets, read-only, non-fatal.
- The server deploy now points itself: `GCP_PROJECT_ID` comes from `project_id` in `production.tfvars` and `TF_STATE_BUCKET` from the last `terraform init`, and preflight fails if the two disagree. `deploy.env` is for overriding, not for setup.

### Changed
- The version is asked for, not assumed. `deploy.sh`'s `deploy_web` always incremented the patch and ran `git add .`; the new path prompts patch/minor/major/custom/keep and stages only `package.json`, `package-lock.json`, `tauri.conf.json`, `Cargo.toml`, `Cargo.lock`. `Cargo.lock` moves with the others so it cannot drift (the v0.0.65 Windows failure).

### Technical
- Nothing about either rollout is reimplemented: the server roll stays `server/scripts/deploy.sh`, and the app-version write is `deploy.sh`'s `update_version`, sourced rather than copied.
- ADR-043. Desktop (DMG, notarization, GitHub release) is untouched and still `npm run release`.
- Found by the first full run and left for its owner: **TD-058** — `src/hosted/api/schema.d.ts` is stale against `server/openapi/openapi.yaml` on `main`, and regenerating it fails `typecheck` in `ReceivablesList.tsx` and `PaymentsList.tsx` because MUT-65 made `Receivable.projectId` and `Payment.customerId` nullable. `make release web` is blocked until that lands.

---

## [Unreleased] - 2026-10-12 — TD-009: the structural axe violations on the core surfaces are fixed

**Scope:**
- `src/components/drawers/Drawer.tsx` and the hosted `src/hosted/components/Drawer.tsx` (`aria-labelledby` on the title)
- `src/components/filters/DateRangeControl.tsx` (named select and custom-range inputs)
- `src/components/ui/RowActionsHeader.tsx` + `.css` (new); used by `IncomePage`, `ClientWorkSection`, `ClientPaymentsSection`, `ProjectDetailPage`; the `.row-actions-header` rule moved out of `RecordPaymentButton.css`
- `src/pages/settings/SettingsPage.tsx`, `AdvancedFeaturesSection.tsx`; `src/index.css` (`.settings-label` is `display: block`)
- `src/lib/i18n/translations/{en,ar}.json`; `e2e/support/axe.ts`
- Test plan: `.claude/designs/td-009-axe-structural-tests.md`

### Fixed
- **Every drawer is a named dialog.** `Drawer` points `aria-labelledby` at its title, using an id from `useId()`. Its close button reads `common.close` ("إغلاق" in Arabic), not a fixed "Close". The portal's own drawer gets the same `aria-labelledby`. (axe `aria-dialog-name`)
- **The period filter has a name.** It is "Period" / "الفترة" on Income, the client profile and every other page that uses `DateRangeControl`. With Custom chosen, its two date inputs are "From" and "To". (axe `select-name`)
- **Settings' default-currency select is named by its visible label.** The label is now a real `<label for>`. `aria-labelledby` was tried first. It satisfied `select-name`, but axe's best-practice `label-title-only` then fired: it treats a labelledby target as hidden once it is scrolled below the fold, because `.main-content` and `.app-shell` are `overflow: hidden`. The row's description is its `aria-describedby`. (axe `select-name`)
- **The business profile's ⋯ button says what it is**: "Actions for <profile name>", with `aria-expanded`. (axe `button-name`)
- **The row-actions column has a header.** `RowActionsHeader` carries a visually hidden "Actions" in Income, in the client profile's work and payments tables, and in project detail. (axe `empty-table-header`)
- **Settings' headings are in order.** The section titles are `h2` under the page's `h1`, as Data Tools already was. They look the same: the class sets the size, and the reset zeroes the margins. (axe `heading-order`)

### Changed
- `KNOWN_AXE_VIOLATIONS` is down to `color-contrast` on every surface, which is left for MUT-74's palette work. MUT-79 had already removed `landmark-no-duplicate-banner`; the only `role="banner"` left is the demo-mode bar, which renders alone.

## [Unreleased] - 2026-10-12 — MUT-79: App frame — nothing floats over content

**Scope:**
- `src/components/layout/FxRateReadout.tsx` + `.css` (new), `popoverPosition.ts` (new: `nudgeInside`), `ThemeToggle.tsx` (new); `TopBar.tsx` (readout before the profile indicator), `SidebarNav.tsx` (`.sidebar-footer-row`: Settings + toggle), `AppShell.tsx` (bottom bars inside `<main>`)
- `src/hooks/useMenuButton.ts` (`{ kind: 'dialog' }`)
- `src/lib/theme/modes.ts` (new: `THEME_MODES`, `nextThemeMode`); `SettingsPage.tsx` renders `THEME_MODES`
- `src/components/ui/MacDownloadBanner.tsx` + `.css`, `UpdateBanner.tsx` + `.css` (in flow; `role="status"`)
- `src/lib/retiredStorage.ts` (new), called from `src/main.tsx`; `src/lib/platform.ts` (removed `isMacOS`/`isWindows`/`isLinux`)
- `src/index.css` (footer row, toggle; Settings' `.update-banner` card renamed `.settings-update-card`)
- `src/lib/i18n/translations/{en,ar}.json`; `src/test/setup.ts` (fetch guard)
- Removed: `src/components/ui/FxRateBanner.tsx` + `.css`
- Tests: `FxRateReadout`, `ThemeToggle`, `popoverPosition`, `themeModes`, `MacDownloadBanner`, `retiredStorage` (new); `useMenuButton` (dialog mode), `SidebarNav.features`, `TopBar.addMenu`, `platform` (updated)
- Test plan `.claude/designs/mut-79-app-frame-tests.md` (decisions D1–D8); TD-049 resolved; TD-048 updated; TD-054

### Added
- **Exchange rate in the top bar.** A quiet `$1 = ₪3.06 ▾` opens a small dialog showing the dollar and euro rates to four decimals, where each came from (Live / Cached / Unavailable), the date of the rates, when they were fetched, and Refresh rates. The formula reads left to right in Arabic too. On a narrow window the panel shifts to stay inside `<main>` rather than being clipped.
- **Theme toggle beside Settings** in the sidebar footer, stacked on the collapsed rail. It cycles Light → Dark → System from the same list Settings shows, so the two always agree. Its icon is per mode, and it is named "Theme: Dark".
- `useMenuButton({ kind: 'dialog' })` for a small non-modal panel. Opening focuses the first enabled control (or the panel). Tab leaves past the last control and closes it. Escape or an outside press closes it, as with a menu.

### Changed
- **The Mac-app bar** shows only on a Mac (`currentDevice() === 'mac'`, so not on an iPad), in a browser, until it is dismissed. Storage errors no longer break it.
- **Both bottom bars**, the Mac bar and the desktop "update available" bar, sit in flow at the bottom of `<main>` instead of `position: fixed` over the page. The fixed update bar also used to start at the expanded sidebar's width when the sidebar was collapsed.
- The `fx.*` keys: `refresh` is now "Refresh rates"; new keys `title`, `readoutLabel`, `rateDate`, `updated` and `nav.theme`.

### Removed
- **`FxRateBanner`**, the draggable, minimisable floating panel that covered table rows on every screen. Its drag and position state, its `fx.bannerTitle`/`showBanner`/`minimize`/`drag` keys, and its `mutaba3a_fx_banner_state` key all went with it; `removeRetiredStorageKeys()` deletes that key from existing browsers at startup.
- `isMacOS`, `isWindows` and `isLinux` (TD-049), whose substring checks took an iPad for a Mac and Android for Linux.

### Technical
- Settings' update card used the class `.update-banner`, which is also the app-wide desktop bar's class. Once that bar sat in flow, the card's margin and border would have leaked onto it, so the card is now `.settings-update-card`.
- The test setup replaces `fetch` with a guard that rejects, because every page test now renders the readout. Tests that need `fetch` already stub it themselves.
- The test suite needs Node 22 (as in CI). Under Homebrew's Node 26, jsdom's `localStorage` is undefined (TD-054).

### Fixed
- Axe `landmark-no-duplicate-banner` on every app page (TD-009). None of the bars claims `role="banner"` any more: the FX banner is gone, the Mac bar is a plain `div`, and the update bar is `role="status"`. The rule is removed from `e2e/support/axe.ts`'s `KNOWN_AXE_VIOLATIONS`.

**Why:** decision A1 of the Apple-design brief: nothing floats over content (F15).

---

## [Unreleased] - 2026-10-12 — E2E: the stale Playwright specs run against the current UI (TD-004)

**Scope:**
- `e2e/accessibility.spec.ts`, `e2e/settings.spec.ts` (rewritten); `e2e/transaction.spec.ts` → `e2e/income-drawer.spec.ts` (rewritten); `e2e/navigation.spec.ts` (Welcome race)
- `e2e/support/app.ts`, `e2e/support/axe.ts` (new)
- TD-004, TD-009, TEST_PLAN, PATTERNS

### Fixed
- **The 13 failing e2e cases are updated or removed; the suite passes 19/19.** They opened paths outside the `/app` basepath and looked for pages, headings and a drawer that no longer exist (Overview, Transactions, Reports, Projects, the Income/Expense/Receivable switch).
- `navigation.spec.ts` checked for the Welcome dialog once with `isVisible()`. Under parallel load the dialog could mount after the check and swallow the first sidebar click. It now waits for the dialog.

### Changed
- **Axe covers the core surfaces**: Home (first run, and with an entry), Clients, a client's profile, Income, Settings, and the income drawer with More details open. The pages that existed all have violations today. The owner chose to baseline them, not fix them here, so each surface lists the rules it is known to break (`KNOWN_AXE_VIOLATIONS`, all described in TD-009). Any other rule fails the test.
- **Settings now checks what the controls do**, not just that they're visible: Arabic sets `lang`/`dir` and English restores them; Dark, Light and System set and clear `html[data-theme]`; Export downloads the default profile's CSV.
- **The income drawer by mouse**: an amount alone saves an Unpaid entry with No client; an empty amount shows "Amount is required"; Due Date hides when the status is Received. The keyboard path stays in `income-fast-path.spec.ts`.

### Removed
- Axe checks for Projects and Reports. They are optional areas, off on a fresh install, and their routes send you home. Transactions is gone too, because `/transactions` redirects to Income.
- The Income/Expense/Receivable type-switch case. A receivable is unpaid income (Earned or Invoiced), and expenses are their own optional area.

## [Unreleased] - 2026-10-12 — MUT-64: device sessions — native app sign-in for hosted accounts

**Scope:** `server/` only:
- `prisma/schema.prisma` and migration `20261011213616_mut64_device_sessions` (`SessionKind` enum, `sessions.kind`)
- `src/auth/{sessions,sign-in,middleware}.ts` (new: `sign-in.ts`), `src/routes/{sessions,device-sessions}.ts` (new: `device-sessions.ts`)
- `src/routes/{customers,projects,payments,receivables,agreements,attachments,summaries,retainers,vat,fee-proposals,expenses,expense-categories}.ts` (security array only)
- `src/{app,index,config,schemas}.ts`, `src/repositories/{ports,memory,prisma}.ts`
- `openapi/openapi.yaml`, root `src/hosted/api/schema.d.ts`, `.env.example`
- tests: `src/auth/__tests__/{sessions,sign-in,middleware}.test.ts` (new `sign-in.test.ts`, new `middleware.test.ts`), `src/__tests__/{routes-device-sessions,route-security,routes-sessions,routes-expenses,config}.test.ts` (new `routes-device-sessions.test.ts`), `src/repositories/__tests__/store-contract-sessions.ts`
- `.claude/designs/mut-64-device-sessions{,-tests}.md` (new), ADR-037 amendment

### Added
- **A bearer-token principal for native apps.** `POST /v1/device-sessions` (email + password, same throttle/lockout/anti-enumeration timing as the portal) returns a token (`mds_<secret>`, prefix distinct from an API key's `mut_`) instead of setting a cookie. `DELETE /v1/device-sessions/current` revokes it.
- **Exactly a portal session's access.** A device session is the `'session'` `Principal` for the writability matrix — same scopes, same store guard, same `X-Mutaba3a-Profile` organization selection — reachable on every route a cookie session is (13 route files' OpenAPI `security` gain `{ deviceSession: [] }`), minus the cookie-only `DELETE /v1/sessions/current`.
- **Revocable the same way a cookie session is.** One `sessions` table (`kind: 'cookie' | 'device'`) means the operator's password reset, disable, and explicit "revoke sessions" all cover device sessions with zero changes to `admin-users.ts`.
- **No same-origin check for a device token.** `authenticate()`'s CSRF/`Sec-Fetch-Site` enforcement stays scoped to the cookie branch; a native app has no comparable signal.
- **Device-session lifetime**: 30-day idle, 180-day absolute (`DEVICE_SESSION_IDLE_DAYS`/`DEVICE_SESSION_ABSOLUTE_DAYS`, optional, default applied) — longer than a cookie's 120 min/12 h, since capture happens days apart.
- **Audit gains `metadata.sessionKind`** on `user.signed_in`/`user.locked_out`, so an operator can tell a device sign-in from a portal one.
- **Contract.** New `deviceSession` bearer security scheme; `SESSION_EXPIRED` reused for an invalid/expired/revoked device token (not a new code).

### Changed
- **`auth/sign-in.ts` (new)**: the credential-verification core (dummy-hash timing, throttle/lockout, audit) extracted out of `routes/sessions.ts` so the cookie and device routes share one tested implementation instead of two copies. `routes/sessions.ts`'s existing test suite passes unmodified — the proof the extraction didn't change cookie sign-in behavior.
- **`middleware.ts`**: `authenticateSession`/the new `authenticateDeviceSessionToken` share a `validateSessionRecord` core; a `finishSessionAuth` helper is the tail both the cookie and device-bearer paths call after their own credential check.

### Verified
- Server gates: lint, typecheck, `openapi:check`, `hosted:types:check`.
- `npm test` (server): 1110 passed, 11 skipped. Root `npm run typecheck` (app + hosted programs): clean.
- `store-contract-sessions.ts` run against both `MemoryLedgerStore` and the Prisma-backed store (local Postgres).

## [Unreleased] - 2026-10-12 — MUT-65: personal hosted profiles accept income, clients and matters from the user

**Scope:** `server/` only.
- `prisma/schema.prisma` and migration `20261012090000_mut65_personal_income` (column-altering: `payments.customerId` and `receivables.projectId` drop `NOT NULL`; new `payments.{projectId,createdByUserId}` and `receivables.{title,createdByUserId,deletedAt}`)
- `src/income/{compose,__tests__/compose}.ts` (new); `src/routes/income.ts` (new); `src/routes/receivables.ts` (+settle)
- `src/auth/{writability,middleware,store-guard}.ts`, `src/routes/{sessions,customers,projects,payments,expenses,summaries}.ts`, `src/repositories/{ports,memory,prisma}.ts`, `src/{schemas,serializers}.ts`, `src/app.ts`
- `openapi/openapi.yaml`
- tests: `src/income/__tests__/compose.test.ts`, `src/__tests__/{income-routes,receivables-settle}.test.ts` (new); `src/auth/__tests__/writability.test.ts` (new); extensions to `src/auth/__tests__/store-guard.test.ts`, `src/__tests__/{writability-drift,writability-routes,routes-sessions,route-security,routes-m2..m8}.test.ts`, `src/repositories/__tests__/store-contract-m4.ts`, `src/retainers/__tests__/proration.test.ts`, `src/summaries/__tests__/compute.test.ts`
- records: the approved brief `mut-65-personal-profile-income.md` and its test plan; ADR-037 amendment; ADR-038 addendum

### Added
- **`POST /v1/income`** (session-only, `payments:write`): Received (optionally with no client at all, optionally carrying a matter) or Owed (a client is required — explicit or resolved from a matter, else `422 CUSTOMER_REQUIRED_FOR_OWED`). Received is an ordinary `Payment`, created through the existing M4 transaction unmodified; Owed is a new, agreement-less `Receivable` (`origin: ADJUSTMENT`), always `OUT_OF_SCOPE` VAT at a zero rate, due `EOM_15` of the occurred date by default (the existing `dueDateFor` helper, no new date math). `occurredOn` may not be later than today; a capture source (`app|siri|widget|quick_action|share`) lands on the audit row only, never persisted on the entity.
- **`DELETE /v1/income/{id}`** (undo): voids an unsettled Owed entry of the caller's own, or reverses an unallocated Received payment of the caller's own (the existing M4 `reverse()`), each idempotent on repeat calls. Never reveals another user's or another profile's row (404, not 403).
- **`POST /v1/receivables/{id}/settle`**: one payment + one allocation against a session's own receivable, no preview/allocation dance; `amount` defaults to the full outstanding, `paidAt` to today (and may not be later).
- **A personal hosted profile can now write customers, projects and payments through its own session** (hosted-portal.md §5a amendment): `sessionAccessFor`/`sessionScopesFor`/`mayWriteFor` make the session column of exactly these three matrix rows a function of the profile (`profileWriter === null` → read-write) rather than a constant; a Malafat-fed profile is unchanged (still read-only there). `POST /v1/customers` and `POST /v1/projects` now accept a session as well as an API key; a session's `externalReference` is refused (`EXTERNAL_REFERENCE_NOT_ALLOWED`); the audit actor is `actorOf(c)` (USER for a session) instead of always API_KEY.
- `receivables.createAdjustment` / `softDeleteAdjustment` and an internal `createPaymentTx`/`createAdjustmentTx` split on the Prisma repository (the `settleReceivable(tx, …)` idiom), so MUT-66 can compose a payment or adjustment inside its own transaction without re-touching this code.
- `receivables.getByIdIncludingDeleted`: the undo route's own idempotency re-check needs to see an already-voided row; every other reader keeps using the deletedAt-filtered `getById`/`list`.

### Changed
- **`GET /v1/me`'s `access` map is now computed per organization** (`sessionAccessFor`), not once from a static table — a personal profile's `access` actually reflects what it can write.
- **`Receivable.projectId` and `Payment.customerId` are now nullable**, rippling into `routes/payments.ts`'s allocation engine (a projectless receivable is never eligible there — Owed is read/settled through `/v1/income`/`/v1/receivables/{id}/settle` instead), the organization summary's per-customer breakdown (a clientless payment contributes to the currency block's own totals but keys no row), and the `ReceivableSchema`/`PaymentSchema` wire contracts.
- `expenses.ts`'s create route threads an optional `captureSource` into its audit metadata, the one existing write path the ticket names.
- Contract: new reasons `CUSTOMER_REQUIRED_FOR_OWED`, `EXTERNAL_REFERENCE_NOT_ALLOWED`, `PAYMENT_HAS_NO_CUSTOMER` (422) and `ALREADY_SETTLED`, `ALREADY_ALLOCATED` (409); an "Income" tag and description paragraph; API `1.12.0-mut65`.

### Deviation from the plan (verified against ground truth)
- The design doc's §4.1/§4.6 assumed `occurredOn`'s future-date rejection could reuse `assertNotAbsurdDate` (agreements/compose.ts), the same call `POST /v1/payments` makes on `receivedOn`. Read against the real code, that function only rejects a date **more than ten years ahead** — Malafat's `receivedOn` is not rejected for being merely tomorrow. Ticket AC 7 requires a real "not later than today" rule, so `income/compose.ts` adds `assertNotFuture` (reusing the existing `DATE_INVALID` reason, not a new one) instead. `payments.ts`'s own `receivedOn` check is untouched — out of scope for this ticket.

### Fixed — post-review pass (2026-10-12, four approved fixes, one commit each, each test-first)
- **`POST /v1/receivables/{id}/settle` only ever touches an app-captured entry** (`routes/receivables.ts`). It looked a receivable up by `organizationId` alone. On a Malafat organization whose integration is `DISCONNECTED`, `profileWriterOf` returns `null`, so a session holds `payments:write` over that firm's whole historical ledger and could settle a real `INSTALLMENT`/`RETAINER_CHARGE` directly, bypassing the allocation engine. `origin !== 'ADJUSTMENT'` is now a 404 — not a 403 — mirroring `DELETE /v1/income/{id}`'s non-leaking discipline. Pinned by `receivables-settle.test.ts` ("a non-ADJUSTMENT receivable … → 404, nothing written"), which seeds a real installment-origin receivable straight into the store.
- **Settle maps `InsufficientCapacity` to 409, not 500** (`routes/receivables.ts`). `store.payments.create` throws it when `applyAllocations`' `FOR UPDATE` re-read finds the capacity gone — the concurrent-settle race. It escaped to `app.onError` as a generic 500, which `idempotency.ts` then treats as a 5xx and releases the key for. Converted the way both pre-existing call sites do, reusing the registered `VERSION_MISMATCH` reason (the credit route's shape, same file, same situation). No contract change: the route already declared `conflictResponse`. Pinned by a store stub that arms the next `payments.create` to throw.
- **Undo can no longer void a receivable a settle just paid** (`routes/income.ts`, `repositories/{prisma,memory,ports}.ts`). The route checked `paidMinor`/`creditedMinor` and then called `softDeleteAdjustment`, whose `updateMany` neither locked the row nor re-asserted the guard — a settle landing in between left a POSTED payment allocated to a receivable every read path hides, and answered 204 as if nothing was owed. The guard now lives in the `WHERE` clause (`paidMinor: 0n, creditedMinor: 0n`) in both stores, the same shape as `payments.reverse` re-asserting `status: 'POSTED'` inside its own `updateMany`. A refusal surfaces as a record that comes back still undeleted, so no signature change was needed; the route answers the same 409 `ALREADY_SETTLED` as its pre-check. Pinned in `store-contract-m4.ts` (both stores) and by a route-level test that stages the race deterministically with a one-shot store interleave hook.
- **`GET /v1/summaries/customers/{id}` counts matterless Owed entries** (`routes/summaries.ts`). It consumed its receivables only through a per-project filter, so a `projectId === null` row — MUT-65's **default** capture shape — reached no bucket, and when it was the client's only row in a currency that whole currency block was missing. `GET /v1/summaries/organization` does count them, so the two endpoints disagreed about what one client owes; AC 3 names the client-detail surface. Matterless rows now fold into the client's currency block through `bucketize`, the same helper the organization summary uses (ADR-033: one definition of a bucket), and their currencies join the block set; they stay out of `projects[]`. The test title that had baked the gap in as expected behaviour is fixed, and the figure is now pinned against the organization summary's.
- **Out of scope by instruction** (reported, not fixed): the review's P2 list — memory-store org-blind FK checks, the dead `requestId` field, `GET /v1/me` advertising write on PATCH-less domains, the organization-independent-route guard's permissiveness, unbounded `dueDate`, the non-discriminated income schema, dead `sessionAccess()`/`sessionScopes()` exports. Recorded as TD-055.
- **Verified after the pass**: server `npm test` 1171 passed, 11 skipped (72 files, 11 skipped — the Prisma suites, no database here); `npm run lint`, `npm run typecheck`, `npm run build` and `npm run openapi:check` all pass. `openapi.yaml` regenerated once, for fix 1's description sentence.

### Verified
- **Mutation checks** (temporarily applied, confirmed failing, reverted): the undo route's ownership check; the `paidMinor`/`creditedMinor` guard before voiding an Owed entry; the `sessionScopesFor` wiring in `selectProfile`; the `mayWriteFor` change in `store-guard.ts`'s `storeRefusal`. Each genuinely breaks the relevant test when removed. The `deletedAt` exclusion from `listEligible`/`countOutstandingByProject` is pinned permanently in `store-contract-m4.ts`.
- `npm test`: 1159 passed, 11 skipped. lint, typecheck, build and `openapi:check` pass. `npm run test:db` and the migration against a live Postgres could not be run in this environment (no `DATABASE_URL`/`MUTABA3A_TEST_DATABASE_URL`) — flagged, not claimed.
- openapi.yaml diff on `/v1/customers`/`/v1/projects` is exactly a second `security` entry plus description text, confirmed by hand — no schema or operation shape Malafat's vendored contract pins changes. No vendored-contract test exists in this repo to run automatically (Malafat owns that file, in its own repository).

---
## [Unreleased] - 2026-10-12 — MUT-78: "Open the web app" lands straight in sample data, with no dialogs

**Scope:**
- `src/demo/visitorSample.ts` (new: `enterVisitorSample`, `leaveVisitorSample`, `countSessionAdditions`), `sampleSession.ts` (new: the session record), `sampleSessionStore.ts` (new), `useVisitorSample.ts` (new: `useVisitorSampleEntry`, `useLeaveSample`)
- `src/demo/seedData/index.ts` (`seedDemoData({ announceFeatures })`, returns `featuresEnabled`, never a second default), `profile.ts` (`createDemoProfiles({ existingDefault })`), `transactions.ts` + `expenses.ts` (dates capped at today via `dates.ts` `notAfter`), `src/demo/types.ts`
- `src/components/ui/SampleDataBar.tsx` + `.css` (new); `src/components/layout/AppShell.tsx` (entry hook, bar, "Setting up the sample…"); `src/components/modals/WelcomeModal.tsx` (held back while preparing)
- `src/content/download-config.ts` (`WEB_APP_URL` → `/app/clients?sample=1`)
- `src/lib/i18n/translations/{en,ar}.json` (`sample.*`, Arabic with all six plural forms)
- Tests: `src/demo/__tests__/{visitorSample,seedDates,useVisitorSample}.test.*`, `SampleDataBar.test.tsx`, `WelcomeModal.sample.test.tsx`
- ADR-042; TD-051; test plan `.claude/designs/mut-78-sample-entry-tests.md`

### Changed
- **The landing page's web-app link opens a sample business's Clients list in one tap** — no Welcome dialog over a demo confirmation, no "DEMO MODE" bar, no "Switched on for your existing data" notice. Before, the link opened the internal demo tool (`?demo=1`): two stacked dialogs, then an empty Clients list because "Default Profile" stayed selected while the sample lived in three other profiles.
- **One quiet line while looking around**: "You're looking at sample data. · Start with your own ›", in the content flow (it cannot cover a drawer). "Start with your own" removes the sample, anything added while looking around, and the optional areas the sample switched on, then lands on the first run. It asks first only when the visitor added things ("This also removes the 2 things you added…").
- The sample goes only into a database without the person's own data; otherwise the link just opens their app. A second visit reuses the sample instead of seeding again.
- The internal demo (`?demo=1`, freeze time, reset) is unchanged.

### Fixed
- The demo seed wrote payments and expenses dated after today (a "Last payment" of Oct 19 on Oct 11), against ADR-038. Both generators cap at today.
- Seeding next to an existing default profile made two defaults; the sample now becomes the default only when nothing else is.

## [Unreleased] - 2026-10-11 — MUT-5: the income entry is the work record

**Scope:**
- `src/components/drawers/IncomeDrawer.tsx` (restructured, same component)
- `src/lib/incomeEntry.ts` (new: `buildIncomeCreate`, `buildIncomeUpdate`, `shouldExpandDetails`, `isBelowRecordedTotal`, `recordedTotalMinor`, `resolveDefaultCurrency`)
- `src/lib/utils.ts` (`parseAmountInput`, `normalizeNumerals`)
- `src/db/repository.ts` (`transactionRepo.update`)
- `src/components/ui/EntityTypeahead.tsx`, `src/components/ui/ClientTypeahead.tsx`
- `src/hooks/useQueries.ts`, `src/hooks/useIncomeQueries.ts`
- `src/index.css`, `src/lib/i18n/translations/{en,ar}.json`
- `e2e/income-fast-path.spec.ts` (new)
- Brief: `.claude/designs/mut-5-income-fast-path.md` (decisions P1–P5, eng-review ledger R1–R8); ADR-039, TD-029 update

### Added
- **Fast path.** Title ("What did you do?", autofocused), amount and client are the only fields up front.
- **More details.** Status, due date, currency, date, project, notes and the profile sit behind a toggle. Its summary line names the defaults in use: status · currency · date · profile when there are several.
- **Defaults.** A new entry starts in its profile's `defaultCurrency` and follows a profile change until the user picks a currency. EUR is offered.
- **Profile.** It is asked up front only when none can be resolved. An invalid field inside More details reopens it.
- **Edit view.** On edit, More details opens only when the entry has a due date, project, notes, a non-default currency or no profile.
- **Amount input.** Arabic-Indic and Extended Arabic-Indic digits and the Arabic separators are accepted, through `parseAmountInput`. An ambiguous amount ("12,5", "1.200,50") is a field error, never a guess.
- **Typed client.** A client name typed but not picked: an exact match is picked on blur, and any other text blocks the save with a message.

### Changed
- **One keyboard model in every typeahead** (client, project and vendor; hosted client and project pickers):
  - typing highlights the first match;
  - Enter on a closed list submits the surrounding form;
  - Escape closes only the list.
- **The lenient parsers** (`parseAmountToMinor`, `parseCurrencyInput`) wrap `parseAmountInput`. `formatCurrencyInput` normalizes numerals first, so the payment drawer accepts Arabic digits.
- **One transaction invalidation list.** `invalidateTransactionQueries` is now exported and covers the `income`, `receivables`, `incomeOverviewTotals` and `incomeAttentionReceivables` keys too; `useIncomeQueries` reuses it.

### Fixed
- **Editing reset payment data.** Editing a paid entry reset its payment date to today, and editing a part-paid entry wiped what had been received. The drawer now leaves payment fields absent from the write unless the status really changes.
- **Record-backed entries** (paid through Mark paid / Record payment): their payment state belongs to their records (ADR-039).
  - The status is read-only in the drawer.
  - An amount below the recorded total is refused, in the drawer and in `transactionRepo.update`.
  - An amount change recalculates received and status.
- **Keyboard path.** Enter after picking a client re-opened the list instead of saving. Pressing Enter twice right after creating a new client now saves with that client: the drawer holds the save until the client exists.
- **Escape** in an open client list also closed the drawer and discarded the form.
- **No refresh after save.** A save from the income drawer didn't refresh the client profile or `/income` until you navigated away and back. This was pre-existing and was folded in at the owner's request.
- **Amount input type.** The amount input was `type="number"`, which rejected "1,200" and Arabic digits.
- **The payment drawer's currency prefix** (`.input-with-prefix`) had no CSS. It now renders as a joined prefix.
- **Arabic layout.** The amount stays left-to-right in Arabic: `:lang(ar) { direction: rtl }` in theme.css beat the markup's `dir="ltr"`.
- **Defaults line in Arabic.** Its parts no longer reorder: each one is a `<bdi>`.

### Technical
- **TDD:**
  - 41 drawer tests; 35 of them fail against the old drawer;
  - 27 `incomeEntry` tests;
  - `parseAmountInput` tables;
  - 6 `transactionRepo.update` tests;
  - 9 typeahead keyboard-contract tests;
  - 4 `ClientTypeahead` tests;
  - an i18n parity test;
  - 2 hook tests proving a drawer save refreshes `useIncome`/`useReceivables`.
- **E2E:** a Playwright spec for the keyboard-only path and Escape. It passed 10/10 with `--repeat-each=5` against the worktree dev server; the committed config pins port 5173 (TD-004).
- **Test count:** the skipped edit-mode drawer test is back.
- **Follow-ups:** MUT-60 (TD-029 write side + backfill), MUT-61 (Malafat client/matter intake), MUT-62 (title column in `/income`).

---
### Fixed (pre-landing review, `/qa-reconcile` → `/review`)

Seven specialist and adversarial reviewers ran. These fixes were all approved by Basel ("fix all as recommended"):

- **Amount parser.** It no longer guesses:
  - letters other than a currency symbol or code are refused ("2k", "50%", "5 ألف");
  - spaces group thousands like commas, threes only ("100 50" is refused);
  - a leading 0 group is refused ("0,500");
  - the drawer refuses more than 2 decimals, while the lenient wrappers round half-up on the digits;
  - results must be safe integers.
  The literal invisible bidi characters in `utils.ts` and its test are now `\u` escapes.
- **Due date.** A Received save leaves it untouched. It used to delete it, so a reopened entry never went overdue.
- **Repository invariant (ADR-039 amended).** With live payment records, `transactionRepo.update`:
  - strips `status` / `paidAt` / `receivedAmountMinor` and re-derives them;
  - rejects a currency change;
  - checks the recorded total only when the amount changes, so legacy overpaid entries can still be retitled.
- **Typeahead Enter safety.** Enter is held while a pick is still being saved (`aria-busy`) and while typed text is unpicked. Typing highlights the first *prefix* match or the create option, never a substring match. The input gains `aria-controls` / `aria-activedescendant`. A failed client create keeps the typed name unpicked.
- **Drawer.**
  - Status, currency and Save wait for the payment records.
  - Currency is locked on record-backed entries, with a hint.
  - A refused save shows a translated toast.
  - An edit of a missing entry never creates one.
  - The recorded amount in the Arabic error is bidi-isolated.
- **Invalidation.** Each money key is invalidated once per payment save. `['transactionDisplay']`, the payment drawer's remaining balance, now refreshes after edits. TD-021 is resolved.
- **Styles and copy.** The hint sits with its status selector, the disclosure label never wraps, and the RTL chevron rotates instead of mirroring. One apostrophe is straightened. The unused `drawer.transaction.title` / `titlePlaceholder` keys are removed.
- **Tests.**
  - Drawer cases: the queued save and its failure path, the records gate, the currency lock, currency kept on edit and duplicate, the refused save, the legacy retitle and the missing entry.
  - Typeahead Enter-safety and a11y cases.
  - Repository invariant cases.
  - Each-key-once invalidation.
  - An Arabic Playwright check, which fails without the CSS fix.
  - The two 30ms sleeps are replaced by settle signals.

### Fixed (adversarial re-review, 2026-10-11)

The re-review verified the pre-landing fixes and found one medium regression and eleven smaller gaps; all are fixed, each test-first:

- **Record Payment on a payment request** (`paymentRequestService.recordPaymentForRequest`) left a part-paid receivable unpaid while the document showed paid: it wrote `status` through `update`, which ADR-039 now strips. It calls `markPaid`. `updatePaymentRequestWithTransaction` updates the receivable before the document (ADR-039 amended).
- **Enter, Enter.** An Enter held while a new client is saving now submits the form once it exists, so the keyboard path no longer needs a pause. Typing or another key in between drops it.
- **Failed creates stay retryable.** `onSelect` may resolve to `false`: the held Enter is dropped, the typed name is unpicked again and Enter offers the create option once more. A failed client create over a client picked earlier no longer empties the box. (The project picker empties its box on a failed create, as before: no form guards unpicked project text; see the final pass below.)
- **Enter after Escape** reopens the list on the auto highlight, so the next Enter picks.
- **Vendor highlight.** Pickers can supply the highlight rule (`autoHighlight`, default in `typeaheadHighlight.ts`); the vendor picker highlights its 95%+ name or alias match over a vendor whose name merely starts with the text.
- **Amount parser.** The currency suffix pattern no longer backtracks quadratically (3.4 s on a 50k-space paste, now linear) and inputs over 64 characters are refused first. One currency token at most; £ is no longer stripped. Bidi embeddings, overrides and isolates are stripped.
- **Typed currency.** "€100" in a USD entry is refused with a field error naming both currencies, and More details opens on the currency. `amountInputCurrency` reads the token.
- **Payment records that fail to load** show a notice with Try again instead of a silently disabled Save.
- **FSI, not LRI,** isolates the recorded amount in the below-recorded message.
- **Op log.** `syncedTransactionRepo.update` logs the entry as stored, not the payment fields the repository refused.
- **Offline (ADR-040).** Local queries and saves no longer pause while the device is offline (`networkMode: 'always'`, `src/lib/queryClient.ts`); the live FX rate still waits for the network.
- **New debt:** TD-047 (other drawers still use the lenient parsers).

### Fixed (final verification pass, 2026-10-12)
- **"Now" was a future payment west of UTC.** `paymentRecordRepo` compared the UTC date of a full timestamp with the local today, so in the evening in the Americas `new Date().toISOString()` was "tomorrow". Record Payment on a payment request (now routed through `markPaid`) and Mark paid failed, with no message. A timestamp is future only when both its UTC and its local date are (`isFuturePaymentDate`); date-only strings are unchanged (ADR-038 amended).
- **A failed project create** kept the name in the box while `projectId` was empty, and nothing guards unpicked project text, so the entry saved without the project it showed. The box empties again, as before MUT-5.
- **An empty box highlights nothing,** even when the last typed text would.
- **New debt:** TD-050 (the document page's payment-request actions fail silently).

## [Unreleased] - 2026-10-12 — MUT-76: the hero shows who owes you, and offers one next step per device

**Scope:**
- `src/pages/landing/components/HeroSection.tsx` + `.css` (rebuilt), `components/mocks/{ClientsListMock,CountUpAmount}.tsx`, `heroCta.ts`, `useCountUp.ts`, `sampleData.ts` (`SAMPLE_CLIENTS`, `sampleOwedTotals`), `GetItSection` (`id="get-it"`)
- `src/lib/platform.ts` (`detectDevice`, `currentDevice`, `DeviceKind`); `src/pages/download/DownloadPage.tsx` uses it
- `src/hooks/usePrefersReducedMotion.ts` (new, shared)
- `src/lib/i18n/translations/{en,ar}.json` (`landing.hero.cta*`, `alt*`, `landing.sample.client2/3`)
- `public/assets/landing/hero-dashboard.png` deleted (the folder is now empty)
- Tests: `HeroSection.test.tsx`, `heroCta.test.ts`, `useCountUp.test.ts`, `usePrefersReducedMotion.test.ts`, `platform.test.ts` (+`detectDevice`)
- Test plan `.claude/designs/mut-76-landing-hero-tests.md`; TD-049

### Changed
- **The hero image is the Clients list, built in HTML** (brief L5, L6): Owed now per currency ($900 · ₪46,834.41, overdue in red), then three clients ranked by what they owe, with each one's overdue amount and oldest overdue age. App labels, app tokens, light/dark and RTL for free. The strip's totals are computed from the rows (`sampleOwedTotals`), so the picture always adds up.
- **One filled button per visitor** (L4): a Mac gets "Download for Mac · Apple Silicon (M1 or later)", a Windows PC "Download for Windows" (only if the release has an installer), everything else — phones, tablets, Linux, ChromeOS — "Open the web app". One text link offers the alternative: the browser for a download, "Desktop apps for Mac and Windows" (→ `#get-it`) for the web app.
- **The owed totals count up once on load** (600 ms, ease-out), skipped under reduced motion. The final value is laid out invisibly underneath so the width never changes, and screen readers get only the final value.
- The hero button no longer swaps to a white background on hover — the old light-mode hover made its label disappear (F10). It dims slightly and presses in on pointer-down.
- The headline is capped at 56px and the copy column widened so each beat sits on one line at desktop widths; headings use `text-wrap: balance`.

### Fixed
- `detectDevice` tells an iPad from a Mac (iPadOS 13+ reports `MacIntel`; touch gives it away) and Android from Linux. `DownloadPage` now uses it, so an iPad no longer gets the Mac card first. The older `isMacOS`/`isLinux` keep their behaviour (TD-049).
- `utils.test.ts` › `todayISO` compared the local date with a UTC date and failed every night from local midnight to the UTC rollover; it now compares local with local.

## [Unreleased] - 2026-10-11 — MUT-75: the landing page tells the true story, in chapters

**Scope:**
- `src/pages/landing/LandingPage.tsx`, `LandingPage.css` (rewritten), `landingCopy.ts`, `sampleData.ts`
- `src/pages/landing/components/`: `HeroSection` (copy, honest buttons), new `ChapterSection`, `PrivacyBand`, `GetItSection`, `PlatformIcons`, `mocks/{ClientProfileMock,RecordPaymentMock,ProfileSwitcherMock,useMockFormat}`; `FAQSection` rewritten (six questions, `aria-controls` + `hidden`)
- `src/content/download-config.ts` (`DOWNLOAD_URLS` moved here from `DownloadPage`, `WEB_APP_URL`)
- `src/lib/i18n/translations/{en,ar}.json` (`landing.*` rebuilt)
- Tests: `src/pages/landing/__tests__/LandingPage.test.tsx`, `landingCopy.test.ts`
- Brief `.claude/designs/landing-apple-redesign.md` (L1–L3, L7, L12); test plan `.claude/designs/mut-75-landing-story-tests.md`; ADR-041; TD-048

### Changed
- **The landing page leads with the product's job and says privacy once.** Hero: "Know who owes you. Keep it to yourself." Then three one-idea chapters with HTML mock-ups built from the app's own labels (a client's page, the payment drawer, the business switcher), one privacy band, Get it, a six-question FAQ. About 3,800px at 1440 wide, down from 7,200.
- **Honest about price and platforms.** "Free during early access"; no "Buy", "$49", "Universal" or "Intel" anywhere in the page content. The Mac download says Apple Silicon (the build is arm64-only). The Windows download is offered only when the latest release has an installer (`release.hasWindowsBuild`), otherwise the page says the installer isn't in this release — v0.0.65 has none.
- **The currency answer is built from code**: `CURRENCY_NAME_KEYS: Record<Currency, string>` + `Intl.ListFormat`, so it names USD, ILS and EUR and can't drift from the `Currency` type. The old copy said EUR in one place and USD/ILS in another.
- The data-loss warning moved from under the pricing cards into the backup FAQ answer.
- "Open the web app" links go to `/app` (was `/app?demo=1`, the internal demo tool); MUT-78 replaces this with a sample-data entry.

### Removed
- `TrustBadgesSection`, `ValuePropsSection`, `ProblemSection`, `CapabilitiesSection`, `ProofGallerySection`, `DownloadSection`, `PricingSection`, `FinalCTASection`, and the already-unused `UseCasesSection` and `PrivacySection`, with their CSS and i18n keys. Fourteen unreferenced screenshots in `public/assets/landing/` (`proof-*`, `usecase-*`, `screenshot-answers.png`). `hero-dashboard.png` stays until MUT-76 replaces it.

### Fixed
- The skip link was hard-coded English; it is now `landing.skipToContent`.

## [Unreleased] - 2026-10-11 — MUT-18/19/20/21: payment dates, and closing out three already-fixed test tickets

**Scope:**
- `src/db/repository.ts` (`recalculateReceivedAmount`, `markPaid`, `paymentRecordRepo.create`/`.update`)
- `src/hooks/useIncomeQueries.ts` (`useMarkIncomePaid`)
- `src/components/drawers/PartialPaymentDrawer.tsx` ("Mark fully paid", lifted `dateInput`, future-date validation)
- `src/pages/income/IncomePage.tsx`, `src/pages/projects/ProjectDetailPage.tsx`, `src/pages/transactions/TransactionsPage.tsx`, `src/components/clients/ClientWorkSection.tsx` (Mark Paid row action)
- `src/lib/i18n/translations/{en,ar}.json` (`transactions.partialPayment.futureDate`)
- Tests: `transactionRepo.test.ts`, `partialPayment.test.ts`, `paymentRecords.test.ts`, `useIncomeQueries.test.tsx`, `PartialPaymentDrawer.test.tsx`, `ClientDetailPage.test.tsx`, `IncomePage.test.tsx`
- ADR-038; TD-046

### Fixed
- **MUT-18 — "Mark paid" could not record a payment that happened earlier.**
  `markPaid`/`recordPartialPayment` already had an unused `opts.paidAt`
  parameter from an earlier partial fix, but nothing threaded a date through
  it: all four row-menu "Mark Paid" quick actions (Income, Transactions,
  Project detail, Client work) called the mutation with no date, and
  `PartialPaymentDrawer`'s own "Mark fully paid" shortcut silently discarded
  the date field sitting right next to it, calling the deprecated
  `useMarkTransactionPaid` instead. Separately, `recalculateReceivedAmount`
  (what every payment write funnels through) stamped a transaction's own
  `paidAt` with the recalculation instant instead of deriving it from the
  payment records it had just summed, so even the already-correct
  `PartialPaymentDrawer` date-entry path produced a wrong transaction-level
  date the first time a transaction crossed into fully paid.
  - Fix: `recalculateReceivedAmount` now derives `paidAt` from the latest
    payment record; the four quick actions open `PartialPaymentDrawer`
    (prefilled to the full remaining balance) instead of firing the dateless
    mutation; "Mark fully paid" now submits through the same dated
    `useCreatePaymentRecord` path as "Record Payment" via a `dateInput` state
    lifted out of the form; a future-dated payment is rejected with a
    translated inline error, enforced at the repository layer
    (`paymentRecordRepo.create`/`.update`) so no path can bypass it.
  - See ADR-038 for the full decision and alternatives considered.
- **MUT-21 — overdue-count test hardcoded March 2026 dates with no fake
  timers.** Confirmed already fixed on `main` (fake clock pinned to
  2026-03-14, fixture dates documented relative to it, due-today/due-yesterday
  asserted deliberately). Added the one missing boundary case the ticket's
  acceptance criteria named explicitly: due-tomorrow is asserted not-overdue.
  Swept the rest of the suite for the same real-clock-plus-hardcoded-date
  pattern (grep for `overdue`/`aging`/`dueSoon`/`lastActivity` assertions
  without `useFakeTimers`): no other production code computes "today"
  internally without an explicit `today`/fixed-clock parameter, so no further
  time bombs found.
- **MUT-19 — IncomeDrawer client dropdown / project filtering / status-reset
  tests.** Confirmed already fixed on `main`; all three tests pass, and the
  received→invoiced clear is verified at the repository level as the ticket
  required. The client field also resolves a concrete `profileId` even in
  "All Profiles" mode (falls back to the first profile), so clients remain
  selectable there too.
- **MUT-20 — ExpensesLedgerPage 18 failing tests.** Confirmed already fixed
  and merged (`8f7bb7b`), matching its Jira "Done" status. Verified the
  remaining acceptance criteria not obvious from the fix commit alone: the
  no-profile branch has its own dedicated test, `expenses.noProfileSelected`
  exists in both locale files, and there is only one expense test file so the
  "extract shared fixture" criterion doesn't apply.

### Technical
- `markPaid`'s already-fully-covered branch (`remaining <= 0`) now delegates
  to `recalculateReceivedAmount` instead of duplicating its status/paidAt
  logic inline.
- New tests: backdated full/partial payments, default-to-today, the
  month-boundary case the ticket named, future-date rejection at create/update,
  "Mark fully paid" under both today and a backdated date, and the
  due-tomorrow boundary.
- `useMarkTransactionPaid`/`useMarkIncomePaid` remain in place as
  repository/hook primitives — `synced-repository.ts` and
  `paymentRequestService` still call `markPaid` directly for reasons outside
  this ticket's scope — so only the UI call sites moved, not the primitives.
  `useTransactionActions.ts` carries the same dateless pattern but has no
  production caller; left alone and logged as TD-046 rather than deleted as a
  scope expansion of this ticket.

## [Unreleased] - 2026-10-11 — MUT-45: serve the hosted portal

**Scope:**
- `server/src/app.ts` (`AppDependencies.portal`, portal static/SPA-fallback serving, CSP header); `server/src/config.ts` (`PORTAL_DIST_DIR`); `server/src/index.ts` (wiring)
- `server/src/smoke.ts` (`GET / (hosted portal)` check); `server/Dockerfile` (`COPY dist-hosted ./portal`, `ENV PORTAL_DIST_DIR`); `server/scripts/deploy.sh` (builds and copies the portal bundle before the Docker build; widens the uncommitted-changes guard to the whole repo)
- `.github/workflows/server-ci.yml` (docker job builds the hosted bundle first, so the image CI proves matches what's deployed)
- `server/src/__tests__/{portal,config,smoke}.test.ts` (new/changed)
- `server/DEPLOYMENT.md` (§0, new §4c, §5, §8); `.claude/designs/hosted-portal.md` §9/§10; ADR-037 MUT-45 amendment

### Added
- **The hosted portal is live.** The API serves the built `dist-hosted/` bundle from the same Cloud Run service: `/assets/*` immutable-cached, any other non-API GET falls back to `index.html` for client-side routing, registered after every API route so a real route (or a genuinely missing `/v1`/`/admin` path) always wins over the fallback.
- **CSP on every response**: `default-src 'self'; connect-src 'self' https://storage.googleapis.com; img-src 'self' data:; frame-ancestors 'none'; form-action 'self'`. The `connect-src` addition resolves the gap the MUT-44 amendment flagged — receipt uploads `fetch()` a `PUT` straight to a GCS signed URL, which `'self'` alone would have silently broken.

### Changed
- `deploy.sh` now builds the hosted-portal bundle at the repo root and copies it into `server/`'s Docker build context before `docker build`; its uncommitted-changes guard now covers the whole repo, not just `server/`, since the image tag now names the portal source too.
- `server-ci.yml`'s docker job does the same, so the image CI builds and health-probes is the same shape that gets deployed, portal included.

### Technical
- **No custom domain.** The design brief's open "Domain" decision (an external HTTPS load balancer or a Cloudflare proxy, since Cloud Run domain mapping is unavailable in `me-west1`) is resolved by not doing either: ADR-037 decision 10 only requires one origin, which the bare `run.app` URL already is. `PORTAL_ORIGIN` and `TRUSTED_PROXY_HOPS` stay at their MUT-38 defaults. A branded domain is deliberately left for its own follow-up ticket.
- **No Terraform changes.** `terraform plan` is a no-op for this ticket; `terraform validate` passes.
- Corrected the ticket's stale "ADR-033" citation — that number is now a different, unrelated decision on `main`; ADR-037 is the actual reference.

## [Unreleased] - 2026-10-11 — MUT-44: hosted expense capture

**Scope:**
- `src/components/expenses/` (new, shared): `ExpenseFormFields`, `expenseFormSchema`; `src/components/drawers/ExpenseDrawer.tsx` (changed to use it, no behaviour change); new `src/components/__tests__/ExpenseDrawer.oneTimeFields.test.tsx`
- `src/hosted/api/client.ts` (`request()` gains PATCH + `idempotencyKey`/`ifMatchVersion`; expense/category/receipt operations); `src/hosted/data/expenseQueries.ts` (new), `queries.ts` (`useCursorList`, `Page` exported), `filters.ts` (`ExpenseFilters`, `ExpenseDrawerSearch`, `ExpensesPageSearch`)
- `src/hosted/components/`: `Drawer.tsx`, `ExpenseDrawer.tsx`, `ClientPicker.tsx`, `ProjectPicker.tsx`, `ReceiptUploader.tsx`, `expenseApiErrors.ts` (all new); `HostedTable.tsx` (`onRowClick`), `FilterControls.tsx` (`CategoryFilter`)
- `src/hosted/pages/views/ExpensesList.tsx` (new); `router.tsx` (`/expenses` route); `shell/HostedShell.tsx` (nav entry); `format/dates.ts` (`todayLocalISO`)
- `src/hosted/i18n/{en,ar}.json` (`hosted.expenses.*`, `hosted.filters.category`, `hosted.shell.nav.expenses`, `common.{save,cancel,delete,close,loading,saving}`)
- `scripts/bundle-origins.json` (`json-schema.org` added to `hosted`)
- `.claude/designs/mut-44-expense-capture.md` + `-tests.md` (new); ADR-037 MUT-44 amendment

### Added
- **Expense capture on the hosted portal** — the only write a hosted (Malafat-fed) tenant has. A drawer records or edits an expense (amount, currency, date, title, vendor, client, matter, category, notes) against MUT-42's API, deep-linkable via `?newExpense=`/`?expense=<id>` on the new `/expenses` route.
- **Receipt attachment** on an existing expense: PDF/JPEG/PNG up to 10 MB, a 10-receipt cap (counting only `READY`), start → signed-URL PUT → complete, matching the M6 attachment flow.
- **Shared expense form.** `ExpenseFormFields` (amount/currency/date/title/category/notes) now renders inside both the local `ExpenseDrawer` and the new hosted one; vendor/client/project stay host-specific slots (local's are Dexie-backed and create-capable; hosted's are read-only directory lookups with no server-side vendor concept at all).
- **Field-level error mapping.** MUT-42's `VALIDATION_FAILED`/`CONFLICT` reasons land on the owning form field or a toast, per `expenseApiErrors.ts`.

### Changed
- `HostedTable` takes an opt-in `onRowClick` (every other list is unaffected); `QueryView`'s `Empty` already supported an `action`, now used for "Record expense".
- The local `ExpenseDrawer`'s one-time-expense JSX is now `ExpenseFormFields` under the hood; its recurring mode, Dexie hooks and existing test are untouched.

### Technical
- `request()` (hosted API client) gains `PATCH` and `Idempotency-Key`/`If-Match` header support — the portal's first write ever needed either.
- The portal's mutation hooks live in `src/hosted/data/expenseQueries.ts`, not a `hooks/` dir: the lint ban on `(^|/)(db|sync|hooks)(/|$)` matches the path segment literally, regardless of whose hooks they are.
- `src/hosted/components/Drawer.tsx` renders the app's own `.drawer`/`.drawer-overlay` classes from the shared `src/index.css` (both builds already import it) rather than new CSS — same interaction and pixels as the local drawer.
- Receipt upload is a bare cross-origin `fetch` (`credentials: 'omit'`) to the storage bucket's signed URL, bypassing `request()`'s same-origin/`/v1/*` assumptions. Flagged on MUT-45 (comment 10956): its CSP needs the bucket origin in `connect-src`.

---

## [Unreleased] - 2026-10-11 — MUT-43: the hosted portal — sign-in and the money views

**Scope:**
- `hosted.html`, `src/hosted/**` (new): the portal build, its shell, sign-in, session handling, the six read views, typed client (`api/schema.d.ts` generated from `server/openapi/openapi.yaml`), `hosted.css`, en/ar dictionaries
- `src/lib/i18n/core.tsx`, `plural.ts` (new); `context.tsx` reduced to the app's state + persistence over the core
- `vite.config.ts` (a `hosted` branch; web/desktop unchanged and snapshot-pinned), `tsconfig.hosted.json` (new), `tsconfig.app.json` (excludes `src/hosted`), `tsconfig.json`, `eslint.config.js`, `package.json`, `.gitignore`
- `scripts/check-bundles.ts`, `bundle-rules.ts`, `bundle-origins.json`, `check-hosted-types.ts` (new); `scripts/__tests__/*` (new); `src/test/setup.ts` (browser shims guarded for node-environment tests)
- `.claude/designs/mut-43-auth-states.md` + wireframe, `mut-43-hosted-portal-tests.md` (new); `hosted-portal.md` and ADR-037 (Malafat sign-in removed; MUT-43 amendment)

### Added
- **Hosted portal** (`npm run dev:hosted`, `build:hosted` → `dist-hosted/index.html`). Email + password sign-in on MUT-38's session API, with no signup, reset, invite or third-party door. Every auth state in the approved addendum (`mut-43-auth-states.md`):
  - boot check and the boot-unreachable card;
  - the one 401 banner with the lockout hint, and `Retry-After` plurals;
  - a safe `next`, and the expired vs signed-out notes;
  - no profiles, and profile unavailable;
  - a sign-out failure that keeps the person signed in;
  - cross-tab sign-out, and account-locale precedence.
- **Shell and switcher.** Hosted profiles only; each has a "Hosted" chip and its source sentence, and a footer says local profiles stay on the device. Switching keeps the section and never shows the other profile's figures.
- **Views:** Overview (strip + clients, overdue first, a currency switch only when more than one currency has figures), Clients (search), Client detail (summary + matters; receivables / payments / documents tabs), Receivables, Payments (with allocations), Documents (signed-URL download, no preview).
  - Each view has four states, and **a view in error renders no data**.
  - Income views explain why they are read-only.
  - Filters are one URL object, updated with `replace`.
- **`DecimalAmount`** formats wire decimal strings with `Intl.NumberFormat`, never `Number()`.
- **`tp()`** plurals over `Intl.PluralRules` (ADR-019, no ICU parser).
- **`npm run test:bundles`** proves the separation on the built output:
  - web and desktop carry no portal endpoint, cookie or header;
  - the portal carries no IndexedDB, Dexie, service worker or self-service copy (en/ar);
  - neither carries an origin outside `scripts/bundle-origins.json`.
- **`npm run hosted:types:check`** fails when the typed client drifts from the contract.

### Changed
- `npm run typecheck` checks two programs: `tsconfig.app.json` (which no longer sees portal code) and `tsconfig.hosted.json`.
- The app's i18n is split into a translation-free core and the app provider; the provider's behaviour is unchanged (tested).

### Fixed (found by running the portal against the real API on a scratch database)
- Sign-out: the signing-out tab heard its own cross-tab announcement and cleared the cache under the mounted sign-in check, leaving an endless spinner. One channel per tab now sends and listens.
- `vite --mode hosted` served the local app at `/` in dev.

### Technical
- Lint guards for `src/hosted/**`: no local data layer, sync, hooks, shell, drawers, stores or app i18n provider; no `Number()`/`parseFloat`/`parseInt`/unary `+`. Proven by `scripts/__tests__/hosted-lint.test.ts`.
- Root suite: 151 files, 2462 passed, 5 skipped. MUT-43's own tests: 163.

---

## [Unreleased] - 2026-10-11 — MUT-59: repair migration for databases that applied the original M7

**Scope:**
- `server/prisma/migrations/20261011120000_mut59_fee_proposal_enum_repair/` (new)
- `server/src/repositories/__tests__/migration-mut59.test.ts` and `fixtures/m7_fee_proposals.acb1144.sql` (new)
- `server/DEPLOYMENT.md` §7–8, `.claude/{DECISIONS,PATTERNS,TEST_PLAN}.md`, `money-v1-handover.md`

### Fixed
- **Approving a fee proposal failed in production.** The database had applied the original M7 enum before M8 edited that migration in place. The forward repair migration:
  - is guarded, and a no-op where the schema already has M8's shape;
  - audits each touched row as `SYSTEM` `fee_proposal.repaired` with its old values;
  - maps `CONVERTED` → `APPROVED` (date and amount from M7's fields or the agreement) and `CLIENT_APPROVED`/`AGREED` → `PROPOSED`;
  - refuses, all or nothing, on a `CONVERTED` row without an agreement or a project with two open proposals;
  - recreates the enum and drops `agreedOn` and `agreedNote`.

### Changed
- **ADR-027 decision 5 (D20)** gets an override log: its premise that nothing was deployed was false.
- **New pattern:** migrations are append-only once merged.
- **`DEPLOYMENT.md` §7** explains how the repair ships, and the recovery if it refuses.

### Verified
- **`test:db`:** 5 new cases on scratch databases built as production was: repair, idempotence, two refusals, fresh no-op.
- **Rehearsal of the real path:** `migrate deploy` of the acb1144 history, then of `main`, plus a refusal and the `migrate resolve --rolled-back` recovery.
- `npm test` 1056 passed and `test:db` 1122 passed; lint, typecheck, build and `openapi:check` pass.

---

## [Unreleased] - 2026-10-11 — Deployment record after the hosted-epic deploy; vendored-contract command fixed

**Scope:** `server/DEPLOYMENT.md`, `server/src/scripts/export-openapi.ts`, `.claude/INFRA.md`, `.claude/designs/money-v1-handover.md`.

### Fixed
- **The vendored-contract command (`DEPLOYMENT.md` §4a)** failed three ways for the operator on 2026-10-11, all now documented, with a `node -e` validity check after the redirect:
  - run from the repository root it is `Missing script` (the script lives in `server/`);
  - the shell's `>` had already emptied Malafat's file to 0 bytes;
  - without `-s`, npm's banner made the file invalid JSON.

  The note `export-openapi.ts` writes into every generated file now says `-s` too.
- **Piped `openapi:json` output was cut at about 64 KB.** `export-openapi.ts --json` called `process.exit` before stdout drained, so `| jq` and the like got truncated JSON (a file redirect was unaffected). It now waits for the write.
- **Two sections were numbered §4a.** The portal-access section is now §4b.

### Changed
- **`DEPLOYMENT.md`:**
  - §0 lists the session-pepper secret and the attachments bucket;
  - the stale M1-era "Tickets to close" becomes **§7 Production record**: every Cloud Run revision with its commit and time (read from Cloud Run, Artifact Registry and Secret Manager), Malafat's production release, and the firms;
  - §8 lists the current next steps.
- **`INFRA.md`** now shows the service in production at `ced04f7` and its URL.
- **The M8 handover** records that Malafat `web@2.2.4` shipped M8 (so §2's mismatch is closed) and that §2a is now reachable.

### Found
- **Production probably still has the original M7 fee-proposal enum.**
  - Revision `00003` rolled `acb1144` on 2026-10-09; M8 later edited that migration in place; `prisma migrate deploy` never re-runs a recorded migration.
  - Approving a proposal (offered by Malafat `web@2.2.4`) would fail with an enum error.
  - The read-only check and the repair migration's requirements are in `DEPLOYMENT.md` §7. The repair is not written yet.

---

## [Unreleased] - 2026-10-11 — MUT-42: expenses on the hosted ledger

**Scope:** `server/` only.
- `prisma/schema.prisma` and migration `20261011080000_mut42_expenses` (additive: `expenses`, `expense_categories`, `expense_receipts`)
- `src/expenses/{compose,cursor,names,presets,summary}.ts` (new); `src/routes/{expenses,expense-categories}.ts` (new)
- `src/auth/{scopes,store-guard,writability,middleware}.ts`, `src/{idempotency,app,schemas,serializers}.ts`, `src/attachments/rules.ts`, `src/routes/audit.ts`, `src/repositories/{ports,memory,prisma}.ts`
- `openapi/openapi.yaml`, `README.md`
- tests: new store contract (memory and Postgres), unit tests (summary, presets, cursor), `routes-expenses` and `expenses-invisible`; additions to the rules, scopes and guard tests; `route-security` and `writability-routes`; version pins
- records: the approved brief `mut-42-hosted-expenses.md` and its test plan; ADR-037 amendment; TD-041

### Added
- **Expenses on a hosted profile, sessions only.**
  - Record, list (newest first, with filters), read, change (`If-Match`; the currency never changes) and soft-delete.
  - Each expense keeps its original amount and currency. A client or matter link is optional; a matter alone brings its client, and currencies are never compared.
  - Personal versus firm-associated is the profile. There is no classification field.
- **Receipts:** the M6 signed-URL flow, on the same bucket and TTL, under `org/{id}/expense-receipts/{receiptId}`, in a table of their own. At most 10 per expense; uploaded by a user (`uploadedByUserId`).
- **Categories:** per profile, as offline (name, colour, archive).
  - The first list seeds a preset in the user's language, as `SYSTEM`: law-firm on a Malafat-fed profile, general on a personal one.
  - A parity test keeps the presets equal to the offline app's.
- **`GET /v1/summaries/expenses?from&to`:** defaults to this month. One block per currency, broken down by category and by client (`null` = linked to no client).
- **Audit:** actor `USER` with the user id on every write.

### Changed
- **Expenses are invisible to Malafat's key.** The routes are session-only.
  - The store guard gains `{ read: Domain }`, so expense reads are refused to a key below the routes.
  - `GET /v1/audit` leaves expense activity out.
  - Session idempotency keys are namespaced per user, so `GET /v1/operations/{key}` can't return them.
- **`expenses:read` and `expenses:write` are session-only scopes** (`SESSION_ONLY_SCOPES`). They can't be issued to a key, and Malafat's scope vocabulary is unchanged.
- **Small refactors:** `checkFile` is factored out of `checkUpload`, and `sessionAuth(c)` is the session counterpart of `keyAuth(c)`.
- **Contract:** reasons `PROJECT_CUSTOMER_MISMATCH`, `CATEGORY_NOT_FOUND`, `CATEGORY_ARCHIVED`, `TOO_MANY_RECEIPTS` and `CATEGORY_NAME_TAKEN`; an "Expenses" tag and description paragraph; API `1.11.0-mut42`.

### Verified
- **Canary sweep:** every key-readable operation, handed every expense, receipt and category id, returns none of the canaries.
- **Mutation checks:** removing the audit exclusion or the key namespacing fails the invisibility tests.
- **The migration** applies from an empty database with no schema drift.
- `npm test`: 1056 passed, 10 skipped. `npm run test:db`: 1117 passed. lint, typecheck, build and `openapi:check` pass.
- **MUT-39's carried criteria hold:** a session writes an expense on a Malafat-fed profile, and the key is refused on all 13 expense operations.

---

## [Unreleased] - 2026-10-11 — MUT-39: server-enforced writability on hosted profiles

**Scope:** `server/` only. No schema change.
- `src/auth/{store-guard (new),writability,middleware}.ts`, `src/{app,errors}.ts`
- `src/routes/{summaries,receivables,agreements,retainers}.ts`, `openapi/openapi.yaml`
- tests: `src/auth/__tests__/store-guard.test.ts`, `src/__tests__/{writability-drift,writability-routes}.test.ts` (new); `route-security.test.ts`; version pins in `routes-m*`
- records: `.claude/designs/hosted-portal.md` §5 "As built", `mut-39-writability-tests.md`, ADR-037 amendment

### Added
- **`403 READ_ONLY_PROFILE { domain, writerOfRecord }`.** A session that writes customers, projects, agreements, payments or attachments gets this refusal.
  - It comes from `authenticate()` on the key-only write routes, and from `requireScope` should a session-reachable route ever need a write scope.
  - `writerOfRecord` is `MALAFAT` when the profile's Malafat integration is CONNECTED, otherwise `null`. It is resolved only for a member organization, so a non-member's is never revealed.
  - Every other key-only route still answers `PRINCIPAL_NOT_ACCEPTED`, as before.
- **A store guard below the routes (`auth/store-guard.ts`).**
  - `STORE_ACCESS` classifies all 98 repository methods: 53 read, 8 control, 8 operator and 29 writes, each in one matrix domain. It is typed over `LedgerStore`, so a new method does not compile until it is classified.
  - Every route factory now receives `requestScopedStore(store)`. Each repository call checks the guard `authenticate()` put on the request: the session column for a session, the API-key column for a key.
  - Provisioning (`operator`) is refused under any guard.
- **Route scopes are readable.** `requireScope` tags its middleware, and `buildRouteAccessIndex` reads the tags from `app.routes`, so every operation's scopes are known without a second declaration.
- **The matrix const carries the brief's "Routes covered" cell,** and a drift test compares the two cell by cell.

### Changed
- **Lazy posting by the portal's reads** (three summaries, the receivables list, the agreements list and detail, retainer charges) goes through `lazyPostingOf(c, store)`:
  - a key posts through the guarded store as itself;
  - a session posts as `SYSTEM` on `unguarded(store)`.
  `unguarded()` has no other caller, and a test pins both functions' call sites.
- **Contract.** Error code `READ_ONLY_PROFILE`; a "Writability" paragraph in the API description; API `1.10.0-mut39`.

### Verified
- Generated route tests cover every key-only operation for a session naming a Malafat-fed profile, a personal profile and a non-member, with nothing written. They also cover the AC's income, receivable, payment and customer writes, lazy posting as `SYSTEM` on all seven reads, and that the other profile's organization id never reaches any store call.
- Mutation checks: with layers 1–2 off, the AC cases fail. Lazy posting without `unguarded` gets 403 on every read, which shows the guard is beneath them.
- `npm test`: 924 passed, 9 skipped. `npm run test:db`: 978 passed. The local test database was re-migrated first: it had only the first of nine migrations applied.
- lint, typecheck, build and `openapi:check` pass.

### Not in this ticket
- The expense AC ("an expense write succeeds"; "Malafat's key cannot see, read or write expenses"): no expense routes or store methods exist until MUT-42.
  - The guard rule is tested: a session may write expenses, the key may not.
  - Expense routes will declare `[{ session: [] }]`.

---

## [Unreleased] - 2026-10-11 — MUT-38: session auth, a second principal beside API keys

**Scope:** `server/` only:
- `prisma/schema.prisma` and migration `20261011042708_mut38_sessions_user_actor` (`sessions` table, `AuditActorType` + `USER`)
- `src/auth/{sessions,writability,middleware}.ts`, `src/routes/sessions.ts`
- `src/routes/{admin-users,agreements,attachments,customers,fee-proposals,import,installments,integration,payments,projects,receivables,retainers,summaries,vat}.ts`
- `src/{app,index,config,errors,logger,schemas}.ts`, `src/repositories/{ports,memory,prisma}.ts`, `src/scripts/users.ts`
- `infrastructure/terraform/{main,outputs}.tf`, `.env.example`, `README.md`, `DEPLOYMENT.md`, `openapi/openapi.yaml`, `package.json`
- tests: `src/auth/__tests__/sessions.test.ts`, `src/__tests__/{routes-sessions,route-security,logger}.test.ts`, `src/repositories/__tests__/store-{contract,memory,prisma}-sessions*`; additions to the `config` and `users-cli` tests; version pins in `routes-m*`

### Added
- **Sign-in, sign-out, `/v1/me`.**
  - `POST /v1/sessions` sets an httpOnly, `Secure`, `SameSite=Strict`, `__Host-mut_session` cookie on the API's own origin. The token is 32 random bytes; only `HMAC-SHA256(SESSION_TOKEN_PEPPER, token)` is stored.
  - Sessions expire after 120 minutes idle (activity slides the deadline) and 12 hours absolute.
  - `DELETE /v1/sessions/current` revokes the session server-side and clears the cookie.
  - `GET /v1/me` lists the hosted profiles the person may open, each with `source`, `writerOfRecord` and `access`.
- **Sign-in never reveals accounts.**
  - Unknown email, wrong password, disabled user and locked account all get the same `401 INVALID_CREDENTIALS`.
  - Each attempt runs exactly one argon2 verify; an unknown email is verified against a pre-warmed dummy hash with the same parameters.
  - Lockout (5 failures in 15 minutes → locked 15 minutes) keys on the normalised email whether or not it exists.
  - Attempts are capped at 20 per minute per client IP, taken from the trusted `X-Forwarded-For` hop.
  - Sign-ins (`user.signed_in`, actor `USER`) and locks (`user.locked_out`, actor `SYSTEM`) are audited on each member organization.
- **One principal per request, declared per route.**
  - `authenticate()` replaces `apiKeyAuth` on `/v1/*` and enforces each operation's OpenAPI `security`, using an index built from the registry. A request carrying both credentials gets 401 `ambiguous_credentials`.
  - Non-GET session requests and sign-in must be same-origin, otherwise `403 CROSS_SITE_REQUEST`.
  - Sessions select an organization with `X-Mutaba3a-Profile`: missing → `422 PROFILE_REQUIRED`; non-member → 404 (ADR-025 §2 amended for sessions only).
  - Sessions are rate-limited like keys.
- **The portal's 20 read routes accept sessions.** These are the GET routes in the `read` rows of the writability matrix, now a const in `auth/writability.ts`. Session scopes come from it. Lazy posting during a session read is audited as `SYSTEM`.
- **Operator controls.**
  - An operator reset or a disable revokes all of the user's sessions.
  - New `POST /admin/v1/users/{id}/sessions/revoke` route, and `npm run revoke:sessions`.
  - A session is also void once its user is disabled or their password changes.
- **Contract.** Error codes `INVALID_CREDENTIALS`, `SESSION_EXPIRED`, `PRINCIPAL_NOT_ACCEPTED`, `CROSS_SITE_REQUEST`; reason `PROFILE_REQUIRED`; a `session` cookie security scheme; audit actor `USER`; API `1.9.0-mut38`.
- **Configuration and Terraform.**
  - Config: `SESSION_TOKEN_PEPPER` (required, ≥ 32 characters), `SESSION_IDLE_MINUTES`, `SESSION_ABSOLUTE_HOURS`, `PORTAL_ORIGIN` (optional), `TRUSTED_PROXY_HOPS`.
  - Terraform generates, stores and mounts the pepper secret `mutaba3a-api-session-pepper` (moved forward from MUT-45 so `main` stays deployable).

### Changed
- **Handlers.** Key-only handlers read `keyAuth(c)` instead of destructuring `auth.apiKey`. Session-reachable handlers use `postingActorOf(c)`.
- **Log redaction (TD-039 resolved).** Every sensitive key, now including cookies, `Set-Cookie`, `password` and `sessionToken`, is redacted at depths 0–3, and a test pins it.

### Verified
- Server gates: lint, typecheck, `openapi:check`.
- `npm test`: 466 passed. `npm run test:db`: 520 passed.
- `terraform validate` (scratch copy).
- HTTP smoke against a running server: sign-in, `me`, a scoped read, `PROFILE_REQUIRED`, `PRINCIPAL_NOT_ACCEPTED`, sign-out, replay refused, bad password. Zero log lines contained the token or password.

## [Unreleased] - 2026-10-11 — MUT-37: operator-only user accounts on the hosted service

**Scope:** `server/` only:
- `prisma/schema.prisma` and migration `20261011040107_mut37_users_memberships`
- `src/auth/users.ts`, `src/config.ts`
- `src/repositories/{ports,memory,prisma}.ts`
- `src/routes/admin-users.ts`, `src/schemas.ts`, `src/serializers.ts`, `src/app.ts`, `src/index.ts`
- `src/scripts/users.ts`, `package.json` (+ `@node-rs/argon2` 2.2.1, six npm scripts)
- `openapi/openapi.yaml`, `README.md`, `DEPLOYMENT.md`
- tests (new): `src/auth/__tests__/users.test.ts`, `src/__tests__/{config,routes-users,no-self-registration}.test.ts`, `src/repositories/__tests__/store-{contract,memory,prisma}-users*`, `src/scripts/__tests__/users-cli.test.ts`
- `src/__tests__/routes-m{2,3,4,5,6,8}.test.ts`: version pin only

No `src/` (app) change.

### Added
- **Users and memberships.** `users` and `memberships` tables via an additive migration. A user isn't organization-scoped: a person can belong to several firms. Creating a user always creates its first membership in the same transaction.
- **Password hashing.** argon2id via `@node-rs/argon2` behind a `PasswordHasher` port. `ARGON2_MEMORY_KIB`, `ARGON2_TIME_COST` and `ARGON2_PARALLELISM` default to OWASP profile 1, and the service refuses to boot below it.
- **Admin routes** behind `X-Admin-Token`:
  - `POST /admin/v1/users` returns a one-time password, shown once.
  - `GET /admin/v1/users?email=` and `GET /admin/v1/users/{id}`.
  - Grant and remove memberships.
  - Operator password reset.
  - Disable and enable.
- **Audit.** Every account change is audited as `ADMIN` on each member organization: `user.created` (with email and display name), `membership.granted`, `membership.revoked`, `user.password_reset`, `user.disabled`, `user.enabled`.
- **Operator CLI** `src/scripts/users.ts`, run as `npm run provision:user`, `grant:user`, `revoke:user`, `rotate:password`, `disable:user` and `enable:user`. It is a function over an injected fetch and is tested against the in-process app.
- **No self-registration test.** No route or published path outside `/admin/` may match signup, register, invite, forgot or reset.
- API version `1.8.0-mut37`.

### Changed vs the original MUT-37 ticket (per its MUT-36 re-cut)
- There is no `organizationId` on the user and no owner/member roles.
- The audit actor is `ADMIN`, because the admin token carries no person.
- **Session invalidation on reset and disable moved to MUT-38**, which introduces sessions.
- `enable` was added as the inverse of `disable`, so a mistaken disable doesn't need database surgery.

### Technical
- **TD-040 (new):** audit rows written in the same millisecond have no defined order (`(createdAt, id)` with a random UUID tie-breaker in both stores). This causes an intermittent `routes-m6` failure under full-suite load, seen once in three runs and never in 20 isolated runs. It predates MUT-37.

## [Unreleased] - 2026-10-11 — MUT-36: hosted portal design brief and ADR-037 (approved)

**Scope:** `.claude/designs/hosted-portal.md` (new), `.claude/{DECISIONS,TECH_DEBT,COMPONENT_REGISTRY,CHANGELOG}.md`.
Docs only; no code. Gates MUT-37/38/39/42/43/44/45 (epic MUT-34).

### Added
- **Design brief** deciding the four forks that block the hosted build stories:
  - the portal is a hosted-only Vite build target served same-origin by the API, not the existing app repointed through the MUT-35 registry;
  - a hosted profile is `Membership × Organization`, with `ProfileSource = 'local' | 'hosted'` as a client-side union;
  - one parseable writability matrix, enforced as effective scopes, principal declarations and a compiler-exhaustive store guard;
  - httpOnly `__Host-` cookie sessions beside API keys, with routes declaring principals in the OpenAPI `security` field.

  It also re-cuts MUT-37/38/39/42/43/44/45.
- **ADR-037** (approved by the owner as written on 2026-10-11). It extends ADR-025 with a user principal and amends ADR-025 §2 for sessions only (`X-Mutaba3a-Profile` header, non-member → 404). It states that ADR-013 is untouched and that hosted profile data is a separate dataset from local profile data.
- **TD-037:** the sync op-log has no `profileId` concept. Recorded, deliberately not built.
- **TD-038:** en/ar translation drift (30 `retainers.*` keys missing in en); parity is tested for `settings.features` only.
- **TD-039:** server log redaction is untested and pino's `*.x` wildcards are one level deep. MUT-38 resolves it; the MUT-38 AC that assumed an existing redaction test is corrected in the brief.

### Changed
- **ADR-023:** override note. Its "no account system, no password storage, no session" clause no longer describes the hosted service. The rest of the ADR still governs the desktop's Malafat connection.
- **TD-018:** correction. Users are operator-issued like keys, with no self-serve signup, invite or reset; "Mutaba3a keeps no account system" no longer holds.
- **TD-013:** the synced-decorator upgrade no longer waits on MUT-43, because the portal doesn't inject into the registry. It now waits on the SQLite swap.
- **COMPONENT_REGISTRY:** `DataTable` and `CellAmount` are listed but don't exist (`src/components/tables/` is absent); a correction note points at the real page-local tables.

## [Unreleased] - 2026-10-11 — "Review now" fixes unassigned records in place

**Scope:** `src/components/drawers/OrphanedRecordsDrawer.tsx` (new),
`src/db/orphanedRecords.ts` (new), `src/hooks/useOrphanedRecords.ts` (new),
`src/components/layout/{OrphanedRecordsBanner,AppShell}.tsx`,
`src/db/integrityCheck.ts`, `src/lib/stores.ts`, `src/index.css`,
`src/pages/{clients/ClientsPage,projects/ProjectsPage}.tsx`,
`src/lib/i18n/translations/{en,ar}.json`, `src/lib/i18n/types.ts`,
`src/components/modals/{OrphanedRecordsModal.tsx,OrphanedRecordsModal.css,index.ts}`
(deleted / export removed), tests below,
`.claude/designs/orphan-banner-review{,-tests}.md`,
`.claude/{CHANGELOG,TEST_PLAN,COMPONENT_REGISTRY,PATTERNS,TECH_DEBT,SYSTEM_OVERVIEW}.md`.

### Fixed
- The orphaned-records banner's **Review now** was `<a href="/settings">`.
  On the web build (router `basepath: '/app'`) it did a full page load to
  `/settings`, outside the PWA scope and the service worker's offline
  fallback (verified in the dev build). On desktop it reloaded the app.
  Settings could only count the records anyway. It's now a button that opens
  the new **Unassigned records** drawer over the current page.
- Clients and Projects opened the assign modal by themselves whenever an
  unassigned client/project existed, and **Cancel couldn't close it**: the
  page set it open again during render. The pages no longer open anything;
  the banner is the one entry point.
- Unassigned income entries and expenses, which the banner counts, couldn't
  be fixed anywhere. The drawer covers all four kinds.

### Added
- `OrphanedRecordsDrawer`: clients, projects, income and expenses grouped
  with counts. With one profile it offers "Assign all to ‹profile›"; with
  several, "Assign all to ‹default›" plus a picker per row and Save. A row
  starts on its linked client's profile, then its project's, then the
  default. Rows that fail stay listed with a message; the rest are saved.
- `src/db/orphanedRecords.ts`: `isOrphaned` (the one definition of
  "unassigned", now also used by `runIntegrityCheck`), `findOrphanedRecords`,
  `startingProfileId`.
- `useOrphanedRecords` / `useAssignOrphanedRecords`: row-by-row writes through
  the `base` repositories, then every query refetches.

### Removed
- `OrphanedRecordsModal` (+ CSS, 10 tests, barrel export); the
  `orphanedRecords.description.*`, `assignIndividually`, `assignAllToDefault`
  and `or` keys.

### Debt
- TD-035 (locked unassigned income can't be assigned: lock rule unchanged,
  ADR needed) and TD-036 (client/project drawers save `profileId: undefined`
  for the "Default profile" option).

### Verified
- `npx tsc -b` clean; `npm run lint` 0 errors (17 warnings, all in files
  this change doesn't touch); `npx vitest run` after merging main (with
  MUT-8, f210b31): 139 files, 2,306 passed, 5 skipped, 0 failed.
- Browser pane, web dev build: Review now opens the drawer with the URL still
  `/app/` and no document reload; Arabic/RTL layout; Save assigned 6 records
  as suggested, the banner disappeared and the toast showed the count.

---

## [Unreleased] - 2026-10-11 — MUT-8: Home is owed now, needs attention and recent payments

**Scope:** `src/pages/overview/OverviewPage.tsx`, `src/components/home/{HomeNeedsAttention,HomeRecentPayments}.tsx` (new),
`src/components/home/{PredictiveKpiStrip,MonthActualsRow,AttentionFeed,KpiCard}.tsx` (deleted) and their tests,
`src/db/{repository,interfaces}.ts`, `src/sync/core/synced-repository.ts`, `src/hooks/useQueries.ts`,
`src/types/index.ts`, `src/index.css`, `src/lib/i18n/*`, `src/__tests__/noDeadHomeModules.test.ts` (new),
`docs/ux-redesign/UX-REDESIGN-SPEC.md`, `.claude/designs/{insights-reintegration,mut-1-client-accounting-core,mut-8-home-owed-attention-payments}.md`,
`.claude/{CHANGELOG,DECISIONS,COMPONENT_REGISTRY,PATTERNS,TECH_DEBT,TEST_PLAN,SYSTEM_OVERVIEW}.md`.
Branch `feature/mut-1-client-core`.

### Changed
- **Home is three blocks** (ADR-036):
  - **Owed now:** the largest figure on the page, per currency, with the
    overdue part called out, over every receivable in the active profile.
  - **Needs attention:** every overdue item and every item due within 7 days,
    in all currencies, oldest due date first. Each row shows the client, what
    it was for, the remaining amount and "Nd overdue", "Due in Nd" or "Due
    today".
  - **Recent payments:** the last 10, with date, amount, client and what each
    was for. Income saved as Received is included.
- **Every row opens its client profile**, or the entry when it has no client.
- **A new install that skipped onboarding** now sees one action, **Add
  income**, instead of zeroes.

### Removed
- The forecast strip ("Will I make it?", cash on hand, coming/leaving), the
  month-actuals row, the guidance attention feed (which never showed EUR) and
  "Recent activity", by Basel's decision (D10 = B). That covers
  `PredictiveKpiStrip`, `MonthActualsRow`, `AttentionFeed` and
  `KpiCard`/`KpiStrip`.
- Their five test files, about 600 lines of `.kpi-*`, `.attention-*` and
  `.actuals-*` CSS, and the `home.*`, `overview.recentActivity` and
  `overview.noRecent` keys.
- A guard test keeps the deleted files gone. MUT-58 prunes the money-event
  read side they leave unused (TD-034).

### Fixed
- **Onboarding, and the new empty state, flashed on every Home load.** The
  clients and entries queries looked empty while Dexie was still reading.
  Home now shows a spinner until both have answered.

### Technical
- `paymentRecordRepo.listRecent({ profileId, limit = 10 })`, plus
  `useRecentPayments`, keyed under `['paymentRecords']` so every write
  refreshes it.
- `getAttentionReceivables` breaks equal due dates by client name, then id.
  Its 7-day window, every-currency coverage and archived exclusion are now
  pinned by tests.
- **Tests:** +32 new: OverviewPage 15, attention 5, `listRecent` 6, refresh 1,
  guard 5. 59 tests left with the deleted components. Full suite 2,258
  passed, 5 skipped, 0 failed. Lint 0 errors, typecheck clean.
- **Browser check:** 1280px in English and 1024px in Arabic on seeded data.
  Values matched expectations, rows opened their clients, there was no
  horizontal scroll, and no onboarding flashed. The brand-new-install empty
  state is covered by tests only.

---

## [Unreleased] - 2026-10-11 — Settings › Data Tools messages follow the app language

**Scope:** `src/pages/settings/DataToolsSection.tsx` (new, moved out of
`SettingsPage.tsx`), `src/pages/settings/SettingsPage.tsx`,
`src/lib/i18n/translations/{en,ar}.json`, `src/lib/i18n/types.ts`,
`src/pages/settings/__tests__/DataToolsSection.test.tsx` (new),
`.claude/{CHANGELOG,TEST_PLAN,COMPONENT_REGISTRY,TECH_DEBT}.md`.

### Fixed
- The integrity check's result line and toasts were hardcoded English
  ("All N records verified…", "Found N issue(s) across N records.",
  "Data integrity check passed", "N data integrity issue(s) found",
  "Integrity check failed"), with an English-only `issue${n !== 1 ? 's' : ''}`
  plural. They now come from `integrity.checkClean`,
  `checkIssuesSingular/Plural`, `checkFailed`, `toastClean` and
  `toastIssuesSingular/Plural`, with `{count}` / `{total}` filled by `t()`.
- The backup and restore toasts in the same section were hardcoded too
  ("Backup downloaded", "Backup failed", "Restored N records from backup (vN)",
  "Import failed"). They now use `settings.backupDone`, `backupFailed`,
  `importBackupDoneSingular/Plural`, and the existing
  `settings.data.importFailed` ("Import failed: {error}").
- A scan that stopped part-way said "Found 0 issues…" and toasted
  "0 data integrity issues found": `runIntegrityCheck` reports failures in
  `result.error` instead of throwing, so the page's `catch` never ran. An
  `error` now takes the failure path (toast `integrity.checkFailed`, the row
  goes back to its default description).

### Changed
- English copy reads correctly for 0 and 1 records: "No issues found. Records
  checked: 42." / "Found 1 issue. Records checked: 1." The old "All 1 records
  verified" and "All 0 records verified" are gone.
- Arabic plurals use a "label: {count}" phrasing (e.g. "عدد المشكلات: {count}")
  that reads correctly for 2, 3–10 and 11+, as in the orphaned-records banner.
- The result line is stored as numbers and worded at render, so switching
  language on the Settings page rewords it. It used to stay in the language it
  was produced in.
- `DataToolsSection` moved to its own file, as `AdvancedFeaturesSection` did,
  so it can be tested without the whole Settings page.
- `Translations` now lists the integrity-check keys and every Data Tools key
  under `settings`, so `tsc -b` fails if either locale drops one (checked by
  deleting `integrity.checkClean` from ar.json).

---

## [Unreleased] - 2026-10-11 — MUT-7: the clients index answers "who owes me, and who is late"

**Scope:** `src/pages/clients/ClientsPage.tsx`, `src/components/clients/clientIndexRows.ts` (new),
`src/components/ui/SortableHeader.{tsx,css}` (new), `src/db/{aggregations,repository}.ts`,
`src/types/index.ts`, `src/lib/utils.ts`, `src/index.css`,
`src/lib/i18n/{types.ts,translations/en.json,translations/ar.json}`, tests beside each,
`.claude/{CHANGELOG,DECISIONS,COMPONENT_REGISTRY,PATTERNS,TECH_DEBT,TEST_PLAN,SYSTEM_OVERVIEW}.md`,
`.claude/designs/mut-7-clients-who-owes-me.md`. Branch `feature/mut-1-client-core`.

### Changed
- `/clients` columns are now **Client · Owed Now · Overdue · Last Payment ·
  Last Activity**:
  - **Owed Now:** one line per currency, or **Settled** when nothing is owed.
  - **Overdue:** each late currency in the error colour with "oldest Nd", or a
    dash.
  - **Last Payment:** the date over the amount, or **Never paid**.
  - Active projects and received are gone.
- **Default order is owed now, descending**, ranked by today's exchange rate
  with nothing converted on screen (ADR-035). The header tooltip says so. The
  Overdue column sorts by days late, Last Payment and Last Activity by date,
  Client by name. Ties fall back to name, then id.
- **Click a column header to sort** (`SortableHeader`, with `aria-sort`). It
  replaces the sort dropdown and stays in the URL (`?sort=&dir=`).
- **The whole row opens the client profile**; the name is still a link.
- **The strip** shows the client count plus `OwedNowSummary` for everyone
  listed, per currency. It replaces the "Total received" and "Total unpaid"
  figures, which were converted to ILS.

### Fixed
- **Last payment ignored partial, backdated and received-at-creation
  payments.** `lastPaymentAt` was read only from fully paid entries'
  `tx.paidAt`. It now comes from the same payment rows as the profile's
  Payments section (parent-brief D6).
- **Sorting by value or unpaid added raw minor units across USD, ILS and EUR.**
- **Unpaid on the index counted archived income.** The index now reads
  `owed` (TD-030, index half).
- **The search-empty state showed raw keys** (`clients.emptyFiltered`,
  `clients.emptyFilteredCount`, `clients.clearSearch`), and the cross-profile
  badge showed a literal "txns". Both are translated in en and ar now.

### Technical
- `clientSummaryRepo.list/get` return `owed`, `oldestOverdueDays` and
  `lastPayment`. `list()` reads transactions and payment records once and
  groups them, instead of scanning every transaction once per client.
- New pure helpers in `aggregations.ts`: `paymentRowsForIncome` (the
  ADR-033 derivation, moved out of `listByClient`), `latestPayment`,
  `combineOwed`, `summarizeClientCollection` and `groupBy`.
  `OwedByCurrency` and `LastPayment` move to `src/types`.
- **Brief D4 reverted mid-build:** the per-currency paid/unpaid report fields
  stay, because Insights and Reports read them.
- `formatAmount` reuses one `Intl.NumberFormat` per locale + currency.
- Pruned: the `.clients-summary-strip/item/label` CSS,
  `clients.columns.received`, `clients.summary.totalReceived/totalUnpaid` and
  `common.sort.valueHigh/valueLow`.
- **Tests:** 21 more in total. Added: aggregations +9, client summary +9,
  `clientIndexRows` 14, `SortableHeader` 4. The page suite was rewritten from
  33 to 18. The old suite asserted the name-ascending default and
  cross-currency sums.
- **Verification:** full suite 2,222 passed, 5 skipped, 0 failed. Lint 0
  errors (17 pre-existing warnings), typecheck clean.
- **Browser check** on seeded data at 1280px and 1024px, in English and
  Arabic. Order matched the ranking by rate. Archived client and archived
  income were excluded. Last payment covered a partial payment, income saved
  as received and a backdated Mark paid. The row opened a profile that agrees
  with its index row. No horizontal scroll, and amount columns align to the
  end edge in RTL.

---

## [Unreleased] - 2026-10-11 — MUT-15: the sidebar is Home / Clients / Income / Settings

**Scope:** `src/components/layout/{SidebarNav,TopBar,AppShell}.tsx`, `src/components/layout/addMenuActions.ts` (new),
`src/hooks/useMenuButton.ts` (new), `src/lib/features/{features,routeGuard}.ts`,
`src/components/onboarding/{OnboardingOverlay,OnboardingStepIndicator}.tsx`, `src/index.css`,
`src/lib/i18n/translations/{en,ar}.json`, `e2e/navigation.spec.ts`; tests
`src/components/layout/__tests__/{SidebarNav.features,TopBar.addMenu,addMenuActions}.test.*`,
`src/hooks/__tests__/useMenuButton.test.tsx`, `src/lib/features/__tests__/{features,leaveDisabledArea}.test.*`,
`src/components/onboarding/__tests__/OnboardingOverlay.projects.test.tsx`, `src/pages/clients/__tests__/ClientDetailPage.test.tsx` (mock);
`.claude/{DECISIONS,SYSTEM_OVERVIEW,COMPONENT_REGISTRY,PATTERNS,TECH_DEBT,TEST_PLAN}.md`; brief
`.claude/designs/mut-15-sidebar-core-four{,-tests}.md`. Branch `feature/mut-2-strip-core`. ADR-034.

### Changed
- **Sidebar core.** One header-less group, Home → Clients → Income, that no
  switch can move (a constant rendered above "More"). The "Main" and
  "Workspace" headers are gone; "More" and "System" stay. Fresh install: exactly
  Home, Clients, Income, Settings.
- **`+ Add` menus.** The sidebar **New** menu and the top bar **Add** menu read
  one list (`visibleAddMenuActions`) and now offer the same order: Income,
  Client, then Expense / Project while those areas are on (the top bar used to
  list Income, Expense, Project, Client).
- **Keyboard.** Both menus follow the menu-button pattern (`useMenuButton`):
  opening focuses the first item, ArrowUp/Down/Home/End move, Escape closes and
  returns focus to the button, Tab and outside clicks close. Before, the
  sidebar menu declared `role="menu"` but ignored arrows and the top bar menu
  had no roles and did not return focus.
- **Onboarding (TD-027).** The step indicator takes its step list from the
  overlay: with projects off a fresh install sees steps 1–2, not a pre-ticked
  "Project" step 2.

### Added
- **Leaving a switched-off area.** `useLeaveDisabledArea` (mounted in
  `AppShell`) re-runs the route guards (`router.invalidate()`) when any area
  goes from on to off, so a page whose area was switched off, for example in
  another window of the web build, lands on Home with `replace`. Verified in
  the browser with two tabs.

### Fixed
- **Collapsed sidebar.** The collapse chevron and the expand button were
  absolutely positioned with no containing block in the sidebar, so they
  floated at the window's top-right (beside `+ Add`) and bottom-centre (behind
  the download banner). Both are in flow now: chevron under the brand, expand
  button under Settings. A hairline separates the core group from "More"
  while headers are hidden.
- **RTL.** The collapse chevron pointed the wrong way in Arabic; it now points
  toward the edge the sidebar collapses to in all four direction × state
  combinations (checked in the browser).

### Removed
- `nav.sections.main | workspace | work | money` (en, ar): unused.
- `SidebarNav`'s `/download` external-link branch and a commented-out icon.

### Technical
- `e2e/navigation.spec.ts` rewritten for the core four (it walked Overview →
  Projects → Transactions → Reports from the landing page). Run locally: 2/2
  pass. The other 13 e2e cases fail for reasons that predate this change
  (TD-004 updated).
- Verification: `npm run lint` 0 errors (17 pre-existing warnings, none in
  changed files); `npm run typecheck` and `npx tsc -b` clean; full suite
  134 files, 2,207 passed, 5 skipped, 0 failed (baseline 130 / 2,149);
  `npm run build` succeeds.

---

## [Unreleased] - 2026-10-11 — Orphaned-records banner shows text, not i18n keys

**Scope:** `src/components/layout/OrphanedRecordsBanner.tsx`,
`src/lib/i18n/translations/{en,ar}.json`, `src/lib/i18n/types.ts`,
`src/components/layout/__tests__/OrphanedRecordsBanner.test.tsx` (new),
`.claude/{CHANGELOG,TEST_PLAN}.md`.

### Fixed
- With records saved without a `profileId`, the banner read
  "8 integrity.orphanedRecordPlural" and its link "integrity.reviewNow", in
  both languages (seen 2026-10-11 on a dev build). Neither locale file had an
  `integrity` section. The `|| 'fallback'` strings in the banner never ran,
  because `t()` returns the key itself when one is missing.
- Added `integrity.orphanedRecordSingular`, `orphanedRecordPlural`,
  `reviewNow` and `dismiss` to en.json and ar.json, and the section to the
  `Translations` type, so `tsc -b` fails if either file drops it.

### Changed
- The banner passes `{ count }` to `t()` instead of printing the number before
  the translated phrase, so each language places the number itself. The
  Arabic plural is a "count: N" label ("عدد السجلات غير المرتبطة بأي ملف
  تجاري: {count}"). It reads correctly for 2, 3–10 and 11+, which a fixed
  "{count} سجلات" does not.
- The dismiss button's `aria-label` is translated (was hardcoded "Dismiss").
  The dead fallback strings are gone.

---

## [Unreleased] - 2026-10-11 — Release commit carries both lockfiles (v0.0.65 Windows build failure)

**Scope:** `deploy.sh`, `scripts/release.ts`, `scripts/release-files.ts` (new),
`scripts/__tests__/release-files.test.ts` (new), `vitest.config.ts`,
`.claude/{CHANGELOG,TEST_PLAN,CI_CD}.md`.

### Fixed
- The v0.0.65 Windows build ([run 38106560692](https://github.com/vAWK3/mutaba3a/actions/runs/38106560692))
  failed the Tauri CLI's npm-vs-crate version check: `tauri (v2.11.2) :
  @tauri-apps/api (v2.12.1)` and `tauri-plugin-opener (v2.5.5) :
  @tauri-apps/plugin-opener (v2.7.0)`. The tag held a `Cargo.toml` requiring
  tauri 2.12.1 (an uncommitted dependency bump the release commit swept in)
  beside a `Cargo.lock` still pinning 2.11.2. `build_mac` had rewritten the
  lock on disk, but `tag_and_push` only staged `package.json`,
  `tauri.conf.json` and `Cargo.toml`. Every tag back to at least v0.0.58 held
  a `Cargo.lock` at least one app version behind, fixed up by hand later (`0c57247 misc`).
- `tag_and_push` now stages `package-lock.json` and `src-tauri/Cargo.lock`
  with their manifests, so the tag holds the lock the mac build used.
- Both version writers (`update_version` in deploy.sh, `writeVersionFiles` in
  release.ts) use `npm version --no-git-tag-version`, which also bumps
  `package-lock.json`'s own version. That version was stuck at 0.0.63.

### Changed
- `npm run release` now warns when a file that goes into the release commit is
  already modified before the bump, and prints the `git diff` to review. This
  is the change that let v0.0.65's tauri bump ride in without notice. The
  "left out" warning now lists the files from the shared list.
- The release-commit file list lives in `scripts/release-files.ts`
  (`RELEASE_COMMIT_FILES`). A test asserts it equals the paths deploy.sh's
  `git add` stages, so the two cannot drift.

### Considered and dropped
- A `cargo metadata --locked` preflight. It would not have caught this
  failure: `cargo update --workspace` makes the lock satisfy `Cargo.toml`
  while leaving `tauri-plugin-opener` at 2.5.5 against npm's 2.7.0. Once the
  lock is committed, `tauri build` on the mac already runs the same version
  check against exactly the files that get tagged.

### Not done here
- v0.0.65 still has no Windows installers. Either cut v0.0.66 (pushes
  `0c57247` with the fixed lock) or move the `v0.0.65` tag to `0c57247` and
  re-run `build-windows.yml`. Both need a push by the operator.

---

## [Unreleased] - 2026-10-11 — MUT-3: the client profile is one page answering the three questions (with the MUT-4 Payments UI)

**Scope:** `src/pages/clients/ClientDetailPage.tsx`,
`src/components/clients/{OwedNowSummary,ClientWorkSection,ClientPaymentsSection}.tsx` (new),
`src/components/clients/clientProfileRows.ts` (new), `src/db/{aggregations,repository,database}.ts`,
`src/types/index.ts`, `src/hooks/{useQueries,useIncomeQueries}.ts`, `src/index.css`,
`src/lib/i18n/{types.ts,translations/en.json,translations/ar.json}`, tests beside each,
`.claude/{CHANGELOG,DECISIONS,COMPONENT_REGISTRY,PATTERNS,TECH_DEBT,TEST_PLAN,SYSTEM_OVERVIEW}.md`,
`.claude/designs/mut-3-client-profile{,-tests}.md`. Branch `feature/mut-1-client-core`.

### Changed
- `/clients/:id` loses its four tabs. One page now shows, top to bottom: the
  contact details and **Owed now** (the largest figure on the page, one amount
  per currency, overdue part called out or "Nothing overdue", "Nothing owed"
  when settled); **Work and billing** (every income entry: date, title,
  project tag, amount, status, remaining balance on partial rows, due/overdue
  line; date range + status + search as one filter object; Record payment,
  Mark paid, invoice actions, duplicate); **Payments** (full history newest
  first: date, amount, what it was for, notes). Retainers card unchanged
  below, while Retainers is on.
- A client with no work shows one primary action, **Add income**, which opens
  the income drawer for that client; filters that match nothing say so and
  offer **Clear filters** instead.
- The project is a tag inside the "What" cell — a link while Projects is on,
  text while off (MUT-16), absent when unset.
- Removed from the page: the stats strip (active projects, paid income,
  unpaid, expenses), Recent activity, the Projects table, expense rows.

### Fixed
- **Owed now was always zero on the client page.** The old strip read
  `unpaidIncomeMinorUSD/ILS/EUR`, which `clientSummaryRepo.get` never returns,
  and showed them through `CurrencySummaryPopup`, which converts to one ILS
  sum. `summarizeOwedByCurrency` (ADR-033) replaces both.
- **Payment history missed income saved as Received.** Such entries are
  marked paid with no `PaymentRecord`; `listByClient` now adds one `entry`
  row per uncovered amount (ADR-033 §3, TD-029 for the write-side fix).
- **Payment lists went stale after Mark paid**, retitling or deleting an
  entry, for the 60s staleTime: transaction and income writes now invalidate
  `['paymentRecords']` too (also refreshes the payment drawer's history).
- `listByClient` date bounds compare the calendar date of `paidAt`, so a
  payment stored as a timestamp on the `dateTo` day is included.
- The v18 migration's English note ("Migrated from accumulated total") shows
  as the existing `transactions.partialPayment.migratedNote` translation.
- MUT-23: the discarded `useProjects(clientId)` call is gone.

### Technical
- New: `summarizeOwedByCurrency`, `OwedByCurrency` (`aggregations.ts`);
  `PaymentByClientRow.source: 'record' | 'entry'`; `invalidatePaymentRecordLists`;
  `MIGRATED_PAYMENT_NOTE` (`database.ts`, value-identical, v18 upgrade
  unchanged); `toWorkRow` / `WorkRow` (`clientProfileRows.ts`).
- i18n: `clients.profile.*` added in en + ar; dead `clients.tabs`,
  `clients.receivables` and ten `clients.detail.*` keys pruned from both files
  and from `Translations`.
- Tests: +45 (8 owed-now, 8 `listByClient`, 4 invalidation incl. a real-Dexie
  Mark paid → Payments refresh, 7 row shaping, 5 `OwedNowSummary`, page suite
  rewritten to 34). Full suite 2,194 passed, 5 skipped, 0 failed; lint 0
  errors; typecheck and build clean. `npm run test:tz` has 4 failures, all
  pre-existing on `main` (TD-014 note).
- Browser check at 1024 and 1280 px, English and Arabic: no horizontal
  scroll, Owed now is the largest text (30px), amounts stay LTR in Arabic,
  Mark paid updates Owed now and Payments without a reload.

---

## [Unreleased] - 2026-10-10 — Money v1 handover refreshed for M8 and the pilot

**Scope:** `.claude/designs/money-v1-handover.md`, `.claude/CHANGELOG.md`. Docs only; no code.

### Changed
- The handover now records the real state rather than the 2026-10-08 one: M1–M8
  merged and pushed in both repos, the Mutaba3a server deployed, Malafat
  production on `web@2.2.2` (M1–M7, not M8), and the pilot firm onboarded with
  its manual runbook still to walk.
- New §2 "Ship M8 to both sides together". Malafat M7 against Mutaba3a M8
  breaks only the fee-proposal actions: `/agree` is gone, `/approve` changed
  its body, and `feeProposalId` was dropped from agreement creation.
- New §2a records a read-only check for databases that ran the **original** M7
  migration. M8 edited it in place (D20), and `prisma migrate deploy` never
  re-runs an applied migration. Such a database has no `APPROVED` enum value
  and needs a forward repair migration, which is not written yet.
- §5 lists the follow-up tickets filed today: MUT-56 (malware scan, gates GA),
  MAL-950 (native ar/he review), MAL-951 (375px LTR/RTL pass) and MAL-952
  (closing a matter archives its project; D19 copy). It also lists the still-open
  MUT-28, MAL-870 and MAL-150.

## [Unreleased] - 2026-10-10 — TD-028: every by-id query hook resolves `null`, not `undefined`, for a missing row

**Scope:** `src/hooks/{useQueries,useIncomeQueries,useExpenseQueries,useRecurringExpenseQueries,useRetainerQueries,usePlanQueries}.ts`,
`src/components/drawers/DocumentDrawer.tsx`, `src/pages/documents/DocumentFormPage.tsx`,
`src/hooks/__tests__/{useQueries,useIncomeQueries,useRecurringExpenseQueries}.test.tsx`,
`src/hooks/__tests__/{useExpenseQueries,useRetainerQueries,usePlanQueries}.test.tsx` (new),
`.claude/{CHANGELOG,PATTERNS,TECH_DEBT,TEST_PLAN}.md`.

### Fixed
- Opening a deep link whose row was deleted (`?tx=<id>`, `/clients/:id`,
  `/projects/:id`, a document, profile, expense, recurring rule, retainer or
  plan id) put that query in `error` state and logged *"Query data cannot be
  undefined"*, because every by-id hook handed the repository's `undefined`
  straight to TanStack Query v5. The 16 hooks below now normalise the absence
  to `null` (`?? null`) and are typed `UseQueryResult<Entity | null>`, the
  same shape `useDefaultBusinessProfile` got earlier today:
  `useTransaction`, `useClient`, `useClientSummary`, `useProject`,
  `useProjectSummary`, `useDocument`, `useBusinessProfile` (`useQueries`);
  `useIncomeById`; `useExpense`, `useRecurringRule` (`useExpenseQueries`);
  `useRecurringRule` (`useRecurringExpenseQueries`); `useRetainer`; `usePlan`,
  `usePlanAssumption`, `usePlanScenario`, `usePlanDefaultScenario`.
- The two summary hooks were not on the TD-028 list but have the same contract
  (`Promise<Summary | undefined>` when the parent client/project is gone), so
  they are included rather than left as a third round.

### Changed
- `DocumentDrawer` and `DocumentFormPage` derived `isReadOnly` as
  `… && existingDoc && …`, which typed as `boolean | null | undefined` once the
  hook could resolve `null` and failed 60 `disabled={isReadOnly}` props. Both
  now use `!!existingDoc`; the rendered value is unchanged (falsy either way).
  No other consumer needed a change: every one reads the value through `?.`,
  `&&` inside JSX or a truthy guard, and none reads `isError`.
- Repository contracts are untouched (`get(id): Promise<Entity | undefined>`,
  `getDefault(planId): Promise<PlanScenario | undefined>`); the hook is the
  only place the absence is normalised, per the PATTERNS Query Hooks rule.

### Technical
- Tests (TDD, all red before the hook change): a "missing row resolves to
  `null`, `isSuccess`, `isError` false, no `console.error`" case per hook.
  `useQueries.test.tsx` runs the seven `useQueries` hooks against real Dexie
  with an id that was never written; the income and recurring files mock
  `get` to resolve `undefined`; three new files cover the expense, retainer
  and plan hooks through mocked repositories (`describe.each` over the hook
  table, plus a found-row and an empty-id case each). The main-branch hooks
  for receipts, categories, vendors and recurring occurrences named in the
  original TD-028 note no longer exist after the MUT-2 strip, so they have no
  test.
- Verification: lint 0 errors (17 pre-existing warnings), typecheck clean,
  `npm run build` clean, full suite green — the 18 `ExpensesLedgerPage`
  failures recorded as pre-existing in TEST_PLAN are gone on current `main`
  (the page was removed by the MUT-2 strip).
- TD-028 resolved.

---

## [Unreleased] - 2026-10-10 — Fresh install: `useDefaultBusinessProfile` resolves to `null`, not `undefined`

**Scope:** `src/hooks/useQueries.ts`, `src/hooks/__tests__/useQueries.test.tsx`,
`.claude/{PATTERNS,TECH_DEBT,TEST_PLAN}.md`.

### Fixed
- On every fresh install (empty IndexedDB) the `['defaultBusinessProfile']`
  query's `queryFn` resolved to `undefined`, because
  `businessProfileRepo.getDefault()` returns `undefined` for "no default".
  TanStack Query v5 rejects `undefined` as query data: the query sat in
  `error` state and logged *"Query data cannot be undefined … Affected query
  key: ["defaultBusinessProfile"]"* in the console on `/app/`. The hook now
  normalises the absence to `null` (`?? null`) and is typed
  `UseQueryResult<BusinessProfile | null>`.

### Changed
- `useDefaultBusinessProfile` resolves `null` instead of `undefined` when no
  default profile exists. The three consumers (`useActiveProfile`,
  `DocumentDrawer`, `DocumentFormPage`) already read it through `?.`/truthy
  checks, so none needed a code change; the repository contract
  (`IBusinessProfileRepository.getDefault(): Promise<BusinessProfile | undefined>`)
  is unchanged, so the hosted and synced repositories are unaffected.

### Technical
- Tests: the prior "returns undefined when no default exists" case passed only
  because it waited on `isFetching === false`, which is also true in `error`
  state — it never noticed the query had failed. Replaced by two cases: the
  fresh-install case (no profiles at all) asserts `isSuccess`, `data === null`
  and no `console.error`; the "profiles exist, none default" case asserts
  `null`. The first one reproduced the exact console message before the fix.
- Verification: lint 0 errors (18 pre-existing warnings), typecheck clean,
  `npm run build` clean. Full suite: the same 18 `ExpensesLedgerPage` failures
  recorded in TEST_PLAN as pre-dating MUT-6 are still the only failures and are
  untouched here.
- Pattern note added to PATTERNS.md (Query Hooks); the other possibly-`undefined`
  `queryFn`s are logged as TD-028.

---

## [Unreleased] - 2026-10-10 — MUT-6: "Record payment" becomes a primary row action

**Scope:** `src/components/ui/RecordPaymentButton.{tsx,css}` (new) + `index.ts`,
`src/components/drawers/PartialPaymentDrawer.tsx`, `src/db/repository.ts`,
`src/hooks/useQueries.ts`, `src/lib/i18n/translations/{en,ar}.json`,
`src/pages/{clients/ClientDetailPage,income/IncomePage,projects/ProjectDetailPage}.tsx`,
7 test files (2 new), `.claude/{DECISIONS,COMPONENT_REGISTRY,TECH_DEBT,TEST_PLAN}.md`,
`TODOS.md`.

### Added
- **`RecordPaymentButton`** — the payment affordance is now a button on the row
  with the remaining balance on it, at all four surfaces: ClientDetailPage
  (receivables and transactions tabs), IncomePage, ProjectDetailPage. It owns
  the single gate (`income && paymentStatus !== 'paid' && remaining > 0`) that
  previously existed as three different inline conditions, one of which was
  missing entirely — the client receivables tab offered "Record payment" on
  settled rows. Props-in, no store import, matching the rest of `components/ui`.
- Overpayment guard in `paymentRecordRepo.create`/`.update`, inside the
  existing `rw` block so concurrent writes cannot both pass (**ADR-030**).
- i18n keys `transactions.partialPayment.{amountMustBePositive,overpayment}` in
  en and ar.

### Changed
- The payment drawer opens with the full remaining balance prefilled, so
  settling in full is one confirm; the field is still editable down to a
  partial amount, and empty when there is nothing left to pay.
- Its two hardcoded English validation strings are now translated.
- The row actions column was a fixed 40–48px sized for a kebab alone; it is now
  shrink-to-fit, so the added button cannot squeeze the amount column.
- **Behaviour reversal (ADR-030 override log):** overpayment was allowed and
  clamped, documented by two passing tests. It is rejected now, and those tests
  are rewritten to assert rejection.
- Payments on a `lockedAt` transaction keep working — that was true only by
  accident before (the recalc bypasses the lock guard); it is now named in a
  comment and pinned by a test. The `['archivedAt']` allowlist is untouched.

### Fixed
- **Stale balances after a payment (MUT-6 AC #5, a live defect).**
  `invalidatePaymentRecordQueries` never invalidated the income keys, so
  `/income` and the client Receivables tab kept showing an old status and
  remaining amount for up to the 60s staleTime right after a payment was saved.
  Adds `['income']`, `['receivables']`, `['incomeOverviewTotals']` and
  `['incomeAttentionReceivables']` — the set `markPaid` already invalidated.
- **The Overview KPI strip and attention feed went stale after every write**
  (found in QA reconciliation). Money-event views are *derived* —
  `moneyEventRepository` recomputes them from transactions, expenses and
  projected income on every read and never writes — so nothing invalidated
  their keys as a side effect. The one helper that listed them,
  `useInvalidateMoneyEvents`, had **zero callers anywhere in the app**, so the
  home page served pre-write numbers after recording a payment, creating
  income, marking paid, adding an expense or changing a retainer.
  `invalidateMoneyEventQueries` is now exported from `useMoneyEventQueries.ts`
  (beside the keys it owns, so the list still exists once) and called by all
  four write paths: `useQueries`, `useIncomeQueries`, `useExpenseQueries`,
  `useRetainerQueries`. Pre-existing and app-wide, not caused by MUT-6; fixed
  here at the owner's request because the payment path is where it cost most.
- **The payment date defaulted to the UTC date, not the local one** (AC #4,
  found in QA reconciliation). `PartialPaymentDrawer` computed "today" with
  `new Date().toISOString().split('T')[0]`, which ADR-022 forbids: a user in
  New York recording a payment at 20:30 on 15 March was handed **16 March**,
  and one in Jerusalem after midnight was handed yesterday. It now uses
  `todayISO()` like every other drawer. Pinned by two faked instants that
  straddle midnight in opposite directions, so the test is honest in both
  `Asia/Jerusalem` and `npm run test:tz`.

### Technical
- **TD-021** recorded: `invalidateIncomeQueries` and
  `invalidatePaymentRecordQueries` keep overlapping key lists. The eng review
  deliberately chose the in-place fix over extracting a shared helper.
- TODOS 3–5 from the eng review: payment-record sync ops are captured but
  `ops-engine.ts` can never apply them (MUT-55); a failed refetch after a
  successful write is silent app-wide; "Mark paid" and "Record payment" are now
  two-click duplicates that disagree about the date (decide after MUT-18).
- Pre-existing and untouched: the 18 `ExpensesLedgerPage` test failures.
---

## [Unreleased] - 2026-10-10 — MUT-49: updater public key restored to BEDF931CA1D6C777

**Scope:** `src-tauri/tauri.conf.json`, `src/lib/__tests__/updater-config.test.ts` (new), `.claude/DECISIONS.md` (ADR-031, ADR-027 merge, index), `.claude/TECH_DEBT.md` (TD-022), `.claude/TEST_PLAN.md`, `.claude/PATTERNS.md`, `.claude/CI_CD.md`, `.github/workflows/build-windows.yml`. Epic MUT-48.

### Fixed
- `plugins.updater.pubkey` is back to the pre-`ae9fb1c` value, byte-identical to
  `~/.tauri/mutaba3a.key.pub`. The 2026-10-05 rotation pointed the app at a key
  (`AB7B64537B1DE22C`) whose private half never signed a published release
  and is not configured anywhere the pipeline signs from. Every real signer
  (the macOS release signer, the CI secret, the v0.0.63 signatures) is
  `BEDF931CA1D6C777`. No shipped build embeds the wrong key
  (`ae9fb1c` is not an ancestor of `v0.0.63`), so the revert is
  backward-compatible.

### Added
- `src/lib/__tests__/updater-config.test.ts`: pins the configured public key
  to the canonical base64 string and asserts the key id from the key bytes
  (line 2, bytes 2..10), printing both fingerprints on mismatch. Written red
  against the `AB7B...` config, green after the revert.
- ADR-031: the key is canonical; a real rotation ships the new public key in a
  release signed by the old key before signing switches, and that transitional
  release is necessary, not sufficient (late clients still reinstall).
- TD-022: the release-time guards deferred to MUT-51.
- `.claude/CI_CD.md`: the Tauri troubleshooting row no longer says to
  regenerate the signing key on a bad signature (that is how `ae9fb1c`
  happened); the updater secret names now match the real workflow. The
  Windows workflow's "latest.json not found" hint points at `./deploy.sh`, and
  the workflow runs `updater-config.test.ts` against the release tag before
  `tauri build`, so the guard executes on the path that compiles the key into
  the Windows build. The macOS script's test gate is MUT-51 (TD-022).

### Technical
- `.claude/DECISIONS.md` carried two `## ADR-027` headings (the 2026-10-09
  fee-proposal record and its 2026-10-10 override). They are now one ADR-027
  with two dated sections; ADR-028 and ADR-029 keep their numbers because
  CHANGELOG, TEST_PLAN, TECH_DEBT and the designs cite them. The `## ADR-XXX`
  inside the Decision Template is the template, not a placeholder to fill.
- Release-time checklist for the ticket's acceptance criteria 3 and 4 lives
  on MUT-49; the shell signer-vs-config check and the dead
  `UPDATER_PRIVATE_KEY_FILE` declaration in `deploy.sh` are handed to MUT-51.

---

## [Unreleased] - 2026-10-10 — MUT-16: insights, planning and projects are gated behind their switches

Brief `.claude/designs/mut-16-gate-insights-planning-projects.md` (+ test
plan), eng review §8, outside voice §9. ADR-032 addendum. Five commits, one
per build-order step (router, nav, client profile, drawers, onboarding).

### Added
- `/insights`, `/planning`, `/projects` and `/projects/$projectId` carry
  `beforeLoad: requireFeature(key)`: a deep link while the area is off
  redirects home before the lazy chunk loads. `/reports` → `/insights` and
  `/transactions` → `/income` stay unconditional (AC 3), proven by the new
  `legacyRedirectsCore` test with every area off.
- Sidebar: Insights, Planning and Projects leave the main/workspace sections
  for "More" (after Expenses, Documents, Retainers). A fresh install shows
  Home, Income, Clients, Settings. `+ Add → Project` (sidebar and top bar)
  renders only while projects is on.
- Client profile: the Projects tab, its body and both **+ Project** buttons
  render only while projects is on; an active projects tab falls back to
  Summary. Project names on the work list stay as text (AC 4).
- Income and expense drawers: the optional project field hides while
  projects is off; form state is untouched, so editing an entry that carries a
  `projectId` saves it unchanged (D3).
- Onboarding: while projects is off the overlay completes the project step
  itself (no entity), so a new install runs client → income (D4).
- `RetainerDrawer`'s project picker follows the switch too (review #2).
- `useFeaturesLoaded()` in `lib/features/useFeatures.ts`: whether the
  settings row has been read; the onboarding skip waits for it (review #1).
- Tests: router gates (+4), gate keys (30: each gated route reads its own
  key), legacy core redirects (2), sidebar (+3), client profile (+2), income
  drawer (+3), expense drawer project field (3), retainer drawer project
  field (2), onboarding overlay (6). Suite: 123 files, 2067 passed, 5 skipped.

### Fixed (outside review, brief §9)
- The onboarding project-step skip no longer fires while the settings row is
  still loading, so a projects-on user mid-onboarding keeps their step.
- A project created during onboarding before the area was switched off is no
  longer attached to the income step through a hidden field.
- `ClientDetailPage` reads `visibleTab` in every tab comparison.

### Removed
- `useOnboardingDrawerSuccess` (zero callers; the drawers call
  `completeStep` directly).

### Decided
- Projects off hides; the switch never clears: `Transaction.projectId` is
  kept through an edit while the field is hidden. The client→project cascade
  still clears a tag that no longer matches the chosen client, visible or
  not (D3, review #4).
- The onboarding store's completion rule (`client`, `project`, `income`)
  stays; the overlay auto-completes the step rather than the store learning
  about flags (D4). The indicator still shows three steps (TD-027).

### Not done here
- The sidebar's final grouping and the `+ Add` menu's shape (MUT-15).
- No `suppliers` work: folded into expenses by MUT-12, view deleted by MUT-14.

---

## [Unreleased] - 2026-10-10 — MUT-14: expenses collapse to one gated ledger; MUT-20 fixed

Brief `.claude/designs/mut-14-collapse-expenses.md` (+ test plan), eng
review §9, outside voice §10 (twelve findings, all dispositioned before the
prune commit). ADR-029 and ADR-032 addenda. Safety tag before deletion:
`mut-14-pre-expenses-collapse`.

### Removed (one commit per page)
- `ExpensesPage` (profiles), `ProfileExpensesPage`, `ReceiptsPage` (+ its
  match components), `ExpensesOverviewPage`, `ExpensesForecastPage`,
  `VendorsPage`, `MonthCloseChecklistPage` (+ `ClosedMonthWarning`),
  `SuppliersPage` and the `/suppliers` route, the orphan
  `RecurringRuleDrawer` and `BulkUploadDrawer`. Their eight paths redirect to
  `/expenses`.
- Pruned by the consumer rule: forecasting (`forecastCalculations.ts`,
  `useExpenseForecast`, yearly / all-profile totals), receipt matching
  (`matchingAlgorithm.ts`, suggestion and bulk-upload hooks and helpers,
  `receiptRepo.linkToExpense`), month close (`monthCloseRepo` and hooks;
  the **table stays**, typed in `src/db/retained/monthCloseSchema.ts`),
  vendor management (`mergeVendors`, `addAlias`, `isSameVendor`,
  `findBestVendorMatch`), the `linkReceiptId` drawer chain, and 216 orphaned
  i18n leaves (`suppliers.*`, `monthClose.*`, `receipts.*`, most of
  `expenses.*`) in en and ar.

### Added
- **Export receipts** in Settings › Data tools: one ZIP with
  `<profile>/<YYYY-MM>/<file>` for every uploaded receipt, built by the
  tested `buildAllReceiptsArchive`; `receipts.count()` for the row count.
  Shipped before the receipts pages were deleted (ADR-029 addendum).
- `/expenses` gated by `requireFeature('expenses')`; Expenses moved from the
  main sidebar section to "More"; `+ Add → Expense`, the top bar's New
  expense and duplicate-as-expense on the project page follow the switch.
- Ledger: **Edit recurring rule** on recurring rows and on projected
  occurrence cards (the only management entry point was on a deleted page);
  receipt-count badge on rows; the two links to deleted routes are gone.
- `ExpenseDrawer` seeds the default categories for a profile that has none
  (the seeding button lived on a deleted page).
- Tests: ledger (+1), zip export (3), router gates (+1), legacy redirects (8),
  sidebar (+2), no-dead-modules guard, retained month-close schema (3),
  backup round-trip data safety (2); i18n parity for `expenses` en/ar.

### Fixed
- **The Settings backup import now reconciles optional areas.** MUT-12 wired
  the reconcile into `migration-safety.ts`'s restore only; the Settings page
  uses `src/db/backup.ts`, which is now covered too (found by the new
  round-trip test).
- **`useFeatureEnabled` no longer imports the `hooks/useQueries` barrel**;
  page tests that mock that barrel wholesale (IncomePage) broke the moment
  the top bar read a flag. The settings query is declared inside the features
  module with the same `['settings']` key.
- **MUT-20:** the 18 failing `ExpensesLedgerPage` tests. Root cause: the
  page renders its no-profile state without an active profile and the test
  never provided one. Fixed by mocking `useActiveProfile` (a test fix, not a
  product change; nothing renders the ledger against a real profile row).

### Decided
- Expenses already recorded stay visible on Home, client and project pages
  while the area is off; only create entry points follow the switch (D9).
- Receipts are exportable, not viewable, after this ticket; vendors stay
  viewable and creatable through the ledger and the drawer.

---

## [Unreleased] - 2026-10-10 — MUT-13: invoices/documents and retainers are gated behind their switches

Brief `.claude/designs/mut-13-gate-invoices-retainers.md` (+ test plan), eng
review §8, outside voice §9. First consumer of the MUT-12 switchboard;
ADR-032 addendum records the gating pattern. Jira MUT-13 under MUT-2.

### Added
- **`requireFeature(key, to = '/')`** (`src/lib/features/routeGuard.ts`): a
  router `beforeLoad` that reads the flag through the repository and throws a
  redirect before the lazy page chunk is requested. Applied to `/documents`,
  `/documents/new`, `/documents/$documentId`, `/documents/$documentId/edit`
  and `/retainers` in `src/router.tsx`.
- **Sidebar "More" section** (`nav.sections.optional`): Documents and
  Retainers appear only while their areas are on; hidden when both are off.
  Core sections untouched (MUT-15 owns the final grouping).
- **Client profile entry points**: *Generate invoice* / *View invoice* row
  actions on income rows (invoices on) in both the Receivables and
  Transactions tabs, mirroring the legacy `/transactions` action;
  **`ClientRetainersCard`** on the Summary tab (retainers on) with New
  retainer and View all.
- **Locked income entry** (`IncomeDrawer`): a notice naming the locking
  document, Save and Delete disabled; *View document* while invoices is on,
  "turn on Invoices in Settings" while it is off. The repository guard is
  unchanged and still the source of truth.
- **Home attention feed** leaves projected-retainer items out while retainers
  is off (their only action deep-links to `/retainers`).
- i18n en + ar: `nav.sections.optional`, `clients.detail.retainers.*`,
  `drawer.income.locked.*`. `.drawer-notice` styles.
- **Create invoice from an income entry really links it:** `openDocumentDrawer`
  takes `linkTransactionId`; the drawer prefills currency, client and one line
  from the entry and links it on create, so the row flips to *View invoice*.
- `defaultPendingComponent: PageLoader` on the router, so a reload or deep link
  into a gated route shows the loader while the flag is read instead of a
  blank first paint.
- Tests: route guard (5), router gates (10), sidebar (4), client profile entry
  points (5), locked drawer (5), attention feed (2), data safety + auto-enable
  end to end (2), repository delete-lock (1).

### Fixed
- **`transactionRepo.softDelete` now honours the document lock** (it only
  guarded `update`); the drawer's disabled Delete is no longer the only guard.
- The home KPI strip (`PredictiveKpiStrip`) no longer counts projected
  retainer income while the Retainers area is off.
- The lock error toast no longer says "unlock the document first".

### Notes
- Lock contract, now stated: details immutable, payments allowed (row menu),
  delete refused, archive allowed. Toggling writes only the settings row;
  documents, sequences and retainers are untouched (tested). Auto-enable on
  upgrade is MUT-12's.
- The legacy `/transactions` page keeps its own ungated *Generate invoice*
  item; the route redirects to `/income`, so it is unreachable (TD-025).

---

## [Unreleased] - 2026-10-10 — MUT-12: per-feature Advanced toggle in Settings, off by default (Dexie v20)

Brief `.claude/designs/mut-12-advanced-features-toggle.md` (+ test plan),
eng-reviewed with an outside-voice pass; ADR-032 (numbered ADR-030 on the branch; renumbered at merge because main's MUT-6 took ADR-030). Jira MUT-12 under MUT-2.
Nothing is gated yet — MUT-13/14/16 consume the switches.

### Added
- **Settings › Advanced features**: one `Switch` per optional area —
  invoices, retainers, expenses, insights, planning, projects — all off on a
  fresh install (`pages/settings/AdvancedFeaturesSection.tsx`).
- **`Settings.features`** (typed partial map) and **`Settings.featureNotice`**
  on the settings row; `settingsRepo.get()` now returns `ResolvedSettings`
  with every key present. `src/db/defaultSettings.ts` holds the one default
  row used by the repository and `initDatabase()`.
- **`src/lib/features/features.ts`** (pure): `FEATURE_KEYS`, `DEFAULT_FEATURES`,
  `resolveFeatures`, `withFeature`, data probes, `reconcileFeaturesWithData`
  and the swallowing `reconcileFeaturesAfterDataLoad`.
- **`src/lib/features/useFeatures.ts`**: `useFeatureEnabled`, `useFeatureFlags`,
  `useSetFeatureEnabled`, `useFeatureNotice` (React) and `readFeatureFlags()`
  for router `beforeLoad` guards.
- **Dexie v20** (no schema change): the upgrade switches on every area that
  already has data and records a notice; try/caught so it can never block
  open. Same reconcile after backup restore, data import (both legacy import
  flows and the profile import modes), demo seeding and sync-bundle import.
- **`FeatureNoticeBanner`** in `AppShell`: tells the user once which areas were
  switched on for their data, links to Settings, clears on dismiss.
- **`Switch`** UI component (`role="switch"`, keyboard, RTL via logical
  properties). i18n `settings.features.*` in en + ar.
- Tests: 8 new files (features, probes, reconcile, hooks, migration v20,
  Switch, section, banner) + extended settingsRepo, migration-safety and
  ImportExportModals tests; i18n parity test for the new keys.

### Decided
- `suppliers` is folded into `expenses` (vendors are the expenses module's
  table); the ticket's seventh toggle is not shipped (ADR-032 §5).
- Archived rows count as data for auto-enable; soft-deleted rows do not;
  projects have no soft delete so any row counts.

### Technical
- `MiniCrmDatabase` takes an optional database name so the v20 upgrade is
  tested on a real v19 → v20 open.
- `ISettingsRepository.get()` returns `ResolvedSettings` (a subtype; no caller
  changes).

---

## [Unreleased] - 2026-10-10 — Money v1 pilot decisions: download-only attachments accepted, Office Admin excluded; epic bookkeeping (MUT-25 / MAL-939)

**Scope:** `.claude/DECISIONS.md` (ADR-028 + index), `.claude/designs/money-v1-m6-summaries-audit-attachments.md` §5, `.claude/designs/money-v1-handover.md` §4. No code.

### Summary
- **ADR-028:** M6 decision 4 accepted for the pilot — attachments stay download-only, `READY` means verified size and type, the scanner pipeline is a post-pilot follow-up to ticket before GA.
- **Office Admin does not get access to Money** (owner, 2026-10-10): recorded against MAL-870 and as an ADR-150 addendum in Malafat; Mutaba3a's handover §4 updated to match.
- **Jira:** MUT-40, MUT-41, MAL-940…943 → Done; spikes MUT-26, 27, 29, 30, 31, 32 and MAL-869, 871 closed as answered by ADR-024/025 and ADR-150; MUT-28 and MAL-870 left open; MUT-25 and MAL-939 → In Progress (pilot).
- **Worktrees:** `.claude/worktrees/money-v1-m8` and branch `feature/money-v1-m8` removed in both repositories (merged: Mutaba3a e7754f3, Malafat 1477e55f5).

---

## [Unreleased] - 2026-10-10 — MUT-10 / MUT-11: delete the two unreachable modules (`src/`)

Epic MUT-2 (strip to the core). Branch `feature/mut-2-strip-core`; tag
`pre-mut-10-11` marks the state before either removal. One commit per ticket so
each reverts independently.

### Removed
- **Engagements (MUT-10)** — 11,192 lines: three routes (`/engagements`,
  `/engagements/new`, `/engagements/$engagementId/edit`), `src/pages/engagements`,
  `src/features/engagements` (wizard, PDF generator, autosave hook, presets,
  repository), and the `engagements.*`, `nav.engagements` and orphaned
  `nav.newMenu.engagement` i18n keys from both locales. No navigation entry had
  pointed at any of it.
- **Money answers (MUT-11)** — 3,180 lines: the `/money-answers` route,
  `src/pages/money-answers`, `DayDetailDrawer` and its two drawer-store actions
  (the page was the only caller), the Insights "Cash Flow Timeline" link into
  the deleted route, the already-unreferenced landing `MoneyAnswersSection`, and
  the `moneyAnswers`, `nav.moneyAnswers`, `landing.moneyAnswers` and
  `insights.cashFlowTimeline` i18n keys.

### Changed
- `src/db/database.ts` takes the `Engagement` / `EngagementVersion` row types
  from the new `src/db/retained/engagementSchema.ts` instead of the deleted
  feature directory. The version snapshot is modelled as opaque JSON — nothing
  interprets it any more.
- Renamed the shared money-event surface off the deleted page's name:
  `useMoneyAnswersQueries` → `useMoneyEventQueries`, `moneyAnswersQueryKeys` →
  `moneyEventQueryKeys`, `useInvalidateMoneyAnswers` → `useInvalidateMoneyEvents`,
  `MoneyAnswersFilters` → `MoneyEventFilters`.

### Kept deliberately
- The Dexie `engagements` and `engagementVersions` tables, at the same schema
  version. Deleting UI must never delete user records (ADR-029). The generic
  backup in `src/db/backup.ts` walks `db.tables`, so retaining the tables keeps
  any rows a user holds exportable and restorable with no new export path.
- `src/db/moneyEventRepository.ts` and the `MoneyEvent` type family: shared with
  `PredictiveKpiStrip`, `MonthActualsRow` and `AttentionFeed` on the Overview
  page, so MUT-11's "remove only if exclusively used here" condition failed.
- The `moneyEventVersions` table — unrelated to the deleted page; it is the
  transaction sync op-log.

### Added
- `src/db/__tests__/retainedSchema.test.ts` — four tests that fail if a later
  change drops the retained tables or stops backing them up.

### Technical
- Dexie schema version unchanged; no table dropped, no migration added.
- Typecheck clean. Lint went from 18 errors / 75 warnings to 0 errors / 18
  warnings — the deleted modules owned every remaining lint error, which closes
  most of MUT-22.
- Unit suite: 2,029 passing before and after, plus the 4 new tests. The 18
  failures in `ExpensesLedgerPage.test.tsx` are pre-existing and untouched.
- Bundle: JS 3,396 KB → 3,152 KB (−244 KB, −7.2%) across 48 → 45 chunks;
  precache 11,902 KiB → 11,647 KiB.

---

## [Unreleased] - 2026-10-10 — Money v1 Milestone 8: approval creates the agreement; the overview carries proposals (`server/`, API `1.7.0-m8`)

Brief `money-v1-m8-overview-ia.md` (design-reviewed D1–D13, eng-reviewed
D14–D20; HTML wireframe beside it). Jira MUT-40, MUT-41 under MUT-25. Replaces
the M7 lifecycle: nothing from M1–M7 is deployed, so the M7 migration is edited
in place rather than mapped (D20).

### Changed
- **Fee proposal lifecycle** is `PROPOSED → APPROVED | WITHDRAWN`
  (`src/proposals/transitions.ts`). `CLIENT_APPROVED`, `AGREED`, `CONVERTED`,
  `POST …/agree`, `agreedOn` / `agreedNote` and the `feeProposalId` field of
  `POST /v1/agreements` are gone; `currentProposal` prefers the open one, else
  the latest APPROVED. Reasons `PROPOSAL_NOT_FOUND`, `PROPOSAL_NOT_AGREED`,
  `PROPOSAL_PROJECT_MISMATCH` retired.
- **`POST /v1/fee-proposals/{id}/approve`** now creates the fixed-fee agreement
  (D5): body `{ amount, approvedOn?, schedule: ONCE { dueOn } | INSTALLMENTS
  { count 2–60, firstDueOn }, note? }`; the agreement is dated `approvedOn`
  so the VAT rate in force on that date applies (D18, `422 VAT_RATE_MISSING`
  names the date); ONCE posts one IMMEDIATE installment due on `dueOn`;
  INSTALLMENTS splits the amount into equal minor-unit shares (remainder on
  the first), posts the first now and DATE-triggers the rest one month apart
  with the day clamped (D15 B). The store transaction writes the agreement and
  moves the proposal to APPROVED (`agreedAmountMinor`, `clientApprovedOn`,
  `clientApprovalNote`, `agreementId`) or refuses the whole create
  (`StateConflict` → `409 PROPOSAL_NOT_OPEN`). Returns `{ proposal, agreement }`.
  Audit `fee_proposal.approved` (with `agreementId`, `schedule`).
- **Organization summary** (D17): `CustomerSummaryRow.proposals[]`
  (`{ proposalId, projectId, amount, proposedOn }`), `CurrencySummary.proposed`
  and `counts.openProposals`; the currency and customer sets include customers
  that only have PROPOSED proposals, so a proposals-only firm gets a block.
- **Archive** (`POST /v1/projects/{id}/archive`) is refused with
  `409 PROPOSAL_OPEN { openProposalId }` while a proposal is open (D19).
- **Lazy posting heals IMMEDIATE installments** (D16):
  `AgreementRepository.listUnpostedDue` also returns unposted, non-voided
  IMMEDIATE installments on ACTIVE agreements (MANUAL excluded), so a crash
  between agreement create and the posting step is repaired on the next read
  or by `npm run reconcile`; `installment.posted` audits `trigger` from the
  installment.
- API version `1.7.0-m8`; `openapi/openapi.yaml` regenerated.

### Technical
- `src/agreements/create.ts` (new, D14): `composePreview`, `PreviewBody`,
  `createAgreementFromPreview`, `agreementDetail`, `paidMap` lifted out of
  `routes/agreements.ts` and shared with the approve route. `POST /v1/agreements`
  behaviour unchanged (`routes-m3.test.ts` untouched and green).
- Tests: `src/__tests__/routes-m8.test.ts` (approve ONCE / INSTALLMENTS incl.
  remainder, month clamp and lazy posting of #2; 409 / 422 / validation /
  scope / cross-org; `VAT_RATE_MISSING` by date; summary proposals and
  proposals-only currency; archive refusal; healed IMMEDIATE installment;
  contract), `routes-m7.test.ts` trimmed to the surviving routes,
  `transitions.test.ts` rewritten, `store-contract-m8.ts` (+ memory / Prisma
  runners) replaces `store-contract-m7.ts`. 304 unit tests; 342 with Postgres.
- `e2e/money-v1.e2e.mts` gains the M8 section (19 checks: proposal → approval →
  receivable → summary, installments, security edges); 103 checks pass against
  a local Postgres with Malafat's updated client.
- Prisma: `FeeProposalStatus` enum and `fee_proposals` columns edited in the
  M7 migration (`20261009120000_m7_fee_proposals`); local databases need
  `prisma migrate reset` or a fresh database (the test suite ran against
  `mutaba3a_test_m8`).

---

## [Unreleased] - 2026-10-10 — MUT-35: the repository seam becomes real (`src/db/`)

Epic MUT-34 (hosted Mutaba3a). Eng-reviewed 2026-10-10 (`/plan-eng-review`,
11 findings, 0 critical gaps). Scope reduced during review: the React context
layer was cut as an abstraction with no consumer (D1), so CLAUDE.md's AppShell
`RepoProvider(repo)` gap stays open. No behaviour change — the suite's
pass/fail counts are unchanged apart from the 9 new provider tests.

### Added
- **`src/db/provider.ts`** — the data-access seam. A frozen, module-scoped
  registry exposing `{ base, synced }`, with `getRepositories()`,
  `setRepositories()` (refused in production builds) and `resetRepositories()`.
  Module-scoped rather than a React context because Dexie migrations run inside
  `db.open()` before React mounts.
- `satisfies` conformance on 21 base repositories and 8 synced decorators.
  Renaming or deleting a repository method now fails `npm run typecheck`.
- `npm run typecheck` (`tsc --noEmit -p tsconfig.app.json`). The repo had no
  such script despite CLAUDE.md Phase 4 mandating it; typechecking only
  happened inside `npm run build`.
- `ISyncedRepositories` and `IPaymentRecordRepository` in `interfaces.ts`.
- `src/db/__tests__/provider.test.ts` — 9 tests covering default resolution,
  reference stability, injection, reset isolation and the production guard.

### Fixed
- **7 drifted repository interfaces corrected to describe reality.** Every case
  was an interface declaring something the implementation never had:
  `transactionRepo.delete` (it soft-deletes), `receiptRepo.getByExpense`,
  `vendorRepo.findByName` (it matches by alias), `monthCloseRepo.set`,
  `retainerRepo.delete`, `projectedIncomeRepo.{getBySource,getByPeriod,create,delete}`,
  and `IExpenseRepository` missing `getYearlyTotals` / `getAllProfilesTotals` /
  `getReceiptCount` while typing `list` as `Expense[]` instead of
  `ExpenseDisplay[]`. Three `create` parameter types were also wrong. No runtime
  behaviour was added to satisfy an aspirational signature.

### Fixed (QA reconciliation, 2026-10-10)
- **Settings could not be saved.** `useUpdateSettings` passed
  `settingsRepo.update` as a bare method reference; `update` calls `this.get()`,
  and TanStack invokes `mutationFn` with its own `this`, so it threw
  `this.get is not a function`. With no `onError` on the mutation it failed
  silently — changing the default currency from Settings never persisted.
  Pre-existing (`acb1144:useQueries.ts:442` had the same shape), surfaced
  because the refactor touched the line. Now a closure, which binds `this` and
  keeps resolution lazy. **This is the one deliberate behaviour change in
  MUT-35**, accepted rather than preserving a silent data-loss bug.

### Changed
- `useRetainerQueries` also routes through the provider (nine consumers total).
  Without it the `retainerAgreements` and `projectedIncome` slots had zero
  callers, so a future `setRepositories` swap would have left retainer screens
  reading Dexie while everything else moved — a half-local view with no error.
- Removed a provider test that asserted a tautology (it could not fail for the
  reason its comment claimed), rather than leave it posing as coverage.
- Eight consumers now resolve through the provider: the four query hooks,
  `paymentRequestService`, `recurringExpenseService`, `lib/zipExport.ts` and
  `useIssueAndDownload.tsx`. Each call site keeps the family it used before
  (`base` → `base`, `synced` → `synced`), so which mutations capture a sync op
  is unchanged.
- Mock wiring updated in `useIncomeQueries.test.tsx` and
  `useRecurringExpenseQueries.test.tsx` — assertions untouched. `vi.mock`
  intercepts imports, so the barrel had to become the interception point.

### Technical
- `TECH_DEBT.md` TD-013 corrected: it claimed the Dexie implementation
  satisfied the interfaces, which nothing checked. Applying the check found the
  7 drifts above.
- `TODOS.md`: recorded that most transaction mutations bypass the sync op-log
  and never sync between devices, and that expenses never sync at all. Both
  pre-existing, both preserved here.
- Known gap `gstack-shortcut(dec-5f2c2123)`: `synced.*` is bound to the Dexie
  singletons at module load and does not follow `setRepositories`. Upgrade when
  MUT-43 injects a hosted source.

---

## [Unreleased] - 2026-10-09 — Money v1 Milestone 7: fee proposals (negotiations) (`server/`, API `1.6.0-m7`)

Brief `money-v1-m7-fee-proposals.md` (+ `-tests.md`), approved by the owner on
2026-10-09 (single round · agreed amount prefills the wizard · fixed fee only ·
overview lists every connected client). Additive; closes the gap before a fee
agreement exists.

### Added
- **Fee proposals** (`src/proposals/transitions.ts`, `src/routes/fee-proposals.ts`):
  `POST /v1/fee-proposals` (project currency, `proposedOn` defaults to today,
  409 `PROPOSAL_OPEN` while one is open on the project), `GET /v1/fee-proposals`
  (`projectId`, `customerId`, `status`, `open=true|false`, keyset pages),
  `GET /v1/fee-proposals/{id}`, `POST …/approve` (PROPOSED → CLIENT_APPROVED,
  agreed amount = proposed), `POST …/agree` (PROPOSED | CLIENT_APPROVED →
  AGREED with an explicit amount), `POST …/withdraw` (any open state →
  WITHDRAWN, idempotent). Scopes reused: `agreements:read` / `agreements:write`.
  Audit `fee_proposal.{created,client_approved,agreed,withdrawn,converted}`.
- **Conversion**: `POST /v1/agreements` accepts `feeProposalId` (outside the
  preview token); the store marks the proposal CONVERTED with `agreementId` in
  the agreement's transaction (`StateConflict` → 409 `PROPOSAL_NOT_OPEN` on a
  race); 422 `PROPOSAL_NOT_FOUND` / `PROPOSAL_PROJECT_MISMATCH` /
  `PROPOSAL_NOT_AGREED` before it.
- **Project summary** gains `proposal` (`FeeProposalSummary | null`: the open
  one, else the latest converted one), on `GET /v1/summaries/projects/{id}` and
  the customer summary's project rows.
- Table `fee_proposals` (migration `20261009120000_m7_fee_proposals`); one open
  proposal per project is serialised by the project row lock in
  `PrismaLedgerStore.feeProposals.create`, mirrored by the memory store.
- `PATCH /v1/projects/{id}` refuses a currency change (409 `CURRENCY_LOCKED`)
  while a proposal is open.

### Changed
- API version `1.6.0-m7`; `openapi/openapi.yaml` regenerated (new tag "Fee
  proposals", reasons `PROPOSAL_OPEN`, `PROPOSAL_NOT_OPEN`, `PROJECT_NOT_FOUND`
  (already raised by the preview, now published), `PROPOSAL_NOT_FOUND`,
  `PROPOSAL_NOT_AGREED`, `PROPOSAL_PROJECT_MISMATCH`).

### Technical
- Tests: `src/proposals/__tests__/transitions.test.ts` (state table, agreed
  amount, current proposal), `store-contract-m7.ts` (memory always, Postgres
  with `MUTABA3A_TEST_DATABASE_URL`), `src/__tests__/routes-m7.test.ts` (7
  cases: create / open conflict / approve + agree / withdraw / conversion /
  lists + summaries / contract). Earlier milestones' version pins bumped.
  Lint, typecheck, 299 unit tests, build, `openapi:check` green. The Postgres
  contract suite could not run in the authoring session (no database); CI's
  `server-ci.yml` runs it.
- Operator action on release: `deploy.sh` applies the migration (handover §2).

## [Unreleased] - 2026-10-08 — First production deploy: Cloud Run rejected the `PORT` env; smoke CLI hardened (`server/`)

The first `scripts/deploy.sh` run against `malafat-production` created Cloud
SQL, the secrets, the service account and migrated the database, then failed
at `google_cloud_run_v2_service.api` with `Error 400 … reserved env names were
provided: PORT`. Downstream, `terraform output -raw service_url` had nothing
to print and `npm run smoke -- --url ""` crashed with
`Failed to parse URL from /health`.

### Fixed
- `server/infrastructure/terraform/main.tf`: removed the `PORT=8787` env
  entry. Cloud Run injects `PORT` from `container_port` and refuses templates
  that set it; `config.PORT` reads the injected value (default 8787 locally).
  Comment on the `ports` block records why.
- `server/src/smoke.ts` + `server/src/scripts/smoke.ts`: new exported
  `parseBaseUrl` validates `--url` before any request (empty → names the
  `terraform output` cause and the recovery; relative or non-http → "must be
  an absolute http(s) URL"); the CLI exits 2 with that one line instead of an
  undici stack trace. `runSmoke` uses the same validation.
- `server/scripts/deploy.sh`: fails with a red `[deploy]` line naming the
  recovery (re-run) when the full apply leaves no `service_url`, instead of
  calling the smoke script with an empty URL.

### Changed
- `server/DEPLOYMENT.md`: new §2.1 "If a step fails" (what each step leaves
  behind, re-run is the recovery, the `-target` warnings are expected, the
  PORT error verbatim); §3 echoes the URL and stops on a missing output; §1.1
  records that production is in `malafat-production`.
- `.claude/INFRA.md`: project choice recorded; Deployed table notes the
  2026-10-08 partial apply (database and secrets exist, service pending the
  re-run).

### Technical
- Tests: `src/__tests__/smoke.test.ts` +3 (`parseBaseUrl` accept/strip,
  empty, relative/non-http). Lint, typecheck, 180 unit tests, build green;
  `terraform fmt -check` green. `terraform validate` could not run in the
  session (provider registry unreachable); CI's `terraform` job covers it.
- Operator action: pull and re-run `./scripts/deploy.sh`; then §3–§5.
## [Unreleased] - 2026-10-09 — Database access through the Cloud SQL proxy (`server/scripts/db.sh`)

### Added
- `scripts/db.sh <migrate|status|psql|proxy>` with npm shortcuts `db:migrate`, `db:migrate:status`, `db:psql`, `db:proxy`: reads the instance connection name and local URL from `terraform output` (so only `TF_STATE_BUCKET` is needed), opens `cloud-sql-proxy` on 127.0.0.1:5440 for the one command and stops it on exit. `migrate` is `prisma migrate deploy` (forward-only); `status` is read-only and does not fail on pending migrations; `proxy` waits for Ctrl-C and prints the local URL for other tools. With `DATABASE_URL` set no proxy is started, so the same commands serve local development. Same mechanics as `deploy.sh`'s own migration step, which is unchanged: a normal release still needs none of this.

### Changed
- `DEPLOYMENT.md` §6 day-2 rows and `README.md` point at the shortcuts; the handover's deployment section now says that `deploy.sh` migrates by itself and when the by-hand path applies.

## [Unreleased] - 2026-10-08 — Money v1 end-to-end run; two fixes it found (`server/`, API `1.5.1-m6`)

### Fixed
- **Supplement with a new IMMEDIATE installment never posted.** `POST /v1/agreements/{id}/supplements` with `distribution: NEW_INSTALLMENT` and `trigger.type: IMMEDIATE` created the installment but left it PENDING with no receivable: creation posts IMMEDIATE installments inline and lazy posting only handles DATE triggers. The route now posts it as creation does, audits `installment.posted` (with the supplement id) and answers with the posted state. `routes-m3.test.ts` covers it.
- **`POST /v1/retainers/{id}/cancel` answered with the fixed-fee detail shape** (`agreement` + empty `installments`/`supplements`). It now returns the retainer charges view (`agreement`, `versions`, `charges`), the same shape as `GET …/charges` and `POST …/changes` and the shape Malafat's published contract already declared. The cancelled final month (prorated or credited) is visible in the response.

### Added
- `server/e2e/money-v1.e2e.mts` — the end-to-end run over HTTP: Malafat's own Mutaba3a client (`features/money/application/mutaba3a-client.ts`, loaded from a Malafat checkout) driving a running server through provisioning, M1 bind, M2 customers / projects / import / PATCH, M3 VAT / fixed fee / installments / supplement / retainer, M5 change preview and apply, cancel preview and PRORATE cancel with credit, M4 allocation preview, payment, replay, operations lookup, allocate later, reversal, credit, corrected payment, M6 summaries (invariants `outstanding = overdue + dueToday + notYetDue`, equality with open receivables and with the customers' rows, unallocated vs POSTED payments), audit, attachments-not-configured, reconcile, disconnect — plus the security edges: forged key, narrow scopes, cross-organization 404s, same-tenant second binding, idempotency reuse, stale `If-Match`, forged preview tokens, token required for a crediting cancel. **84 checks, all passing** against Postgres 16.
- `server/e2e/attachments.e2e.mts` — attachments in process on the real Postgres store with `MemoryAttachmentStorage`: create → PUT → complete (incomplete / size and type mismatch / idempotent complete) → list (pending hidden) → download (TTL, filename) → delete (object removed, 404 after), scope and cross-organization refusals, every rule reason, audit trail. **34 checks, all passing.**
- `npm run smoke` (with the admin token) and `npm run reconcile` / `-- --dry` were run against the same database.

### Technical
- API version `1.5.1-m6`; `openapi/openapi.yaml` regenerated; Malafat's vendored contract refreshed to it.
- The e2e scripts are `.mts` outside `src/`, so lint and typecheck do not cover them; `tsx` runs them.

## [Unreleased] - 2026-10-08 — Money v1 Milestone 6: summaries, audit listing, attachments (`server/`)

Brief `money-v1-m6-summaries-audit-attachments.md`, decided by the engineering
owner under the "complete the epic" instruction. API version `1.5.0-m6`;
additive. Closes the Money v1 server epic (M1–M6).

### Added
- **Summaries** (`src/summaries/compute.ts`, `src/routes/summaries.ts`):
  `GET /v1/summaries/organization[?currency=]`, `/customers/{id}`,
  `/projects/{id}`. Computed on read from OPEN receivables and POSTED payments:
  exact day buckets (`outstanding = overdue + dueToday + notYetDue`),
  unallocated funds, last payment date, and statuses — customer `SETTLED /
  OVERDUE / OUTSTANDING / UP_TO_DATE`, fixed project `PENDING / OUTSTANDING /
  PARTIALLY_PAID / OVERDUE / PAID_IN_FULL` (never `PAID_IN_FULL` while an
  installment is pending), retainer `UP_TO_DATE / OUTSTANDING / OVERDUE /
  CANCELLED / SETTLED`, `NONE` without agreements. Retainer `monthly` is the
  gross of the terms in force (M5 versions). Scope `summaries:read`.
- **Audit listing** `GET /v1/audit?entityType=&entityId=&action=&cursor=&limit=`
  (scope `audit:read`), keyset-paginated like every list;
  `AuditRepository.list`; index `(organizationId, entityType, entityId,
  createdAt)`.
- **Attachments** (`src/attachments/{rules,storage}.ts`,
  `src/routes/attachments.ts`): `POST /v1/attachments/uploads` (PDF / JPEG /
  PNG ≤ 10 MB, exactly one of customerId / projectId / paymentId, 201 with a
  V4 signed PUT URL), `POST /v1/attachments/{id}/complete` (verifies the
  object's size and type: `UPLOAD_INCOMPLETE` / `UPLOAD_MISMATCH`),
  `GET /v1/attachments?…`, `GET /v1/attachments/{id}/download` (signed URL
  with a safe `Content-Disposition`), `DELETE /v1/attachments/{id}` (soft
  delete + object removal). Object key `org/{organizationId}/{attachmentId}`,
  never the filename. `AttachmentStorage` port with `GcsAttachmentStorage`
  (`@google-cloud/storage`, signBlob through the service account) and
  `MemoryAttachmentStorage` (tests). Config `ATTACHMENTS_BUCKET` (optional →
  503 `ATTACHMENTS_NOT_CONFIGURED`), `ATTACHMENTS_URL_TTL_SECONDS` (900).
  Audit `attachment.uploaded`, `attachment.deleted`.
- **Terraform:** private bucket (uniform access, public access prevention),
  `roles/storage.objectAdmin` on it and `roles/iam.serviceAccountTokenCreator`
  on the service account for itself, `storage` + `iamcredentials` APIs, the two
  env vars on Cloud Run, output `attachments_bucket`.
- **Schema + migration `20261008230000_m6_attachments_audit_index`.**
- **Published reasons:** 422 `UPLOAD_INCOMPLETE`, `UPLOAD_MISMATCH`,
  `ATTACHMENT_TARGET_REQUIRED`, `ATTACHMENT_TARGET_AMBIGUOUS`,
  `MIME_TYPE_UNSUPPORTED`, `FILE_TOO_LARGE`, `FILENAME_INVALID`,
  `ATTACHMENT_NOT_READY`; error code `ATTACHMENTS_NOT_CONFIGURED` (503).
- **Tests:** 315 (M6: compute 7, rules 3, store contract 2 × memory +
  Postgres, routes-m6 5).

### Not done (brief §5.4, §7)
- No malware scan before `READY`; `complete` checks size and type only. A
  scanner on bucket events is the follow-up; the UI downloads, never renders
  inline.

---

## [Unreleased] - 2026-10-08 — Money v1 Milestone 5: retainer changes, proration, cancel preview, reconcile script (`server/`)

Brief `money-v1-m5-retainer-changes.md`, decided by the engineering owner under
the "complete the epic" instruction. API version `1.4.0-m5`; additive
(`RetainerChargesResponse.versions`, `RetainerCharge.version`,
`Agreement.retainer.cancelEffectiveDate`, `FinalMonth` gains `PRORATE`).

### Added
- **Versions, not edits:** `retainer_versions` appends a version per change;
  version 1 is synthesized from the agreement row (no backfill).
  `generateCharges` prices each service month from the version in force for it
  (`src/retainers/terms.ts`), honours a per-version billing day and end month,
  and stamps `retainer_charges.version`. Charges already generated keep their
  terms.
- **Routes:** `POST /v1/retainers/{id}/changes/preview` (previous vs next terms
  at the VAT rate in force on the effective month, `changed`,
  `firstChargedMonth`, `chargesKept`, token), `POST /v1/retainers/{id}/changes`
  (201, idempotent; token covers body + agreement version + latest version +
  rate), `POST /v1/retainers/{id}/cancel/preview` (final month under FULL /
  PRORATE / WAIVE, posted charge, credit with `limitedByPayments`,
  `stoppedFrom`, `outstandingAfter`); `POST /v1/retainers/{id}/cancel` accepts
  `PRORATE` and an optional `previewToken`, required whenever a credit is
  created (422 `PREVIEW_TOKEN_REQUIRED`). Audit `retainer.changed`;
  `receivable.credited` with `source: RETAINER_CANCEL`.
- **Proration** (`src/retainers/proration.ts`): `amount × days ÷ daysInMonth`,
  half-up, days = the cancellation day inclusive; VAT computed on the prorated
  amount at the version's rate. A posted final month is adjusted by a credit
  (WAIVE: the outstanding; PRORATE: the difference), never above the
  outstanding — what was paid is not refunded; earlier credits are not credited
  twice.
- **Reconcile script:** `npm run reconcile [-- --dry]` walks every organization
  (`organizations.list()`), posts due installments and charges in its timezone,
  prints a per-organization summary; for cron / Cloud Scheduler (README).
- **Published reasons:** 422 `CHANGE_EFFECTIVE_INVALID`,
  `CHANGE_NOTHING_CHANGED`, `FINAL_MONTH_INVALID`, `PREVIEW_TOKEN_REQUIRED`;
  409 `AGREEMENT_CANCELLED` on changing or previewing a cancelled retainer.
- **Schema + migration `20261008220000_m5_retainer_versions_proration`.**
- **Tests:** 295 (M5: terms 7, proration 6, schedule +1, store contract 3 ×
  memory + Postgres, routes-m5 8 incl. the reconcile script).

---

## [Unreleased] - 2026-10-08 — Money v1 Milestone 4: payments, allocations, reversals, credits, operations lookup (`server/`)

All eight decisions of `money-v1-m4-payments-allocations.md` approved as
proposed. API version `1.3.0-m4`; additive (receivables gain `credited`).

### Added
- **Pure money math:** `src/payments/allocate.ts` (outstanding = gross − paid −
  credited; explicit-set validation that never adjusts; `OLDEST_FIRST` and
  `SETTLE_MATTERS` suggestions; resulting balances per receivable, project and
  customer), `src/payments/credit.ts` (credit VAT split at the receivable's
  frozen rate, `net + vat = credit`; capacity check), `src/payments/numbering.ts`
  (`PAY-YYYY-NNNN`), `src/payments/preview-token.ts` (token over the allocation
  set **and** the `(id, version)` of every eligible receivable — decision 2).
- **Schema + migration `20261008205727_m4_payments_allocations_credits`:**
  `payments` (number unique per organization, `allocatedMinor`, status
  POSTED/REVERSED, reversal fields, `replacesPaymentId`), `payment_allocations`,
  `receivable_credits` (append-only), `payment_counters` (per organization and
  year, row-locked in the posting transaction); `receivables.creditedMinor`.
- **Store:** `PaymentRepository` (create / allocate / reverse / list / replacedBy)
  and `ReceivableRepository.{getByIds, listEligible, credit, listCredits}`,
  `IdempotencyRepository.get`. Postgres locks each receivable (`FOR UPDATE`),
  checks capacity under the lock and recomputes `status` from the sums; a race
  the token did not catch surfaces as `InsufficientCapacity` → 409
  `PREVIEW_STALE`. The memory store's `seedPaid` test hook is gone.
- **Routes:** `POST /v1/allocations/preview` (new payment or `{ paymentId }`),
  `POST /v1/payments`, `GET /v1/payments`, `GET /v1/payments/{id}`,
  `POST /v1/payments/{id}/allocations`, `POST /v1/payments/{id}/reverse`,
  `POST /v1/receivables/{id}/credits`, `GET /v1/receivables/{id}/credits`,
  `GET /v1/operations/{idempotencyKey}`. Audit actions `payment.recorded`,
  `payment.allocated`, `payment.reversed`, `receivable.settled`,
  `receivable.credited`.
- **Published reasons:** 422 `ALLOCATION_EXCEEDS_PAYMENT`,
  `ALLOCATION_EXCEEDS_OUTSTANDING`, `ALLOCATION_DUPLICATE`,
  `RECEIVABLE_NOT_FOUND`, `RECEIVABLE_NOT_OPEN`, `RECEIVABLE_CUSTOMER_MISMATCH`,
  `PAYMENT_NOT_POSTED`, `NO_UNALLOCATED_FUNDS`, `CREDIT_EXCEEDS_OUTSTANDING`,
  `REPLACES_NOT_REVERSED`, `REPLACES_CUSTOMER_MISMATCH`, `CUSTOMER_NOT_FOUND`;
  409 `ALREADY_REVERSED`; preview warning `NO_ELIGIBLE_RECEIVABLES`.

### Changed
- `itemStatus` takes `creditedMinor`: credits count towards `PAID` but never
  read as `PARTIALLY_PAID` (a credited, unpaid item stays `DUE` / `OVERDUE`).
  Installment and charge statuses, `countOutstandingByProject` (archive guard)
  and receivable `outstanding` all subtract credits.
- `GET /v1/operations/{key}` is `PENDING | COMPLETED | 404`, not `FAILED`
  (decision 7): a key released by a 5xx is reusable.

### Technical
- Tests: 268 (28 files), +88: `payments/__tests__/{allocate,credit,numbering}`,
  `store-contract-m4.ts` (memory + Postgres, incl. 12 concurrent numbered
  creates and a sums-equal-rows sequence), `routes-m4.test.ts`; the M3
  receivable-status test now records a real payment. Postgres 16 ran locally
  for the contract suite. `openapi:check` green; ESLint and `tsc` clean.

---

## [Docs] - 2026-10-08 — Money v1 Milestone 4 design brief and test plan (proposed)

### Added
- `.claude/designs/money-v1-m4-payments-allocations.md` and `…-tests.md`:
  payments with allocations previewed before posting (OLDEST_FIRST /
  SETTLE_MATTERS suggestions, balance-covering preview token), unallocated
  funds allocated later, whole-payment reversal with `replacesPaymentId`,
  append-only credits against posted receivables (the adjustment M3
  reserved), `PAY-YYYY-NNNN` numbering, `GET /v1/operations/{key}`. Eight
  decisions await the product owner before Phase 2. No `server/` change.

---

## [Docs] - 2026-10-08 — Money v1 Milestone 3, Malafat side: design brief and test plan

### Added
- `.claude/designs/money-v1-m3-malafat-ui.md` and `…-tests.md`: the Malafat
  obligations of the M3 brief (§2.6) — VAT settings card, fee-agreement wizard
  with the preview step, matter and client financial detail — designed and
  implemented the same day in the Malafat repo (`crm-platform/.claude/
  CHANGELOG.md` "Money v1 Milestone 3"). Kept here with the other Money v1
  cross-repo artifacts because Malafat's repo rule forbids new Markdown and
  Confluence was not reachable from the session. No `server/` change.

---

## [Unreleased] - 2026-10-08 — Money v1 Milestone 3: agreements, installments, VAT, retainers, receivables (`server/`)

Approved with amendments (brief rev. 2: VAT treatment per payable item with
project/customer defaults; due dates default to end of month with the
payment-terms vocabulary; retainers in basic form). API version `1.2.0-m3`;
additive, M1/M2 routes unchanged except the project currency lock and the
archive guard promised in M2.

### Added
- **Pure money math:** `src/vat.ts` (basis points, half-up `bigint` rounding,
  exclusive/inclusive bases, four treatments), `src/agreements/schedule.ts`
  (installments split the contractual amount in its basis, per-item VAT, last
  absorbs the remainder, 1–60 items), `src/agreements/status.ts`
  (`PENDING / DUE / OVERDUE / PARTIALLY_PAID / PAID / VOID`), `src/dates.ts`
  (organization-timezone "today", ISO date arithmetic, `dueDateFor` with
  `IMMEDIATE | EOM | EOM_15 | EOM_30 | EOM_45 | EOM_60`),
  `src/retainers/schedule.ts` (chargeable service months, 120-month bound),
  `src/preview-token.ts` (generic, canonical JSON, bigint-safe).
- **Schema + migration `20261008192015_m3_agreements_installments_vat`:**
  `vat_rates` (append-only, effective-dated), `agreements` (FIXED/RECURRING,
  frozen rate, totals, terms, retainer fields), `installments`,
  `retainer_charges` (unique per agreement + month), `receivables`
  (created only when posted; `paid_minor` reserved for M4),
  `agreement_supplements`; `vatTreatment` on customers and projects.
  Amounts are `BIGINT`; calendar dates are ISO strings.
- **Routes:** `GET /v1/vat-rates`, `PUT /v1/settings/vat`;
  `POST /v1/agreements/preview`, `POST /v1/agreements`, `GET /v1/agreements`,
  `GET /v1/agreements/{id}`, `POST …/{id}/supplements`, `POST …/{id}/cancel`;
  `POST /v1/installments/{id}/trigger`; `POST /v1/retainers/preview`,
  `POST /v1/retainers`, `GET /v1/retainers/{id}/charges`,
  `POST /v1/retainers/{id}/cancel`, `POST /v1/retainers/reconcile`;
  `GET /v1/receivables`, `GET /v1/receivables/{id}`.
- **Lazy posting** (`src/agreements/posting.ts`): dated installments and
  retainer charges post when their date has arrived, on every read that
  renders agreements or receivables and on reconcile; idempotent in the store
  (receivable + marker in one transaction, unique charge per month).
- **Preview tokens freeze the rate:** a VAT-rate change between preview and
  create is `409 PREVIEW_STALE`.
- **Supplements** (`src/agreements/supplement.ts`): last-unposted / prorate /
  new installment; negative only within unposted capacity, otherwise
  `422 SUPPLEMENT_EXCEEDS_UNPOSTED` with `requiresAdjustment` naming the
  posted receivables.
- Published `details.reason` vocabularies for 409 and 422 in the API
  description (`CONFLICT_REASONS`, `VALIDATION_REASONS`).
- **Tests (79 new, 196 total, 22 files):** unit (dates, VAT table, schedule,
  status, retainer schedule, token), M3 storage contract on memory and
  Postgres, `routes-m3.test.ts` (VAT rates, preview/create/stale token/rate
  change, treatment chain, validation reasons, idempotent create + audit,
  lazy posting across a timezone midnight, manual triggers, receivable
  statuses in two timezones with seeded payments, filters, supplements in
  all three distributions, cancel rules, currency lock + archive guard,
  retainers preview/create/reconcile/cancel FULL vs WAIVE, contract).

### Changed
- `projects.hasPostedActivity` is now "has an agreement"; `POST /v1/projects/{id}/archive`
  refuses with `409 PROJECT_HAS_OUTSTANDING`. `MemoryLedgerStore.markProjectPosted`
  removed (`seedPaid` added for M4-shaped tests).
- `openapi/openapi.yaml` regenerated (3990 lines).

### Technical
- Verification: typecheck, lint, `npm run test:db` (196), `openapi:check`.
- Deferred to M4/M5 (brief rev. 2): payments and allocations, credits/
  adjustments against posted receivables, retainer amendments and proration,
  invoice numbering, summaries.

---

## [Unreleased] - 2026-10-08 — M3 design brief + test plan (agreements, installments, VAT)

### Added
- `.claude/designs/money-v1-m3-agreements-installments-vat.md` — fixed-fee
  agreements, installments, effective-dated VAT, lazy posting of dated
  installments, supplements within unposted capacity, cancel while nothing is
  posted, receivables with server-computed statuses. Seven decisions for
  product-owner approval; no code until approved.
- `.claude/designs/money-v1-m3-agreements-installments-vat-tests.md`.

---

## [Unreleased] - 2026-10-08 — `npm run openapi:json` for Malafat's vendored contract

### Added
- `server/src/scripts/export-openapi.ts --json` (`npm run openapi:json`):
  prints the contract as JSON inside a `_vendored` envelope (source, git
  commit, sha256 of the YAML). Malafat keeps that output at
  `apps/web/src/features/money/contract/mutaba3a-openapi.json`, and its
  contract test fails when the Malafat client calls anything not in it. Refresh
  the copy whenever `openapi.yaml` changes.

---

## [Unreleased] - 2026-10-08 — Money v1 Milestone 2: customers, projects, external references, import (`server/`)

Approved by the product owner the same day (all six decisions in the brief).
API version `1.1.0-m2`; everything additive, M1 untouched.

### Added
- **Schema + migration `20261008152452_m2_customers_projects`:** `customers`,
  `projects` (one currency each, `version` for optimistic concurrency,
  ACTIVE/ARCHIVED, never deleted) and `external_references` (unique per
  organization + provider + entity type + external id; one per entity per
  provider). Keyset indexes on `(organizationId, createdAt, id)`.
- **Routes:** `POST/GET /v1/customers`, `GET/PATCH /v1/customers/{id}`,
  `POST /v1/customers/{id}/archive`; the same for `/v1/projects`;
  `POST /v1/import/preview` and `POST /v1/import/commit`. Scopes
  `customers:*` / `projects:*` (import needs both write scopes). Creation
  with an `externalReference` is idempotent (200 existing, never a
  duplicate) and requires a CONNECTED integration; `PATCH` needs
  `If-Match: <version>`; a project's currency is locked once anything is
  posted (`hasPostedActivity`, always false until M3); archiving a customer
  with active projects is refused.
- **`src/pagination.ts`:** opaque `(createdAt, id)` cursors, `limit` 1–200
  default 50, shared by every list.
- **`src/import/plan.ts`:** the pure planner preview and commit share
  (`create | link | conflict` per row, reasons `UNKNOWN_CUSTOMER`,
  `CUSTOMER_MISMATCH`, `CURRENCY_DIFFERS`, `VALIDATION:<detail>`, warnings
  `NAME_DIFFERS`, `ARCHIVED`; 500-row cap). `src/import/preview-token.ts`:
  sha256 proof that commit carries the previewed rows, verified in constant
  time, never stored.
- **`src/if-match.ts`** middleware; `src/routes/shared.ts` (error response
  sets, connected-integration guard, page helpers, reference batch lookup).
- **Published `details.reason` vocabulary** for 409 CONFLICT
  (`VERSION_MISMATCH CURRENCY_LOCKED CUSTOMER_MISMATCH HAS_ACTIVE_PROJECTS
  PREVIEW_STALE INTEGRATION_NOT_CONNECTED`) in the OpenAPI description.
- **Tests (52 new, 117 total, 13 files):** `pagination.test.ts`,
  `import/__tests__/plan.test.ts`, `preview-token.test.ts`, the M2 storage
  contract (`store-contract-m2.ts`, run by memory and Postgres), and
  `routes-m2.test.ts` (scope matrix, idempotency, external-reference
  idempotency, pagination, If-Match, archive rules, currency lock, import
  preview/commit/re-run/partial failure/isolation, contract check).

### Changed
- `LedgerStore` gains `customers`, `projects`, `externalReferences`; both
  implementations updated. `MemoryLedgerStore.markProjectPosted()` is a test
  hook for the M3 currency lock.
- `openapi/openapi.yaml` regenerated (2036 lines); `openapi:check` green.
- `money-v1-api-contract.md` §3 M2 marked implemented (with the entity-type
  refinement of external-id uniqueness); the M2 brief status → implemented.

### Technical
- Verification: typecheck, lint, `npm run test:db` (117, Postgres 16),
  `openapi:check`. Migration generated with `prisma migrate dev` and applied
  with `migrate deploy`; production picks it up through `deploy.sh`'s proxy
  step, no runbook change.
- Debt: TD-020 (import `loadState` reads linked entities one by one; bounded
  by the 500-row cap, batch it when M3 adds more lookups).

---

## [Unreleased] - 2026-10-08 — M2 design brief + test plan; TD-018 accepted

### Added
- `.claude/designs/money-v1-m2-customers-projects.md` — Milestone 2 design
  brief (customers, projects, external references, import preview/commit,
  pagination, optimistic concurrency). Six decisions listed for product-owner
  approval; no code until approved (CLAUDE.md lifecycle).
- `.claude/designs/money-v1-m2-customers-projects-tests.md` — the test plan
  that lands first once approved.

### Changed
- `TECH_DEBT.md` TD-018 → **Accepted**: keys stay operator-issued, no
  self-serve (product-owner decision; Malafat records the same in its
  ADR-150 addendum together with MAL-870: Money included for every tenant as a
  $0 Stripe add-on).

---

## [Unreleased] - 2026-10-08 — Deploy path revised: production only, everything local except hosting (ADR-026 rev. 2)

### Changed
- Product-owner direction after the first deploy artifacts landed on `main`:
  no staging for now, and nothing runs in GCP that can run on the operator's
  machine — build with the local Docker daemon and push, like Malafat's
  `pnpm release`.
- `server/scripts/deploy.sh` — no environment argument (production; a later
  `ENVIRONMENT=staging` still works), `docker build --platform linux/amd64`
  + `docker push` from the operator's daemon, `prisma migrate deploy` run from
  `server/` through the **Cloud SQL Auth Proxy** on `127.0.0.1:5440`, then
  `terraform apply -var image_tag`, then smoke. Checks for every tool up front.
- `server/infrastructure/terraform` — the Cloud Run migration job and the
  Cloud Build API are gone; `environment` defaults to `production`,
  `db_availability` to `REGIONAL`; new outputs `proxy_port` and the sensitive
  `local_database_url` for operator-side migrations and psql.
- `server/Dockerfile` — back to a single runtime image (the `migrate` target
  existed only for the job); `openssl` kept for Prisma on musl.
- `.github/workflows/server-ci.yml` — builds the one image; still never pushes.
- `server/DEPLOYMENT.md`, `server/README.md`, `.claude/INFRA.md`, ADR-026,
  TEST_PLAN, CI_CD, TECH_DEBT (TD-019 wording), M1 proposal — rewritten for
  the production-only, local-build flow.

### Removed
- `server/cloudbuild.yaml`, `server/infrastructure/terraform/staging.tfvars.example`.

### Technical
- Verification: `npm run typecheck`, `npm run lint`, `npm run test:db`
  (65 tests), `npm run openapi:check`, `terraform fmt -check` + `validate`.

---

## [Unreleased] - 2026-10-08 — Money v1 M1: the hosted API becomes deployable (TD-019, ADR-026)

### Added
- `server/infrastructure/terraform/` — Terraform for one environment of the
  hosted API: Cloud SQL Postgres 16 (db `mutaba3a`, user `mutaba3a_api`),
  Secret Manager secrets with Terraform-generated values (database URL, admin
  token), a least-privilege service account, Artifact Registry, a Cloud Run
  **job** for `prisma migrate deploy`, the Cloud Run **service** with probes,
  Cloud SQL volume and secret-backed env, public invoker, and an uptime check
  with an optional alert. `environment` selects `-staging`/`test` keys vs
  production/`live` keys. `max_instances` is validated to 1 (TD-017).
- `server/scripts/deploy.sh` — the operator rollout: Cloud Build (or local
  Docker) builds both images tagged with the git SHA, a targeted apply points
  the migration job at the new image, the job runs and is waited on, the full
  apply rolls the service with `SERVICE_VERSION=<sha>`, then the smoke test
  runs. The service stays on the old revision if migrations fail.
- `server/cloudbuild.yaml` — builds `mutaba3a-api` and `mutaba3a-api-migrate`
  from the two Dockerfile targets.
- `server/src/smoke.ts` + `src/scripts/smoke.ts` (`npm run smoke`) —
  post-deploy checks over an injected `fetch`: health (+ expected version),
  readiness, contract, three auth rejections, and with `MUTABA3A_ADMIN_TOKEN`
  the M1 exit criterion end to end (provision → issue key → validate → revoke
  → revoked key rejected). Never prints a secret. 5 tests in
  `src/__tests__/smoke.test.ts` run it against the in-memory app.
- `.github/workflows/server-ci.yml` — on every change under `server/`:
  type-check, lint, `openapi:check`, unit + route tests, the Postgres contract
  suite against a `postgres:16` service container, both Docker builds with a
  `/health` probe of the runtime image and a Prisma CLI check of the migrate
  image, `terraform fmt -check` + `validate`. Resolves TD-019.
- `server/DEPLOYMENT.md` — the operator runbook: prerequisites, staging,
  proof, provisioning the first firm, wiring Malafat (`malafat-web-mutaba3a-api-url`),
  production, day-2 operations, the ticket-closure table and what comes next.
- `.claude/INFRA.md` — created (CLAUDE.md listed it; it did not exist).

### Fixed
- `server/Dockerfile` — the migration story was broken: `npm prune --omit=dev`
  removed the Prisma CLI from the runtime image, so the documented
  `npx prisma migrate deploy` job would have tried to download it at run time.
  The Dockerfile now has a `migrate` target (full dependency tree, no app code,
  `CMD node_modules/.bin/prisma migrate deploy`) beside `runtime`, and both
  stages install `openssl` for Prisma's musl engines. `.dockerignore` added.

### Changed
- `server/README.md` — Deploy section points at Terraform, `deploy.sh` and
  `DEPLOYMENT.md`; Verify lists `npm run smoke` and CI.
- `.claude/designs/money-v1-m1-proposal.md` — deployment steps replaced by the
  shipped artifacts; acceptance table updated (implementation merged to main).

### Technical
- Malafat side (same day, its own changelog): `MUTABA3A_API_URL` is mounted
  from the secret `malafat-web-mutaba3a-api-url` in `release.ts`, listed as
  required by the secrets gate, with a release step to create it first.
- Verification: `npm run typecheck`, `npm run lint`, `npm run test:db`
  (65 tests, 7 files, Postgres 16), `npm run openapi:check`,
  `terraform fmt -check` + `terraform validate` (google 5.45.2, random 3.6.3).
  The Docker builds could not be run in the authoring environment (no daemon);
  CI builds them on the first push.

---

## [Unreleased] - 2026-10-08 — Money v1 Milestone 1: hosted Mutaba3a API (`server/`)

### Added
- `server/` — a standalone npm package (`@mutaba3a/api`): the hosted,
  organization-scoped financial API that Malafat's Money section calls
  (MUT/MAL Money v1, Option B; ADR-024/025). Hono + zod-openapi, Prisma 6 on
  Postgres, pino, vitest. Own lockfile, lint, Dockerfile and README.
- Milestone 1 surface: `GET /health`, `GET /ready`, `GET /v1/integration`
  (validate key; organization, masked key, scopes, missing scopes, binding),
  `POST /v1/integration/bind` (idempotent tenant binding, ORGANIZATION_MISMATCH
  on conflict), `POST /v1/integration/disconnect` (preserves history, revokes
  the calling key), and operator provisioning under `/admin/v1/*` behind
  `MUTABA3A_ADMIN_TOKEN` (organizations, API keys shown once, revoke, audit).
- Cross-cutting: API-key auth (format, sha256 storage, constant-time compare,
  live/test environment split, revocation, expiry), closed scope vocabulary,
  per-key sliding-window rate limit with `X-RateLimit-*`/`Retry-After`,
  `Idempotency-Key` middleware (replay / reuse-rejection / in-progress),
  append-only audit, standard error envelope with stable codes, request ids,
  decimal-safe `Money` (bigint minor units, string on the wire).
- Prisma migration `20261008093850_m1_control_tables`: organizations,
  api_keys, integrations, audit_events, idempotency_keys.
- Generated contract `server/openapi/openapi.yaml` with `openapi:generate` /
  `openapi:check`; `provision` CLI.
- Tests: 59 (money, keys/scopes, rate limiter, LedgerStore contract against
  memory and Postgres, route tests covering every auth failure code, scope
  enforcement, idempotency, binding conflicts, disconnect, isolation).
- Design artifacts: `.claude/designs/money-v1-repository-audit.md`,
  `money-v1-api-contract.md`, `money-v1-m1-proposal.md`.

### Changed
- `eslint.config.js` ignores `server/` (it has its own config).
- `.claude/DECISIONS.md`: ADR-024 overrides ADR-005 (MUT-30); ADR-025 records
  the hosted-API architecture (MUT-32). ADR-013 is unchanged.

### Technical
- The desktop/PWA app (`src/`) is untouched; it imports nothing from
  `server/`. Local-only operation remains a permanently supported mode.
- `server/.npmrc` sets `legacy-peer-deps` to work around an npm 10.9 arborist
  crash (`edgesOut`) when resolving zod 4 peer ranges.
- Debt: TD-017 (per-instance rate limiter), TD-018 (operator-only
  provisioning; no self-serve accounts), TD-019 (no CI for `server/`).

---

## [Unreleased] - 2026-10-05 — Updater signing key rotation

### Changed
- Rotated the Tauri updater public key in `src-tauri/tauri.conf.json` to the
  keypair with minisign fingerprint `AB7B64537B1DE22C` (was `BEDF931CA1D6C777`).
  The matching private key is what `deploy.sh` and `build-windows.yml` sign
  release artifacts with, via `TAURI_SIGNING_PRIVATE_KEY`.
- Consequence: builds already installed in the field carry the old public key,
  so they will reject updates signed with the new private key. Clients on an
  older build need a manual reinstall to rejoin the update channel.
- **Withdrawn 2026-10-10 (MUT-49, ADR-031).** The premise above was false: the
  v0.0.63 signatures, the macOS release signer and the CI secret are all
  `BEDF931CA1D6C777`; the `AB7B64537B1DE22C` private half never signed a
  release and is not configured in the pipeline. The key was restored on
  2026-10-10; no reinstall is needed.

---

## [Unreleased] - 2026-10-05 — MUT-28 OAuth client for Malafat workspaces

### Added
- PKCE S256 helpers (`src/sync/transport/oauth-pkce.ts`), verified against the
  RFC 7636 Appendix B test vector. `plain` is not implemented.
- Malafat authorization-code client (`oauth-client.ts`): RFC 8414 discovery,
  authorize URL, callback parsing, code exchange, refreshing.
- Flow orchestrator (`oauth-flow.ts`): connect, refresh, disconnect. Owns the
  guarantee that revoked consent clears a token and never application data.
- Token storage port (`src/services/tokenStore.ts`), keyed per workspace origin
  so one lawyer can serve two firms.
- Published CIMD document at `public/.well-known/oauth-client.json`, with a test
  that re-states Malafat's own validation rules against the shipped artifact.
- Rust loopback callback listener (`src-tauri/src/sync/oauth_callback.rs`) plus
  `bind_oauth_callback` / `await_oauth_callback` / `cancel_oauth_callback`.
  Binds 127.0.0.1 only, serves exactly one redirect, releases its port on every
  exit path.
- `tauri-plugin-opener`, scoped to `https://*.malafat.app/*`, to open the
  authorize page in the system browser rather than the webview.

### Fixed
- Declared `tempfile` as a `[dev-dependency]`. The Rust test target had never
  compiled, so 14 pre-existing tests had never run. They pass (see TD-016).

### Technical
- 79 new assertions; `cargo test --lib` 24 passed, `vitest` 2024 passed.
- Verified empirically that Vite ships `public/.well-known/` into `dist-web`.
- Findings: `.claude/designs/mut-28-oauth-client-findings.md`. Three Malafat-side
  policy gaps (MCP gate, missing money scopes, one-grant-per-user vs a
  multi-device desktop app) are recorded on MAL-870 and MUT-28.
- New decision: ADR-023. ADR-005 and ADR-013 remain Active and unoverridden —
  that is MUT-30's job and gates any cloud sync shipping.

---

## [Unreleased] - 2026-10-05

### Fixed
- **Overdue computed five different ways, all off by a day in some timezone** (MUT-17)
  - `/income`'s Overdue tab badge counted items due today as overdue while the
    repository's `overdue` filter excluded them: the badge said 1 and the list
    it opened showed 0. Three screens gave three answers for the same row.
  - Root cause: three duplicate helpers derived "today" as
    `new Date().toISOString().split('T')[0]` — the **UTC** date. In
    Asia/Jerusalem 00:00–03:00 local that is yesterday (overdue items
    under-reported); in America/New_York after ~20:00 it is tomorrow (items due
    today reported overdue).
  - `getDaysUntil` parsed its argument as UTC midnight and compared against
    local midnight, so it was one day off for every timezone west of UTC. Its
    tests passed only because the dev machine is UTC+3; they failed 3/3 under
    `TZ=America/New_York`.
  - **New records got the wrong default date**: `IncomeDrawer`,
    `ExpenseDrawer`, `RetainerDrawer` and `RecurringRuleDrawer` seed from
    `todayISO()`, so a Jerusalem user adding income at 01:00 got it dated
    yesterday.
  - `getAttentionReceivables` derived its 7-day bound via `toISOString()` on a
    local-shifted `Date`, so the window was a day off west of UTC.
  - `ClientDetailPage`'s transactions tab classified overdue as
    `daysUntilDue < 0` without checking the row was unpaid income, so a paid
    invoice or an expense with a past due date rendered as overdue.
  - Files: added `src/lib/dates.ts` + `src/lib/__tests__/dates.test.ts`;
    changed `src/lib/utils.ts`, `src/lib/aggregations.ts`,
    `src/db/repository.ts`, `src/pages/income/IncomePage.tsx`,
    `src/pages/clients/ClientDetailPage.tsx`,
    `src/components/transactions/TransactionStatusCell.tsx`,
    `vitest.config.ts`, `package.json`.
  - Test status: 50 new tests in `dates.test.ts`, green from UTC-10 to UTC+14.
    Full suite Asia/Jerusalem 22 → 21 failures, America/New_York 29 → 25. All
    remaining failures pre-existing and separately ticketed (MUT-19, MUT-20,
    and 4 out-of-scope UTC sites).

### Added
- **`src/lib/dates.ts`**: canonical date-only logic — `todayLocalISO`,
  `daysBetweenLocal`, `daysUntilDue`, `isOverdueReceivable`, `daysOverdue`,
  `isDueSoon`, `isValidDateOnly`. Pure predicates taking `today` explicitly;
  `Date.UTC`-based day ordinals so arithmetic is exact across DST. See ADR-022.
- **Timezone-pinned tests**: `vitest.config.ts` sets `TZ` (default
  `Asia/Jerusalem`) so date tests are deterministic; `npm run test:tz` runs the
  suite under `America/New_York`. Previously results depended on the
  developer's machine and 7 timezone bugs were invisible.
- **Boundary tests** on `IncomePage`: due today is not overdue, due yesterday
  is. Suite clock pinned to 2026-03-14, the instant its fixtures were always
  written against (closes most of MUT-21).

### Technical
- Removed the private `formatLocalDate` duplicate from `src/lib/utils.ts` and
  the private `todayISO` copy from `src/db/repository.ts`.
- `getDaysUntil` is now a one-line delegate, kept for display-only call sites
  (Insights/Reports CSV columns, `ProjectDetailPage`, `TransactionsPage`).
- Zero inline overdue expressions remain in `repository.ts` or
  `aggregations.ts`.

---

## [Unreleased] - 2026-03-14

### Changed
- **ProjectDrawer Profile Selector**: Profile selector now displays when at least one profile exists (changed from requiring 2+ profiles)
  - Updated condition from `profiles.length > 1` to `profiles.length > 0` in `src/components/drawers/ProjectDrawer.tsx:167`
  - Makes profile association explicit and visible even for single-profile users
  - Aligns with UX principle of making profile relationships transparent
  - Added 5 comprehensive tests for profile selector behavior in `ProjectDrawer.test.tsx`:
    - Shows selector when one profile exists
    - Shows selector when multiple profiles exist
    - Allows selecting a profile
    - Pre-populates with active profile
    - Hides selector when no profiles exist
  - Files changed: `ProjectDrawer.tsx`, `ProjectDrawer.test.tsx`
  - Test status: 13 passing (2 skipped)

### Added
- **Partial Payments UI Integration**: Fully integrated partial payment functionality into income tables across the application
  - Added `PaymentStatusBadge` component to display payment status with percentage for partial payments
  - Exported `PaymentStatusBadge` from `src/components/ui/index.ts`
  - Updated `transactionRepo.list()` to compute `paymentStatus` and `remainingAmountMinor` for all income transactions
  - Income tables now show:
    - Payment status badge (Paid, Partial X%, Unpaid)
    - Received amount display for partial payments
    - "Record Payment" action in row menu for unpaid income
    - Visual indication of payment progress
  - Updated pages:
    - `/income` (IncomePage.tsx) - main income ledger
    - `/projects/:id` (ProjectDetailPage.tsx) - project transactions tab
    - `/clients/:id` (ClientDetailPage.tsx) - receivables tab and transactions tab
  - Added comprehensive tests in `IncomePage.test.tsx`:
    - PaymentStatusBadge rendering
    - Partial payment display
    - Record payment action availability
    - Payment status calculations
  - All translations (en, ar) already in place for partial payment UI
  - Removed completed TODO item

### Fixed
- **Timezone Bug in Recurring Expense Calculations**: Fixed `shouldRuleOccurInMonth` in `forecastCalculations.ts` to use consistent year/month numeric comparison instead of Date object comparison, which was causing incorrect results in UTC+ timezones
- **untilDate End Mode**: Fixed end date logic to properly exclude months where the occurrence day would fall after the end date

### Added
- **Recurring Source Badge**: Expenses generated from recurring rules now display a "Recurring" badge next to the title
  - Added `.recurring-badge` CSS styling in `index.css`
  - Added translation keys `expenses.fromRecurring` and `expenses.recurringBadge`
- **Profile Mode Indicator**: Expenses page now shows explicit "All Profiles" vs "Current Profile" toggle
  - Added `.expenses-mode-indicator` and `.expenses-mode-button` styles
  - Added translation keys for profile mode UI
  - Now shows all available profiles as buttons for quick switching
- **Profile-Specific Tools Card**: Shows explanatory message when in All Profiles mode about features that require a specific profile
- **Delete Action**: Added delete action to expense row actions menu with confirmation dialog
  - Special confirmation message for expenses from recurring rules
- **Keyboard Shortcuts**: Added keyboard shortcuts to expenses page
  - `N` - Open new expense drawer
  - `/` - Focus search input
  - `Esc` - Close drawer (already handled by Drawer component)
- **Profile-Aware Routing**: Clicking a profile button now navigates to `/expenses/profile/$profileId`
  - Deep-linkable profile URLs
  - URL reflects current profile context

### Changed
- **Duplicate Button**: Now properly prefills expense data (amount, currency, vendor, category, title) when duplicating
- **Multi-Currency Group Totals**: `ExpenseGroupedView` now shows separate totals per currency instead of summing all currencies
- **SearchInput Component**: Now uses `forwardRef` and exposes `focus()` method via ref

### Fixed
- **GAP 1**: Delete action now available in row actions menu
- **GAP 2**: Duplicate button now prefills expense data correctly
- **GAP 3**: Page mode is now explicit with visible toggle
- **GAP 4**: Profile selection now navigates to profile-specific URL
- **GAP 6**: Multi-currency group totals now show separate amounts per currency
- **GAP 10**: Recurring source badge now identifies expenses generated from rules

### Technical
- Changed `GroupedExpenses` interface from `totalMinor: number` to `totalsByCurrency: Record<string, number>`
- Added `.expense-title-cell` wrapper for title cell content
- Added `SearchInputRef` type export from filters
- Added `useNavigate` hook for profile-based routing

---

## [Previous] - 2026-03-13

### Added
- **Income Query Hooks (`useIncomeQueries.ts`)**: New dedicated hooks for income-specific queries
  - `useIncome(filters)`: Fetch income transactions with optional filters (pre-filters by kind='income')
  - `useIncomeById(id)`: Fetch a single income transaction
  - `useReceivables(filters)`: Fetch unpaid income (receivables) with optional overdue filter
  - `useIncomeTotals()`: Fetch income totals for overview displays
  - `useAttentionReceivables()`: Fetch receivables needing attention
  - `useCreateIncome()`, `useUpdateIncome()`: Create/update income transactions
  - `useMarkIncomePaid()`: Mark income as paid (replaces deprecated `useMarkTransactionPaid`)
  - `useRecordIncomePartialPayment()`: Record partial payments
  - `useDeleteIncome()`, `useArchiveIncome()`, `useUnarchiveIncome()`: Lifecycle mutations

### Changed
- **IncomePage**: Migrated from `useTransactions` to `useIncome` and `useMarkIncomePaid`
- **ClientDetailPage**: Migrated receivables tab from `useTransactions` to `useReceivables`, mark paid to `useMarkIncomePaid`
- **ProjectDetailPage**: Migrated mark paid from `useMarkTransactionPaid` to `useMarkIncomePaid`
- **TransactionsPage**: Migrated mark paid from `useMarkTransactionPaid` to `useMarkIncomePaid` (keeps `useTransactions` for mixed view)
- **RetainerMatchingDrawer**: Migrated from `useTransactions` to `useIncome` for paid income lookup

### Technical
- **Deprecated `useTransactions`**: Added deprecation notice; kept for legacy mixed views until next release
- **Deprecated `useMarkTransactionPaid`**: Added deprecation notice; use `useMarkIncomePaid` instead
- Proper query key separation for income queries vs generic transaction queries
- Income hooks automatically invalidate both income-specific and legacy transaction caches for backwards compatibility

---

- **Insights Reintegration (Phase 1 & 2)**:
  - **Phase 1: Data Contracts & Aggregation Functions**
    - New forecast types: `ForecastKPIs`, `AmountByCurrency`, `ForecastOptions`, `MonthActuals`, `AttentionItem` in `src/types/index.ts`
    - Pure aggregation functions in `src/lib/aggregations.ts`:
      - Date utilities: `getTodayISO`, `getMonthRange`, `getDaysInMonth`, `daysBetween`, `isDateInRange`
      - Amount utilities: `zeroAmounts`, `addAmount`, `subtractAmount`
      - Transaction grouping: `getTransactionEffectiveDate`, `groupTransactionsByDay`, `groupTransactionsByMonth`
      - Forecast calculations: `calculateForecastKPIs`, `calculateMonthActuals`, `calculateRunningBalance`
      - Attention helpers: `findOverdueUnpaidIncome`, `findUnpaidIncomeDueSoon`, `findUnpaidIncomeMissingDueDate`
    - 60 unit tests for aggregation functions in `src/lib/__tests__/aggregations.test.ts`
    - Terminology update per ADR-010: "receivables" → "unpaid income", "projections" → "projected retainer"
  - **Phase 2: Home Page Components**
    - `PredictiveKpiStrip` component: 3 forecast KPI cards (Will I Make It?, Cash on Hand, Coming/Leaving)
    - `AttentionFeed` component: Severity-sorted attention items with max 5 items, collapsible
    - `MonthActualsRow` component: Collapsible summary of received/unpaid/expenses/net
    - `InfoIcon` in icons
    - Updated `OverviewPage` to use new components (current-month only, no date range selector)
    - i18n translations for all new components (English and Arabic)
    - CSS styles for all new components
  - **Phase 3: Insights Page Enhancement**
    - Added Cash Flow Timeline link to Insights Summary tab
    - Links to `/money-answers` page for dedicated timeline view with its own date picker
    - i18n translations for timeline link and hint text (English and Arabic)
    - Removed inline period toggle and inclusion toggles to avoid conflicts with Insights date range
  - **Phase 4: Polish, Responsiveness, Testing, Documentation**
    - **Responsive Design**:
      - Added mobile breakpoint (480px) for attention-feed, actuals-row, kpi-card-forecast
      - Stack layouts and reduced padding on small screens
      - Hidden currency tabs on mobile in actuals-row (uses localStorage default)
    - **Accessibility Improvements**:
      - AttentionFeed: semantic `<ul>`/`<li>` with role="list"/role="listitem"
      - Added aria-label on attention list container
      - Added aria-hidden="true" on decorative icons
      - Added aria-label on action buttons for screen readers
      - Added aria-expanded on expand/collapse toggle buttons
    - **Component Documentation**:
      - Updated COMPONENT_REGISTRY.md with new Home components section
      - Documented PredictiveKpiStrip, AttentionFeed, MonthActualsRow, QuickSummaries, InfoIcon
      - Added props tables, usage examples, and accessibility notes
      - Updated Component Ownership table
    - **Integration Tests**:
      - 47 new tests for Home components in `src/components/home/__tests__/`
      - AttentionFeed.test.tsx: rendering, accessibility, severity styling, actions, currency display
      - PredictiveKpiStrip.test.tsx: currency tabs, help tooltips, value display, Coming/Leaving card
      - MonthActualsRow.test.tsx: expand/collapse, localStorage persistence, currency tabs, color coding

### Fixed
- **Desktop app update mechanism**:
  - Fixed `deploy.sh` signature extraction - was including full CLI output instead of just the base64 signature in `latest.json`, breaking Tauri's auto-updater
  - Added version change detection (`handleVersionChange()` in `src/lib/platform.ts`) - clears update-related localStorage caches when app version changes, ensuring users who install a new DMG see the correct version (macOS preserves app data across installs)

### Added
- **Migration Safety Layer** (`src/db/migration-safety.ts`):
  - Automatic pre-migration backups to prevent data loss during schema updates
  - Post-migration validation to detect missing fields (profileId, receivedAmountMinor)
  - Auto-fix capability for common migration issues
  - Backup storage in separate IndexedDB database (`mutaba3a_backup`)
  - Recovery functions: `restoreFromBackup()`, `importBackupFromFile()`
  - Validation functions: `validateMigration()`, `autoFixMigrationIssues()`
  - Export functions: `downloadBackup()`, `exportCompleteBackup()`
  - Migration event logging for audit trail
  - Keeps last 3 backups automatically, cleans up older ones
  - Tests: 16 tests in `src/db/__tests__/migration-safety.test.ts`
  - Integrated into `initDatabase()` - runs automatically on app startup
  - `repairDatabase()` function for manual recovery

- **AmountWithConversion component**: New UI component that displays single-currency amounts with hover tooltip showing ILS-converted value using live FX rates from Frankfurter API
  - Used in transaction tables where each row has a single currency
  - Shows original currency with hover tooltip displaying approximate ILS conversion and FX rate source (Live/Cached)
  - Graceful degradation: shows plain amount if FX rate unavailable

### Changed
- **Multi-currency display reintegration**: Updated all transaction-related pages to use unified currency display components
  - **TransactionsPage**: Uses `AmountWithConversion` for individual transaction amounts with hover conversion
  - **OverviewPage**: Uses `AmountWithConversion` in recent activity and needs attention sections
  - **ClientDetailPage**: Uses `AmountWithConversion` in transaction tables and recent activity
  - **ProjectDetailPage**: Uses `AmountWithConversion` in transaction tables
  - **IncomePage**: Uses `CurrencySummaryPopup` for summary totals, `AmountWithConversion` for rows
  - **ExpensesLedgerPage**: Uses `CurrencySummaryPopup` for summary totals, `AmountWithConversion` for rows
- ILS is now the default display currency with hover tooltips showing conversion breakdown

### Changed
- **IncomeDrawer Refactor (TransactionDrawer → IncomeDrawer)**:
  - Renamed `TransactionDrawer` to `IncomeDrawer` for clarity
  - Replaced type selector (Income/Receivable/Expense) with status selector (Earned/Invoiced/Received)
  - New status model maps: Earned → unpaid, Invoiced → unpaid, Received → paid
  - Added contextual profile handling:
    - Single profile users: profile hidden
    - Multi-profile users: profile shown as compact chip
    - "All Profiles" mode: shows profile quick picker
  - Added `ProfileContextChip` component for drawer profile display
  - Added `ProfileQuickPicker` component for fast profile selection
  - Added `useProfileAwareAction` hook for profile-checking before actions
  - Updated `useDrawerStore` with `incomeDrawer` state (legacy `transactionDrawer` aliased)
  - Updated SidebarNav to use profile-aware actions
  - Added i18n keys for income drawer status labels (en/ar)
  - Migrated tests from TransactionDrawer.test.tsx to IncomeDrawer.test.tsx

### Added
- **Partial Payments Support**:
  - Added `receivedAmountMinor` field to Transaction for tracking partial payments
  - Added `PaymentStatus` type ('unpaid' | 'partial' | 'paid')
  - Database schema v14 with migration for existing transactions
  - `transactionRepo.recordPartialPayment()` method to record incremental payments
  - Updated `transactionRepo.getDisplay()` to compute `paymentStatus` and `remainingAmountMinor`
  - `PaymentStatusBadge` component (`src/components/ui/PaymentStatusBadge.tsx`)
  - `PartialPaymentDrawer` component with quick-fill buttons (25%, 50%, 100%)
  - `useRecordPartialPayment` mutation hook
  - i18n keys for partial payment UI in en.json and ar.json

- **URL-Persisted Sorting**:
  - `useSortState` hook (`src/hooks/useSortState.ts`) for URL-based sort state management
  - ClientsPage and ProjectsPage now persist sort field/direction in URL params
  - Sort state survives page refresh and navigation

- **First-Run Onboarding**:
  - `useOnboardingStore` (`src/lib/onboardingStore.ts`) - Zustand store with localStorage persistence
  - `OnboardingOverlay` component with step-based guided setup
  - `OnboardingStepIndicator` component for visual progress
  - 3-step flow: Add Client → Create Project → Record Income
  - Auto-advances when drawers complete entity creation
  - Skip option persists in localStorage
  - i18n keys for onboarding UI in en.json and ar.json

- **Multi-Profile with "All Profiles" Lens**:
  - Added `profileId` field to `Client`, `Project`, `Transaction` types for profile isolation
  - Database schema v13 with migration to assign existing records to default profile
  - `ProfileStore` (`src/lib/profileStore.ts`) - Zustand store for active profile state
  - `useActiveProfile` hook (`src/hooks/useActiveProfile.ts`) - Business logic for profile context
  - `useProfileFilter` hook - Helper for query filtering
  - "All Profiles" option in ProfileSwitcher when 2+ profiles exist
  - `ProfileBadge` component (`src/components/ui/ProfileBadge.tsx`) - Visual indicator for profile
  - `ProfilePickerModal` (`src/components/modals/ProfilePickerModal.tsx`) - Profile selection for creation flows
  - Updated drawer stores to support `defaultProfileId` parameter
  - Updated pages (Overview, Clients, Projects, Expenses) to respect profile context
  - i18n keys: `profileSwitcher.allProfiles`, `profile.select`, `profile.selectPrompt`, `profile.badge.viewingAll` (en/ar)

- **UX Redesign Phase 4 - Insights Page** (`src/pages/insights/InsightsPage.tsx`):
  - New consolidated Insights page at `/insights` replacing Reports redirect
  - Preset tabs: Summary, Clients, Projects, Expenses, Unpaid
  - Summary tab: Paid income, unpaid receivables, expenses, net calculation
  - Clients tab: Client list with paid income and unpaid breakdown
  - Projects tab: Project list with received, unpaid, expenses, net columns
  - Expenses tab: Expenses by project breakdown
  - Unpaid tab: Aging buckets (current, 1-30d, 31-60d, 60+d overdue)
  - Date range filter (period control)
  - Currency mode selector (USD, ILS, Both)
  - CSV export for each preset tab
  - Tests: 21 tests in `src/pages/insights/__tests__/InsightsPage.test.tsx`
  - i18n: Added `insights.title` and `insights.tabs.*` keys (en/ar)
  - CSS: Added `.insights-tabs`, `.insights-tab`, `.insights-section` styles

### Fixed
- **i18n**: Added missing `transactions.columns.description` key (en: "Description", ar: "الوصف")

### Changed
- **Router**: `/insights` route now uses dedicated InsightsPage instead of redirecting to ReportsPage

### Deprecated
- **MoneyAnswersPage** (`src/pages/money-answers/`): Marked as deprecated with JSDoc comments. Route redirects to `/insights`. Code kept for reference.
- **ReportsPage** (`src/pages/reports/`): Marked as deprecated with JSDoc comments. Route redirects to `/insights`. Code kept for reference.

### Added
- **UX Redesign Specification**:
  - Created `docs/ux-redesign/UX-REDESIGN-SPEC.md` - Authoritative spec for question-first UX redesign
  - Created `docs/ux-redesign/IMPLEMENTATION-PLAN.md` - 4-phase implementation breakdown with ~100 actionable tasks
  - Product direction shift: entity-first CRM → question-first cash flow workspace
  - New navigation structure: Home, Income, Expenses, Insights | Clients, Projects | Settings
  - Deprecation plan for Documents, Retainers, Engagements, standalone Reports/Money Answers

### Added
- **UX Redesign Phase 2.3 - Expenses Page** (`src/pages/expenses/ExpensesLedgerPage.tsx`):
  - New question-first expenses ledger page at `/expenses`
  - View toggles: List (default), By Category, By Project
  - Expenses summary strip showing total expenses
  - Category grouping with subtotals
  - Project grouping with subtotals
  - Transaction-based filtering (kind='expense')
  - Connects to TransactionDrawer for edit with default kind='expense'
  - Empty state with "Add Expense" action
  - Tests: 15 tests in `src/pages/expenses/__tests__/ExpensesLedgerPage.test.tsx`
  - Profile-based expense system moved to `/expenses/profiles` route

- **EmptyState Component Enhancement** (`src/components/ui/EmptyState.tsx`):
  - Added `hint` prop as alias for `description`
  - Added `actionLabel` and `onAction` props as convenience alternatives to `action` object
  - Maintains backwards compatibility with existing `description` and `action` props

- **UX Redesign Phase 3.1 - Clients List Redesign** (`src/pages/clients/ClientsPage.tsx`):
  - Added "Received" column showing paid income totals per client
  - Added summary strip with total clients count, total received, total unpaid
  - CurrencySummaryPopup for multi-currency display (USD/ILS/EUR)
  - Tests: 16 tests in `src/pages/clients/__tests__/ClientsPage.test.tsx`
  - i18n: Added `clients.columns.received` and `clients.summary.*` keys

- **UX Redesign Phase 3.3 - Projects List Redesign** (`src/pages/projects/ProjectsPage.tsx`):
  - Added columns: Received, Expenses, Net
  - Net calculation: received - expenses per project
  - Visual indicator for negative net projects (color-coded cells)
  - Summary strip with totals: projects count, received, unpaid, expenses, net
  - Tests: 23 tests in `src/pages/projects/__tests__/ProjectsPage.test.tsx`
  - i18n: Added `projects.columns.received` and `projects.summary.*` keys
  - CSS: Added `.projects-summary-strip`, `.net-cell.positive/.negative` styles

### Changed
- **UX Redesign Phase 1 Complete** (Navigation + Routes + i18n + Add Menu + Titles):
  - **Sidebar restructured** with question-first navigation sections (Main, Workspace, System)
  - **New routes**: `/income`, `/expenses`, `/insights` created
  - **Legacy redirects added**:
    - `/transactions` → `/income`
    - `/reports` → `/insights`
    - `/money-answers` → `/insights`
  - **Navigation items removed** from sidebar: Documents, Retainers, Engagements, Money Answers
  - **Global Add Menu simplified**: Removed Document option from TopBar add menu (now only: Income, Expense, Project, Client)
  - **Page title updated**: Overview page title changed from "Overview" to "Home" (en: "Home", ar: "الرئيسية")
  - **i18n labels** updated in en.json and ar.json with new nav keys
  - Files changed:
    - `src/router.tsx` - Added redirects for legacy routes
    - `src/components/layout/SidebarNav.tsx` - Already restructured with new nav sections
    - `src/components/layout/TopBar.tsx` - Removed Document from add menu
    - `src/lib/i18n/translations/en.json` - Updated overview.title to "Home"
    - `src/lib/i18n/translations/ar.json` - Updated overview.title to "الرئيسية"

---

## [0.0.51] - 2026-03-13

### Fixed
- **Desktop App Update System**:
  - Re-enabled UpdateBanner component in AppShell
  - Fixed translation interpolation syntax (changed `{{var}}` to `{var}` to match i18n system)
  - UpdateBanner now properly shows when updates are available in Tauri desktop app
  - Users see update notifications with download progress and restart prompts

### Added
- **Update Banner Tests**:
  - `src/components/__tests__/UpdateBanner.test.tsx` (11 tests) - Full coverage for update banner states
  - `src/hooks/__tests__/useTauriUpdater.test.ts` (8 tests) - Hook behavior and API tests

### Technical
- Test count increased from 337 to 356 (19 new tests for update system)
- All 356 tests passing (5 skipped)
- Files changed:
  - `src/components/ui/UpdateBanner.tsx` - Uncommented and improved implementation
  - `src/components/layout/AppShell.tsx` - Re-enabled UpdateBanner import and usage
  - `src/lib/i18n/translations/en.json` - Fixed interpolation syntax in updateBanner keys
  - `src/lib/i18n/translations/ar.json` - Fixed interpolation syntax in updateBanner keys

---

## [0.0.50] - 2026-02-09

### Added
- **Reports Feature (TD-002 Resolved)**:
  - Full Reports page at `src/pages/reports/ReportsPage.tsx`
  - 5 report presets: Summary, By Project, By Client, Expenses by Project, Unpaid Aging
  - Date range filter (This Month, Last Month, This Year, All Time, Custom)
  - Currency mode selector (USD, ILS, Both)
  - CSV export for all report types
  - Route activated in `router.tsx`

- **Error Boundaries (TD-008 Resolved)**:
  - `ErrorBoundary` component for app-level error catching
  - `InlineErrorBoundary` for drawer-level errors
  - CSS styling for error fallback states

- **Database Schema v12**:
  - Added compound index `[baseCurrency+quoteCurrency]` on fxRates table (TD-012 resolved)

- **Test Coverage Expansion**:
  - `src/db/__tests__/expenseRepo.test.ts` (37 tests) - Expense, category, receipt, vendor, monthClose repos
  - `src/db/__tests__/retainerRepo.test.ts` (26 tests) - Retainer, projected income, schedule generator, matching
  - `src/components/__tests__/TransactionDrawer.test.tsx` (12 tests)
  - `src/components/__tests__/ClientDrawer.test.tsx` (10 tests)
  - `src/components/__tests__/ProjectDrawer.test.tsx` (10 tests)

- **E2E Testing Infrastructure (TD-004)**:
  - Playwright test framework configured (`playwright.config.ts`)
  - E2E test files created:
    - `e2e/navigation.spec.ts` - Page navigation tests
    - `e2e/transaction.spec.ts` - Transaction CRUD tests
    - `e2e/settings.spec.ts` - Settings page tests
  - npm scripts: `test:e2e`, `test:e2e:ui`

- **Accessibility Testing Infrastructure (TD-009)**:
  - axe-core/playwright installed for automated a11y testing
  - `e2e/accessibility.spec.ts` - Tests for WCAG compliance on all main pages

- **Pagination Infrastructure (TD-005)**:
  - `Pagination` component at `src/components/ui/Pagination.tsx`
  - `ChevronLeftIcon` and `ChevronRightIcon` icons
  - Pagination CSS styles with RTL support

- **SQLite Migration Preparation (TD-013)**:
  - Created `src/db/interfaces.ts` with TypeScript interfaces for all repositories
  - 19 repository interfaces defined for complete data layer abstraction
  - `IRepositoryProvider` factory interface for platform-based implementation selection
  - Exported interfaces from `src/db/index.ts`

### Fixed
- Fixed missing required fields in test data (BusinessProfile, Receipt)
- Fixed unused variable warning in retainerRepo.test.ts

### Technical
- Test count increased from 246 to 337 (91 new tests)
- All 337 tests passing (5 skipped)
- TD-002, TD-008, TD-012 resolved
- **Sync Feature Audit (TD-003 Updated)**:
  - Verified bundle export/import sync is fully working
  - All sync modals wired in AppShell (Export, Import, Pairing)
  - `initializeSync()` called on app load
  - SyncSection component displayed in Settings
  - Updated TD-003 status: bundle sync working, live LAN sync needs Tauri verification

---

## [0.0.49] - 2026-02-09

### Added
- **Comprehensive Test Coverage for Main Flows**:
  - `src/db/__tests__/transactionRepo.test.ts` (37 tests) - Full CRUD, filtering, totals, overdue/attention logic
  - `src/db/__tests__/clientRepo.test.ts` (22 tests) - CRUD operations and client summaries
  - `src/db/__tests__/projectRepo.test.ts` (24 tests) - CRUD operations and project summaries
  - `src/db/__tests__/settingsRepo.test.ts` (16 tests) - Settings, FX rates, categories
  - `src/db/__tests__/aggregations.test.ts` (27 tests) - Pure aggregation functions
- Extended `src/test/utils.tsx` with new factory functions:
  - `createMockTransaction`, `createMockProject`, `createMockCategory`, `createMockFxRate`
  - Helper functions: `createMockIncome`, `createMockExpense`, `createMockReceivable`, `createMockOverdueReceivable`
  - Date utilities: `getRelativeDate`, `getRelativeTimestamp`

### Changed
- Updated `TEST_PLAN.md` with current coverage status
- Updated `TECH_DEBT.md`:
  - TD-001 status changed to "In Progress" with updated coverage information
  - Added TD-012 for fxRateRepo.getLatest() missing compound index bug

### Technical
- Test coverage improved from ~3% to ~40%
- All 246 tests passing (2 skipped due to missing compound index)
- Repository layer now has ~85% test coverage
- Tests cover: transactions, clients, projects, documents, business profiles, settings, categories, aggregations

---

## [0.0.48] - 2026-02-09

### Added
- Created `.claude/SYSTEM_OVERVIEW.md` - comprehensive system documentation
- Created `.claude/DECISIONS.md` - architectural decision records
- Created `.claude/COMPONENT_REGISTRY.md` - reusable component catalog
- Created `.claude/PATTERNS.md` - code patterns and conventions
- Created `.claude/CHANGELOG.md` - this file
- Created `.claude/TECH_DEBT.md` - technical debt tracking
- Created `.claude/CI_CD.md` - CI/CD pipeline documentation
- Added h5, h6 heading styles to index.css for completeness

### Changed
- Updated `DECISIONS.md` ADR-018 with canonical token naming clarification
- Updated `PATTERNS.md` with Design Token Patterns section (token quick reference, button styling, focus styles, dark mode support)
- Updated `TECH_DEBT.md` with TD-011 for design system inconsistencies (now resolved)

### Fixed
- **Design System Unification (TD-011 - Resolved)**:
  - Phase 1: Added deprecation notices to legacy CSS variables in index.css
  - Phase 2: Removed dead `.landing-btn--*` classes from LandingPage.css, removed inline fallback values from 12 landing page CSS files
  - Phase 3: Migrated 39+ CSS files from legacy tokens to canonical tokens (`--font-size-*` → `--text-*`, `--font-weight-*` → `--weight-*`, `--shadow-sm/md/lg` → `--shadow-1/2/3`)
  - Phase 4: Standardized focus styles to use `box-shadow: var(--focus-ring)` instead of `outline` across 7 files; updated line-height to use `--leading-tight` (kept compact heading sizes for app UI)

### Technical
- Formalized project knowledge management system
- Design system now has single source of truth: `theme.css` for canonical tokens
- All focus-visible styles use `box-shadow: var(--focus-ring)` for consistency
- App headings use compact sizes (h1: 20px, h2: 18px, h3: 16px, h4: 14px) for data-dense cockpit UI
- Landing page headings use larger theme.css scale for marketing emphasis
- Fixed missed token migration in SplitWorkspace.css (`--shadow-lg` → `--shadow-3`)

---

## [0.0.47] - Previous

### Added
- Engagement letter feature (task/retainer types)
- PDF generation for engagement letters
- Profile-scoped engagements

### Changed
- Engagement schema to support profileId

---

## [0.0.46] - Previous

### Fixed
- Payment matching UI improvements
- Cache issues with service worker

---

## [0.0.44] - Previous

### Added
- Web release automation
- Service worker improvements

---

## [0.0.43] and Earlier

*Historical releases - see git log for details.*

---

## Migration Notes

### v0.0.48
- No database schema changes
- No breaking API changes

### v0.0.47
- Database schema v10: Added `profileId` to engagements table
- Migration: Existing engagements assigned to default profile

### v0.0.44
- Database schema v9: Added engagement tables

---

## Version History Summary

| Version | Date | Highlights |
|---------|------|------------|
| 0.0.48 | 2026-02-09 | System documentation |
| 0.0.47 | 2026-02 | Engagement letters |
| 0.0.46 | 2026-01 | Payment UI fixes |
| 0.0.44 | 2026-01 | Web release |
| 0.0.40 | 2025-12 | Retainer matching |
| 0.0.35 | 2025-11 | Document immutability |
| 0.0.30 | 2025-10 | Expense tracking |
| 0.0.25 | 2025-09 | Document generation |
| 0.0.20 | 2025-08 | Sync foundation |
| 0.0.15 | 2025-07 | Multi-profile support |
| 0.0.10 | 2025-06 | Desktop (Tauri) |
| 0.0.5 | 2025-05 | Core MVP |
| 0.0.1 | 2025-04 | Initial release |
