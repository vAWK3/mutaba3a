# MUT-722: "Finish setting up invoicing" after saving an income on a profile that can't issue yet

Status: built 2026-11-24/25 on `feature/mut-722-setup-hint` (mini-crm) and `feature/mut-722-phone` (Flutter), under Basel's standing authorisation to build without stopping for plan approval (decisions below, recorded as ADR-278).

## Problem
Basel (2026-11-23, phone 0.2.0) saved an income on a business profile and got no offer to issue its invoice, and no reason: the setup wasn't complete. MUT-648's save-moment offer is silent while `canIssue` is false (phone `issue_offer_gate.dart`; portal: the toast offers nothing and Receivables hides Issue).

## Acceptance criteria (from the ticket)
1. Phone: saving an ILS income on an invoicing-enabled business profile with incomplete setup shows the hint with Set up; tapping opens setup at the first missing step.
2. Phone: at most once per profile per day; complete setup gets the normal Issue offer (MUT-648) unchanged.
3. Portal: same hint after saving; Receivables shows "Finish setup to issue" where Issue would be.
4. No hint on personal profiles, Malafat firms, profiles without the invoicing feature, or non-ILS incomes.
5. Release-QA: a recorded flow on each app covering AC1–AC4.

## Solution
**Invoicing available** = the person holds `invoicing`, on a business profile they own that Malafat doesn't write (portal `invoicingAvailable`; phone `showsInvoicing` plus `!isMalafatLinked && !managedInMalafat`). The server's issuing gate also answers 404 for a Malafat firm, so a setup that can't be read says nothing.

**Hint due** = available, the setup read, `canIssue` false, the saved entry an ILS income, and not yet shown today for this person and profile. Showing it records the day (dismissing counts, AC2).

- **Portal.** `src/hosted/components/setupHint.ts` (`useSetupHint`, pure helpers, the once-a-day memory in `localStorage` under `mutaba3a-setup-hint:<userId>:<profileId>`, try/catch like `firmBanner.ts`). `IncomeCaptureDrawer` adds, when no MUT-648 offer applies, `detail: "Finish setting up invoicing to issue its invoice."` and the action **Set up** to the same save toast. `Toast` gains an optional `detail` line (quieter, under the message, read with it in the polite live region). Set up navigates to `/p/:id/you/invoicing?step=<first missing>`; the route validates `step` and `InvoicingSetupPage` opens that step. `ReceivablesList` shows a **Finish setup to issue** link in the Document column where Issue would be (same row conditions: issuable, not marked not-for-invoice, writable).
- **Phone.** `SetupHintGate` wraps Capture beside `IssueOfferGate` (`app_router.dart`), listening to `entryConfirmedProvider` like the other post-save gates (never over the Done beat, MUT-627 R5). `setupHintForSaved` reads the row, the profile and the setup (it doesn't wait for the upload: the setup is the profile's). `SetupHintStore` keeps `{"userId:profileId": "YYYY-MM-DD"}` in secure storage (the `LastShareProfileStore` pattern), dropping older days. The SnackBar's **Set up** pushes `AppRoutes.accountProfileInvoicing(id, step:)` (`?step=`), and `InvoicingSetupScreen(initialStep:)` opens on it.
- **First missing step** = the first of `missing` in step order: Business details, else Numbering (the two issuing waits for). Without it the setup would open on the first step still to do, often the optional Logo.

`issue_offer_gate.dart`, `IssueDocumentDrawer.tsx` and the other MUT-643 files are untouched (another branch changes them).

## Design (apple-design principles)
One quiet line in the moment that already speaks (the save toast / SnackBar), not a sheet or a dialog: restraint, feedback where the action happened, one action that goes straight to the missing step (no hunting through You › Profiles). Once a day keeps it from nagging. On Receivables the spot keeps its place (spatial consistency): the words change from Issue to "Finish setup to issue" instead of the button vanishing.

## Copy
| | English | Arabic |
|---|---|---|
| Portal line | Finish setting up invoicing to issue its invoice. | أكمل إعداد الفوترة لتصدر فاتورته. |
| Portal action | Set up | إعداد |
| Portal Receivables | Finish setup to issue | أكمل الإعداد للإصدار |
| Phone line | Finish setting up invoicing to issue its invoice | أكمِل إعداد الفوترة لإصدار فاتورته |
| Phone action | Set up | إعداد |

Portal ar+en only; phone en + formal Arabic.

## Error states
Setup read fails (offline, 404, 5xx): no hint. Storage refuses: portal shows it again after the next save in that window; phone may show it again. Signed out / local mode: never.

## Impact, cost, infra
No server or API change; no new endpoint (the setup is already fetched: the portal's query is shared by key, the phone asks once per save only when not shown today). No migration.

## QA scenarios
Portal (`portal.invoicing.setup-hint`):
1. On a profile with details in and numbering not, record ₪590 owed → the toast says the line with Set up, no Issue. The row says "Finish setup to issue".
2. Set up → You › Invoicing at Numbering (`?step=numbering`).
3. Record another Owed the same day → no hint.
4. Finish setup to issue on the row → Numbering; answer it → the next save offers Issue a tax invoice (MUT-648).
5. A USD Owed, a personal profile, a Malafat firm, no feature → no hint, no link.
6. In Arabic → «أكمل إعداد الفوترة لتصدر فاتورته.» with إعداد, right to left, no sideways scroll.

Phone (`ios.invoicing.setup-hint`):
1. A new business profile with details in, numbering not; save ₪590 → the SnackBar says the line with Set up, no Issue offer.
2. Set up → the setup at Numbering (step 4 of 5).
3. Save again the same day → no hint.
4. A $590 income (the day forgotten), and an income on the personal profile → no hint.
5. Answer Numbering → the next save gets MUT-648's offer, no hint.

## Decisions (ADR-278)
D1 device-local once-a-day memory (no server "prompt shown" store exists for MUT-648; the trial and usage prompts are device-local too). D2 showing counts as the day's one (the ticket: "dismissing counts"). D3 per person and profile (a shared browser or phone with two accounts). D4 the hint needs only the setup, not the upload (phone). D5 the portal reuses the save toast with a detail line instead of a second toast (one toast at a time). D6 ILS income only, Owed or Received, with or without a client (the offer's other conditions — client, dealer type, offer-after-save — need a finished setup to mean anything).
