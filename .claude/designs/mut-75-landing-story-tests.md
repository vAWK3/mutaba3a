# MUT-75 — Landing story: test plan

- **Ticket:** MUT-75 (epic MUT-74) · **Brief:** `landing-apple-redesign.md` L1–L3, L7, L12; findings F1–F5, F7, F8
- **Test file:** `src/pages/landing/__tests__/LandingPage.test.tsx` (component), `src/pages/landing/__tests__/landingCopy.test.ts` (i18n parity + currency list)

## What is under test

| # | Behaviour | Level | Why it matters |
|---|---|---|---|
| T1 | `main` renders exactly seven parts in order: hero, chapter-clients, chapter-payment, chapter-businesses, privacy, get-it, faq; a footer follows | component | L7 structure; guards against sections creeping back |
| T2 | The h1 reads "Know who owes you." + "Keep it to yourself." (EN) and "اعرف من يدين لك." + "وأبقِ ذلك لك وحدك." (AR) | component | L2 |
| T3 | No text on the page says Buy, $49, Universal or Intel (EN); no شراء / اشترِ / 49 (AR) | component | F4, F5 honesty |
| T4 | Get it says "Free during early access" | component | L3 |
| T5 | When the latest release has no Windows build, Get it says so instead of linking to a missing installer | component | F6, honesty |
| T6 | The FAQ has exactly six questions; each toggles `aria-expanded` and shows its answer | component | L12, a11y |
| T7 | The data-loss warning appears exactly once, inside the backup answer | component | F8 |
| T8 | The currency answer names every supported currency, built from an exhaustive `Record<Currency, …>` so adding a currency without a name fails to compile | unit | F7, "verify in code" |
| T9 | Arabic sets `<html dir="rtl">` and renders Arabic copy | component | RTL |
| T10 | No rendered text contains a raw `landing.` key in EN or AR | component | i18n completeness |
| T11 | `landing.*` keys in `en.json` and `ar.json` are the same set | unit | i18n parity |
| T12 | The payment chapter's button label is the app's own Record payment label | component | "Paid? Two taps." stays tied to the real button |

## Edge and error cases

- Release still loading → version shows "…", no Windows warning yet (T5 variant).
- Release fetch failed (`release: null`) → downloads still render (stable redirect URLs), no version.

## Out of scope here

Hero visual and device-matched CTA (MUT-76), header/motion/type (MUT-77), the visitor sample-data entry (MUT-78).
