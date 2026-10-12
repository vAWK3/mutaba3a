# COMPONENT_REGISTRY.md — Reusable Components

> **Purpose**: Document all reusable components to prevent duplication.
> **Rule**: Check this registry before creating any new component.

---

## Quick Lookup

| Category | Components |
|----------|------------|
| **Layout** | AppShell, SidebarNav, TopBar, PageHeader, FeatureNoticeBanner, ClientRetainersCard, ClientWorkSection, ClientPaymentsSection |
| **Drawers** | TransactionDrawer, ClientDrawer, ProjectDrawer, ExpenseDrawer, RecurringMarkPaidDrawer, RetainerDrawer, DocumentDrawer, BusinessProfileDrawer, OrphanedRecordsDrawer, PartialPaymentDrawer (Record payment) |
| **Forms** | Input, Select, StepperInput, DatePicker, CurrencyInput, Textarea, Switch |
| **Buttons** | Button, IconButton, RowActionsMenu, RecordPaymentButton |
| **Table headers** | SortableHeader, RowActionsHeader |
| **Display** | Card, Badge, StatusBadge, EmptyState |
| **Home** | HomeNeedsAttention, HomeRecentPayments (with OwedNowSummary) |
| **Expenses** | RecurringAttentionList (+ `recurringAttention` helpers), RecurringOccurrenceCard (read-only, forecast) |
| **Tables** | DataTable, CellAmount, CellStatus, CellDate |
| **Filters** | DateRangeControl, SearchInput, StatusSegment, TypeSegment, CurrencyTabs, useIncomeFilters (URL model for /income) |
| **Feedback** | Toast, Modal, ConfirmModal |
| **Money** | OwedNowSummary, partitionOwedNow (helper), clients index muted rows, CurrencyAmounts, UnifiedAmount, AmountWithConversion, CurrencySummaryPopup, FxRateReadout (top bar), CurrencyBadge |
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
- **Shape (MUT-15, ADR-034):** `coreItems` (Home, Clients, Income) render first with no header and never depend on a flag; `optionalItems` render the "More" section with only the enabled areas, in the order Expenses, Documents, Retainers, Insights, Planning, Projects; `systemItems` (Settings) sit in the footer, never gated.
- New menu: actions and order from `visibleAddMenuActions(flags)`; `newMenuEntries` maps each to its label and icon.
- **Footer (MUT-79):** Settings and `ThemeToggle` share `.sidebar-footer-row` (stacked on the 64px rail).

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

The `+ Add` menu renders `visibleAddMenuActions(useFeatureFlags())` (Income, Client, then Expense/Project while on; MUT-15) with `useMenuButton` keyboard behaviour; `addMenuEntries` maps each action to its label and icon. The right side starts with `FxRateReadout` on every page (MUT-79), whether or not the Add menu is shown.

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

Core actions first, optional appended, so a switch never moves a core entry. Each menu maps an `AddMenuAction` to its own label, icon and click behaviour. Tests: `layout/__tests__/addMenuActions.test.ts` (all 64 flag combinations keep Income, Client first).

---

### usePrefersReducedMotion
**Location**: `src/hooks/usePrefersReducedMotion.ts`
**Purpose**: `true` when the OS asks for reduced motion, kept in step via `useSyncExternalStore` over `matchMedia('(prefers-reduced-motion: reduce)')`; `false` where `matchMedia` doesn't exist. Use it in JS-driven motion (springs, count-ups) to skip or cross-fade; CSS should use the media query directly.

```ts
const reduced = usePrefersReducedMotion();
```

Tests: `src/hooks/__tests__/usePrefersReducedMotion.test.ts`.

### detectDevice / currentDevice
**Location**: `src/lib/platform.ts`
**Purpose**: Pure `detectDevice({ userAgent, platform, maxTouchPoints })` → `'mac' | 'windows' | 'ios' | 'android' | 'linux' | 'unknown'`, telling an iPad from a Mac and Android from Linux; `currentDevice()` reads `navigator`. Used by the landing hero, `DownloadPage` and `MacDownloadBanner` (MUT-79, which removed the substring checks `isMacOS`/`isWindows`/`isLinux`, TD-049). Cannot tell Intel from Apple Silicon.

### MacDownloadBanner / UpdateBanner (frame bars)
**Location**: `src/components/ui/MacDownloadBanner.tsx`, `UpdateBanner.tsx`
**Purpose**: The app's bottom bars, rendered after the page inside `<main>`. They are in flow (`margin-top: auto`), not fixed, so they never cover content (MUT-79). The Mac bar shows when `currentDevice() === 'mac'`, the app is not in Tauri, and `localStorage.hideDownloadBanner` isn't set; storage errors are ignored. The update bar is desktop only (`role="status"`). Settings' own update card is `.settings-update-card`, not `.update-banner`.

