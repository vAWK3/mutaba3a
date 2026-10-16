# MUT-165 — Brand v2 spacing guard: no px padding, margin or gap outside the token file

- **Ticket:** MUT-165 (Task, epic MUT-101 Brand v2). Jira status: Backlog.
- **Blocked by:** MUT-103. It is merged to local main (`bae70b8`, not pushed) and Jira shows In Review, so the gate passes.
- **Raised in:** the MUT-103 eng review, decision D5 (2026-10-13). See `mut-103-brand-v2-app-sweep.md`.
- **Status of this brief:** eng-reviewed 2026-10-16. Decisions D1–D12 are approved (ledger at the end), and it is
  ready for /eng-build.

## Problem

MUT-103 made colours, font sizes and radii token-only. The `literals` describe in
`src/styles/__tests__/brand.test.ts` enforces that. Spacing is not guarded, so the
density MUT-103 set can drift back one value at a time.

## Census (main `9866f0f`, 2026-10-16)

The ticket counted 110 px values on 2026-10-13. Re-counted today with postcss, the way the guard will
parse:

| What | Declarations | Files |
|---|---|---|
| CSS, px spacing (screen rules) | 56 | 14 |
| CSS, rem spacing not on a `--space-*` token | 68 | 5 |
| CSS, px or rem combined | **124** | **16** |
| CSS, inside `@media print` (stays exempt, as in MUT-103) | 6 | — |
| TS/TSX style objects (`gap: 8`, `padding: '12px 16px'`) | **51** | **9** |

These are the CSS files:

| Count | File |
|---|---|
| 40 | `src/pages/settings/ImportDataPage.css` |
| 28 | `src/index.css` |
| 14 | `src/components/csv/CSVValidationPreview.css` |
| 12 | `src/components/ui/RecurringOccurrenceCard.css` (live: the Expenses forecast, via `RecurringOccurrenceList`) |
| 5 | `src/hosted/hosted.css` |
| 3 to 4 each | `EntityTypeahead`, `ProfileQuickPicker`, `LandingPage`, `HeroSection` |
| 1 to 2 each | `WelcomeModal`, `DemoBanner`, `SegmentedControl`, `PrivacyPolicyPage`, `RecurringMarkPaidDrawer`, `FxRateReadout`, `ProfileSwitcher` |

These are the TSX files: `InsightsPage` 12, `AboutSection` 9, `ExportDataModal` 8,
`ProjectDetailPage` 7, `ExpensesLedgerPage` 5, `IncomePage` 4, `BusinessProfileDrawer` 2,
`ConversionsPage` 2, `SettingsPage` 2.

**Values, in px:**

- 1×7, 2×22, 4×9, 6×8, 8×19, 10×4, 12×15, 16×18, 20×1, 24×12, 32×11, 48×1, 64×7.
- Every one of these is already a `--space-*` step (`--space-px`, `-0-5`, `-1`, `-1-5`, `-2`, `-2-5`, `-3`, `-4`, `-5`,
  `-6`, `-8`, `-12`, `-16`).
- No root `font-size` override exists, so 1rem = 16px. The swap is pixel-identical for these values, except for
  people who raise their browser's default font size (see Risks).

**Off-scale values (11 declarations), the only ones that can move pixels:**

| Site | Value | What it is |
|---|---|---|
| `SegmentedControl.css:7` | `padding: 3px` | track inset |
| `index.css:951` | `gap: 3px` | |
| `index.css:3174` | `margin-top: 3px` | |
| `DemoBanner.css:85,90` | `padding-top: 36px` ×2 | the app shell's offset for the banner's height |
| `RecurringMarkPaidDrawer.css:64` | `calc(18px + var(--space-3))` | lines text up past an 18px control |
| `LandingPage.css:337` | `112px 0` | landing section rhythm |
| `LandingPage.css:971` | `80px 0` | landing section rhythm |
| `HeroSection.css:5` | `96px` | landing section rhythm |
| `PrivacyPolicyPage.css:3` | `160px` | landing section rhythm |
| `PrivacyPolicyPage.css:68` | `120px` | landing section rhythm |

**Side finding, resolved by D7/D8:** `mutaba3a.tokens.json` has a `space` scale, `[4, 8, 12, 16, 20, 24, 28, 32, 48,
56, 96]`. Nothing in the web build reads it, and no drift test checks it. It also disagrees with `theme.css`'s
`--space-*` scale, which has 2, 6, 10, 40 and 64 but not 28, 56 or 96. MUT-165 now reconciles the two on the union.

## Proposed solution

### 1. The guard (in `src/test/css/brandCss.ts` and `brand.test.ts`)

- Add `'spacing'` to `LiteralKind`.
- **CSS:** `cssLiterals` flags a declaration whose property matches
  `^(padding|margin)(-(top|right|bottom|left|inline|block)(-(start|end))?)?$|^(row-|column-)?gap$`
  when its value holds a non-zero px or rem length.
  - Fallbacks count: `var(--space-2, 8px)` is flagged.
  - So is a px inside `calc()`. Only `calc()` built from `--space-*` tokens passes.
  - Allowed: `0`, `auto`, `%`, `em`, and `calc(var(--space-2) * -1)`.
  - Print rules stay exempt (`inPrint`).
  - **Gotcha:** `PX_OR_REM` has the lookbehind `(?<![\w.-])`, so it skips `-8px`. Spacing needs its own
    length regex that also catches negative margins, while still ignoring digits inside custom-property names.
- **TS/TSX:** `scriptLiterals` gains `SCRIPT_SPACING`. It matches the keys `padding|margin|gap|rowGap|columnGap`, plus the
  `Top/Bottom/Left/Right/Inline/Block/InlineStart/InlineEnd/...` suffixes.
  - It flags a non-zero number, which React renders as px.
  - It flags a string that holds a px or rem length anywhere, so multi-value strings like `'24px 0'` count. This
    differs from `SCRIPT_SIZE`, which matches single values only.
  - `'var(--space-2)'`, `0` and `'auto'` pass.
- **Frozen list:** reuse `KNOWN_LITERALS`. It is a per-file count across all kinds, and it is `{}` today.
  - Freeze the spacing counts into it on the guard commit.
  - Its existing three repo tests then enforce shrink-only with no new machinery: no new file, no higher count, no
    stale count. This is DRY over a second `KNOWN_SPACING` map.
  - The guard commit's diff of `KNOWN_LITERALS` is the frozen list.
- **TDD fixtures:** these are written first and fail first.
  - Catches, CSS: `padding: 12px`, `margin-inline-start: 8px`, `gap: 0.5rem`, `margin: -8px`,
    `padding: var(--space-2, 8px)`, `padding-inline-start: calc(18px + var(--space-3))`, `row-gap: 2px`.
  - Leaves alone, CSS: `padding: 0`, `margin: 0 auto`, `padding: 5%`, `gap: 0.5em`, `padding: var(--space-3)`,
    `margin: calc(var(--space-2) * -1)`, `inset: 8px` (not spacing), `--space-x: 8px` (a custom property),
    and `@media print { td { padding: 4px; } }`.
  - **Moves:** `'a { padding: 12px; }'` leaves the MUT-103 "leaves alone" list for the "catches" list.
  - Catches, TS: `gap: 8`, `marginTop: 16`, `padding: '24px 0'`, `marginInlineStart: '8px'`, `rowGap: 4`.
  - Leaves alone, TS: `gap: 'var(--space-2)'`, `margin: 0`, `marginInlineStart: 'auto'`, `padding: '5%'`,
    `const gap = 8;` (not a style key), and `<Stack gap={2}>` (a prop, not a style object).

### 2. The sweep

Each surface group is one commit, and each lowers or deletes its `KNOWN_LITERALS` entries:

0. **Scale commit (D7/D8):** the JSON `space` union, `--m-space-*` in `mutaba3a-theme.css`, `--space-*` remapped,
   and the two drift tests (red first). The named layout and landing tokens (D5/D6) go in theme.css. Pixel-identical.
1. **Guard commit:** the regexes, the var() hop (D10), the fixtures (including the key-disjoint one), `KNOWN_LITERALS`
   frozen and its comment updated. Red, then green. The layout-matrix extensions (D9) and the thumb assertion (D11) run
   once on main for the "before" set.
