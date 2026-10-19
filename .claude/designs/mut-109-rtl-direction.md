# MUT-109 — Stop forcing right-to-left on every Arabic element; audit the `dir` sites

**Ticket**: [MUT-109](https://barmajiyat.atlassian.net/browse/MUT-109) · epic MUT-101 (Brand v2), its last open child · blocked by MUT-102 (Done) · relates to MUT-110 (Done)
**Debt**: TD-048, direction half (font half closed by MUT-102)
**Status**: Draft, 2026-10-19 — awaiting Basel's approval (decisions D1–D4 below)

## 1. Problem

`src/styles/theme.css` sets `direction` on **every** element through `:lang(ar)` (and `:lang(en)`).
An author rule beats the `dir` attribute, so today:

- every `dir="ltr"` in the app is ignored in Arabic, and every `dir="rtl"` / `dir="auto"` is ignored in English (and `auto` in Arabic);
- five CSS files carry workarounds whose only job is to out-rank `:lang(ar)`;
- some content that must read left to right is silently reversed in Arabic. Example: an invoice number `INV-2024-001` in an RTL isolate renders as `2024-001-INV`.

MUT-79 tried to scope the rule to the root and reverted. Three amount spans flipped, because their `dir="ltr"` started to work (TD-048).

## 2. What was measured (2026-10-19, headless Chromium, `Intl.NumberFormat('ar')`)

The Arabic currency strings start with RLM (U+200F): `‏2,400.50 US$`, `‏2,400.50 ₪`, `‏2,400.500 د.أ.‏`.
Here is how a `<bdi>` renders that text, left to right on screen:

| Markup / cascade | computed | USD | ILS | JOD |
|---|---|---|---|---|
| **today**: `<bdi dir="ltr">` under `:lang(ar){direction:rtl}` | rtl | `$US 2,400.50` | `₪ 2,400.50` | `د.أ. 2,400.500` |
| **after**: plain `<bdi>` (auto → RLM → rtl) | rtl | `$US 2,400.50` | `₪ 2,400.50` | `د.أ. 2,400.500` |
| after: `<bdi dir="ltr">` with the rule gone | ltr | `2,400.50 US$` | `2,400.50 ₪` | `د.أ. 2,400.500` |

So **plain `<bdi>` keeps today's rendering exactly**. Keeping `dir="ltr"` on those spans is what flipped them in MUT-79.

Two amount spans are different: `CurrencyAmounts` and `RecurringAttentionList` already render **LTR** today. Their CSS (`.currency-amounts > .currency-amount`, `.recurring-attention-amount`, both 0,2,0 or higher) out-ranks `:lang(ar)` (0,1,0) and sets `direction: ltr`. The ticket lists `CurrencyAmounts` as "plain `<bdi>`", but that would visibly flip it (see D2).

## 3. Scope

The ticket counted 20 sites on 2026-10-12. Today there are **45 `dir` sites in 33 files**:

- by kind: 38 `ltr`, 5 `auto` and 2 `rtl`;
- by app: 21 sites in 18 local-app files, 22 in 14 portal files and 2 in 1 landing file.

On top of those come 5 CSS workarounds and 2 theme rules. Sort-order `dir: 'asc'` hits and the one comment are excluded. The tables below list all 45.

### 3.1 The theme rule

`theme.css:346–356`: delete both `direction` rules (`:lang(ar)` **and** `:lang(en)`). `<html dir>` is already set by `I18nProvider` (`src/lib/i18n/core.tsx:97`), which serves the app, the landing page and the portal. `hosted.html` ships `dir="ltr"` and `index.html` ships no `dir`, as they do today. Direction now inherits from `<html>` like any other property.

### 3.2 Site inventory and classification

**A. Locale-formatted amounts: drop `dir`, leave plain `<bdi>`.** Rendering is unchanged (measured above).

| # | Site | Surface |
|---|---|---|
| A1 | `components/clients/OwedNowSummary.tsx:36` | Clients, client profile |
| A2 | `components/clients/ClientWorkSection.tsx:214` | client profile |
| A3 | `pages/clients/ClientsPage.tsx:207` (`client-index-amount`) | Clients |
| A4 | `components/home/HomeRecentPayments.tsx:75` | Home |
| A5 | `components/home/HomeAttentionRow.tsx:102` (TD-048's "HomeNeedsAttention") | Home |
| A6 | `components/drawers/OrphanedRecordsDrawer.tsx:257` | orphaned-records drawer |
| A7 | `hosted/format/DecimalAmount.tsx:49` | every portal amount |

**A′. Amounts that are LTR today through CSS** (Expenses page, "coming up" list only). See D2.

| # | Site | Today |
|---|---|---|
| A′1 | `components/ui/CurrencyAmounts.tsx:31` + `CurrencyAmounts.css:12` | LTR `2,400 US$` |
| A′2 | `components/expenses/RecurringAttentionList.tsx:108` + `RecurringAttentionList.css:80` | LTR `2,400 US$` |

**B. Genuinely LTR text: keep `dir="ltr"`.** The attribute now works. The text looks the same, except where a mix of letters, digits and dashes was being reversed; that is a fix.

| # | Site | Content |
|---|---|---|
| B1–2 | `components/layout/FxRateReadout.tsx:70, 82` | FX formula (keeps `.fx-formula[dir='ltr'] { direction: ltr }`) |
| B3 | `pages/clients/ClientDetailPage.tsx:63` | email / phone contact items |
| B4 | `components/modals/WhatsNewModal.tsx:59` | version number |
| B5 | `hosted/shell/UserMenu.tsx:72` | email |
| B6 | `hosted/components/ProfilesManageDrawer.tsx:131` | currency code |
| B7 | `hosted/components/ProfileEditForm.tsx:218` | IANA timezone |
| B8 | `hosted/components/ProfileCreateDrawer.tsx:223` | IANA timezone |
| B9 | `hosted/pages/views/DocumentsList.tsx:85` | invoice number (**fix**: `INV-2024-001` stops reversing) |
| B10 | `hosted/pages/views/PaymentsList.tsx:114` | payment number (same fix) |

**B-in. LTR inputs: keep `dir="ltr"`.** These render RTL today and switch to LTR. Typed text reads in the right order; alignment is decided in D3.

| # | Site | Field |
|---|---|---|
| B11–12 | `hosted/pages/auth/SignInPage.tsx:170, 194` | email, password (`.hp-ltr-input`, already right-aligned in RTL) |
| B13–14 | `hosted/pages/auth/SetupPage.tsx:236, 252` | account email, password (`.hp-ltr-input`) |
| B15–16 | `hosted/components/ChangePasswordDrawer.tsx:107, 130` | passwords |
| B17 | `hosted/components/FilterControls.tsx:121` | date input |
| B18 | `hosted/components/ProfileCreateDrawer.tsx:202` | timezone `<Select>` |
| B19–20 | `pages/landing/components/HostedRequestForm.tsx:139, 153` | email, phone (landing) |

**C. Amount inputs: keep `dir="ltr"`.**

| # | Site | Today → after |
|---|---|---|
| C1 | `components/drawers/IncomeDrawer.tsx:532` (`income-amount-group`) | already LTR via `div.input-with-prefix` CSS, **no change** |
| C2 | `components/drawers/PartialPaymentDrawer.tsx:482` | already LTR via the same CSS, **no change** |
| C3 | `components/expenses/ExpenseFormFields.tsx:143` (local and portal expense drawers) | RTL → LTR |
| C4–5 | `components/drawers/ConversionDrawer.tsx:200, 229` | RTL → LTR |
| C6 | `hosted/components/IncomeCaptureDrawer.tsx:199` | RTL → LTR |
| C7–8 | `hosted/components/ConversionDrawer.tsx:222, 264` | RTL → LTR |
| C9 | `hosted/components/RecordPaymentDrawer.tsx:180` | RTL → LTR |

`RecurringMarkPaidDrawer.tsx:263` has `.input-with-prefix` and no `dir`. It stays LTR through the CSS rule, which stays.

**D. `dir="auto"` now honoured.** An English name in the Arabic UI reads LTR (it starts at its own beginning). Keep.
`components/ui/TruncatedTitle.tsx:136, 145` (keeps `unicode-bidi: plaintext`) · `hosted/components/ProfilesManageDrawer.tsx:117` · `hosted/components/ProfileEditForm.tsx:197` · `hosted/components/ProfileCreateDrawer.tsx:143`.

**E. `dir="rtl"`. Keep.**
`components/layout/SidebarNav.tsx:196` (`lang="ar"` too, so no change) · `components/drawers/BusinessProfileDrawer.tsx:236`. That one is the Arabic business-name input. In the **English** UI it becomes RTL; today it is forced LTR. That is a fix.

### 3.3 CSS workarounds

| File | Change |
|---|---|
| `styles/theme.css:344–356` | delete both direction rules and the comment |
| `components/ui/CurrencyAmounts.css:10–12` | per D2 |
| `components/expenses/RecurringAttentionList.css:80` | per D2 |
| `index.css:1235–1248` (`div.input-with-prefix`) | keep the rules (RecurringMarkPaidDrawer has no `dir`); rewrite the comment, which cites `:lang(ar)` |
| `components/layout/FxRateReadout.css:32–37` | keep the rule; rewrite the comment |
| `components/ui/TruncatedTitle.css:36–39` | keep `plaintext`; rewrite the comment |
| `lib/utils.ts:104` (`isolateAmount` doc) | reword: a standalone amount is now a plain `<bdi>` |

## 4. Decisions for Basel

- **D1 — Remove the `:lang(en)` direction rule too.** *Recommended: yes.* It is the English twin of the same bug: it ignores `dir="rtl"`/`"auto"` in English. Removing only the Arabic half would leave TD-048 half open. The visible effect is limited to E and D in the English UI, and both are fixes.
- **D2 — The two Expenses-page amounts that are LTR today (A′).**
  - *Recommended (a):* keep them LTR. Leave `dir="ltr"` in the markup, which now does the work, and delete the `direction: ltr` CSS workaround. Zero visible change, which is this ticket's promise.
  - (b): make them plain `<bdi>` like the rest. The "coming up" list would then show `$US 2,400` / `₪ 2,400` like Home and Clients, a visible change on Expenses.

  Either way the app keeps two amount orders on screen (RTL standalone, LTR in sentences per MUT-110). Picking one convention is a product call, so it is proposed as a follow-up ticket, not done here.
- **D3 — Alignment of the inputs that switch to LTR (B-in, C3–C9).**
  - *Recommended:* one shared rule, `:where([dir='rtl']) input[dir='ltr'] { text-align: right }` (specificity 0,1,1). The fields keep today's right alignment in Arabic, and only the typing order is fixed. It loses to `.input-with-prefix > .input` (0,2,0), so the income and payment drawers keep their left-aligned look, and `.hp-ltr-input` already does the same thing.
  - Alternative: let them go left-aligned. That is visible on five drawers and the sign-in page.

  The `<Select>` (B18) is checked in the after-screenshots. If its chevron side flips, it gets the same treatment.
- **D4 — The ADR.** One ADR, numbered at build time to avoid collisions: "`direction` comes from `<html dir>` and the `dir` attribute only; no author rule sets `direction` on `:lang()`. A locale-formatted amount is a plain `<bdi>`; `dir="ltr"` is for content that must read LTR in any language." It supersedes the MUT-110 doc line that calls `<bdi dir="ltr">` the standalone-amount convention.

## 5. Implementation plan

The order follows TDD: every test below is written red first.

1. **CSS guard** (`src/styles/__tests__/brand.test.ts`): "TD-048 direction half: no rule declares `direction` on a `:lang()` selector." This fails red on today's theme. Then delete the rules.
2. **Inventory ratchet** (new `src/styles/__tests__/direction-sites.test.ts`): read every `src/**/*.tsx` (not tests) and collect each `dir="…"` occurrence per file. Assert the per-file counts equal a checked-in table built from §3.2, each entry with its class and reason. A new `dir` site, or a `<bdi dir="ltr">` around a `formatAmount`/`formatDecimal` call, fails with a message that points at this brief. This is the "test per site" for all 45. Cost: one file read pass, under 100 ms.
3. **Component tests for the A sites** (render in Arabic; the amount `<bdi>` has no `dir` attribute and its text is the `ar` format):
   - update `OwedNowSummary.test.tsx:63` and `hosted/format/__tests__/format.test.tsx:45` (both pin `dir="ltr"` today);
   - add cases to the existing tests of `ClientWorkSection`, `ClientsPage`, `HomeRecentPayments`, `HomeAttentionRow` and `OrphanedRecordsDrawer` (each gets a test file if it has none).
4. **Tests for C and B-in**: existing tests already pin `dir="ltr"` (`IncomeDrawer`, `ExpenseFormFields`, hosted `ExpenseDrawer`, `ConversionDrawer`, `IncomeCaptureDrawer`, `SetupPage`) and keep passing. Missing ones get one assertion each: `RecordPaymentDrawer`, `SignInPage`, `ChangePasswordDrawer`, `FilterControls`, the local `ConversionDrawer`, `PartialPaymentDrawer`, `HostedRequestForm`.
5. **Markup**: drop `dir` on A1–A7 (and A′ per D2); B, C, D and E stay as they are.
6. **CSS**: §3.3 plus D3's rule in `index.css`, next to the existing RTL input rules (~line 3425).
7. **Knowledge**: TD-048 → Resolved; the ADR (D4); CHANGELOG, PATTERNS ("amount = plain `<bdi>`; `dir="ltr"` = LTR content"), TEST_PLAN, COMPONENT_REGISTRY (`DecimalAmount`, `CurrencyAmounts` notes).

Jsdom does not run the CSS cascade, so unit tests cover markup and the CSS text. Rendering is proved in the browser (§6).

## 6. QA scenarios (release-QA, web Playwright on preview builds)

Each spec asserts **computed** `direction` (the thing jsdom can't see) and, for amounts, the **visual** character order. Visual order is read with `Range.getBoundingClientRect` per character, the method behind §2. Every spec attaches screenshots.

| id | app / area | Steps (as the user says them) | Expect |
|---|---|---|---|
| `direction-amounts` | `web/brand` (core) | Log two clients' income, one partly paid and overdue. In Arabic, open Home, Clients and a client profile. | Every amount's visual order is the same as today's (number right, currency left, e.g. `₪ 2,400`). Computed direction `rtl`; no `dir` attribute. |
| `direction-ltr-content` | `web/brand` | In Arabic, open the FX readout, a client's contact items and What's new. | Each reads LTR (computed `ltr`); the FX formula is unchanged. |
| `direction-amount-inputs` | `web/brand` | In Arabic, open the income drawer, the payment drawer and the expense form, and type `1,200`. | The income and payment fields look unchanged. The expense amount is `ltr`, right-aligned (D3), and keeps the typed order. |
| `direction-english` | `web/brand` | In English, open the same surfaces and the business-profile drawer. | Nothing that was LTR changes. The Arabic business-name input is `rtl`. |
| `direction-signin` | `portal/signin` | In Arabic, open sign-in and type an email. | Email and password are `ltr` and right-aligned; the typed email reads in order. |
| `direction-amounts` | `portal/ledger` | In Arabic, open a client with invoices and payments. | Amounts keep today's visual order. Invoice and payment numbers read `INV-…` left to right. |

The yaml `paths` cover `src/styles/theme.css`, every file in §3.2 and §3.3, and `src/hosted/format/**`.

**Before/after screenshots (ticket AC).** Run the same Arabic capture script on a preview build of `main` and of the branch. It covers the income drawer, the payment drawer, the expense form, portal sign-in, Home, Clients and the client profile. Pixel-diff each amount region, and attach both sets plus the diff to the ticket. Only D3-governed inputs may differ; they should not differ either if D3 is accepted.

## 7. Risks and edge cases

- **MUT-79 regression** (the reason it was reverted): avoided by dropping `dir` on A1–A7 in the same change, with the measurement in §2 and the `direction-amounts` spec as proof.
- **A `dir` site the audit missed** (e.g. `dir={…}` from a prop): the ratchet test parses both `dir="…"` and `dir={…}`. Today there are no dynamic sites outside sort state.
- **Paint before hydration**: unchanged. `<html lang>` and `dir` are set in the same effect as today, and `lang="en"` before it made the old rule LTR anyway.
- **Portaled overlays** (drawers, menus, toasts) render under `<body>` and inherit from `<html>`, so they behave like today.
- **The local web app retires after MUT-292's 90-day bridge.** It is still live, so it is fixed here. Every change is a one-attribute or one-rule edit, so nothing extra is built for it.
- **Out of scope**: picking one amount order for the whole app (D2 follow-up), Flutter, and the desktop app (retired).

## 8. Cost / infra / i18n

No runtime cost and no new strings. CSS shrinks by a few rules. No infra.

## 9. Review note

This plan got a focused adversarial pass during drafting: the measurements in §2, the specificity check for D3 and the inventory recount. The interactive `/plan-eng-review` has not been run on it. Say if you want it before the build.

**Business / product impact**
- Arabic users (the default language) get correctly ordered invoice and payment numbers, emails and typed amounts. Every amount they see today stays exactly where it is.
- It closes the last open child of Brand v2 (MUT-101), so the epic can close.
- Low risk: one CSS rule plus attribute edits, proven by before/after pixel diffs. It removes five CSS workarounds that every new `dir` site would otherwise need.
