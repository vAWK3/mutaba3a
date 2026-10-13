# MUT-103 — Brand v2 app sweep: no hard-coded colours, sizes or radii outside the token file

Status: plan (2026-10-13), not started · Epic MUT-101 · Blocker MUT-102 Done · Debt: TD-079 · Context: ADR-058

## Problem

MUT-102 re-pointed `theme.css`. Components still carry the old system: colour literals,
px radii, literal font sizes, 46 dead `var()` names, and the legacy `--text-xs…4xl` /
`--radius-xl/2xl/full` aliases. Nothing stops new ones from landing.

### Measured on main `a48f72d` (2026-10-13)

| What | Count | Biggest |
|---|---|---|
| CSS colour literals (outside `src/styles/`) | 131 in 16 files | ImportDataPage 39, CSVValidationPreview 36, index 12, DemoBanner 11, PlanningPage 7 |
| TSX colour literals | 29 in 3 files | PlanAssumptionDrawer 25 (inline `<style>`), BusinessProfileDrawer 3 (user-data default) |
| CSS px radii | 33 in 8 files | index 17, RetainersPage 5 |
| CSS literal font sizes (px/rem) | 95 in 11 files | PlanningPage 25, RetainersPage 15, index 14, ImportDataPage 13 |
| TSX `fontSize` / `borderRadius` literals | ~10 in 5 files | InsightsPage, BusinessProfileDrawer, IncomePage, ProjectDetailPage, ExpensesLedgerPage |
| Legacy alias uses | 496 in 43 files | index 207, hosted.css 48, LandingPage 32 |
| Dead `var()` names (`KNOWN_DEAD_REFERENCES`) | 46 names, ~215 uses | `--text-muted` 25, `--foreground` 15, `--border-color` 15 |
| `KNOWN_LITERAL_PAIRS` | 6 | all in CSVValidationPreview |
| `tabular-nums` rules | 23 in 13 files | — |
| `*-amount` / `*-total` classes | ~45 | — |

## Decisions (owner, 2026-10-13)

- **D1 — Small sizes get two named tokens.** Add `--radius-xs` (4px) and `--text-micro`
  (11px) as brand extensions: `radius.xs` and `type.micro` in `mutaba3a.tokens.json` →
  `--m-*` primitive → `theme.css` role. That keeps the drift tests honest. Every other
  sub-scale value snaps to the brand scale: 1/2px bar radii → `--radius-xs`, 6/8/10px →
  `--radius-sm`, 9–10px text → micro, 12px → label. This amends ADR-058. The Flutter app
  doesn't read this JSON (no match under `lib/`), so MUT-105 is unaffected.
- **D2 — Extra scope taken:** amounts on `--font-mono`, and a lint for `tabular-nums`
  without mono. **Not taken (stay in TD-079):** heading weights and roles (h1–h4
  collapse, semibold→bold), and the luminance-based ink for the business colour plus
  hex validation.
- **D3 — Landing (MUT-77) and portal (MUT-91) are swept here,** but only the mechanical
  part: the token renames and literal fixes. That lets the aliases be deleted. Their
  layout and motion work stays with their own tickets.
- **D4 — Allowlist = user data only:**
  - `src/db/defaultExpenseCategories.ts`;
  - `src/demo/seedData/categories.ts`;
  - `src/demo/seedData/profile.ts`;
  - the existing profile module that takes `DEFAULT_BUSINESS_COLOR` (eng review D1).

  BusinessProfileDrawer's three `#3b82f6` literals move into that constant. Tests
  (`__tests__`, `*.test.*`, `src/test/`) are excluded, as `sourceFiles()` already does.
- **D5 — Density (eng review D2).**
  - `.data-table td` gets `height: var(--table-row-height)`. The token is unused today
    (0 readers); for table cells, `height` acts as a minimum.
  - The token goes 44→48, and `brand.spec.ts` asserts a Clients row is ≥48px at 1280.
  - Padding is unchanged.
  - `--sidebar-width`, `--topbar-height` and `--drawer-width` stay as they are unless the
    screenshot pass shows clipping.
  - The drawer stays 480: capping it is TD-083.
  - The duplicate layout block in `index.css` is deleted; `theme.css` owns it.

## Where the code goes

Everything is in the existing Brand v2 harness. Nothing new at the architecture level.

- **Guard:** a new `describe('literals')` in `src/styles/__tests__/brand.test.ts`, with
  detection helpers in `src/test/css/brandCss.ts`. It reuses `sourceFiles()`,
  `parseCss`, and `COLOR_LITERAL` (exported from the test file or moved into the helper).
- **Tokens:**
  - `src/styles/brand/mutaba3a.tokens.json` (+xs, +micro);
  - `src/styles/brand/mutaba3a-theme.css` (`--m-radius-xs`, `--m-text-micro`);
  - `src/styles/theme.css` (roles; aliases deleted at the end);
  - `FROZEN_THEME_NAMES` in `brand.test.ts`: drop the alias names deliberately, with a
    comment.
