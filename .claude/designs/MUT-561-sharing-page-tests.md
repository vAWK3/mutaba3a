# MUT-561 — test plan (slice A)

Written before the code (TDD). Unit tests run with `npx vitest run <files> --maxWorkers=3`.

| File | What it pins |
|---|---|
| `scripts/__tests__/illustration-set.test.ts` | Scene names; the three art hexes map to `--m-field-bg` / `--m-primary` / `--m-peach-strong`, case-insensitively; `none` kept; dashes, rotations and `data-part` kept, no raw `id`; `aria-hidden`, `focusable="false"`, sized by `size`; any other colour, element, `opacity` or a non-rotate transform fails naming the file; the registry; the generated folder equals a fresh run (drift). |
| `src/hosted/components/__tests__/Scene.test.tsx` | A drawn scene renders its art, hidden from assistive tech, no hex; a planned scene renders the `empty-state` placeholder with `data-placeholder`; size and the drop-in class; reduced motion rests on the final frame (the CSS rule). |
| `src/hosted/pages/sharing/__tests__/sharingRules.test.ts` | `sharingOpen` (owner + signed in + `/v1/me.clients`); `shortDay` in the profile zone with Western digits; `relativeDay` by calendar days (today, yesterday, 2 days, 2 weeks; Arabic wording); `grantRow` for active (seen / never seen), pending (email as label), expired; `inviteErrorOf` for SELF_INVITE, INVITE_ADDRESS_REFUSED, not an address, ALREADY_INVITED, ACCOUNTANT_LIMIT, NOT_OWNER, 404, 402, 429, network, anything else; `revokeErrorOf` (404 is done; 403 and others put the row back). |
| `src/hosted/pages/sharing/__tests__/InviteAccountantDrawer.test.tsx` | Opens by `?invite=true` with the intro and 4 points, email `dir="ltr"`; sends `{ email, locale }` (en and ar), closes, toast, the pending row; field errors with `aria-invalid` and description; banner errors (already, limit, rate, network); nothing sent for an empty address; busy: one request; lapse → read-only note, no Send. |
| `src/hosted/pages/sharing/__tests__/SharingPage.test.tsx` | Owner gets the page; a firm member and accountant access off go back to You › Profiles; links off: one column, no share-links request; entry rows in You › Profiles (and not for a member or with access off) and in the Manage profiles edit pane; the three row states; Stop confirm (focus, DELETE, toast, `accountant_revoked` `was: active`); confirm Cancel restores focus; cancel a pending invite (`was: pending`); a refused Stop puts the row back with a toast and counts nothing; Invite again (same address, locale, `accountant_invited`); the limit makes Invite inert with its reason; Invite opens the drawer by URL; empty page (scene, 4 points, Invite only); column skeleton; column error with Retry while the page stays. |
| `scripts/__tests__/analytics-taxonomy.test.ts` | Contract 2.7.0 pinned; the two new events and their emitters. |
| `src/styles/__tests__/direction.test.ts` | The new `dir` sites classified (emails LTR, names auto). |

Release-QA (web, recorded): `portal.sharing.{entry,accountants-list,invite,revoke-access,empty,layout}`.

## Slice B and review fixes

| File | What it pins |
|---|---|
| `src/hosted/data/__tests__/sharingQueries.test.tsx` | Two revokes at once, B fails → A gone, B back in place, one list read after the last; a 404 is done; a 404 links list is off; Turn off marks ended and undoes on refusal. |
| `src/hosted/pages/sharing/__tests__/NewShareLinkDrawer.test.tsx` | Period chips with their months on 2026-11-06; defaults; PIN refusals; Arabic-Indic folded; PIN_FORMAT / SHARE_LINK_LIMIT / 429 slots; busy; lapse; done pane text, Copy link, Copy message (EN exact, AR pattern, never the PIN); Done leaves no URL in DOM, URL or cache. |
| `sharingRules.test.ts` | `periodRange` against the server's examples and year/February edges; `monthsLabel`; `pinOf`/`foldDigits`; `linkRow`; `linkErrorOf`; limit fallback; `isolate`. |
| `SharingPage.test.tsx` | Links column rows/chips/Turn off/limit/error; 404 → one column; empty page with both ways; review b (refetch, inert at limit), c (focus), h (non-owner member redirect). |