Tests: `src/components/ui/__tests__/MacDownloadBanner.test.tsx`, `src/components/__tests__/UpdateBanner.test.tsx`.

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
**Purpose**: One-time, dismissible notice naming the optional areas that were switched on for the user's existing data (v20 upgrade, restore, import, demo, sync). Mounted once in `AppShell` above the page content; renders nothing when `Settings.featureNotice` is empty; clears the notice on dismiss (MUT-12, ADR-032).

```tsx
<FeatureNoticeBanner />   // no props; reads useFeatureNotice()
```

Tests: `src/components/layout/__tests__/FeatureNoticeBanner.test.tsx`.

---

### AdvancedFeaturesSection
**Location**: `src/pages/settings/AdvancedFeaturesSection.tsx`
**Purpose**: Settings › Advanced features — one `Switch` per `FEATURE_KEYS` entry, labels and descriptions from `settings.features.items.*`. Reads `useFeatureFlags()`, writes `useSetFeatureEnabled()`; never touches the settings row.

```tsx
<AdvancedFeaturesSection />   // rendered by SettingsPage between Currency and Data
```

Tests: `src/pages/settings/__tests__/AdvancedFeaturesSection.test.tsx`.

---

### DataToolsSection
**Location**: `src/pages/settings/DataToolsSection.tsx`
**Purpose**: Settings › Data Tools: integrity check (`runIntegrityCheck`), JSON backup export/import (`exportBackup` / `restoreFromBackup`) and the receipts ZIP. Every message comes from `integrity.*` or `settings.*`. The check's result is kept as numbers (`{ total, issues }`) and worded at render, so it follows a language switch.

```tsx
<DataToolsSection />   // rendered by SettingsPage below the main settings
```

Tests: `src/pages/settings/__tests__/DataToolsSection.test.tsx`.

---

### ClientRetainersCard
**Location**: `src/components/clients/ClientRetainersCard.tsx`
**Purpose**: Retainer status for one client, below Payments on the client profile (MUT-13; the Summary tab it first lived in is gone with MUT-3): list of the client's retainers (status badge, next expected date, due now) with **New retainer** (`openRetainerDrawer({ mode: 'create', defaultClientId })`) and **View all** (`/retainers?clientId=`). The page renders it only while `useFeatureEnabled('retainers')` is true.

```tsx
{retainersEnabled && <ClientRetainersCard clientId={client.id} />}
```

Tests: `src/pages/clients/__tests__/ClientDetailPage.test.tsx` ("Advanced-feature entry points").

---

### ClientWorkSection
**Location**: `src/components/clients/ClientWorkSection.tsx`
**Purpose**: "What have I worked on for this client?" on the client profile (MUT-3): the client's income entries as one table — date, title with project tag, amount, status with due/overdue line, remaining balance on partial rows — with its own filter row (date range, status, search held as one object) and the row actions (Record payment via `RecordPaymentButton`, Mark paid, invoice actions while Invoices is on, duplicate). No work at all → `EmptyState` with one action, Add income, prefilled with the client; filters that hide every row → "No entries match" + Clear filters. Rows are shaped by `toWorkRow` (`clientProfileRows.ts`) in a `useMemo`.

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
**Purpose**: One landing chapter — a big line, a short paragraph and one visual, with `flip` to put the visual first. Renders `<section data-part aria-labelledby>`; the page-structure test reads `data-part`.

```tsx
<ChapterSection part="chapter-clients" title={t('…title')} body={t('…body')} visual={<ClientProfileMock />} />
```