- **Inline `<style>` blocks** in `PlanAssumptionDrawer.tsx` and `MonthlyTimeline.tsx` move
  to co-located `.css` files, as every other component does. The CSS guard then sees them.
- **Sweep:** the 16 + 8 + 11 CSS files above, the 43 alias files, the ~45 amount classes,
  and the 5 TSX files with style-object literals.

## Implementation, as commits (approved arrangement, eng review D1)

All work goes on branch `feature/mut-103-brand-sweep` in mini-crm. The guard and the
baseline land first. After that, every commit only shrinks the frozen lists, so each
commit stays green. Visual commits go one surface group at a time, so each lines up with
one set of before/after screenshots.

1. **Guard, tokens and baseline (TDD).**
   - **Detector fixtures first:** `it.each`, in the same shape as `accent-text guard`.
     - **CSS:** they prove the guard catches:
       - hex, `rgb()`, `hsl()`, `oklch()`, and `white`/`black` in a declaration value;
       - a literal `var(--x, 12px)` fallback;
       - a px or rem `font-size`;
       - a px `*radius`.

       It ignores `transparent`, `currentColor`, `inherit`, `0`, `%`, `em` and
       `calc(var(--radius-*) - 1px)`.
     - **TS/TSX (eng review D3):**
       - flag a string whose whole value is a colour (`'#3b82f6'`, `'rgb(…)'`, `'white'`);
       - flag a numeric `fontSize`/`borderRadius` style key;
       - fail on any `<style>` element in TSX;
       - prove `'#add'`, prose `rgb(` and `&#9998;` are not flagged.
     - **`tabular-nums`:** `font-variant-numeric: tabular-nums` without `--font-mono` in
       the same rule fails.
   - **Repo tests.**
     - `ALLOWED_LITERAL_FILES` lists the D4 files, each with a reason.
     - `KNOWN_LITERALS` is a frozen `file → count` map, shrink-only. It fails on a new
       file, a higher count, or a stale count.
     - `KNOWN_TABULAR_WITHOUT_MONO` is frozen, shrink-only.
   - **Tokens (D1).**
     - Add `radius.xs` 4 and `type.micro` 11 to the JSON, with the `--m-*` primitives and
       the `--radius-xs` and `--text-micro` roles.
     - Extend the drift tests.
     - Amend ADR-058.
   - **Screen matrix and baseline (eng review D4).**
     - **Matrix:** extend the `brand.spec.ts` layout loop to 8 surfaces (Home, Clients
       split, Income, the payment and income drawers, Settings, Expenses, Planning,
       Import) × light/dark × EN/AR × 375/1280.
     - **Helper:** add `enableOptionalArea` in `qa/support/app.ts`.
     - **Baseline:** run the matrix on main `a48f72d` before any style change. Record
       existing overflows in `KNOWN_OVERFLOW`, with measured widths and a "TD-083,
       measured on main" note.
     - **Before set:** keep the main screenshots.
     - **Row height:** add the Clients row ≥48px assertion, marked expected-fail until
       commit 8, or added in commit 8.
2. **Alias codemod (no computed-value change).**
   - The 496 uses map `xs/sm` → label, `base/md/lg` → body, `xl/2xl` → headline,
     `3xl/4xl` → title, and radius `xl/2xl/full` → card/hero/pill. Landing and portal are
     included (D3).
   - Delete the aliases from `theme.css` and `FROZEN_THEME_NAMES`.
   - Delete the duplicate layout block in `index.css`.
   - Safe by construction: no alias is redefined outside `theme.css` or used with a
     fallback (grep, 2026-10-13). Full suite green.
3. **Commits 3–7: surface groups.** Each fixes colours, radii, font sizes, dead
   references and mono amounts together, and clears its files from the frozen lists.
   Each is compared before/after against the baseline.
   - Commit 3: Import + CSVValidationPreview (empties `KNOWN_LITERAL_PAIRS`).
   - Commit 4: Planning, PlanAssumptionDrawer and MonthlyTimeline (the inline `<style>`
     blocks move to CSS files), Retainers, Insights.
   - Commit 5: modals, banners and onboarding (DemoBanner, DemoSeedModal, WelcomeModal,
     DeleteAllDataModal, MigrationWizard, ProfilePickerModal, UpdateBanner).
   - Commit 6: the shell `index.css` and the UI kit (`src/components/ui`, layout,
     drawers, home, clients, expenses, income). This includes `.btn-danger`'s dark 1.52:1
     pair, BusinessProfileDrawer → `DEFAULT_BUSINESS_COLOR`, and the TSX style objects.
   - Commit 7: landing and portal literals.
