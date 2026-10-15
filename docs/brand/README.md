# Mutaba3a Brand v2 — kit index

One look across the landing page, the web/desktop app, the hosted portal and the iPhone app.
Delivered 2026-10-12. Tracked in Jira as epic **MUT-101**:
MUT-102 (foundation: tokens, fonts and the type scale), MUT-103 (app sweep), MUT-104 (icons and browser chrome),
MUT-105 (iPhone app) and MUT-106 (invoice PDFs; obsolete since MUT-145 retired document generation). MUT-77 (landing) and MUT-91 (portal) are re-cut to build on MUT-102.
The loader and splash were delivered on 2026-10-14 (`Loader & Splash.dc.html`) and committed here as received (MUT-203). They are wired in by MUT-204/205 (iPhone) and MUT-206/207 (web and portal). The export stamps a C2PA manifest into every file; the copies here keep it, and none of them ships in a build.

## Source of truth

`src/styles/brand/mutaba3a.tokens.json` is canonical. Every platform file is derived from it:

| Platform | File | Status |
|---|---|---|
| Web (app, landing, portal, desktop) | `src/styles/brand/mutaba3a-theme.css` (primitives `--m-*`) | Imported by `src/styles/theme.css`, which maps every app token onto it (MUT-102, ADR-058) |
| iPhone app (Flutter) | `mutaba3a-flutter/mutaba3a/lib/presentation/theme/mutaba3a_theme.dart` | Applied in that repo |

Change a value in the JSON first, then in both platform files. `src/styles/__tests__/brand.test.ts` › `drift` fails until the web CSS matches the JSON.

**Motion: the bloom loader (delivered 2026-10-14, MUT-203).** `docs/brand/loader/mutaba3a-loader.json` (light) and `mutaba3a-loader-dark.json` (Lottie 5.7.4, 120×120, 270 frames at 60 fps, a 4.5 s loop) define the loader's motion. The delivered SVG port (`mutaba3a-loader.js`) and Flutter port (`mutaba3a_loader.dart`) are derived from them. Ports are regenerated from the JSON, never hand-tuned. Parity tests on both platforms compare their keyframes to these files: MUT-204 (Flutter) and MUT-206 (web). Checked on delivery: each piece keys at 0/36/84/126/150/190/236/270, with 4 frames of stagger between pieces; the rotation keys at 0/36/220/270, in both themes. Neither app ships a Lottie runtime.

## Deviations from the files as delivered

- **AAA light inks (decided 2026-10-12).** Seven light-mode values are darkened so that text clears 7:1:
  `ink2`, `primaryHover`, `lavenderInk`, `mintInk`, `roseInk`, `peachInk` and `butterInk`. These are the values the iOS app already used. Dark mode is unchanged.