2. **Shell and shared UI:** `index.css`, `components/ui/*`, `components/layout/*`, `WelcomeModal`,
   `RecurringMarkPaidDrawer`, `DemoBanner`.
3. **Settings, import and the Expenses forecast:** `ImportDataPage.css`, `CSVValidationPreview.css`,
   `RecurringOccurrenceCard.css`.
4. **Inline styles in TSX:** the 9 files. Numbers become `'var(--space-N)'` strings. This is a value swap, not a
   move into classes, which would be refactor creep.
5. **Landing and portal:** `LandingPage.css`, `HeroSection.css`, `PrivacyPolicyPage.css`, `hosted.css`.

**Mapping:** an exact px↔step table, applied by a one-off script. It runs in the scratchpad and is not committed.
Off-scale values are handled per site, as decided in D4–D6.

### 3. Verification

- `brand.test.ts` and the full Vitest suite pass under Node 22, along with lint, typecheck and build.
- The MUT-103 matrix (`@web.brand.layout`) runs on main and then on the branch: 8 surfaces × light/dark ×
  EN/AR × 375/1280.
  - On-scale swaps should give identical screenshots. Only the off-scale surfaces may differ.
  - `KNOWN_OVERFLOW` and `KNOWN_AXE_VIOLATIONS` must not grow.
- Landing and privacy join the matrix, and the portal shell gets a screenshot step (D9).
- The Settings step asserts the segmented thumb is centred (D11).
- The whole Playwright e2e suite passes (ticket AC4).

## Decisions (eng review 2026-10-16, all approved; ledger below)

- **D2: rem counts (R1).** The guard flags px and rem, and the 68 rem declarations are swept.
- **D3: TSX counts (R2).** `SCRIPT_SPACING` is added, and the 51 style-object values become `'var(--space-N)'`.
- **D4: 3px → 2px (R3a).** These move to `--space-0-5`: the SegmentedControl padding and thumb `top`/`bottom`, the
  `.cross-profile-badge` gap and the `.settings-section-icon` margin.
- **D5: named sizes (R3b).** `--demo-banner-height: 36px` and `--checkbox-size: 18px` go in theme.css Layout, each
  used by both the size and the offset.
- **D6: landing tokens (R3c).** `--landing-section-pad` (112), `-compact` (80), `--landing-hero-pad-end` (96),
  `--landing-page-top` (160) and `-compact` (120), all pixel-identical.
- **D7 + D8: one spacing scale (R4, R4b).**
  - `mutaba3a.tokens.json` `space` becomes the union `[2,4,6,8,10,12,16,20,24,28,32,40,48,56,64,96]`.
  - `--m-space-<n>` (rem) go in `mutaba3a-theme.css`.
  - `--space-0-5`…`--space-16` read `var(--m-space-N)`.
  - A drift test checks both ways.
  - Web pixel-identical; Flutter has no scale and is untouched.
- **D9: coverage (R5).** The layout matrix gains `/` and `/privacy`. The portal shell spec gets a screenshot step.
  `qa/features` paths are updated.
- **D10: var() hop (R6).** A spacing value that reads a custom property defined outside `src/styles` with a raw px/rem
  is flagged.
- **D11: thumb assertion (R7).** The matrix's Settings step asserts the segmented thumb is centred, with gaps equal
  to the track's padding.
- **D12: follow-up (R8).** A MUT Task for `/privacy`'s possibly stale 160px top room, filed after MUT-165.
- **F1:** `RecurringOccurrenceCard` is live (`ExpensesLedgerPage.tsx:332`) and is swept in group 3.

## Reuse analysis

- `cssLiterals`, `scriptLiterals`, `literalSourceFiles`, `inPrint`, `KNOWN_LITERALS` and its three repo tests,
  `ALLOWED_LITERAL_FILES`, and the `@web.brand.layout` matrix are all reused unchanged in shape.
- New: one CSS regex, one script regex and one `LiteralKind` value.

## Impact

- **Runtime:** none. The CSS gets slightly smaller.
- **RTL:** values change, properties don't. Physical `left`/`right` stay as they are.
- **Guard cost:** it adds one regex test per declaration in a parse that already runs.
- **i18n, env, infra, cost:** none.

## Risks

- **Browser default font size:** a rem token scales when someone raises their browser's default font size, and the
  px it replaces didn't. That's better for accessibility, but it can widen the 375px layouts for those people. The
  matrix runs at the default size, so it won't show this.
- **Concurrent sessions:** they touch `index.css` often, so merge main into the branch before landing.

## QA scenarios

None new. This is a guard and a value-for-value sweep, with no new user-visible flow. Coverage comes
from:

- `@web.brand.layout`, the matrix. Its screenshots are the before/after evidence.
- The `brand.test.ts` fixtures.
- The new landing/privacy matrix cells and the portal shell screenshot (D9).

`release-qa lint` must stay clean.

## Knowledge updates on landing

- `CHANGELOG.md`.
- `PATTERNS.md`: spacing joins the literal guard.
- `TEST_PLAN.md`.
- `DECISIONS.md`: a new ADR. The union spacing scale becomes brand canonical (JSON edited, `--m-space-*` primitives),
  and named layout/landing tokens are used for sizes off the scale.
- `docs/brand/README.md`: note the JSON `space` edit and the drift test.
- `COMPONENT_REGISTRY.md`: none (no component added or removed).

---

# Eng review (/plan-eng-review, 2026-10-16)

Target: `.claude/designs/mut-165-spacing-guard.md`, the plan above, reviewed on main `9866f0f`.

**Scope record:**
- Feature answers: no cuts proposed.
- Structure: A, Original arrangement (D1, 2026-10-16).
- Accepted scope: the guard in `src/test/css/brandCss.ts` and `brand.test.ts`, with `KNOWN_LITERALS` reused; named
  tokens in `src/styles/theme.css`; sweep commits per surface group.
- Pending remedies: R1 (rem), R2 (TSX), R3 (off-scale), R4 (JSON scale), R5 (landing/portal screenshots).
- **Scope Challenge result:** scope accepted as-is.

**Factual correction F1 (no question):** draft D4 said `RecurringOccurrenceCard` was dead.
`src/pages/expenses/ExpensesLedgerPage.tsx:332` renders `<RecurringOccurrenceList occurrences={forecastOccurrences} compact />`.
D4 is withdrawn, and the file moves into sweep group 3.

## Decision ledger

### R1: do rem lengths count as spacing literals?
Finding: S1, P2, confidence 9/10. In `src/test/css/brandCss.ts:572`, `PX_OR_REM` is used only for font-size. The
ticket's allow-list (0, auto, %, em, calc of tokens) omits rem. Census: 68 raw-rem spacing declarations across 5
files, all on-scale. Reviewer: native.
Plan baseline: the draft D1 proposal was "count px and rem". The ticket text says "px".
Runtime evidence: the census script on main 9866f0f, for example `ImportDataPage.css`, has 40 px/rem declarations.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 rem counts | unguarded | guarded (68 more decls swept) | unguarded (px only) |
| R2 TSX | pending | pending | pending |
| R3 off-scale | pending | pending | pending |
| R4 JSON scale | pending | pending | pending |
| R5 screenshots | pending | pending | pending |
Question D2:
D2 — Do rem spacing values count?
Project/branch/task: MUT-165 spacing guard plan, reviewed on main 9866f0f.
ELI10: The ticket names px values, but `padding: 0.75rem` is the same hard-coded 12px written another way. The
ticket's own list of allowed values doesn't include rem either. There are 68 of them today, mostly in the Import
page, and every one already sits on a `--space-*` step, so sweeping them changes no pixels.
Stakes if we pick wrong: with px only, the next hard-coded spacing value arrives as rem and the guard passes it.
Recommendation: A because rem is the obvious loophole and sweeping it costs minutes with zero pixel change.
Completeness: A=10/10, B=6/10
Pros / cons:
A) Count px and rem (recommended)
  ✅ Closes the loophole: any length that isn't a token fails, whatever its unit
  ✅ All 68 are on-scale, so the swap is pixel-identical and adds no screenshot risk
  ❌ 68 more declarations in the sweep, mostly in ImportDataPage.css (human ~2h / CC ~10min)
B) Count px only, as the ticket's text says
  ✅ Matches the ticket's wording exactly, with a smaller diff
  ❌ `gap: 0.5rem` passes the guard, so spacing can still drift without a test failing
