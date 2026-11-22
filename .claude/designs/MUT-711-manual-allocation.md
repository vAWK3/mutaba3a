# MUT-711: Plan B, an allocation number requested by hand (ADR-273)

**Choice:** wireframe A, "Number first, then issue" (Basel, 2026-11-22). Epic MUT-566.

## Problem and acceptance criteria
MTB3A can't request the allocation number when the Tax Authority is off here, the profile isn't connected, or the software isn't registered yet (MUT-567/638). The ACs are the ticket's: the panel on the review step (AC1), Issue disabled until 9 digits, checked by the server (AC2), no gaps: the invoice number is a preview and a taken number is refused (AC3), saved with source MANUAL and printed (AC4), portal and phone in English and formal Arabic, never naming the country (AC5), one QA flow each (AC6).

## Solution
- Preview `allocation` (mode, nextNumber, date, net, client VAT number, requestUrl).
- Issue `manualAllocation { number, forNumber }` through the existing `allocate` hook: the counter is locked, the number compared, `number_moved` rolls back.
- `allocationSource` column (API | MANUAL).
- Link from `TAX_AUTHORITY_MANUAL_ALLOCATION_URL` (open item: the exact page).

## Errors
409 ALLOCATION_NUMBER_REQUIRED (`next`), 409 ALLOCATION_NUMBER_MOVED (`requestedFor`, `next`), 422 ALLOCATION_NUMBER_INVALID, 422 ALLOCATION_NOT_NEEDED; 409 TAX_AUTHORITY_NOT_CONNECTED unchanged.

## QA scenarios
- **Portal (`portal.invoicing.manual-allocation`):** a 6,000 tax invoice to a VAT-registered client on a profile MTB3A can't request numbers for → the panel lists invoice 1, the date, 6,000.00, the VAT number with Copy / Copy all, the link and the input; Issue disabled → 12345 refused, 123-456-789 enables Issue → another document takes 1 → refused "now 2", input cleared, panel shows 2 → the number for 2 issues Tax invoice 2 with its allocation number → Arabic reads right to left.
- **Phone (`ios.invoicing…manual-allocation`):** the same on the issue sheet against the local API (Tax Authority off): panel, disabled Issue, a number, issued with source MANUAL.
