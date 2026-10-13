# Settings Information Architecture Reorg

> **Status:** Proposed
> **Date:** 2026-10-13
> **Problem:** Settings has duplicate controls, missing spec'd sections, and fragmented groupings that make it unpredictable where a given setting lives.

---

## Executive Summary

`/settings` grew section-by-section as features shipped, without anyone revisiting placement. The result: Theme exists in two places with no sync, two of the three documented Currency items were never built (one is commented-out dead code), Data management is split across two non-adjacent sections that look like duplicates, and app-info content is fragmented into three siblings that are really one topic. None of this is a visual problem — it's that the IA doesn't reflect a single coherent model of "where does X live."

**Core Principle:** One setting, one place; one topic, one group — proximity and consistency drive placement, not the order features happened to ship in.

This is a planning/IA document only. No implementation code is included or implied as approved; scope and priority below are inputs to a follow-up implementation plan.

---

## Problem Statement

### Current section order

Language → Theme → Business Profiles → Currency → Advanced features → Data → About → Updates → Desktop App → Data Tools

Plus two sub-routes: `/settings/profiles/$profileId` (Profile Info / Document Numbering / Document Defaults / Payment Details tabs) and `/settings/import`.

### Specific defects

1. **Theme is a duplicate control.** A full Theme section exists on `/settings` (`SettingsPage.tsx:236`) *and* a separate `ThemeToggle` lives in the sidebar footer (`SidebarNav.tsx:279`). Two live controls for one piece of state — nothing guarantees they read the same way, and a user has no way to know which one is "the" setting.

2. **Currency section is two-thirds unbuilt against spec.** CLAUDE.md's Settings spec calls for "Enabled currencies, default currency tab" and "FX settings (manual rates) for converted reports." Today only "Default currency" is live; "Enabled currencies" is commented-out dead code (`SettingsPage.tsx:322-338`), and FX configuration doesn't exist anywhere — the only FX-related UI is a read-only live-rate readout in the TopBar (`FxRateReadout`), which can't be used to set a manual rate.

3. **Data management is split into two non-adjacent, overlapping sections.** "Data" (Export / Import / Delete all data) sits at position 6. "Data Tools" (Integrity check, JSON backup export, JSON backup import, Receipts ZIP export) is bolted on after About/Updates/Desktop App at position 10. "Export" vs. "Backup export" and "Import" vs. "Import Backup" read as duplicates of each other when they're this far apart, even though they're different flows.

4. **About/Updates/Desktop App are three siblings for one topic.** All three are "information and distribution about the app" but are presented as three independent top-level sections instead of one grouped topic with subsections.