Net: about ten minutes of CC time buys a guard with no unit loophole.
Header: rem lengths
Options:
A) Count px and rem
Guard flags any non-zero px or rem in padding/margin/gap; sweep the 68 rem declarations onto --space-* (on-scale, pixel-identical). Human ~2h / CC ~10min more.
B) px only
Guard flags px only, as the ticket text says; rem spacing stays unguarded and unswept.

State: approved
Actual answer: A, "Count px and rem" (D2, 2026-10-16)
Accepted scope: the guard flags any non-zero px or rem length in padding*/margin*/gap/row-gap/column-gap. The 68
rem declarations are swept onto `--space-*`. Fixtures include `gap: 0.5rem` caught and `gap: 0.5em` left alone.
History: none

### R2: are TS/TSX inline style objects guarded and swept?
Finding: S2, P2, confidence 9/10. 51 spacing literals across 9 files, for example
`src/pages/insights/InsightsPage.tsx:529` `style={{ display: 'flex', gap: 16, marginBottom: 12, ... }}`. Today's
`SCRIPT_SIZE` (`brandCss.ts:604`) covers fontSize and radius keys only. Reviewer: native.
Plan baseline: the draft D6 proposal was to include them. The ticket names CSS only.
Runtime evidence: the TS census on main 9866f0f.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 rem counts | approved: px and rem (D2) | px and rem | px and rem |
| R2 TSX | unguarded | guarded; 51 swept to 'var(--space-N)' | unguarded, unswept |
| R3 off-scale | pending | pending | pending |
| R4 JSON scale | pending | pending | pending |
| R5 screenshots | pending | pending | pending |
Question D3:
D3 — Guard spacing in TSX style objects too?
Project/branch/task: MUT-165 spacing guard plan, reviewed on main 9866f0f.
ELI10: Besides the stylesheets, 9 screens set spacing inline in React, like `style={{ gap: 16 }}`. React renders those
numbers as pixels, so they're the same hard-coded values in a different file type. MUT-103 already guards colours and
sizes in TSX the same way. If only CSS is guarded, the easy dodge is moving the value into `style={{}}`.
Stakes if we pick wrong: the guard reports green while Insights, Settings About and Export keep 51 off-token values.
Recommendation: A because it matches MUT-103's TSX coverage and closes the obvious dodge for minutes of work.
Completeness: A=10/10, B=6/10
Pros / cons:
A) Guard and sweep TSX too (recommended)
  ✅ The same rule holds for colours, sizes and spacing in every source file type
  ✅ All 51 values are on-scale, so the swap to 'var(--space-N)' strings changes no pixels
  ❌ Touches 9 more files, including InsightsPage and ExpensesLedgerPage (human ~2h / CC ~15min)
B) CSS only
  ✅ Exactly the ticket's stated scope, with a smaller diff
  ❌ `style={{ gap: 8 }}` stays legal, so drift moves into components unseen
Net: the TSX half of the guard costs about fifteen minutes and keeps one rule for every source file.
Header: TSX styles
Options:
A) Guard and sweep TSX
Add SCRIPT_SPACING to scriptLiterals (numeric values and px/rem strings on padding/margin/gap keys); swap the 51 values to 'var(--space-N)' strings, no move into classes. Human ~2h / CC ~15min.
B) CSS only
Leave TS/TSX style objects unguarded and unswept.

State: approved
Actual answer: A, "Guard and sweep TSX" (D3, 2026-10-16)
Accepted scope: `SCRIPT_SPACING` in `scriptLiterals` flags non-zero numbers and px/rem strings on padding, margin,
gap, rowGap and columnGap keys, plus their suffixes. The 51 values become `'var(--space-N)'` strings in place, not
classes. TS fixtures cover catches and leaves-alone as in the plan.
History: none

### R3a: the three 3px values
Finding: S3, P2, confidence 9/10.
- `src/components/ui/SegmentedControl.css:7` has `padding: 3px`, and its thumb at `:14-15` has `top: 3px; bottom: 3px;`.
  `top`/`bottom` aren't spacing properties, so snapping only the padding would misalign the thumb.
- `src/index.css:951` has `.cross-profile-badge { gap: 3px }`.
- `src/index.css:3174` has `.settings-section-icon { margin-top: 3px }`, an optical nudge of an icon to the text.
Reviewer: native.
Plan baseline: the draft D2 proposal was to snap all three to `--space-0-5` (2px). It didn't mention the thumb inset.
Runtime evidence: read from source. The pixel effect isn't measured yet.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 rem | approved px+rem (D2) | same | same |
| R2 TSX | approved (D3) | same | same |
| R3a 3px values | 3px ×3 (+ thumb top/bottom 3px) | all → --space-0-5 (2px), thumb top/bottom too | new --space-0-75 (3px) token, no pixel change |
| R3b banner/checkbox | pending | pending | pending |
| R3c landing | pending | pending | pending |
| R4 JSON scale | pending | pending | pending |
| R5 screenshots | pending | pending | pending |
Question D4:
D4 — Where do the three 3px values go?
Project/branch/task: MUT-165 spacing guard plan, reviewed on main 9866f0f.
ELI10: Three spots use 3px, which sits between the 2px and 4px steps. One is the padding inside the segmented
control (the Light/Dark/System toggle); its sliding highlight is pinned 3px from the top and bottom too, so the two
must move together or the highlight sits off-centre. The other two are a badge's icon gap and a Settings icon's
small downward nudge. We can snap them to 2px, or add a 3px step to the scale.
Stakes if we pick wrong: a scale step used three times invites more one-off steps; snapping changes those controls by 1-2px.
Recommendation: A because the control's gap is already 2px, so a 2px inset matches it and the scale stays as it is.
Completeness: A=9/10, B=8/10
Pros / cons:
A) Snap to 2px, thumb included (recommended)
  ✅ The inset matches the control's existing 2px gap, and the scale stays unchanged
  ✅ Thumb top/bottom move with the padding, so the highlight stays centred (screenshot-checked)
  ❌ The segmented control gets 2px shorter, and the Settings icon sits 1px higher (human ~20min / CC ~3min)
B) Add a --space-0-75 (3px) step
  ✅ Zero pixel change, so nothing to eyeball on screenshots
  ❌ It's a new scale step for three uses, and it invites the next off-scale value to ask for one too
Net: 1-2px of visual change buys a scale with no special-case step.
Header: 3px values
Options:
A) Snap to 2px
SegmentedControl padding and thumb top/bottom, the badge gap and the icon margin-top all become var(--space-0-5); check the toggle, badge and Settings icon on screenshots. Human ~20min / CC ~3min.
B) Add a 3px step
Add --space-0-75: 0.1875rem to theme.css and use it at the three sites and the thumb inset; no pixel change.

State: approved
Actual answer: A, "Snap to 2px" (D4, 2026-10-16)
Accepted scope: these all become `var(--space-0-5)`: SegmentedControl `padding` and thumb `top`/`bottom`,
`.cross-profile-badge` `gap`, and `.settings-section-icon` `margin-top`. Check the theme toggle, the badge and the
Settings icon on the matrix screenshots.
History: none

### R3b: banner offset (36px) and the checkbox indent (18px)
Finding: S4, P2, confidence 9/10.
- In `src/components/ui/DemoBanner.css`, `:8` has `height: 36px` and `:85,90` have `padding-top: 36px`. The offset is
  the banner's height written out twice.
- In `src/components/drawers/RecurringMarkPaidDrawer.css`, `:26-27` has `width: 18px; height: 18px` on the checkbox and
  `:64` has `padding-inline-start: calc(18px + var(--space-3))`, which indents past the checkbox.
