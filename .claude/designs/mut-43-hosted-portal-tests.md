# MUT-43 — Hosted portal: test plan

- **Date:** 2026-10-11 · **Ticket:** MUT-43 · **Design:** `hosted-portal.md` §7–§8, `mut-43-auth-states.md` (approved)
- **Runner:** Vitest + Testing Library (jsdom) for everything under `src/hosted/`, `src/lib/i18n/` and `scripts/`. `fetch` is stubbed at the boundary; nothing else is mocked.
- **Order:** each block is written red before its code.

## 1. Build target and bundles

| Test | File | Asserts |
|---|---|---|
| Local build configs are unchanged | `scripts/__tests__/vite-config.test.ts` | The `web` and `desktop` configs, with plugins reduced to names, equal a snapshot taken **before** the hosted branch was added |
| Hosted config | same | `outDir` `dist-hosted`, no PWA plugin, entry `hosted.html` emitted as `index.html`, `publicDir` `src/hosted/public`, dev proxy `/v1` → the API |
| Bundle rules (pure) | `scripts/__tests__/check-bundles.test.ts` | `findForbidden` catches each portal marker in a local bundle; each Dexie/IndexedDB/sync marker and each banned en/ar affordance string in the hosted bundle, case-insensitively; `تسجيل الدخول` is **not** a match; `extractOrigins` + allowlist diff reports a new origin and ignores known ones |
| Bundles on disk | `npm run test:bundles` | Builds web, desktop and hosted, then runs the rules over the three `dist-*` directories. Exit 1 on any finding |

## 2. Lint guards (`eslint.config.js`)