4. **The mappings these commits use:**
   - **Colours.**
     - Tailwind slate → `--text`, `--text-secondary`, `--muted`, `--border`, `--surface-2`.
     - Notice colours → `--{success,warning,error,info}{,-subtle}` and `--on-status`.
     - `white` on a fill → `--on-accent` or `--on-status`.
     - Follow the accent rules: `--accent-text` for purple text, `--accent-solid` +
       `--on-accent` for fills, `--nav-item-active-text` on lavender.
   - **Sizes.**
     - `0.875rem`/14px → label or body, per context.
     - `0.75rem`/12px → label.
     - 9–11px → micro.
     - `1.25rem` → headline.
     - `1.5rem` → headline or title.
     - `2rem` → title.
     - 1/2/4px radii → `--radius-xs`.
     - 6/8/10px radii → `--radius-sm`.
   - **Dead references.**
     - `--text-muted`, `--color-text-muted` and `--text-tertiary` → `--muted`.
     - `--foreground`, `--text-primary` and `--color-text-base` → `--text`.
     - `--border-color` and `--color-border` → `--border`.
     - `--surface-raised`, `--surface-alt`, `--bg-secondary` and `--surface-secondary` →
       `--surface-2`.
     - `--color-income` and `--positive` → `--success`.
     - `--color-expense`, `--negative` and `--danger` → `--error`.
     - `--primary` → `--accent-solid` (fill) or `--accent-text` (text).
     - `--shadow-lg` and `--shadow-xl` → `--shadow-2` and `--shadow-3`.
     - `--font-size-sm` → `--text-label`.
     - `--font-serif` → `--font-heading`.

     Each commit body lists its own mapping. `KNOWN_DEAD_REFERENCES` ends at `[]`; the
     list and its "lists only dead" test go, and the "no new dead reference" test stays.
   - **Mono.**
     - Put `font-family: var(--font-mono)` on the `*-amount`/`*-total` and tabular-nums
       rules.
     - Where a cell mixes text and an amount (the Clients overdue line, and
       `.client-work-subline`), put mono on the amount `<bdi>`.
5. **Commit 8: density (D5).** Wire `.data-table td` to `--table-row-height`, set the
   token to 48, turn on the row-height assertion, and run the final full matrix.
6. **Commit 9: knowledge files.**
   - `CHANGELOG`;
   - `TECH_DEBT`: narrow TD-079 to headings and the business colour;
   - `DECISIONS`: the ADR-058 amendment;
   - `PATTERNS`: "styles take tokens only; allowlist = user data; no `<style>` in TSX";
   - `TEST_PLAN`;
   - `COMPONENT_REGISTRY`, for the new CSS files.

## Acceptance criteria → proof

| AC | Proof |
|---|---|
| Guard green, and it fails on a new literal | `npx vitest run src/styles/__tests__/brand.test.ts`. The detector fixtures prove it catches each form. At the end, `KNOWN_LITERALS = {}` and only the D4 files are allowlisted. |
| Core screens in light/dark × EN/AR × 375/1280 | The 8-surface matrix from commit 1 (eng review D4). The baseline is measured on main `a48f72d`, and before/after screenshots are compared per surface-group commit. `KNOWN_OVERFLOW` may not grow past the baseline. |
| Playwright e2e green | `make check-e2e` (release-qa core tier) plus `npx playwright test -c qa/playwright.config.ts qa/specs/web/brand.spec.ts` |
| `KNOWN_AXE_VIOLATIONS` doesn't grow | `qa/support/axe.ts` is unchanged, and the contrast specs are green in both schemes |

Before calling it done, run the repo gate: `npm run lint && npm run test:run && npm run typecheck && npm run build && npm run test:bundles`.

## Risks

- **Fixing dead references and literals changes visuals.** Some styles never applied
  until now. The before/after comparison per surface commit catches this, which is why the matrix
  is the AC.
- **The diff is big (~60 files).** It's split into the commits above, each green, so
  review and bisect stay sane.
- **RTL.** No change touches physical properties. The codemod changes values only, never
  `left`/`right`.
- **Cost.** There's no runtime cost: CSS gets slightly smaller. The guard parses about
  55 CSS and about 400 TS files once per run, which the `rendered pairs` describe already
  does.

## Out of scope

- Expense category colours (allowlisted).
- PDF styles: MUT-106; document generation is retired (MUT-145).
- Spacing literals: 110 px padding/margin/gap uses, filed as MUT-165 (eng review D5).
- TD-080 (input borders).
- TD-083 (phone layout).
- Heading weights and roles.
- The business-colour ink and validation.
- The landing and portal layout and motion work (MUT-77, MUT-91).

## Business / product impact

- After MUT-102 the canvas is warm, but Import, Planning, the demo banner and modals still
  paint Tailwind slate. Until this lands, Brand v2 looks half-applied, and the dark-mode
  danger button sits at 1.52:1.
- MUT-103 closes the web half of epic MUT-101. The guard keeps the brand from eroding,
  so later Brand v2 work (MUT-77 landing, MUT-91 portal) starts from a clean, enforced
  token base.
- The risk is visual only; there are no data or API changes. It's a large diff kept
  reviewable by green, phase-by-phase commits.

