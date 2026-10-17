# MUT-154 — Landing page counts visits and CTA clicks without cookies

Epic MUT-152, contract `docs/analytics/events.json` 1.1.0, rules `docs/analytics/README.md`, ADR-090.
Built in the epic worktree `.claude/worktrees/mut-152-analytics`, together with MUT-155.
Planned 2026-10-17. Basel asked for the whole epic to run autonomously, so eng decisions are
auto-decided on the recommended option and listed under §6 for him.

## 1. Problem

We don't know which channels bring visitors to `/`, `/hosted`, `/privacy` and `/download`, or which
call to action they click.

## 2. Design

```
main.tsx (shared with /app)          landing page chunks (lazy, web build only)
  LandingProviders ── no analytics     LandingPage / HostedOfferPage / PrivacyPolicyPage / DownloadPage
                                          └─ useLandingAnalytics()          ← the only caller
                                               └─ landingAnalytics.ts      (start after idle; click delegation)
                                                    └─ import('posthog-js') (dynamic: its own chunk)
                                                    └─ src/lib/analytics/{contract,guard,posthogConfig}.ts
```

- **Config.**
  - `MUTABA3A_POSTHOG_KEY` → `__POSTHOG_KEY__`, following the repo's `MUTABA3A_*` define pattern
    rather than `VITE_*`.
  - Validated in `vite.config.ts` as `phc_` plus at least 20 alphanumerics, or unset; a bad key
    fails the build.
  - The web build gets it, the desktop build gets `""`, and the hosted build gets it too (MUT-155).
  - The host is a constant, `https://eu.i.posthog.com` (ADR-090 says EU; the portal's CSP must
    name it, so it isn't configurable).
- **Shared, pure code in `src/lib/analytics/`** (the landing and the portal both use it; the
  portal imports the files directly, never a barrel):
  - `contract.ts`: a typed view of `events.json`.
  - `guard.ts` — `guardEvent(event, surface, context)`:
    - Drops an event that isn't in the contract or isn't emitted by `surface`.
    - Keeps only contract properties with valid values: enum membership, boolean, integer,
      currency in `currencies`, semver.
    - Injects the shared properties (`surface`, `app_version`, `locale`) and `$geoip_disable`.
    - Keeps the routing/identity fields, the control properties and the surface's `$` allowance
      (README rule 1); drops the rest, including `$set` / `$set_once`.
    - On the landing, drops the referrer when it points at `/app`.
  - `posthogConfig.ts`: the shared init options (everything in README rule 7 off,
    `person_profiles: 'never'`, `disable_external_dependency_loading`, `advanced_disable_flags`,
    `capture_pageleave: false`, `before_send`).
- **Landing (`src/pages/landing/analytics/landingAnalytics.ts`):**
  - Starts on the first idle callback after mount, so LCP isn't touched.
  - Starts at most once per page load.
  - With no key, it does nothing.
  - `cookieless_mode: 'always'`; automatic pageview on.
  - One delegated `click` listener, with a pure `ctaForHref(href)`:
    - `/app…` → `open_web_app`
    - `/hosted` → `hosted_offer`
    - `apps.apple.com` → `app_store`
    - `play.google.com` → `play_store`
    - `malafat.app` → `malafat`
    - anything else (desktop downloads, sign-in, anchors) → nothing
- **Store link campaign.** The App Store link gains `ct=mutaba3a-landing` (Apple's campaign token).
  `pt` (the provider token) isn't known yet, so it is a constant left `null`; Basel adds it from
  App Store Connect. Android has no listing.
- **Keeping the SDK out of the local app:**
  - ESLint `no-restricted-imports` bans `posthog-js` (value imports) everywhere except the landing
    and portal analytics modules.
  - `scripts/check-bundles.ts` fails if a PostHog marker appears in any chunk statically reachable
    from the web entry, or anywhere in `dist-desktop`.
  - The PostHog origins join the allowlists (local and hosted) for what the library carries.
- **Privacy policy (en + ar).** Publishes the shared changes, plus the landing pieces from
  `docs/analytics/README.md`:
  - the intro with the portal;
  - `scope.body` (both sentences);
  - the `noTracking` title and body;
  - the `sharing` sentence;
  - the new `usageAnalytics` section, with the landing sentence;
  - the `network` sentence.

  "Last updated" bumped. The portal sentence is MUT-155's (same merge).

## 3. Tests (written first)

- `src/lib/analytics/__tests__/guard.test.ts`:
  - unknown event dropped;
  - wrong emitter dropped;
  - bad enum value / non-boolean / unknown currency dropped;
  - shared properties injected;
  - `$set` / `$set_once` stripped;
  - `$current_url` kept on the landing and dropped on the portal;
  - an `/app` referrer dropped on the landing;
  - routing and control fields kept;
  - `$geoip_disable: true` added.
- `src/pages/landing/analytics/__tests__/landingAnalytics.test.ts`:
  - no key → no import and no listener;
  - with a key → init called once with cookieless and the rule 7 config;
  - nothing before idle;
  - a click on each CTA kind → `landing_cta_clicked {cta}`;
  - a desktop download click → nothing;
  - `ctaForHref` table.
- `scripts/__tests__/vite-config.test.ts`: `posthogKey()` accepts unset or valid, and throws on
  a bad key.
- `scripts/__tests__/check-bundles.test.ts`: `staticGraph()` follows static imports only; the
  PostHog marker rule fires.
- `PrivacyPolicyPage.test.tsx`: the `usageAnalytics` section renders in en and ar.
  `download-config` test: the store link carries `ct`.

## 4. Release-QA (`qa/features/web/landing-analytics.yaml`, `qa/specs/web/landing-analytics.spec.ts`)

On a preview build with a test key, with requests to `eu.i.posthog.com` intercepted:

1. `pageview-cookieless`: open `/`. One `$pageview` goes out with `surface: landing`, `locale`,
   `app_version` and `$geoip_disable`. No `ph_*` cookie and no `ph_*` storage.
2. `cta`: click "Open in your browser" on `/`. A `landing_cta_clicked` with `cta: open_web_app`
   goes out.
3. `local-app-silent`: open `/app`. No request to PostHog in 5 s.
4. `no-key-silent` (a build with no key): open `/`. No request to PostHog.

## 5. Out of scope

- Country (GeoIP is off).
- Desktop download clicks (desktop retired).
- The hosted request form's submit as an event: worth a contract bump later.
- `pt` for the App Store.

## 6. Auto-decided (for Basel)

| # | Decision | Why |
|---|----------|-----|
| A1 | `MUTABA3A_POSTHOG_KEY` (build-time define), not `VITE_POSTHOG_KEY` | The repo's pattern; validated at build time; the docs updated |
| A2 | Host fixed to `https://eu.i.posthog.com` | ADR-090 EU; the portal CSP needs a fixed host |
| A3 | One delegated click listener + `ctaForHref`, not per-component handlers | One place; covers every landing page; testable |
| A4 | Desktop downloads not counted | Desktop retired until v2; no contract value |
| A5 | The hosted-request submit not counted yet | Needs contract 1.2.0; proposed as a follow-up |
| A6 | App Store link gets `ct` now; `pt` left for Basel | The provider token lives in App Store Connect |
