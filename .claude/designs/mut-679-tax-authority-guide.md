# MUT-679 Guide: connect to the Tax Authority and get an allocation number

Engineering plan, 2026-11-28. Planning only: no code written. Epic MUT-672. Copy draft: `.claude/designs/guides-and-help/copy-deck-first-three.md` §1 (not signed off, MUT-673). Art: `guide-tax-hero`, `guide-tax-1..4` (+ `-rtl`) are on main.

Tracker: Jira barmajiyat, MUT-679 is in Backlog. **Blocker gate:** MUT-673 (copy sign-off) is Backlog, so formally this is blocked. Basel asked to plan it, so this plan takes option (b): the code is built on the draft copy and **the release waits for the sign-off** (`docs/operations/before-release.md` already carries that precondition for `tax-authority.json`). Done: MUT-674 (viewer, In Review and on main), MUT-571 (the connection), MUT-572 (the number), MUT-646 (setup). Blocks MUT-695 (help-centre page reuses this guide). Relates MUT-572, MUT-638 (SHAAM sandbox, Backlog), MUT-611 (the Tax Authority prompt opens this guide), MUT-677 (phone viewer).

## 1. What exists and what does not

| Need | Exists | Gap |
|---|---|---|
| The guide viewer | `GuideDrawer`, `GuideButton`, `?guide=` key, registry, `tax-authority.json` (draft copy), enum value `tax_authority` in contract 2.15.0 | `ifStuck` field and render; the `source` link; revised copy |
| The connect screen | Step 5 of the invoicing setup: `TaxAuthorityStep` (`src/hosted/pages/invoicing/InvoicingSteps.tsx`): status, Connect (`tax-authority-connect`), "ending soon" and "ended" states, Connect again | a `GuideButton` beside Connect |
| The issue screen | `ManualAllocationPanel` (MUT-711): the number is entered by hand, with a link to the Tax Authority's page. `allocation.automaticOn` is the plan that would make it automatic (Starter), null on Solo and above | a `GuideButton`, only when `automaticOn` is null (the person can connect) |
| The expired banner | **There is none.** The ticket's "expired-connection banner" is step 5's own ended and ending-soon lines (and the reminder mail that links to step 5) | covered by the step 5 button |
| QA | `FakeApi({ taxAuthority: { plan: 'solo', connected } })`, `portal.invoicing.*` flows | the guide flow |

## 2. Decisions

**D1. Copy.** `tax-authority.json` gets the deck's §1 text: lead (what an allocation number is and that you connect once), the four steps, the note (reconnect every 90 days), `ifStuck`, and `source`. No rate, threshold or deadline of the law; "90 days" is the connection's own lifetime and the ticket asks for it. Arabic from the deck, to be read by a native speaker before release.

**D2. `ifStuck`.** One optional `{ar, en, he?}` field in `types.ts` and `guideSchema.ts` (the key list, one more `textProblems`), rendered by `GuideDrawer` after the note as a plain paragraph (`hp-guide-stuck`, no heading: the text starts "If the connection ends…"). Tested in `guideSchema.test.ts` and `GuideDrawer.test.tsx`.

**D3. Source link.** `https://www.gov.il/he/departments/israel_tax_authority/govil-landing-page`: the page the app already sends people to for a manual number (`DEFAULT_MANUAL_ALLOCATION_URL`, `server/src/jurisdictions/il/tax-authority/service.ts`). Label: the Tax Authority's page. Basel confirms (Q3). It is a content constant, not code, and `parseGuide` already requires https.

