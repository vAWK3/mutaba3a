# MUT-260 — Portal: receipts gallery, To-review queue, upload and manual review

Epic MUT-252. Blockers MUT-255, MUT-389, MUT-396 and MUT-254 are all merged (In Review). Wireframes: `mut-260-receipts-layouts.html`.

## Decisions

- **D1 (Basel, 2026-10-25): layout B.** Receipts becomes a third tab under Expenses (Expenses · Groups · Receipts). It shows a thumbnail gallery with To review / Filed / All. Review is its own page: the receipt large on one side, the expense form on the other, and "Next receipt". No new nav item, which fits MUT-423's smaller shell.
  - This drifts from AC3's wording ("opens the ExpenseDrawer"). The review page uses the drawer's form fields, extracted and shared (D6), not the overlay. Note this on the ticket.
- **D2 (Basel): show the original inline.** The portal CSP adds `https://storage.googleapis.com` to `img-src` and `frame-src`.
  - Signed URLs are short-lived and on a separate origin, so a receipt can't script the portal.
  - In dev the local driver's URLs are same-origin (`/dev/attachments`, proxied by vite), so `'self'` covers them.
- **D3: an inline disposition for PDFs.** Signed download URLs carry `Content-Disposition: attachment`. An `<img>` ignores that, but an `<iframe>` of a PDF would download instead of showing.
  - `GET /v1/receipts/{id}/download` gains `?disposition=inline|attachment` (default `attachment`, so existing callers are unchanged).
  - `contentDisposition(filename, kind)` drives both drivers: the GCS `responseDisposition` and the local driver's token claim.
  - The response type is still pinned to the stored mime type. Only PDF, JPEG and PNG are ever stored.
  - API minor bump; claim the number at build.
- **D4: how the portal learns the library is on.** It calls `GET /v1/receipts/counts`.
  - A 404 (flag off, or signed-out local mode, where createLocalApp never mounts the routes) hides the Receipts tab and makes its routes show "not available".
  - Success gives the "N to review" count in the tab label.
  - One cheap call, with no change to `/v1/me`. Cached with React Query, `staleTime` 60 s, and invalidated after upload or approve.
- **D5: thumbnails.**
  - Image cards load their signed original lazily: `GET …/download?disposition=inline` only when the card scrolls into view (IntersectionObserver), then `<img loading="lazy">`.
  - Cached per receipt with `staleTime` = `expiresAt` − 60 s. An `onError` on an expired URL refetches once.
  - PDF cards show a PDF tile and fetch nothing.
  - Page size 24, with Show more (cursor).
  - Known cost: originals are full-size photos. File **TD**: server-side thumbnails.
- **D6: share the form; don't fork it.** Extract a `useHostedExpenseForm({ profileId, timezone, initialValues })` hook and an `<ExpenseFormFields>` body out of `ExpenseDrawer.tsx`.
  - The hook holds schema, defaults, labels, error labels, matter cascade and pending picks. The body holds the fields inside `<form>`, including VendorPicker.
  - The drawer keeps its exact behaviour, and its existing tests and QA specs are the guard.
  - The review page uses the same hook and body, so the vendor typeahead (AC4) comes for free.
- **D7: prefill from suggestions.** `suggestionToFormValues(suggested, { timezone, currencies })` is pure, lives in `src/hosted/lib/receiptSuggestion.ts`, and returns `Partial<HostedExpenseFormValues>` plus the list of prefilled field names.
  - `date` maps to `occurredAt`; `vendorName` to `vendor`.
  - `totalMinor` plus `currency` map to `amount` as a decimal string, using the currency's exponent: JOD has 3 decimals, ILS/USD/EUR have 2. There is no `Number()` (lint).
  - If the currency isn't one the portal offers, both currency and amount are left empty.
  - VAT, registration number, phone and email are ignored: there's no VAT UI (Basel's epic decision).
  - Every source counts. Confidence doesn't gate the prefill; it only shows in the hint.
  - Prefilled fields carry a "From the receipt" hint and `data-suggested`.
  - The input is the server's `ReceiptSuggestion` shape, so MUT-301 and MUT-304 can feed the same function. This satisfies Basel's "generic input" amendment.
- **D8: approve.**
  - `POST /v1/receipts/{id}/approve` with `CreateExpenseRequest` plus the receipt's own `suggested` passed through, with an Idempotency-Key from `useAttemptKey`.
  - On 201: toast "Filed", `markSaved` on the new expense, and invalidate receipts list, counts and expenses. Then go to the next To-review receipt in the loaded list, or back to the gallery if none is left.
  - **409 `RECEIPT_ALREADY_FILED`**: a toast with "Open expense" (`details.expenseId`), and the receipt is refreshed into its Filed view.
  - **422 `ATTACHMENT_NOT_READY`**: an error banner.
  - Field errors go through `applyExpenseApiError`, the same as the drawer.