Reviewer: native.
Plan baseline: the draft D2 proposal was `--demo-banner-height`, plus a named token for the control size.
Runtime evidence: read from source.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 / R2 / R3a | approved (D2, D3, D4) | same | same |
| R3b sizes | 36px and 18px literals | `--demo-banner-height` + `--checkbox-size` in theme.css Layout; each used by both the size and the offset | token arithmetic: `calc(var(--space-8) + var(--space-1))` and `calc(var(--space-4) + var(--space-0-5) + var(--space-3))` |
| R3c landing | pending | pending | pending |
| R4 JSON scale | pending | pending | pending |
| R5 screenshots | pending | pending | pending |
Question D5:
D5 — Name the banner height and checkbox size?
Project/branch/task: MUT-165 spacing guard plan, reviewed on main 9866f0f.
ELI10: Two of the spacing values are really the size of something else. The app shell is pushed down 36px because
the sample-data banner is 36px tall. A line of text is indented 18px plus the row gap because the checkbox beside it is
18px wide. Today each number is typed twice, so changing the banner's height leaves a gap or an overlap. A named token
used in both places keeps them in step.
Stakes if we pick wrong: with token arithmetic, the banner's height and the shell offset can drift apart again, silently.
Recommendation: A because one name for one size fixes the real duplication, not just the guard.
Completeness: A=10/10, B=6/10
Pros / cons:
A) Two named layout tokens (recommended)
  ✅ The banner height and the shell offset can't disagree, because both read --demo-banner-height
  ✅ Sits beside --topbar-height and --drawer-width, the Layout block's existing pattern
  ❌ Two new names in theme.css for one component each (human ~20min / CC ~3min)
B) Token arithmetic in calc()
  ✅ No new names, and the guard passes
  ❌ `calc(var(--space-8) + var(--space-1))` hides what 36px means, and the height stays a separate literal
Net: two names fix a real duplicated size; arithmetic only hides it from the guard.
Header: Named sizes
Options:
A) Two layout tokens
Add --demo-banner-height: 36px and --checkbox-size: 18px to theme.css Layout; DemoBanner height + both shell offsets use the first, the drawer checkbox width/height + indent calc use the second. Human ~20min / CC ~3min.
B) Token arithmetic
Rewrite the two offsets as calc() of --space-* steps; leave the 36px height and 18px checkbox size as they are.

State: approved
Actual answer: A, "Two layout tokens" (D5, 2026-10-16)
Accepted scope: `--demo-banner-height: 36px` and `--checkbox-size: 18px` go in theme.css's Layout block.
- `.demo-banner` `height` and both `.app-shell` `padding-top` offsets read `--demo-banner-height`.
- `.recurring-drawer-check` `width`/`height` read `--checkbox-size`.
- The indent becomes `calc(var(--checkbox-size) + var(--space-3))`.
History: none

### R3c: landing and privacy section rhythm (80/96/112/120/160px)
Finding: S5, P2, confidence 9/10. The landing page's sections use values far past the top `--space-16` (64px) step:
- `src/pages/landing/LandingPage.css:337` `.landing-section { padding: 112px 0 }`, and `:971` gives `80px 0` at ≤900px.
- `HeroSection.css:5` `padding-bottom: 96px`.
- `PrivacyPolicyPage.css:3` `padding-top: 160px`, and `:68` gives `120px` at ≤640px.

Snapping any of these to 64px would visibly change the landing page. Side observation: the hero's comment says the
sticky bar now sits in the flow (MUT-77), so the hero went down to `--space-16` on top. Privacy's 160px may be stale
room for the old fixed bar. That's a design call, not this ticket's, and it isn't changed here. Reviewer: native.
Plan baseline: the draft D2 proposal was landing-only layout tokens in theme.css.
Runtime evidence: read from source.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 / R2 / R3a / R3b | approved (D2–D5) | same | same |
| R3c landing | 5 px literals | named landing tokens in theme.css Layout, pixel-identical | general scale grows: --space-20/24/28/30/40, pixel-identical |
| R4 JSON scale | pending | pending | pending |
| R5 screenshots | pending | pending | pending |
Question D6:
D6 — Landing section sizes: named tokens or bigger scale steps?
Project/branch/task: MUT-165 spacing guard plan, reviewed on main 9866f0f.
ELI10: The marketing page gives each section a lot of breathing room, from 80 to 160px. The app's spacing scale stops
at 64px. We can name these sizes for what they are (landing section padding, privacy page top), or add bigger general
steps (80, 96, 112, 120, 160) that any screen could use. Both keep every pixel as it is today.
Stakes if we pick wrong: big general steps can creep into the dense app screens, the density MUT-103 just set.
Recommendation: A because these sizes describe one page's rhythm, and naming them keeps the app scale tight.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Named landing tokens (recommended)
  ✅ `--landing-section-pad` says why the value is 112px, and the app's dense scale stays capped at 64px
  ✅ The ≤900px and ≤640px variants are named beside their desktop value, so the pairs stay visible
  ❌ Five page-specific names in theme.css (human ~30min / CC ~5min)
B) Extend the --space scale
  ✅ Fewer concepts: one scale for everything, like Tailwind's --space-20/24
  ❌ A 160px step becomes a legal choice for app padding, so density can drift with the guard green
Net: page-specific names protect the app's density; bigger steps trade that for one fewer concept.
Header: Landing sizes
Options:
A) Named landing tokens
Add to theme.css Layout: --landing-section-pad (112px), --landing-section-pad-compact (80px), --landing-hero-pad-end (96px), --landing-page-top (160px), --landing-page-top-compact (120px); the five sites use them. Pixel-identical. Human ~30min / CC ~5min.
B) Extend the scale
Add --space-20 (80), --space-24 (96), --space-28 (112), --space-30 (120), --space-40 (160) to the --space-* scale and use them at the five sites. Pixel-identical.

State: approved
Actual answer: A, "Named landing tokens" (D6, 2026-10-16)
Accepted scope: theme.css's Layout block gets `--landing-section-pad` (112px), `--landing-section-pad-compact`
(80px), `--landing-hero-pad-end` (96px), `--landing-page-top` (160px) and `--landing-page-top-compact` (120px). The five
sites use them, pixel-identical. Privacy's 160px stays as it is (observation only).
History: none

### R4: the unused `space` scale in mutaba3a.tokens.json
Finding: S6, P3, confidence 9/10. `src/styles/brand/mutaba3a.tokens.json:156` has
`"space": [4, 8, 12, 16, 20, 24, 28, 32, 48, 56, 96]`.
- No `--m-space-*` exists in `mutaba3a-theme.css`.
- The `drift` describe (`brand.test.ts:298`) checks colours, radii, fonts and motion, but not space.
- `theme.css:65-79` `--space-*` has 2, 6, 10, 40 and 64, and has no 28, 56 or 96.

Reviewer: native.
Plan baseline: the draft D3 proposal was out of scope, plus a TD and a follow-up.
Runtime evidence: read from source. Unknown: whether the Flutter app reads the JSON scale.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1–R3c | approved (D2–D6) | same | same |
| R4 JSON scale | unreconciled, unguarded | out of scope; new TD + follow-up Jira ticket proposed | reconcile in MUT-165: pick a canonical scale, add --m-space-* + drift test |
| R5 screenshots | pending | pending | pending |
Question D7:
D7 — Reconcile the brand JSON's spacing scale now or later?
Project/branch/task: MUT-165 spacing guard plan, reviewed on main 9866f0f.
ELI10: The brand's token file lists a spacing scale (4, 8, 12 ... 56, 96), but the web app never reads it and uses its
own slightly different scale. This ticket snaps everything onto the web app's scale. Deciding which scale is the
real brand one is a design question, and it could touch the phone app too.
Stakes if we pick wrong: doing it now changes pixels app-wide and spreads into Flutter; leaving it means two scales disagree a while longer.
Recommendation: A because the guard only needs one scale to point at, and choosing the canonical one is Basel's design call across two repos.
Completeness: A=8/10, B=10/10
Pros / cons:
A) Defer with a TD and a follow-up ticket (recommended)
  ✅ MUT-165 stays a pixel-identical sweep, with only the approved off-scale changes moving anything
  ✅ The mismatch is written down (TD + Jira) instead of forgotten, with where to start
  ❌ Two disagreeing scales live on until the follow-up lands (human ~10min / CC ~2min to file)
B) Reconcile in MUT-165
  ✅ One scale everywhere, with a drift test that keeps the JSON and CSS equal
  ❌ It needs a design decision first, may move pixels on every screen and may reach the Flutter theme (human ~1d / CC ~1h)
Net: keep this ticket a guard plus a sweep; the scale choice gets its own ticket and its own decision.
Header: JSON scale
Options:
A) Defer: TD + ticket
Snap to theme.css --space-* in MUT-165; add a TECH_DEBT entry and propose a follow-up Jira ticket (decide the canonical scale, add --m-space-* and a drift test). Human ~10min / CC ~2min.
B) Reconcile now
Pick the canonical scale inside MUT-165, add --m-space-* primitives and a JSON drift test, and remap --space-* to them.