**D4. Entry points** (a `GuideButton`, a link-button beside the screen's primary action, never a primary button; DESIGN.md gets the line):
1. **Step 5**: in `.hp-setup-actions`, shown exactly where Connect is shown (not connected, ended, or ending soon). Not on a plan without the connection (`NotOnPlan`: Starter is offered the upgrade, and a guide about connecting would mislead), not while the status failed to load or the connection is not configured on the server.
2. **The issue screen**: in `ManualAllocationPanel`, only when `allocation.automaticOn === null`. The guide opens **over** the issue drawer: `?guide=` is a shell key and the issue drawer's key is a page key, so `go()` keeps both, as MUT-710 does for the two-step prompt. Closing the guide returns to the invoice with what was typed.
3. The prompt (MUT-611) and the Get started card (MUT-676) open it later through the same key; nothing to build here.
Label: one new key, `hosted.invoicing.taxAuthority.guide` ("How to connect" / «كيف أربط؟»), used by both.

**D5. No server, no migration, no contract change** (`tax_authority` is already in the enum; the viewer counts each open).

**D6. Phone.** The file already lists `phone` in `surfaces`, so the phone reads the same words. Showing it there is MUT-677's viewer; this story's "phone and portal show the same guide" AC is met by the shared file and finishes when 677 lands (Q4).

**D7. Carried from MUT-674 (Basel accepted them, 2026-11-28).** (a) A test that `openGuide` really pushes `?guide=` and keeps the page's search, now possible through the real step 5; (b) the release-QA flow `guide-open-read-close` is repointed at the button, with an Escape step (keyboard: Escape closes, focus returns to the button); (c) `guides.test.ts` relaxes "every `guide-*` scene has an `-rtl` twin" to a declared neutral list, for MUT-785's scenes.

## 3. Files

Touch
- `src/content/guides/{types,guideSchema}.ts`, `tax-authority.json`
- `src/hosted/components/GuideDrawer.tsx` (ifStuck), `ManualAllocationPanel.tsx` (button), `src/hosted/pages/invoicing/InvoicingSteps.tsx` (button), `src/hosted/hosted.css` (`.hp-guide-stuck`, the button's place in `.hp-setup-actions`)
- `src/hosted/i18n/{en,ar}.json` (`hosted.invoicing.taxAuthority.guide`)
- `qa/features/portal/guides.yaml`, `qa/specs/portal/guides.spec.ts` (repoint and Escape; the issue-screen flow)
- `DESIGN.md`, `docs/operations/before-release.md` (the button now exists, so the guide is reachable by people: sign-off before release), the `.claude/` knowledge files, `qa/features` paths

Tests (TDD, red first; affected files with `--maxWorkers=3`, light lane for typecheck and lint)
1. `guideSchema.test.ts`: `ifStuck` optional; a missing ar or en rejects.
2. `guides.test.ts`: no `%`, currency symbol or `NIS` in any guide's copy (the cheap guard for "no rate or threshold"); a `source` is https; the neutral-scene list.
3. `GuideDrawer.test.tsx`: `ifStuck` renders after the note and not when absent.
4. `InvoicingSteps.test.tsx`: the button shows when not connected, when ending soon and when ended; not when connected, not on Starter, not when the status failed; pressing it sets `?guide=tax-authority` and keeps the page's search (D7a).
5. `ManualAllocationPanel.test.tsx`: the button only when `automaticOn` is null; opening it over the issue drawer keeps the typed number (through the real portal).
6. Release-QA: `portal.guides.guide-open-read-close` repointed (step 5 on a Solo profile: press the button, read in Arabic, close, English, Done, plus Escape and focus back on the button) and `portal.guides.guide-over-issue-drawer` (manual allocation, press, read, close, the typed number is still there). `release-qa lint` clean; both run green on their own (`release-qa release --only … --app portal --no-save-plan`).
7. Guards stay green: `pressFeedback`, `direction`, `brand`, the i18n parity test.

## 4. Review of the plan (my own; gstack's `/plan-eng-review` is not installed)

- **A guide over the issue drawer** is the one real risk: two dialogs, focus trap and Escape. The MUT-710 precedent says it works; test 5 and the second QA flow prove it, and if Escape closes both, the fix is in `DrawerFrame`, not here.
- **Unsigned copy** reaches pilot testers once the button exists. Mitigation: the existing before-release precondition, now stated for the button too. Merging to local main is not a release.
- **Authority-side steps 2 and 3** (the Tax Authority's own sign-in and approval screens) cannot be checked in the app. The sandbox registration is MUT-638 (Backlog). Without it AC1's sandbox half is a hand check (Q2).
- **Starter** people never see the button on step 5; on the issue screen they get the manual panel as today. The guide's "if it goes wrong" line is the manual path for everyone else.
- **Scale and cost:** no calls, one small lazy chunk; PostHog volume unchanged.

## 5. Scope check against the ticket

Every step matches the real screens: D1 plus the in-app check at build time; sandbox half: Q2. States no rate, threshold or deadline: D1 and test 2. The connect button, the issue screen and the expired state open it: D4. Phone and portal show the same guide: D6 (finishes with MUT-677). Release-QA flow from the connect button: test 6. Out of scope kept out: thresholds and tax rules, anything about filing, Hebrew in the portal, the prompt (MUT-611), the help page (MUT-695).

Revealed by the plan, to note on the ticket: (a) there is no expired-connection banner, only step 5's lines; (b) the guide must not be offered on Starter; (c) AC1's sandbox half depends on MUT-638; (d) the phone AC finishes with MUT-677.

## 6. Open for Basel

- **Q1.** None needed for flow: the entry points and label above are the recommended defaults.
- **Q2.** Authority-side steps 2 and 3: can you (or the pilot's first connect) check them once against the real sign-in and approval screens? Otherwise they are written from the OAuth flow in MUT-571's design and marked unverified until MUT-638.
- **Q3.** Source link: the Tax Authority's gov.il landing page the app already uses, or a more specific page you prefer.
- **Q4.** Move the phone half of "phone and portal show the same guide" to MUT-677.

## Business / product impact

- The Tax Authority connection is where invoicing setup most often stalls; the guide sits on the connect step and on the invoice that needs a number, so the person gets help at the moment they are stuck.
- Roadmap: first real guide of epic MUT-672; unblocks the help page (MUT-695) and the Tax Authority prompt (MUT-611).
- Risk is low: no server, no migration, no new dependency. The one cost is that unsigned copy becomes reachable, handled by the release gate.