---

## Eng review (plan-eng-review, 2026-10-13)

Target: this file, `.claude/designs/mut-103-brand-v2-app-sweep.md` (MUT-103 plan). Reviewer: Claude (plan-eng-review).

### Scope record

- **Feature answers:** none. No cuts were proposed; owner decisions D1–D3 were made before the review (2026-10-13).
- **Structure:** B, the Smaller arrangement (answer to D1, 2026-10-13).
- **Accepted scope:**
  - **Same feature list.** Commits are re-ordered:
    1. Guard plus the xs/micro tokens.
    2. Alias codemod, with the alias and duplicate-layout deletion. No computed-value change.
    3. One commit per surface group, each fixing colours, radii, font sizes, dead refs and
       mono together:
       - 3: Import + CSV;
       - 4: Planning + Retainers + Insights;
       - 5: modals, banners and onboarding;
       - 6: shell `index.css` and the UI kit;
       - 7: landing + portal.
    4. Commit 8: density.
    5. Commit 9: docs.
  - `DEFAULT_BUSINESS_COLOR` goes in an existing profile module, not a new one.
- **Pending remedies:** F1 (density targets an unused token).
- **Scope Challenge result:** scope accepted as-is (the smaller arrangement preserves scope).

### Scope Challenge findings

1. **F1.** `[P2] (confidence: 9/10)` In plan D5, "`--table-row-height` goes from 44 to 48",
   but nothing reads the token. `src/styles/theme.css:105 --table-row-height: 44px;` and
   `src/index.css:18` define it. The only layout-token readers are `index.css:237 width:
   var(--sidebar-width)`, `:647 height: var(--topbar-height)` and `:2262 width:
   var(--drawer-width)`. Row height actually comes from `index.css:2111 .data-table td {
   padding: var(--space-3) var(--space-4) }` plus line height. Retuning the token is a
   no-op. Reviewer: Claude.

## Decision ledger

### R1: How the density retune reaches table rows
- **Finding:** F1, P2, confidence 9/10, plan D5 vs `src/index.css:2111`. Reviewer: Claude.
- **Plan baseline:** D5 (proposed, not approved): set `--table-row-height` 44→48 and
  keep the other layout tokens.
- **Runtime evidence:** `--table-row-height` has 0 readers. Rows are 12 + 12 padding plus
  16px body × leading. They already grew when MUT-102 moved the body from 14 to 16.

**Comparison grid:**

| Choice | Current | A | B | C |
|---|---|---|---|---|
| R1 row height mechanism | token defined, unread; padding sets height | `.data-table td` gets `height: var(--table-row-height)`, a min for table cells; token set to 48 | delete `--table-row-height`; rows keep padding-driven height; padding changes only if screenshots show cramping | as written: change the token value only (no visible effect) |
| Structure (D1) | Smaller arrangement, approved | unchanged | unchanged | unchanged |
| Other layout tokens | kept | kept | kept | kept |

Question D2:
D2 — Make the row-height token real, or drop it?
Project/branch/task: mini-crm → feature/mut-103-brand-sweep, density step (commit 8).
ELI10: The plan "re-tunes density" by changing `--table-row-height`, but no CSS reads that token. Table rows are only as tall as their padding plus the text. So the change would do nothing while looking done. We can wire the token into the table cells so it sets a real minimum row height, or delete the dead token and leave row height to padding.
Stakes if we pick wrong: Either a dead knob stays that future designers turn with no effect, or rows end up at a height nobody chose.
Recommendation: A because it turns the ticket's named density knob into one that works. One rule plus a Playwright row-height assertion proves it.
Completeness: A=10/10, B=8/10, C=3/10
Header: Row height
Options:
A) Wire the token (Recommended)
`.data-table td` gets `height: var(--table-row-height)`, a minimum for table cells, and the token goes to 48. Padding stays. brand.spec.ts asserts a Clients row is ≥48px at 1280. Human ~1h / CC ~10min. Risk: rows grow about 2px wherever padding+text was 46.
B) Delete the token
Remove `--table-row-height` from theme.css (and the frozen names, with a note). Rows stay padding-driven; padding changes only if screenshots look cramped. Human ~30min / CC ~5min. Risk: the ticket's named knob disappears, and density has no single control.
C) Keep as written
Change only the token value. Zero effect on screen; the plan claims a density change it doesn't make. Human ~5min / CC ~1min. Not recommended.

- **State:** approved
- **Actual answer:** A) Wire the token (D2, 2026-10-13)
- **Accepted scope:**
  - `.data-table td` gets `height: var(--table-row-height)`, a minimum for table cells.
  - The token goes 44→48, in `theme.css` only, since the duplicate in `index.css` is
    deleted in commit 2.
  - Padding is unchanged.
  - `brand.spec.ts` asserts a Clients row is ≥48px at 1280.
  - D5's other layout tokens are unchanged.
- **History:** none

