# MUT-785 and MUT-786: the invoice guide and the accountant guide (owner's side)

Engineering plan, 2026-11-28. Planning only: no code written. Epic MUT-672. One branch and one analytics-contract bump for both, because each adds a guide id to the same enum. Copy: `.claude/designs/guides-and-help/copy-deck-first-three.md` §2 and §3 (signed by Basel for all sections, 2026-11-28). Art: all in main (`guide-invoice-*`, merged 22c0d81b; `guide-accountant-*`).

Tracker: Jira barmajiyat. MUT-785 (invoice guide) and MUT-786 (accountant guide, owner's side, split out of MUT-681 today) are in Backlog. **Blocker gate:** MUT-673 (copy deck) is still Backlog in Jira; Basel confirmed in this conversation that his sign-off covers all sections, so the blocker is resolved in substance (Q0: close MUT-673 or leave it for the Claude, Scan and bank-text copy, which are not signed). MUT-674 and MUT-679 are In Review and on main. MUT-681 keeps Scan and bank-text (phone, wait for MUT-677). MUT-611 prompts open these guides later.

## 1. What exists and what does not

| Need | Exists | Gap |
|---|---|---|
| Viewer, format, `ifStuck`, source link, entry-point rules | MUT-674 and MUT-679 (ADR-341, ADR-342) | none |
| Art | `guide-invoice-hero`, `-1..-4` (step 2 neutral); `guide-accountant-hero`, `-1..-3` (all with `-rtl`) | none |
| Invoice entry: the Issued documents list | `IssuedDocuments.tsx` empty line (`issued-empty`, "No documents issued on this profile yet."); the list exists only where issuing is on | a `GuideButton` |
| Invoice entry: the end of the setup | `InvoicingSetupPage.tsx` `Status` → `setup-ready` ("Your letterhead is ready") when `setup.canIssue` | a `GuideButton` |
| Accountant entry | `SharingPage.tsx`: `SharingEmpty` (nothing shared yet, Invite by email) and `AccountantsColumn` head (Invite by email). Both render only where `sharingOpen()` is true (signed in, owned profile, the `accountant_access` feature). The scope wording is one component, `AccessScopeList` | a `GuideButton` in each |
| Contract | 2.15.0: `guide` enum `["tax_authority"]` | two values, 2.16.0 |
| QA | `FakeApi` `invoicing: 'ready'`, `accountants`, `taxAuthority`; flows in `invoicing.yaml`, `sharing.yaml` | the guide flows; an "ended connection" seed (below) |

## 2. Decisions

**D1. Two guide files, deck copy.** `src/content/guides/issue-first-invoice.json` (hero `guide-invoice-hero`, steps `guide-invoice-1..4`, note, `ifStuck`, no source link) and `accountant-access.json` (hero `guide-accountant-hero`, steps `guide-accountant-1..3`, note, `ifStuck`). `surfaces: ["portal", "web"]` for both: the phone neither issues nor invites the same way, and the phone viewer is MUT-677.

**D2. Two copy edits the signed deck conflicts with** (small; need Basel's yes, Q1 and Q2):
- *Invoice lead.* The deck's lead names "a tax invoice, receipt or credit note". An exempt dealer can issue receipts only (`EXEMPT_DEALER_TAX_INVOICE`), and MUT-785's AC says no one is told they can issue a type they cannot. Proposed lead: **"Issue your first document from MTB3A."** (ar «أصدِر أول مستند من «متابعة».»), with no types named.
- *Accountant step 3.* The Sharing page already makes one promise about what an accountant sees (`AccessScopeList`: "Sees this profile's expenses, income and receipts", "Can download them for a period", "Can't add, change or delete anything"), kept in one component so nothing words it differently. The deck's step 3 words it a third way ("income, payments, reports and the expenses that have a receipt"). Proposed step 3: **"They see this profile's expenses, income and receipts."** (ar «يرون المصاريف والدخل والإيصالات في هذا الملف.», the existing Arabic). The lead keeps "They can't change anything".
  Noticed on the way, not part of this: ADR-258 narrows an accountant's expenses to those with a receipt, but the page's promise says "expenses". A one-line follow-up for whoever owns `AccessScopeList`.

**D3. Entry points** (a `GuideButton` beside the screen's action, ADR-342 rule: only where the person can do what it teaches):
- *Invoice:* under the empty line in `IssuedDocuments` (the list only exists where issuing is on) and in the `setup-ready` block. Label `hosted.issue.guide`: "How to issue" / «كيف أصدر؟». Not in the blocked state (`setup-blocked`): the guide's first step is to finish the setup, which that screen already says.
- *Accountant:* in `SharingEmpty`'s actions and in `AccountantsColumn`'s head beside Invite by email. Label `hosted.sharing.guide`: "How to invite" / «كيف أدعو؟». The page itself is the gate, so the button never shows where Sharing is off.
Both guides open from `?guide=<id>` for anyone with the link; the content is generic and harmless.

**D4. Contract 2.16.0**: add `issue_first_invoice` and `accountant_access` to the `guide` enum of both events; pin the hash in `analytics-taxonomy.test.ts`; update its shape expectation. `guides.test.ts` already fails with the line to add. TD-373 (the Flutter copy) gets one more version behind; nothing on the phone reads these.

**D5. Neutral scene list.** `guides.test.ts`'s `NEUTRAL_SCENES` becomes `['guide-invoice-2']` (drawn direction-neutral by Claude Design).

**D6. Carried from MUT-679 (AC3c).** A recorded flow for the Tax Authority guide's ended-connection entry. The fake API's connected state has a fixed end date, so a `taxAuthority.ended` seed returns `state: 'expired'` (one small branch in `qa/support/portalApi.ts`), and the flow `portal.guides.tax-guide-ended-state` presses the button beside Connect again.

**D7. No server, migration or dependency.** No new component, pattern or ADR: ADR-341 and ADR-342 cover it. CHANGELOG, TEST_PLAN, COMPONENT_REGISTRY placements, DESIGN.md (none), TD-373.

## 3. Files

Add: `src/content/guides/{issue-first-invoice,accountant-access}.json`; `qa` additions below.
Touch: `src/hosted/pages/views/IssuedDocuments.tsx`, `src/hosted/pages/invoicing/InvoicingSetupPage.tsx`, `src/hosted/pages/sharing/{SharingPage,AccountantsColumn}.tsx`, `src/hosted/i18n/{en,ar}.json` (`hosted.issue.guide`, `hosted.sharing.guide`), `docs/analytics/events.json` (2.16.0), `scripts/__tests__/analytics-taxonomy.test.ts` (pin, shape), `src/content/guides/__tests__/guides.test.ts` (neutral list), `qa/support/portalApi.ts` (ended seed), `qa/features/portal/guides.yaml`, `qa/specs/portal/guides.spec.ts`, the `.claude/` knowledge files.

## 4. Tests (TDD, red first; light lane, `--maxWorkers=3`)

1. `guides.test.ts` over the real files: both parse, scenes exist with their `-rtl` twin (the neutral one declared), both ids are in the contract enum, no `%` or currency in the copy. It is red until the files and the contract exist.
2. `SharingPage.test.tsx` (existing harness): the button is in the empty state and in the Accountants column, opens `accountant-access`, and is absent where Sharing is off (the page does not render).
3. `analytics-taxonomy.test.ts`: the new pin and the enum shape.
4. i18n parity and the style guards (press feedback, direction, brand) stay green.
5. Placement on the Issued list and the setup's ready block is proven by the QA flows, not a jsdom page test: both pages need most of the issuing API stubbed, and the flows already do that (`FakeApi invoicing: 'ready'`). I note this as a deliberate choice.
6. Release-QA, one run for the portal app only: `portal.guides.invoice-from-issued-and-setup` (empty Issued list, press, read in Arabic, close; then the setup's ready block in English), `portal.guides.accountant-from-sharing` (the Sharing empty state in Arabic then English, and from the Accountants column), `portal.guides.tax-guide-ended-state` (D6). `release-qa lint` clean.

## 5. Review of the plan (my own; gstack's `/plan-eng-review` is not installed)

- **Signed copy changed twice (D2).** Both edits make the guide agree with the product, but Basel signed the old words; the build waits for his answer on Q1 and Q2 rather than assuming.
- **Contract conflicts.** No other branch touches `events.json` today (checked: MUT-780, MUT-782, the QA-pass branch). One bump for both guides is cheaper than two.
- **The accountant button is gated by a per-user feature.** That is intended (ADR-196: sharing is off until granted); a person without it never sees the button.
- **The invoice guide's step 1 is generic** ("finish the setup"). The ready block and the Issued list both sit after it, so a person who has finished still sees the guide for the next steps; acceptable, and the ticket asked for both places.
- **Steps checked against the screens at build time** (each ticket's AC): the invoice guide's "Press Issue a document" (`issue.open`) and the accountant guide's "Share with your accountant" / "Invite by email" labels exist verbatim in `en.json` and `ar.json`; the build re-reads them.

## 6. Scope check against the tickets

MUT-785: every step matches the real screens (D1, build-time check); no rate, threshold or deadline of the law (test 1); opens from the empty Issued list and the end of the setup (D3, flow 1); exempt dealers not told a type they cannot issue (D2 lead); phone and portal show the same guide (the shared file; phone with MUT-677); release-QA flow from the Issued empty state (flow 1). MUT-786: opens from the Sharing page and not where Sharing is off (D3, test 2); the accountant's scope in the page's own words (D2); steps match the real screens (D1); contract names the guide (D4); release-QA flow (flow 2). Out of scope kept out: the accountant's own side, the invite offer (MUT-609), the phone (MUT-677), the prompt (MUT-611), Scan and bank-text (MUT-681). Carried: AC3c of MUT-679 (D6).

Revealed by the plan, to note on the tickets: (a) the two copy conflicts (D2); (b) MUT-681 should lose the accountant part (done as MUT-786) and its description updated; (c) `AccessScopeList` vs ADR-258.

## 7. Open for Basel

- **Q0.** Close MUT-673? It still holds the Claude, Scan and bank-text copy, which are unsigned. Recommendation: leave it open.
- **Q1.** The invoice lead: "Issue your first document from MTB3A." instead of naming the types (D2).
- **Q2.** The accountant's step 3: the Sharing page's own wording (D2).

## Business / product impact

- The two guides sit where people stall: the empty list after setting up invoicing, and the first time they share a profile. They also become the targets of the MUT-611 prompts ("set up, nothing issued yet", the accountant offer).
- Roadmap: second and third portal guides of epic MUT-672; with MUT-679 they make the Get started hub (MUT-676) worth building.
- Risk is low: no server or migration. The two copy edits are the only reason to pause, and they stop a guide from contradicting the product.

## 8. Built (2026-11-28)

Branch `feature/mut-785-786-guides`. Basel approved both copy edits (Q1, Q2) and signed the rest of the deck. Differences from the plan: none in scope. Q0 (MUT-673) stays open for the unsigned Claude, Scan and bank-text copy.