5. **Label collision between global and per-profile defaults.** `/settings` has "Language" and "Currency" (interface locale / default display currency). `/settings/profiles/$profileId` → Document Defaults tab has "Default Language" and "Default Currency" (locale/currency used on that profile's documents). Identical words, different scope, no indication anywhere of which one governs an actual invoice.

6. **"Advanced features" is structurally heavier than its position implies.** It toggles which top-level nav sections exist at all (expenses, invoices, retainers, insights, planning, projects) and cascades into redirects when a section is disabled. It sits flat among Theme and Currency with no separation signaling that it reshapes the whole app nav — only its name ("Advanced") hints at the weight, and naming alone isn't a reliable wayfinding signal.

7. **No breadcrumb out of the import wizard.** `/settings/import` has a page title but no `Settings ›` breadcrumb, unlike `/settings/profiles/$profileId` which does show one. A user mid-wizard has no in-page path back to Settings, only browser-back or the sidebar link.

---

## Design Principles

1. **One setting, one place** — no control should exist in two locations with independent state.
2. **Proximity reflects relationship** — sections that answer the same user question ("how do I back up my data," "what is this app") group together, adjacent, not scattered by the order they were built.
3. **Build what's documented, or update the doc** — CLAUDE.md's Settings spec (Enabled currencies, FX settings) is either implemented or explicitly descoped with a decision log entry; it should not silently sit half-built.
4. **Weight should be visible in placement, not just naming** — a setting with cascading, structural consequences (Advanced features) gets separation proportional to its blast radius.
5. **Every nested screen answers "how do I get out"** — breadcrumbs are consistent across every settings sub-route, not just some.

---

## Proposed Information Architecture

```
/settings
├─ Business Profiles        (moved to top — nothing else here is meaningful without one)
│   └─ /settings/profiles/$profileId
│        ├─ Profile Info
│        ├─ Document Numbering
│        ├─ Document Defaults   (relabel scope explicitly, see Gap 5 below)
│        └─ Payment Details
│
├─ Preferences
│   ├─ Language
│   └─ Theme                 (sidebar ThemeToggle removed or made a mirror of this single source)
│
├─ Currency & Exchange Rates
│   ├─ Default currency      (existing)
│   ├─ Enabled currencies    (restored from commented-out code)
│   └─ FX rates (manual)     (new — closes the CLAUDE.md spec gap)
│
├─ Advanced Features         (kept as its own anchor, not merged into Preferences —
│                              its structural/cascading impact warrants separation)
│
├─ Data
│   ├─ Export / Import (full data)
│   ├─ Backup / Restore (JSON)
│   ├─ Export receipts (ZIP)
│   ├─ Integrity check
│   └─ Delete all data        (danger, stays last within the group)
│
└─ About
    ├─ App info + version
    ├─ Updates (check / available-update status)
    ├─ Get the app (Desktop App download links)
    └─ Support (Buy Me a Coffee / Ko-fi)
```

`/settings/import` gains a `Settings ›` breadcrumb, matching the pattern already used by `/settings/profiles/$profileId`.

---

## Specific Gap Fixes

### Gap 1 — Theme duplicate control
Pick one source of truth. Recommended: keep Theme in Settings → Preferences as the configurable control; either remove the sidebar `ThemeToggle` or make it a quick-action that reads/writes the same state (not a second independent toggle).

### Gap 2 — Currency section incomplete vs. spec
- Restore "Enabled currencies" (currently commented out).
- Design and add a manual FX rate entry under the new "Currency & Exchange Rates" group — this is a net-new sub-feature, not a placement change, and needs its own data-model note (effective date per rate, per CLAUDE.md's "All Converted" honesty rules) before implementation.

### Gap 3 — Data section fragmentation
Merge "Data" and "Data Tools" into one "Data" group with the five subgroups listed in the proposed IA above. No new functionality — purely consolidating two sections that already exist into one.

### Gap 4 — About/Updates/Desktop App fragmentation
Merge into one "About" group with Updates and Desktop App as subsections within it, per the proposed IA.

### Gap 5 — Label collision (global vs. per-profile defaults)
Scope the per-profile tab's labels explicitly so they can't be mistaken for the global Settings controls — e.g. "This profile's document language" / "This profile's document currency" rather than bare "Default Language" / "Default Currency." This is a labeling/wayfinding fix within the existing tab, not a new control.

### Gap 6 — Advanced Features placement
Keep as a distinct top-level section (not folded into Preferences), positioned after Currency & Exchange Rates and before Data, so its structural weight (nav-shape-changing) isn't flattened next to cosmetic preferences like Theme.

### Gap 7 — Missing breadcrumb on `/settings/import`
Add the same `Settings › Import Data` breadcrumb pattern already implemented for the profile detail page.

---

## Non-Goals

- No visual/styling changes — this is placement and grouping only.
- No new Data Tools functionality beyond what exists today (the merge is structural, not feature work).
- FX manual-rate entry is scoped here only as "this is where it lives"; its UI, validation, and storage design are a separate follow-up design brief before implementation.

---

## Implementation Priority

| Priority | Item | Effort | Impact |
|----------|------|--------|--------|
| P0 | Merge Data + Data Tools into one group (Gap 3) | Small | High — removes an apparent duplicate |
| P0 | Resolve Theme duplicate control (Gap 1) | Small | High — eliminates state-sync risk |
| P1 | Merge About/Updates/Desktop App (Gap 4) | Small | Medium |
| P1 | Move Business Profiles to top of page order | Small | Medium |
| P1 | Add breadcrumb to `/settings/import` (Gap 7) | Small | Medium |
| P2 | Relabel per-profile Document Defaults fields (Gap 5) | Small | Medium — prevents misconfiguration |
| P2 | Restore "Enabled currencies" control (Gap 2a) | Medium | Medium |
| P3 | Design + build manual FX rate entry (Gap 2b) | Large | High — closes a real spec gap, but needs its own design pass |

---

## Success Metrics

1. **Every setting has exactly one location** — no control exists twice with independently-readable state.
2. **Settings matches CLAUDE.md's documented spec**, or the spec is explicitly amended with a decision log entry if something is intentionally descoped.
3. **No section reads as a duplicate of another** — Data and About each present as one coherent group.
4. **Every settings sub-route has a breadcrumb back out.**
5. **No label is reused across two different scopes without disambiguating text.**

---

## Engineering Plan (eng-ticket pass, 2026-10-13)

> Ground-truth check against the actual code and tests (not assumption) corrected and narrowed the plan below before any implementation. Jira: MUT-139.

### Correction to Gap 1 (Theme duplicate) — DROPPED FROM SCOPE

Investigation found this is not a defect. `.claude/COMPONENT_REGISTRY.md` and `.claude/TEST_PLAN.md` confirm the sidebar `ThemeToggle` and the Settings → Theme section already read/write the exact same `useTheme()` state (MUT-79), and it's tested both ways (`ThemeToggle.test.tsx`, `themeModes.test.ts`: "the toggle cycles System → Light → Dark, and Settings → Theme agrees both ways"). This is an intentional, documented, tested pattern — a quick-access control plus a detail view sharing one source of truth — not two independent controls. **No code change for Theme.**

### Hard constraint found: no h3 subheadings allowed

`SettingsPage.a11y.test.tsx` asserts `expect(screen.queryAllByRole('heading', { level: 3 })).toEqual([])` — every settings section title must be an h2, flat, no nested subheadings. This rules out "merge sections with an h3 per subgroup" as an approach anywhere in this ticket.

### Finalized file-level plan

1. **`SettingsPage.tsx`** — reorder top-level sections to: Business Profiles → Language → Theme → Currency → Advanced Features → About (merged, see #4) → Data → `<DataToolsSection />`. Data and `DataToolsSection` land as the last two things on the page (Basel's call, 2026-10-13: proximity fix must cost zero visual change, so About moves up instead of Data Tools moving into the width-capped container — see constraint below).
2. **Restore "Enabled currencies"** (`SettingsPage.tsx:322-338`, commented out since the initial commit — dead code, never a deliberate recent removal). Uncomment `handleCurrencyToggle` as written, wire to the existing `settings.currency.enabled`/`enabledDesc` keys (already present in both `en.json` and `ar.json` — restoring dead code, not adding a new feature). USD/ILS only, matching `ProfileDetailPage`'s existing "Allowed Currencies" checkbox scope — do not add EUR here.
   - **Known gap, not fixed here:** if `enabledCurrencies` ever contains `EUR` (only reachable via JSON import of legacy data, no live UI path sets it), there's no button to turn it off — the toggle only renders USD/ILS. Pre-existing, never-shipped gap, not a regression. Log as a TECH_DEBT.md entry, don't solve in this ticket.
3. **`DataToolsSection` stays a separate component with its own heading** (do not merge into "Data" — `DataToolsSection.test.tsx` renders it standalone and asserts its own `settings.dataTools` heading; merging would break that test for no real gain). Proximity is achieved purely by making Data the last section before it in the page order (#1), not by touching `DataToolsSection.tsx` or its render container at all — it keeps rendering outside the `page-content` div's inline `maxWidth: 600`, exactly as today, so there is zero visual/width change.
4. **Merge "About", "Updates", "Desktop App" into one `<h2>` section.** These three have no standalone component tests (only covered by `SettingsPage.a11y.test.tsx`'s heading-presence list), so merging is low-risk. Extract to a new `AboutSection.tsx` (matching the existing `AdvancedFeaturesSection.tsx` / `DataToolsSection.tsx` split pattern — `SettingsPage.tsx` is 534 lines). Updates' and Desktop App's existing rows (`settings.updates.*`, `settings.desktopApp.*` keys, unchanged) become additional `.settings-row` entries under the one "About" heading — no subheading element; their row labels ("Up to date: v0.0.65", "Download for Mac/Windows") are already self-descriptive. `useCheckForUpdates()` moves into the new component.
5. **`ImportDataPage.tsx`** — add a `Settings ›` breadcrumb to its `TopBar`, matching `ProfileDetailPage.tsx`'s exact pattern: `breadcrumbs={[{ label: t('nav.settings'), href: '/settings' }, { label: t('settings.data.import') }]}`.
6. **`ProfileDetailPage.tsx`**, Document Defaults tab (`activeTab === 'currency'`) — rename the two colliding field labels from "Default Currency"/"Default Language" to "Document Currency"/"Document Language" as a plain hardcoded string edit. The whole file is already non-i18n'd (pre-existing, untracked tech debt, out of scope to fix wholesale here) — a literal string change matches the file's current convention rather than introducing one-off i18n keys into an otherwise hardcoded file.
7. **Out of scope, explicitly:** manual FX rate entry (brief's P3). Currency section keeps its title "Currency" — do not rename to "Currency & Exchange Rates" until that feature exists; renaming now would claim config that isn't there (a "lying button," per the expense-routing-ux-redesign brief's own principle).

### Tests (TDD — update/add before implementing)

- `SettingsPage.a11y.test.tsx`: update the hardcoded expected h2 list — drop `en.settings.updates.title` and `en.settings.desktopApp.title`, keep `en.settings.about.title` and `en.settings.profile.title`. Keep the `level: 3` zero-count assertion as a hard regression guard against reintroducing subheadings. Add an assertion locking in the new section DOM order (Business Profiles first, Data + Data Tools last).
- New coverage (same file, matching its existing convention) for the restored enabled-currencies toggle: toggling a currency off updates `enabledCurrencies`; can't disable the last remaining currency.
- New `AboutSection.test.tsx` covering the merged About/Updates/Desktop App rows (moved out of the a11y file's current inline coverage).
- `DataToolsSection.test.tsx`: unchanged — it never moves as a component, only its position in `SettingsPage.tsx`'s render order changes.

### New TECH_DEBT.md entry to file alongside this work

"Enabled-currencies toggle (Settings) has no control for a currency outside USD/ILS (e.g. EUR) that reached `enabledCurrencies` via JSON import — can't be disabled from the UI. Never shipped live before MUT-139 restored the toggle, so not a regression. Fix: either derive the toggle's currency list from the `Currency` union directly, or validate/strip unsupported currencies on import."

---

## References

- CLAUDE.md: Settings route spec ("Enabled currencies, default currency tab," "FX settings (manual rates)," "Data export/import")
- CLAUDE.md: Drawer-first UX rule (unaffected by this IA change — Settings is not drawer-based today and this brief doesn't propose making it one)
- Current implementation: `src/pages/settings/SettingsPage.tsx`, `src/pages/settings/ProfileDetailPage.tsx`, `src/pages/settings/ImportDataPage.tsx`, `src/pages/settings/AdvancedFeaturesSection.tsx`, `src/pages/settings/DataToolsSection.tsx`, `src/components/layout/SidebarNav.tsx`, `src/components/layout/TopBar.tsx` (`FxRateReadout`)
- Apple Design skill principles applied: Familiarity/consistency (one control, one place), Grouping & Mapping (proximity implies relationship), Wayfinding (where am I / how do I get out), Simplicity (common path first, advanced one level deeper)
