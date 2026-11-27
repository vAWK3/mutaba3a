# Claude Design brief: MTB3A guides, Get started and the public help centre (2026-11-27)

Paste everything below the line into Claude Design, in the **Mutaba3a Brand v2** project, and attach the zip `mtb3a-guides-and-help-2026-11-27.zip`.

---

You are designing the **illustrations, icons and motion** for the way MTB3A (متابعة) teaches people to use its features: short step-by-step **guides** that open from the feature itself, a **Get started** checklist, small **prompts** that point at a feature at the right moment, and a public **help centre** on the website. The layouts are in the zip (`wireframes/index.html`, interactive). Do not redesign them. Add the art and motion, and send it back in the formats below.

**Who sees this:** freelancers and small businesses in Palestine and Israel, and their accountants. Arabic first, right to left; English second; Hebrew on a few website help pages. People at work, often on a phone between clients, reading a guide because something did not work or they are about to try something new.

**The feeling we want:** calm, clear, trustworthy, a little warm. A good colleague showing you how, never a tutorial game. No confetti except the one small "all done" moment below. Nothing childish, nothing salesy.

## Ground rules

- **Brand v2 only.** Same illustration language as the scenes in `reference/illustrations/` (onboarding, link-ready, milestone-personal, the pilot-welcome set): rounded 3 px strokes, the nuqta (the peach dot) as the recurring hero, simple geometric objects, no people's faces, no mascots, no hands with skin tones.
- **Three colours, hard rule (scenes).** Scenes may use only the three Brand v2 roles: field background, primary ink, peach-strong (`reference/mutaba3a-theme.css`). Our generator turns them into `--m-field-bg`, `--m-primary` and `--m-peach-strong`, so dark mode needs no second drawing. Any other colour fails the build. (Icons are single-colour, `currentColor`.)
- **No words or real numbers inside the art.** Grey bars for text; abstract digits only where a number is the point. The app writes the copy, and the copy is minimal.
- **No real marks.** Draw no government logo, no Tax Authority emblem, and no Claude or Anthropic logo. Use abstract stand-ins: a circle with a check for "the authority", a speech bubble with a spark for "your assistant".
- **Right to left.** Anything that points or moves in a direction ships a second drawing, `<name>-rtl.svg` (we never mirror in CSS). Mark which scenes are direction-neutral and need none.
- **One drawing, two layouts.** Basel has not yet chosen between two guide layouts: "A" shows all steps in a scrolling list (each step art about 120 × 96), "B" shows one step at a time (each step art about 160 × 160). Draw every step at **160 × 160 with the whole subject inside a central 120 × 96 safe area**, so the same file works in both.
- **Motion.** We have no Lottie runtime. For each motion deliver: start, key poses and end frames as SVG; a short spec table (part, property, from, to, start, duration, easing); an MP4 or GIF reference. We rebuild it in CSS (portal, website) and Flutter (phone). Easing is the brand spring (`cubic-bezier(.32,.72,0,1)`, critically damped, no overshoot); overshoot only in the one celebration. Everything is **≤ 0.6 s unless stated**, plays **once**, and never loops (nothing here is a wait). Every motion has a **reduced-motion still** (the final pose). Motion never blocks reading: the text is there from the first frame.
- **Sizes.** Scenes 160 × 160 and 120 × 96. Icons 24 px, 2 px stroke, matching our M-icon family. The portal drawer is 480 px wide; the phone is 375 px.
- **Accessibility.** Art is decorative; the app labels it. Contrast matters for shapes only.

## The assets

Priority 1 first. Each guide has a **hero** (120 × 96, shown beside its title) and one scene per step (160 × 160, safe area above). Draw each guide as one set so the steps read as a story.

### Priority 1: the two guides that matter most

1. **Connect to the Tax Authority** (needed first). Hero: the business's sheet and an abstract authority (circle with a check) joined by a dotted line. Steps:
   1. Open **Connect** in settings: a settings row with a plug, highlighted.
   2. Sign in **on the authority's own site**: a browser-window shape with a key, the abstract authority above it. It must read as "a different place from MTB3A".
   3. **Approve access**: a gate or door opening a little, the nuqta passing through, a check.
   4. **Connected until a date**: the dotted line now solid, a small calendar with the nuqta on a day. (Reuse the visual idea of the "Connected" state from `MUT-566-claude-design-brief.md`, item 7, so the two stay one family.)
2. **Connect your own Claude** (needed first). Hero: a speech bubble with a spark (your assistant) and a connector plug meeting MTB3A's mark. Steps:
   1. Open **Connect Claude** under You: a settings row with the assistant bubble.
   2. In the assistant, **add MTB3A as a connector**: the plug going into a socket shaped like the MTB3A mark.
   3. **Approve** on MTB3A's page: a consent card with a check.
   4. **Ask it to log a receipt; it asks where to file**: a receipt sheet and two small folders (a profile and an inbox), a question mark on the bubble, not on the sheet. It must show that you stay in control.

### Priority 1: Get started

3. **Get started: all done.** One scene (160 × 160) for the moment every step is finished: the nuqta settled at the top of a short staircase of four steps, calm. Plus a **micro-celebration ≤ 1.0 s**, lighter than the milestone moments: the nuqta drops onto the top step and three small dots spring out (overshoot allowed). Still: the settled pose.
4. **Step done** (motion spec, no art): a circle becoming a check, ≤ 0.35 s, the check drawn in; and the **progress fill** on the bar when the count changes, ≤ 0.5 s. Both in the brand spring.
5. **Hide / collapse** (motion spec): the card folding away when the person hides it or finishes, ≤ 0.3 s; the rows below rise to fill the gap.

