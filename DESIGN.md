# MTB3A web design system

This file lists the parts the portal is built from, so a screen doesn't decide them again. Values live in `src/styles/brand/mutaba3a.tokens.json` (canonical), `src/styles/brand/mutaba3a-theme.css` (the `--m-*` primitives) and `src/styles/theme.css` (the semantic tokens components read). This file says what each one is **for** and adds no values. The phone app has the same kind of file at `mutaba3a-flutter/mutaba3a/DESIGN.md`, and the two should agree on meaning.

Started in MUT-417, seeded from `docs/brand/README.md`, the portal components (`src/hosted/components/`) and MUT-115's component map (design review DR10, `.claude/designs/mut-115-passkeys.md`).

**Scope.** Since MUT-445 (ADR-203) the web is two things: the **portal** (`hosted.html`, `src/hosted/**`), which is the app, and the **website** (`dist-web`: landing, privacy, terms in `src/pages/landing/**`). The local web app at `/app` and the desktop apps are retired. Parts of `COMPONENT_REGISTRY.md` that describe them (`src/components/drawers`, `layout`, `modals`) are history.

## Surface

- **Mode:** Operate for the portal. People come to it to record and check money, so scanning comes before expression: tables, rows and drawers, one accent, no decoration that doesn't carry meaning. The website is Present: it's allowed the display face, the hero rhythm (`--landing-section-pad*`) and the mock-ups.
- **Shell (MUT-426, ADR-195):** a floating chrome over `<main>` (`src/hosted/shell/HostedShell.tsx`): the Reports corner icon, a pill of four destinations (`shell/destinations.ts`) and the You island (`shell/YouIsland.tsx`). The page reserves the chrome's room (`--hp-chrome-top`), so at rest nothing sits under it. Account and profile settings live on the You page (`pages/you/`), never in a menu.
- **Light and dark:** both, following the OS. ThemeToggle can force either with `<html data-theme>`. Every semantic token resolves in all four states; `brand.test.ts` checks this.
- **Drawer-first:** creating and editing happen in a drawer opened by a URL key (`?newIncome=`, `?changePassword=`, …), never on a "create page".

## Colour roles