### Section findings

- **Architecture:** no issues found.
  - Extending the token JSON protects itself through the drift and resolve tests.
  - Flutter `lib/` doesn't read the JSON.
  - The portal is covered by migrating `hosted.css` plus `test:bundles`.
- **Fact for commit 2:** no alias is redefined outside `theme.css` or used with a
  fallback (grep, 2026-10-13), so the rename is semantics-preserving by construction.
- **Q1.** `[P2] (confidence: 6/10)` Plan commit 1, "a TSX string or template colour". A
  regex over all TSX strings would match hex-shaped ids such as `'#add'` and `rgb(` in
  prose. Today the only quoted hex is `BusinessProfileDrawer.tsx:51/65/263 '#3b82f6'`.
  Reviewer: Claude.

### R2: What the guard scans in TS/TSX
- **Finding:** Q1, P2, confidence 6/10, plan commit 1. Reviewer: Claude.
- **Plan baseline:** proposed: flag colour literals in any TSX string or template, plus
  `fontSize`/`borderRadius` numeric style keys.
- **Runtime evidence:** 0 false positives today. There are inline `<style>` blocks in
  `PlanAssumptionDrawer.tsx` and `MonthlyTimeline.tsx`, which the plan moves to CSS.

**Comparison grid:**

| Choice | Current | A | B |
|---|---|---|---|
| R2 TSX detector | any string/template containing a colour | a string whose whole value is a colour (`'#3b82f6'`, `'rgb(…)'`, `'white'`); numeric `fontSize`/`borderRadius` style keys; and any `<style>` element in TSX is banned outright, since CSS lives in `.css` | as proposed: substring match in any string or template |
| R1 row height | approved A (D2) | unchanged | unchanged |
| Structure | approved B (D1) | unchanged | unchanged |

Question D3:
D3 — How strict should the guard be in TSX files?
Project/branch/task: mini-crm → feature/mut-103-brand-sweep, guard commit 1.
ELI10: The CSS side of the guard parses real CSS. The TSX side has to scan source text, and scanning every string for anything colour-shaped will someday flag an anchor like "#add" or the word "rgb(" in help text, which teaches people to ignore the guard. Once the two inline style blocks move to CSS files, TSX only needs two checks: a string that is entirely a colour, and numeric font-size or radius keys in style objects. A ban on new inline style blocks keeps it that way.
Stakes if we pick wrong: A noisy guard gets allowlisted into uselessness, or a narrow one misses a colour hidden inside a template string.
Recommendation: A because exact matches have no false positives, and the style-block ban closes the gap a narrow scan would otherwise leave.
Completeness: A=9/10, B=7/10
Header: TSX guard
Options:
A) Exact match + style ban (Recommended)
Flag a TS/TSX string whose whole value is a colour, and numeric fontSize/borderRadius style keys; fail on any `<style>` element in TSX. Fixture tests cover each form plus `'#add'` and prose `rgb(` not flagging. Human ~1h / CC ~10min. Misses a colour built by concatenation (none today).
B) Substring scan
Flag a colour substring in any string or template literal, as written in the brief. Catches template-built CSS. Human ~45min / CC ~10min. Risk: future false positives on hex-shaped ids and prose; the allowlist grows.

- **State:** approved
- **Actual answer:** A) Exact match + style ban (D3, 2026-10-13)
- **Accepted scope:**
  - In TS/TSX, the guard flags a string whose whole value is a colour, and numeric
    `fontSize`/`borderRadius` style keys.
  - Any `<style>` element in TSX fails the guard.
  - Fixture tests prove each form is caught, and that `'#add'` and prose `rgb(` are not
    flagged.
- **History:** none

### Test review

```
CODE PATHS                                                   USER FLOWS / SURFACES
[+] brand.test.ts › literals (new)                           [+] Core screens × light/dark × EN/AR × 375/1280
  ├── CSS colour literal in a value      [GAP→fixture]         ├── Home, Clients split, Income, payment drawer, Settings
  ├── literal var() fallback             [GAP→fixture]         │     [★★ TESTED] layout@375/1280 EN/AR: brand.spec.ts:263 (light only)
  ├── px/rem font-size; em/% allowed     [GAP→fixture]         │     [★★★ TESTED] axe contrast light+dark: brand.spec.ts:41
  ├── px radius; calc(var(--radius-*) - 1px) allowed [GAP]     ├── [GAP] [→E2E] dark-scheme screenshots for the layout matrix
  ├── TSX whole-string colour; '#add' not flagged (D3) [GAP]   ├── [GAP] [→E2E] Expenses, Planning, Import (optional areas off by default)
  ├── TSX fontSize/borderRadius numeric (D3)  [GAP]            └── [GAP] [→E2E] Clients row ≥ 48px at 1280 (D2)
  ├── TSX <style> element banned (D3)    [GAP]
  ├── ALLOWED_LITERAL_FILES honoured     [GAP]               [+] Regression: commit 2 alias rename
  ├── KNOWN_LITERALS shrink-only (new / grown / stale) [GAP]   └── semantics-preserving by construction (no local alias
  └── tabular-nums without mono          [GAP→fixture]             overrides or fallbacks, grep 2026-10-13) + full suite
[+] existing guards kept green
  ├── references: KNOWN_DEAD_REFERENCES → []  [★★★ brand.test.ts:410]
  ├── rendered pairs: KNOWN_LITERAL_PAIRS → [] [★★★ :717]
  └── tokens/drift with +xs/+micro       [★★★ :300-:496, extended]
COVERAGE today: 3/17 paths ★★+ | GAPS: 14 (3 E2E), all planned in commit 1 / 8
```