State: approved
Actual answer: B, "Reconcile now" (D7, 2026-10-16). This was against the recommendation.
Accepted scope: MUT-165 picks the canonical spacing scale (which one is R4b, pending). It adds `--m-space-*`
primitives to `mutaba3a-theme.css` and a `drift` test that JSON `space` equals the `--m-space-*` set, and maps
`--space-*` onto `--m-space-*`.
History: none

### R4b: which scale is canonical?
Finding: follows R4. Evidence:
- JSON `[4, 8, 12, 16, 20, 24, 28, 32, 48, 56, 96]`.
- Web steps in use (`var(--space-N)` counts in src): 0-5 (2px) ×3, 1 ×102, 1-5 (6px) ×22, 2 ×211, 2-5 (10px) ×30,
  3 ×193, 4 ×167, 5 ×57, 6 ×50, 8 ×25, 10 (40px) ×7, 12 ×11, 16 (64px) ×5.
- The sweep adds 2px ×22, 6px ×8, 10px ×4 and 64px ×7 more.
- So 2, 6, 10, 40 and 64px carry about 110 uses that the JSON lacks. The JSON's 28, 56 and 96 have no web use.
- The Flutter app has no spacing scale: `lib/presentation/theme/mutaba3a_theme.dart` uses `EdgeInsets` literals, so
  neither option reaches the phone.

Reviewer: native.
Plan baseline: none. This is new after D7.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1–R3c, R4 | approved (D2–D7) | same | same |
| R4b canonical | two scales | JSON becomes the union [2,4,6,8,10,12,16,20,24,28,32,40,48,56,64,96]; web pixel-identical | JSON as delivered; web's 2/6/10/40/64 snap to JSON steps (~110 sites move) |
| R5 screenshots | pending | pending | pending |
Question D8:
D8 — Which spacing scale wins?
Project/branch/task: MUT-165 spacing guard plan, reviewed on main 9866f0f.
ELI10: Reconciling means one list of spacing steps that the brand file and the web app both obey. The web app uses five
steps the brand file doesn't have: 2, 6, 10, 40 and 64px, in about 110 places, mostly tight gaps and paddings in
tables and chips. We can add those steps to the brand file, so nothing on screen moves. Or we can treat the brand file
as law, and snap those 110 places to its nearest steps, which visibly changes the density of dense screens. The phone
app has no scale, so it's untouched either way.
Stakes if we pick wrong: option B reshuffles density on Income, Clients and the drawers that MUT-103 just set and reviewed.
Recommendation: A because the web's extra steps are the ones dense screens need, and the union keeps every brand step as well.
Completeness: A=10/10, B=9/10
Pros / cons:
A) The JSON takes the union scale (recommended)
  ✅ No pixel moves from the reconcile itself: --space-* maps 1:1 onto --m-space-* values
  ✅ Keeps the brand's 28, 56 and 96 steps, so the landing tokens can sit on them later if wanted
  ❌ Edits the delivered brand JSON: 16 steps instead of 11 (human ~1h / CC ~10min)
B) The JSON as delivered is the law
  ✅ The brand file stays exactly as delivered, and the scale stays smaller
  ❌ About 110 sites snap 1-8px (2→4, 6→4/8, 10→8/12, 40→32/48, 64→56), so the dense screens need a full visual re-review (human ~1d / CC ~1h)
Net: the union reconciles without moving a pixel; brand-as-law buys a smaller scale at the cost of re-doing density.
Header: Canonical scale
Options:
A) Union scale in JSON
JSON space becomes [2,4,6,8,10,12,16,20,24,28,32,40,48,56,64,96]; add --m-space-2…--m-space-96 to mutaba3a-theme.css; --space-* point at them; drift test both ways. Web pixel-identical. Human ~1h / CC ~10min.
B) JSON as delivered
Keep JSON [4..96]; add --m-space-* for those 11; remap or remove --space-0-5/-1-5/-2-5/-10/-16 and snap their ~110 uses to the nearest JSON step; full matrix re-review.

State: approved
Actual answer: A, "Union scale in JSON" (D8, 2026-10-16)
Accepted scope:
- `mutaba3a.tokens.json` `space` becomes `[2, 4, 6, 8, 10, 12, 16, 20, 24, 28, 32, 40, 48, 56, 64, 96]`.
- `mutaba3a-theme.css` gets `--m-space-2` … `--m-space-96` in rem, primitives only (PD7).
- The `theme.css` `--space-0-5`…`--space-16` names stay and read `var(--m-space-N)`. `--space-0`/`--space-px` stay
  literal.
- A new `drift` test checks both ways: every JSON step has `--m-space-<n>` equal to n px, and every `--m-space-*` is a
  JSON step.
- Web pixel-identical.
- Flutter is untouched: it has no scale.
- `docs/brand/README.md` notes the JSON edit.
History: none

### R5: screenshot coverage for the landing, privacy and portal surfaces
Finding: S7, P2, confidence 8/10.
- The `@web.brand.layout` matrix (`qa/specs/web/brand.spec.ts:286`) covers app surfaces only.
- Sweep group 5 touches `LandingPage.css`, `HeroSection.css`, `PrivacyPolicyPage.css` and `hosted.css`, which have no
  before/after evidence.
- TD-130 already records that the landing QA specs aren't in the release-qa catalog.

Reviewer: native.
Plan baseline: the draft D5 proposal was a one-off capture attached to Jira, with no spec change.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1–R4b | approved (D2–D8) | same | same |
| R5 coverage | none for landing/privacy/portal | add landing + privacy to the layout matrix (fits + screenshots) and a portal shell screenshot step; durable | one-off before/after capture attached to Jira; no spec change |
Question D9:
D9 — Landing, privacy and portal: durable coverage or one-off screenshots?
Project/branch/task: MUT-165 spacing guard plan, reviewed on main 9866f0f.
ELI10: The app screens already have an automatic check that takes screenshots and fails if anything spills sideways
on a phone. The marketing page, the privacy page and the hosted portal don't. This ticket changes their spacing
values (to identical pixels). We can add them to that automatic check, so this and every later change is covered, or
just take before/after pictures by hand once.
Stakes if we pick wrong: with one-off pictures, the next spacing change on the landing page has no overflow check at 375px.
Recommendation: A because the matrix already exists and adding three surfaces is cheap, durable coverage.
Completeness: A=10/10, B=7/10
Pros / cons:
A) Add them to the matrix (recommended)
  ✅ The landing and privacy pages get the same 375/1280 × EN/AR × light/dark fit check the app has
  ✅ The portal shell screenshot gives this sweep, and every later one, before/after evidence
  ❌ About 8 more matrix cells per run and a qa/features paths update (human ~2h / CC ~20min)
B) One-off capture on Jira
  ✅ No spec change, and it's the fastest way to show these pixels didn't move
  ❌ The evidence lives in a Jira comment, so the next landing change starts blind again
Net: twenty minutes buys a permanent fit check on the three surfaces the matrix misses.
Header: Coverage
Options:
A) Add to the matrix
Extend @web.brand.layout with the landing (/) and privacy (/privacy) pages (expectFits + screenshots) and add a screenshot step to the portal shell spec; update qa/features paths; run once until green. Human ~2h / CC ~20min.
B) One-off capture
Capture /, /privacy and the portal shell at 375/1280 × EN/AR before and after, attach to Jira; no spec change.

State: approved
Actual answer: A, "Add to the matrix" (D9, 2026-10-16)
Accepted scope:
- `@web.brand.layout` gains the landing (`/`) and privacy (`/privacy`) pages, with `expectFits` plus screenshots across
  the existing scheme × viewport × language loop.
- `qa/specs/portal/shell.spec.ts` gains a screenshot step.
- `qa/features` `paths` cover the landing/privacy CSS and `hosted.css`.
- Each changed spec runs once until green, before and after the sweep.

History: none

**Scope Challenge C dispositions:** F1 is a factual correction. R1–R5 and R4b were accepted (D2–D9). R4 was approved
against the recommendation.

## Review sections

### Section 1: Architecture