Pick by role, never by hex. Components read `theme.css` tokens. `hosted.css` reaches for a `--m-*` primitive only for a pairing the semantic layer doesn't name: a chip's ground with its own ink, Reports' direction inks, or the floating chrome's glass. It never uses a colour literal (`brand.test.ts`'s literal guard).

| Role | Token(s) | Primitive | Used for |
|---|---|---|---|
| Canvas | `--bg` | `canvas` | the page, and drawer footers |
| Surface | `--surface`, `--surface-hover`, `--surface-2` | `surface`, `fieldBg` | drawers, cards, row groups; hover; the current row and fields |
| Text | `--text`, `--muted` / `--text-secondary` | `ink`, `ink2` | body text; secondary lines, hints, captions (`ink2` is 7:1 on every light ground) |
| Placeholder | `--placeholder` | 85% `ink2` toward `fieldBg` | input hints only: the one exemption from 7:1 (ADR-058), so a hint never reads as a typed value |
| Lines | `--border`, `--divider`, `--border-strong` | `line` | row-group borders, dividers between rows, a hovered input |
| Accent (fill) | `--accent`, `--accent-solid` | `primary`, `primaryHover` | decoration and fills. A filled button is `--accent-solid` (`primaryHover`, 7.14:1 under cream) |
| Accent (text) | `--accent-text`, `--link` | `primaryHover` | links, text buttons (`.hp-link-button`), selected-tab labels. `--accent` as text is only 4.78:1, so never use it for text |
| Selected | `--accent-subtle` + `--on-accent-subtle` | `lavender` + `lavenderInk` | the selected nav item, chips, the open row, the saved-row tint |
| Success / money in | `--success`, `--success-subtle` | `mintInk`, `mint` | Paid, Filed, Ongoing chips; "above your usual" on Reports |
| Attention | `--warning`, `--warning-subtle` | `butterInk`, `butter` | Unpaid, a failed card payment (`.hp-banner-warning`); something to notice, not a failure |
| Error / danger | `--error`, `--error-subtle`, `--error-muted` | `roseInk`, `rose` | error banners, field errors, danger buttons and text actions (`.hp-danger`), Overdue |
| Info | `--info`, `--accent-2`, `--accent-2-subtle` | `lavenderInk`, `lavender` | info banners (`.hp-banner-info`) |
| On a filled status ink | `--on-status` | `canvas` | text on a danger button or a completed step: white fails once the inks turn light in dark mode |
| Focus | `--focus-ring`; `--focus-ring-on-fill` | `focus` | the inset ring on unfilled controls; filled buttons get the outer ring |
| Profile rings | `--profile-ring-1…6` | `ring1…6` | the You island avatar only, picked by a hash of the profile id (`ringColorOf`) |
| Mark | `--mark-*` | `markDot`, `markLavender`, `markRose`, `markPeach` | the bloom loader only |

One colour, one meaning:
- Text on a lavender ground is `lavenderInk`, never purple (5.52:1).
- Rose means an error or money going the wrong way. On Reports (MUT-448, `.hp-glance-*`) "below your usual" and a negative business net are rose ink, always with words and the minus sign so colour never carries the meaning alone.
- Don't use mint for a warning or butter for an error.
- Peach is the phone's Malafat role and has no role on the web, so the portal doesn't use it. A group member's "kept" pill (`.hp-kept`) is the neutral badge pair (`--badge-neutral-bg` / `--badge-neutral-text`): it states a fact about the row and isn't a warning.
- Lavender means Personal on the phone, so a shared profile is never marked with a lavender pill. On Reports the shared cue is plain caption text (`.hp-glance-shared`: `--text-label`, `--muted`), as on the phone.

Status chips use `Badge` (`src/components/ui/Badge.tsx`, `.badge-paid` / `-unpaid` / `-overdue` / `-neutral` / `-success` / `-warning` / `-error` / `-info` / `-accent`), or a portal chip class that pairs one ground with its own ink (`.hp-receipt-chip-*`, `.hp-group-chip-*`).

## Type

Three faces, from `src/styles/brand/fonts.css`, bundled and served unmodified (see the Thmanyah licence in `docs/brand/README.md`):
- **Thmanyah Sans** (`--font-en` / `--font-ar`): body and UI in both scripts.
- **Thmanyah Serif Display 700** (`--font-heading`): headings and titles.
- **IBM Plex Mono** (`--font-mono`, or `.num` / `[data-numeric]`): amounts and figures, with tabular numerals. Thmanyah has no ₪ and no `tnum`. Words never go in Plex: it has no Arabic, so the stack falls back to Thmanyah Sans as a safety net, not a licence.

| Token | Size / weight | Where |
|---|---|---|
| `--text-display` | 56 / 700 | the website hero only |
| `--text-title` | 32 / 700 | page titles (`h1`, `h2`) |
| `--text-headline` | 20 / 500 | section titles (`h3`, `h4`), a confirm's heading |
| `--text-body` | 16 / 400 | body, banners, drawer titles (semibold); never smaller for body text |
| `--text-figure` | 40 / 500, mono | hero figures; `--text-figure-fluid` scales it down to a 375 px phone (Reports) |
| `--text-label` | 13 / 400 | small words: secondary lines, hints, the "or" divider, text buttons |
| `--text-micro` | 11 / 500 | counters, step dots and pills such as `.hp-kept`; never body copy |

Thmanyah ships 400/500/700 and Plex 400/500, so `--weight-semibold` (600) renders with the Bold file; `font-synthesis-weight: none` stops a fake bold. Legacy `.text-xs`…`.text-2xl` map onto this scale; don't add sizes between steps.

Spacing is `--space-*` (N × 4px, from the token file's one scale, MUT-165); radii are `--radius-xs` 4, `sm` 12, `md` 14, `lg` 18, `card` 24, `hero` 28, `pill`.

## Components

### Drawers and their footers

- **Drawer:** `Drawer` (`src/hosted/components/Drawer.tsx`) on the shared `DrawerFrame` (`src/components/ui/drawer/DrawerFrame.tsx`). It's a `role="dialog"` `aria-modal` named by its title, 480px (`--drawer-width`) capped at the viewport. It springs in from the inline end, follows a drag, traps focus and closes on Escape, ✕ or the overlay. `readOnly` (MUT-361) keeps the drawer open for reading, adds the lock note and drops the footer.
- **Mounting:** a page or the shell mounts it from a URL key (`shell/ProfileDrawers.tsx`, `shell/AccountDrawers.tsx`, `IncomeDrawerHost.tsx`). Its `go()` merges keys into the URL rather than replacing it.
- **Footer:** `footer` holds the actions, on `--bg` above a 1px line. Layout:
  - `drawer-footer-right` holds Cancel (`Button variant="secondary"`) then the primary action (`Button`, primary). Example: `ChangePasswordDrawer.tsx`.
  - `drawer-footer-left` holds a record's Delete (`Button variant="danger"`), on edit only. Example: `ExpenseDrawer.tsx`.
  - The primary submits the drawer's `<form>` by `form={FORM_ID}`. While it saves it is busy (`aria-busy` / `isLoading`, `keepLabelWhileLoading` where the label must stay), never removed.
- **Panes inside a drawer:** a drawer that needs a second step swaps its body (list → edit in `ProfilesManageDrawer.tsx`; `CorrectionPane.tsx` in `RedateDrawer`) rather than opening a drawer on a drawer.

### The banner slot

- **Banner:** one slot at the **top of the drawer body** (or of the page), `.hp-banner` plus a tone and its icon:
  - `.hp-banner-error` with `AlertIcon`, `role="alert"`;
  - `.hp-banner-info` with `InfoIcon`, `role="note"`;
  - `.hp-banner-warning` (the lapse gate, `LapseGate.tsx`);
  - `.hp-banner-ok`.
  The drawer's profile forms use `ProfileBanner` (`src/hosted/components/ProfileBanner.tsx`). Elsewhere the markup is inline (`ChangePasswordDrawer.tsx`, `PasskeysDrawer.tsx`).
- It holds what went wrong with the whole submit ("current password is wrong", "unreachable") and stays until the next submit or until it's resolved. It is never a toast. A field's own error goes under the field (`form-group`). The one placed exception is a step-up prompt that belongs with its action: Passkeys' password field sits above the footer (MUT-115 DR6).
- **Different from the phone, on purpose:** the phone's banner sits just above its pinned primary action, because the keyboard lifts that action into view. A portal drawer's footer sits outside the scrolling body, so its banner goes at the top of the body, where it is read first. Both are announced (`role="alert"`). Decided 2026-10-27 (MUT-417).
- **Page notices:** one-time or dismissible notes at the top of `<main>` reuse the same classes: `UsagePrompt`, `FirmOnBanner`, `PasskeySuggestion`. The trial is one quiet line (`.hp-trial-line`), not a box (MUT-426 D4).

### Toasts

- **Toast:** `ToastProvider` / `useToast` (`src/hosted/components/Toast.tsx`). It shows one message at a time for 6s and holds while hovered or focused.
  - `show(message)` is the error tone, `role="alert"`, for a failure the person should act on that isn't tied to a form (sign-out, a download).
  - `show(message, { tone: 'info' })` is polite, for the outcome of something already gone from screen ("Passkey removed").
  - `action` adds one text button (Undo).
  - `icon` replaces the tone's icon (`SaveFeedbackIcon` on a save).
- **After a save:** `SavedNotice` (`src/hosted/components/SavedNotice.tsx`) says "Expense saved · Show" when the row isn't on screen. When it is, the row tints (`.row-flash`, `useSavedFlashRows`). Don't add a second "saved" toast.

### Destructive confirm

- **In place, never `window.confirm`** (MUT-115 DR7). Use `InPlaceConfirm` with `useConfirmStep` (`src/hosted/components/InPlaceConfirm.tsx`), which already implements the rules below. The control that deletes turns its row or section into a confirm state. The state has a sentence that names the thing and the consequence, with numbers when there are any ("3 expenses will become uncategorized"), then Cancel (`Button variant="secondary"`, focused) and the action (`Button variant="danger"`). Escape cancels the confirm before it can close the drawer. Cancelling returns focus to the control that opened it.
- **Recipes:**
  - in a drawer footer: the footer's Delete turns the whole footer into `InPlaceConfirm` (`ExpenseDrawer.tsx`, `ConversionDrawer.tsx`);
  - in a row: `.hp-passkey-confirm`, a `role="group"` labelled by its sentence (`PasskeysDrawer.tsx`, `PasskeyRow`);
  - in a section: `.hp-confirm`, an `h3` plus a body (`GroupDrawer.tsx`, `ProfileOwnersSection.tsx`, `ProfileEditForm.tsx`'s type change);
  - in a pane: `CorrectionPane.tsx` (a reason is required and the danger button submits).
- **Blocking dialog:** `BlockingDialog` (`src/components/ui/BlockingDialog.tsx`) is only for something that must be answered before anything else (terms that changed mid-session, MUT-346). It isn't a confirm.
- The portal has no `window.confirm` left (MUT-417 moved the expense and conversion deletes in place). Don't add one.

### List rows

- **Data lists:** `HostedTable` (`src/hosted/components/HostedTable.tsx`) on `Table.css`. It takes pre-shaped rows and opens a row by a `row-link` button in its `linkColumn`. `canOpen` turns that off per row, and `stickyEnd` pins the row actions on a narrow window. States come from `QueryView`: `Skeleton`, `Empty` (with an action), `Unreachable` (Retry) and `CrashCard`.
- **Settings-style rows:** `RowGroup` plus `RowButton` / `RowLink` / `RowNavLink` / `RowSwitch` / `RowNote` (`src/hosted/components/YouRows.tsx`). Rows are full width, at least 44px, and grouped in one bordered box with `--divider` lines; no per-row cards or shadows. `tone="action"` is an accent-text row such as "New profile", and `tone="danger"` a destructive one. `inert` keeps a row focusable so it can say why it does nothing. `current` marks the row you're on. A row that goes one level in ends in a bidi-mirrored ›.
- **Rows with their own actions:** the row's name and meta come first. Then come text buttons (`.hp-link-button`, danger ones with `.hp-danger`), always visible and at least 44px tall, never only on hover. They wrap under the meta line at 375 px. Recipes: `.hp-passkey-row` (`PasskeysDrawer.tsx`), `.hp-profile-row` (`ProfilesManageDrawer.tsx`, `ProfileOwnersSection.tsx`). Reuse one of these before making a third.
- **Names in a row:** `dir="auto"`, one line with an ellipsis where the row is a choice (`.hp-profile-row-name`), wrapping anywhere where it's the subject (`.hp-passkey-name`).

### The "or" divider

- **Divider:** `.hp-divider` (`src/hosted/hosted.css`, MUT-115 DR1). A `--text-label` word between two `--border` rules, in `--muted`. Its only use today is between the password form and "Sign in with a passkey" (`src/hosted/pages/auth/SignInPage.tsx`). It isn't rendered when the second way in isn't offered (no passkey support).

### Icons

- **Portal icons:** `src/hosted/components/Icons.tsx`: `InfoIcon`, `AlertIcon`, `LockIcon`, `ChartIcon` (Reports), `PasskeyIcon`. They're inline SVG in `currentColor`, `aria-hidden`, and the control carries the label.
- **The generated set:** `src/components/icons/generated/`, produced by `npm run icons:generate` from `assets/icons/source/*.svg` and never hand-edited. New icons come from here (`assets/icons/README.md`). The portal doesn't use it yet except through `SaveFeedbackIcon`; moving `Icons.tsx` onto it is open.
- **Direction:** an icon that points (chevrons, back, ›) mirrors in RTL. A mark or symbol (the passkey mark, the brand mark, a lock) never does.
- **Loading:** `BrandLoader` (`src/components/brand/BrandLoader.tsx`) is the loader for a wait on a page or boot screen, and lists use `Skeleton`. A busy button shows its own small spinner (`Button isLoading`, or `btn-spinner hp-inline-spinner` on the sign-in pages) and never a second loader beside it. The brand mark is `BrandMark`, and the name in running text is plain "MTB3A" / متابعة (`docs/brand/wordmark/README.md`).

### Press feedback

Every `Button` presses already. Add `press` to any other control that acts (a row button, the drawer's ✕, a text button). Don't add it to tabs or links in running text. `pressFeedback.test.tsx` checks every portal button.

## RTL and 375 px

- **Direction** comes from `<html dir>` (set by the i18n provider) and `dir` attributes only, never from a `:lang()` rule (`direction.test.ts`, MUT-109). Arabic is the default until a person chooses (ADR-077).
- **Layout:** use logical properties only (`margin-inline-start`, `inset-inline-end`, `text-align: start`). Every `hp-` class is written this way, so Arabic mirrors without overrides. A physical rule needs a `[dir="rtl"]` twin and a reason (the drawer edge, the row-flash rail).
- **Amounts** are a plain `<bdi>` (`DecimalAmount`, `src/hosted/format/DecimalAmount.tsx`). Never put `dir="ltr"` on an amount: it flips the sign and symbol.
- **Values that are always left-to-right** take `dir="ltr"` and keep their place: email addresses, timezone ids, codes, a `CopyField` value. **People's text** (names, notes) takes `dir="auto"`.
- **Dates and numbers** go through `Intl` in the reader's language (`format/dates.ts`, `formatDecimal`), with Western digits.
- **375 px:** the portal must work at 375 px wide with no horizontal scroll:
  - the drawer fills the screen (`max-width: 100%`, MUT-357; `drawerFit.test.ts`, `@portal.direction.drawer-phone-*`);
  - row actions wrap under their text;
  - button rows stack (`.hp-locked-actions` at ≤ 480px);
  - hero figures use `--text-figure-fluid`;
  - tables pin their actions with `stickyEnd`.

  The portal's breakpoints are 760px (chrome and layout) and 480px / 400px (stacking). Don't add a breakpoint without a reason in a comment.
- **Targets:** at least 44px for anything you tap (rows, text buttons in rows, the chrome's objects, `--hp-chrome-object`).
- **Motion:** every animation has a reduced-motion form: a 150ms fade or nothing (the motion tokens in `theme.css` zero themselves).

## Copy

Use utility language: orientation, status, action. Arabic mirrors the English and is checked in RTL. Every string goes through an i18n key in `src/lib/i18n/translations/{en,ar}/`. "Malafat" stays in Latin script inside Arabic text.
