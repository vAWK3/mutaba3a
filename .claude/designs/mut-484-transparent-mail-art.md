# MUT-484: mail art with transparent backgrounds (v2)

Epic MUT-466 · follows MUT-468 (the frame) · status: BUILT 2026-10-28 on `feature/mut-484-transparent-mail-art`.
The eng-reviewed plan (2026-10-27) lived only in another session's scratchpad; its decisions are recorded here.

## Problem
v1's art is opaque: each PNG bakes in its mood tint. Gmail apps, Outlook.com and Outlook for Mac darken table cells in
dark mode but not images, and ignore the `light only` opt-out (MUT-468's Apple Mail fix), so the 150 px header and the
40 px chip showed as pale squares (Basel's Outlook-for-Mac screenshots, 2026-10-28).

## Decisions
- **Source:** Claude Design export 5 (~/Downloads/export 5), the 35 art files; store badges excluded (redrawn, MUT-469
  owes the official ones). Plan D7's trial passed for the headers.
- **Halo (Basel, 2026-10-28):** export 5 draws each header with a halo, a 1.6-unit outline in the mood's band colour
  (SVG feMorphology dilate). Invisible in light mode; in dark mode a pale "sticker" edge that lifts the purple off the
  dark band. Kept as designed. (A local defringe that removed it was built, judged against a halo-free render, and
  dropped.)
- **Chips:** keep export 5's round tile baked in, corners transparent: dark mode shows a small pastel circle. Supersedes
  plan D2/D5 (glyph-only chip + an HTML tile cell) and so D9 (Outlook square tile corners) no longer applies.
- **Folder:** `src/hosted/public/mail/v2/`, `MAIL_ART_PATH = '/mail/v2/'`. v1 is never rewritten (sent mails point at
  it): pinned by SHA-256 (plan D10).
- **Format (D8):** every file 8-bit RGBA, non-interlaced, under 40 KB (largest 39,730 B).

## Tests (D4/D6)
`server/src/email/__tests__/look.test.ts` reads each served PNG (`__tests__/png.ts`, 8-bit RGBA reader): format; alpha 0 at
the four corners, and at the four mid-edges for headers (a chip's tile touches its mid-edges); a control that v1's
opaque header reads alpha 255; every v1 file's SHA-256 and the v1 file list. Templates, mailer and QA spec follow
`MAIL_ART_PATH`.

## Release and checks
One `api-v*` release carries v2 (the portal build serves it). After it: `curl -sI <portal>/mail/v2/…` → 200 image/png
immutable; then `server/scripts/mail-preview.sh --send <inbox> --yes` and check Gmail, Outlook (Mac, web) and Apple
Mail in dark and light mode. A preview sent before the release shows broken images (the live portal has no v2 yet).