- `[P2] (confidence: 7/10) src/test/css/brandCss.ts:588` is the custom-property bypass, R6 below. The guard reads
  the spacing declaration's own value only, so `--pad: 8px; padding: var(--pad);` in a component stylesheet passes.
  - Today nobody does it. The 7 component custom properties with px/rem are `Switch.css:4-7` (`--switch-width`,
    `--switch-height`, `--switch-knob`, `--switch-pad: 3px`), `hosted.css:9-10` (`--hp-sidebar-width`,
    `--hp-card-width`) and `ClientsLayout.css:15`.
  - Not one is read by a spacing property. `--switch-pad` feeds `inset-block-start` (`Switch.css:23`), and
    `--hp-gutter` is `var(--space-4)` (`hosted.css:11`).
- Layering is sound: `--space-*` → `--m-space-*` mirrors `--radius-sm: var(--m-radius-sm)` (`theme.css:82`). Drift is
  JSON ↔ `--m-space-*`, the same as radii. `Tokens.px` already converts rem (`brandCss.ts:450-454`).
- Distribution, security, data: none. A test, CSS values and a JSON token.

### R6: close the custom-property bypass?
Finding: Section 1, P2, confidence 7/10, `src/test/css/brandCss.ts:588`. Reviewer: native.
Plan baseline: not covered. The plan's fixture `--space-x: 8px` is "left alone".
Runtime evidence: the probe on main 9866f0f found 0 spacing declarations reading a component-local px/rem custom
property.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1–R5 | approved (D2–D9) | same | same |
| R6 bypass | open | flag a spacing decl whose var(--x) is defined outside src/styles with a raw px/rem; fixture proves it | leave open; PATTERNS.md says spacing custom properties must read --space-* |
Question D10:
D10 — Close the "local custom property" bypass?
Project/branch/task: MUT-165 spacing guard plan, reviewed on main 9866f0f.
ELI10: The guard checks the value written on `padding`, `margin` and `gap`. A component can dodge it by writing
`--pad: 8px` at the top of its stylesheet and then `padding: var(--pad)`. Nobody does this today; the few local custom
properties holding px are switch and sidebar sizes. We can teach the guard to follow that one hop: if a spacing value
reads a variable defined outside the token files with a raw px, flag it.
Stakes if we pick wrong: leaving it open means the guard can be satisfied without using the scale, by anyone in a hurry.
Recommendation: A because the check is about 15 lines over a parse that already runs, and it removes the one known dodge.
Completeness: A=10/10, B=7/10
Pros / cons:
A) Follow the one var() hop (recommended)
  ✅ `--pad: 8px; padding: var(--pad)` fails with the file and line, so the dodge is closed
  ✅ Zero offenders today, so it freezes nothing and adds no sweep work
  ❌ A second pass that collects local custom-property definitions, plus fixtures (human ~1h / CC ~10min)
B) Leave it, document the rule
  ✅ No extra guard code; PATTERNS.md states the rule for reviewers
  ❌ It relies on review to catch the dodge, the exact thing the guard exists to replace
Net: ten minutes of guard code turns a written rule into a failing test.
Header: var() bypass
Options:
A) Follow the var() hop
Collect custom properties defined outside src/styles with a raw px/rem value; flag a padding/margin/gap declaration that reads one; fixtures: caught `--pad: 8px; padding: var(--pad)`, left alone `--pad: var(--space-2); padding: var(--pad)` and `--switch-pad: 3px; inset-block-start: var(--switch-pad)`. Human ~1h / CC ~10min.
B) Document only
Leave the guard reading the declared value only; add the rule to PATTERNS.md.

State: approved
Actual answer: A, "Follow the var() hop" (D10, 2026-10-16)
Accepted scope: a second pass collects custom properties defined outside `src/styles` with a raw px/rem value. A
padding/margin/gap declaration that reads one is flagged as `spacing`. Fixtures:
- Caught: `--pad: 8px; padding: var(--pad)`.
- Left alone: `--pad: var(--space-2); padding: var(--pad)`.
- Left alone: `--switch-pad: 3px; inset-block-start: var(--switch-pad)`.

Zero offenders today.
History: none

Section 1 dispositions: R6 accepted (D10).

### Section 2: Code quality

- `[P3] (confidence: 9/10) src/styles/__tests__/brand.test.ts:869-873`: the `KNOWN_LITERALS` doc comment says
  "counted 2026-10-13 on main a48f72d ... each MUT-103 surface commit". The guard commit rewrites it for the MUT-165
  freeze. This is required documentation of approved behavior, so no question.
- `[P3] (confidence: 8/10) src/test/css/brandCss.ts:604`: `SCRIPT_SIZE` and the new `SCRIPT_SPACING` must stay
  key-disjoint, or one `style` key is counted twice. They are disjoint by construction (fontSize/radius vs
  padding/margin/gap). A fixture `style={{ fontSize: 12, gap: 8 }}` expecting `['font-size', 'spacing']` proves it.
  This is required proof, so no question.
- Checked and fine: both entry points load the brand primitives. `src/main.tsx:8` and `src/hosted/main.tsx:5` import
  `theme.css`, which `@import`s `brand/mutaba3a-theme.css` (`theme.css:19`). `--m-space-*` resolve in the app, the
  landing page and the portal. The boot splash (`boot-splash.css`) reads no `var()`, so remapping can't break the pre-JS
  paint.
- No shared-code extraction is proposed. The plan extends `cssLiterals` and `scriptLiterals`, which already have two
  callers each (the fixture describes and the repo describe).

Section 2 dispositions: both findings are folded in as required proof and docs, with no new choice.

### Section 3: Tests

Framework: Vitest (`npm run test:run`, Node 22, TD-054) for the guard and drift. Playwright (`qa/specs/**`, release-qa)
for layout.

```
CODE PATHS                                              USER FLOWS
[+] brandCss.ts cssLiterals() spacing branch            [+] @web.brand.layout matrix (8 app surfaces)
  ├── px on padding/margin/gap      [GAP→fixture]         ├── [★★★ TESTED] fits + screenshots, brand.spec.ts:286
  ├── rem (R1)                      [GAP→fixture]         ├── [GAP] [→E2E] landing + privacy cells (R5/D9)
  ├── negative -8px (own regex)     [GAP→fixture]         └── [GAP] [→E2E] portal shell screenshot (R5/D9)
  ├── var(--space-2, 8px) fallback  [GAP→fixture]       [+] Theme toggle (SegmentedControl, R3a 3→2px)
  ├── calc(18px + token)            [GAP→fixture]         └── [GAP] thumb stays centred in its track (R7)
  ├── allowed 0/auto/%/em/token/calc(token)  [GAP→fixture]  [+] Demo banner offset (R3b)
  ├── not spacing: inset, --x def   [GAP→fixture]         └── [★★ structural] one token feeds height + offset
  ├── @media print exempt           [GAP→fixture]
  └── var() hop (R6)                [GAP→fixture]
[+] scriptLiterals() SCRIPT_SPACING (R2)
  ├── numbers / px-rem strings      [GAP→fixture]
  ├── token strings, 0, auto, %     [GAP→fixture]
  ├── non-style `const gap = 8`, `gap={2}` prop  [GAP→fixture]
  └── key-disjoint with SCRIPT_SIZE [GAP→fixture]
[+] repo describe: KNOWN_LITERALS shrink-only  [★★★ TESTED] brand.test.ts:971-988
[+] drift (R4/R4b)
  ├── JSON space == --m-space-* set, both ways   [GAP→unit]
  └── every --space-N (not 0/px) is a JSON step  [GAP→unit]

COVERAGE today: 2/17 paths (12%) | after plan: 17/17
QUALITY: ★★★:2 ★★:1 | GAPS: 15 (2 E2E, 1 regression contract pending)
```

Proposed tests, each extending an existing file:
- `src/styles/__tests__/brand.test.ts` `literals > in CSS`: new rows in the existing `it.each` catches/leaves tables,
  plus a var-hop case.
  - Value: protects=no px/rem spacing outside src/styles; fails_when=the spacing branch or its regex regresses;
    why_new=no spacing kind exists today; seam=none.
- The same file, `literals > in TS and TSX`: new rows in the existing tables.
  - Value: protects=inline style spacing stays on tokens; fails_when=SCRIPT_SPACING misses a key or a string form;
    why_new=SCRIPT_SIZE covers fontSize/radius only; seam=none.
- The same file, `drift`: 2 new `it` blocks beside the radii one.
  - Value: protects=JSON space and CSS primitives agree; fails_when=a step is added on one side only; why_new=drift has
    no space check; seam=none.