- **T1.** `[P1] (confidence: 8/10)` The plan's AC says "Extend the `brand.spec.ts` layout
  loop to Expenses, Planning and Import … `KNOWN_OVERFLOW` (TD-083) may not grow".
  - TD-083 records that phone layout is broken on main.
  - `KNOWN_OVERFLOW` (`brand.spec.ts:233`) only holds Income and the payment drawer,
    measured on main before MUT-102.
  - The three new surfaces have never been measured, so any overflow they already have
    would grow the list and fail the AC, or else be blamed on the sweep.
  - The layout loop also runs light only (`brand.spec.ts:263`), while the AC asks for
    light and dark.

  Reviewer: Claude.

### R3: Visual regression contract for the screen matrix
- **Finding:** T1, P1, confidence 8/10, `qa/specs/web/brand.spec.ts:233/263`.
  Reviewer: Claude.
- **Plan baseline:** proposed:
  - extend the layout loop to Expenses, Planning and Import;
  - attach screenshots and review them by hand;
  - `KNOWN_OVERFLOW` may not grow.
- **Runtime evidence:**
  - The loop covers 5 surfaces in light only.
  - There's no QA helper for switching on optional areas.
  - Overflow on the new surfaces at 375 is unknown.

**Comparison grid:**

| Choice | Current | A | B |
|---|---|---|---|
| R3 baseline | none for new surfaces | commit 1 extends the matrix and runs it on main `a48f72d` before any style change; recorded overflows go into `KNOWN_OVERFLOW` with measured widths and a "TD-083, measured on main" note; the main screenshots are kept as the "before" set | no baseline: extend on the branch and add `KNOWN_OVERFLOW` entries as they appear, justified by TD-083 |
| R3 matrix | 5 surfaces, light, EN/AR, 375/1280 | 8 surfaces (+Expenses, Planning, Import via a new `enableOptionalArea` QA helper) × light/dark × EN/AR × 375/1280 | same as A |
| R3 review | — | before/after per surface group commit, by hand; no pixel snapshots (intended changes would churn goldens) | after only, by hand |
| R1 / R2 / Structure | approved | unchanged | unchanged |

Question D4:
D4 — Measure the new screens on main before changing them?
Project/branch/task: mini-crm → feature/mut-103-brand-sweep, AC "each core screen checked … KNOWN_AXE_VIOLATIONS / KNOWN_OVERFLOW don't grow".
ELI10: The AC says the overflow list may not grow, but Expenses, Planning and Import have never been measured at phone width, and phone layout is already broken on main (TD-083). If we measure them for the first time after the sweep, we can't tell whether an overflow is old or something the sweep caused. The same holds for screenshots: without a "before" set, the reviewer can't tell an intended change from a regression. Running the extended matrix on main first fixes both.
Stakes if we pick wrong: Either the sweep gets blamed for old layout bugs and the AC fails, or a real regression gets waved through as "TD-083".
Recommendation: A because a baseline measured on main is the only way "doesn't grow" means something, and it costs one extra spec run.
Completeness: A=10/10, B=6/10
Header: Baseline
Options:
A) Baseline on main (Recommended)
Commit 1 extends brand.spec to 8 surfaces × light/dark × EN/AR × 375/1280 (new enableOptionalArea helper), runs it on main a48f72d, and records existing overflows in KNOWN_OVERFLOW with measured widths; main screenshots kept as the before set and compared per surface commit. Human ~3h / CC ~25min.
B) Branch only
Extend the matrix on the branch and add KNOWN_OVERFLOW entries as they show up, citing TD-083; review after-screenshots only. Human ~2h / CC ~15min. Can't separate old overflow from new.

- **State:** approved
- **Actual answer:** A) Baseline on main (D4, 2026-10-13)
- **Accepted scope:** commit 1 extends `brand.spec.ts`.
  - **Matrix:** 8 surfaces (Home, Clients split, Income, the payment and income drawers,
    Settings, Expenses, Planning, Import) × light/dark × EN/AR × 375/1280.
  - **Helper:** a new `enableOptionalArea` QA helper in `qa/support/app.ts`.
  - **Baseline on main.** The matrix runs on main `a48f72d` before any style change.
    Existing overflows are recorded in `KNOWN_OVERFLOW` with measured widths and a "TD-083,
    measured on main" note. The main screenshots are kept as the before set.
  - **Per surface commit.** Each surface-group commit is compared before/after by hand.
    There are no pixel snapshots.
  - **Rule:** `KNOWN_OVERFLOW` may not grow past the baseline.
