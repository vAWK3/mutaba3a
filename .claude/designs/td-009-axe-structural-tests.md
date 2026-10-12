# TD-009 — Structural axe violations on the core surfaces: test plan

- **Debt:** TD-009 (accessibility audit) · **Follows:** the e2e port-over (TD-004), which baselined `KNOWN_AXE_VIOLATIONS`, and MUT-79, which already fixed `landmark-no-duplicate-banner`
- **Scope:** every rule in `KNOWN_AXE_VIOLATIONS` except `color-contrast`, which stays with MUT-74's palette work
- **Files:** `src/components/drawers/__tests__/Drawer.test.tsx`, `src/hosted/components/__tests__/Drawer.test.tsx`, `src/components/filters/__tests__/DateRangeControl.test.tsx`, `src/components/ui/__tests__/RowActionsHeader.test.tsx`, `src/pages/settings/__tests__/SettingsPage.a11y.test.tsx`, `src/pages/settings/__tests__/AdvancedFeaturesSection.test.tsx`, `src/pages/income/__tests__/IncomePage.test.tsx`, `src/pages/clients/__tests__/ClientDetailPage.test.tsx`, `src/lib/i18n/__tests__/a11yKeys.test.ts`, `e2e/support/axe.ts`

## Implementation decisions (no new ADR)

| # | Rule | Decision |
|---|---|---|
| D1 | `aria-dialog-name` | `Drawer` names its `role="dialog"` with `aria-labelledby` pointing at the title `<h2>`, whose id comes from `useId()`, so two drawers never share an id. The close button's name moves from a hard-coded "Close" to `t('common.close')`, and the X icon is `aria-hidden`. The hosted portal's own `Drawer` (lint-banned from importing the app's) gets the same `aria-labelledby`. |
| D2 | `select-name` (period) | `DateRangeControl`'s preset `<select>` gets `aria-label={t('filters.period')}`. There is no visible label to point at, because the filter sits in the top bar beside the page title. The two custom-range date inputs, shown only for Custom, get `filters.periodFrom` / `filters.periodTo`. They have the same defect, and axe would flag them as `label` the moment Custom is picked. |
| D3 | `select-name` (Settings) | Settings' default-currency `<select>` is named by its visible label through `aria-labelledby` and described by the row's description through `aria-describedby`. Both ids come from `useId()`. No new string, so the spoken name matches the visible one (WCAG 2.5.3). |
| D4 | `button-name` | The business profile row's ⋯ button gets `aria-label={t('settings.profile.actionsFor', { name })}`. That gives "Actions for Acme", so each row's button is distinct when listed by a screen reader. It also gets `aria-expanded`. The icon is `aria-hidden`. It stays a disclosure: its items are plain buttons, not `menuitem`s, so there is no `aria-haspopup`. |
| D5 | `empty-table-header` | New `RowActionsHeader` in `components/ui` renders `<th class="row-actions-header">` with a `.sr-only` "Actions" (`common.actions`). It replaces the four empty `<th>`s: Income, the client profile's work and payments tables, and project detail. The `.row-actions-header` CSS moves from `RecordPaymentButton.css` into `RowActionsHeader.css`, so the cell owns its width rule. |
| D6 | `heading-order` | Settings' section titles (`.settings-section-title`) become `<h2>`, as `DataToolsSection` already was: in `SettingsPage` and `AdvancedFeaturesSection`. It looks the same, because the class sets the font size and the global reset zeroes heading margins. |
| D7 | — | `KNOWN_AXE_VIOLATIONS` drops `aria-dialog-name`, `select-name`, `empty-table-header`, `button-name` and `heading-order`, and only `color-contrast` is left. With any of those fixes missing, the e2e axe spec fails. |

New i18n keys, in en and ar: `common.actions`, `filters.period`, `filters.periodFrom`, `filters.periodTo`, `settings.profile.actionsFor` (keeps `{name}`).

## Rules under test

| # | Rule | Level |
|---|---|---|
| T1 | A drawer is a dialog named by its title (`getByRole('dialog', { name })`), and the name follows a title change | component |
| T2 | Two drawers open at once each have their own name (the ids are distinct) | component |
| T3 | The drawer's close button is named "Close" in English and "إغلاق" in Arabic | component |
| T4 | The hosted drawer is a dialog named by its title | component |
| T5 | The period select is a combobox named "Period"; with Custom chosen, the two date inputs are named "From" and "To" | component |
| T6 | `RowActionsHeader` is a column header named "Actions", and its text is visually hidden (`.sr-only`) | component |
| T7 | The Income table and the client profile's work and payments tables each have an "Actions" column header | component (page) |
| T8 | The client profile's period select is named "Period" | component (page) |
| T9 | Settings: the default-currency select is named "Default Currency" and described by its description | component (page) |
| T10 | Settings: each business profile's ⋯ button is named "Actions for <name>", and `aria-expanded` follows open and closed | component (page) |
| T11 | Settings: every section title is a level-2 heading, and no level-3 heading comes before the first level-2 one | component (page) |
| T12 | `AdvancedFeaturesSection`'s title is a level-2 heading | component |
| T13 | Every new key is non-empty text in en and ar; `settings.profile.actionsFor` keeps `{name}` in both | unit |
| T14 | Axe on the six core surfaces reports nothing but `color-contrast` (`KNOWN_AXE_VIOLATIONS` shrunk) | e2e |

## Edge cases

- Arabic: the new names are translated (T3, T13). `<html dir>` doesn't affect any of them.
- A drawer still loading uses `common.loading` as its title, so it has a name too (the same code path).
- No business profiles: there are no ⋯ buttons, and the empty text renders (no assertion beyond the existing page).
- The Income empty state has no table, so it has no header to name.
