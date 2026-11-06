# MUT-562 — test plan

Unit (Vitest):
- `pages/client-books/__tests__/clientBooksRules.test.ts`: months, presets (never future, ≤12 months), search parse/serialise, feed bounds/kinds, rows, totals per currency, list search, corner rule, labels.
- `pages/share-link/__tests__/shareLinkState.test.ts`: check/unlock/view answers → states, attempts left, 401 → PIN again, 404 forgets the viewer; viewer tokens under SHA-256, never the link token.
- `pages/accountant-invite/__tests__/inviteState.test.ts`: check × session × outcome → view; accept and signup refusals.
- `components/__tests__/PinBoxes.test.tsx`: typing, growth to 8, Arabic-Indic digits, backspace, paste, Enter, one group label.

Page (real router, stubbed fetch):
- `ClientBooks.test.tsx`: corner shown/hidden, list + ended row + Remove, search, empty, client book (read-only line, totals, no write control, drawer keys ignored, feed params), filters to URL and feed, receipt pane inline URL, 404 → no longer shared.
- `AcceptInvitePage.test.tsx`: fragment stripped, signup → sessions → client book, stale terms retried once, account exists, gone, accept, tab storage, mismatch, already, Not now.
- `ShareLinkPage.test.tsx`: fragment stripped, meta, nothing named before PIN, wrong/locked/limit/gone, Arabic-Indic PIN, open view, kinds filter, receipt, PIN again after 401.

Release-QA: see the brief's QA scenarios (11 flows).