- **History:** none

### R4: TODO — a spacing-literal guard
- **Finding:** TODO candidate from Code quality. `src/index.css:4198 padding: 8px 12px
  !important;`. Spacing literals sit outside this ticket's guard, which covers colour,
  font-size and radius. Reviewer: Claude.
- **Plan baseline:** not in scope; the ticket names colours, sizes and radii only.
- **Runtime evidence:** see the count printed with this record (grep of px
  padding/margin/gap outside `src/styles`).

**Comparison grid:**

| Choice | Current | A | B | C |
|---|---|---|---|---|
| R4 spacing guard | none | add a TODOS.md entry: extend the literals guard to px padding/margin/gap → `--space-*`, with a frozen shrink-only list | skip | build it in MUT-103 |

Question D5:
D5 — Track a follow-up guard for spacing literals?
Project/branch/task: mini-crm → MUT-103 follow-ups.
ELI10: After this sweep, colours, font sizes and corner radii can only come from tokens. Spacing (padding, margins, gaps) can still be any pixel number, so density will drift again one hard-coded 12px at a time. Extending the same guard to spacing is cheap later, but it means re-checking every screen again, which is why it's not in this ticket.
Stakes if we pick wrong: Either the density work from D2 erodes quietly, or MUT-103 grows by another screen-by-screen pass.
Recommendation: A because the guard machinery from commit 1 makes it a small, separate ticket, and keeping it out protects MUT-103's scope.
Note: options differ in kind, not coverage — no completeness score.
Header: Spacing TODO
Options:
A) Add to TODOS.md (Recommended)
Record What/Why/Context: extend brand.test.ts literals to px padding/margin/gap → --space-*, freeze today's uses shrink-only, sweep later. Human ~10min / CC ~2min now.
B) Skip
Don't track it; spacing literals stay unguarded. No cost now; density drifts.
C) Build it in MUT-103
Add spacing to the guard and sweep now. Human ~1.5d / CC ~1.5h more, another full screenshot pass; scope creep against the ticket.

