# COMPONENT_REGISTRY.md — Reusable Components

> **Purpose**: Document all reusable components to prevent duplication.
> **Rule**: Check this registry before creating any new component.

---

## Quick Lookup

| Category | Components |
|----------|------------|
| **Layout** | AppShell, SidebarNav, BrandMark, BrandLoader (page/section waits), BootSplash (landing Suspense fallback), TopBar, PageHeader, FeatureNoticeBanner, ClientsLayout (Clients split view), ClientWorkSection, ClientPaymentsSection, BREAKPOINTS + useIsSplitView |
| **Drawers** | TransactionDrawer, ClientDrawer, ProjectDrawer, ExpenseDrawer, LegacyExpenseEditDrawer, ConversionDrawer (currency conversion logging), RecurringMarkPaidDrawer, BusinessProfileDrawer, OrphanedRecordsDrawer, PartialPaymentDrawer (Record payment) |
| **Forms** | Input, Select, DatePicker, CurrencyInput, Textarea, Switch |
| **Buttons** | Button, IconButton, RowActionsMenu, RecordPaymentButton |
| **Table headers** | SortableHeader, RowActionsHeader |
| **Table cells** | TruncatedTitle (a row's title: one line, opens the record, full text on hover and focus), CompactDate (a compact table's dd/mm/yyyy in the tabular figure face), `EMPTY_CELL` (the dash), `toIncomeRow` / `incomeColumns` (`/income`'s rows and columns) |
| **Display** | Card, Badge, StatusBadge, EmptyState |
| **Home** | HomeNeedsAttention (rows: HomeAttentionRow), HomeRecentPayments (with OwedNowSummary), usePaymentUndo |
| **Expenses** | RecurringAttentionList (+ `recurringAttention` helpers), RecurringOccurrenceCard (read-only, forecast) |
| **Tables** | DataTable, CellAmount, CellStatus, CellDate |
| **Filters** | DateRangeControl, SearchInput, StatusSegment, useIncomeFilters (URL model for /income), useClientsSearch (URL model for the Clients list) |
| **Feedback** | Toast, Modal, RestoreBackupModal, DeleteAllDataModal, WhatsNewModal (+ WhatsNewController) |
| **Money** | OwedNowSummary, partitionOwedNow (helper), clients index muted rows, CurrencyAmounts, AmountWithConversion, CurrencySummaryPopup, FxRateReadout (top bar), CurrencyBadge |
| **Icons** | Custom SVG icons (see Icons section) |

---

## Layout Components

### AppShell
**Location**: `src/components/layout/AppShell.tsx`
**Purpose**: Root layout wrapper with sidebar, content area, and global overlays.

```tsx
<AppShell>
  <Outlet /> {/* Route content renders here */}
</AppShell>

// Structure:
// ├─ SidebarNav
// ├─ main (content area)
// │   └─ Outlet
// └─ GlobalOverlays
//     ├─ TransactionDrawerController
//     ├─ ClientDrawerController
//     └─ ProjectDrawerController
```

**Props**: None (uses context and routing)

---

### SidebarNav
**Location**: `src/components/layout/SidebarNav.tsx`
**Purpose**: Fixed left navigation with profile switcher.

```tsx
// Auto-rendered by AppShell
// Contains:
// - Profile/business switcher
// - Navigation links
// - Settings link (pinned bottom)
```

**Features**:
- Active state highlighting (prefix match, Home exact; one entry active per route, pinned by tests for every route)
- Keyboard navigation (links in DOM order; the New menu via `useMenuButton`)
- RTL support (logical rail and menu offsets; the collapse chevron points toward the collapsing edge)
- Collapsible to a 64px rail (choice kept in `localStorage.sidebarCollapsed`); toggles in normal flow; a hairline separates core from "More"
- **Shape (MUT-15, ADR-034):** `coreItems` (Home, Clients, Income) render first with no header and never depend on a flag; `optionalItems` render the "More" section with only the enabled areas, in the order Expenses, Conversions, Insights, Projects (Documents retired by MUT-145; Retainers and Planning by MUT-226); `systemItems` (Settings) sit in the footer, never gated.
- New menu: actions and order from `visibleAddMenuActions(flags)`; `newMenuEntries` maps each to its label and icon.
- **Footer (MUT-79):** Settings and `ThemeToggle` share `.sidebar-footer-row` (stacked on the 64px rail).

### BrandMark
**Location**: `src/components/brand/BrandMark.tsx`
**Purpose**: The Brand v2 mark (MUT-104, ADR-073): `mark.svg` on the light canvas, `mark-dark.svg` (butter dot) on the dark one, chosen from `useTheme().resolvedTheme`, so Light, Dark and System (live OS changes included) all follow ThemeToggle. Decorative (`alt=""`): the link or heading around it carries the name. Props: `size` (px), `className`. Used by `SidebarNav`'s brand link and the shared `Wordmark` (`src/components/brand/Wordmark.tsx`), which the portal and the landing header use.

Tests: `src/components/brand/__tests__/BrandMark.test.tsx`, `SidebarNav.brand.test.tsx`, `src/hosted/components/__tests__/Brand.test.tsx`.

### Wordmark
**Location**: `src/components/brand/Wordmark.tsx`
**Purpose**: The Brand v2 lockup: `BrandMark` beside the product name. It was moved from the portal for MUT-77. Props:
- `name` (ReactNode: each surface passes its own copy key, or spans for a responsive name);
- `markSize` (default 30, never under 30: it also sizes the logotype, H = 0.40 M; set as `--wordmark-mark` in px, the only source of M, MUT-402);
- `className` and `markClassName` (added to `wordmark` / `wordmark-mark`).

Used by the portal's `Wordmark` (`src/hosted/components/Brand.tsx`: `BrandName` for the active language, `markSize` default 40, the sidebar passes 32) and the landing header (32). `SidebarNav` keeps its own inline lockup, because it collapses to the mark.

Tests: `src/components/brand/__tests__/Wordmark.test.tsx`, `src/hosted/components/__tests__/Brand.test.tsx`.

### Logotype / BrandName
**Location**: `src/components/brand/Logotype.tsx`, `Logotype.css` (MUT-402, ADR-173)
**Purpose**: The product's name as a language writes it. `Logotype` is the MUT-401 MTB3A logotype: a `<span role="img" aria-label="MTB3A" lang="en">` masked in `currentColor` (forced colours: the system colour its live text gets), sized by H from the surrounding `Wordmark`. `BrandName({ language, className })` renders `Logotype` in English and live متابعة (`lang="ar"`, `.brand-name-ar`) in Arabic. Put it in a `Wordmark`'s `name`; the bilingual lockup adds a `<span className="wordmark-separator" aria-hidden="true" />` between two of them. Never hand-write "MTB3A" or "متابعة" as a brand lockup.

Tests: `src/components/brand/__tests__/Logotype.test.tsx` (component and stylesheet contracts), `src/pages/landing/__tests__/LandingHeader.test.tsx`; QA `web.brand.mtb3a-name`, `portal.shell.mtb3a-name`.

### BrandLoader
**Location**: `src/components/brand/BrandLoader.tsx` (+ `BrandLoader.css`, path data in `bloomLoaderData.ts`)
**Purpose**: The bloom loader (MUT-206, ADR-079): the mark folds into four drops and blooms back over a 4.5 s loop. Inline SMIL, fills from the `--mark-*` tokens (so it follows ThemeToggle), no `style` attribute (portal CSP). The one loader for every page, section and drawer wait in the app and the portal; inline button spinners (`Button`, `.hp-inline-spinner`) and skeletons stay.

```tsx
<div className="loading">
  <BrandLoader size={64} slowCaption={t('common.loadingSlow')} />   {/* full page */}
</div>
<div className="loading loading--section">
  <BrandLoader size={40} />                                          {/* section or drawer body */}
</div>
<BrandLoader size={96} delay={0} label={t('hosted.auth.checking')} />
```

Props: `size` (24 | 40 | 64 | 96), `label` (default `common.loaderLabel`), `delay` (default `LOADER_DELAY_MS` = 400; `0` shows at once, no fade), `slowCaption` (shown and announced from `LOADER_SLOW_MS` = 3000, full-page waits only), `className`. Behaviour: a `role="status"` span from mount, empty during the delay around a same-size blank SVG; then a fresh SVG (keyed) and the label as `.sr-only` text, or as a visible caption under reduced motion (no `<animate>` children, the still mark). A loader mounting within `LOADER_CHAIN_MS` (100) of a shown one unmounting shows at once. Exports `LOADER_DELAY_MS`, `LOADER_SLOW_MS`, `LOADER_CHAIN_MS`, `__resetLoaderChainForTests()` (tests only). Import by direct path in the portal (no barrel).

Tests: `src/components/brand/__tests__/BrandLoader.test.tsx`, `bloomLoaderData.test.ts` (parity with `docs/brand/loader/*.json`), `src/styles/__tests__/brand.test.ts` (fills, fade token, `.loading` boxes).

### BootSplash
**Location**: `src/components/brand/BootSplash.tsx` (+ `bootDelay.ts`; styles in `src/styles/brand/boot-splash.css`, linked from the heads)
**Purpose**: The boot splash in React (MUT-207, ADR-080), the Suspense fallback for the landing, download, privacy and /hosted pages. Its first render is the static splash in `index.html`/`hosted.html` element for element (a hidden `.boot-splash` > `<picture>` with the dark mark for a dark OS > 80 px `img.boot-splash-mark`), so the HTML → React hand-off changes nothing; after `bootDelayMs()` it becomes `BrandLoader size={96} delay={0}` in place (frame 0 is the same mark), with no fade or slow caption. No props. Renders inside `LandingProviders` (the loader's label needs a language).

`bootDelayMs(now = performance.now())`: `max(0, LOADER_DELAY_MS - now)`, the still-mark time counted from page start; the portal's `CheckingSession` uses it too. `CheckingSession({ label? })` (portal, `src/hosted/pages/auth/BootScreens.tsx`): `label` replaces "Checking your session" for another boot-time check, e.g. `/setup`'s "Checking your link" (MUT-236).

**Keep in step**: change `BootSplash`, and the two heads' splash markup, together; `brand-head.test.ts` compares them.

Tests: `scripts/__tests__/brand-head.test.ts` (markup, CSP, BootSplash ≡ HTML, canvas hexes), `src/components/brand/__tests__/BootSplash.test.tsx`, `src/hosted/pages/auth/__tests__/BootScreens.test.tsx`.

### ThemeToggle
**Location**: `src/components/layout/ThemeToggle.tsx`
**Purpose**: The appearance switch beside Settings (MUT-79, A1). Each press moves to `nextThemeMode(theme)`, cycling through `THEME_MODES` (Light → Dark → System), the same list and the same `useTheme()` state as Settings → Theme. Its icon is per mode (sun, moon, monitor), and it is named `nav.theme` ("Theme: Dark").

Tests: `src/components/layout/__tests__/ThemeToggle.test.tsx`, `src/lib/theme/__tests__/themeModes.test.ts`, `SidebarNav.features.test.tsx` (placement).

---

### TopBar
**Location**: `src/components/layout/TopBar.tsx`
**Purpose**: Sticky header with title, breadcrumbs, and primary CTA.

```tsx
<TopBar
  title="Transactions"
  breadcrumbs={[{ label: 'Home', href: '/' }]}
  actions={<Button onClick={openDrawer}>+ Add</Button>}
/>
```

**Props**:
| Prop | Type | Description |
|------|------|-------------|
| `title` | string | Page title |
| `breadcrumbs?` | BreadcrumbItem[] | Navigation trail |
| `actions?` | ReactNode | Right-side action buttons |

The `+ Add` menu renders `visibleAddMenuActions(useFeatureFlags())` (Income, Client, then Expense/Project while on; MUT-15) with `useMenuButton` keyboard behaviour; `addMenuEntries` maps each action to its label and icon, and `useAddMenuActions()` (MUT-57) supplies the click behaviour -- the same hook `SidebarNav`'s New menu calls. The right side starts with `FxRateReadout` on every page (MUT-79), whether or not the Add menu is shown.

### FxRateReadout
**Location**: `src/components/layout/FxRateReadout.tsx` (+ `.css`)
**Purpose**: The top bar's exchange rate (MUT-79, A1), replacing the floating `FxRateBanner`. `$1 = ₪3.06 ▾` (USD→ILS, 2 decimals, locale digits) opens a `useMenuButton({ kind: 'dialog' })` panel labelled "Exchange rate". The panel shows USD and EUR to 4 decimals, each source (Live / Cached / Unavailable), "Rates for <date>" (the date is parsed as local), "Updated: <relative>", and Refresh rates (both refetch; disabled while loading). The formulas are `<bdi dir="ltr" class="fx-formula">`; see TD-048 for why the class is needed. A layout effect applies `nudgeInside` to keep the panel inside `<main>`, which clips it on a narrow window.

Tests: `src/components/layout/__tests__/FxRateReadout.test.tsx`, `popoverPosition.test.ts`.

### nudgeInside
**Location**: `src/components/layout/popoverPosition.ts`
**Purpose**: Pure: how far to shift a panel sideways (px) so it sits inside its bounds with a margin. A panel wider than the bounds is pinned to the left edge. Reuse it for any top-bar popover that `<main>`'s `overflow: hidden` could clip.

---

### addMenuActions
**Location**: `src/components/layout/addMenuActions.ts`
**Purpose**: The single list of `+ Add` actions, their area gates and their order, shared by the sidebar New menu and the top bar Add menu (MUT-15).

```ts
visibleAddMenuActions(flags); // ['income', 'client'] with every area off
```

Core actions first, optional appended, so a switch never moves a core entry. Each menu maps an `AddMenuAction` to its own label and icon only; click behaviour comes from `useAddMenuActions` below. Tests: `layout/__tests__/addMenuActions.test.ts` (all 64 flag combinations keep Income, Client first).

### useAddMenuActions
**Location**: `src/hooks/useAddMenuActions.ts`
**Purpose**: The one set of create handlers behind both `+ Add` menus (MUT-57, TD-032 resolved). Both menus open the drawer **in place** -- neither navigates -- and all four actions are profile-aware.

```ts
const { actions, run, pickers } = useAddMenuActions();
// actions: AddMenuAction[] from visibleAddMenuActions
// run(action, event, returnFocus): triggers that action's useProfileAwareAction
// pickers.income / .expense / .client / .project: each one's pickerProps for ProfileQuickPicker
```

Income and Expense call `setWorkingProfile(profileId)` before opening their drawer (unchanged from pre-MUT-57 sidebar behaviour, now shared); Client and Project don't (neither menu did before). Tests: `hooks/__tests__/useAddMenuActions.test.tsx`.

---

### usePrefersReducedMotion
**Location**: `src/hooks/usePrefersReducedMotion.ts`
**Purpose**: `true` when the OS asks for reduced motion, kept in step via `useSyncExternalStore` over `matchMedia('(prefers-reduced-motion: reduce)')`; `false` where `matchMedia` doesn't exist. Use it in JS-driven motion (springs, count-ups) to skip or cross-fade; CSS should use the media query directly.

```ts
const reduced = usePrefersReducedMotion();
```

Tests: `src/hooks/__tests__/usePrefersReducedMotion.test.ts`.

### useInView
**Location**: `src/hooks/useInView.ts`
**Purpose**: Whether a ref's element is in the viewport, from an IntersectionObserver. Never use scroll listeners for this (MUT-77, L10: nothing scroll-linked).
- `null` means not known yet: before the first report, or for good when there is no IntersectionObserver. The caller picks the safe reading.
- Options: `once` (stop after the first sighting and stay true), `rootMargin`, `threshold`.
- The observer disconnects on unmount.

```ts
const shown = useInView(ref, { once: true, threshold: 0.15 });
```

Tests: `src/hooks/__tests__/useInView.test.ts`. For tests, use `installFakeIntersectionObserver()` / `FakeIntersectionObserver.reportFor(el, bool)` from `src/test/intersectionObserver.ts`.

### useDocumentTitle
**Location**: `src/hooks/useDocumentTitle.ts`
**Purpose**: Keeps `document.title` in step with a translated string, so the tab follows the language (MUT-77: `/`, `/privacy`, `/download`). `index.html`'s `متابعة` stays as the no-JS default.
Tests: `src/hooks/__tests__/useDocumentTitle.test.ts`.

### useHeroCta
**Location**: `src/pages/landing/useHeroCta.ts`
**Purpose**: The landing page's one device-matched button (L4): `{ href, Icon, label, hint, shortLabel, alternative }`. Each `shortLabel` must be part of its `label`, because the bar's button uses the label as its accessible name (WCAG 2.5.3, tested). It is shared by `HeroSection` and `LandingHeader`, so both always go to the same place. Both read the release through `useLatestRelease`, which shares one GitHub call.
Tests: `LandingHeader.test.tsx`, `HeroSection.test.tsx`.

### detectDevice / currentDevice
**Location**: `src/lib/platform.ts`
**Purpose**: Pure `detectDevice({ userAgent, platform, maxTouchPoints })` → `'mac' | 'windows' | 'ios' | 'android' | 'linux' | 'unknown'`, telling an iPad from a Mac and Android from Linux; `currentDevice()` reads `navigator`. Used by the landing hero and `DownloadPage` (`MacDownloadBanner` used it until TD-143 deleted it; MUT-79 which removed the substring checks `isMacOS`/`isWindows`/`isLinux`, TD-049). Cannot tell Intel from Apple Silicon.

### UpdateBanner (frame bar)
**Location**: `src/components/ui/UpdateBanner.tsx`
**Purpose**: The app's bottom bar, rendered after the page inside `<main>`. It is in flow (`margin-top: auto`), not fixed, so it never covers content (MUT-79). Desktop only (`role="status"`). Settings' own update card is `.settings-update-card`, not `.update-banner`. The Mac download bar that sat beside it was deleted with the retired desktop (TD-143, 2026-10-15); a stale `localStorage.hideDownloadBanner` is harmless.

Tests: `src/components/__tests__/UpdateBanner.test.tsx`.

### THEME_MODES / nextThemeMode
**Location**: `src/lib/theme/modes.ts` (exported from `lib/theme`)
**Purpose**: The one ordered list of appearance modes (`light`, `dark`, `system`), rendered by Settings and cycled by `ThemeToggle` (MUT-79).

### removeRetiredStorageKeys
**Location**: `src/lib/retiredStorage.ts`, called once in `main.tsx`
**Purpose**: Deletes localStorage keys whose feature is gone (`mutaba3a_fx_banner_state`, MUT-79). Add a key here when you delete a feature that stored one.

### useMenuButton
**Location**: `src/hooks/useMenuButton.ts`
**Purpose**: A button that opens a menu of actions with WAI-ARIA menu-button keyboard behaviour (MUT-15).

```tsx
const menu = useMenuButton();
<button {...menu.buttonProps} type="button">Add</button>
{menu.isOpen && (
  <div {...menu.menuProps}>
    <button role="menuitem" tabIndex={-1} onClick={() => { menu.close(); run(); }}>Income</button>
  </div>
)}
```

Opening (click, ArrowDown, ArrowUp) focuses the first/last `[role="menuitem"]`; arrows wrap; Home/End jump; Escape closes and refocuses the button; Tab and a mousedown outside close. Used by `SidebarNav` and `TopBar`. `RowActionsMenu` still has its own listeners (TD-031). Tests: `hooks/__tests__/useMenuButton.test.tsx`.

**Dialog mode (MUT-79):** `useMenuButton({ kind: 'dialog' })` is for a small non-modal panel of information and controls (`FxRateReadout`). It gives `aria-haspopup="dialog"`, a panel `role="dialog"` with `tabIndex=-1` (the consumer adds `aria-labelledby`), and on open focuses the first enabled control, or the panel itself. There is no arrow movement. Tab closes only when it leaves past the last control (Shift+Tab: past the first). Escape and an outside press work as for a menu. Used by `FxRateReadout`.

---

### PageHeader
**Location**: `src/components/layout/PageHeader.tsx`
**Purpose**: Standardized page header with title and optional actions.

```tsx
<PageHeader
  title={t('transactions.title')}
  subtitle="Manage your income and expenses"
  action={<Button>+ Add</Button>}
/>
```

---

### FeatureNoticeBanner
**Location**: `src/components/layout/FeatureNoticeBanner.tsx`
**Purpose**: One-time, dismissible notice naming the optional areas that were switched on for the user's existing data (v20 upgrade, restore, import, demo; sync-bundle import was deleted with device sync, MUT-73). Mounted once in `AppShell` above the page content; renders nothing when `Settings.featureNotice` is empty; clears the notice on dismiss (MUT-12, ADR-032).

```tsx
<FeatureNoticeBanner />   // no props; reads useFeatureNotice()
```

Tests: `src/components/layout/__tests__/FeatureNoticeBanner.test.tsx`.

---

### AdvancedFeaturesSection
**Location**: `src/pages/settings/AdvancedFeaturesSection.tsx`
**Purpose**: Settings › Advanced features — one `Switch` per `FEATURE_KEYS` entry, labels and descriptions from `settings.features.items.*`. Reads `useFeatureFlags()`, writes `useSetFeatureEnabled()`; never touches the settings row. A small grid-of-squares icon sits beside the title (MUT-139 visual pass) — it signals "this reshapes your nav," not a warning colour, since the toggle isn't destructive.

```tsx
<AdvancedFeaturesSection />   // rendered by SettingsPage between General and AboutSection (titled "Features" since MUT-88)
```

Tests: `src/pages/settings/__tests__/AdvancedFeaturesSection.test.tsx`.

---

### AboutSection
**Location**: `src/pages/settings/AboutSection.tsx`
**Purpose**: Settings › About — merges the former About/Updates/Desktop App sections under one heading (MUT-139: these three had no standalone test, so merging was low-risk; `SettingsPage.a11y.test.tsx` requires zero h3 subheadings, so the merged content is flat `.settings-row` entries, not nested subsections). Owns `useCheckForUpdates()`, app version display (shown once, in the update-status row — not duplicated in the About blurb), support links, a "What's new" row that reopens the running version's notes when `release-notes.json` has any (MUT-24), and the mac/Windows download links. Uses `.settings-section-quiet` (MUT-139 visual pass): no card chrome, smaller title — the least load-bearing content on the page gets the least visual weight.

```tsx
<AboutSection />   // rendered by SettingsPage between AdvancedFeaturesSection and YourDataSection
```

Tests: `src/pages/settings/__tests__/AboutSection.test.tsx`.

---

### YourDataSection
**Location**: `src/pages/settings/YourDataSection.tsx`
**Purpose**: Settings › Your data (MUT-88, ADR-072), the one home for every data action, in this order:
- **Back up**: `useBackUp` → `backUpNow` (`src/utils/backupDownload.ts`); the row shows "Last backed up: <date>" from `settings.lastBackupAt`.
- **Restore**: one picker; `classifyDataFile` routes a full backup to `RestoreBackupModal`, and a business export or CSV to `/settings/import` via `setPendingImport`.
- **Export a business**: `ExportDataModal`.
- **Export receipts**: ZIP.
- **Check data**: `getRepositories().base.dataset.integrityCheck()` (MUT-47 seam); the result is kept as numbers and worded at render, so it follows a language switch.

It replaced `DataToolsSection` and the inline Data block (two exports, two restores). Delete all data is *not* here: `SettingsPage` renders it alone below every card (`.settings-danger-zone`). Reaches storage only through `getRepositories()`, per the MUT-47 seam — never a direct `db/*` import.

```tsx
<YourDataSection />   // last card on SettingsPage, before the Delete zone
```

Tests: `src/pages/settings/__tests__/YourDataSection.test.tsx` (every DataToolsSection case, ported).

---

### RestoreBackupModal
**Location**: `src/components/modals/RestoreBackupModal.tsx`
**Purpose**: Asks before a full backup replaces everything on the device (MUT-88). Names the backup by date (`formatDate` + `getLocale`) and record count (`useTp('settings.restore.records')`, all six Arabic forms). Replace calls `getRepositories().base.dataset.restoreBackup(backupJson)` (MUT-47 seam). A failure shows inline (`role="alert"`, `settings.data.importFailed`) and the dialog stays open. The caller owns the toast and the reload (`onRestored`). Reuses the `DeleteAllDataModal.css` shell.

```tsx
<RestoreBackupModal backupJson={text} summary={kind} onClose={…} onRestored={(r) => { toast; reload(); }} />
```

Tests: `src/components/modals/__tests__/RestoreBackupModal.test.tsx`.

---

### WhatsNewModal / WhatsNewController
**Location**: `src/components/modals/WhatsNewModal.tsx` (+ `.css`); state in `src/lib/whatsNew/` (MUT-24, ADR-151)
**Purpose**: "What's new". `WhatsNewController` (mounted in AppShell) opens it once per start when `pendingNotes(RELEASE_NOTES, APP_VERSION)` is non-empty, and waits while there is no business yet or the sample is being set up. `WhatsNewModal` renders the store's entries newest first: a "Version <bdi dir=ltr>x.y.z</bdi>" heading and the lines in the active language. Got it, Escape or the backdrop call `markWhatsNewSeen(current)`. It uses the `DeleteAllDataModal.css` shell.
- **To reopen it:** call `useWhatsNewStore().openWhatsNew([latestNotesUpTo(RELEASE_NOTES, APP_VERSION)])`, as Settings › About does.
- **`src/lib/whatsNew` exports:**
  - `compareVersions` (the one semver compare; `useCheckForUpdates` uses it), `notesSince`, `latestNotesUpTo`, `releaseNotesProblems`;
  - `seedSeenVersion`, `pendingNotes`, `markWhatsNewSeen`, `WHATS_NEW_SEEN_KEY`;
  - `useWhatsNewStore` and `RELEASE_NOTES`.

```tsx
<WhatsNewController />   // AppShell, next to WelcomeModal
<WhatsNewModal />
```

Tests: `src/components/modals/__tests__/WhatsNewModal.test.tsx`, `src/lib/whatsNew/__tests__/*`.

---

### composeDictionary / parityProblems (i18n)
**Location**: `src/lib/i18n/translations/compose.ts`; `src/test/i18nParity.ts` (tests only)
**Purpose**: `composeDictionary(PARTS)` joins a language's per-feature JSON files into one typed dictionary and throws when two files define one namespace (MUT-24). `parityProblems(en, ar)` lists every shape, `{var}`, empty-string and plural-form difference between two dictionaries. The app (`translations.test.ts`) and the portal (`hosted/i18n/__tests__/parity.test.ts`) both use it. Arabic `…Singular` strings may drop `{count}`.

Tests: `src/lib/i18n/__tests__/translations.test.ts`.

---

### APP_VERSION
**Location**: `src/lib/appVersion.ts`
**Purpose**: The running version (`__APP_VERSION__`, or "0.0.0" where no build defined it). Use it instead of declaring the global again. Its build-time source is `appVersion(process.env.MUTABA3A_APP_VERSION)` in `vite.config.ts`.

---

### dataFiles (classify + hand-off)
**Location**: `src/lib/dataFiles.ts`
**Purpose**: `classifyDataFile(name, text)` → `fullBackup {timestamp, version, records}` | `businessExport` | `csv` | `unknown`. `isFullBackup` and `hasLegacyRows` are shared with `ImportDataPage`. `setPendingImport(file)` / `takePendingImport()` is a one-slot, read-once hand-off from Restore to `/settings/import`.

Tests: `src/lib/__tests__/dataFiles.test.ts`.

---

### profileDefault (one default business)
**Location**: `src/db/profileDefault.ts`
**Purpose**: `pickDefaultProfileId(profiles, preferId?)` and `enforceSingleDefaultProfile(table, preferId?)` (MUT-88, ADR-072). Every profile writer calls `enforce` inside its own transaction. Use it in any new path that writes `businessProfiles`.

Tests: `src/db/__tests__/profileDefault.test.ts`, `migration-v22.test.ts`, `src/demo/__tests__/seedDefault.test.ts`.

---

### ClientWorkSection
**Location**: `src/components/clients/ClientWorkSection.tsx`
**Purpose**: "What have I worked on for this client?" on the client profile (MUT-3): the client's income entries as one table — date, title with project tag, amount, status with due/overdue line, remaining balance on partial rows — with its own filter row (date range, status, search held as one object) and the row actions (Record payment via `RecordPaymentButton`, Mark paid, Duplicate). No work at all → `EmptyState` with one action, Add income, prefilled with the client; filters that hide every row → "No entries match" + Clear filters. Rows are shaped by `toWorkRow` (`clientProfileRows.ts`) in a `useMemo`.

```tsx
<ClientWorkSection clientId={clientId} />
```

Tests: `src/pages/clients/__tests__/ClientDetailPage.test.tsx` ("Work and billing"), `src/components/clients/__tests__/clientProfileRows.test.ts`.

---

### ClientPaymentsSection
**Location**: `src/components/clients/ClientPaymentsSection.tsx`
**Purpose**: "When did they pay, and for what?" on the client profile (MUT-3, the MUT-4 UI): `usePaymentsByClient(clientId)` unfiltered, newest first — date, amount, the entry it paid for, notes. A `record` row opens `editPaymentRecord` (the payment drawer's edit mode, which also deletes); an `entry` row (money saved on the income entry itself, ADR-033) opens the income drawer and reads "Recorded on the entry". Never totals across currencies.

```tsx
<ClientPaymentsSection clientId={clientId} />
```

Tests: `src/pages/clients/__tests__/ClientDetailPage.test.tsx` ("Payments").

---

### ClientsLayout (Clients split view, MUT-84)
**Location**: `src/pages/clients/ClientsLayout.tsx` (+ `.css`, classes prefixed `clients-split-`); rules in `src/components/clients/clientsSplitView.ts`
**Purpose**: The `/clients` layout route (ADR-050). It renders the one top bar, then always the same two panes: the list (`ClientsPage`) and the profile (`<Outlet />`, `ClientDetailPage`). `data-layout` is set by `splitLayout(hasClient, useIsSplitView())`:
- `list`: no client open;
- `split`: a client open on a wide window; the list is a 360 px column at the start edge;
- `profile`: a client open on a narrow window; the list is hidden but stays mounted.

Only attributes change, so a resize never remounts the profile and a client switch never remounts the list. The profile pane is a focusable region named "Client profile". Escape, or the arrow toward the list (by visual direction), returns focus to the open client's row; the list pane handles ↑/↓ and Enter. A polite status line says "Showing {name}" when the open client changes after load.

**`ClientsPage` props** (the list pane): `openClientId` marks the row (`client-index-row-open`, `aria-current="page"` on its link); `onWalk(id)` (wide windows only) is called by ↑/↓ and by ↓ in the search box; `onEnterProfile()` (split only) is called by Enter on the open row or the arrow toward the profile. With no props it is the plain list.

**`clientsSplitView.ts`**: `splitLayout`, `listKeyAction` / `profileKeyAction` (arrows by visual direction), `adjacentClientId` / `firstClientId` (clients only, muted rows skipped), `keyBelongsToControl` (fields, open menus and pickers keep their keys), `hasModifier`, `clientRowLink(container, id)`, and `clientProfileRemountDeps` (the detail route's `remountDeps`).

**Extend, don't copy**: another list/detail pair that should open side by side reuses the same shape: a layout route, a `BREAKPOINTS` token, one tree with a data attribute, and these key helpers. Move the helpers to a shared place only when a second consumer exists.
**Tests** (written, not yet run; TD-067): `src/pages/clients/__tests__/ClientsLayout.test.tsx` (real memory router), `src/components/clients/__tests__/clientsSplitView.test.ts`, `src/pages/clients/__tests__/ClientsPage.test.tsx`.

---

### BREAKPOINTS / useIsSplitView
**Location**: `src/lib/breakpoints.ts`, `src/hooks/useMediaQuery.ts`
**Purpose**: Named window widths that code and styles both depend on (MUT-84). CSS media queries can't read custom properties, so the number lives in JS. `useIsSplitView()` reads `BREAKPOINTS.clientsSplit` (1280) through `useMediaQuery(minWidthQuery(…))`, and the page sets a data attribute for its stylesheet. Add a width here rather than writing it into a media query and a hook separately. (`useIsCompactTable`'s 768 predates this and is not yet a token.)
**Tests**: `src/hooks/__tests__/useMediaQuery.test.ts`.

---

### SampleDataBar
**Location**: `src/components/ui/SampleDataBar.tsx`
**Purpose**: The visitor sample's one line (MUT-78, ADR-042): "You're looking at sample data. · Start with your own ›", shown while `useSampleSessionStore().status === 'active'`. Leaves through `useLeaveSample()`; asks first (with a CLDR plural count) only when `countSessionAdditions()` finds rows the visitor added. Rendered at the top of `<main>` in `AppShell`, in flow, so it can never cover a drawer.

Tests: `src/components/ui/__tests__/SampleDataBar.test.tsx`.

---

### OnboardingOverlay
**Location**: `src/components/onboarding/OnboardingOverlay.tsx`
**Purpose**: First-run guided flow over `onboardingStore` (client → project → income). While the Projects area is off (MUT-16) an effect completes the project step with no entity, so the flow is client → income; the store's order and completion rule are unchanged. The effect waits for `useFeaturesLoaded()` so a loading settings row is not read as "off". The drawers advance the step by calling `completeStep` on the store directly.

```tsx
<OnboardingOverlay onComplete={() => setShowOnboarding(false)} />
```

Tests: `src/components/onboarding/__tests__/OnboardingOverlay.projects.test.tsx`.

---

## Landing Components (web build only)

### ChapterSection
**Location**: `src/pages/landing/components/ChapterSection.tsx`
**Purpose**: One landing chapter — a big line, a short paragraph and one visual, with `flip` to put the visual first. Renders `<section data-part aria-labelledby>`; the page-structure test reads `data-part`. Since MUT-173 an optional `extra` renders under the paragraph, inside the copy column (the phone chapter's platform lines).

```tsx
<ChapterSection part="chapter-clients" title={t('…title')} body={t('…body')} visual={<ClientProfileMock />} />
<ChapterSection part="phone" … visual={<HostedDevicesMock />} flip extra={<PhoneExtra />} />
```

### PhoneSection
**Location**: `src/pages/landing/components/PhoneSection.tsx`
**Purpose**: The chapter after Get it (`data-part="phone"`, MUT-173): "Log it on your phone. See it all in your hosted account.", `HostedDevicesMock` as the picture, and under the paragraph a hint with one underlined link to `/hosted` plus a `<ul aria-label="Phone apps">` with one line per platform read from `MOBILE_APP_LINKS` (never hardcoded) through `storeLinkUrl` (download-config.ts: available **and** a real `https:` URL, else null): a store link (`.landing-phone-store`, a 44 px pill, new tab, `noopener noreferrer`); `available` with no `url` → the name beside "with your hosted account" as plain text; not `available` → "{platform} coming soon". Only a real store link looks like a control (D9). Names and the coming-soon phrase are `landing.hostedOffer.platform.*`, so `/` and `/hosted` agree; the rest is `landing.phone.*`. Unlike `/hosted` (9A), the landing may link a store: the sentence above has said the app needs a hosted account.
Tests: `LandingPage.test.tsx` › phone and portal; `@web.landing.phone`.

### MalafatSection
**Location**: `src/pages/landing/components/MalafatSection.tsx`
**Purpose**: The band after the phone chapter (`data-part="malafat"`, MUT-174): for law firms and accounting offices on Malafat, in the privacy band's look (`.landing-privacy-band/-title/-body` reused inline, as `/hosted`'s band does; a third user, so a shared `Band` component is the cleanup if a fourth appears). One `.landing-band-link` to `malafatUrl({ locale: language, medium: 'landing', content: 'landing-section' })`, new tab. Copy never claims anything automatic, a sync, reports or MUT-25's spike (tested). Read the locale from `useLanguage().language`, never `getLocale()` (that returns `en-US`).
Tests: `LandingPage.test.tsx` › Malafat; `@web.landing.malafat`.

### malafatUrl (`src/content/malafatLinks.ts`)
**Purpose**: The one builder for every link from Mutaba3a to Malafat: `MalafatMedium`/`MalafatContent` are MUT-189's CTA contract plus the landing's `landing`/`landing-section`; `contact: true` gives `/<locale>/contact?topic=mutaba3a&…` for the in-app moments (MUT-190/191), otherwise `/<locale>?…`. Query order fixed. Any surface that renders it needs `https://malafat.app` in `scripts/bundle-origins.json` for its build (`local` since MUT-174).
Tests: `src/content/__tests__/malafatLinks.test.ts`.

### Landing mock-ups (`ClientProfileMock`, `RecordPaymentMock`, `ProfileSwitcherMock`, `HostedDevicesMock`)
**Location**: `src/pages/landing/components/mocks/`
**Purpose**: Static HTML pictures of the product for the landing page. Data comes from `src/pages/landing/sampleData.ts` (fixed dates, i18n-keyed names, never the visitor's database); labels are the app's own i18n keys; money and dates format through `useMockFormat` (`formatAmount` / `formatDateShort` in the active locale). Keep them in step with the real screens when those change. `HostedDevicesMock` is shared by `/hosted`'s hero and the phone chapter on `/` (MUT-173): its base `.hosted-devices*` rules sit at the **end of `LandingPage.css`** (a width on the root, frames at `(0,2,0)`, so they out-rank `.landing-mock` wherever they are); `/hosted`'s phone-only rule at ≤640 px stays in `HostedOfferPage.css`, while the landing chapter stacks laptop, phone and caption.

### ClientsListMock + CountUpAmount (hero)
**Location**: `src/pages/landing/components/mocks/ClientsListMock.tsx`, `CountUpAmount.tsx`
**Purpose**: The hero's picture of the Clients list (brief L5/L6). Totals come from `sampleOwedTotals(SAMPLE_CLIENTS)` so they always equal the rows. `CountUpAmount` counts an amount up once via `useCountUp` (skipped under reduced motion), lays the final value out invisibly so the width never changes, and gives screen readers the final value only.

### heroCta (`chooseHeroCta`, `secondaryHeroLink`)
**Location**: `src/pages/landing/heroCta.ts`
**Purpose**: Pure rule for the hero's one filled button: mac → Mac download, windows → Windows download only when the release has it, anything else → web app; the text link is the browser for a download and the desktop apps for the web app.

### GetItSection / PrivacyBand / PlatformIcons
**Location**: `src/pages/landing/components/`
**Purpose**: `GetItSection` lists every way to get the app and gates each download on `useLatestRelease()` (ADR-041); since MUT-172 it ends with the paid half (`data-part="get-it-paid"`: hosted account + phone app come with a paid plan, one `.landing-get-it-paid-cta` link to `/hosted`, no heading, no box); `PrivacyBand` says privacy once; `PlatformIcons` holds the Apple/Windows/browser glyphs shared by the hero and Get it, and since MUT-173 `IosIcon` (an outlined phone) and `AndroidIcon` (the robot head, with Google's CC BY 3.0 attribution in its docblock) for the phone chapter. Download URLs live in `src/content/download-config.ts` (`DOWNLOAD_URLS`, `WEB_APP_URL`, and since MUT-186 `HOSTED_OFFER_URL` and `MOBILE_APP_LINKS`), shared with `DownloadPage` and `/hosted`.

### PrivacyPolicyPage
**Location**: `src/pages/landing/PrivacyPolicyPage.tsx` + `PrivacyPolicyPage.css`
**Purpose**: The full privacy policy at `/privacy`, covering the local-only Mac, Windows and browser apps and the account-based iPhone/Android apps (hosted API on Google Cloud), each described separately. Reuses `LandingHeader`/`LandingFooter` and `LandingPage.css`'s container/section tokens; copy is `landing.privacyPolicy.*` in `en.json`/`ar.json`. Routed client-side only (`src/main.tsx`, same pattern as `/download`) — no server/router change.

Tests: `src/pages/landing/__tests__/`.

### HostedOfferPage (`/hosted`)
**Location**: `src/pages/landing/HostedOfferPage.tsx` + `HostedOfferPage.css`
**Purpose**: The case for a hosted account and the request form (MUT-186). Landing chrome only, mounted in `src/main.tsx` at `HOSTED_OFFER_URL`. Sections (`data-part`): `hero` (copy + `HostedDevicesMock`), `compare` (a real `<table>`, Hosted column tinted, rows stacked on phones), `band` (reuses `.landing-privacy-band`), `request` (`HostedRequestForm`). Adds `.landing-section-headline--start` for start-aligned section headings. Never links an app store (9A).

### HostedRequestForm
**Location**: `src/pages/landing/components/HostedRequestForm.tsx`
**Purpose**: The hosted-account request form: `idle → sending → success | error`, posting through `submitHostedRequest`. Uses `Input`/`Select`/`Textarea`; device choices are 44px pill labels around native checkboxes; the honeypot sits in an `aria-hidden` box. On success it shows the visitor's own name and email (FSI-isolated) with "edit and send again". Props: `titleId` (the heading that names the form).

### hostedRequest.ts (Netlify Forms contract)
**Location**: `src/pages/landing/hostedRequest.ts`
**Purpose**: The one definition of the request form for both the page and the build: `HOSTED_REQUEST_FORM_NAME`, `HOSTED_REQUEST_FIELDS`, `HONEYPOT_FIELD`, `NETLIFY_FORMS_PATH`, `SUBMIT_TIMEOUT_MS`, `PROFESSIONS`, `DEVICES`, plus pure `validateHostedRequest`, `encodeHostedRequest` and `submitHostedRequest(values, fetchImpl?)` (never throws; `'ok' | 'error'`). No React or DOM imports: `vite.config.ts` loads it to emit `__forms.html`.

### marketingPath
**Location**: `src/pages/landing/marketingPath.ts`
**Purpose**: `marketingPath(pathname)` drops one trailing slash (not from `/`). `src/main.tsx` matches the marketing pages against it, so `/hosted/` opens `/hosted`.

### LandingProviders
**Location**: `src/pages/landing/LandingProviders.tsx`
**Purpose**: The one wrapper `src/main.tsx` gives the web build's marketing routes (`/`, `/download`, `/privacy`, `/hosted`): `ThemeProvider` + `LanguageProvider`, nothing of the app's (no React Query, router or database). Tests render those pages through it, so a component that needs app context fails in Vitest as it does in production. Since MUT-202 it opens them in Arabic (`LANDING_DEFAULT_LANGUAGE`, which since MUT-209 is the shared `DEFAULT_LANGUAGE` from `lib/i18n/core` that the app and the portal use too, passed as `LanguageProvider`'s `defaultLanguage`) unless a person chose a language (marked by `mutaba3a-language-chosen`); the default is never stored, and a language the app stored by detection doesn't count (ADR-077). Tests that need English call `chooseLanguage('en')` (`src/test/language.ts`) first.

```tsx
render(<LandingProviders><DownloadPage /></LandingProviders>);
```

### DownloadPage
**Location**: `src/pages/download/DownloadPage.tsx` + `DownloadPage.css`
**Purpose**: `/download` (web build only): one card per desktop platform, the visitor's first, each gated on `useLatestRelease()`. Wears the landing chrome like `PrivacyPolicyPage` (`LandingHeader homeHref="/"` with no device button, `LandingFooter`, `.landing-page`/`.landing-container`), never the app's `TopBar`, which needs React Query and the router.

Tests: `src/pages/download/__tests__/`, `qa/specs/web/landing.spec.ts` `@web.landing.download`.

---

## Drawer Components

### Base Drawer Pattern
Every drawer renders `Drawer` (`src/components/drawers/Drawer.tsx`; the portal's is `src/hosted/components/Drawer.tsx`, which takes `closeLabel`) and is mounted by its owner while its store says open. It is a `role="dialog"` `aria-modal`, named by its title through `aria-labelledby` (a `useId()` id, so two open drawers never collide), and its close button is `common.close` (TD-009). Tests: `drawers/__tests__/Drawer.test.tsx`, `hosted/components/__tests__/Drawer.test.tsx`.

```tsx
interface DrawerProps {
  title: string;          // names the dialog (aria-labelledby)
  onClose: () => void;    // Escape, ✕ and the overlay call it at once
  children: ReactNode;
  footer?: ReactNode;
}

// AppShell
{incomeDrawer.isOpen && <IncomeDrawer />}
// IncomeDrawer
<Drawer title={t('transactions.newIncome')} onClose={closeIncomeDrawer} footer={…}>…</Drawer>
```

Unmount it whenever you like: the exit animation plays after it has gone (ADR-044).

### DrawerFrame (MUT-80, ADR-044)
**Location**: `src/components/ui/drawer/` — `DrawerFrame.tsx` (shell), `useDrawerMotion.ts` (enter, drag, release, interrupt, exit), `useDrawerFocus.ts` (trap and return), `drawerGesture.ts` (pure rules: `classifyDrag`, `closingDelta`, `displayOffset`, `releaseTarget`, `overlayOpacity`, `exitDistance`, `isNoDragTarget`), `drawerMotion.ts` (`DRAWER_SPRING`, `paintDrawer`, `springTo`, `fadeTo`, `playSnapshotExit`), `exitSnapshot.ts` (`captureExitSnapshot`).
**Purpose**: the one slide-over shell for both builds. Both `Drawer`s wrap it; the local one passes `t('common.close')`, the portal its own label.
**Behaviour**: springs in from its edge (response 0.3, damping 1.0). It follows a horizontal drag 1:1, rubber-banding past open. A release past half the width, after projecting momentum, dismisses. A press catches any live motion where it is. Every other close leaves as an inert snapshot along the same edge. In RTL the edge is mirrored. Reduced motion gives 150ms cross-fades.
**Opt-out**: put `data-drawer-no-drag` on a region that needs horizontal pointer gestures of its own. Form fields, editable content and horizontally scrolling regions are already excluded.
**Snapshots carry no ids** (MUT-82): `exitSnapshot` strips every `id` from the clone, so a drawer opened while another is still playing out never resolves an id (the payment drawer's `form=` button, a label) to the clone.
**Width** (MUT-357): `--drawer-width` (480px), capped at the viewport (`max-width: 100%` on `.drawer`), so on a phone it fills the screen in either direction. Motion measures the rendered `offsetWidth`, never the variable.
**Tests**: `src/components/ui/drawer/__tests__/` (`DrawerFrame`, `drawerGesture`, `exitSnapshot`); `qa/specs/web/drawer-motion.spec.ts`; `src/styles/__tests__/drawerFit.test.ts` and `@portal.direction.drawer-phone-*` (width).

### Motion physics and focusables (MUT-80)
- `src/lib/motion/physics.ts`: `springFromResponse(response, dampingRatio)`, `projectMomentum(velocity, rate = 0.998)`, `rubberband` / `rubberbandInverse`, `velocityFromSamples(samples, windowMs = 100)`. Reuse these for anything draggable or flickable.
- `src/lib/motion/presets.ts` (MUT-82): `UI_SPRING` (response 0.3, damping 1) and `REDUCED_MOTION_FADE_SECONDS` (0.15), shared by drawers (`drawerMotion.ts` re-exports them as `DRAWER_SPRING` and `REDUCED_MOTION_FADE_SECONDS`) and list rows.
- `src/lib/motion/rowExit.ts` (MUT-82): `captureRowExit(row, container)` → `{ play({ reducedMotion }) }`, or `null` without layout. Call it from a layout-effect cleanup while the row is still in the document, then `play` after the commit. An inert, hidden copy of the row (its ancestors copied shallowly so cells keep their styles, cells pinned to measured widths, ids stripped) is laid over the container and slides toward the inline end while fading; the rows after it glide up into the gap; reduced motion fades the copy and moves nothing. The container must be `position: relative` and should clip. Tests: `src/lib/motion/__tests__/rowExit.test.ts`.
- `src/lib/dom/focusable.ts`: `FOCUSABLE_SELECTOR`, `focusablesWithin(root)` (skips disabled, `tabindex="-1"`, `[hidden]`, and, where supported, invisible elements). Used by `useMenuButton`'s dialog mode and the drawer trap.

---

### TransactionDrawer
**Location**: `src/components/drawers/TransactionDrawer.tsx`
**Purpose**: Create/edit transactions (income/expense).

```tsx
// Via URL
navigate({ search: { tx: transactionId } });        // Edit
navigate({ search: { newTx: 'income' } });          // Create

// Via controller
<TransactionDrawerController />
```

**Features**:
- Form validation (Zod)
- Client/Project typeahead
- Currency selection
- Due date for unpaid income
- Linked document reference

> Registry drift: income is created and edited through **IncomeDrawer** (below), opened from `useDrawerStore().openIncomeDrawer`. This TransactionDrawer entry describes the legacy URL-driven design.

---

### IncomeDrawer
**Location**: `src/components/drawers/IncomeDrawer.tsx`. Mounted in `AppShell` while `incomeDrawer.isOpen`.
**Purpose**: create and edit income. The entry is the work record (MUT-5).

```tsx
openIncomeDrawer({ mode: 'create', defaultClientId, defaultProfileId, defaultStatus });
openIncomeDrawer({ mode: 'edit', transactionId });
openIncomeDrawer({ mode: 'create', duplicateFromId });
```

**Layout**:
- **Fast path:** title ("What did you do?", focused on create), amount (`.input-with-prefix`, text + decimal keypad, LTR in Arabic) and client (`ClientTypeahead`).
- **More details:** a `.form-disclosure` toggle whose summary line names the defaults. It holds the status switch, due date, currency (USD/ILS/EUR), date, project (only while Projects is on), notes and the profile. The profile moves up front when it can't be resolved.

**Rules**: they live in `src/lib/incomeEntry.ts` and are unit-tested.
- `buildIncomeCreate`, `buildIncomeUpdate` (ADR-039: payment fields are absent unless the status changes; never written for record-backed entries)
- `shouldExpandDetails`
- `isBelowRecordedTotal`
- `resolveDefaultCurrency` (profile → settings → USD)

**Validation**: Zod messages are i18n keys (`validation.amountRequired/amountInvalid/amountPositive/amountBelowRecorded/clientNotPicked/profileRequired/dateRequired`).

**Behaviour**:
- **Lock notice:** a locked entry (MUT-13) shows the notice, and Save is disabled.
- **Queued save:** a save asked for while a new client is still being created is held until the client exists.

**Tests**:
- `src/components/__tests__/IncomeDrawer.test.tsx`
- `src/components/drawers/__tests__/IncomeDrawer.locked.test.tsx`
- `qa/specs/web/income.spec.ts`

---

### PartialPaymentDrawer ("Record payment")
**Location**: `src/components/drawers/PartialPaymentDrawer.tsx` + `PartialPaymentDrawer.css`. It is mounted in `AppShell` while `partialPaymentDrawer.isOpen`.
**Purpose**: record a payment against an income entry, or edit a recorded one. It is the only UI that writes a `PaymentRecord` (ADR-038). Its layout follows P1 (MUT-86, ADR-047): it leads with what's left.

```tsx
openPartialPaymentDrawer({ transactionId });                    // create: remaining amount + today prefilled
openPartialPaymentDrawer({ transactionId, onRecorded });        // also hear the PaymentRecord a save created (MUT-82)
editPaymentRecord({ transactionId, paymentRecordId });          // edit one recorded payment
openPartialPaymentDrawer({ transactionId, intent: 'editPayment' }); // edit a payment: the only one, or pick (MUT-169)
// Row affordance: <RecordPaymentButton transaction={tx} onRecordPayment={() => openPartialPaymentDrawer({ transactionId: tx.id })} />
```

**Layout** (classes prefixed `pay-drawer-`; `index.css` already has global `.payment-row` and `.payment-amount`):
- **Title:** "Record Payment · {amount} left" (`titleLeft`, the amount in bidi isolates). In edit mode it is "Edit Payment".
- **Amount:** one large `.input-with-prefix` field, LTR in Arabic. Its label is visually hidden. It is prefilled with `minorToAmountInput` ("3550", "887.50") and selected on open.
- **Live line** (`aria-live="polite"`, describes the input): "Paid in full", "{amount} still owed", or the overpayment message. Other amount errors show only after Record is pressed.
- **Date:** a "Payment date · Today ›" row that opens the date field in its place. **Notes:** "+ Add note", which opens a focused field. Edit mode opens Notes when the record has one.
- **Footer:** Cancel plus Record Payment (create) or Update Payment (edit). With nothing left to record, the footer is Close and there is no form.
- **Payment history:** below the form, only when the entry has records. Each row has edit and delete.

**Rules** (pure, in `src/lib/paymentEntry.ts`, unit-tested):
- `describePaymentAmount(raw, currency, allowedMinor)`. Allowed is the remaining balance, plus the record's own amount when editing.
- `minorToAmountInput(minor)`
- Dates go through `isFuturePaymentDate` (`lib/dates.ts`), the same helper the repository uses.

**Behaviour**: Record closes the drawer. Update returns to the entry's create view. An edit waits for its record to load before showing the form.

**Edit intent** (MUT-169; opened by the /income row menu and the income drawer's "Edit Payment"): the drawer never offers to record a payment. With one record, it opens on that record's edit, with the date open and focused (`PaymentForm` `focusDate`). With several, the history alone is the picker. With none, it shows "No payments recorded yet". A failed records read shows `drawer.income.paymentsLoadFailed` with Try again. Update or Cancel closes the drawer (one record) or brings the list back (several), all through one `leaveEdit()`. The edit prefill and the history dates use the payment's local day (`paymentLocalDay`, `formatPaymentDate`).

**Props**: `transactionId`, `onClose`, and `onRecorded?: (record: PaymentRecord) => void` (MUT-82, ADR-055). `onRecorded` hears the record a save created, just before the drawer closes; an update or a delete is never reported. The store carries it in `partialPaymentDrawer.onRecorded` and `AppShell` passes it on. Editing a record of the same entry, and returning to the entry, keep it.

**Tests**:
- `src/components/drawers/__tests__/PartialPaymentDrawer.test.tsx`
- `src/lib/__tests__/paymentEntry.test.ts`
- `src/lib/i18n/__tests__/paymentDrawerKeys.test.ts`
- `qa/specs/web/record-payment.spec.ts`

---

### Typeaheads (`EntityTypeahead`, `ClientTypeahead`, `ProjectTypeahead`, `VendorTypeahead`)
**Location**: `src/components/ui/`. The hosted `ClientPicker`/`ProjectPicker` also wrap `EntityTypeahead`.

**Keyboard contract (MUT-5, tightened by the pre-landing review)**:
- **Typing** highlights the first option whose label starts with the text, else the create option, else the only option of a select-only list. A substring match is never highlighted, so a new "Ann" is never filed under "Joanna".
- **Enter:**
  - picks the highlighted option;
  - is held while an async `onSelect` is still saving (`aria-busy`), then submits the form once the pick is saved (unless the user typed in between); is held while typed text is unpicked (the list reopens on the auto highlight);
  - reaches the surrounding form when the field is empty or shows a picked/prefilled value.
- **Other keys:** ArrowDown on a closed list opens it. Tab closes the list without picking. Escape on an open list closes only the list (`stopPropagation`).
- **ARIA:** `aria-expanded` follows what is visible. `aria-controls` and `aria-activedescendant` point at the listbox and highlighted option.
- **Props:** `onSelect` may return a promise; resolving it to `false` marks the pick failed (the held Enter is dropped, the text is unpicked again). `autoHighlight(options, typed)` overrides which option typing highlights; the default is `defaultAutoHighlight` (`typeaheadHighlight.ts`). The optional `onBlur` is called before the list closes.
- **`ProjectTypeahead`:** a failed create empties the box and resolves `false` (no form guards unpicked project text, so a name left in the box would look picked). An empty box never shows a highlight.
- **`VendorTypeahead`:** highlights the vendor matched at 95%+ by name or alias (the one that suppresses "create") ahead of a prefix match; a failed create keeps the raw text as the vendor, as before.

**`ClientTypeahead` extras**:
- Leaving the box with a client's exact name (any case) picks that client.
- `onPendingTextChange(text)` reports text that isn't a picked client ('' when there is none). A client picked from "create" counts as picked at once.
- `onCreatingChange(creating)` brackets the creation of a new client.
- A failed create keeps the typed name in the box, unpicked, so a form refuses to save without it, even when a client was picked before; it resolves `false`.

**Tests**: `src/components/ui/__tests__/{EntityTypeahead,ClientTypeahead,ProjectTypeahead,VendorTypeahead}.test.tsx`.

---

### ClientDrawer
**Location**: `src/components/drawers/ClientDrawer.tsx`
**Purpose**: Create/edit clients.

```tsx
navigate({ search: { client: clientId } });         // Edit
navigate({ search: { newClient: true } });          // Create
```

---

### ProjectDrawer
**Location**: `src/components/drawers/ProjectDrawer.tsx`
**Purpose**: Create/edit projects.

```tsx
navigate({ search: { project: projectId } });       // Edit
navigate({ search: { newProject: true, clientId } }); // Create
```

---

### ExpenseDrawer
**Location**: `src/components/drawers/ExpenseDrawer.tsx`
**Purpose**: Create/edit expenses (profile-scoped).

**Features**:
- Vendor typeahead with normalization
- Category selection
- Receipt attachment
- Recurring rule linking

---

### ConversionDrawer (MUT-141)
**Location**: `src/components/drawers/ConversionDrawer.tsx`. Mounted in `AppShell` while `conversionDrawer.isOpen` (`src/lib/stores.ts`). Opened via `useDrawerStore().openConversionDrawer`.

**Purpose**: Log a currency-conversion event — money moved from one currency to another, excluded from P&L by construction (ADR-067). Writes `kind: 'conversion'` to `db.transactions`, with `currency`/`amountMinor` as the source leg and `toCurrency`/`toAmountMinor` as the destination leg.

```tsx
openConversionDrawer({ mode: 'create', defaultProfileId: profileId });
openConversionDrawer({ mode: 'edit', transactionId });
```

**Features**:
- Two independent amount/currency fields (`conversionFormSchema.ts`), each validated against its own currency's decimal precision (MUT-140's `parseAmountInput`/`CURRENCY_EXPONENT`), not a single shared pair — the one new form shape in the drawers directory.
- Same-currency conversion rejected (`fromCurrency !== toCurrency`).
- Read-only implied exchange rate, recalculated live from the two amounts, never persisted as a separate field.
- Always writes `status: 'paid'` — a conversion has no due/unpaid concept, so `TxStatus` was not widened for this feature.
- No category, client, or project field (out of this ticket's scope).

**Reuse**: data access goes through `useConversionQueries.ts` (below), not a new repository method — `transactionRepo.list`/`create`/`update`/`softDelete` were already generic enough.

**Tests**: `src/components/__tests__/ConversionDrawer.test.tsx`, `src/components/drawers/__tests__/conversionFormSchema.test.ts`.

---

### LegacyExpenseEditDrawer
**Location**: `src/components/drawers/LegacyExpenseEditDrawer.tsx`
**Purpose**: Edits a pre-existing `kind:'expense'` row in `db.transactions` (MUT-138, ADR-069) — not a real `db.expenses` record. Real expenses have lived in `db.expenses` since MUT-14; this covers demo seed data and anything imported before MUT-138's import-path fix. Deliberately separate from `ExpenseDrawer` (wrong table, wrong category namespace) and from `IncomeDrawer` (hardcodes `kind: 'income'` on save). Not a general-purpose component to reuse — the population it edits only shrinks, never grows.

**Features**:
- Amount/currency/date/title/notes via the shared `ExpenseFormFields` (relaxes `categoryId` to allow empty; currency widened to USD/ILS/EUR/JOD with the same amount/currency `superRefine` ExpenseDrawer's own schema uses)
- Client/project `<Select>` pickers (plain, not typeaheads — this is an edit-only surface for a capped population)
- Category picker against the legacy global `db.categories` (`kind: 'expense'`), via `useCategories('expense')`
- Delete (soft delete via `useDeleteTransaction`)

```tsx
useDrawerStore.getState().openLegacyExpenseDrawer({ transactionId: id });
{legacyExpenseDrawer.isOpen && <LegacyExpenseEditDrawer />}
```

Tests: `src/components/drawers/__tests__/LegacyExpenseEditDrawer.test.tsx`.

---

### RecurringMarkPaidDrawer
**Location**: `src/components/drawers/RecurringMarkPaidDrawer.tsx` (+ `.css`)
**Purpose**: The small drawer behind an Expenses Needs attention row (MUT-87, ADR-052). It lists one recurring rule's missed payments, oldest first, all checked, each with its month, its expected date and an amount field prefilled with the rule's amount (`input-with-prefix`, so it stays LTR in Arabic). **Mark N paid** writes one expense per checked payment, dated on its own expected date, in one all-or-nothing write (`useConfirmRecurringPayments`); an amount is sent only when edited. Each payment has its own **Skip** (asks first) and **Snooze**. Snoozing is the drawer's second view: a date (default a week out, must be after today) and quick picks named by `Intl.RelativeTimeFormat`. Opened with `initialView="snooze"` (the row's ⋯ › Snooze all) it snoozes every payment and Cancel closes; from a payment it snoozes that one and Back returns to the list, which keeps its checks and edited amounts. Uses the shared `Drawer` as is: one `<Drawer>` for both views, so switching views doesn't replay the open animation.

```tsx
// Page state: { ruleId, view } | null; the group is looked up live, so a skipped payment drops out
{drawerGroup && (
  <RecurringMarkPaidDrawer key={`${ruleId}:${view}`} group={drawerGroup} initialView={view} onClose={close} />
)}
```

Calls the batch hooks itself (`useConfirmRecurringPayments`, `useSkipRecurringOccurrences`, `useSnoozeRecurringOccurrences`). Closes itself when nothing would be left (all marked, the last skipped, all snoozed).
Tests: `src/components/drawers/__tests__/RecurringMarkPaidDrawer.test.tsx`.

---

### BusinessProfileDrawer
**Location**: `src/components/drawers/BusinessProfileDrawer.tsx`
**Purpose**: Create and edit business profiles. Since MUT-145 this is the only profile editor: Settings opens it in edit mode, and `ProfileDetailPage` is gone.

**Features** (ADR-067, IA review):
- Identity: logo upload (base64), name (Arabic, required), English name, colour
- Money: default currency for new income entries
- Contact (optional): email (validated when given), phone
- Make default toggle; labels wired to inputs (`useId`); `noValidate` so zod owns the messages

**Tests**: `src/components/__tests__/BusinessProfileDrawer.test.tsx`

---

### OrphanedRecordsDrawer
**Location**: `src/components/drawers/OrphanedRecordsDrawer.tsx`
**Purpose**: Lists every record without a business profile (the ones `OrphanedRecordsBanner` counts) grouped Clients / Projects / Income / Expenses, and assigns them. One profile: no pickers, one "Assign all to ‹profile›" action. Several: "Assign all to ‹default›" plus a picker per row and Save. Each row starts on its linked client's profile, then its project's, then the default (`startingProfileId`). A row that fails (TD-035) stays listed with an inline message. Replaced `OrphanedRecordsModal` (deleted 2026-10-11).

```tsx
// Opened from the banner's "Review now"; mounted by AppShell
useDrawerStore.getState().openOrphanedRecordsDrawer();
{orphanedRecordsDrawer.isOpen && <OrphanedRecordsDrawer />}
```

Data: `useOrphanedRecords()` → `findOrphanedRecords()` and `useAssignOrphanedRecords()` (`src/hooks/useOrphanedRecords.ts`); "unassigned" is defined once by `isOrphaned` in `src/db/orphanedRecords.ts`, which `runIntegrityCheck` also uses.

Tests: `src/components/drawers/__tests__/OrphanedRecordsDrawer.test.tsx`, `src/db/__tests__/orphanedRecords.test.ts`.

---

## Form Components

### Input
**Location**: `src/components/ui/Input.tsx`
**Purpose**: Text input with label, error state, and icon support.

```tsx
<Input
  label="Email"
  type="email"
  placeholder="name@example.com"
  error={errors.email?.message}
  icon={<MailIcon />}
  {...register('email')}
/>
```

**Props**:
| Prop | Type | Description |
|------|------|-------------|
| `label?` | string | Input label |
| `error?` | string | Error message |
| `icon?` | ReactNode | Leading icon |
| `...rest` | InputHTMLAttributes | Standard input props |

---

### Select
**Location**: `src/components/ui/Input.tsx` (exported alongside `Input`/`Textarea`)
**Purpose**: Brand-styled native `<select>` wrapper — custom chevron, `--input-*` tokens, 16px body text, error state.

```tsx
<Select label="Currency" {...register('currency')}>
  <option value="USD">US Dollar</option>
  <option value="ILS">Israeli Shekel</option>
</Select>
```

Takes `<option>` children (same as a native select), not an `options` array. Use `invalid` for a style-only error border when the error message is rendered elsewhere (common in `react-hook-form` + `Controller` call sites); use `error` when `Select` should own the message.

**Props**:
| Prop | Type | Description |
|------|------|-------------|
| `label?` | string | Select label |
| `error?` | string | Error message (renders below the select) |
| `invalid?` | boolean | Style-only error border, no message |
| `hint?` | string | Helper text below the select |
| `children` | ReactNode | `<option>` elements |
| `...rest` | SelectHTMLAttributes | Standard select props |

---

### DatePicker
**Location**: `src/components/ui/DatePicker.tsx`
**Purpose**: Date input with native picker.

```tsx
<DatePicker
  label="Due Date"
  value={dueDate}
  onChange={setDueDate}
  minDate={today}
/>
```

---

### CurrencyInput
**Location**: `src/components/ui/CurrencyInput.tsx`
**Purpose**: Amount input with currency display.

```tsx
<CurrencyInput
  label="Amount"
  currency="USD"
  value={amountMinor}
  onChange={setAmountMinor}
/>
```

**Behavior**: Displays as decimal ($19.99), stores as minor (1999).

---

### Textarea
**Location**: `src/components/ui/Textarea.tsx`
**Purpose**: Multi-line text input.

```tsx
<Textarea
  label="Notes"
  rows={3}
  placeholder="Additional notes..."
  {...register('notes')}
/>
```

---

### Switch
**Location**: `src/components/ui/Switch.tsx` (+ `Switch.css`)
**Purpose**: On/off control. `<button role="switch" aria-checked>`; toggles on click, Space and Enter; `disabled` sets `aria-disabled`; the knob travels in the reading direction (logical properties, mirrored in RTL); focus ring via `--focus-ring`.

```tsx
<span id="lbl">Expenses</span>
<Switch checked={on} onChange={setOn} labelledBy="lbl" />
<Switch checked={on} onChange={setOn} ariaLabel="Dark mode" disabled />
```

Props: `checked`, `onChange(next)`, `labelledBy?`, `ariaLabel?`, `disabled?`, `id?`, `className?`.
Tests: `src/components/ui/__tests__/Switch.test.tsx`. First consumer: `AdvancedFeaturesSection` (MUT-12).

---

### SegmentedControl
**Location**: `src/components/ui/SegmentedControl.tsx` (+ `SegmentedControl.css`)
**Purpose**: Single-select radiogroup for a small fixed set of mutually exclusive choices, with a sliding highlight. `role="radiogroup"` + `role="radio"` per option, roving tabindex, arrow-key navigation (wraps at the ends). The thumb is positioned in `useLayoutEffect` by mutating a ref's inline style directly — never `setState` in the effect (`react-hooks/set-state-in-effect` is a hard lint error; see `TruncatedTitle.tsx` for the same ref-mutation pattern). Animates on `--ease-spring`/`--duration-toggle` (zeroed under `prefers-reduced-motion`), critically damped — no overshoot, since this is a flat state switch, not a flick gesture. For a *multi*-select toggle (more than one option can be on at once), this isn't the right component — it's a radiogroup by design; use independent toggle buttons instead (Settings → Preferences' "Enabled currencies" row).

```tsx
<SegmentedControl
  value={language}
  onChange={setLanguage}
  options={[{ value: 'en', label: 'English' }, { value: 'ar', label: 'العربية' }]}
  labelledBy={languageLabelId}
/>
```

Props: `options` (`{value, label}[]`), `value`, `onChange(next)`, `ariaLabel?`, `labelledBy?`, `className?`.
Tests: `src/components/ui/__tests__/SegmentedControl.test.tsx`. First consumer: Settings → Preferences, language and theme (MUT-139).

---

## Button Components

### Button
**Location**: `src/components/ui/Button.tsx`
**Purpose**: Primary action button.

```tsx
<Button variant="primary" size="md" onClick={handleClick}>
  Save
</Button>

<Button variant="secondary" disabled={isLoading}>
  Cancel
</Button>

<Button variant="danger" isLoading>
  Delete
</Button>
```

**Props**:
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | 'primary' \| 'secondary' \| 'danger' \| 'ghost' | 'primary' | Button style |
| `size` | 'sm' \| 'md' \| 'lg' | 'md' | Button size |
| `isLoading?` | boolean | false | Show spinner |
| `disabled?` | boolean | false | Disable button |
| `icon?` | ReactNode | - | Leading icon |

---

### IconButton
**Location**: `src/components/ui/IconButton.tsx`
**Purpose**: Icon-only button (e.g., close, menu).

```tsx
<IconButton
  icon={<CloseIcon />}
  label="Close"
  onClick={onClose}
/>
```

---

### RowActionsMenu
**Location**: `src/components/ui/RowActionsMenu.tsx`
**Purpose**: Three-dot menu for table row actions.

```tsx
<RowActionsMenu
  items={[
    { label: 'Edit', onClick: handleEdit },
    { label: 'Delete', onClick: handleDelete, danger: true },
  ]}
/>
```

---

### RecordPaymentButton
**Location**: `src/components/ui/RecordPaymentButton.tsx`
**Purpose**: The primary row affordance for recording a payment against a
receivable, with the remaining balance shown on the button. Owns the single
gate deciding where that affordance appears, so the surfaces cannot drift
(before MUT-6 the same concept had three different inline conditions across
four call sites, and one surface had none).

**Gate**: renders `null` unless `kind === 'income' && paymentStatus !== 'paid'
&& (remainingAmountMinor ?? 0) > 0`. (A stale `lockedAt` on a legacy row is
ignored; document locks are gone since MUT-145, ADR-067.)

**Props-in, no store import**, like the rest of `components/ui`: the caller
passes `onRecordPayment` using the drawer hook it already holds. The click
calls `stopPropagation`, so it is never mistaken for a row click.

Place it inside the existing row actions cell (`.row-actions-cell`), never in a
new column, so it cannot push the amount column off-screen.

```tsx
<td>
  <div className="row-actions-cell">
    <RecordPaymentButton
      transaction={tx}
      onRecordPayment={() => openPartialPaymentDrawer({ transactionId: tx.id })}
    />
    <RowActionsMenu actions={[...]} />
  </div>
</td>
```

**`compact`** (MUT-82): the label alone, for a row whose amount already sits
beside the button (Home's Needs attention). The accessible name keeps the
amount: "Record Payment — Remaining: ₪3,550".

**Used by**: ClientWorkSection (client profile work list, MUT-3), IncomePage,
ProjectDetailPage, HomeAttentionRow (`compact`, MUT-82).
**Tests**: `src/components/ui/__tests__/RecordPaymentButton.test.tsx`

---

### SortableHeader
**Location**: `src/components/ui/SortableHeader.tsx` (+ `.css`)
**Purpose**: A `<th>` whose label is a button that sorts its column (MUT-7). It sets `aria-sort` (`ascending` / `descending` / `none`) and shows an arrow on the active column. It optionally aligns to the end edge for numeric columns, and its `title` can explain the ordering. Props-in: the caller owns the state (usually `useSortState`) and decides what a click does. The clients index toggles the active column, or switches to the clicked one in its natural direction.

```tsx
<SortableHeader field="owed" label={t('clients.columns.owedNow')} align="end"
  title={t('clients.index.owedOrderHint')}
  sortField={sortField} sortDir={sortDir} onSort={handleSort} />
```

**Used by**: ClientsPage, whose sort state is `useClientsSearch` since MUT-84 (not `useSortState`). ProjectsPage still uses a sort dropdown and can adopt this.
**Tests**: `src/components/ui/__tests__/SortableHeader.test.tsx`

---

### RowActionsHeader
**Location**: `src/components/ui/RowActionsHeader.tsx` (+ `.css`)
**Purpose**: The header cell of a table's row-actions column (Record payment and the row kebab). The column has no visible title, so the cell carries a visually hidden "Actions" (`common.actions`) and is never an empty header (axe `empty-table-header`, TD-009). It owns `.row-actions-header`, the shrink-to-fit width rule (`width: 1%; white-space: nowrap`). No props.

```tsx
<tr>
  <th className="text-end">{t('transactions.columns.amount')}</th>
  <RowActionsHeader />
</tr>
```

**Used by**: IncomePage, ClientWorkSection, ClientPaymentsSection, ProjectDetailPage. Use it for any new table with a row-actions column; never write an empty `<th>`.
**Tests**: `src/components/ui/__tests__/RowActionsHeader.test.tsx`

---

### CompactDate
**Location**: `src/components/ui/CompactDate.tsx` (exported from `components/ui`)
**Purpose**: A compact table's date (`dd/mm/yyyy`, `formatDateCompact`) set in the figure face: the `.num` utility, i.e. IBM Plex Mono with tabular digits. Thmanyah's digits are proportional, so a date column set in it changed width with the date: Income at 375px measured 718px on 11/11 and 736px on 08/08 (MUT-250). In the figure face every date is one width. The wide tables' long dates ("Oct 19, 2026") stay in the body face.
**Used by**: Income, the Expenses ledger (flat and grouped), Conversions — wherever `isCompact` switches to the short date.
**Tests**: `src/components/ui/__tests__/CompactDate.test.tsx`; `IncomePage.test.tsx` › compact date; QA `@web.brand.date-width`.

```tsx
<td>{isCompact ? <CompactDate iso={tx.occurredAt} /> : formatDate(tx.occurredAt, locale)}</td>
```

### TruncatedTitle
**Location**: `src/components/ui/TruncatedTitle.tsx` (+ `.css`)
**Purpose**: A record's title in a table row (MUT-62). It sits on one line and is cut with an ellipsis. It is a `<button>` that opens the record, so a keyboard can reach the row; its click stops propagation, so the row's own click doesn't open the record a second time. When the text is cut (`scrollWidth > clientWidth`), hover or keyboard focus shows the whole title in a tooltip. The tooltip:
- is portalled to `<body>`, because `.data-table` scrolls and would clip it;
- opens below the title from its inline start (the left edge, or the right edge when `<html dir="rtl">`), flips above when there's no room below, and is nudged inside the window with `nudgeInside`;
- follows WCAG 1.4.13: the pointer can move onto it (it waits `HIDE_GRACE_MS` before hiding), Escape dismisses it, and blur, scroll and resize hide it;
- is `aria-hidden`, because the button's accessible name is already the full title.

The text takes its direction from its own first letter (`dir="auto"` plus `unicode-bidi: plaintext`, which beats theme.css's `:lang(ar) { direction: rtl }`, TD-048). An English title in the Arabic UI, or an Arabic one in the English UI, therefore starts at its beginning and ends in the ellipsis. A title that fits gets no tooltip.

```tsx
<td className="work-cell">
  {row.title ? (
    <TruncatedTitle title={row.title} onOpen={() => openEntry(row.id)} />
  ) : (
    <span className="text-muted">{EMPTY_CELL}</span>
  )}
</td>
```

Put it in a `td.work-cell` (`index.css`: `width: 40%; max-width: 0`), so the cell takes the spare width and cuts the title instead of widening the table. Give the date cell `date-cell` (`white-space: nowrap`), so the date doesn't wrap to make room for the title.
**Used by**: IncomePage (the What column), ProjectDetailPage (the Transactions tab). The client profile's Work list still truncates with CSS only, with no tooltip (TD-076).
**Tests**: `src/components/ui/__tests__/TruncatedTitle.test.tsx`

### EMPTY_CELL
**Location**: `src/lib/utils.ts`
**Purpose**: The one dash (`—`) a table cell shows when it has nothing to show: an untitled entry's What, a missing project, client or category (MUT-62). The same glyph in every language. Use it in place of a literal `'-'` or `'—'` in new cells.

### toIncomeRow / incomeColumns
**Location**: `src/pages/income/incomeRows.ts`
**Purpose**: `/income`'s pre-shaped rows and stable columns (MUT-62, CLAUDE.md performance guardrails).
- **`toIncomeRow(tx)`** carries what every cell shows:
  - the title, trimmed, with blank becoming undefined;
  - client, project, status and payment status;
  - overdue days, only when above 0;
  - what was received on a part-paid entry;
  - `canMarkPaid`;
  - the entry itself, for `RecordPaymentButton`.
- **The page shapes once per result**, in `useMemo([transactions])`.
- **`incomeColumns(compact)`** returns one of two module-level arrays. The wide array is date · What · client · project · status · amount · actions; the compact one drops project. Each column has an i18n header key (`clients.profile.work.what` for What) and its header and cell classes. The header and every row render from the same array, so they can't drift.
**Tests**: `src/pages/income/__tests__/incomeRows.test.ts`

---

## Display Components

### Card
**Location**: `src/components/ui/Card.tsx`
**Purpose**: Container with consistent padding and styling.

```tsx
<Card>
  <Card.Header>
    <h3>Title</h3>
  </Card.Header>
  <Card.Body>
    Content here
  </Card.Body>
  <Card.Footer>
    Actions
  </Card.Footer>
</Card>
```

---

### Badge
**Location**: `src/components/ui/Badge.tsx`
**Purpose**: Small label for categorization.

```tsx
<Badge variant="success">Paid</Badge>
<Badge variant="warning">Pending</Badge>
<Badge variant="danger">Overdue</Badge>
<Badge variant="info">Draft</Badge>
```

---

### StatusBadge
**Location**: `src/components/ui/StatusBadge.tsx`
**Purpose**: Transaction/document status indicator.

```tsx
<StatusBadge status="paid" />      // Green "Paid"
<StatusBadge status="unpaid" />    // Yellow "Unpaid"
<StatusBadge status="overdue" />   // Red "Overdue"
```

---

### EmptyState
**Location**: `src/components/ui/EmptyState.tsx`
**Purpose**: Placeholder for empty lists.

```tsx
<EmptyState
  icon={<InboxIcon />}
  title="No transactions yet"
  description="Create your first transaction to get started."
  action={<Button onClick={openDrawer}>+ Add Transaction</Button>}
/>
```

---

## Home Components

Home is three blocks since MUT-8 (ADR-036): `OwedNowSummary` (Money Components) over every receivable, then these two sections in `.home-two-column`. The old `PredictiveKpiStrip`, `AttentionFeed`, `MonthActualsRow`, `KpiCard`/`KpiStrip` were deleted by decision. `QuickSummaries` never existed in this tree. A guard test (`src/__tests__/noDeadHomeModules.test.ts`) keeps them gone. MUT-58 then deleted the money-event read side only they used (`useMoneyEventQueries`, `moneyEventRepository`, `lib/monthDetection`, the money-event and guidance types, and the `invalidateMoneyEventQueries` call on every write path); `src/__tests__/noDeadMoneyEventModules.test.ts` keeps that gone too.

### HomeNeedsAttention
**Location**: `src/components/home/HomeNeedsAttention.tsx`
**Purpose**: "Who is late?" (MUT-8), and record a payment in place (MUT-82, ADR-055). It selects its rows with `selectAttentionReceivables` (`src/lib/attention.ts`) from `useReceivables({ profileId })`, **the same query Owed now reads**, so a payment changes both in one render: overdue or due within 7 days (inclusive), every currency, oldest due date first, ties by client name then id. Each row (`HomeAttentionRow`) shows the client (or "No client") and what it was for as a link to the client (a button opening the entry when there is no client), the remaining amount in its own currency with "Nd overdue", "Due in Nd" or "Due today", and a `compact` `RecordPaymentButton` in its own cell. A click anywhere else on the row opens the client, or the entry. The empty state reads "No overdue or upcoming receivables".
- **Record Payment** opens `PartialPaymentDrawer` with an `onRecorded` callback. A payment that settles the row marks it, moves focus to the next row's Record Payment (or the heading), and offers Undo (`usePaymentUndo`). When the row leaves the list, `captureRowExit` plays its slide-out. A partial payment keeps the row.
- **Undo** brings the row back; it takes focus again if focus was lost with the toast.
- The section is the slide-out's containing block and clips it. Below 400 px of card width (a phone, or two columns on a small window) the button moves to its own line under the client and the amount (a container query in `HomeNeedsAttention.css`).

```tsx
<HomeNeedsAttention profileId={profileId} />
```

### HomeRecentPayments
**Location**: `src/components/home/HomeRecentPayments.tsx`
**Purpose**: "What came in?" (MUT-8). It renders `useRecentPayments(profileId)`, the last 10 payments across clients from `paymentRecordRepo.listRecent`. These are the same payment rows as a client's Payments section (ADR-033), so they include income saved as Received. Each row shows the client, what it was for, the date and the amount in its own currency; nothing is totalled. A row opens the client profile, or the entry when there is no client.

```tsx
<HomeRecentPayments profileId={profileId} />
```

Tests: `src/pages/overview/__tests__/OverviewPage.test.tsx`, `src/components/home/__tests__/HomeNeedsAttention.test.tsx` (MUT-82 integration: full, partial, Undo, same render, keyboard, focus), `src/lib/__tests__/attention.test.ts` (the browser spec is to port to `qa/`, TEST_PLAN § MUT-82); data in `transactionRepo.test.ts` ("as Home's Needs attention") and `paymentRecords.test.ts` (`listRecent`).

### HomeAttentionRow
**Location**: `src/components/home/HomeAttentionRow.tsx` (not exported from the home barrel; only `HomeNeedsAttention` renders it)
**Purpose**: one Needs attention row (MUT-82). Hands its `<tr>` to the list on mount (`onArrive`) and, while it is still in the document, on unmount (`onLeave`), which is when a leaving row can be copied for its slide-out. `ATTENTION_PAY_CLASS` marks its Record Payment for focus hand-offs.

### usePaymentUndo
**Location**: `src/hooks/usePaymentUndo.ts`
**Purpose**: Undo for a payment just recorded (MUT-82). `offerUndo(record, message, onUndone?)` shows a toast in the `PAYMENT_UNDO_GROUP` group (one Undo at a time) whose action deletes the record through `useDeletePaymentRecord`, so the entry is recalculated from the records left (ADR-038/039). Works after the screen that offered it has gone. A failed delete shows `overview.undoFailed`. Reusable by MUT-85's lump-sum payment.
**Tests**: `src/hooks/__tests__/usePaymentUndo.test.tsx` (real repository: exact restore of status, remaining and paidAt).

---

### InfoIcon
**Location**: `src/components/icons/InfoIcon.tsx` (or inline in Home components)
**Purpose**: Information tooltip trigger icon.

```tsx
<InfoIcon />
// Renders: (i) info circle icon
```

**Usage**: Typically paired with tooltips to explain projected values or data sources.

---

## Expenses Components

### RecurringAttentionList
**Location**: `src/components/expenses/RecurringAttentionList.tsx` (+ `.css`); shaping in `src/components/expenses/recurringAttention.ts`
**Purpose**: Expenses › Needs attention as **one row per recurring rule** (MUT-87, decision E1, ADR-052): "Server hosting · $80 monthly · Aug, Sep, Oct not marked · $240", the oldest payment's lateness under the amount ("68d overdue", "Due today", as Home says it). One primary **Mark Paid** per row; Skip all, Snooze all… and Edit recurring rule in a ⋯ menu built on `useMenuButton()` (menu opens under its button on the end edge, so it mirrors in RTL; rows are a `<ul>`, not a scrolling table, so nothing clips it). The header carries the number of rules and the total per currency (`CurrencyAmounts`). Presentational: the page passes the groups and the four handlers.

```tsx
const groups = useMemo(() => groupOccurrencesByRule(dueOccurrences), [dueOccurrences]);
<RecurringAttentionList groups={groups} onMarkPaid={open} onSnoozeAll={openSnooze} onSkipAll={skipAll} onEditRule={edit} />
```

`recurringAttention.ts` (pure, tested): `groupOccurrencesByRule` (rule → missed payments oldest first; rows by oldest payment, then title, then id), `currencyTotals`, `formatMonthList` / `formatMonthYear` / `formatDateOnly` (date-only values read as **local** dates, `Intl` month names and `Intl.ListFormat`; the year is added only when the payments span two years), `snoozeDateAfter`, `amountInputValue` and `readPaymentAmount` (the app's one amount parser; a symbol naming another currency is refused).
Tests: `src/components/expenses/__tests__/RecurringAttentionList.test.tsx`, `recurringAttention.test.ts`.

### RecurringOccurrenceCard / RecurringOccurrenceList
**Location**: `src/components/ui/RecurringOccurrenceCard.tsx`
**Purpose**: Read-only since MUT-87: one projected recurring payment with its state, for the Expenses forecast (`compact`). Its Mark Paid / Skip / Snooze / Edit rule buttons were replaced by `RecurringAttentionList` and `RecurringMarkPaidDrawer`; `RecurringConfirmModal` and `RecurringSnoozeModal` were deleted.

---

## Table Components

> **Correction (2026-10-11, found during MUT-36).** `DataTable` and
> `CellAmount` below describe files that do not exist —
> `src/components/tables/` is absent. Tables are page-local `<table>` markup
> styled by `src/components/ui/Table.css`. Before building a table, read an
> existing page (`ClientsPage`, `OverviewPage`) instead of these entries. The
> hosted portal (MUT-43) adds a `DecimalAmount` and a small table wrapper and
> registers them when built.

### DataTable
**Location**: `src/components/tables/DataTable.tsx`
**Purpose**: Generic data table with sorting and row click.

```tsx
<DataTable
  columns={[
    { key: 'name', header: 'Name', sortable: true },
    { key: 'amount', header: 'Amount', render: CellAmount },
    { key: 'status', header: 'Status', render: CellStatus },
  ]}
  rows={transactions}
  rowKey="id"
  onRowClick={(row) => openDrawer(row.id)}
  emptyState={<EmptyState ... />}
/>
```

**Props**:
| Prop | Type | Description |
|------|------|-------------|
| `columns` | ColumnDef[] | Column definitions |
| `rows` | T[] | Data array |
| `rowKey` | keyof T | Unique row identifier |
| `onRowClick?` | (row: T) => void | Row click handler |
| `emptyState?` | ReactNode | Empty state component |

---

### CellAmount
**Location**: `src/components/tables/CellAmount.tsx`
**Purpose**: Formatted currency cell.

```tsx
<CellAmount amountMinor={1999} currency="USD" />
// Renders: $19.99
```

---

### CellStatus
**Location**: `src/components/tables/CellStatus.tsx`
**Purpose**: Status with due date indicator.

```tsx
<CellStatus
  status="unpaid"
  dueDate="2024-01-15"
  paidAt={null}
/>
// Renders: "Unpaid" badge + "Due Jan 15" or "3 days overdue"
```

---

### CellDate
**Location**: `src/components/tables/CellDate.tsx`
**Purpose**: Formatted date cell.

```tsx
<CellDate date="2024-01-15" format="short" />
// Renders: Jan 15, 2024
```

---

## Filter Components

### DateRangeControl
**Location**: `src/components/filters/DateRangeControl.tsx`
**Purpose**: Date range picker with presets.

```tsx
<DateRangeControl
  dateFrom={dateRange.dateFrom}
  dateTo={dateRange.dateTo}
  onChange={(from, to) => setDateRange({ dateFrom: from, dateTo: to })}
/>
```

**Accessible names** (TD-009): the preset select is "Period" (`filters.period`), because it has no visible label beside it in the top bar. With Custom chosen, the date inputs are "From" and "To" (`filters.periodFrom` / `periodTo`).

**Presets**:
- `this-month`: Current calendar month
- `last-month`: Previous calendar month
- `this-year`: Jan 1 to Dec 31 current year
- `custom`: Manual date selection

---

### useIncomeFilters + incomeSearch (URL filters for /income, MUT-83)
**Location**: `src/hooks/useIncomeFilters.ts`, `src/lib/incomeSearch.ts`
**Purpose**: `/income`'s filters as one model in the URL: `dateFrom`/`dateTo` (both or neither), `status` (`unpaid` / `received` / `overdue`), `q` and `client` (`none` / `archived`).
- `useIncomeFilters()` returns `{ search, setSearch(patch) }`. `setSearch` writes with `replace`, and a field set to `undefined` or `''` is removed.
- `parseIncomeSearch` is the route's `validateSearch`. It drops unknown values and reads a numeric `q` as text.
- `resolveIncomeFilters` fills in the defaults: this month, All, no search, every client.
- `owedEntriesSearch(scope)` is the link the Clients list's muted rows open: Unpaid, all time.

```tsx
const { search, setSearch } = useIncomeFilters();
const filters = useMemo(() => resolveIncomeFilters(search), [search]);
<Link to="/income" search={owedEntriesSearch('none')}>…</Link>
```

**Extend, don't copy**: a new `/income` filter is one more field in `IncomeSearch`, `parseIncomeSearch` and `resolveIncomeFilters`.
**Tests**: `src/lib/__tests__/incomeSearch.test.ts`, `src/hooks/__tests__/useIncomeFilters.test.tsx` (real memory router), `src/pages/income/__tests__/IncomePage.test.tsx`.

---

### useClientsSearch + clientsSearch (URL model for the Clients list, MUT-84)
**Location**: `src/components/clients/useClientsSearch.ts`, `src/components/clients/clientsSearch.ts` (beside the sort fields they validate; `src/lib` and `src/hooks` import nothing from `components`)
**Purpose**: The Clients list's search and sort as one model in the URL: `q`, `sort` (a `ClientSortField`) and `dir`. It works on `/clients` and `/clients/:id` alike, so they survive switching clients.
- `parseClientsSearch` is the layout route's `validateSearch`. It drops unknown values and reads a numeric `q` as text.
- `mergeClientsSearch` drops a cleared search and any default (owed, desc).
- `resolveClientsSearch` fills in the defaults.
- `useClientsSearch()` returns `{ search, setSearch(patch) }`, written with `to: '.'` and `replace`, so the open client stays open.

Every client link and walk passes `search: true` to keep them.

```tsx
const { search, setSearch } = useClientsSearch();
const { q, sort, dir } = useMemo(() => resolveClientsSearch(search), [search]);
<Link to="/clients/$clientId" params={{ clientId }} search>…</Link>
```

**Tests** (written, not yet run; TD-067): `src/components/clients/__tests__/clientsSearch.test.ts`, `src/components/clients/__tests__/useClientsSearch.test.tsx` (real memory router). Page tests stand in for the hook with an in-memory model (`ClientsPage.test.tsx`).

---

### SearchInput
**Location**: `src/components/filters/SearchInput.tsx`
**Purpose**: Debounced search input.

```tsx
<SearchInput
  value={search}
  onChange={setSearch}
  placeholder="Search clients, projects..."
  debounceMs={200}
/>
```

---

### StatusSegment
**Location**: `src/components/filters/StatusSegment.tsx`
**Purpose**: Status filter segment control.

```tsx
<StatusSegment
  value={status}
  onChange={setStatus}
  options={['all', 'paid', 'unpaid', 'overdue']}
/>
```

---

## Feedback Components

### Toast
**Location**: `src/components/ui/Toast.tsx`
**Store**: `src/lib/toastStore.ts`
**Purpose**: Non-blocking notifications.

```tsx
// Usage via store
import { toast } from '@/lib/toastStore';

toast.success('Transaction saved');
toast.error('Failed to delete');
toast.info('Syncing...');

// Rendered globally in AppShell
<ToastContainer />
```

**MUT-82 additions**:
- `showToast(message, { action, group })`: a toast with a `group` replaces the toast showing in that group (one Undo at a time). Toasts with no group stack.
- `ToastContainer` pauses a toast's timer while the pointer is over it or focus is inside it, and resumes with the time that was left (`useDismissTimer`).
- `useToast` selects only the two store actions, so a component that shows toasts doesn't re-render when one comes or goes.
- Tests: `src/components/ui/__tests__/ToastContainer.test.tsx`, `src/lib/__tests__/toastStore.test.ts`.

**MUT-338 addition**: `showToast(message, { icon })` renders `icon` (e.g.
`<SaveFeedbackIcon preset={...} />`) inside `.toast-icon`, ahead of the
message; absent by default, every other caller unaffected. The hosted
`src/hosted/components/Toast.tsx` has the same `icon?: ReactNode` override on
its `ToastOptions`, replacing that tone's default icon (`InfoIcon`/`AlertIcon`)
when supplied.

---

### SavedFlash (store + hook + announcer) — MUT-81, ADR-057
**Store**: `src/lib/savedFlashStore.ts`
**Hook**: `src/lib/useSavedFlash.ts` (moved from `hooks/` by MUT-91 so the portal may import it)
**Announcer**: `src/components/layout/SavedFlashAnnouncer.tsx` (mounted once in `AppShell`)
**Purpose**: After saving income or a payment, tint the row if it is on screen, or say where it went if it is not. One mechanism for every save path and every list, so no list reimplements the claim logic.

```tsx
// A drawer, after a successful create or update
import { useSavedFlashStore } from '@/lib/savedFlashStore';
const markSaved = useSavedFlashStore((s) => s.markSaved);
markSaved({ kind: 'income', ids: [newTx.id], clientId, clientName, profileId });

// A list that renders rows with ids
import { useSavedFlashRows } from '@/lib/useSavedFlash';
const isFlashed = useSavedFlashRows('my-list-id', rows.map((r) => r.id), { isLoading, isFetching });
// <tr className={cn('clickable', isFlashed(row.id) && 'row-flash')}>
```

- `markSaved` is unconditional in both `IncomeDrawer` and `PartialPaymentDrawer`: ClientWorkSection and IncomePage open the payment drawer with no callback, so the drawer is the only place that can know.
- A list's `settled` state is derived inside `useSavedFlashRows` from the query result (`!isLoading && !isFetching`), never passed in loose, so no caller can race a refetch.
- Resolution is list-reported settled (every registered list must report before an unclaimed save raises its message) — never a global `useIsFetching()` count, which races TanStack invalidation (see ADR-057).
- `:is(.data-table, .table) tr.row-flash > td` (`src/index.css`; the app's and the portal's tables, MUT-91): a 1.5s `--accent-subtle` fade plus a 3px leading rail. The rail is an inset box-shadow, which has no logical form, so an explicit `[dir="rtl"]` rule mirrors it. `--accent-subtle` alone is already the app's "selected" look in 15 other places. Reduced motion holds the tint, skips the fade; the selector's specificity keeps that held tint above `.data-table tr:hover td`.
- The announcer renders a visually-hidden `role="status" aria-live="polite"` "Saved" when claimed; otherwise it raises the existing `Toast` with a Show action that switches the active profile (via the raw `profileStore`, never `useActiveProfile`'s wrapper), navigates, and re-arms the flash so the message can't repeat.
- **Not yet built** (see TD-077, TD-078): the design review's anchored-strip presentation, the Owed-now tick, currency-block collapse, pagination for the two unbounded lists, and a dedicated focus chain outside Home.
- Tests: `src/lib/__tests__/savedFlashStore.test.ts`, `src/lib/__tests__/useSavedFlash.test.tsx`, `src/components/layout/__tests__/SavedFlashAnnouncer.test.tsx`, plus integration coverage in `IncomeDrawer.test.tsx`, `PartialPaymentDrawer.test.tsx` and `HomeNeedsAttention.test.tsx`.
- **Portal (MUT-91):**
  - `src/hosted/components/SavedNotice.tsx` is the portal's view of the same store. It shows a page-local "Expense saved · Show" / "Conversion saved · Show" notice (`hp-toast hp-toast-info`, `role="status"`).
    - It lasts `NOTICE_MS` (6s) and holds while hovered or focused.
    - It settles a save when it times out, Show is pressed, or the page is left.
    - It re-arms after Show once `filtersKey` changes.
  - `AnchoredNote` reads "Showing from a saved entry · Show latest" and takes focus after Show.
  - `src/hosted/data/anchoredList.ts` `useAnchoredList(filters, setFilters, listError)` gives both lists `show`, `showLatest`, `focusRequest`, and drops a stale anchor (the server's `ANCHOR_NOT_FOUND` 404, `isStaleAnchor` in `data/filters.ts`).
  - `HostedTable` takes `rowClassName` for the tint.
  - Store actions: `settleMessage(flash)` marks a save shown and resolves it if unresolved; `MAX_WAIT_MS` (10s) caps how long a fetching list can hold a save.
  - Tests: `src/hosted/components/__tests__/SavedNotice.test.tsx`, `src/hosted/pages/__tests__/afterSave.test.tsx`, `src/hosted/session/__tests__/endSession.test.ts`.

### Press feedback (`.press`) — MUT-91, ADR-074
**Location**: `src/index.css` (`:is(.btn, .press):active:not(:disabled)`), `src/components/ui/Button.css` (`.btn` transition)
**Usage**: every `Button` presses already; add `className="… press"` to any other control that acts (the portal's menu, switcher, language, expand and password-toggle buttons, the drawer's close). Not on tabs or text links.
**Tests**: `src/styles/__tests__/pressFeedback.test.ts` (CSS contract, bans `transform: scale(var(--press-scale))`), `src/hosted/pages/__tests__/pressFeedback.test.tsx` (every portal button carries `btn` or `press`).

---

### Modal
**Location**: `src/components/modals/Modal.tsx`
**Purpose**: Generic modal dialog.

```tsx
<Modal
  open={isOpen}
  onClose={handleClose}
  title="Confirm Action"
>
  <p>Are you sure?</p>
  <Button onClick={handleConfirm}>Confirm</Button>
</Modal>
```

---

## Money Components

### OwedNowSummary
**Location**: `src/components/clients/OwedNowSummary.tsx`
**Purpose**: Owed Now as the dominant figure (MUT-3): one large amount per currency — never converted, never combined — with the overdue part beneath it ("$500 overdue" in the error colour, or "Nothing overdue"), and "Nothing owed" when the list is empty. Presentational: compute the input with `summarizeOwedByCurrency(transactions, today)` (`src/db/aggregations.ts`, ADR-033) so every screen that shows Owed Now agrees. Amounts are `<bdi dir="ltr">`; the amount inside the translated overdue sentence is wrapped in U+2066/U+2069.

```tsx
const owed = useMemo(() => summarizeOwedByCurrency(receivables, today), [receivables, today]);
<OwedNowSummary owed={owed} />
```

**Use when**: showing what is owed now.
- The client profile uses it.
- Home (MUT-8) uses it over every receivable in the active profile.
- The clients index strip uses it over `useClientOwedIndex(...).total`. That is the same figure as Home's (MUT-83, ADR-049), or `combineOwed` of the matching rows while a search is active.

Not for period totals (paid income, expenses): those are not "now" figures.
**Not**: `CurrencySummaryPopup` or `KpiCard`, which both convert to ILS.
Tests: `src/components/clients/__tests__/OwedNowSummary.test.tsx`; the helper in `src/db/__tests__/aggregations.test.ts`.

---

### partitionOwedNow / clientScopeOf (helpers, MUT-83)
**Location**: `src/db/aggregations.ts`

**`partitionOwedNow(entries, clients, today)`** splits the entries one Owed now figure is made of into:
- `entriesByClient`: every live entry of each live client, in any state;
- `noClient`: `{ owed, count }`, where count is entries with a balance;
- `archivedClients`: `{ owed, count }`, where count is clients with a balance;
- `total`: `summarizeOwedByCurrency` over all the entries.

The parts always add up to `total`. It takes entries and clients rather than a business, so a lens over several businesses (MUT-89) can reuse it.

**`clientScopeOf(tx, clientsById)`** is the one definition of whose list an entry belongs on: `'none'` (no client, or its row is gone), `'archived'`, or `undefined` (a live client). `transactionRepo.list({ clientScope })` filters with it too.

`owedNowRemaining(tx)` is what one entry adds to Owed now (`summarizeOwedByCurrency` sums it).

**Reads built on them**: `clientSummaryRepo.listOwedIndex({ profileId, search })` → `ClientOwedIndex`, through the `useClientOwedIndex(profileId, search, { enabled })` hook (key `['clientSummaries', 'owedIndex', …]`). `profileId` is a `ProfileScope`: a list (All businesses, MUT-89) adds `profileIds` to each row and `byProfile` (the muted rows per business).
**Tests**: `src/db/__tests__/aggregations.test.ts`, `src/db/__tests__/clientOwedIndex.test.ts` (parity with Home).

---

### Clients index muted rows (`toOwedBucketRows`, `orderClientIndex`, `BUCKET_SCOPE`)
**Location**: `src/components/clients/clientIndexRows.ts`
**Purpose**:
- `toOwedBucketRows(index)` turns an index's `noClient` and `archivedClients` into the muted rows to show, in fixed order, dropping a bucket that owes nothing.
- `orderClientIndex(rows, buckets, field, dir)` returns the display order: clients sorted by the chosen column (ADR-035), then the muted rows, which never take part in the sort.
- `BUCKET_SCOPE` maps a bucket to the `/income` client scope it opens.
- `toBusinessBucketRows(byProfile)` (MUT-89): the muted rows under All businesses, one per business that owes, all No client rows first, each carrying its `profileId`.

**Tests**: `src/components/clients/__tests__/clientIndexRows.test.ts`.

---

### All businesses lens (MUT-89, ADR-051)
**Locations**: `src/hooks/useActiveProfile.ts`, `src/lib/profileStore.ts`, `src/components/layout/AppShell.tsx`, `src/components/ui/ProfileBadge.tsx`, `src/db/baseQuery.ts`

**Hooks:**
- **`useOwedLens()`**: for Home and Clients only. It returns `{ scope, isAll, profilesById }`:
  - the scope is every live business in All, else the working id;
  - it is `''` with no business at all, and `undefined` while the businesses load (read nothing yet);
  - it ignores the route flag.
- **`useActiveProfile()`**: `activeProfileId` is always concrete. `isAllProfiles` and `showAllProfilesOption` (for the chrome) need the lens, an owed screen and 2 or more businesses. `setActiveProfile(id)` is a pick (lens off); `setAllBusinesses(on)` turns the lens on or off.
- **`useOwedScreenSync()`**: called once in AppShell. It reads `useMatches()` for `staticData.owedLens` and writes `onOwedScreen` before paint, into **`useOwedScreenStore`** (`src/lib/profileStore.ts`), an unsaved store kept apart from the persisted profile store so navigation never writes localStorage.
- **`useProfileAwareAction`**: `trigger(event, returnFocus?)` records where the asking menu item was (`anchorRect`) and the button to give focus back to (`returnFocus`). `ProfileQuickPicker` places itself from that rectangle, focuses its first business, and returns focus on Escape. Callers pass `menu.buttonProps.ref.current`.
- **`ClientTypeahead`** `canCreate` (default true): a form still asking which business turns "Create new" off, so a new client is never filed in the default business by accident. The Income drawer also passes `disabled` to `ProjectTypeahead` until then. Picker options are `tabIndex={-1}`: the list is one Tab stop, moved with the arrow keys.
- **`POPOVER_EDGE_MARGIN`** (`src/components/layout/popoverPosition.ts`, beside `nudgeInside`): the one edge gap for TruncatedTitle, FxRateReadout and ProfileQuickPicker.
- **`ClientOwedIndexRow`** (`src/types`): a clients-index row, `ClientSummary` plus the required `profileIds`.

**Components:**
- **`BusinessesGate`** (AppShell.tsx): renders the routed page only once the businesses have loaded.
- **`BusinessTags`** (ProfileBadge.tsx): `profileIds` + `profilesById`, one `ProfileBadgeWithName` per known business, the name in `<bdi>` with a title. Renders nothing when none is known. Rows use the classes `home-row-business` and `client-index-businesses`, for a line of their own.

**Data:**
- **`ProfileScope`** (`src/types`, re-exported by `baseQuery`): `string | readonly string[]`.
- **`scopeToProfile(record, scope)`**: a list never matches a record with no business.

**Tests**: `useActiveProfile.test.tsx`, `allBusinessesLens.test.tsx`, `profileStore.test.ts`, `router.owedLens.test.ts`, `AppShell.gate.test.tsx`, `ProfileBadge.test.tsx`, `baseQuery.test.ts`.

---

### CurrencyAmounts
**Location**: `src/components/ui/CurrencyAmounts.tsx` (+ `.css`); entries from `orderCurrencyAmounts` in `src/lib/currencyAmounts.ts`
**Purpose**: Amounts in several currencies side by side, one `<bdi dir="ltr">` per currency (left to right in Arabic too, kept by MUT-109 D2), never converted or combined (ADR-004), like Owed now but without its label and overdue lines (MUT-87). `orderCurrencyAmounts(totals)` keeps the non-zero currencies in USD → ILS → EUR order; its order is a `Record<Currency, number>`, so a new currency without a place fails to compile.

```tsx
<CurrencyAmounts amounts={orderCurrencyAmounts({ USD: 24000, ILS: 350000 })} />
// $240  ₪3,500
```

**Use when**: a total or a header figure covers several currencies (the Expenses Needs attention total). **Not**: `OwedNowSummary` for Owed now itself; `CurrencySummaryPopup`, which converts. The Expenses page's "Total expenses" strip still uses `CurrencySummaryPopup`, and sums the wrong table (reported with MUT-87, not changed).
Tests: through `RecurringAttentionList.test.tsx`; the helper in `src/lib/__tests__/currencyAmounts.test.ts`.

---

### AmountWithConversion
**Location**: `src/components/ui/AmountWithConversion.tsx`
**Purpose**: Display single-currency amount with hover tooltip showing ILS conversion.

```tsx
<AmountWithConversion
  amountMinor={1999}
  currency="USD"
  type="income"
  showExpenseSign={false}
/>
// Renders: $19.99 with hover tooltip "≈ ₪73.50 ($1 = 3.67 ₪, Live)"
```

**Use when**: Displaying individual transaction amounts in tables/lists.

---

### CurrencySummaryPopup
**Location**: `src/components/ui/CurrencySummaryPopup.tsx`
**Purpose**: Display unified ILS amount with click-to-expand currency breakdown popup.

```tsx
<CurrencySummaryPopup
  usdAmountMinor={1999}
  ilsAmountMinor={5000}
  eurAmountMinor={1500}
  type="income"
/>
// Renders: ₪95.50 with info icon; click shows dropdown with per-currency amounts + FX rates
```

**Use when**: Summary statistics in page headers or table cells where space is limited.

---

### ~~FxRateBanner~~ (removed, MUT-79)
The floating, draggable FX panel; replaced by `FxRateReadout` in the top bar (see Layout).

---

### CurrencyBadge
**Location**: `src/components/money/CurrencyBadge.tsx`
**Purpose**: Small currency indicator.

```tsx
<CurrencyBadge currency="USD" />
// Renders: "$" badge
```

---

## Icon Components

**Location**: `src/components/icons/`

All icons are custom SVG components for consistency:

```tsx
import {
  PlusIcon,
  EditIcon,
  TrashIcon,
  SearchIcon,
  FilterIcon,
  DownloadIcon,
  UploadIcon,
  CheckIcon,
  CloseIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CalendarIcon,
  DollarIcon,
  UserIcon,
  FolderIcon,
  SettingsIcon,
  SyncIcon,
} from '@/components/icons';
```

**Usage**:
```tsx
<Button icon={<PlusIcon />}>Add</Button>
<IconButton icon={<CloseIcon />} label="Close" />
```

### Generated icons (MUT-336)

**Location**: `src/components/icons/generated/` — a second, separate barrel.
Every file in it, including `index.ts` and `types.ts`, is produced by
`npm run icons:generate` from `assets/icons/source/*.svg` (the MUT-335
canonical set) and overwritten on every run — never hand-edit anything here.
`npm run icons:check` fails on missing/stale/orphaned drift between source and
generated output. Full flow: `assets/icons/README.md`. Logic:
`scripts/icon-set.ts` (tested directly, `scripts/__tests__/icon-set.test.ts`).

These are consumed at two call sites: the `LanguageIcon` pilot in
`SettingsPage.tsx`, and `SuccessIcon` via `SaveFeedbackIcon` below. Migrating
the 16 hand-written components above, or the scattered inline SVGs (`XIcon`,
`MoreIcon`, `PlusIcon` duplicates, etc.), to the generated set is still out of
scope — nothing has swept them.

```tsx
import { LanguageIcon } from '../../components/icons/generated';
<LanguageIcon size={16} className="settings-label-icon" />
```

A named sub-part survives codegen as `data-part="<name>"` (never a raw `id` —
collides across repeated instances of the same icon on one page), for
`playIconFeedback` (MUT-337) to target.

### SaveFeedbackIcon (MUT-338)

**Location**: `src/components/icons/SaveFeedbackIcon.tsx`.
**Purpose**: The only call site that plays MUT-337's `playIconFeedback` against a
real icon. Wraps the generated `SuccessIcon` in a plain `<span>` carrying the
ref — the ref belongs on the caller's container, per MUT-337's own contract,
never on the generated icon itself (no codegen/forwardRef change needed).
Resolves `prefers-reduced-motion` itself via `useMediaQuery`, so every call
site gets the fallback for free.

```tsx
import { SaveFeedbackIcon } from '../../components/icons/SaveFeedbackIcon';
import { saveFeedbackPreset } from '../../lib/motion/saveFeedbackPreset';

<SaveFeedbackIcon preset={saveFeedbackPreset(profile)} />
```

`saveFeedbackPreset` (`src/lib/motion/saveFeedbackPreset.ts`) is the one
source of truth for playful-vs-restrained: `profile?.firm === true` (MUT-300's
firm switch on `/v1/me`) → restrained, everything else → playful. That includes
a BUSINESS profile without firm features (Basel, MUT-338 comment 12272) and
`undefined`, which is the legacy app: it has no firm concept (MUT-299 B11). Five call sites wire it today:
`SavedFlashAnnouncer.tsx` and `ExpenseDrawer.tsx` (legacy, always playful),
`IncomeCaptureDrawer.tsx`, `Toast.tsx`'s icon override, and `SavedNotice.tsx`
(portal, resolved by the page via `useProfile()`).

- Tests: `src/components/icons/__tests__/SaveFeedbackIcon.test.tsx`,
  `src/lib/motion/__tests__/saveFeedbackPreset.test.ts`.

---

## Component Ownership

| Component | Owner | Last Updated |
|-----------|-------|--------------|
| AppShell | Core | 2024-03 |
| TransactionDrawer | Transactions | 2024-06 |
| DataTable | Core | 2024-04 |
| All filters | Core | 2024-05 |
| Document components | Documents | 2024-08 |
| Expense components | Expenses | 2024-09 |
| Retainer components | Retainers (retired MUT-226) | 2024-10 |
| Home components | Home | 2026-03 |
| PredictiveKpiStrip | Home | 2026-03 |
| AttentionFeed | Home | 2026-03 |
| MonthActualsRow | Home | 2026-03 |

---

## Creating New Components

Before creating a new component:

1. **Check this registry** for existing similar components
2. **Check `src/components/`** directory structure
3. If 70%+ overlap with existing component, **extend it** instead
4. If new, **document it here** with:
   - Location
   - Purpose
   - Props
   - Usage example

---

## Hosted portal (`src/hosted`) — MUT-43, expenses MUT-44

The portal reuses the app's tokens, `Button`, `Badge`, `Card` CSS, `SegmentedTabs`, `SearchInput`, `Table.css`, `ThemeProvider` and the i18n core. It may not import the local data layer, hooks, shell, drawers or stores (lint-enforced) — the "hooks" ban is on the path segment, not on whose hooks they are, so the portal's own mutation hooks live under `data/`, not a `hooks/` dir (MUT-44). It also reuses the app's `src/index.css` directly (both builds already import it), which is how `components/Drawer.tsx` gets the local drawer's exact chrome without importing the local drawer component.

| Module | Exports | Used by |
|---|---|---|
| `src/lib/i18n/core.tsx` (**shared**, MUT-43) | `I18nProvider` (controlled: `translations`, `language`, `setLanguage`), `createTranslator` (`t` with `.has`), `useLanguage`, `useT`, `useDirection`, `getLocale`, `getDirection`, `detectSystemLanguage` | the app's `LanguageProvider` (context.tsx), `HostedLanguageProvider`, every `useT()` caller |
| `src/lib/i18n/plural.ts` (**shared**) | `tp` via `useTp()`, `createPluralTranslator`, `pluralKey` (CLDR forms through `Intl.PluralRules`) | portal (`hosted.auth.rateLimited`); available to the app |
| `src/components/expenses/` (**shared**, MUT-44; `RecurringAttentionList` and `recurringAttention` there are app-only, MUT-87) | `ExpenseFormFields<T>` (presentational: amount/currency/date/title/category/notes, vendor/client/project as host-supplied slots, `amountInputMode: 'number' \| 'decimalText'`, optional `dateMax` — hosted passes the ten-year ceiling, MUT-392), `expenseFormFieldsSchema`, `DECIMAL_AMOUNT` | local `ExpenseDrawer`, hosted `ExpenseDrawer` |
| `api/client.ts` | `api.*` (one function per operation, now incl. expense CRUD + categories + summary + receipt start/complete/download/delete), `request` (GET/POST/PATCH/DELETE, `idempotencyKey`/`ifMatchVersion` options), `ApiError` (`status`, `code`, `details`, `retryAfterSeconds`), `setUnauthorisedHandler`, schema type aliases | every portal hook and page |
| `format/DecimalAmount.tsx` | `DecimalAmount` (a plain `<bdi>`, MUT-109), `formatDecimal(value, currency, language)`, `isZeroDecimal` | every money cell and strip |
| `format/dates.ts` | `formatDay` (calendar date, never shifted), `formatInstant` (in the organization's zone), `formatSize`, `todayLocalISO` (MUT-44, browser-local calendar date — the expense drawer's default `occurredOn`) | views |
| `components/QueryView.tsx` | `QueryView` (loading / empty / error / populated; a view in error renders no data; a 404 re-checks `/v1/me`), `Unreachable`, `Skeleton`, `Empty` (now takes `action`) | every view |
| `components/HostedTable.tsx` | `HostedTable<Row>` (`columns`, pre-shaped `rows`, `rowKey`, `label`, optional `detail` row, optional `onRowClick` — MUT-44, opt-in, reuses `Table.css`'s `.clickable`). MUT-194 (D8/D11): with `onRowClick` the first cell's content sits in a `<button type="button" class="row-link press">` (Tab, Enter/Space; `stopPropagation` so the row's mouse click never double-fires); the `<tr>` gets no role or tabIndex. `.row-link` in `hosted.css` reads as plain cell text with the `--focus-ring` | every list; clickable in `ExpensesList`, `ConversionsList` |
| `components/FilterControls.tsx` | `ClientFilter`, `MatterFilter`, `CategoryFilter` (MUT-44), `CurrencyFilter`, `SelectFilter`, `DateFilter`, `FilterBar` (labelled) | list views |
| `components/ReadOnlyNotice.tsx` | `ReadOnlyNotice` (reads `profile.access` and `writerOfRecord`, `role="note"`) | income views |
| `components/Toast.tsx` | `ToastProvider`, `useToast` (one `role="alert"` message) | sign-out failure, download failure, expense save conflicts/network errors (MUT-44) |
| `components/Drawer.tsx` (MUT-44) | `Drawer` (title/onClose/children/footer/closeLabel; Escape + overlay-click close) on the app's `.drawer`/`.drawer-overlay` classes from shared `src/index.css` — not an import of `src/components/drawers/Drawer.tsx` | `ExpenseDrawer` |
| `components/ExpenseDrawer.tsx` (MUT-44) | `ExpenseDrawer` (create/edit, `ExpenseFormFields` + pickers + vendor text + `ReceiptUploader`, MUT-42 error-code → field/toast mapping) | `ExpensesList` |
| `components/ClientPicker.tsx`, `ProjectPicker.tsx` (MUT-44) | `EntityTypeahead` fed by the read-only `useCustomerDirectory`/`useProjectDirectory`; no create-new branch (MUT-42 D6: existing org records only) | `ExpenseDrawer` |
| `components/ReceiptUploader.tsx` (MUT-44) | `ReceiptUploader` (start → PUT the signed URL → complete; PDF/JPEG/PNG, 10 MB, 10-receipt cap counting only READY). Signed out (MUT-287) the server signs `local-blob:` and the file goes to this device (`localFiles.put`); download passes the filename | `ExpenseDrawer` (edit mode only) |
| `data/download.ts` (MUT-287) | `downloadNavigator.open(url, filename)` (signed URL: top-level navigation; `local-blob:`: object URL + `<a download>`), `localFiles.put`/`read` (the local backend's receipt files) | `ReceiptUploader`, `DocumentsList`, `expenseQueries.putToSignedUrl` |
| `components/expenseApiErrors.ts` (MUT-44) | `applyExpenseApiError` (MUT-42's `VALIDATION_FAILED`/`CONFLICT` reasons → `setError(..., {type:'manual'})` or a toast) | `ExpenseDrawer` |
| `components/Brand.tsx`, `Icons.tsx` | `Wordmark`, `LanguageSwitch` (explicit, persisted), `InfoIcon`, `AlertIcon`, `LockIcon` | sign-in, shell |
| `shell/` | `HostedShell` (nav now incl. Expenses, MUT-44), `ProfileSwitcher`, `UserMenu`, `usePopover` (the portal's twin of `useMenuButton`, which it may not import) | `ProfileLayout` |
| `session/` | `meQuery`, `profileKey(id, …)`, `useMe`, `useProfile`, `AuthGate`, `HomeRedirect`, `CaptureRedirect` (MUT-111, shares `FirstProfileRedirect` with `HomeRedirect`), `ProfileLayout`, `SessionBridge`, `endSession`, `useSignOut`, `safeNext`, `announceSignedOut` / `onSignedOutElsewhere` | router |
| `data/queries.ts` | query hooks (`useOrganizationSummary`, `useCustomerSummary`, `useCustomer`, `useCustomerDirectory`, `useProjectDirectory`, `useReceivables`, `usePayments`, `useAttachments`), `useCursorList` (exported for reuse), filter models and parsers | views, router, `data/expenseQueries.ts` |
| `components/ConversionDrawer.tsx` (MUT-161, edit/delete MUT-194) | `ConversionDrawer` (`mode?: 'create' \| 'edit'`, `conversionId`, `onDeleted`; two legs + implied rate; edit prefills from `useConversion`, PATCHes both legs at the loaded version, on 409 refetches and refills via a reset effect keyed on id + version; Delete confirms with `hosted.conversions.drawer.deleteConfirm` naming both legs via `formatDecimal`; a load error shows `Unreachable`) | `ConversionsList` |
| `components/conversionFormSchema.ts` (MUT-161, JOD MUT-194) | `conversionFormSchema` (USD/ILS/EUR/JOD, per-leg decimals by `currencyExponent`, SAME_CURRENCY), `CURRENCY_OPTIONS`, `impliedRate` | `ConversionDrawer` |
| `data/conversionQueries.ts` (MUT-161, MUT-194) | `useConversions`, `useConversion`, `conversionKey`, `useCreateConversion`, `useUpdateConversion`, `useDeleteConversion` | `ConversionsList`, `ConversionDrawer` |
| `data/expenseQueries.ts` (MUT-44) | `useExpenses`, `useExpense`, `useExpenseCategories`, `useCreateExpense`/`useUpdateExpense`/`useDeleteExpense`, `useAddReceipt`/`useDeleteReceipt` — the portal's only mutations | `ExpensesList`, `ExpenseDrawer`, `ReceiptUploader` |
| `pages/views/` | `OverviewPage`, `ClientsPage`, `ClientDetailPage`, `ReceivablesList`/`Page`, `PaymentsList`/`Page`, `DocumentsList`/`Page` (lists take `fixedCustomerId` for client tabs), `ExpensesList`/`Page` (MUT-44), `StatusBadge`, `ShowMore`, `PageHeader`, `NoMatch` | router |

### Portal sign-in request link (MUT-188)
**Location**: `src/hosted/pages/auth/SignInPage.tsx` (no new component)
**Purpose**: Under the "Can't sign in?" help line, a second `.hp-help` paragraph: "No account? Request one" → the landing's public `/hosted` page, same tab, the only link on the page, underlined (axe `link-in-text-block`: colour alone doesn't distinguish a link in running text). The address is `__HOSTED_OFFER_URL__` (hosted build only, from `MUTABA3A_PUBLIC_ORIGIN` + `HOSTED_OFFER_URL`), read at render time through a typeof guard (`hostedOfferHref()` in the page), so nothing renders where no build set it (Vitest). `hosted.html`'s `referrer=same-origin` keeps `?next=` paths off the landing host. Strings: `hosted.auth.request.{lead,link}`.
**Tests**: `src/hosted/session/__tests__/auth-states.test.tsx` (S3 zero links without the global; S3b EN/AR with it), `scripts/__tests__/vite-config.test.ts`, `scripts/__tests__/brand-head.test.ts`; QA `@portal.signin.request-link`.

### Portal income writes (MUT-133)

| Unit | Purpose |
|---|---|
| `data/incomeAffordances.ts` `incomeAffordancesFor(profile)`, `isSettleable(receivable)` | The one gate for portal income writes (personal profile only; `kinds`, `customer`, `canSettle`) and which rows the settle route accepts. Views never branch on `isPersonalDefault` themselves. |
| `data/attemptKey.ts` `useAttemptKey()` / `createAttemptKey()` | Idempotency-Key per save attempt (see PATTERNS). Used by income, settle, expense and conversion creates. |
| `data/incomeQueries.ts` `useReceivable`, `useCreateIncome`, `useSettleReceivable`, `settleMutationKey` | Fresh receivable read; income/settle writes that invalidate receivables, payments, the receivable and summaries. |
| `data/filters.ts` `parseIncomeDrawer`, `splitIncomeDrawer`, `parseReceivablesPage`, `parsePaymentsPage` | `?newIncome=` / `?settle=` URL state, parsed beside list filters. |
| `components/incomeForm.ts` `parseIncomeAmount`, `minorToDecimal`, `incomeFormSchema`, `toCreateIncomeRequest`, `settleLine`, `INCOME_CURRENCIES`, `PAYMENT_METHODS` | Income form logic; messages are i18n keys. |
| `components/incomeApiErrors.ts` `mapIncomeError`, `mapSettleError` | Server reasons → inline field errors or a toast (+ re-read hint for settle). |
| `components/IncomeCaptureDrawer.tsx` | Add income (fast path + More details, SegmentedControl kinds/method, Saved status). |
| `components/RecordPaymentDrawer.tsx` | Record payment (title with what's left, live line, honest note, skeleton, race handling). |
| `components/IncomeDrawerHost.tsx` `IncomeDrawerHost`, `focusAfterSettle`, `SETTLE_BUTTON_ATTR` | The drawers a page mounts; focus rule after a full payment. |
| `components/Toast.tsx` `show(message, { tone: 'info' })` | Info tone in a persistent polite live region; message-only calls keep the error alert. MUT-91 extends the same options object. |
| `components/HostedTable.tsx` `Column.stickyEnd` | Pins a column to the inline end (row actions on narrow windows). |
| `components/HostedTable.tsx` `linkColumn`, `canOpen` (MUT-224, eng review R5) | `linkColumn` picks which column's cell hosts the row-link (default: first; Payments uses `received` because its first cell is the expander). `canOpen(row)` false: no row-link, no `clickable`, no click handler. Inner buttons that must not open the row call `stopPropagation`. | `PaymentsList`, `ReceivablesList` |
| `components/RedateDrawer.tsx` (MUT-224) | `RedateDrawer` (`kind: 'owed' \| 'payment'`, `profile`, `id`, `onClose`, `onOpenPayment`, `onSeePayments`): date-only edit at the loaded version; refill on a new version (render-time adjustment); payment lines for a settled entry via `usePaymentsForEntry` | `IncomeDrawerHost` |
| `data/incomeAffordances.ts` `redateAffordancesFor`, `canRedateOwed`, `canRedatePayment` (MUT-224) | Profile-level re-date gate (owned + capture/payments write) and the row checks (ADJUSTMENT not VOID; own POSTED capture) | Receivables, Payments, Client detail, `IncomeDrawerHost` |
| `data/incomeQueries.ts` `usePayment`, `usePaymentsForEntry`, `useRedateOwed`, `useRedatePayment` (MUT-224) | One payment read fresh; a settled entry's payments (first 50 of the client, TD-145); the two date PATCHes, invalidating income lists, records and summaries | `RedateDrawer` |
| `components/ClientPicker.tsx`, `ProjectPicker.tsx`, `components/ui/EntityTypeahead.tsx` `id` prop | Lets a `<label htmlFor>` name the typeahead input. |
| `format/dates.ts` `todayInZone(timeZone, now?)` | Today's calendar date in an IANA zone; browser-calendar fallback for an unknown zone. |

### Profile management (MUT-183, ADR-037 amendment)

| Unit | Purpose |
|---|---|
| `shell/ProfileDrawers.tsx` | Mounts the create/manage/edit drawers for every page (ADR-008, URL-driven: `?newProfile=`/`?manageProfiles=`/`?editProfile=<id>`). Its `go()` merges the shell's own keys back into the URL rather than replacing it — the pattern `router.tsx`'s `useReplaceSearch` now also follows (qa-reconcile fix, see PATTERNS). |
| `components/ProfileCreateDrawer.tsx` | New profile: name/type (required radio cards, `ProfileTypeCards`)/currency/timezone (browser-prefilled fact row, Change reveals the select); attempt-scoped Idempotency-Key (`data/profileQueries.ts`'s `createAttempt`); disabled + "N of M" explanation at the owned-profile cap. |
| `components/ProfilesManageDrawer.tsx`, `ProfileEditForm.tsx` | One drawer, list → edit pane. The list (`hp-profile-row`) shows every profile in `me` order; owned rows are clickable, Malafat/firm rows show their reason instead. The edit pane snapshots `version` at open (`If-Match`), renames/changes currency directly, and a type change runs an inline confirm step (inline in `ProfileEditForm`, its `step: 'confirm'` — there is no separate `TypeChangeConfirm` component) against the server's uncategorized-expense preview before PATCHing. MUT-373: the pane runs form → `ProfileOwnersSection` → `FirmRequestSection` (DR1); the list closes on a leave (DR4) and ignores close while a leave/removal is pending (DR5). |
| `data/profileRules.ts` `canCreateProfile`, `profileEditability`, `profileKindKey`, `changedFields`, `firmRequestState` | The one source for "can this profile be created/edited here, and why not" and the switcher/Manage-list sub-line text (`profileKindKey`), so the two surfaces can't disagree. `profileEditability`'s non-owned reason is `'OPERATOR'` since MUT-300 D5. `firmRequestState(profile)` → `hidden \| offer \| requested` (MUT-300): only an owned, non-built-in Business profile with firm features off; hidden when an older server sends no `firm`. |
| `components/FirmRequestSection.tsx` `FirmRequestSection({ profileId })` | MUT-300 (DR1): the owner's "Use this profile for a firm" section at the foot of `ProfileEditForm`, outside its form. Reads the profile from `useMe()` (not the pane's opened copy), so Requested shows from the same source a reload would; `useRequestFirm(profileId)` (`data/profileQueries.ts`) sends an attempt-scoped Idempotency-Key and re-reads `ME_KEY`. Errors show an inline `ProfileBanner`. |
| `components/FirmOnBanner.tsx` `FirmOnBanner()`, `data/firmBanner.ts` | MUT-300 (DR5): one dismissible `.hp-banner-info` note on the Overview while `profile.firm`. The dismissal lives in localStorage under `firmBannerKey(userId, profileId)` (`mutaba3a-firm-banner:<user>:<profile>`), read/written in try/catch (the `UsagePrompt` precedent); blocked storage still shows it and Dismiss lasts for the page. Firm tickets that need a "firm on" note reuse it rather than adding another. |
| `components/ProfileOwnersSection.tsx` `ProfileOwnersSection({ profileId, onLeft, onBusyChange, onLeaveConfirmChange })` | MUT-373 (ADR-163): who owns a Business profile, in its edit pane. Rows reuse `hp-profile-row` (DR9); the creator's Remove per row, a co-owner's Leave at the foot (AD1); in-place `hp-confirm` naming the person/profile (AD2/AD3); `useRemoveProfileOwner` attempt key, pending lock, 404-as-done via `mapOwnerError` (DR5); exit-then-forget with focus handoff (DR6); the add-a-partner mailto (`data/partnerMail.ts` `mailtoFor`, DR14). Reads the profile from `useMe()`; hidden in local mode. |
| `data/profileRules.ts` `sharedWith`, `ownerLabel`, `isShared`, `createdBy`, `ownerActions`, `ownersSectionVisible`, `coOwnsOthersProfiles` | MUT-373: every co-owner rule the portal shows, from `profile.owners` (never a column). `createdBy` treats an older server's owned profile (no `owners`) as the viewer's. |
| `data/useProfileKind.ts` `useProfileKind(profile, viewerId)`, `listOfNames` | MUT-373 (DR12): the switcher/Manage-list sub-line, with "· Shared with …" from `Intl.ListFormat` in the reader's language. Replaces `t(profileKindKey(...))` at both call sites. |
| `data/firmRequestLine.ts` `requestedLine` | MUT-373 (DR13): "Requested by {name}" / "You requested this" / the plain line from an older server. |
| `session/lostAccess.ts` `useLostAccess` | MUT-373 (DR3): remembers the profile open in this tab; `ProfileLayout` redirects to the personal profile with a named banner when it drops out of `/v1/me`. `forget(id)` on a deliberate leave; reset on sign-out. |
| `format/timezones.ts` `browserTimezone`, `timezoneOptions` | Browser-detected IANA zone for the create drawer's prefill; `Intl.supportedValuesOf` with a `[zone]` fallback when unsupported, so an unlisted zone is still offered. |
| `format/currencies.ts` `HOSTED_CURRENCIES`, `HostedCurrency` | The one portal currency list, `satisfies readonly Currency[]` so a server-side addition fails typecheck here instead of silently excluding a currency. Shared by `FilterControls`, `ExpenseDrawer` and the profile forms (not yet `incomeForm.ts` — TD-125). |
| `api/client.ts` `apiErrorReason(error)` | The one `details.reason` string extractor, replacing three near-identical inline reads in the expense/conversion/income error mappers (`fieldOf` is not yet shared the same way — TD-125/TD-136). |

### Account menu (MUT-237, ADR-037 amendment)

| Unit | Purpose |
|---|---|
| `shell/AccountDrawers.tsx` | Mounts account-level drawers (`?changePassword=`), a sibling of `ProfileDrawers` so account concerns don't grow that one's unrelated scope; same `go()`/URL-merge pattern, same `ProfileDrawerSearch` key registry (one shared overlay-key set every page's `useReplaceSearch` already carries forward). |
| `analytics/portalAnalytics.ts` (MUT-155) | `usePortalUsage` (zustand: `choice` `on`/`off`/`null`/`unavailable`, `owner`), `syncPortalUsage(userId)`, `choosePortalUsage(choice, prompt)`, `endPortalUsage()`, `trackPortal(event, props)`. The only portal module that loads posthog-js (lint-enforced); it loads the SDK and `lib/analytics/posthogConfig` together, lazily, after a yes. |
| `components/UsagePrompt.tsx` (MUT-155) | The one-time "Share anonymous usage?" notice at the top of `<main>` (`hp-banner hp-banner-info`, a named `<section>`), two secondary buttons of equal weight. Renders only while the signed-in person hasn't chosen. |
| `components/UsageMenuItem.tsx` (MUT-155) | "Share anonymous usage" `menuitemcheckbox` in `UserMenu`; absent on a build with no key. |
| `components/ChangePasswordDrawer.tsx` | Current + new password, reusing `setupLink.ts`'s `passwordProblem`/`NEW_PASSWORD_POLICY` and field shape (visible rule hint, inline refusal before any request). A wrong current password is a banner (account doesn't recognise it), not a field error. |

## Hosted API modules (`server/src`) — reusable across milestones

| Module | Purpose | Reuse |
|---|---|---|
| `pagination.ts` | keyset cursor encode/decode, limit parsing, in-memory comparators | every list route and store |
| `if-match.ts` | `ifMatch()` middleware → `c.get('expectedVersion')` | every PATCH on a versioned record |
| `routes/shared.ts` | `errorResponses`, `conflictResponse`, `validationResponse`, `notFoundResponse`, `IdempotencyHeaderSchema`, `requireConnectedIntegration`, `toPageRequest`, `encodeNextCursor`, `referencesByEntity`, `versionMismatch` | all `/v1` routes |
| `import/plan.ts`, `import/preview-token.ts` | pure batch planner + preview proof | M2 import; template for M3 previews |
| `idempotency.ts`, `auth/middleware.ts` (`requireScope`) | M1 | every write / every route |
| `smoke.ts` | post-deploy checks over injected fetch | `deploy.sh`, CI |
| `dates.ts`, `vat.ts`, `preview-token.ts` | organization-timezone calendar math and payment terms; VAT math; generic preview proof | every financial route (M3+) |
| `agreements/schedule.ts`, `agreements/supplement.ts`, `agreements/status.ts`, `agreements/compose.ts`, `agreements/posting.ts`, `agreements/create.ts` | installment split; supplement distribution; item status; context/rate/treatment resolution; lazy posting (incl. healing unposted IMMEDIATE, M8); `composePreview` + `createAgreementFromPreview` + `agreementDetail` (M8: one creation path for the agreement route and the fee-proposal approve route) | agreements, installments, retainers, receivables, fee-proposals routes; M4 payments read statuses (now credit-aware) and posting |
| `retainers/schedule.ts` | chargeable months with end/cancel rules | retainers routes, reconcile |
| `payments/allocate.ts`, `payments/credit.ts`, `payments/numbering.ts`, `payments/preview-token.ts` | allocation validation + strategies + resulting balances; credit VAT split; payment numbers; balance-covering preview token | payments, receivables (credits) routes; M6 summaries will reuse `outstandingOf` and the balance shapes |
| `routes/operations.ts` | `GET /v1/operations/{key}` over `idempotency.get` | any client reconciling a lost response |
| `auth/users.ts` (MUT-37) | `normalizeEmail` (trim + NFKC + lower-case), `generateOneTimePassword` (24 base64url chars), `PasswordHasher` port + `createArgon2Hasher`, `ARGON2_MINIMUMS` (OWASP profile 1, enforced by `config.ts`) | MUT-38 sign-in verifies with the same hasher and normalises emails the same way; `generateOneTimePassword` feeds sign-in's dummy hash and the demo seed's self-set password (no operator sees one since MUT-235) |
| `routes/admin-users.ts` (MUT-37) | operator user/membership routes; `audit()` appends one ADMIN event per member organization; MUT-235: `issueSetupLink()` (create and `/setup-link` issue one-time links; `lock`) | the only way to create or change a portal user |
| `auth/account-setup.ts` (MUT-235, ADR-088) | `SETUP_LINK_POLICY` (72 h, 1–720), `NEW_PASSWORD_POLICY` (12–128, no composition rules), `generateSetupToken` (32 bytes base64url), `setupLinkState(link, person, now)` → valid / expired / used / superseded / invalid, `setupUrl(origin, token)` (token in the fragment), `SETUP_TOKEN_PATTERN` | admin user routes, `routes/account-setup.ts`, `schemas.ts` (`NewPasswordSchema`); MUT-237 reuses `NEW_PASSWORD_POLICY` |
| `routes/account-setup.ts` (MUT-235) | `POST /v1/account-setup/check` + `POST /v1/account-setup`: the only public routes besides sign-in; same-origin, sign-in IP limiter under their own key | the portal's `/setup` page (MUT-236), `seed:demo-account` |
| `AccountSetupRepository` (`repositories/ports.ts`, MUT-235) | `issue` (row-locked; cancels open links; `lock` clears the password + revokes sessions), `findByDigest`, `redeem` (claim inside the password transaction) — memory + Prisma, contract in `store-contract-account-setup.ts`; operator-only in the store guard | admin user routes, `routes/account-setup.ts` |
| `__tests__/helpers/provision.ts` (MUT-235) | `provisionUser(app, body)` (admin create + redeem with a known password), `redeemSetupLink`, `setupTokenOf`, `SETUP_TEST_PASSWORD` | every server route suite that needs a signed-in person |
| `auth/sessions.ts` (MUT-38, MUT-64) | `generateSessionToken`, `sessionDigest` (HMAC under the pepper), `sessionCookieName`, `clientIp` (trusted-hop X-Forwarded-For), `isSameOriginRequest` (CSRF rule), `SignInThrottle` + `SIGN_IN_POLICY`; MUT-64 adds `generateDeviceSessionToken`/`isDeviceSessionToken` (`mds_` prefix), `SessionKind`, `DEFAULT_DEVICE_IDLE_DAYS`/`DEFAULT_DEVICE_ABSOLUTE_DAYS` | sign-in routes, `authenticate()` |
| `auth/sign-in.ts` (MUT-64) | `signIn(c, deps, credentials, sessionKind, lifetime)` — the credential-verification core (dummy-hash timing, throttle/lockout, token generation, audit with `metadata.sessionKind`) shared by both sign-in routes; `warmDummyHash(passwordHasher)` | `routes/sessions.ts`, `routes/device-sessions.ts` |
| `auth/writability.ts` (MUT-38, MUT-39) | `WRITABILITY_MATRIX` (brief §5 as a const, incl. its "Routes covered" cell), `sessionScopes()`, `sessionAccess()`, `matrixRow`, `domainOfScope`, `mayWrite`, `writeRefusal` (READ_ONLY_PROFILE on a Malafat row, else PRINCIPAL_NOT_ACCEPTED), `profileWriterOf(store, orgId)` | session effective scopes, `GET /v1/me`, `authenticate()`, `requireScope`, the store guard |
| `expenses/*` (MUT-42) | `compose.ts` (`resolveLinks`, `requestedLinks`, `assertCategoryChoosable`, `parseExpenseAmount`, `expensePatch`, `EXPENSE_ENTITY_TYPES`, `MAX_RECEIPTS_PER_EXPENSE`), `cursor.ts` (newest-first `(occurredOn, id)` keyset), `summary.ts` (`summarizeExpenses`: per currency, by category / client), `presets.ts` (`GENERAL_PRESET`, `LAW_FIRM_PRESET`, `presetFor({ writerOfRecord, profileType }, locale)` (MUT-182: keyed on the profile type); parity-tested against `src/db/defaultExpenseCategories.ts`), `names.ts` (`categoryNameKey`) | `routes/expenses.ts`, `routes/expense-categories.ts`, both stores; MUT-44's portal form consumes the routes |
| `routes/expenses.ts`, `routes/expense-categories.ts` (MUT-42) | the 13 session-only expense operations (CRUD, receipts on the M6 flow, categories, `GET /v1/summaries/expenses`) | the portal (MUT-44) |
| `auth/store-guard.ts` (MUT-39) | `STORE_ACCESS` (every repository method classified read / control / operator / `{ write: Domain }`; typed over `LedgerStore`), `principalStoreGuard(principal, profileWriter)`, `storeRefusal`, `requestScopedStore(base)` (the store every route factory gets), `unguarded(store)` (only via `lazyPostingOf`); MUT-42 adds `{ read: Domain }` (refused where the column is `none`) and classifies the 17 expense methods | `app.ts`, `authenticate()` |
| `auth/middleware.ts` (MUT-38 rewrite, MUT-39, MUT-64) | `authenticate()` (one principal per request, routes a bearer token to the API-key or device-session verifier by prefix, enforces each route's OpenAPI `security`, sets the request's store guard, maps a session on a key-only Malafat write to READ_ONLY_PROFILE), `buildRouteAccessIndex(definitions, app.routes)` (principals + tagged scopes; `deviceSession` scheme maps to the `'session'` Principal), `requireScope` (tagged; either principal), `requiredScopeOf`, `keyAuth(c)` for key-only handlers, `sessionAuth(c)` for session-only ones (MUT-42), `lazyPostingOf(c, store)` for lazy posting in reads (`postingActorOf(c)` stays for key-only creates), `AuthContext = ApiKeyAuth \| SessionAuth` (session carries `writerOfRecord`), `c.get('identity')`; MUT-64 adds `authenticateDeviceSessionToken`/`validateSessionRecord` (shared digest/expiry/touch core) and `finishSessionAuth` (the tail both the cookie and device-bearer paths call); `SessionSettings.deviceIdleDays`/`deviceAbsoluteDays` (optional) | every /v1 route |
| `routes/sessions.ts` (MUT-38) | `POST /v1/sessions`, `DELETE /v1/sessions/current`, `GET /v1/me` (also accepts `deviceSession`, MUT-64); `ORGANIZATION_INDEPENDENT_ROUTES`; `buildMe(store, user)` exported for `routes/device-sessions.ts` | the portal (MUT-43) |
| `personal-profile.ts` `profileOwnerOf`, `profileTypeOf`, `ownedProfileCreatedAudit`, `ownedProfileUpdatedAudit` (MUT-182 qa-reconcile) | who owns a profile and its type, falling back to `personalOwnerUserId` for a MUT-120 profile the old revision wrote unstamped; the audit rows both stores write inside `createOwned`/`updateOwned` | every owned-profile guard, `hostedProfileFor`, both stores, `expense-categories` seed |
| `routes/profiles.ts` (MUT-182) | `POST /v1/profiles`, `PATCH /v1/profiles/{profileId}`, `GET /v1/profiles/{profileId}/type-change`; `MAX_OWNED_PROFILES` (6, the personal profile counted); `PROFILE_ORGANIZATION_INDEPENDENT_ROUTES` | MUT-183 (portal), MUT-184 (Flutter) |
| `serializers.ts` `hostedProfileFor(organization, writerOfRecord, userId)` (MUT-182) | the one builder for a hosted profile as `/v1/me` lists it and `/v1/profiles` returns it (access map, income rules, `isPersonalDefault`, `owned`, `type`, `version`) | `routes/sessions.ts` `buildMe`, `routes/profiles.ts` |
| `expenses/compose.ts` `withCategoryForeignKey(write)` (MUT-182) | maps the expense-category FK violation of a write that raced a type change to the validator's 422 `CATEGORY_NOT_FOUND` | expense create/update, inbox file-as-expense |
| `repositories/__tests__/fixtures/raw-rows.ts` (MUT-182) | `insertFirmRow`, `insertUserWithPersonalRow` — organization/user rows for migration tests on an older schema | `migration-mut59/61/100/182.test.ts` |
| `routes/device-sessions.ts` (MUT-64) | `POST /v1/device-sessions` (public, returns a bearer token, no cookie, no CSRF check), `DELETE /v1/device-sessions/current`; `DEVICE_SESSION_ORGANIZATION_INDEPENDENT_ROUTES` | the native app (MUT-67, not yet built) |

| `auth/sessions.ts` (MUT-38) | `generateSessionToken`, `sessionDigest` (HMAC under the pepper), `sessionCookieName`, `clientIp` (trusted-hop X-Forwarded-For), `isSameOriginRequest` (CSRF rule), `SignInThrottle` + `SIGN_IN_POLICY` | sign-in route, `authenticate()` |
| `auth/writability.ts` (MUT-38, MUT-39, MUT-65) | `WRITABILITY_MATRIX` (brief §5 as a const, incl. its "Routes covered" cell), `sessionScopes()`, `sessionAccess()`, `matrixRow`, `domainOfScope`, `mayWrite`, `writeRefusal` (READ_ONLY_PROFILE on a Malafat row, else PRINCIPAL_NOT_ACCEPTED), `profileWriterOf(store, orgId)`; MUT-65 adds `PROFILE_DEPENDENT_DOMAINS` (`customers`/`projects`/`payments`), `sessionAccessFor(domain, profileWriter)`, `sessionScopesFor(profileWriter)`, `mayWriteFor(principal, domain, profileWriter)` — the per-profile layer on top of the three, everything else routes through the unchanged static functions | session effective scopes, `GET /v1/me`, `authenticate()`, `requireScope`, the store guard |
| `expenses/*` (MUT-42) | `compose.ts` (`resolveLinks`, `requestedLinks`, `assertCategoryChoosable`, `parseExpenseAmount`, `expensePatch`, `EXPENSE_ENTITY_TYPES`, `MAX_RECEIPTS_PER_EXPENSE`), `cursor.ts` (newest-first `(occurredOn, id)` keyset), `summary.ts` (`summarizeExpenses`: per currency, by category / client), `presets.ts` (`GENERAL_PRESET`, `LAW_FIRM_PRESET`, `presetFor({ writerOfRecord, profileType }, locale)` (MUT-182: keyed on the profile type); parity-tested against `src/db/defaultExpenseCategories.ts`), `names.ts` (`categoryNameKey`) | `routes/expenses.ts`, `routes/expense-categories.ts`, both stores; MUT-44's portal form consumes the routes |
| `routes/expenses.ts`, `routes/expense-categories.ts` (MUT-42) | the 13 session-only expense operations (CRUD, receipts on the M6 flow, categories, `GET /v1/summaries/expenses`); MUT-65 threads an optional `captureSource` into `expense.created`'s audit metadata | the portal (MUT-44) |
| `income/compose.ts` (MUT-65) | `resolveIncomeLinks(store, organizationId, kind, { customerId, projectId })` (expenses/compose.ts's `resolveLinks` rule, plus "Owed requires a customer"), `dueDateForOwed(occurredOn, explicit)` (EOM_15 via the existing `dueDateFor`), `owedVatFields(amountMinor)` (always `OUT_OF_SCOPE`, zero rate), `assertNotFuture(date, today, field)` (a new, stricter check than `assertNotAbsurdDate` — see ADR-038 addendum) | `routes/income.ts`, `routes/receivables.ts`'s settle route |
| `routes/income.ts` (MUT-65) | `POST /v1/income` (Received, optionally clientless/matter-linked; Owed, a bare `ADJUSTMENT` receivable), `DELETE /v1/income/{id}` (undo: void an unsettled Owed, or reverse an unallocated Received — idempotent, never leaks another user's/profile's row) — session-only, `payments:write` | the phone capture app (MUT-68), MUT-66's inbox filing |
| `inbox/compose.ts`, `inbox/cursor.ts`, `inbox/routes-keys.ts` (MUT-66) | `parseInboxAmount(text, currency)` (positive, currency digits), `inboxDate(value)` (a valid date — deliberately NOT a future-date check: capture has no profile, so no timezone; filing applies it), `assertKind(entry, expected)` (409 `ENTRY_KIND_MISMATCH`, before any store call); `encodeInboxCursor`/`decodeInboxCursor` (keyset on `(createdAt, id)`, its own envelope key so another collection's cursor is refused); `INBOX_ORGANIZATION_INDEPENDENT_ROUTES` (the four CRUD keys, merged in `app.ts` as device-sessions' set is) | `routes/inbox.ts`, `app.ts` |
| `errors.ts` `ownedProfileConflict(organization, message)` (MUT-120 → MUT-182), `routes/admin-users.ts` `resolvePersonalSettings(request, firm)` (MUT-120) | `ownedProfileConflict`: the one way to refuse an operation on a profile a person owns — `409 CONFLICT { reason: 'PERSONAL_PROFILE' }` on the built-in personal profile, `OWNED_PROFILE` on one they created (existing code; no Malafat contract change). Used by API-key issuance, API-key authentication (so `POST /v1/integration/bind` is unreachable), the membership grant and revoke, and user creation inside an owned profile; keyed on `ownerUserId`. `resolvePersonalSettings`: the personal profile's currency/timezone — request first, else the firm's, else `null` (the route answers 422). The personal profile is named `Personal`/`شخصي` by `User.locale` and slugged `personal-<uuid>`. |
| `routes/inbox.ts` (MUT-66) | `GET`/`POST /v1/inbox`, `PATCH`/`DELETE /v1/inbox/{entryId}` (no profile header, no scope — `identity`-shaped, like `GET /v1/me`); `POST /v1/inbox/{entryId}/file-as-expense` (`expenses:write`) and `…/file-as-income` (`payments:write`), both `Idempotency-Key`-required and profile-scoped. Filing reuses `expenses/compose.ts`'s `resolveLinks`/`assertCategoryChoosable` and `income/compose.ts`'s `resolveIncomeLinks`/`dueDateForOwed`/`owedVatFields`/`assertNotFuture` verbatim — no rule is reimplemented | the phone capture app (MUT-68 keypad, MUT-69 recents/undo) |
| `auth/store-guard.ts` (MUT-39, MUT-65, MUT-66) | `STORE_ACCESS` (every repository method classified read / control / operator / `sessionOnly` / `{ write: Domain }`; typed over `LedgerStore`), `principalStoreGuard(principal, profileWriter)`, `storeRefusal` (now calls `mayWriteFor`, MUT-65), `requestScopedStore(base)` (the store every route factory gets), `unguarded(store)` (only via `lazyPostingOf`); MUT-42 adds `{ read: Domain }` (refused where the column is `none`) and classifies the 17 expense methods; MUT-65 classifies `receivables.{createAdjustment,softDeleteAdjustment,getByIdIncludingDeleted}`; MUT-66 adds the `'sessionOnly'` case (a signed-in person's own resource, on no profile and in no matrix domain) and classifies `inboxEntries` — capture `sessionOnly`, `countByUser` `operator`, the two filings keeping the `{ write: Domain }` of the record they create | `app.ts`, `authenticate()` |
| `auth/middleware.ts` (MUT-38 rewrite, MUT-39, MUT-65) | `authenticate()` (one principal per request, enforces each route's OpenAPI `security`, sets the request's store guard, maps a session on a key-only Malafat write to READ_ONLY_PROFILE), `buildRouteAccessIndex(definitions, app.routes)` (principals + tagged scopes), `requireScope` (tagged; either principal), `requiredScopeOf`, `keyAuth(c)` for key-only handlers, `sessionAuth(c)` for session-only ones (MUT-42), `actorOf(c)` for routes that accept either principal and must audit the real caller (MUT-65: `POST /v1/customers`/`/v1/projects`), `lazyPostingOf(c, store)` for lazy posting in reads (`postingActorOf(c)` stays for key-only creates), `AuthContext = ApiKeyAuth \| SessionAuth` (session carries `writerOfRecord`, now from `sessionScopesFor`), `c.get('identity')` | every /v1 route |
| `routes/sessions.ts` (MUT-38, MUT-65) | `POST /v1/sessions`, `DELETE /v1/sessions/current`, `GET /v1/me` (its `access` map now per-organization via `sessionAccessFor`); `ORGANIZATION_INDEPENDENT_ROUTES` | the portal (MUT-43) |
| `income/compose.ts` — MUT-223 additions | `isOwnProfile(organization, userId)` (`profileOwnerOf` equals the user), `isOwnCapture(payment, userId)` (POSTED `CAPTURE` this user created), `redateTo(raw, organization, now, field)` (valid date, not after the org's today) | `routes/income.ts` and `routes/payments.ts` PATCH |
| `routes/payments.ts` — `redateOwnCapture` (MUT-223) | `redateOwnCapture(store, c, payment, receivedOn)`: If-Match check on the read, `payments.redateCapture`, audit `payment.redated {from,to,version}`; the caller checks profile + ownership first | `PATCH /v1/payments/{id}`, `PATCH /v1/income/{id}` on a Received entry |
| `income/compose.ts` — MUT-61 additions | `incomeCaptureRulesFor(writer)` → `{ received, owed, customer: 'optional' \| 'linked-required' }` (the one source for `POST /v1/income` and `GET /v1/me`'s `profiles[].income`); `resolveIncomeLinks(…, rules)` now takes the rules and, under `linked-required`, requires a client with a `MALAFAT`/`CUSTOMER` ExternalReference | `routes/income.ts`, `routes/inbox.ts`, `routes/sessions.ts` |
| `payments/allocation-state.ts` (MUT-61) | `allocationStateOf({ amountMinor, allocatedMinor })` → `'unallocated' \| 'partial' \| 'allocated'` — the one definition the memory filter, the Prisma `allocationStateWhere` and the payment view follow | `serializers.ts`, `repositories/memory.ts` |
| `PaymentRepository.capture` / `.undoCapture` (MUT-61) | a person's own Received (no allocations by type, `origin: CAPTURE`); atomic undo returning `reversed \| already-reversed \| allocated \| not-found` — the `capture` row's whole write surface | `routes/income.ts` |
| `server/scripts/restore-drill.sh` (MUT-327, ADR-157) | `--project <id> [--receipt-id] [--pitr-minutes 60] [--only backup\|pitr] [--keep] [--dry-run]`, `teardown [--name]`; every mutating gcloud call goes through `mutate <scratch>` (refuses non-`mutaba3a-pg-drill-*` names and the source) | the operator, runbook §8 |
| `server/scripts/profile-rows.sh` (MUT-327, ADR-157) | `export --organization-id --out`, `restore --organization-id` (`SOURCE_DATABASE_URL` → `DATABASE_URL`), `purge-user --user-id`; profile tables from the catalog, FK order through `tsort`, `--dry-run` = one transaction rolled back | the operator through `npm run db:run --`, runbook §4.2, §7 |
| `scripts/users.ts` (MUT-37) | `runUsersCommand(argv, { fetch, url, token, out, err })` behind `npm run provision:user` / `grant:user` / `revoke:user` / `rotate:password` / `disable:user` / `enable:user` | operator CLIs; tested against `app.request` as the fetch |
| `billing/stripe/gateway.ts` (MUT-360, ADR-165) | the Stripe port `StripeGateway` (`verifyEvent`, `subscription`, `customer`, `listSubscriptions`, `listProducts`, `livemode`) and `createStripeGateway(options)` over the SDK; `STRIPE_API_VERSION` (pinned, test-tied to `Stripe.API_VERSION`); `WEBHOOK_BUDGET` (4 s, 0 retries) / `RECONCILE_BUDGET` (10 s, 2); `Fetched<T>` (`fetchedAt` = request sent); `InvalidStripeSignature`; `StripeGatewayError { code, type, requestId, transient }` and `toGatewayError` | `billing/stripe/sync.ts`, `index.ts`; MUT-362 checkout/portal sessions extend the port |
| `billing/stripe/mirror.ts` (MUT-360) | pure: `mirrorOf(sub, products)` → the `billing_subscriptions` fields plus notes (`FIRM_WITHOUT_ORG`, `UNKNOWN_ORG`) or an error (`UNKNOWN_TIER`, `UNSUPPORTED_CURRENCY`, `NO_PERIOD`); tier from `product.metadata.tier`, item-level period end; `subscriptionIdOfInvoice` (both invoice shapes), `customerIdOf` | `billing/stripe/sync.ts` |
| `billing/stripe/sync.ts` (MUT-360) | `createStripeSync({ store, webhookGateway, reconcileGateway, logger, now })` → `handleEvent` (event bookkeeping, 200/500), `syncSubscription` (the only creator of billing accounts, D6; shared by webhook and reconcile), `reconcile` (full list, 90-day prune, `ReconcileSummary`); `HANDLED_EVENT_TYPES` (9, the runbook's list); `ReconcileRunning` | `routes/stripe-billing.ts`, `app.ts`; MUT-363 (`founderUntil`) |
| `routes/stripe-billing.ts` (MUT-360, D1) | `stripeBillingRoutes({ stripe, ipLimiter, trustedProxyHops, frontDoorToken })`: `POST /v1/billing/stripe/webhook` (raw body, 256 KB, `STRIPE_WEBHOOK_POLICY` 300/min per IP), `POST /jobs/v1/billing/stripe-reconcile`, `POST /admin/v1/billing/stripe/reconcile`; `STRIPE_WEBHOOK_PATH`, `STRIPE_WEBHOOK_MAX_BYTES` | `app.ts`; the pattern for any public signed webhook |
| `routes/admin.ts` `jobAuth(jobToken)` (MUT-360, D2) | `/jobs/*` middleware: 503 `JOBS_NOT_CONFIGURED` when no token is set (never compares an empty one), else timing-safe `X-Job-Token` → 401 `JOB_UNAUTHORIZED` | `app.ts`; any future Scheduler job under `/jobs/` |
| `repositories/billing-audit.ts` (MUT-360) | `subscriptionChanged(before, after)` (mirrored fields only; `stripeUpdatedAt` is not a change), `subscriptionChangeAudit(before, after, context)` → one `billing.subscription_changed` row per profile id | `billing.saveSubscription` in both stores, inside its transaction |
| `billing/checkout.ts` (MUT-362, ADR-170) | pure: `currentSubscription(subs, now)` (what Billing shows); `planCheckout(input, person, countries, catalog)` → the Checkout Session params (minus the customer) or a refusal; `checkoutRefusalOf` (every refusal that needs no price, checked before Stripe); `catalogFrom(prices)` (a currency only with both prices in that currency and interval); `consumerCountryCheck` (D9 flag); `currencyOf`, `isReturnPath`, `GA_PRICE_LOOKUP_KEYS` / `ALL_GA_LOOKUP_KEYS`, `CHECKOUT_SUBMIT_MESSAGE` (ar + en, ≤ 1200), `CHECKOUT_SESSION_TTL_SECONDS`; `BILLING_COUNTRIES` parsed from `billing-countries.json` at import (fail fast) | `routes/billing.ts`, `routes/admin-billing.ts`, `app.ts` |
| `billing/stripe/checkout-gateway.ts` (MUT-362, ADR-170) | the write door `CheckoutGateway` (`pricesByLookupKey` with a 10-minute cache, `findOrCreateCustomer` = list by email + `metadata.mutaba3a_user_id`, else create with idempotency key `mut362-customer-<userId>-<hash(email, name)>`, `subscriptionsOf`, `expireOpenCheckouts`, `createCheckoutSession`, `createPortalSession`, `businessTaxIdCount`, `setInvoiceTaxNumber`; sells only `sellableFactOf` prices; failures cached `CATALOG_FAILURE_TTL_MS`, one call in flight) and `createCheckoutGateway(options)`; `CHECKOUT_BUDGET` (8 s, 1 retry); reuses `STRIPE_API_VERSION` / `toGatewayError` from `gateway.ts` | `routes/billing.ts`, `routes/admin-billing.ts`, `index.ts`; test fake `FakeCheckoutGateway` in `__tests__/fake.ts`; shared fake fetch `__tests__/fake-http.ts` |
| `routes/billing.ts` (MUT-362, ADR-170) | `billingRoutes(store, { checkout, countries, limiter, portalOrigin, logger })`: `GET /v1/billing`, `POST /v1/billing/checkout-session`, `POST /v1/billing/portal-session`; person-level (`BILLING_ORGANIZATION_INDEPENDENT_ROUTES`), session-only, `BILLING_SESSION_POLICY` 10/min per person; refusals are `CONFLICT`/`VALIDATION_FAILED`/`BILLING_NOT_CONFIGURED` + `details.reason`, Stripe failures `STRIPE_UNAVAILABLE` or `BILLING_ACCOUNT_NEEDS_HELP` | `app.ts` |
| `billing/stripe/__tests__/fake.ts` (MUT-360, test helper) | `FakeStripeGateway` (in-memory customers/subscriptions/products, `sign()` with the real SDK so routes verify real signatures, `failNext(count, transient)`, `calls`), `FAKE_WEBHOOK_SECRET`, `stripeObjects.{product,customer,subscription}` builders | `sync.test.ts`, `stripe-billing.test.ts`; MUT-361/362/363 tests |

---

## Visitor sample (`src/demo`) — MUT-78

- `visitorSample.ts`: `enterVisitorSample()` (seed only into a database without the person's own data; reuse a live session), `leaveVisitorSample()` (remove `demo_` rows and rows created during the session; switch the sample's areas back off), `countSessionAdditions()`.
- `sampleSession.ts`: the `localStorage` session record and `SAMPLE_QUERY_PARAM`; no database imports, so UI tests can mock `visitorSample` alone.
- `sampleSessionStore.ts`: `none | preparing | active` for the UI.
- `useVisitorSample.ts`: `useVisitorSampleEntry()` (mounted once in `AppShell`; StrictMode-safe) and `useLeaveSample()`.
- `seedData`: `seedDemoData({ announceFeatures })` returns `featuresEnabled`; `createDemoProfiles({ existingDefault })`; `dates.ts` `notAfter()`.

## Data access (`src/db`) — the seam every consumer goes through

### getRepositories() — `src/db/provider.ts`

**What**: The single entry point to the data layer. Returns a frozen
`{ base }` registry of 18 slots (MUT-47 added `dataset` and `demoData`, and
the plan slots MUT-226 removed with the retainer ones). Re-exported from the `src/db`
barrel. (Until MUT-73 it also had a `synced` family of 8 op-capturing
decorators; they were deleted with device sync, ADR-053.)

**Use it when**: you need to read or write any entity from a hook, service or
component. Do not import a repository singleton — that bypasses the seam and
cannot be swapped or mocked consistently.

```ts
import { getRepositories } from '../db';

// Resolve inside the callback, not at module scope.
queryFn: () => getRepositories().base.transactions.list(filters)
mutationFn: ({ id, paidAt }: { id: string; paidAt?: string }) =>
  getRepositories().base.transactions.markPaid(id, { paidAt })
```

**Swapping**: `setRepositories(next)` for tests and future hosted sources,
`resetRepositories()` in teardown. `setRepositories` throws in production
builds. A swap now redirects every call: the `synced` caveat in TD-013 went
with the decorators.

**Conformance**: `satisfies` in `provider.ts` ties every repository to its
interface in `src/db/interfaces.ts`. Rename or delete a repository method and
`npm run typecheck` fails there.

**Tests**: `src/db/__tests__/provider.test.ts`. To fake the data layer, mock
`'../../db'` and return `getRepositories` — the barrel is the single
interception point. `src/__tests__/noSyncModules.test.ts` asserts the registry
has only `base`.

**Coverage (MUT-47, ADR-071)**: complete. Nothing outside `src/db` imports
`db`, a repository object or a storage helper; ESLint rejects it
(`src/__tests__/seamLint.test.ts`). The one exception is `initDatabase()` in
`main.tsx`. Whole-database work is on `dataset` (`serializeBackup`,
`restoreBackup`, `exportProfile`, `importProfile`, `importLegacyV1`,
`csvValidationContext`, `importCsvRows`, `exportCoreTables`, `wipeAllData`,
`integrityCheck`, `findOrphanedRecords`, `reconcileFeaturesAfterLoad`); sample
data on `demoData`.

### Malafat OAuth client — `src/services/oauth/` and `src-tauri/src/oauth/`

**What**: The desktop's OAuth 2.1 public-client flow for a Malafat workspace (MUT-28, ADR-023):
- `oauth-pkce.ts`: S256 PKCE and state;
- `oauth-client.ts`: discovery, the authorize URL, callback parsing, token exchange and refresh, `CIMD_CLIENT_ID`, `OAUTH_LOOPBACK_PORTS`;
- `oauth-flow.ts`: `connectWorkspace`, `getValidAccessToken`, `disconnectWorkspace`, with platform calls injected.

Tokens go through `TokenStore` (`src/services/tokenStore.ts`, in memory only, TD-015). On the Rust side, `oauth/callback.rs` is the one-shot listener on 127.0.0.1, and `oauth/mod.rs` holds the three commands (`bind_oauth_callback`, `await_oauth_callback`, `cancel_oauth_callback`) and their `OAuthState`.

**Moved** out of `src/sync/transport/` and `src-tauri/src/sync/` by MUT-73 (ADR-053). Nothing changed apart from paths and comments.

**Callers**: none in the app yet (TD-075).

**Tests**:
- `src/services/oauth/__tests__/`: 74 cases, including the CIMD document check against `public/.well-known/oauth-client.json`;
- the 10 Rust tests in `callback.rs`.

---

### downloadBackup (MUT-47)
**Location**: `src/utils/backupDownload.ts`
**Purpose**: The browser half of a backup: saves what `dataset.serializeBackup()` returns as `mutaba3a-backup-v{schema}-{date}.json`. Used by Data Tools and the migration wizard.

```ts
downloadBackup(await getRepositories().base.dataset.serializeBackup());
```

### importProfileFile / findMatchingProfile (MUT-158, inside MUT-145)
**Location**: `src/db/profileImport.ts` (reached as `getRepositories().base.dataset.importProfile`; `findMatchingProfile` and the file types are re-exported from the `src/db` barrel, MUT-47)
**Purpose**: The single importer for v2 per-profile exports (Settings → Import). It creates a new profile or merges into one, re-mints every ID in one Dexie transaction, and remaps every reference: client, project and profile on transactions, plus `businessProfileId`, `clientId` and `linkedTransactionIds` on retained documents. Duplicates are found inside the target profile only. `findMatchingProfile` picks the existing profile a file belongs to (by id, or by a non-empty email on both sides).

```ts
const existing = findMatchingProfile(profiles, file);
await importProfileFile(file, existing ? { mode: 'merge', profileId: existing.id } : { mode: 'create', makeDefault: profiles.length === 0 });
```

**Tests**: `src/db/__tests__/profileImport.test.ts` (unit), `src/pages/settings/__tests__/ImportDataPage.test.tsx` (page + Export → Import round trip)

---

### Retained document schema (MUT-145)
**Location**: `src/db/retained/documentSchema.ts`
**Purpose**: Types the retained `documents`/`documentSequences` tables (ADR-029/066). Only the indexed and linking keys are typed. Nothing renders these rows; the type exists for the Dexie tables, backup and the profile export/import. Same pattern as `engagementSchema.ts` and `monthCloseSchema.ts`.

## Go hosted CTA (`src/components/layout`, `src/pages/settings`, `src/lib`) — MUT-187

### GoHostedCard — `src/components/layout/GoHostedCard.tsx`
**Purpose**: The free web app's dismissible "Go hosted" card in the sidebar footer. Reads its own due state on mount (`isGoHostedCardDue`), hides itself during a visitor sample and while a Malafat suggestion is on screen (MUT-190), fades for `GO_HOSTED_EXIT_MS` (160) on dismiss. Props: `onDismissed?()` (the sidebar moves focus). The sidebar decides where it may render (`goHostedEnabled() && !collapsed`). CSS hides it under `max-height: 640px`.
**Usage**: `{goHostedEnabled() && !collapsed && <GoHostedCard onDismissed={focusSettings} />}`

### HostedAccountEntry — `src/pages/settings/HostedAccountEntry.tsx`
**Purpose**: Settings › Businesses' "Hosted account" row: a sentence, a link to `/hosted`, and (when the build set a portal URL) "Already have an account? Sign in". No props. SettingsPage gates it with `goHostedEnabled()`. Fits any column width: `position: relative` keeps its `.sr-only` spans clipped, and its button (`.hosted-account-entry-cta`) wraps instead of widening the row (TD-141).

### MalafatSuggestionCard — `src/components/malafat/MalafatSuggestionCard.tsx`
**Purpose**: One inline Malafat suggestion (MUT-190): `role="group"` with a label, one line, a "See Malafat" new-tab link and a 44 px "Don't show this again". Holds the one upsell slot while shown (the Go hosted card steps aside); hides itself at once on dismiss or link click, then calls `onRetire()` and `onGone()` (move focus there). Props: `label`, `text`, `href` (a `malafatUrl`), `ctaLabel`, `dismissLabel`, `onRetire`, `onGone`, `variant: 'card' | 'note'`. The portal reuses it as is (MUT-191): it imports `useT` from `lib/i18n/core`, and its slot claim is harmless there.

### Portal Malafat suggestions — `src/hosted/components/MalafatPortal.tsx`
**Purpose**: MUT-191. `MalafatMenuItems({ profile })`: the account menu's link + "Show Malafat suggestions" `menuitemcheckbox` (eligible profile only). `MalafatClientsCard({ customers, query, onGone })`: Clients' C2/C3 card (ten `ACTIVE` customers, else two owned business profiles; hidden while searching or after a retire this visit; C3 quiet for a visit in which a business profile was created). `MalafatCreatedNote()`: C1 on the business profile just created, read once on arrival. Helpers in `src/hosted/data/malafatSuggestions.ts`: `portalMalafatEligible(profile)`, `isMalafatCustomer(me)`, `businessProfileCount(me)`, `retireChange(moment)`, `usePortalMalafat()`, `useChangeMalafatSuggestions()` (PATCH, writes `ME_KEY`). Session store `src/hosted/session/malafatMoments.ts` (`businessCreatedId`, `businessCreatedThisVisit`, `clientsRetiredThisVisit`, reset by `endSession`). QA helper `qa/support/portal.ts` `openSignedInPortal(page, { profiles, clients, language, path })` stubs a signed-in portal.

### MalafatClientsSuggestion — `src/pages/clients/MalafatClientsSuggestion.tsx`
**Purpose**: The Clients page's one Malafat card: `pickClientsMoment` over the working business's live clients (from the cached `useClients(undefined)`) and the live businesses; nothing until every read settles, in sample or demo data, or after a retire on this visit. ClientsPage places it only beside a non-empty list, with no search and no client open; `onGone` focuses the search box.

### MalafatEntry — `src/pages/settings/MalafatEntry.tsx`
**Purpose**: Settings › Businesses' "Mutaba3a + Malafat" row: one sentence, one link (`content: settings`), and the "Show Malafat suggestions" `Switch`. Right after a second business is added (`useMalafatMomentStore.businessAdded`) its line becomes the business-added note (same single link, `content: business-profile`); after the note goes, focus lands on the row's link. SettingsPage gates it with `malafatSuggestionsEnabled()`.

### Malafat suggestion helpers — `src/lib/malafatSuggestions.ts`, `useMalafatSuggestions.ts`, `malafatMomentStore.ts`
`MALAFAT_CLIENT_THRESHOLD`, `resolveMalafatSuggestions`, `dismissMoment` (retires `second-business` with `business-profile`), `toStored`, `pickClientsMoment`, `showBusinessAddedNote`, `shouldMarkBusinessAdded`, `malafatSuggestionsEnabled()` (web build). Hooks: `useMalafatSuggestions()` (null until loaded), `useDismissMalafatMoment()`, `useSetMalafatSuggestionsOn()` (fresh-row merged writes). Store: `businessAdded`, `markBusinessAdded`, `clearBusinessAdded`, `claimSlot`, `suggestionsShown`.

### goHosted helpers — `src/lib/goHosted.ts`
`GO_HOSTED_SNOOZE_DAYS`, `GO_HOSTED_DISMISSED_KEY`, `isGoHostedCardDue(dismissedAt, now)`, `readDismissedAt()`, `writeDismissedAt(at)`, `goHostedEnabled()`, `hostedPortalUrl()`. Reuse `goHostedEnabled()`'s typeof-guard shape for any other web-only UI (MUT-190, MUT-90) rather than a bare `__BUILD_MODE__` read.

## Expense groups (portal) — MUT-268

### SectionTabs — `src/hosted/components/SectionTabs.tsx`
**Purpose**: sub-pages of one section as underlined router links in a labelled `<nav>`, `aria-current="page"` on the lit one (17A). Props: `label`, `tabs: { to, label, exact? }[]` (`exact` for the parent route's own tab). Not a tablist: each tab is a route. `useExpensesTabs()` (ExpenseGroupsList.tsx) builds Expenses · Groups.
Tests: `src/hosted/pages/__tests__/ExpenseGroups.test.tsx` (aria-current on both routes).

### DayBars — `src/hosted/components/groups/DayBars.tsx`
**Purpose**: bar chart of `Bar[]` (from `toBars`): one button per bar in a labelled group, roving tab stop, ←/→ mirrored in RTL, Home/End, Enter/click → `onJump(bar)`; ⋯ gap labels between before/in/after; value tooltip on hover/focus flipped inward at the ends; dot for other-currency days. Heights spring via `useSpringScale`.
Tests: `components/groups/__tests__/DayBars.test.tsx`.

### CategoryBars — `src/hosted/components/groups/CategoryBars.tsx`
**Purpose**: `CategoryRow[]` as toggle buttons (`aria-pressed`) with amount · share and a width bar; `onSelect(key | undefined)`; Uncategorized muted.
Tests: `components/groups/__tests__/CategoryBars.test.tsx`.

### useSpringScale — `src/hosted/components/groups/useSpringScale.ts`
**Purpose**: paints a scaleX/scaleY before first frame, then springs changes from the presentation value on `UI_SPRING`; reduced motion = value swap + 150 ms opacity dip.

### GroupMembers — `src/hosted/components/groups/GroupMembers.tsx`
**Purpose**: members by day (day headers + rows in one tbody) and Left out (`<details>`), each row's verb from `verbFor`; rows the page removes slide out (`captureRowExit`), rows Undo brings back slide in (`playRowEnter`), focus moves to the neighbouring action. Phone: no Category column, category under the title.

### GroupDrawer / AddToGroupDrawer / InGroupsLine — `src/hosted/components/groups/`
**Purpose**: create/edit/delete a group (422 → fields; GROUP_LIMIT ends the attempt); the add-from-outside picker (pool − members, sequential saves, partial Retry); the expense drawer's "In groups" line (omitted while loading or failing).
Tests: `pages/__tests__/ExpenseGroups.test.tsx`.

### playRowEnter — `src/lib/motion/rowEnter.ts`
**Purpose**: the reverse of `captureRowExit`: a row already in its slot starts 30% toward the inline end, transparent, and settles on `UI_SPRING`; reduced motion fades only; no layout, no motion.
Tests: `src/lib/motion/__tests__/rowEnter.test.ts`.

### useMediaQuery / usePrefersReducedMotion — `src/lib/motion/mediaQuery.ts`
**Purpose**: a media query as state via `useSyncExternalStore` (false without `matchMedia`). Moved from `src/hooks` so the portal can use it; `src/hooks/usePrefersReducedMotion.ts` re-exports.

### Toast action — `src/hosted/components/Toast.tsx`
`show(message, { tone, action: { label, onAction } })`: a `.press` link-button in either tone; using it closes the toast; hover/focus holds the 6 s timer.

## Local mode (portal) — MUT-286

### useMode / useIsLocalMode / setMode — `src/hosted/session/mode.ts`
**Purpose**: the portal's mode hint (`mut-mode`: `local` | `remote`, ADR-100). `currentMode()` is the hint or the unhinted fallback (`probe` in production, `remote` pinned by `src/test/setup.ts`); `useIsLocalMode()` gates account-only UI. Tests: `session/__tests__/mode.test.ts`.

### localBackend() — `src/hosted/api/client.ts`
**Purpose**: the memoized lazy local backend (`@mut/local-backend`), for UI that needs it directly (Your data, cross-tab refresh). A failed boot is forgotten so the next call retries. Tests: `api/__tests__/client-mode.test.ts`.

### YourDataDrawer — `src/hosted/components/YourDataDrawer.tsx`
**Purpose**: Download my records (since MUT-287 a `.zip`: records.json + receipt files) / Restore from file (a zip, or a MUT-286 `.json`), signed out only, opened by `?yourData=true` from the account menu (`AccountDrawers`). Tests: `session/__tests__/local-mode.test.tsx` › Your data.
Since MUT-325 its Restore confirm also says when the file came from an account (`exportedFromAccountAt`).

### HostedYourDataDrawer — `src/hosted/components/HostedYourDataDrawer.tsx` (new, MUT-325)
**Purpose**: Your data signed in, the same `?yourData=true` drawer key (`AccountDrawers` picks by mode). Profile checklist (all ticked), the "export, not a backup" note, Download my records with a progress bar (`role=progressbar`) and Cancel (closing the drawer cancels too), and the missing-receipt-files count. Loads the export code lazily from `@mut/records-export` and passes `recordsExportTransport` (`data/recordsExportTransport.ts`). Tests: `components/__tests__/HostedYourDataDrawer.test.tsx`; QA `portal.your-data.*`.

### TrialBanner — `src/hosted/components/TrialBanner.tsx` (new, MUT-418)
**Purpose**: Overview's "N days left in your free trial · Add a card" while the person's own trial (personal profile, TRIAL ACTIVE) runs with no card. "Add a card" (only when `isSellable`) opens `?billing=true&step=subscribe`; "Hide for 3 days" stores `banner-snoozed` on the server, not offered in the last 3 days. View model: `data/trialPrompt.ts` (`trialBannerOf`, `trialWelcomeDue`, `optimisticTrialPrompt`; `TrialNotice` is the union MUT-361 extends); writes: `data/trialPromptQueries.ts` (`useAnswerTrialPrompt`). Tests: `components/__tests__/TrialWelcome.test.tsx`, `data/__tests__/trialPrompt.test.ts`; QA `portal-live.billing.trial-banner`.

### TrialWelcomeOpener — `src/hosted/shell/TrialWelcomeOpener.tsx` (new, MUT-418)
**Purpose**: in `HostedShell`, opens the first-run trial step (`?billing=true&step=welcome`, replace) for a first sign-in that didn't pass /setup's `firstRunPath`, once per page (`session/trialWelcomeOffer.ts`, reset by `endSession`; showing the step spends the offer). QA `portal-live.billing.trial-start`, `portal-selfservice.signup.review-webmail`.

### BillingDrawer — `src/hosted/components/BillingDrawer.tsx` (new, MUT-362)
**Purpose**: Settings › Billing, the account menu's drawer (`?billing=true`, signed in only, `AccountDrawers`). One `Drawer` frame for every state (loading skeleton, load error + Try again, status, Subscribe step). Status first (DR1): chip coloured by meaning (DR8), headline, the one action (Subscribe / Manage billing / Pay in Manage billing / Contact us), then both currencies' prices, the VAT sentence and the cancel rule (DR12); "open soon" without Stripe or prices (DR4/DR5). MUT-418: `?step=welcome` is the first-run trial step (Add a card now (recommended) → Subscribe by replace, Not now/close → `welcome-skipped`), and a `trialing` subscription reads "Card added. Your first charge is on <date>". Subscribe is `?step=subscribe` (DR2): country with no default (DR11, `data/countries.ts`), `RadioCards` buyer, `SegmentedControl` interval with the computed saving (DR7), contact us outside the consumer countries, the English heads-up (DR6), Continue pinned in the footer. `?checkout=success` polls `/v1/billing` and `/v1/me` every 2 s for 30 s (D4). Leaves for Stripe through `stripeNavigation.assign` (`data/billingQueries.ts`). View model: `data/billingView.ts` (`billingViewOf`, `profilesListOf`, `checkoutRouteOf`, `yearlySavingOf`, `daysLeft`). Tests: `components/__tests__/BillingDrawer.test.tsx`, `data/__tests__/billingView.test.ts`, `data/__tests__/countries.test.ts`; QA `portal.billing.open-soon`, `portal-live.billing.*`.

### Button `keepLabelWhileLoading` — `src/components/ui/Button.tsx` (MUT-362 review, DR4)
**Purpose**: opt-in busy state that keeps the label beside the spinner and the focus on the button (`aria-disabled`, clicks ignored) instead of hiding the label and disabling. Use it for a busy button the person is watching (Billing's Continue to payment and Manage billing).

### RadioCards — `src/hosted/components/RadioCards.tsx` (new, MUT-362 DR9)
**Purpose**: native radio cards (label + one-line note, arrow keys, optional disabled-with-reason card) on the `hp-type-card` styles. `ProfileTypeCards` wraps it for Personal | Business; Billing uses it for For yourself | For a business. Use it for any two-to-four-way choice that needs a note per option.

### exportHostedRecords — `src/hosted/local/hostedExport.ts` (new, MUT-325)
**Purpose**: builds the local-mode records file from the signed-in export routes: per-profile `records.json` merged, receipts fetched 4 at a time (429 waited out, two failed tries or a wrong size → left out and counted), zipped by `zipRecordsArchive`. Typed by `session/recordsExportContract.ts`. Tests: `local/__tests__/hostedExport.test.ts`, `hosted-export-parity.test.ts`, `hosted-export-large.test.ts`.

### Records-file codec — `server/src/records-file/` (new, MUT-325)
**Purpose**: the one records-file text for both modes: `codec.ts` (`encodeTagged`/`decodeTagged`, `encodeRecordsFileText`, the pulled `recordsFileChunks`, `SNAPSHOT_FIELDS`, `HOSTED_EXPORT_ORIGIN`), `export.ts` (`profileExportPages`, `localPersonOf`, `localProfileOf`, `localMembershipOf`), `local-person.ts` (`LOCAL_PERSON_EMAIL`). Local mode's `recordsFile.ts` builds on it. Tests: `server/src/records-file/__tests__/`.

### send — `src/hosted/api/client.ts` (extended, MUT-325)
**Purpose**: `request()`'s routing and error handling without reading the body, for responses read as text or bytes; `request()` is `send()` + JSON.

### ReloadToContinue — `src/hosted/pages/auth/BootScreens.tsx`
**Purpose**: the D1 screen when another tab saved this device's records with a newer build (`ApiError` code `LOCAL_FORMAT_TOO_NEW`), shown by `AuthGate`. MUT-149: `stop="CRASH"` is also the full-page crash screen (the router's `defaultErrorComponent`, and `PortalProviders`' `ErrorBoundary` fallback); each stop names its copy and button key in `STOP_COPY`. The title takes focus on mount. Tests: `observability/__tests__/crashScreens.test.tsx`.

### CrashCard — `src/hosted/components/QueryView.tsx` (new, MUT-149)
**Purpose**: a page inside a profile crashed. The router shows it in place of the page (`errorComponent` on every profile child route), so the shell stays; leaving the page clears it. `Unreachable`'s markup, one Reload, `hosted.crash` copy, never the error's text; the title takes focus. Tests: `observability/__tests__/crashScreens.test.tsx`.

### useFocusOnMount — `src/hosted/components/focusOnMount.ts` (new, MUT-149)
**Purpose**: returns a ref that is focused once on mount, for a screen that replaces the page (give the element `tabIndex={-1}`). Used by `ReloadToContinue` and `CrashCard`.

### LastResortBoundary — `src/hosted/observability/LastResortBoundary.tsx` (new, MUT-149)
**Purpose**: the portal's outermost boundary in `main.tsx`, above every provider: reuses `ErrorBoundary` with a static Arabic-then-English screen read straight from the dictionaries, and reports through the crash gate. Tests: `observability/__tests__/LastResortBoundary.test.tsx`.

### browserSentryOptions — `src/lib/observability/browserSentry.ts` (new, MUT-149)
**Purpose**: Sentry init options for a browser surface (`portal`, `landing`): the ADR-091 contract's SDK options, `dataCollection` off, and `beforeSend`/`beforeBreadcrumb` through MUT-148's `scrubEvent`; takes the surface's `dropEvent` and lazy `tags`. Types-only SDK import. Tests: `src/lib/observability/__tests__/browserSentry.test.ts`.

### ProjectPicker `canCreate` / `currency` — `src/hosted/components/ProjectPicker.tsx` (extended, MUT-318)
**Purpose**: the portal's matter field offers "Add matter: «name»" when `canCreate` (`canAddClient(profile)`), a client is chosen (`customerId`) and the client has no matter of that name; picking creates it in `currency` through `useCreateProject` (`data/projectQueries.ts`) and picks it. With no client chosen: no Add row, a polite hint (`describedBy`), and each row names its client. Used by IncomeCaptureDrawer and ExpenseDrawer. Tests: `components/__tests__/ProjectPicker.test.tsx`.

### usePendingPicks — `src/hosted/components/usePendingPicks.ts` (new, MUT-318 reconcile)
**Purpose**: holds a hosted drawer's Save while a picker's Add «name» is in flight. Returns `{ pending, track, guard }`: pass `track` as the pickers' `onCreatingChange`, `pending` to Save's disabled/aria-disabled, and wrap the form's submit in `guard(...)`. ClientPicker and ProjectPicker take `onCreatingChange`. Tests: `IncomeCaptureDrawer.test.tsx` › holds Save / Enter held; `ExpenseDrawer.test.tsx` › holds Save.

### useMatterCascade — `src/hosted/components/useMatterCascade.ts` (new, MUT-318)
**Purpose**: the hosted drawers' wiring of `useClientProjectCascade` over every client's matters (`ownerOf: customerId`); returns the client field's `flashSignal`. Tests: drawer tests (`IncomeCaptureDrawer.test.tsx` › matters).

### useClientProjectCascade — `src/lib/forms/useClientProjectCascade.ts` (moved from `src/hooks/`, MUT-318)
**Purpose**: client ↔ project cascade for any react-hook-form form; generic project type, `ownerOf` (default `clientId`), `onAutoFill`. Used by the local Income/Expense drawers and the portal's (via useMatterCascade). Tests: `src/lib/forms/__tests__/useClientProjectCascade.test.tsx`.

### EntityTypeahead `describedBy` / `flashSignal` (extended, MUT-318)
**Purpose**: `describedBy` sets the input's `aria-describedby`; `flashSignal` plays the cascade flash when it changes. Internally: read-only (never disabled) while an async pick saves, and the `create-success` pulse when a create resolves picked. ClientTypeahead (local) and ClientPicker (portal) pass `flashSignal` through. Tests: `EntityTypeahead.test.tsx` › saving and cues.

### ClientPicker `canCreate` — `src/hosted/components/ClientPicker.tsx` (extended, MUT-286)
**Purpose**: the portal's client field now offers "Add client: «name»" when `canCreate` (`canAddClient(profile)`, `data/incomeAffordances.ts`) and no client has the typed name; picking creates it through `useCreateCustomer` (`data/customerQueries.ts`) and picks it. Without `canCreate` it is unchanged. Used by IncomeCaptureDrawer and ExpenseDrawer (`canAddClient` prop). Tests: `components/__tests__/ClientPicker.test.tsx`.

## Terms of service — MUT-324 (ADR-102)

### LegalPage — `src/pages/landing/LegalPage.tsx` (new, extracted from PrivacyPolicyPage)
Landing chrome plus a dated, titled-sections legal document. `sections: { title, paragraphs[] }[]`, optional `updated`/`intro`, `after` slot, `loading` (sets `aria-busy`), and `textLanguage` (sets lang/dir on the text when it differs from the page's, as in /terms?lang; MUT-324 review). Used by `PrivacyPolicyPage` and `TermsPage`. Usage: `<LegalPage title={…} updated={…} intro={…} sections={…} />`. Tests: `PrivacyPolicyPage.test.tsx`, `TermsPage.test.tsx`.

### TermsPage — `src/pages/landing/TermsPage.tsx`
`/terms` (latest) and `/terms/<version>`: loads the frozen text through `src/content/legal/terms.ts` (`loadTerms`, `TERMS_VERSIONS`, `LATEST_TERMS_VERSION`, `termsVersionOf`), in the page language unless a portal link names one (`?lang=en|ar`, read by `legalLanguageOf`). That language applies to the text only (LegalPage `textLanguage`) and is never stored. An unknown version says so and links `/terms`, keeping `?lang`.

### legalLanguageOf — `src/content/legal/language.ts` (MUT-356)
`legalLanguageOf(search)`: the `?lang=en|ar` a link to `/terms` or `/privacy` names, or null (absent or unknown). Shared by `TermsPage` and `PrivacyPolicyPage` (lifted from MUT-324's `termsLanguageOf`). Tests: `src/content/legal/__tests__/language.test.ts`.

### useTIn — `src/lib/i18n/context.tsx` (MUT-356)
`useTIn(language | null)`: `t` over the app dictionaries for a text that names its own language, else the page's `t`. Reads dictionaries only, so the page language and the stored choice stay as they are. App and landing only (the portal has its own dictionaries). Used by `PrivacyPolicyPage` for `/privacy?lang`. Tests: `PrivacyPolicyPage.test.tsx` (`?lang`).

### termsManifest — `src/content/legal/termsManifest.ts` (Node only)
Builds `/legal/terms-versions.json` (version + sha256 per language) for the web build's `legalTermsManifest()` Vite plugin and the pin test. Never import it from page code.

### TermsUpdatePage — `src/hosted/pages/auth/TermsUpdatePage.tsx`
The portal's "We've updated our terms" step, rendered by `AuthGate` (prop `version` only) when `Me.terms.accepted === false`: read the version (new tab, `?lang` = page language), I agree (`api.acceptTerms`), Sign out, and the support line (a mailto link). It keeps the version it showed: a different one from a /v1/me refetch, or named by a 409 `TERMS_VERSION_STALE`, replaces it and shows "the terms changed". A success cancels in-flight /v1/me fetches and writes through an updater.

### termsHref / TERMS_CLIENT_RELEASE / SUPPORT_EMAIL — `src/hosted/terms.ts`
`termsHref(language, version?)` reads the `__TERMS_URL__` build define (ADR-076 typeof guard; '' when unset) and always adds `?lang=<language>`, the language the acceptance records. Used by SetupPage, TermsUpdatePage, UserMenu and SignInPage.
`TERMS_CLIENT_RELEASE` (MUT-354) is `web-v<APP_VERSION>`, the `clientRelease` SetupPage and TermsUpdatePage send with each acceptance.

### termsAcceptanceOf / termsAcceptedAudit — `server/src/terms-acceptance.ts`
The acceptance row for the current terms (sha256 by locale, surface from `Session.kind`, MUT-354 the request's `clientRelease` or null), and its `user.terms_accepted` audit on owned profiles only. Shared by the setup redeem and `POST /v1/me/terms-acceptance`.

### scrubEvent / SENTRY_RULES — `server/src/observability/sentry-scrub.ts`, `sentry-rules.ts` (MUT-148)
ADR-091's whole-event scrubber, `scrubEvent(event, surface) → event | null` (null = an ignored error), over the
contract embedded in `SENTRY_RULES`. Pure, no `node:*`: MUT-149 (portal) and MUT-150 (landing) import it as their
`beforeSend` instead of writing a second scrubber. Proven against every surface's fixtures.

### ErrorReporter / NOOP_REPORTER / runScript / shutdownAndFlush — `server/src/observability/reporter.ts` (MUT-148)
The reporting seam (see PATTERNS). `runScript(name, reporter, body)` logs, reports and sets exit code 1 on a crash,
then flushes; `shutdownAndFlush` closes, disconnects, flushes (2 s), exits. `createSentryReporter` /
`createScriptReporter` / `apiRelease` in `sentry-node.ts` build the real one.

### Mailer / createMailer / renderMail / sendPasswordNotice — `server/src/email/` (MUT-359, ADR-174)
The one way the server sends mail. `createMailer({ transport, store, logger, now, fromAddress, replyTo, limits })` →
`mailer.send({ to, template, locale, vars, idempotencyKey })` → an outcome, never a throw for an expected case.
Templates: add an id to `TEMPLATE_IDS`, its vars to `TemplateVars` (no money, no dates) and its en + ar copy to
`templates/copy.ts`; mark it in `RECOVERY_TEMPLATES` if it gets someone back into their account (it may then use
the cap's reserve), and in `RECIPIENT_CAP_EXEMPT` only if it is credential-gated. Transports:
`createResendTransport`, `createLogTransport`, `MemoryMailTransport` (also the dev outbox), `NOOP_TRANSPORT`.
`verifySvixSignature` (`svix.ts`) and `suppressionsFrom` (`resend-webhook.ts`) serve the webhook.
`sendPasswordNotice(mailer, logger, person, { first, signInLink, requestId })` is the template for a post-commit
notice. Tests: `server/src/email/__tests__/`.

### selfServiceRoutes / SELF_SERVICE_POLICY / createTurnstileVerifier — `server/src/routes/self-service.ts`, `server/src/auth/{self-service,turnstile}.ts` (MUT-366, ADR-175)
`selfServiceRoutes({ store, settings, mailer, logger, options })` mounts `POST /v1/signups` and
`POST /v1/account-recovery`; `defaultSelfServiceOptions()` gives the production budgets with signup off.
`SELF_SERVICE_POLICY` holds the link lives, budgets and floors; `signupLinkState`, `recoveryPurposeOf`,
`signupAccountOutcome` (MUT-367's seam), `defaultDisplayName` and `answerNoEarlierThan` are the pure rules.
`createTurnstileVerifier({ secret, fetch?, timeoutMs?, logger? })` → `verify(token, { ip, action, idempotencyKey })`;
`UNCONFIGURED_TURNSTILE` refuses everything. Reuse the verifier for any other public form (MUT-197's landing form).
Tests: `server/src/auth/__tests__/{self-service,turnstile}.test.ts`, `server/src/__tests__/routes-self-service.test.ts`.

### createDomainScreen / DomainChecker / CachedDomainChecker — `server/src/email/domains/` (MUT-367, ADR-178)
- **`createDomainScreen({ checker, now, logger }).screen(email)`** returns `refused` (`disposable`, `no-mail`) or `classified` (`domain`, `domainClass` BUSINESS | BUSINESS_UNVERIFIED | WEBMAIL, `reasons`).
- **Checkers:**
  - `createDnsDomainChecker({ rdap, resolver?, budgetMs? })`: DNS plus `createRdapClient({ fetch, now })`;
  - `createFixtureDomainChecker(now)`: the `FIXTURE_DOMAINS` table;
  - `new CachedDomainChecker(inner, { now })`: 24 h / 10 min.
- **`classifyDomainFacts(facts, now)`** is the pure rule.
- **Lists:**
  - `loadDomainList('disposable' | 'free-webmail' | 'relay')`;
  - `isListedDomain(domain, list)` (matches parents too);
  - `parseDomainList(text)` (throws on a bad line).
- **Reuse:** reuse the screen for any other place that must judge an address (MUT-306 invites).
- **Tests:** `server/src/email/domains/__tests__/`.

### createReviewDigest / adminSignupReviewRoutes — `server/src/email/review-digest.ts`, `server/src/routes/admin-signup-reviews.ts` (MUT-367)
- **`createReviewDigest({ store, mailer, logger, now, to }).announce()`:** at most one `review-digest` per UTC hour, only for reviews not yet announced, serialised. `msUntilNextSweep(now)` aligns the timer.
- **`adminSignupReviewRoutes({ store, mailer, logger, settings, supportAddress })`** mounts list, approve and decline under `/admin/v1/signup-reviews`.
- **Store:** `store.signupReviews` (list, findByUser, digestFacts, markNotified, approve, decline), operator-only.
- **Tests:** `server/src/email/__tests__/review-digest.test.ts`, `server/src/__tests__/routes-signup-review.test.ts`, `store-contract-signup-reviews.ts`.


### AuthLayout / EmailLinkForm / CheckEmailNotice / UnderReviewNotice / SignedOutOnly — `src/hosted/pages/auth/` (MUT-368, ADR-179)
- **`AuthLayout`:** the frame of every signed-out page (language switch, wordmark, `<main>`). Sign-in, /setup, /signup, /recover and the under-review screen use it; a new signed-out page does too.
- **`EmailLinkForm({ action, title, lead, submitLabel, initialEmail, send, onSent, onClosed?, children? })`:** email + Turnstile + one button. It maps refusals through `selfServiceFailure` (`selfService.ts`, pure) and keeps the email. A press before the token waits for it. Reuse it for any public "mail me a link" form.
- **`CheckEmailNotice({ title, body, sentAt, onSendAgain })`:** the one answer screen, with Send again after `SEND_AGAIN_COOLDOWN_MS`. `SentenceWithEmail` puts an address inside translated text, isolated in `<bdi>`.
- **`UnderReviewNotice({ onLeave })`:** the under-review screen. Its Sign out ends a real session if one exists, else calls `onLeave`.
- **`SignedOutOnly`:** sends a signed-in person Home (asks the server only in remote mode).
- **Tests:** `src/hosted/pages/auth/__tests__/{SignupPage,RecoverPage,SignInPage,SetupPage,selfService}.test.ts(x)`.

### loadTurnstile / useTurnstile / TurnstileWidget — `src/hosted/components/turnstile/` (MUT-368)
- **`loadTurnstile()`:** Cloudflare's script once per page (explicit render, `onload` hook, 15 s give-up, retried after a failure).
- **`useTurnstile({ action, language, load?, onToken? })`** returns `{ containerRef, token, status: 'loading'|'ready'|'failed', reset, retry }`. It renders again on an action or language change, and removes the widget on unmount. Call `reset()` after every answer; tokens are single-use.
- **`TurnstileWidget`:** the reserved box plus the failure line (Try again, support address).
- **Reuse:** the landing's request form (MUT-197) can reuse the loader and hook.
- **Tests:** `components/turnstile/__tests__/`. Page tests use `src/hosted/__tests__/turnstile.ts` (`fakeTurnstile('pass'|'hold'|'fail')`).

### TimezoneChoice / useSelfServiceDoors / firstRunPath (MUT-368)
- **`TimezoneChoice`** (`src/hosted/components/`): a new profile's zone as "<zone> (this browser) · Change", then the full list. Used by New profile and the SIGNUP setup page.
- **`useSelfServiceDoors()` / `selfServiceQuery`** (`src/hosted/session/selfServiceDoors.ts`): `GET /v1/self-service`, once per page; a failure reads as closed.
- **`firstRunPath(me)`** (`src/hosted/session/firstRun.ts`): where a new account lands. MUT-418 adds its trial step here.
- **QA:** `qa/support/{selfservice-live.mjs,selfService.ts,turnstile.ts}` (the `portal-selfservice` app). `stubTurnstile(page, 'pass'|'fail')` answers Cloudflare's script for any spec.
