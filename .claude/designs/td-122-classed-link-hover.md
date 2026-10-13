# TD-122: the global link hover applies to unclassed links only

**Status:** Built on `fix/td-122-classed-link-hover` (2026-10-14)
**Debt:** TD-122 (filed on the MUT-77 branch, `feature/mut-77-landing-header`, not yet on main)

## Problem

`src/styles/theme.css` has `a:hover { color: var(--link-hover) }` and `src/index.css` has
`a:hover { text-decoration: underline }`. Both are specificity (0,1,1), so they beat a link's
single-class base rule (0,1,0). Any classed link that doesn't declare its own `:hover` colour or
underline turns link-coloured and underlined on hover. On a filled button (`.btn-primary`,
`.hero-cta-primary`), that puts a purple label on a purple fill.

MUT-77 fixed four landing controls one by one. This fixes the cause: it scopes both global rules
the same way `theme.css` already scopes `:visited` (`a:not([class]):visited`).

### Acceptance criteria

1. Both global hover rules read `a:not([class]):hover`, and no stylesheet in `src/` has a bare
   `a:hover`.
2. A hovered classed **control** (a button, card, pill, nav or menu item, or row action) keeps
   its label colour and gets no underline.
3. A classed **inline text link** (a breadcrumb, a name in a table, a back link, a footer or
   download text link) still shows a link hover: its own `:hover` declares a colour and an
   underline.
4. An unclassed link still gets the link hover (`--link-hover` and an underline).
5. The MUT-103 brand guards (`src/styles/__tests__/brand.test.ts`) stay green.

## Audit: every classed `<a>` in `src/`

"Before" is what the global rules did to the link on hover. "After" is what it does with this
change.

| Class (file) | Kind | Before (global leak) | After |
|---|---|---|---|
| `.btn-primary` / `.btn-secondary` / `.btn-ghost` (Settings › About) | control | primary and secondary labels turned `--link-hover`; all three underlined | own colours, no underline |
| `.brand` (sidebar mark) | control | `--link-hover` + underline | `--text`, no underline |
| `.nav-item` (sidebar) | control | none: its own `:hover` sets colour and `none` | unchanged |
| `.profile-switcher` (empty-state link) | control | underline | none |
| `.profile-switcher-action` (switcher menu) | control | underline | none |
| `.home-attention-open` (Home › Needs attention client cell) | control (row action; its `<button>` twin has no hover colour) | `--link-hover` + underline | inherits the row's colour; row hover background only |
| `.mac-download-banner-cta` | control | underline | none |
| `.project-tag` (client work list) | control (a pill) | underline (its own colour change stays) | colour change only |
| `.hp-nav-on` (portal nav) | control | none: `.hp-nav a` rules win | unchanged |
| `.landing-skip-link` | control | `--link-hover` on its accent fill | own colour |
| `.hero-cta-primary` | control | `--link-hover` + underline on the ink fill (MUT-77's bug) | own colour, no underline |
| `a.landing-get-it-option` | control (card) | `--link-hover` + underline | own colour, no underline |
| `.download-cta--primary` / `--secondary` | control | underline; secondary's label turned `--link-hover` | own colours, no underline |
| `.breadcrumb-link` | text link | underline (colour was its own) | **own rule adds the underline** |
| `.client-index-name` (Clients index) | text link | `--link-hover` + underline | **own rule**: `--link-hover` + underline; settled, bucket and open rows keep their colours |
| `.feature-notice-banner-action` | text link | `--link-hover` (underline was its own) | **own rule adds the colour** |
| `.hp-back` (portal client page) | text link | `--link-hover` + underline | **own rule** |
| `.hero-cta-alt` | text link | `--link-hover` (underline was its own) | **own rule adds the colour** |
| `.privacy-policy-back` | text link | `--link-hover` (underline was its own) | **own rule adds the colour** |
| `.download-link` | text link | underline (colour was its own) | **own rule adds the underline** |
| `.download-alt-link` | text link | underline (colour was its own) | **own rule adds the underline** |
| `.landing-get-it-alt` | text link | none: `.landing-get-it-meta a` rules win | unchanged |

Unclassed links styled by a parent selector (`.landing-footer-links a`, `.landing-get-it-meta a`,
`.hp-nav a`) are unaffected: they still match `a:not([class])`, and their parent rules already
set what they want.

**Rule for future links:** add a class and the link is a control, so it owns its hover. If it is
an inline text link, give it `color: var(--link-hover); text-decoration: underline` on `:hover`.
The audit applies this rule; it is recorded in PATTERNS.md.

## Solution

- `theme.css`: change `a:hover` to `a:not([class]):hover`.
- `index.css`: change `a:hover` to `a:not([class]):hover`.
- Text links: add or extend their `:hover` rules as listed above. `.client-index-name:hover` sits
  before the settled-row rule, so the same-specificity settled and bucket colours still win.
- No component, TSX or i18n change; nothing for the landing controls MUT-77 fixed. Their rules
  become redundant but stay harmless, so MUT-77 merges without a conflict here.

## Tests

- **Node** (`brand.test.ts`, next to the `:visited` guard): no CSS file in `src/` has a bare
  `a:hover`; theme.css and index.css each have exactly `a:not([class]):hover`; each audited text
  link's `:hover` declares a colour and an underline.
- **Browser** (`qa/specs/web/link-hover.spec.ts`, `@web.brand.link-hover`, light and dark, on a
  vite preview build). Each check reads the computed colour and `text-decoration-line` before
  and after hovering.
  - Controls: landing hero button and Get it card; /download CTA; sidebar mark; Home attention
    link; Settings › About button-links. Expected: same colour, `none`.
  - Text links: hero alt link; privacy back link; /download back link; Clients index name;
    client breadcrumb. Expected: `underline`.
  - An unclassed link injected into the page. Expected: `underline` and the `--link-hover` colour.
  - GitHub's API is stubbed to 404, so /download renders its fallback buttons with no request
    leaving the host.
- The portal's `.hp-back` is covered by the Node guard only. The portal QA project has a sign-in
  spec alone, and stubbing a signed-in client page for one hover isn't worth it.

## Impact, i18n, cost, infra

CSS only. Direction-neutral (no RTL impact), no new strings, no cost, no infra.
