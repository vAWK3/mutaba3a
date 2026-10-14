# MUT-191 — Malafat suggestions in the hosted portal

Status: **PLANNED (2026-10-15)**, branch `feature/mut-189-malafat-upsell` (epic worktree; MUT-190 merged to main from it).
Ticket: MUT-191 (Story) · epic MUT-189. Blocked by MAL-1153 (malafat.app recognising the referral; Basel sequences the release himself, 2026-10-15) and, for C1, MUT-183 (merged, In Review). Builds on MUT-190 (ADR-078: rules, copy, one suggestion per event) and MUT-174 (`malafatUrl`).

## 1. Acceptance criteria

| # | AC (ticket) | Proved by |
|---|---|---|
| A1 | Reuses the shared link builder with `utm_medium=portal` | `malafatUrl({ locale, medium: 'portal', content, contact: true })`; component tests assert the href |
| A2 | No suggestion on Malafat-fed or Personal-type profiles | `portalMalafatEligible(profile)` unit tests: `writerOfRecord === 'MALAFAT'` → no; `isPersonalDefault` or `type === 'PERSONAL'` → no; owned BUSINESS and firm (type null, not Malafat) → yes |
| A3 | Dismissals and the switch persist (server per user, or browser; chosen here) | **Server, per user**: `/v1/me` carries `user.malafatSuggestions`; `PUT /v1/me/malafat-suggestions` stores it. Server route + repository contract tests (memory + Postgres); portal hook tests |
| A4 | Copy from the portal's own dictionaries, EN + AR, RTL | `hosted.malafat.*` in `src/hosted/i18n/{en,ar}.json` (parity test exists); AR component cases |
| A5 | No modals or toasts, one suggestion at a time, never inside a save flow | inline only; one slot per screen; C1 renders on the new profile's page after the drawer has gone; component tests |

## 2. Decisions

- **D1 — Server, per user (A3).** The portal stores nothing in the browser but the language (`hosted-portal.md` §7.1; `HostedLanguageProvider` says so), so a browser dismissal would break a documented rule; and a server preference follows the account across browsers and lets the phone app (MUT-192) share it through `/v1/me`. Cost: one nullable JSON column, one route, an OpenAPI bump.
- **D2 — S1 lives in the account menu** (`UserMenu`), the portal's only settings-like place, beside Language: one line "For law firms and accounting offices…", "See Malafat", and the "Show Malafat suggestions" switch. Not dismissible.
- **D3 — C1 renders on the new profile's own page.** `ProfileCreateDrawer.onCreated` (the hook MUT-183 left for this) navigates to `/p/<id>`; when the created profile is a BUSINESS, it sets a session flag for that id, and the profile's home shows the note once (until dismissed or a reload). Its existing "created" toast is a save confirmation, not a suggestion, and stays.
- **D4 — C2/C3 on Clients**, inside the loaded view before the table, never while searching or empty: C2 at `MALAFAT_CLIENT_THRESHOLD` (10) active customers of the profile; C3 when the person has ≥ 2 business profiles (owned BUSINESS). One card per visit (session flag), C1/C3 one event (MUT-190's `dismissMoment`).
- **D5 — Reuse MUT-190.** The pure rules (`src/lib/malafatSuggestions.ts`) and the card (`MalafatSuggestionCard`) are reused; the card imports `useT` from `lib/i18n/core` instead of the index (the portal's import rule), and its slot claim is harmless in the portal.
- **D6 — Firm profiles count as eligible** (type null, not Malafat-fed): operator-provisioned firms not yet on Malafat are exactly the audience. *Flagged for Basel.*

## 3. Where the code goes

**Server**
| File | Change |
|---|---|
| `server/prisma/schema.prisma` + `migrations/20261015090000_mut191_user_malafat_suggestions/migration.sql` | `User.malafatSuggestions Json?` (nullable, additive) |
| `server/src/repositories/ports.ts`, `memory.ts`, `prisma.ts` | `UserRecord.malafatSuggestions`; `users.setMalafatSuggestions(userId, value, at)` |
| `server/src/schemas.ts` | `MalafatMomentSchema` (`business-profile`, `client-threshold`, `second-business`), `MalafatSuggestionsSchema` `{ off: boolean, dismissed: MalafatMoment[] }` (max 3, unique), `MeSchema.user.malafatSuggestions` (resolved: `{ off: false, dismissed: [] }` when null) |
| `server/src/routes/sessions.ts` | `buildMe` includes it; `PUT /v1/me/malafat-suggestions` (session principal, identity scope, organization-independent), 200 → the stored value; audit entry `user.malafat_suggestions_set` |
| `server/src/auth/writability.ts` + `hosted-portal.md` §5 | the new route under `identity` (drift test) |
| OpenAPI + `API_VERSION` 1.25.0-mut191; root `npm run hosted:types` | regenerated |
| tests | route tests (read, write, validation, other users unaffected, device session too), repository contract (memory + Postgres), version pins |

**Portal**
| File | Change |
|---|---|
| `src/hosted/data/malafatSuggestions.ts` (new) | `portalMalafatEligible(profile)`, `businessProfileCount(me)`; `useMalafatSuggestions()` (resolved from `me`), `useSetMalafatSuggestions()` (PUT, writes the `me` cache) |
| `src/hosted/session/malafatMoments.ts` (new, zustand) | `businessCreatedId`, `clientsRetiredThisVisit` (session only) |
| `src/hosted/shell/UserMenu.tsx` | S1 row + switch |
| `src/hosted/components/ProfileCreateDrawer.tsx` | `onCreated`: BUSINESS → mark the id |
| `src/hosted/pages/views/ProfileHome` (the `/p/$profileId` index) | C1 note for the marked id |
| `src/hosted/pages/views/ClientsPage.tsx` | `MalafatClientsCard` (C2/C3) in the loaded view |
| `src/components/malafat/MalafatSuggestionCard.tsx` | `useT` from `lib/i18n/core` |
| `src/hosted/i18n/{en,ar}.json` | `hosted.malafat.*` (S1, switch, C1–C3, CTA, dismiss, labels), copy as MUT-190 |
| `scripts/bundle-origins.json` | `hosted` += `https://malafat.app` |
| QA | `qa/specs/portal/malafat.spec.ts` + `qa/features/portal/malafat.yaml`: a signed-in portal stubbed with `page.route` (`/v1/me`, customers, summaries, the PUT): S1 in the account menu; C3 on Clients with two business profiles; dismiss → PUT body; never on a personal profile |

## 4. Tests (written first)
Pure eligibility; hook writes (PUT body merges, cache update); UserMenu S1 (link `utm_medium=portal&utm_content=settings`, switch PUTs `off`); C1 on the marked profile only; Clients card: C2 at 10, C3 at two businesses, none on personal/Malafat, none while searching, retire → PUT + nothing more this visit; server route/contract tests; QA as above.

Gate (Node 22): root lint, typecheck, `test:run`, build, `test:bundles`, `hosted:types:check`, `release-qa lint`; server typecheck, lint, `openapi:check`, `test`, `test:db`.

Business / product impact
- Firms using the portal who aren't on Malafat yet meet it at the moments it helps, with one switch to turn it off, and the choice follows the account (and the phone app next).
