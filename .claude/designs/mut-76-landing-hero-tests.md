# MUT-76 — Landing hero: test plan

- **Ticket:** MUT-76 (epic MUT-74) · **Brief:** `landing-apple-redesign.md` L4–L6
- **Files:** `src/lib/__tests__/platform.test.ts` (extended), `src/hooks/__tests__/usePrefersReducedMotion.test.ts`, `src/pages/landing/__tests__/heroCta.test.ts`, `src/pages/landing/__tests__/useCountUp.test.ts`, `src/pages/landing/__tests__/HeroSection.test.tsx`

| # | Behaviour | Level |
|---|---|---|
| T1 | `detectDevice` maps navigator signals to mac / windows / ios / android / linux / unknown, including iPadOS reporting `MacIntel` with touch, Android's "Linux" UA, and ChromeOS | unit |
| T2 | `chooseHeroCta`: mac → mac; windows → windows only when the release has a Windows build, else web; ios/android/linux/unknown → web | unit |
| T3 | The secondary link points to the browser when the primary is a download, and to the Get it section when the primary is the web app | unit |
| T4 | Hero renders exactly one filled CTA for a Mac, Windows, iPhone, Android and unknown visitor, with the right href and label; Mac says Apple Silicon | component |
| T5 | Windows visitor with no Windows build in the release gets the web app as the primary CTA | component |
| T6 | The hero visual is markup: no `<img>` in the hero; it shows the Owed Now label and the sample clients | component |
| T7 | The strip's totals equal the sum of the sample rows per currency (the mock-up adds up) | unit |
| T8 | `useCountUp` returns the target immediately when reduced motion is preferred; otherwise starts at 0, reaches the target after the duration, and does not restart on re-render | unit (fake timers + rAF) |
| T9 | Screen readers get the final amount only (the animating digits are `aria-hidden`) | component |
| T10 | `usePrefersReducedMotion` follows `matchMedia` and its change events | unit |

Edge cases: `navigator` fields missing (empty strings / 0 touch points) → unknown; `matchMedia` unavailable → motion allowed.
