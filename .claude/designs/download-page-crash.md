# /download crashes on load in the web build — fix brief

**Date:** 2026-10-14 · **Branch:** `fix/download-page-crash` · **Ticket:** none (found by TD-122's `link-hover.spec.ts`, which had to `test.fixme` the /download case)

## Problem
`vite build --mode web` + preview, open `/download`: the ErrorBoundary's "Something went wrong", console "No QueryClient set, use QueryClientProvider to set one".

`src/main.tsx` mounts the web build's marketing routes (`/`, `/download`, `/privacy`) outside the router and `QueryClientProvider`, with only `ThemeProvider` + `LanguageProvider`, and never needs the database. `DownloadPage` rendered the app's `TopBar`, which needs:
- React Query: `FxRateReadout` → `useFxRate` → `useQueryClient` (added to TopBar by **MUT-79**, ddca390 — the regression; not MUT-141 or MUT-57, whose Add menu `hideAddMenu` already skipped);
- the router: `ActiveProfileIndicator` → `useActiveProfile` → `useMatches`;
- the repositories (profiles) behind `useActiveProfile`.

The component test hid it: it mocked `components/layout` (`TopBar: () => null`).

## Options
1. **Give /download the providers TopBar needs** (QueryClient, a router, the database open). Pulls the app's Dexie/router stack and an exchange-rate readout and business indicator onto a marketing page that has no business showing either. Rejected.
2. **Landing chrome** — `LandingHeader homeHref="/"` (no device button: the page *is* the destination) + `LandingFooter`, skip link, an own `<h1>`, inside `.landing-page`, exactly like `PrivacyPolicyPage`. **Chosen.**

## Acceptance
- `/download` renders in a web preview build: h1 "Download", the platform buttons, landing bar (wordmark → `/`, no header button), footer, no `.topbar`, no page errors. EN and AR (RTL), light and dark, 375px with no horizontal overflow.
- Tab title unchanged (MUT-77).
- TD-122's `/download` hover case passes once its `test.fixme` is dropped.

## Shape
- `src/pages/landing/LandingProviders.tsx`: the one wrapper `main.tsx` gives all three marketing routes; tests render through it, so a component needing app context fails in Vitest the way it fails in production.
- `DownloadPage.tsx`: TopBar → landing chrome; header/footer imported from their files, not the barrel, so the lazy chunk doesn't pull the hero/FAQ CSS.
- `DownloadPage.css`: page padding and a title styled like the privacy policy's; the dead "Legacy single-card styles" block is deleted (its later `.download-title` reset the h1 to 20px/margin 0).

## Tests
- `src/pages/download/__tests__/DownloadPage.test.tsx`: no TopBar mock; renders under `LandingProviders` (red on main with the exact production error); landing chrome; no `.topbar`; AR/RTL, no raw keys; tab title EN/AR.
- `src/pages/download/__tests__/downloadCss.test.ts`: one top-level `.download-title` rule (red on the pre-cleanup CSS).
- `qa/specs/web/landing.spec.ts` `@web.landing.download`: red on a main preview build ("Something went wrong"), green on the branch.

## i18n / cost / infra
No new strings (`download.title`, `landing.skipToContent` exist in EN and AR). No infra or cost change; the download chunk loses `TopBar` and its hooks.