- **D9: upload without an expense.**
  - "Upload receipt" (`multiple`, PDF/JPEG/PNG) sits on the Receipts tab and in its empty state.
  - Each file goes through `POST /v1/receipts/uploads` (Idempotency-Key per file attempt), then `putToSignedUrl` (reused), then `POST …/complete`.
  - Validation (type, ≤10 MB) is shared with ReceiptUploader through extracted `receiptFileRules`.
  - Files upload one at a time, each with an "Uploading…" placeholder card.
  - **429**: "Too many receipts waiting; review some first". **503**: storage unavailable.
  - Success invalidates the list and counts, and the receipt appears under To review (AC2).
- **D10: a Filed receipt** opens the same page read-only: the preview, plus a summary of the linked expense from the list item's `expense` and an "Open expense" link (`/expenses?expense=<id>`). A filed receipt whose expense was deleted is back in To review (server).
- **D11: read-only.** A lapsed or read-only profile (the existing billing gate) hides Upload and Approve. Browsing and opening originals still work.
- **D12: narrow screens and RTL.** The review page stacks the preview above the form under 760 px. Logical properties throughout, so Arabic puts the preview on the right. User text goes in `<bdi>`.
- **Out of scope:**
  - filing onto an existing expense (MUT-389's `/file`);
  - deleting a receipt from the gallery;
  - reading in the portal (MUT-301, MUT-304);
  - VAT.

  Offer the first two as follow-ups.

## Files

### Server (`server/`)
- `src/attachments/rules.ts`: `contentDisposition(filename, kind = 'attachment')`.
- `src/attachments/storage.ts` and `local-storage.ts`: pass `kind` through. The local token carries the disposition.
- `src/routes/receipts.ts` and `src/schemas.ts`: the `disposition` query on download.
- `src/app.ts`: PORTAL_CSP `img-src 'self' data: https://storage.googleapis.com`, and `frame-src` + storage. Update the comment.
- `openapi/openapi.yaml` (regenerated), plus the API version, `.claude/CHANGELOG.md` and an ADR for the CSP and inline disposition (claim the number).
- Tests: download inline vs attachment (memory and local driver), and a CSP string assertion.

### Portal (`src/hosted/`)
- `api/client.ts`: `listReceipts`, `receiptCounts`, `getReceipt`, `libraryReceiptDownload`, `startLibraryUpload`, `completeLibraryReceipt`, `approveReceipt`. Run `npm run hosted:types`.
- `data/receiptQueries.ts`: `useReceipts` (infinite), `useReceiptCounts`, `useReceipt`, `useReceiptDownload`, `useUploadReceipts`, `useApproveReceipt`.
- `data/filters.ts`: `ReceiptFilters` (`status=to_review|filed|all`, default `to_review`).
- `router.tsx`: `/expenses/receipts` and `/expenses/receipts/$receiptId`.
- `pages/views/ExpenseGroupsList.tsx`: `useExpensesTabs` adds Receipts when counts say the library is on.
- `pages/views/ReceiptsGallery.tsx`, `pages/views/ReceiptReview.tsx`.
- `components/ReceiptPreview.tsx`: image with zoom-to-fit/actual size, or a PDF iframe, plus "Open full size". `components/ReceiptCard.tsx`.
- `components/ExpenseDrawer.tsx` becomes `components/expenseForm/{useHostedExpenseForm.ts,ExpenseFormFields.tsx}` (extraction only).
- `components/ReceiptUploader.tsx`: use the shared `receiptFileRules`.
- `lib/receiptSuggestion.ts`.
- `i18n/en.json` and `ar.json` under `hosted.receipts.*`. `hosted.css` gets `hp-receipts-*`.
- `.claude/COMPONENT_REGISTRY.md` and `.claude/TECH_DEBT.md` (thumbnails).

### Release-QA
- `qa/support/portalApi.ts`: a FakeApi `receipts` resource (list, counts, get, download with disposition, uploads, complete, approve), and `StubReceipt` with `filingStatus` and `suggested`.
- `qa/features/portal/receipts.yaml`:
  - `gallery` (AC1: filter, count, open original);
  - `upload` (AC2: lands To review);
  - `review-approve` (AC3 + AC4: prefill marked, vendor typeahead, Approve files and moves on);
  - `filed` (open a filed receipt with its expense);
  - `unavailable` (404 hides the tab).
- `qa/features/portal/direction.yaml`: `receipts-review-ar` (AC5, RTL).
- `qa/specs/portal/receipts.spec.ts`: one named `step()` per AC.

## Tests that prove each AC

- **AC1:** `receiptQueries` and gallery component tests (filter param, count label, PDF tile vs lazy image); QA `portal.receipts.gallery`.
- **AC2:** an upload hook test (start, PUT, complete, invalidate; 429 message); QA `portal.receipts.upload`.
- **AC3:**
  - `receiptSuggestion.test.ts` covers JOD 3dp, ILS 2dp, an unsupported currency, missing fields, and a date only;
  - review page tests: prefill hint, approve body includes `suggested`, 409 path, next receipt;
  - QA `portal.receipts.review-approve`.
- **AC4:** the same QA flow types into the vendor field and picks a suggestion. The drawer's `vendor-typeahead` spec still passes.
- **AC5:** the i18n parity test, QA `portal.direction.receipts-review-ar`, and `release-qa release --only portal.receipts` green.

Commands:
- `npm run test` (vitest, portal);
- `cd server && npm test`, plus `test:db` for the download route;
- `npm run lint`, `npm run typecheck`;
- `release-qa release --only portal.receipts,portal.direction.receipts-review-ar,portal.expenses --wait`.

## Business / product impact
- On the web, receipts from the phone can finally be seen, reviewed and filed. Today they pile up invisibly in To review.
- It's the last web piece of MUT-252, and it unblocks turning `receipts_library_enabled` on in prod together with MUT-258 (the deploy is held for these two).
- The risk is low: the CSP opens only the signed storage origin, and the form is extracted, not forked.

## Amendments from the eng review (2026-10-25). These override the sections above.

- **A1:** approve **never sends `suggested`**. On approve it replaces the stored suggestion (`schemas.ts:2935`), and the portal has no reader. MUT-301 will send it. The AC3 test checks that the approve body has no `suggested`.
- **A2:** the attempt key on approve.
  - Mount the review body with `key={receiptId}`.
  - Use `keyFor({ receiptId, body })`.
  - Drop the key on any 4xx `ApiError`, because the server stores 4xx answers as final under the key. Keep it only for network errors and 5xx.
- **A3:** the Filed view works on a direct link. It uses `receipt.approved` + `expenseId` from `GET /v1/receipts/{id}`, prefers the cached list item, and falls back to `useExpense(expenseId)`.
- **A4:** two 429 messages.
  - `TOO_MANY_PENDING_UPLOADS`: "finish or remove unfinished uploads".
  - The per-minute limit: "try again in N s", from `retryAfterSeconds`.
  - When the PUT or complete fails, a best-effort `DELETE /v1/receipts/{id}` (new `deleteLibraryReceipt` client call) cleans up, so a PENDING row doesn't hold the 20-receipt cap.
- **A5:** `receiptFileRules` covers type, ≤10 MB, and the server's filename rule (≤200 chars, no slashes or control characters). ReceiptUploader keeps its own per-expense cap of 10.
- **A6:** the local driver serves inline PDFs without `content-security-policy: sandbox`, and the portal CSP's `frame-ancestors 'none'` must not reach that response. A server test asserts the headers on an inline `/dev/attachments` GET.
- **A7:** keep the CSP string test, and add a staging deploy check to the runbook and ticket: open an image and a PDF receipt, and confirm no CSP violation. D11 uses `useWriteGate()` (`session/me.tsx:68`).
- **A8:** FakeApi storage serves a real 1×1 PNG or JPEG by mime type and honours the disposition. The PDF QA step checks the iframe `src` and that the request carried `disposition=inline`, because headless Chromium doesn't render PDFs.
- **A9:** the prefill hint goes in as an optional `hints` prop on the shared `src/components/expenses/ExpenseFormFields`, and the local app is unchanged.
  - The extracted hosted body is named `HostedExpenseFields`.
  - The form and vendor ids become parameters.
- **A10:** check 409 `CONFLICT` with `details.reason RECEIPT_ALREADY_FILED` before `applyExpenseApiError`.
- **A11:** availability is judged by status. 404 or 503 hide the tab, with no retry on 404 or 503.
- **A12:** the parameter is named `disposition`, passed in `signDownload`'s input object. The optional local token claim is `d`; a missing `d` means attachment. Only the PDF preview and "Open full size" ask for inline (images display fine with attachment). The disposition is part of the query key.
- **A13:**
  - The URL filter `status` maps to `filingStatus=TO_REVIEW|FILED`; `all` sends no filter.
  - "Next receipt" is computed before the list is invalidated.
  - No `captureSource` is sent.
  - An unsupported currency leaves the form's default currency and an empty amount.
- **A14** (defaults taken on two small questions): approve fires `expense_recorded` with the currency, like the drawer. An unsupported suggested currency shows a hint, "The receipt says {currency} {amount}", next to the empty amount.