- `src/hosted/**` may not import `src/db`, `src/sync`, `src/hooks`, `src/components/layout`, `src/components/drawers`, `src/lib/stores*`, `src/lib/i18n/context` (the app provider that carries the full translation files) or `dexie`.
- `src/hosted/**` may not call `Number()` or `parseFloat()`, and may not use unary `+`, on anything. Amounts are strings end to end. A fixture file proves each rule fires (`scripts/__tests__/hosted-lint.test.ts` runs ESLint's API on in-memory code).

## 3. i18n

| Test | Asserts |
|---|---|
| Core split keeps the app provider identical | `LanguageProvider` still detects, persists on mount, sets `lang`/`dir`, interpolates `{var}`, and returns the key for a missing one |
| `tp()` | en `one`/`other`; ar `zero`/`one`/`two`/`few`/`many`/`other` for 0, 1, 2, 3, 11, 100; falls back to `other`; interpolates `{count}` and other vars |
| Hosted parity | Same key set, same leaf types, same `{var}` names per key in `src/hosted/i18n/en.json` and `ar.json`; every plural in `en` has all six forms in `ar` |
| Hosted `common` subset | Each `common.*` key the portal carries equals the app's value for that key in both languages (no drift) |
| Hosted language precedence (E4) | No stored choice → the account locale applies after `/v1/me`; a stored choice → the account locale is ignored; an explicit switch persists; detection alone never persists |

## 4. API client (`src/hosted/api/client.ts`)

- Sends `credentials: 'same-origin'`, `Accept: application/json`, never `Authorization`.
- Profile-scoped calls send `X-Mutaba3a-Profile: <id>`; `/v1/me` and `/v1/sessions*` do not.
- A non-2xx with the server envelope becomes `ApiError { status, code, details, retryAfterSeconds }`; a non-JSON or empty body becomes `ApiError { status, code: 'UNKNOWN' }`; a thrown `fetch` becomes `ApiError { status: 0, code: 'NETWORK' }`.
- Any 401 from a call other than `POST /v1/sessions` invokes the registered unauthorised handler exactly once per response.
- Query strings drop `undefined`/empty values and encode the rest.
- `npm run hosted:types:check` fails when `src/hosted/api/schema.d.ts` differs from a fresh `openapi-typescript` run.

## 5. Auth (`mut-43-auth-states.md`)

| Id | Test |
|---|---|
| S1 | While `/v1/me` is pending, neither the sign-in form nor the shell renders; the spinner is absent before 400 ms and present after |
| S2 | `/v1/me` network error and 500 each render the boot card with `role="alert"`; Try again refetches and, on 200, renders the shell |
| S3 | `/v1/me` 401 → `/sign-in`; email has focus; inputs carry `autocomplete`, `dir="ltr"`; no element or text matches the banned strings |
| S4 | Empty submit sends no request and shows both field messages; a malformed email shows `emailInvalid` |
| S5 | A pending sign-in disables the button and makes fields read-only; a second submit sends nothing |
| S6 | 401 → banner; password cleared and focused; email kept |
| S7 | 429 with `Retry-After: 150` → "3 minutes" (en) and the Arabic `few` form |
| S8 | Network error, 500 and 403 each → the unreachable banner; values kept |
| S9/S10 | `reason=expired` shows the expired note and returns to `next`; `reason=signed_out` shows the signed-out note and drops `next` |
| `next` | `safeNext` keeps `/p/x/receivables?status=OPEN`; rejects `//evil.example`, `https://evil.example`, `/\evil`, `javascript:…`, `` and `undefined` → `/` |
| Signed in | Visiting `/sign-in` with a session redirects to `next` or `/` |
| S11 | `profiles: []` → the no-profiles state with Sign out and no profile nav |
| S12 | Unknown `$profileId` → unavailable with "Go to {first}"; a 404 from a list whose profile is still in `/v1/me` is **not** S12 |
| S13 | `DELETE` failure → toast, the page and its figures stay |
| E1 | A 401 from any view clears the query cache **before** the sign-in route renders, and the URL carries `next` and `reason=expired` |
| E2 | Sign-out 204 clears the cache, posts `signed_out` on `BroadcastChannel('mut-session')`, lands on S10 |
| E3 | Receiving `signed_out` clears the cache and navigates to S10 |

## 6. Shell and switcher

- The sidebar lists Overview, Clients, Receivables, Payments, Documents for the active profile; links keep `/p/$profileId`.
- The switcher shows each profile's name, the "Hosted" chip and the source sentence (`writerOfRecord` `MALAFAT` → "Income recorded by Malafat", `null` → "Expenses only"), marks the active one, and shows the local-profiles footer.
- Choosing another profile navigates to the same section under the new id and never renders the previous profile's figures (the query keys include the profile id).
- The user menu shows the name and email, switches language, and signs out.

## 7. Views

Each of Overview, Clients, Client detail, Receivables, Payments, Documents:

- **Loading**: skeletons, no figure.
- **Empty**: the view's empty copy.
- **Error**: the unreachable card with Retry, no figure.
- **Populated**: rows pre-shaped (names joined from the directory, amounts as `DecimalAmount`).
- **Stale figure (AC)**: a successful load, then a failed refetch → the card, and none of the first load's amounts in the DOM.

Plus:

- **Read-only notice** on Receivables, Payments, Documents and the client-detail income tabs: the `MALAFAT` sentence or the `null` sentence, `role="note"`, read from `profile.writerOfRecord`; no edit, record-payment or row-action control exists.
- **Overview**: the strip shows Owed · Overdue · Proposed for the chosen currency; the currency segment appears only when more than one currency has a non-zero figure; rows sort overdue → outstanding → quiet → name.
- **Filters**: each list view keeps one filters object in the URL search params and updates it with `replace` (history length unchanged after three filter changes); a filter change refetches with the matching query params.
- **Payments**: a row expands to its allocations.
- **Documents**: Download calls `/download` and navigates to the signed URL; no inline preview element exists.
- **`DecimalAmount`**: formats `"1234.50"`, `"-0.01"`, `"1000000.00"`, ILS/USD/EUR in en and ar exactly (string in, no float rounding: `"0.10"` stays 0.10, `"9007199254740993.01"` keeps every digit); `dir="ltr"` isolation inside RTL text.