- **Purple primary as text is only AA** (4.78:1 on canvas). Wherever purple carries text, such as links, text buttons and selected-tab labels, use `primary-hover` instead. `primary` stays for fills and decoration. The iOS app does the same.
- **Primitives only (MUT-102).** The delivered CSS ended with a "map onto existing app tokens" block covering about 30 tokens; it is removed, and `src/styles/theme.css` maps all of them once. Three additions, no new values: `--m-shadow-tint` is factored out of the card shadow's own colour so shadows and the overlay derive from it, and `--m-press-scale` / `--m-stagger-rise` / `--m-stagger-blur` come from the JSON's motion block.
- **Filled buttons and the selected nav label (MUT-102).** Cream on `primary` is 4.84:1, so filled buttons use `primary-hover` (7.14:1), as the iOS app does; the selected nav label is `lavenderInk` on `lavender` (7.01:1). The one exemption from 7:1 is input placeholder text (85% `ink2` toward `fieldBg`, 5.02 / 4.66:1), so a hint never reads as a typed value.
- **Text on lavender is lavender-ink; text on a filled status ink is the canvas (MUT-102 review).** Purple and ink2 are under 7:1 on lavender, and white fails on the status inks once they turn light in dark mode. Blends across hues mix in oklab, and tints stay light enough for ink2 to keep 7:1. The kit's inset focus ring is kept for unfilled controls; filled buttons get an outer ring, because the inset one barely shows on a fill.
- **The figure stack falls back to Thmanyah Sans** (`--m-font-num: "IBM Plex Mono", "Thmanyah Sans", …`), so Arabic inside a figure cell keeps the brand face.
- **No font preload (MUT-102, D2).** Preloading Thmanyah Sans 400 delayed landing LCP from 3964 to 4664 ms on a slow link; `font-display: swap` paints text at once.
- **Mark fills promoted to tokens (MUT-206, ADR-079).** The loader files paint the mark with literal hexes. The web port takes them from four new tokens instead, `markDot`/`markLavender`/`markRose`/`markPeach` in `mutaba3a.tokens.json` (`--m-mark-*` in the brand CSS, `--mark-*` in `theme.css`), with the same values: light dot `#795DBA` (= `primary`), dark dot `#F3E5B0` (butter), petals `#BCABF1`/`#F499A7` in both, peach `#F5AB77` light and `#F9B379` dark. So the loader follows the in-app theme, not only the OS, and passes the literal guard. The petals are the mark's own colours, brighter than the soft `lavender`/`rose`/`peach` grounds.
- **No CDN `@import`s.** The delivered CSS loaded Thmanyah from jsDelivr (`@dawod/thmanyah-font-web`) and Plex Mono from Google Fonts. Both lines are removed:
  - the Thmanyah licence forbids third-party redistribution;
  - `scripts/check-bundles.ts` and the portal CSP (`default-src 'self'`) reject new origins;
  - the desktop app must work offline.

## Asset map

| Asset | Location | Used by |
|---|---|---|
| `favicon.svg` (light + dark styles inline), `favicon-16/32/48.png`, `apple-touch-icon.png` | `public/` | app + landing `<head>`; the portal's `hosted.html` links the same files as `./public/…`, bundled to hashed `/assets/*` (MUT-104, ADR-073) |
| `icon-192.png`, `icon-512.png`, `maskable-512.png`, `icon-1024.png` | `public/icons/` | PWA manifest (`PWA_MANIFEST` in `vite.config.ts`); `icon-1024.png` is the desktop icon source |
| `og-card-ar-1200x630.png` | `public/` | link-preview card (`og:image`, `summary_large_image`), web build only, kept out of the SW precache (MUT-104) |
| `og-card-en-1200x630.png`, `og-mark-1200.png` | `docs/brand/` | kit references, not shipped (the English card; the original square mark) |
| `mark.svg`, `mark-dark.svg` | `src/assets/brand/` | `BrandMark` (theme-aware) in the sidebar and the portal `Wordmark`; the landing header is MUT-77 (bundled, so all builds get it) |
| Thmanyah Sans 400/500/700, Thmanyah Serif Display 400/700 (`.otf`, delivered bytes) | `src/assets/fonts/` | UI in every build: declared once in `src/styles/brand/fonts.css` and bundled, so web, desktop (offline) and portal all serve hashed copies under `/assets/` (MUT-102, D4). sha256-pinned in `brand.test.ts` and checked in every dist by `check-bundles` |
| IBM Plex Mono 400/500, UI | `@fontsource/ibm-plex-mono` (OFL woff2), imported by `fonts.css` | figures in every build, portal included |
| iOS AppIcon set, Android mipmaps | Flutter repo (`ios/Runner/Assets.xcassets`, `android/app/src/main/res`) | iPhone/Android app |
| Desktop icons (`.icns`, `.ico`, PNGs, `Square*Logo`, `StoreLogo`) | `src-tauri/icons/` | generated by `npm run icons:desktop` from the full-bleed `public/icons/icon-1024.png`; no padded macOS master, since macOS 26 puts margined icons in a grey box (MUT-104, D2) |
| `head-snippet.html`, `manifest-snippet.json` | `docs/brand/` | reference for wiring `index.html`, `hosted.html` and the VitePWA manifest; not shipped |
| `mutaba3a-loader.json`, `mutaba3a-loader-dark.json` (light: dot `#795DBA`, `#BCABF1`, `#F499A7`, `#F5AB77`; dark: dot `#F3E5B0`, `#BCABF1`, `#F499A7`, `#F9B379`) | `docs/brand/loader/` | **motion source of truth**; fixtures for the loader parity tests in MUT-204 (Flutter, copied to `test/fixtures/brand/`) and MUT-206 (web); not shipped |
| `mutaba3a-loader.js` (`<mutaba3a-loader>`, inline SMIL SVG) | `docs/brand/loader/` | reference only: MUT-206 ports its SVG into `BrandLoader` (`src/components/brand/BrandLoader.tsx`, path data in `bloomLoaderData.ts`; the element's OS-only theme, shadow-root `<style>` and English label don't fit the portal CSP or ThemeToggle); not shipped |
| `mutaba3a_loader.dart` (`CustomPainter`) | `docs/brand/loader/` | reference for `Mutaba3aLoader` in the Flutter repo (MUT-204); not shipped from here |
| `splash.png`, `splash-dark.png` (768×768, mark 576 px), `android12.png`, `android12-dark.png` (1152×1152, mark 500 px), `flutter_native_splash.yaml` | `docs/brand/splash/` | input for the iPhone/Android native launch screen (MUT-205), copied to the Flutter repo's `assets/splash/`; not shipped from here |
| `splash-{light,dark}-{1290x2796,1080x2400}.png` | `docs/brand/splash/screens/` | reference renders for QA comparison only (MUT-205, MUT-207); the generated launch screen, not these renders, is the size spec |