- `qa/specs/web/brand.spec.ts` matrix: landing and privacy steps; `qa/specs/portal/shell.spec.ts`: a screenshot step.
  - Value: protects=the landing/privacy pages fit 375/1280 in both languages; fails_when=a spacing token change
    overflows them; why_new=the matrix skips marketing pages; seam=none.

**Tests made obsolete:** none. `'a { padding: 12px; }'` moves from "leaves alone" to "catches"; it isn't deleted.

**Regression rule:** existing layouts of all 25 swept files are at risk.
- They're covered by the matrix's `expectFits` and screenshots, with `KNOWN_OVERFLOW` and `KNOWN_AXE_VIOLATIONS` not
  growing. That's ticket AC3, and it's carried forward.
- One planned change has no automated guard: the thumb inset (R3a). See R7.

### R7: regression contract for the theme toggle's thumb (R3a)
Finding: Section 3, P2, confidence 8/10, `src/components/ui/SegmentedControl.css:7,14-15`. Reviewer: native.
- The track `padding` and the thumb `top`/`bottom` move from 3px to `--space-0-5` together.
- If one is missed, the highlight sits off-centre.
- Screenshots show it only to a human reviewer.

Plan baseline: R3a (D4) says "check on screenshots".
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1–R6 | approved (D2–D10) | same | same |
| R7 thumb coverage | none | Playwright assertion in the @web.brand.layout Settings step (Language/Theme segmented radiogroups): thumb's top and bottom gaps to the track are equal and match the track's padding-top | matrix screenshot review only, recorded in the Jira comment |
Question D11:
D11 — How do we prove the segmented control's highlight stays centred?
Project/branch/task: MUT-165 spacing guard plan, reviewed on main 9866f0f.
ELI10: The segmented controls in Settings (Language, Theme) and three portal drawers have a sliding highlight. Its inset is set in two places: the toggle's padding and
the highlight's top and bottom. This ticket moves both from 3px to 2px. If a later change moves only one, the
highlight sits off-centre, and today only a person looking at a screenshot would notice. A tiny browser check can
measure that the gaps above and below the highlight are equal.
Stakes if we pick wrong: an off-centre highlight ships unnoticed in Settings and the portal's income, payment and profile drawers.
Recommendation: A because it's a few lines in a matrix step that already opens Settings, and it keeps the two inset values honest forever.
Completeness: A=10/10, B=6/10
Pros / cons:
A) Assert it in the matrix's Settings step (recommended)
  ✅ It measures the thumb's top and bottom gaps in a real browser and fails if they differ or drift from the padding
  ✅ It reuses the @web.brand.layout Settings step, so it runs at 375 and 1280 in both languages and schemes
  ❌ A layout assertion that a deliberate redesign of the toggle will need to update (human ~30min / CC ~5min)
B) Screenshot review only
  ✅ No new assertion to maintain
  ❌ It depends on someone noticing a 1px offset in a 16-cell screenshot set
Net: five minutes buys an automatic check on the one place this sweep can visibly misalign.
Header: Thumb check
Options:
A) Assert in Settings step
In the @web.brand.layout Settings step, read a segmented radiogroup's track and thumb boxes; expect thumb.top - track.top == track.bottom - thumb.bottom == the track's computed padding-top. Human ~30min / CC ~5min.
B) Screenshots only
Rely on the layout matrix screenshots, reviewed by hand and noted in the Jira comment.

State: approved
Actual answer: A, "Assert in Settings step" (D11, 2026-10-16)
Accepted scope: the `@web.brand.layout` Settings step reads a segmented radiogroup's track and thumb boxes. It expects
`thumb.top - track.top == track.bottom - thumb.bottom ==` the track's computed `padding-top`, in every matrix cell.
History: none

Section 3 dispositions: the test gaps are folded in as required proof of D2–D10. R7 was accepted (D11).

### Section 4: Performance

No issues found.
- The guard adds about 5 regexes per declaration and one extra custom-property pass, over the ~55 CSS and ~400 TS files
  that `literals` already parses once per run.
- At runtime there's no cost. `--space-*` → `--m-space-*` adds one `var()` indirection per token, resolved once per
  computed style, the same as radii today.

### Outside voice

Unavailable. Codex isn't installed, and this session lacks the TaskOutput tool that the bounded native fallback needs.
There's no outside coverage and no clean credit.

## Final planning decisions

### R8 (TODO): the privacy page's top room
- **What:** check whether `/privacy`'s `padding-top: 160px` (120px at ≤640) is stale room for the header that was fixed
  before MUT-77.
- **Why:** MUT-77 put the sticky bar in the flow, and the hero dropped to `--space-16` on top. Privacy may now show an
  oversized gap.
- **Pros:** a tighter, consistent landing chrome.
- **Cons:** it's a visual design call that needs Basel's eye.
- **Context:** `PrivacyPolicyPage.css:3,68` is now `--landing-page-top(-compact)` (D6). Start by comparing `/privacy`
  against the hero at 375 and 1280.
- **Depends on:** MUT-165 landing tokens.

There's no TODOS.md here; the tracker is Jira MUT.
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| R8 privacy top | untracked | follow-up Jira ticket (via /pm-intake after MUT-165) | skip | change it in MUT-165 |
Question D12:
D12 — Track the privacy page's possibly-stale 160px top gap?
Project/branch/task: MUT-165 spacing guard plan, reviewed on main 9866f0f.
ELI10: The privacy page starts 160px down, which made sense when the header floated over the page. MUT-77 moved the
header into the page flow, and the hero's top room shrank to 64px then. The privacy page didn't follow. This ticket
keeps its pixels as they are (D6), so the question is whether to track a look at it.
Stakes if we pick wrong: skipping leaves a possibly oversized gap above the privacy text with no record of why.
Recommendation: A because it's a design call outside this sweep, and a ticket keeps it from being forgotten.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) File a follow-up ticket (recommended)
  ✅ The observation survives with its file, line and the MUT-77 reason attached
  ✅ MUT-165 stays pixel-identical on the landing, as D6 approved
  ❌ One more small ticket in the MUT backlog (human ~10min / CC ~2min)
B) Skip it
  ✅ No backlog noise for what may be intended spacing
  ❌ The likely-stale gap goes unrecorded, and nobody connects it to MUT-77 later
C) Change it in MUT-165
  ✅ It's fixed while the file is open anyway
  ❌ It breaks D6's pixel-identical landing promise and needs a design decision mid-sweep
Net: a ticket is the cheap way to keep a design question out of a mechanical sweep.
Header: Privacy gap
Options:
A) Follow-up ticket
After MUT-165, file a MUT Task (via /pm-intake) to compare /privacy's top room with the hero and adjust --landing-page-top if stale.
B) Skip
Record nothing further; keep 160/120px.
C) Change it now
Adjust /privacy's top room inside MUT-165 after a screenshot comparison.

State: approved
Actual answer: A, "Follow-up ticket" (D12, 2026-10-16)
Accepted scope: after MUT-165, file a MUT Task via /pm-intake. It compares `/privacy`'s top room with the hero and
adjusts `--landing-page-top(-compact)` if stale. MUT-165 doesn't change it.
History: none

## Approval readiness: PASS
Checked: R1 (D2), R2 (D3), R3a (D4), R3b (D5), R3c (D6), R4 (D7), R4b (D8), R5 (D9), R6 (D10), R7 (D11) and R8 (D12).
The scope is D1. F1 is a factual correction with no approval needed. Required proof (the fixtures, the drift tests and
the KNOWN_LITERALS comment) is carried under its approved behaviors.

## Review body

### NOT in scope
- **Flutter spacing.** The phone app has no spacing scale (`EdgeInsets` literals in `lib/`). Reconciling it is
  outside the web guard.
- **The privacy page's top room.** Its pixels are kept as they are. It becomes a follow-up MUT Task (D12).
- **Moving inline styles into classes.** The TSX sweep swaps values in place. A refactor to CSS classes is separate
  work.
- **Physical-property (RTL) audit.** That's TD-048 / MUT-109. The sweep changes values only.
- **Browser default-font scaling.** rem tokens now scale with the user's font size. The matrix runs at the default
  size only (see Risks).