- **State:** approved (filed as a Jira ticket)
- **Actual answer:** "file another ticket for it" (owner's free-text answer to D5, 2026-10-13),
  which takes A's intent but tracks it in Jira, not TODOS.md.
- **Accepted scope:** none in MUT-103. Filed **MUT-165** "Brand v2 spacing guard: no px
  padding, margin or gap outside the token file" (Task, parent MUT-101, Backlog), blocked
  by MUT-103.
- **History:** none

Approval readiness: PASS. Every accepted remedy cites its own answer:
- the structure, from D1-B;
- R1, from D2-A;
- R2, from D3-A;
- R3, from D4-A;
- R4, from the D5 free-text answer, filed as MUT-165.

### NOT in scope
- **Heading weights and roles** (h1–h4 collapse, semibold→bold). The owner left them in
  TD-079.
- **Luminance-based ink and hex validation for the business colour.** These touch the
  data layer and stay in TD-079.
- **Spacing literals.** Filed as MUT-165, blocked by MUT-103.
- **TD-080 (input borders) and TD-083 (phone layout).** They're measured, not fixed:
  baseline overflows are recorded, not cured.
- **Landing and portal layout and motion.** MUT-77 and MUT-91 own them; this ticket does
  only the mechanical sweep.

### What already exists
These are reused, not rebuilt:
- **In `src/test/css/brandCss.ts`:** `sourceFiles()`, `parseCss`/`loadStylesheet`,
  `bareVarReferences` and `customPropertyDefinitions`.
- **In `brand.test.ts`:** `COLOR_LITERAL` and the shrink-only pattern of
  `KNOWN_DEAD_REFERENCES` and `KNOWN_LITERAL_PAIRS`.
- **In `brand.spec.ts`:** `KNOWN_OVERFLOW`, `expectFits` and `attachScreenshot`.
- **In `qa/support/axe.ts`:** `KNOWN_AXE_VIOLATIONS`.
- **In `theme.css`:** the semantic tokens.

The only new pieces are the literal detectors, one QA helper, `enableOptionalArea`, and
two CSS files for the former inline `<style>` blocks.

### Failure modes
| Path | Realistic failure | Covered by | User sees |
|---|---|---|---|
| Alias codemod | a regex misses a use or eats a suffix (`--text-xl` vs `--text-xlarge`) | dead-reference guard (an undefined name fails), typecheck/build, full matrix | nothing, because CI fails first |
| Dead-ref → token mapping | a wrong token, e.g. `--success` text on a `--success-subtle` ground below 7:1 | `rendered pairs` contrast test plus axe light/dark on the 8 surfaces | caught before merge |
| Literal → token in one scheme only | right in light, wrong in dark | matrix runs both schemes (D4) | caught before merge |
| Mono amounts | Plex Mono is wider, so a KPI or table column overflows | layout matrix plus `KNOWN_OVERFLOW` baseline | caught before merge |
| Guard false negative | a colour built by string concatenation in TSX (D3 accepted the miss) | none, but there are 0 today, and code review | a stray colour; low impact |

Critical gaps: 0.

### Worktree parallelization strategy
| Step | Modules touched | Depends on |
|---|---|---|
| 1 Guard + tokens + baseline | `src/styles`, `src/test/css`, `qa/` | — |
| 2 Alias codemod | all CSS (`src/**`) | 1 |
| 3–7 Surface groups | separate dirs, but each edits the shared frozen lists in `brand.test.ts` | 2 |
| 8 Density | `src/index.css`, `src/styles/theme.css`, `qa/` | 3–7 |
| 9 Docs | `.claude/` | 8 |

Implementation is sequential. Commits 3–7 are in disjoint directories, but each one
edits `KNOWN_LITERALS` in `brand.test.ts`, and the before/after review goes surface by
surface. Running them in parallel would only add merge conflicts in one file.

### Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific finding above.

- [ ] **T1 (P1, human: ~3h / CC: ~25min)** — QA matrix: extend `brand.spec.ts` to 8 surfaces × light/dark × EN/AR × 375/1280, add `enableOptionalArea`, and baseline on main `a48f72d`.
  - Surfaced by: Test review, T1 / D4 (`brand.spec.ts:233/263`)
  - Files: `qa/specs/web/brand.spec.ts`, `qa/support/app.ts`
  - Verify: `npx playwright test -c qa/playwright.config.ts qa/specs/web/brand.spec.ts` green on main, with baseline overflows recorded
- [ ] **T2 (P1, human: ~1h / CC: ~10min)** — Guard: TS/TSX detection by exact whole-string colour plus numeric style keys, and a `<style>` ban, with fixtures for `'#add'`, prose `rgb(` and `&#9998;`.
  - Surfaced by: Code quality, Q1 / D3
  - Files: `src/test/css/brandCss.ts`, `src/styles/__tests__/brand.test.ts`
  - Verify: `npx vitest run src/styles/__tests__/brand.test.ts`
- [ ] **T3 (P2, human: ~1h / CC: ~10min)** — Density: wire `.data-table td { height: var(--table-row-height) }`, token 48, Clients row ≥48px assertion.
  - Surfaced by: Scope Challenge, F1 / D2 (`src/index.css:2111`)
  - Files: `src/index.css`, `src/styles/theme.css`, `qa/specs/web/brand.spec.ts`
  - Verify: brand.spec row-height assertion at 1280

### Unresolved decisions
None.

### Completion summary
- **Step 0: Scope Challenge.** Scope accepted as-is; the structure changed to the smaller
  arrangement (D1).
- **Architecture review:** 0 issues found.
- **Code quality review:** 1 issue found (Q1 → D3).
- **Test review:** diagram produced; 1 contract gap (T1 → D4); 14 path gaps, all planned
  in commits 1 and 8.
- **Performance review:** 0 issues found.
- **NOT in scope** and **What already exists:** written.
- **Follow-ups:** 1 proposed and filed as Jira MUT-165, by the owner's choice, not
  TODOS.md.
- **Failure modes:** 0 critical gaps flagged.
- **Unresolved decisions:** 0 in this review.
- **Outside voice:** Codex was unavailable (CLI not installed), and the native fallback
  was unavailable because the session has no TaskOutput tool. This is missing coverage,
  not a clean result.
- **Parallelization:** 0 lanes; sequential (shared frozen lists).
- **Lake Score:** 3/3. D2, D3 and D4 each picked the 10/10 or highest-scored option.

### Suppressed findings (appendix)
- `[P3] (confidence: 4/10)` `KNOWN_LITERALS` keyed by count lets one literal be swapped
  for another in the same file during the sweep. It's temporary, since the map ends at
  `{}`. No change.
- `[P3] (confidence: 3/10)` `.drawer { right: 0 }` (`index.css:2258`) is a physical
  property next to RTL. It predates this plan and belongs to MUT-109 (TD-048 direction).

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex (`/plan-eng-review` outside voice) | Independent 2nd opinion | 1 | unavailable | Codex CLI not installed; native fallback lacked TaskOutput |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | ISSUES OPEN (all resolved) | 2 issues, 0 critical gaps (plus Scope Challenge F1) |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, plan-review: unavailable (not installed). The native
  fallback was unavailable (no TaskOutput), so there are no outside findings and no
  clean credit.
- **VERDICT:** no review is CLEAR. Eng review found 2 issues plus F1, and every one is
  resolved into the plan (D1–D5); `issues_open` here means mapped work. Eng review
  required.

NO UNRESOLVED DECISIONS