### Landing mock-ups (`ClientProfileMock`, `RecordPaymentMock`, `ProfileSwitcherMock`)
**Location**: `src/pages/landing/components/mocks/`
**Purpose**: Static HTML pictures of the product for the landing page. Data comes from `src/pages/landing/sampleData.ts` (fixed dates, i18n-keyed names, never the visitor's database); labels are the app's own i18n keys; money and dates format through `useMockFormat` (`formatAmount` / `formatDateShort` in the active locale). Keep them in step with the real screens when those change.

### ClientsListMock + CountUpAmount (hero)
**Location**: `src/pages/landing/components/mocks/ClientsListMock.tsx`, `CountUpAmount.tsx`
**Purpose**: The hero's picture of the Clients list (brief L5/L6). Totals come from `sampleOwedTotals(SAMPLE_CLIENTS)` so they always equal the rows. `CountUpAmount` counts an amount up once via `useCountUp` (skipped under reduced motion), lays the final value out invisibly so the width never changes, and gives screen readers the final value only.

### heroCta (`chooseHeroCta`, `secondaryHeroLink`)
**Location**: `src/pages/landing/heroCta.ts`
**Purpose**: Pure rule for the hero's one filled button: mac → Mac download, windows → Windows download only when the release has it, anything else → web app; the text link is the browser for a download and the desktop apps for the web app.

### GetItSection / PrivacyBand / PlatformIcons
**Location**: `src/pages/landing/components/`
**Purpose**: `GetItSection` lists every way to get the app and gates each download on `useLatestRelease()` (ADR-041); `PrivacyBand` says privacy once; `PlatformIcons` holds the Apple/Windows/browser glyphs shared by the hero and Get it. Download URLs live in `src/content/download-config.ts` (`DOWNLOAD_URLS`, `WEB_APP_URL`), shared with `DownloadPage`.

Tests: `src/pages/landing/__tests__/`.

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
**Tests**: `src/components/ui/drawer/__tests__/` (`DrawerFrame`, `drawerGesture`, `exitSnapshot`); `qa/specs/web/drawer-motion.spec.ts`.

### Motion physics and focusables (MUT-80)
- `src/lib/motion/physics.ts`: `springFromResponse(response, dampingRatio)`, `projectMomentum(velocity, rate = 0.998)`, `rubberband` / `rubberbandInverse`, `velocityFromSamples(samples, windowMs = 100)`. Reuse these for anything draggable or flickable.
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
editPaymentRecord({ transactionId, paymentRecordId });          // edit one recorded payment
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

**Props**: `transactionId`, `onClose`. MUT-82 opens it the same way.

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

### RetainerDrawer
**Location**: `src/components/drawers/RetainerDrawer.tsx`
**Purpose**: Create/edit retainer agreements.

**Features**:
- Monthly/quarterly cadence
- Payment day selection
- Start/end date
- Client/project linking

---

### RetainerMatchingDrawer
**Location**: `src/components/drawers/RetainerMatchingDrawer.tsx`
**Purpose**: Match transactions to projected income from retainers.

**Features**:
- Smart matching suggestions
- Score breakdown display
- Partial match support

---

### DocumentDrawer
**Location**: `src/components/drawers/DocumentDrawer.tsx`
**Purpose**: Quick view/actions for documents.

**Note**: Full document editing is in `/documents/:id/edit` page.

---

### BusinessProfileDrawer
**Location**: `src/components/drawers/BusinessProfileDrawer.tsx`
**Purpose**: Create/edit business profiles.

**Features**:
- Logo upload (base64)
- Tax settings
- Bank details
- Default currency/language

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
**Location**: `src/components/ui/Select.tsx`
**Purpose**: Dropdown select with consistent styling.

```tsx
<Select
  label="Currency"
  options={[
    { value: 'USD', label: 'US Dollar' },
    { value: 'ILS', label: 'Israeli Shekel' },
  ]}
  {...register('currency')}
/>
```

---

### StepperInput
**Location**: `src/components/ui/StepperInput.tsx`
**Purpose**: Numeric input with increment/decrement buttons.

```tsx
<StepperInput
  label="Quantity"
  min={1}
  max={100}
  step={1}
  value={quantity}
  onChange={setQuantity}
/>
```

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
&& (remainingAmountMinor ?? 0) > 0`. A `lockedAt` transaction is deliberately
**not** excluded -- paying an invoice is the normal flow (ADR-030).

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

**Used by**: ClientWorkSection (client profile work list, MUT-3), IncomePage,
ProjectDetailPage.
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

**Used by**: ClientsPage. ProjectsPage still uses a sort dropdown and can adopt this.
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
**Purpose**: "Who is late?" (MUT-8). It renders `useAttentionReceivables(undefined, profileId)` as is: overdue or due within 7 days (inclusive), every currency, oldest due date first, ties by client name then id. Each row shows the client (or "No client"), what it was for, the remaining amount in its own currency, and "Nd overdue", "Due in Nd" or "Due today". Rows are shaped with `toWorkRow`, so bucketing uses the ADR-010/022 helpers. A row opens the client profile, or the entry's income drawer when there is no client. The empty state reads "No overdue or upcoming receivables".

```tsx
<HomeNeedsAttention profileId={profileId} />
```

### HomeRecentPayments
**Location**: `src/components/home/HomeRecentPayments.tsx`
**Purpose**: "What came in?" (MUT-8). It renders `useRecentPayments(profileId)`, the last 10 payments across clients from `paymentRecordRepo.listRecent`. These are the same payment rows as a client's Payments section (ADR-033), so they include income saved as Received. Each row shows the client, what it was for, the date and the amount in its own currency; nothing is totalled. A row opens the client profile, or the entry when there is no client.

```tsx
<HomeRecentPayments profileId={profileId} />
```

Tests: `src/pages/overview/__tests__/OverviewPage.test.tsx`; data in `transactionRepo.test.ts` ("as Home's Needs attention") and `paymentRecords.test.ts` (`listRecent`).

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

**Extend, don't copy**: a new `/income` filter is one more field in `IncomeSearch`, `parseIncomeSearch` and `resolveIncomeFilters`. `useTransactionFilters` is a `useState` model with no URL and no current consumer; it is not this.
**Tests**: `src/lib/__tests__/incomeSearch.test.ts`, `src/hooks/__tests__/useIncomeFilters.test.tsx` (real memory router), `src/pages/income/__tests__/IncomePage.test.tsx`.

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

### TypeSegment
**Location**: `src/components/filters/TypeSegment.tsx`
**Purpose**: Transaction type filter.

```tsx
<TypeSegment
  value={kind}
  onChange={setKind}
  options={['all', 'income', 'expense']}
/>
```

---

### CurrencyTabs
**Location**: `src/components/filters/CurrencyTabs.tsx`
**Purpose**: Currency selection tabs.

```tsx
<CurrencyTabs
  value={currency}
  onChange={setCurrency}
  currencies={['USD', 'ILS', 'EUR']}
  showAll={true}
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

### ConfirmModal
**Location**: `src/components/modals/ConfirmModal.tsx`
**Purpose**: Confirmation dialog with standard layout.

```tsx
<ConfirmModal
  open={isOpen}
  onClose={handleClose}
  onConfirm={handleDelete}
  title="Delete Transaction"
  description="This action cannot be undone."
  confirmLabel="Delete"
  variant="danger"
/>
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
**Not**: `CurrencySummaryPopup`, `UnifiedAmount` or `KpiCard`, which all convert to ILS.
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

**Reads built on them**: `clientSummaryRepo.listOwedIndex({ profileId, search })` → `ClientOwedIndex`, through the `useClientOwedIndex(profileId, search)` hook (key `['clientSummaries', 'owedIndex', …]`).
**Tests**: `src/db/__tests__/aggregations.test.ts`, `src/db/__tests__/clientOwedIndex.test.ts` (parity with Home).

---

### Clients index muted rows (`toOwedBucketRows`, `orderClientIndex`, `BUCKET_SCOPE`)
**Location**: `src/components/clients/clientIndexRows.ts`
**Purpose**:
- `toOwedBucketRows(index)` turns an index's `noClient` and `archivedClients` into the muted rows to show, in fixed order, dropping a bucket that owes nothing.
- `orderClientIndex(rows, buckets, field, dir)` returns the display order: clients sorted by the chosen column (ADR-035), then the muted rows, which never take part in the sort.
- `BUCKET_SCOPE` maps a bucket to the `/income` client scope it opens.

**Tests**: `src/components/clients/__tests__/clientIndexRows.test.ts`.

---

### CurrencyAmounts
**Location**: `src/components/ui/CurrencyAmounts.tsx` (+ `.css`); entries from `orderCurrencyAmounts` in `src/lib/currencyAmounts.ts`
**Purpose**: Amounts in several currencies side by side, one `<bdi dir="ltr">` per currency, never converted or combined (ADR-004), like Owed now but without its label and overdue lines (MUT-87). `orderCurrencyAmounts(totals)` keeps the non-zero currencies in USD → ILS → EUR order; its order is a `Record<Currency, number>`, so a new currency without a place fails to compile.

```tsx
<CurrencyAmounts amounts={orderCurrencyAmounts({ USD: 24000, ILS: 350000 })} />
// $240  ₪3,500
```

**Use when**: a total or a header figure covers several currencies (the Expenses Needs attention total). **Not**: `OwedNowSummary` for Owed now itself; `UnifiedAmount` / `CurrencySummaryPopup`, which convert. The Expenses page's "Total expenses" strip still uses `CurrencySummaryPopup`, and sums the wrong table (reported with MUT-87, not changed).
Tests: through `RecurringAttentionList.test.tsx`; the helper in `src/lib/__tests__/currencyAmounts.test.ts`.

---

### UnifiedAmount
**Location**: `src/components/ui/UnifiedAmount.tsx`
**Purpose**: Display multi-currency totals (USD + ILS + EUR) as unified ILS amount with breakdown.

```tsx
<UnifiedAmount
  usdAmountMinor={1999}
  ilsAmountMinor={5000}
  eurAmountMinor={1500}
  variant="kpi"  // 'default' | 'compact' | 'kpi' | 'table'
  type="income"  // 'income' | 'expense' | 'net' | 'neutral'
/>
// KPI variant: ₪95.50 with breakdown "USD: $19.99 + ILS: ₪50.00 + EUR: €15.00"
// Table variant: ₪95.50 with hover tooltip showing breakdown
```

**Use when**: Displaying aggregated totals from multiple currencies (summaries, KPIs).

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
  DocumentIcon,
  SettingsIcon,
  SyncIcon,
} from '@/components/icons';
```

**Usage**:
```tsx
<Button icon={<PlusIcon />}>Add</Button>
<IconButton icon={<CloseIcon />} label="Close" />
```

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
| Retainer components | Retainers | 2024-10 |
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
| `src/components/expenses/` (**shared**, MUT-44; `RecurringAttentionList` and `recurringAttention` there are app-only, MUT-87) | `ExpenseFormFields<T>` (presentational: amount/currency/date/title/category/notes, vendor/client/project as host-supplied slots, `amountInputMode: 'number' \| 'decimalText'`), `expenseFormFieldsSchema`, `DECIMAL_AMOUNT` | local `ExpenseDrawer`, hosted `ExpenseDrawer` |
| `api/client.ts` | `api.*` (one function per operation, now incl. expense CRUD + categories + summary + receipt start/complete/download/delete), `request` (GET/POST/PATCH/DELETE, `idempotencyKey`/`ifMatchVersion` options), `ApiError` (`status`, `code`, `details`, `retryAfterSeconds`), `setUnauthorisedHandler`, schema type aliases | every portal hook and page |
| `format/DecimalAmount.tsx` | `DecimalAmount` (`<bdi dir="ltr">`), `formatDecimal(value, currency, language)`, `isZeroDecimal` | every money cell and strip |
| `format/dates.ts` | `formatDay` (calendar date, never shifted), `formatInstant` (in the organization's zone), `formatSize`, `todayLocalISO` (MUT-44, browser-local calendar date — the expense drawer's default `occurredOn`) | views |
| `components/QueryView.tsx` | `QueryView` (loading / empty / error / populated; a view in error renders no data; a 404 re-checks `/v1/me`), `Unreachable`, `Skeleton`, `Empty` (now takes `action`) | every view |
| `components/HostedTable.tsx` | `HostedTable<Row>` (`columns`, pre-shaped `rows`, `rowKey`, `label`, optional `detail` row, optional `onRowClick` — MUT-44, opt-in, reuses `Table.css`'s `.clickable`) | every list |
| `components/FilterControls.tsx` | `ClientFilter`, `MatterFilter`, `CategoryFilter` (MUT-44), `CurrencyFilter`, `SelectFilter`, `DateFilter`, `FilterBar` (labelled) | list views |
| `components/ReadOnlyNotice.tsx` | `ReadOnlyNotice` (reads `profile.access` and `writerOfRecord`, `role="note"`) | income views |
| `components/Toast.tsx` | `ToastProvider`, `useToast` (one `role="alert"` message) | sign-out failure, download failure, expense save conflicts/network errors (MUT-44) |
| `components/Drawer.tsx` (MUT-44) | `Drawer` (title/onClose/children/footer/closeLabel; Escape + overlay-click close) on the app's `.drawer`/`.drawer-overlay` classes from shared `src/index.css` — not an import of `src/components/drawers/Drawer.tsx` | `ExpenseDrawer` |
| `components/ExpenseDrawer.tsx` (MUT-44) | `ExpenseDrawer` (create/edit, `ExpenseFormFields` + pickers + vendor text + `ReceiptUploader`, MUT-42 error-code → field/toast mapping) | `ExpensesList` |
| `components/ClientPicker.tsx`, `ProjectPicker.tsx` (MUT-44) | `EntityTypeahead` fed by the read-only `useCustomerDirectory`/`useProjectDirectory`; no create-new branch (MUT-42 D6: existing org records only) | `ExpenseDrawer` |
| `components/ReceiptUploader.tsx` (MUT-44) | `ReceiptUploader` (start → PUT the signed URL → complete; PDF/JPEG/PNG, 10 MB, 10-receipt cap counting only READY) | `ExpenseDrawer` (edit mode only) |
| `components/expenseApiErrors.ts` (MUT-44) | `applyExpenseApiError` (MUT-42's `VALIDATION_FAILED`/`CONFLICT` reasons → `setError(..., {type:'manual'})` or a toast) | `ExpenseDrawer` |
| `components/Brand.tsx`, `Icons.tsx` | `Wordmark`, `LanguageSwitch` (explicit, persisted), `InfoIcon`, `AlertIcon`, `LockIcon` | sign-in, shell |
| `shell/` | `HostedShell` (nav now incl. Expenses, MUT-44), `ProfileSwitcher`, `UserMenu`, `usePopover` (the portal's twin of `useMenuButton`, which it may not import) | `ProfileLayout` |
| `session/` | `meQuery`, `profileKey(id, …)`, `useMe`, `useProfile`, `AuthGate`, `HomeRedirect`, `ProfileLayout`, `SessionBridge`, `endSession`, `useSignOut`, `safeNext`, `announceSignedOut` / `onSignedOutElsewhere` | router |
| `data/queries.ts` | query hooks (`useOrganizationSummary`, `useCustomerSummary`, `useCustomer`, `useCustomerDirectory`, `useProjectDirectory`, `useReceivables`, `usePayments`, `useAttachments`), `useCursorList` (exported for reuse), filter models and parsers, `downloadNavigator` | views, router, `data/expenseQueries.ts` |
| `data/expenseQueries.ts` (MUT-44) | `useExpenses`, `useExpense`, `useExpenseCategories`, `useCreateExpense`/`useUpdateExpense`/`useDeleteExpense`, `useAddReceipt`/`useDeleteReceipt` — the portal's only mutations | `ExpensesList`, `ExpenseDrawer`, `ReceiptUploader` |
| `pages/views/` | `OverviewPage`, `ClientsPage`, `ClientDetailPage`, `ReceivablesList`/`Page`, `PaymentsList`/`Page`, `DocumentsList`/`Page` (lists take `fixedCustomerId` for client tabs), `ExpensesList`/`Page` (MUT-44), `StatusBadge`, `ShowMore`, `PageHeader`, `NoMatch` | router |

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
| `auth/users.ts` (MUT-37) | `normalizeEmail` (trim + NFKC + lower-case), `generateOneTimePassword` (24 base64url chars), `PasswordHasher` port + `createArgon2Hasher`, `ARGON2_MINIMUMS` (OWASP profile 1, enforced by `config.ts`) | admin user routes; MUT-38 sign-in verifies with the same hasher and normalises emails the same way |
| `routes/admin-users.ts` (MUT-37) | operator user/membership routes; `audit()` appends one ADMIN event per member organization | the only way to create or change a portal user |
| `auth/sessions.ts` (MUT-38, MUT-64) | `generateSessionToken`, `sessionDigest` (HMAC under the pepper), `sessionCookieName`, `clientIp` (trusted-hop X-Forwarded-For), `isSameOriginRequest` (CSRF rule), `SignInThrottle` + `SIGN_IN_POLICY`; MUT-64 adds `generateDeviceSessionToken`/`isDeviceSessionToken` (`mds_` prefix), `SessionKind`, `DEFAULT_DEVICE_IDLE_DAYS`/`DEFAULT_DEVICE_ABSOLUTE_DAYS` | sign-in routes, `authenticate()` |
| `auth/sign-in.ts` (MUT-64) | `signIn(c, deps, credentials, sessionKind, lifetime)` — the credential-verification core (dummy-hash timing, throttle/lockout, token generation, audit with `metadata.sessionKind`) shared by both sign-in routes; `warmDummyHash(passwordHasher)` | `routes/sessions.ts`, `routes/device-sessions.ts` |
| `auth/writability.ts` (MUT-38, MUT-39) | `WRITABILITY_MATRIX` (brief §5 as a const, incl. its "Routes covered" cell), `sessionScopes()`, `sessionAccess()`, `matrixRow`, `domainOfScope`, `mayWrite`, `writeRefusal` (READ_ONLY_PROFILE on a Malafat row, else PRINCIPAL_NOT_ACCEPTED), `profileWriterOf(store, orgId)` | session effective scopes, `GET /v1/me`, `authenticate()`, `requireScope`, the store guard |
| `expenses/*` (MUT-42) | `compose.ts` (`resolveLinks`, `requestedLinks`, `assertCategoryChoosable`, `parseExpenseAmount`, `expensePatch`, `EXPENSE_ENTITY_TYPES`, `MAX_RECEIPTS_PER_EXPENSE`), `cursor.ts` (newest-first `(occurredOn, id)` keyset), `summary.ts` (`summarizeExpenses`: per currency, by category / client), `presets.ts` (`GENERAL_PRESET`, `LAW_FIRM_PRESET`, `presetFor(writer, locale)`; parity-tested against `src/db/defaultExpenseCategories.ts`), `names.ts` (`categoryNameKey`) | `routes/expenses.ts`, `routes/expense-categories.ts`, both stores; MUT-44's portal form consumes the routes |
| `routes/expenses.ts`, `routes/expense-categories.ts` (MUT-42) | the 13 session-only expense operations (CRUD, receipts on the M6 flow, categories, `GET /v1/summaries/expenses`) | the portal (MUT-44) |
| `auth/store-guard.ts` (MUT-39) | `STORE_ACCESS` (every repository method classified read / control / operator / `{ write: Domain }`; typed over `LedgerStore`), `principalStoreGuard(principal, profileWriter)`, `storeRefusal`, `requestScopedStore(base)` (the store every route factory gets), `unguarded(store)` (only via `lazyPostingOf`); MUT-42 adds `{ read: Domain }` (refused where the column is `none`) and classifies the 17 expense methods | `app.ts`, `authenticate()` |
| `auth/middleware.ts` (MUT-38 rewrite, MUT-39, MUT-64) | `authenticate()` (one principal per request, routes a bearer token to the API-key or device-session verifier by prefix, enforces each route's OpenAPI `security`, sets the request's store guard, maps a session on a key-only Malafat write to READ_ONLY_PROFILE), `buildRouteAccessIndex(definitions, app.routes)` (principals + tagged scopes; `deviceSession` scheme maps to the `'session'` Principal), `requireScope` (tagged; either principal), `requiredScopeOf`, `keyAuth(c)` for key-only handlers, `sessionAuth(c)` for session-only ones (MUT-42), `lazyPostingOf(c, store)` for lazy posting in reads (`postingActorOf(c)` stays for key-only creates), `AuthContext = ApiKeyAuth \| SessionAuth` (session carries `writerOfRecord`), `c.get('identity')`; MUT-64 adds `authenticateDeviceSessionToken`/`validateSessionRecord` (shared digest/expiry/touch core) and `finishSessionAuth` (the tail both the cookie and device-bearer paths call); `SessionSettings.deviceIdleDays`/`deviceAbsoluteDays` (optional) | every /v1 route |
| `routes/sessions.ts` (MUT-38) | `POST /v1/sessions`, `DELETE /v1/sessions/current`, `GET /v1/me` (also accepts `deviceSession`, MUT-64); `ORGANIZATION_INDEPENDENT_ROUTES`; `buildMe(store, user)` exported for `routes/device-sessions.ts` | the portal (MUT-43) |
| `routes/device-sessions.ts` (MUT-64) | `POST /v1/device-sessions` (public, returns a bearer token, no cookie, no CSRF check), `DELETE /v1/device-sessions/current`; `DEVICE_SESSION_ORGANIZATION_INDEPENDENT_ROUTES` | the native app (MUT-67, not yet built) |

| `auth/sessions.ts` (MUT-38) | `generateSessionToken`, `sessionDigest` (HMAC under the pepper), `sessionCookieName`, `clientIp` (trusted-hop X-Forwarded-For), `isSameOriginRequest` (CSRF rule), `SignInThrottle` + `SIGN_IN_POLICY` | sign-in route, `authenticate()` |
| `auth/writability.ts` (MUT-38, MUT-39, MUT-65) | `WRITABILITY_MATRIX` (brief §5 as a const, incl. its "Routes covered" cell), `sessionScopes()`, `sessionAccess()`, `matrixRow`, `domainOfScope`, `mayWrite`, `writeRefusal` (READ_ONLY_PROFILE on a Malafat row, else PRINCIPAL_NOT_ACCEPTED), `profileWriterOf(store, orgId)`; MUT-65 adds `PROFILE_DEPENDENT_DOMAINS` (`customers`/`projects`/`payments`), `sessionAccessFor(domain, profileWriter)`, `sessionScopesFor(profileWriter)`, `mayWriteFor(principal, domain, profileWriter)` — the per-profile layer on top of the three, everything else routes through the unchanged static functions | session effective scopes, `GET /v1/me`, `authenticate()`, `requireScope`, the store guard |
| `expenses/*` (MUT-42) | `compose.ts` (`resolveLinks`, `requestedLinks`, `assertCategoryChoosable`, `parseExpenseAmount`, `expensePatch`, `EXPENSE_ENTITY_TYPES`, `MAX_RECEIPTS_PER_EXPENSE`), `cursor.ts` (newest-first `(occurredOn, id)` keyset), `summary.ts` (`summarizeExpenses`: per currency, by category / client), `presets.ts` (`GENERAL_PRESET`, `LAW_FIRM_PRESET`, `presetFor(writer, locale)`; parity-tested against `src/db/defaultExpenseCategories.ts`), `names.ts` (`categoryNameKey`) | `routes/expenses.ts`, `routes/expense-categories.ts`, both stores; MUT-44's portal form consumes the routes |
| `routes/expenses.ts`, `routes/expense-categories.ts` (MUT-42) | the 13 session-only expense operations (CRUD, receipts on the M6 flow, categories, `GET /v1/summaries/expenses`); MUT-65 threads an optional `captureSource` into `expense.created`'s audit metadata | the portal (MUT-44) |
| `income/compose.ts` (MUT-65) | `resolveIncomeLinks(store, organizationId, kind, { customerId, projectId })` (expenses/compose.ts's `resolveLinks` rule, plus "Owed requires a customer"), `dueDateForOwed(occurredOn, explicit)` (EOM_15 via the existing `dueDateFor`), `owedVatFields(amountMinor)` (always `OUT_OF_SCOPE`, zero rate), `assertNotFuture(date, today, field)` (a new, stricter check than `assertNotAbsurdDate` — see ADR-038 addendum) | `routes/income.ts`, `routes/receivables.ts`'s settle route |
| `routes/income.ts` (MUT-65) | `POST /v1/income` (Received, optionally clientless/matter-linked; Owed, a bare `ADJUSTMENT` receivable), `DELETE /v1/income/{id}` (undo: void an unsettled Owed, or reverse an unallocated Received — idempotent, never leaks another user's/profile's row) — session-only, `payments:write` | the phone capture app (MUT-68), MUT-66's inbox filing |
| `inbox/compose.ts`, `inbox/cursor.ts`, `inbox/routes-keys.ts` (MUT-66) | `parseInboxAmount(text, currency)` (positive, currency digits), `inboxDate(value)` (a valid date — deliberately NOT a future-date check: capture has no profile, so no timezone; filing applies it), `assertKind(entry, expected)` (409 `ENTRY_KIND_MISMATCH`, before any store call); `encodeInboxCursor`/`decodeInboxCursor` (keyset on `(createdAt, id)`, its own envelope key so another collection's cursor is refused); `INBOX_ORGANIZATION_INDEPENDENT_ROUTES` (the four CRUD keys, merged in `app.ts` as device-sessions' set is) | `routes/inbox.ts`, `app.ts` |
| `routes/inbox.ts` (MUT-66) | `GET`/`POST /v1/inbox`, `PATCH`/`DELETE /v1/inbox/{entryId}` (no profile header, no scope — `identity`-shaped, like `GET /v1/me`); `POST /v1/inbox/{entryId}/file-as-expense` (`expenses:write`) and `…/file-as-income` (`payments:write`), both `Idempotency-Key`-required and profile-scoped. Filing reuses `expenses/compose.ts`'s `resolveLinks`/`assertCategoryChoosable` and `income/compose.ts`'s `resolveIncomeLinks`/`dueDateForOwed`/`owedVatFields`/`assertNotFuture` verbatim — no rule is reimplemented | the phone capture app (MUT-68 keypad, MUT-69 recents/undo) |
| `auth/store-guard.ts` (MUT-39, MUT-65, MUT-66) | `STORE_ACCESS` (every repository method classified read / control / operator / `sessionOnly` / `{ write: Domain }`; typed over `LedgerStore`), `principalStoreGuard(principal, profileWriter)`, `storeRefusal` (now calls `mayWriteFor`, MUT-65), `requestScopedStore(base)` (the store every route factory gets), `unguarded(store)` (only via `lazyPostingOf`); MUT-42 adds `{ read: Domain }` (refused where the column is `none`) and classifies the 17 expense methods; MUT-65 classifies `receivables.{createAdjustment,softDeleteAdjustment,getByIdIncludingDeleted}`; MUT-66 adds the `'sessionOnly'` case (a signed-in person's own resource, on no profile and in no matrix domain) and classifies `inboxEntries` — capture `sessionOnly`, `countByUser` `operator`, the two filings keeping the `{ write: Domain }` of the record they create | `app.ts`, `authenticate()` |
| `auth/middleware.ts` (MUT-38 rewrite, MUT-39, MUT-65) | `authenticate()` (one principal per request, enforces each route's OpenAPI `security`, sets the request's store guard, maps a session on a key-only Malafat write to READ_ONLY_PROFILE), `buildRouteAccessIndex(definitions, app.routes)` (principals + tagged scopes), `requireScope` (tagged; either principal), `requiredScopeOf`, `keyAuth(c)` for key-only handlers, `sessionAuth(c)` for session-only ones (MUT-42), `actorOf(c)` for routes that accept either principal and must audit the real caller (MUT-65: `POST /v1/customers`/`/v1/projects`), `lazyPostingOf(c, store)` for lazy posting in reads (`postingActorOf(c)` stays for key-only creates), `AuthContext = ApiKeyAuth \| SessionAuth` (session carries `writerOfRecord`, now from `sessionScopesFor`), `c.get('identity')` | every /v1 route |
| `routes/sessions.ts` (MUT-38, MUT-65) | `POST /v1/sessions`, `DELETE /v1/sessions/current`, `GET /v1/me` (its `access` map now per-organization via `sessionAccessFor`); `ORGANIZATION_INDEPENDENT_ROUTES` | the portal (MUT-43) |
| `scripts/users.ts` (MUT-37) | `runUsersCommand(argv, { fetch, url, token, out, err })` behind `npm run provision:user` / `grant:user` / `revoke:user` / `rotate:password` / `disable:user` / `enable:user` | operator CLIs; tested against `app.request` as the fetch |

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
`{ base, synced }` registry covering 21 repositories plus 8 op-capturing
decorators. Re-exported from the `src/db` barrel.

**Use it when**: you need to read or write any entity from a hook, service or
component. Do not import a repository singleton — that bypasses the seam and
cannot be swapped or mocked consistently.

```ts
import { getRepositories } from '../db';

// Resolve inside the callback, not at module scope.
queryFn: () => getRepositories().base.transactions.list(filters)
mutationFn: ({ id, paidAt }: { id: string; paidAt?: string }) =>
  getRepositories().synced.transactions.markPaid(id, { paidAt })
```

**base vs synced**: `base` is the plain Dexie repository. `synced` additionally
captures an operation in the sync op-log. Keep whichever family a call site
already used — moving a call between them changes what syncs between devices.

**Swapping**: `setRepositories(next)` for tests and future hosted sources,
`resetRepositories()` in teardown. `setRepositories` throws in production
builds. Caveat: `synced.*` does not follow a swap — see TD-013
(`gstack-shortcut(dec-5f2c2123)`).

**Conformance**: `satisfies` in `provider.ts` ties every repository to its
interface in `src/db/interfaces.ts`. Rename or delete a repository method and
`npm run typecheck` fails there.

**Tests**: `src/db/__tests__/provider.test.ts`. To fake the data layer, mock
`'../../db'` and return `getRepositories` — the barrel is the single
interception point.

**Not covered**: `planRepo`, `planAssumptionRepo`, `planScenarioRepo`,
`scheduleGenerator` and `retainerMatching`. `engagementRepo` is gone with the
module (MUT-10). `moneyEventRepo` survived MUT-11 only because the old Overview
read it; once MUT-8 deleted those components it had no reader, and MUT-58
deleted it with `useMoneyEventQueries` (ADR-036 §3). See TODOS.md item 2.