## Typography

- **Thmanyah Sans:** body and UI text, in **both** Arabic and English. It has full Latin letter coverage, but **no ₪ glyph and no tabular figures (`tnum`)**. Set amounts in IBM Plex Mono, which has both.
- **Thmanyah Serif Display 700:** display and titles.
- **IBM Plex Mono:** figures and labels, with tabular numerals.
- **Type scale**, applied everywhere including the dense app screens (decided 2026-10-12):

  | Role | Size | Weight |
  |---|---|---|
  | display | 56 | 700 |
  | title | 32 | 700 |
  | headline | 20 | 500 |
  | body | 16 | 400 |
  | figure | 40 | 500 |
  | label | 13 | 400 |

- **Weights:** Thmanyah ships 400/500/700 and Plex Mono 400/500, so ask for one of those (a `600` renders with the Bold file). Headings are Serif Display 700 in both scripts; figures are Plex Mono 500 with tabular numerals.
- **Retired by the foundation ticket (MUT-102):** the `@fontsource-variable/inter`, `@fontsource-variable/source-serif-4` and `@fontsource/ibm-plex-sans-arabic` packages are uninstalled.
- **Retired (MUT-145, 2026-10-13):** `public/fonts/` and every PDF-only TTF in it were deleted with document generation; `noDeadDocumentModules.test.ts` fails if the folder comes back.

## Thmanyah licence: read before shipping web builds

The licence is embedded in the font files (name table, id 13). Its terms:

- **Permitted:** commercial use in websites and apps. Embedding is allowed in documents and apps, and in web apps "only as part of a compiled, packaged, or obfuscated product".
- **Forbidden:**
  - hosting or redistributing the files, or downloading them from anywhere but Thmanyah's official site;
  - letting end users extract them "including through web embedding";
  - modifying them. That rules out subsetting and `.otf` → `.woff2` conversion, so serve the files unmodified.

The iPhone app and the desktop installer are clearly covered. Raw `.otf` files served to browsers (landing, web app, portal) are the grey zone. The licence directs exceptions to **ask@thmanyah.com**, so get a written OK before a web release.
