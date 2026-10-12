# Mutaba3a Brand v2 — kit index

One look across the landing page, the web/desktop app, the hosted portal and the iPhone app.
Delivered 2026-10-12. Tracked in Jira as epic **MUT-101**:
MUT-102 (foundation: tokens, fonts and the type scale), MUT-103 (app sweep), MUT-104 (icons and browser chrome),
MUT-105 (iPhone app) and MUT-106 (invoice PDFs). MUT-77 (landing) and MUT-91 (portal) are re-cut to build on MUT-102.

## Source of truth

`src/styles/brand/mutaba3a.tokens.json` is canonical. Every platform file is derived from it:

| Platform | File | Status |
|---|---|---|
| Web (app, landing, portal, desktop) | `src/styles/brand/mutaba3a-theme.css` | Placed, **not imported yet** |
| iPhone app (Flutter) | `mutaba3a-flutter/mutaba3a/lib/presentation/theme/mutaba3a_theme.dart` | Applied in that repo |

Change a value in the JSON first, then in both platform files.

## Deviations from the files as delivered

- **AAA light inks (decided 2026-10-12).** Seven light-mode values are darkened so that text clears 7:1:
  `ink2`, `primaryHover`, `lavenderInk`, `mintInk`, `roseInk`, `peachInk` and `butterInk`. These are the values the iOS app already used. Dark mode is unchanged.
- **Purple primary as text is only AA** (4.78:1 on canvas). Wherever purple carries text, such as links, text buttons and selected-tab labels, use `primary-hover` instead. `primary` stays for fills and decoration. The iOS app does the same.
- **No CDN `@import`s.** The delivered CSS loaded Thmanyah from jsDelivr (`@dawod/thmanyah-font-web`) and Plex Mono from Google Fonts. Both lines are removed:
  - the Thmanyah licence forbids third-party redistribution;
  - `scripts/check-bundles.ts` and the portal CSP (`default-src 'self'`) reject new origins;
  - the desktop app must work offline.

## Asset map

| Asset | Location | Used by |
|---|---|---|
| `favicon.svg`, `favicon-16/32/48.png`, `apple-touch-icon.png` | `public/` | app + landing `<head>` |
| `favicon.svg` | `src/hosted/public/` | portal (its own public dir) |
| `icon-192.png`, `icon-512.png`, `maskable-512.png`, `icon-1024.png` | `public/icons/` | PWA manifest (`vite.config.ts`) and the sidebar logo |
| `og-mark-1200.png` | `public/` | Open Graph / social preview (not wired yet) |
| `mark.svg`, `mark-dark.svg` | `src/assets/brand/` | wordmark in the sidebar, the landing header and the portal header (bundled, so all three builds get it) |
| Thmanyah Sans 400/500/700, Thmanyah Serif Display 400/700, IBM Plex Mono 400/500 | `public/fonts/` | UI and invoice PDFs |
| iOS AppIcon set, Android mipmaps | Flutter repo (`ios/Runner/Assets.xcassets`, `android/app/src/main/res`) | iPhone/Android app |
| Desktop icons (`.icns`, `.ico`, PNGs) | `src-tauri/icons/` | **still the January set**: regenerate from `public/icons/icon-1024.png` (check the macOS margin first) |
| `head-snippet.html`, `manifest-snippet.json` | `docs/brand/` | reference for wiring `index.html`, `hosted.html` and the VitePWA manifest; not shipped |

## Typography

- **Thmanyah Sans:** body and UI text, in **both** Arabic and English. It has full Latin coverage.
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

- **Retiring with the foundation ticket** (delete only once nothing references them):
  - the `@fontsource-variable/inter`, `@fontsource-variable/source-serif-4` and `@fontsource/ibm-plex-sans-arabic` packages;
  - the PDF-only `public/fonts/{Amiri,IBMPlexSans,IBMPlexSansArabic,SourceSerif4}-*.ttf`, which `src/features/documents/pdf/fonts.ts` loads until invoice PDFs move to Thmanyah.

## Thmanyah licence: read before shipping web builds

The licence is embedded in the font files (name table, id 13). Its terms:

- **Permitted:** commercial use in websites and apps. Embedding is allowed in documents and apps, and in web apps "only as part of a compiled, packaged, or obfuscated product".
- **Forbidden:**
  - hosting or redistributing the files, or downloading them from anywhere but Thmanyah's official site;
  - letting end users extract them "including through web embedding";
  - modifying them. That rules out subsetting and `.otf` → `.woff2` conversion, so serve the files unmodified.

The iPhone app, the desktop installer and the PDFs are clearly covered. Raw `.otf` files served to browsers (landing, web app, portal) are the grey zone. The licence directs exceptions to **ask@thmanyah.com**, so get a written OK before a web release.