### Priority 1: the public help centre (website)

6. **Three cluster spots** (120 × 96) for the help index: *Allocation number and the Tax Authority* (the sheet and the authority circle), *Invoice documents* (a fan of three sheets: tax invoice, invoice-receipt, credit note: reuse the family from `MUT-566-claude-design-brief.md`), *Receipts and expenses* (a receipt and a phone). No numbers.
7. **Explainer hero** (160 × 160), one per cluster, quieter than the spots: the same objects, larger and still.
8. **Page not found** (160 × 160, calm, in the family of `link-closed`): a sheet that wandered off its shelf. Kind, never a red X.
9. **Website entrance** (motion spec): the page's headline and first block rise 14 px with a 6 px blur clearing, staggered 50 ms, ≤ 0.6 s. These are existing tokens (`--m-stagger-rise`, `--m-stagger-blur`, `--m-stagger`); confirm or adjust for long reading pages and say how it behaves for Arabic, English and Hebrew.

### Priority 2: the other guides

Each is a hero (120 × 96) plus three steps (160 × 160, safe area).

10. **Scan a receipt** (phone). Steps: 1 open Scan from Add (a plus and a viewfinder); 2 point at the receipt, which is read (a scan line passing over a sheet; reuse the idea from the invoice "reading" motion in the MUT-566 brief); 3 check the fields and file (the sheet landing in a folder).
11. **Share a bank text** (phone). Steps: 1 open the bank's message (a message bubble with grey bars and one abstract amount); 2 share it to MTB3A (an arrow into the MTB3A mark); 3 the expense is prepared, check and save.
12. **Invite your accountant.** Steps: 1 invite by email (an envelope leaving a folder); 2 they accept (the folder's tab turns peach); 3 they can look but not change (an eye over the folder, a small lock). Keep it distinct from the hand-over scenes: this is sharing, not giving the account away.

### Priority 2: prompts and icons

13. **Three 24 px icons** (M-icon family, single colour): `guide` (an open page with a small spark), `get-started` (a flag on a step), `support` (an envelope with a small dot). The `get-started` and `guide` icons also lead the Get started rows and the "Show me how" button.
14. **Prompt appears / dismissed** (motion spec): a prompt card or banner rises in ≤ 0.4 s and leaves ≤ 0.25 s; and the **hand-off from "Show me how" to the guide**: the guide drawer (portal) grows from the button's edge and the phone sheet rises from the card, so the person sees where it came from (spatial consistency). Spec only.
15. **Guide step change** (motion spec, for the one-step-at-a-time layout): the next step's art and text slide in the **reading direction**, the old step out the opposite way, ≤ 0.35 s; the art "assembles" once, ≤ 0.6 s, the nuqta last. Give both directions (left-to-right, right-to-left).

## What to send back

- One SVG per scene, three colours only, named for our generator: `assets/illustrations/source/<name>.svg` and `<name>-rtl.svg` where the art has direction. Names: `guide-tax-hero`, `guide-tax-1` … `guide-tax-4`, `guide-claude-hero`, `guide-claude-1` … `guide-claude-4`, `guide-scan-hero`, `guide-scan-1` … `3`, `guide-banktext-hero`, `guide-banktext-1` … `3`, `guide-accountant-hero`, `guide-accountant-1` … `3`, `getstarted-done`, `help-cluster-allocation`, `help-cluster-documents`, `help-cluster-receipts`, `help-explainer-allocation`, `help-explainer-documents`, `help-explainer-receipts`, `help-not-found`.
- Icons: `assets/icons/source/guide.svg`, `get-started.svg`, `support.svg` (24 px grid, 2 px stroke).
- For each motion: key-frame SVGs, the spec as a short table, and an MP4 or GIF reference, in a folder `docs/design/motion/2026-11-27-guides/<moment>/` using the same layout as `reference/motion/gift-month/` (spec, key frames, still). Moments: `getstarted-done`, `step-done`, `progress-fill`, `card-hide`, `website-entrance`, `prompt-in-out`, `prompt-to-guide`, `guide-step-change`.
- One overview page with every asset, light and dark, LTR and RTL side by side, so we can check the set together.

## What's in the zip

- `wireframes/index.html`: the interactive layouts (portal desktop, phone, website help). Use the bar at the top: Arabic / English, light / dark, reduced motion, and the two guide layouts. The dashed boxes are your slots, named as above.
- `guides/guides-draft.md`: the draft step text for the five guides, so each picture shows what the step says. Copy is not signed off; do not put words in the art.
- `reference/DESIGN.md`: which component, colour role and type style each portal pattern uses, including the Scene rules (sizes, `-rtl` drawings, three colours).
- `reference/mutaba3a-theme.css`: the colour and motion tokens.
- `reference/illustrations/`: every existing scene SVG; match their style.
- `reference/motion/gift-month/`: an example of the motion deliverable (spec, key frames, still).
- `reference/brand/`: Brand v2 kit (wordmark, loader, splash).
- `reference/briefs/`: the last two briefs we sent you, for the export conventions and the invoicing art you should stay consistent with.