### What already exists
- The scanner `cssLiterals` / `scriptLiterals` / `literalSourceFiles` / `inPrint` (`src/test/css/brandCss.ts:563-638`)
  is extended, not rebuilt.
- The shrink-only `KNOWN_LITERALS` and its three repo tests (`brand.test.ts:874-988`) are reused as the frozen list.
- The `drift` describe (`brand.test.ts:298`) and `Tokens.px` (rem-aware, `brandCss.ts:450`) are reused for the space
  drift.
- The radius layering pattern `--radius-sm: var(--m-radius-sm)` (`theme.css:82`) is copied for `--space-*`.
- The `@web.brand.layout` matrix (`qa/specs/web/brand.spec.ts:286`) is extended with landing/privacy cells and the
  thumb check.

### Diagram
```
mutaba3a.tokens.json  space[2..96]  ──drift test (both ways)──┐
        │ (hand-mirrored, JSON first)                         │
        ▼                                                     │
mutaba3a-theme.css   --m-space-2 … --m-space-96 (rem) ◄───────┘
        ▼
theme.css            --space-0-5 … --space-16 = var(--m-space-N)
                     + Layout: --demo-banner-height, --checkbox-size, --landing-*
        ▼
component CSS / TSX  padding|margin|gap: var(--space-*) | 0 | auto | % | em | calc(tokens)
        ▲
brand.test.ts literals: px/rem literal → fail · var(--local px) → fail (D10) · KNOWN_LITERALS shrink-only
```

### Failure modes
| Path | Realistic failure | Covered by | User sees |
|---|---|---|---|
| JSON ↔ `--m-space-*` | a step is added to the JSON but not the CSS | drift test, both ways | nothing; CI fails |
| `--space-*` remap | a typo maps `--space-3` to the wrong step | drift test "every `--space-N` is a JSON step" plus the matrix screenshots | spacing off by a step; caught before merge |
| Guard regex | a negative margin or rem slips through | fixtures (`margin: -8px`, `gap: 0.5rem`) | nothing; CI fails |
| var() hop | a local `--pad: 8px` is introduced | the D10 fixture and repo scan | nothing; CI fails |
| Segmented inset | padding and thumb diverge | the D11 assertion | an off-centre highlight; caught before merge |
| Banner offset | the shell offset differs from the banner height | one token feeds both (D5) | structurally impossible |

There are no critical gaps: every path has a test, and none fails silently.

### Worktree parallelization strategy
| Step | Modules touched | Depends on |
|------|----------------|------------|
| Scale + tokens | src/styles/ (JSON, brand CSS, theme.css), src/styles/__tests__/ | — |
| Guard | src/test/css/, src/styles/__tests__/ | Scale + tokens (shares brand.test.ts) |
| QA extensions | qa/specs/, qa/features/ | — |
| Sweep groups 2–5 | src/index.css, src/components/, src/pages/, src/hosted/ | Guard (KNOWN_LITERALS frozen) |

- Lane A: Scale + tokens → Guard → Sweep. These share `brand.test.ts` and `KNOWN_LITERALS`, so they're sequential.
- Lane B: QA extensions, which are independent and must run on main for the "before" set.
- Execution order: launch A and B. Run B's specs on main before A's sweep lands. Then run them again on the branch.
- Conflict flag: `src/index.css` is a cross-session hotspot. Merge main into the branch before landing.
- In practice, this is sequential implementation in one worktree (ticket-per-worktree rule). Lane B is a small
  ordering note, not a parallel session.

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific finding above.

- [ ] **T1 (P1, human: ~1h / CC: ~10min)** — tokens — reconcile the spacing scale on the union (D7/D8).
  - Surfaced by: Scope Challenge, R4/R4b.
  - Files: `src/styles/brand/mutaba3a.tokens.json`, `src/styles/brand/mutaba3a-theme.css`, `src/styles/theme.css`,
    `src/styles/__tests__/brand.test.ts` (drift), `docs/brand/README.md`.
  - Verify: `npx vitest run src/styles/__tests__/brand.test.ts`, then the matrix screenshots, which should be identical.
- [ ] **T2 (P1, human: ~30min / CC: ~5min)** — tokens — add the named layout and landing tokens (D5/D6).
  - Surfaced by: Scope Challenge, R3b/R3c.
  - Files: `src/styles/theme.css`.
  - Verify: the brand tests and the matrix.
- [ ] **T3 (P1, human: ~3h / CC: ~20min)** — guard — add the spacing kind (px+rem, negative, fallback, calc),
  `SCRIPT_SPACING`, the var() hop and the fixtures, then freeze `KNOWN_LITERALS` and update its comment (D2/D3/D10).
  - Surfaced by: Scope Challenge R1/R2, Section 1 R6, Section 2.
  - Files: `src/test/css/brandCss.ts`, `src/styles/__tests__/brand.test.ts`.
  - Verify: red first, then green, with `npx vitest run src/styles/__tests__/brand.test.ts`.
- [ ] **T4 (P1, human: ~2h / CC: ~20min)** — qa — add the landing/privacy matrix cells, the portal shell screenshot,
  the Settings thumb assertion and `qa/features` paths (D9/D11). Run them on main first.
  - Surfaced by: Scope Challenge R5, Section 3 R7.
  - Files: `qa/specs/web/brand.spec.ts`, `qa/specs/portal/shell.spec.ts`, `qa/features/web/brand.yaml`,
    `qa/features/portal/*.yaml`.
  - Verify: `release-qa run --attach --only layout` and the portal shell spec, then `release-qa lint`.
- [ ] **T5 (P1, human: ~1.5d / CC: ~1h)** — sweep — groups 2–5 (CSS px/rem, TSX, off-scale per D4–D6), lowering
  `KNOWN_LITERALS` until it is `{}`.
  - Surfaced by: Scope Challenge, census plus F1.
  - Files: the 16 CSS and 9 TSX files in the census.
  - Verify: brand tests, lint, typecheck, `test:run`, build, the full e2e suite, and the matrix compared with T4's
    "before" set.
- [ ] **T6 (P2, human: ~30min / CC: ~5min)** — knowledge — record the ADR (the union scale, named off-scale tokens),
  plus PATTERNS, CHANGELOG and TEST_PLAN.
  - Surfaced by: the Knowledge updates section.
  - Files: `.claude/DECISIONS.md`, `.claude/PATTERNS.md`, `.claude/CHANGELOG.md`, `.claude/TEST_PLAN.md`.
  - Verify: read-through.
- [ ] **T7 (P3, human: ~10min / CC: ~2min)** — follow-up — file a MUT Task for `/privacy`'s top room (D12).
  - Surfaced by: Final planning decisions, R8.
  - Files: none (Jira).
  - Verify: the ticket exists.

_No new tasks from Performance._

### Unresolved decisions
None.

### Completion summary
- Step 0, Scope Challenge: scope accepted as-is. The arrangement was confirmed (D1), with 7 scope findings resolved
  (D2–D9) and F1 corrected.
- Architecture Review: 1 issue found (R6, accepted D10).
- Code Quality Review: 2 issues found (P3, folded in as required proof and docs).
- Test Review: diagram produced, 15 gaps identified, all in the plan. R7 accepted (D11).
- Performance Review: 0 issues found.
- NOT in scope: written.
- What already exists: written.
- TODOS.md updates: 1 item proposed (R8, a Jira follow-up, D12). The repo has no TODOS.md.
- Failure modes: 0 critical gaps flagged.
- Unresolved decisions: 0 in this review.
- Outside voice: codex, unavailable (not installed; the native fallback lacks TaskOutput).
- Parallelization: 2 lanes, 1 parallel / 1 sequential. In practice it's sequential in one worktree.
- Lake Score: 9/10 answers picked a 10/10 option, out of 10 answers scored for Completeness. The one exception is D4,
  where both options scored 9/10 or lower.

### Suppressed findings
None.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex via `/plan-eng-review` | Independent 2nd opinion | 1 | unavailable | codex not installed; no native fallback (no TaskOutput) |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 33 | issues_open (PLAN) | 18 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, plan-review phase, unavailable. There are no findings and no clean credit.
- **VERDICT:** ENG REVIEWED. Its status is issues_open because the 18 findings are mapped into the plan (T1–T7), not
  outstanding. Nothing is cleared yet. Eng review required to clear: re-run after implementation, or treat the
  mapped work as accepted.

NO UNRESOLVED DECISIONS
