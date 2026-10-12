# MUT-79 — App frame, nothing floats over content: test plan

- **Ticket:** MUT-79 (epic MUT-74) · **Brief:** `landing-apple-redesign.md` A1, finding F15 · **Resolves:** TD-049
- **Files:** `src/hooks/__tests__/useMenuButton.test.tsx` (dialog mode), `src/components/layout/__tests__/FxRateReadout.test.tsx`, `src/components/layout/__tests__/ThemeToggle.test.tsx`, `src/lib/theme/__tests__/themeModes.test.ts`, `src/components/layout/__tests__/SidebarNav.features.test.tsx` (footer), `src/components/ui/__tests__/MacDownloadBanner.test.tsx`, `src/lib/__tests__/retiredStorage.test.ts`, `src/lib/__tests__/platform.test.ts` (pruned)

## Implementation decisions (no new ADR; A1 is the decision)

| # | Decision |
|---|---|
| D1 | The FX popover uses `useMenuButton({ kind: 'dialog' })`, an extension of the existing hook rather than a new one: `aria-haspopup="dialog"`, panel `role="dialog"` with `tabIndex=-1`. Opening focuses the first enabled focusable, or the panel itself when there is none. There is no arrow-key roving. Tab closes only when it leaves past the last (or Shift+Tab past the first) focusable. Escape refocuses the button, and an outside press closes, as in menu mode. Menu mode is unchanged. |
| D2 | The readout shows `$1 = ₪3.06`: USD→ILS at 2 decimals, locale digits, wrapped in an LTR isolate so the formula reads the same in Arabic. With no rate it shows `$1 = ₪—`. The popover shows USD and EUR at 4 decimals, each with its source (Live / Cached / Unavailable), plus the rate date ("Rates for 12 Oct 2026") and the fetch time ("Updated today"). One Refresh button refetches both and is disabled while loading. |
| D3 | The readout lives in `TopBar`, before the profile indicator. So it appears on every page that renders a `TopBar`; Planning and Import data render their own headers and do not get it. |
| D4 | `ThemeToggle` sits in the sidebar footer on Settings' row (and stacked under it on the 64px rail). It cycles `THEME_MODES` (light → dark → system), the same list Settings renders. Its icon is per mode (sun / moon / monitor), and its name is "Theme: Dark". |
| D5 | The Mac-app bar shows when `currentDevice() === 'mac'`, the app is not running in Tauri, and the bar has not been dismissed. It is rendered in flow at the bottom of `<main>`, not fixed. Storage errors are ignored. `isMacOS` / `isWindows` / `isLinux` lose their last caller and are deleted (TD-049). |
| D6 | `UpdateBanner` (desktop only) also moves from `position: fixed` into flow at the bottom of `<main>`; AC 1 covers it. Its old `left: var(--sidebar-width)` was wrong while the sidebar was collapsed. |
| D7 | `FxRateBanner` (tsx and css), its `mutaba3a_fx_banner_state` key, its drag and position state, and the keys `fx.showBanner`, `fx.minimize`, `fx.drag` and `fx.bannerTitle` are deleted. `removeRetiredStorageKeys()` runs once at startup and removes the old key from users' storage. |
| D8 | The test setup stubs `fetch` with a rejecting guard, so the readout (now in every page test's `TopBar`) never reaches the FX API. Tests that need `fetch` already stub it themselves. |
| D9 | *(found in the browser)* `<main>` clips its absolute children, so the RTL popover was cut off at 575 px. A layout effect shifts the panel by `nudgeInside(panel, main, 8)`, a pure function. |
| D10 | *(found in the browser)* `theme.css`'s `:lang(ar) { direction: rtl }` beats `dir="ltr"` (TD-048), which turned the formula into `₪3.06 = $1`. The formula states `.fx-formula[dir='ltr'] { direction: ltr }`. A global fix was tried and reverted: existing Arabic amounts rely on the bug (see TD-048). |
| D11 | Settings' update card was also `.update-banner`, so it is renamed `.settings-update-card`; otherwise its margin and border would leak onto the in-flow desktop bar. |

**Out of scope:** these are transient overlays by design: drawers, modals, menus and popovers, and toasts. The internal demo-mode bar pads `.app-shell` and does not overlap content.

## Rules under test

| # | Rule | Level |
|---|---|---|
| T1 | Dialog mode: the button says `aria-haspopup="dialog"`, `aria-expanded` and `aria-controls`, and the panel is `role="dialog"` | component (hook) |
| T2 | Dialog mode: opening focuses the first enabled focusable; with none, the panel itself | component |
| T3 | Dialog mode: Tab between two focusables keeps it open; Tab past the last closes; Shift+Tab past the first closes | component |
| T4 | Dialog mode: Escape closes and refocuses the button; an outside mousedown closes; an inside one doesn't; arrow keys do not move focus | component |
| T5 | Menu mode is unchanged (the existing 10 tests pass untouched) | component |
| T6 | The readout shows `$1 = ₪3.06` from a 3.0612 rate, and `—` with no rate; its accessible name starts with "Exchange rate" and contains the visible formula | component |
| T7 | The popover is a dialog labelled "Exchange rate" that lists USD and EUR at 4 decimals, each with its source label, the rate date and the update time | component |
| T8 | Refresh refetches both rates; it is disabled while either rate is loading | component |
| T9 | Escape closes the popover and refocuses the readout | component |
| T10 | `nextThemeMode` cycles light → dark → system → light; `THEME_MODES` is exactly those three, in that order | unit |
| T11 | `ThemeToggle` (under the real `ThemeProvider`) names the current mode, and each press advances it, sets `<html data-theme>` (none for system) and persists `mutaba3a-theme` — the state Settings reads | component |
| T12 | The sidebar footer holds Settings and the theme toggle, in both the expanded and the collapsed sidebar | component |
| T13 | The Mac bar shows on a Mac browser; it is hidden on an iPad (MacIntel + touch), on Windows, in Tauri, and after dismissal | component |
| T14 | Dismissing the Mac bar hides it and persists, so a remount stays hidden; a throwing `localStorage` neither crashes nor shows the bar after dismissal in the same mount | component |
| T15 | `removeRetiredStorageKeys` removes `mutaba3a_fx_banner_state`, leaves other keys alone, and survives a throwing storage | unit |
| T16 | `nudgeInside`: a panel that fits is not moved; past the right or left edge it moves back inside with the margin; wider than the bounds it is pinned left | unit |

## Edge cases

- The rate is cached and offline → the readout shows the cached rate; the popover says Cached.
- The rate is 0 or missing (source `none`) → `—`, with Unavailable in the popover and no date lines.
- RTL → the readout formula stays LTR inside an isolate; the popover aligns to the inline end (logical properties).
- Collapsed sidebar → the theme toggle stays reachable, as an icon under Settings.

## Browser checks (web-mut74 preview, port 5182)

- At 1440, 1024, 768 and 375 px, no visible element with `position: fixed | sticky | absolute` outside a drawer, menu or popover intersects `<main>` (a JS sweep of computed styles).
- The FX popover opens and closes by mouse and keyboard, in English and in Arabic.
- The theme toggle and Settings → Theme stay in step.
- With `navigator.platform` spoofed, the Mac bar shows in flow at the bottom of main, and dismissing it removes it for good.
