# Landing "Get MTB3A" + request form redesign

Date: 2026-10-25. Requested by Basel (screenshot of the unstyled form, Arabic, dark).

## Problem

When the landing went hosted-only (7914685a) the request form moved inline into
Get it, but its styles stayed in `HostedOfferPage.css`, which was deleted. The
section's new wrappers (`.landing-get-it-apps`, `-lead`, `-request`) were never
styled either. On the live page:

- The two app links sit in a `div` that became one cell of the three-column
  option grid, so they stack as two tall cards next to an empty Sign-in card.
- The form's fieldset shows the browser's default border; the device checkboxes
  are raw boxes; labels inherit the section's `text-align: center` while the
  inputs are 1800px wide.
- The form heading is the section-size display heading, as big as the page title.
- The submit button is the app's lavender `.btn-primary`, not the landing's ink
  button.

## Design (Apple foundations: hierarchy, grouping and mapping, one primary action)

One centred column (max 720px) so the eye runs straight down:

1. "Get MTB3A" + lead, centred (unchanged).
2. The primary action first:
   - signup closed: the request card.
   - signup open: "Create an account" as an ink tile, then the note, then the
     request card ("Want us to set it up for you?"). The note's "below" stays
     true.
3. The request card: a raised surface (`--surface`, `--radius-hero`), start-
   aligned. Title at headline size (not section size), hint muted. Fields on a
   two-column grid from 640px (name | email, phone | profession); device
   chooser, message, submit and notice span the row. 44px fields and pills
   (touch target). Submit is the hero's ink button recipe, full width on phones.
4. Existing users after the card (closed state): "Sign in" tile, then "Already
   set up? Get the app" over two app tiles side by side. Tiles are horizontal:
   icon, label, chevron (mirrored in RTL), pressing in with the brand press
   tokens like every landing control.
5. Success and error states get their styles back (paid tint / overdue tint).

DOM order equals visual order in both states (no CSS `order`), so focus order
follows what you see.

## Reuse

- Hero ink button recipe (`.hero-cta-primary`) for the submit and Create tile.
- `Input` / `Select` / `Textarea` unchanged; landing-only overrides scoped under
  `.hosted-form`.
- Old `HostedOfferPage.css` form rules restored (pills, alert, success) and
  adapted.
- Button.css no longer imported by the form: the landing loads no Button.css.

## i18n

No new strings. RTL: grid and logical properties; the chevron mirrors under
`:dir(rtl)`.

## QA scenarios (release-qa, web)

- `get-it-form` (replaces retired `hosted`): open the landing at #get-it in
  English, send an empty request (errors + focus on name), a failing one (alert
  beside Try again), then a good one (success with name and email, Fix my email
  returns focus to email). Axe in light and dark.
- `get-it-375` (replaces retired `hosted-375`): Arabic at 375px, no horizontal
  overflow, form fields one per row, device pills and submit at least 44px, app
  tiles stacked.
- `get-it-paid` and `hosted-slash` retired with the blocks they tested
  (the paid block is gone; `/hosted` is a Netlify redirect the dev server can't
  serve).
