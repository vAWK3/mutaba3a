# Claude Design brief: MTB3A plans, accountant hand-over and pilot (2026-11-27)

Paste everything below the line into Claude Design, in the **Mutaba3a Brand v2** project, and attach the zip `mtb3a-ui-moments-2026-11-27.zip`.

---

You are designing the **scenes, spot illustrations and motion** for the next set of MTB3A (متابعة) screens: plans and limits, the accountant setting up a client's account and handing it over, and a free pilot for new testers. The approved wireframes are in the zip (`wireframes/`); variation **A** of every screen is the chosen layout. Do not redesign the layouts. Add the art and motion that give each moment its feeling, and send it back in the formats below.

**Who sees this:** freelancers and small businesses in Palestine and Israel, and their accountants. Arabic first, right to left; English second. People at work, often on a phone between clients.

**The feeling we want:** warm, proud, calm. The product notices when someone grows and says so, like a good accountant would. Celebrations are real but grown-up: a moment of pride, never a casino. Bad news (a limit, an expired link) is calm and kind, never red-alarm, never guilt.

## Ground rules

- **Brand v2 only.** Same illustration language as the existing scenes in `reference/illustrations/` (milestone-personal, milestone-firm, onboarding, link-ready…): rounded 3 px strokes, the nuqta (the peach dot) as the recurring hero, simple geometric objects, no people's faces, no mascots.
- **Three colours, hard rule.** Scenes may use only the three Brand v2 roles: field background, primary ink, peach-strong (see `reference/mutaba3a-theme.css`). Our generator turns them into `--m-field-bg`, `--m-primary` and `--m-peach-strong`, so dark mode needs no second drawing. Any other colour fails the build.
- **No words or real numbers inside the art.** Grey bars for text; abstract digits only where a number is the point. The app writes the copy, and the copy is minimal (a status, a number, an action).
- **Right to left.** Anything that moves or points in a direction needs an RTL version or must be direction-neutral. Mark which.
- **Motion.** We have no Lottie runtime. For each motion, deliver: start, key poses and end frames as SVG; a short spec (what moves, how far, duration, easing: the brand spring, critically damped, no overshoot unless the moment is a celebration); an MP4 or GIF reference loop. We rebuild it in CSS (portal) and Flutter (phone). Every motion needs a **reduced-motion still frame** (the final pose). Keep motions short: celebrations ≤ 1.6 s, everything else ≤ 0.8 s, and nothing loops forever except a wait (≤ 2 s loop).
- **Sizes.** Scenes 160 × 160 (done panes, empty states) and 120 × 96 (cards, sheets). The portal drawer is 480 px wide; the phone is 375 px. Mail headers follow `reference/mail-v2/` (PNG @2x, plus an RTL version when the art has direction).
- **Accessibility.** Art is decorative; the app labels it. Contrast matters for shapes only.

## The moments

Priority 1 is needed first. For each: what the person just did, the feeling, then the deliverable.

### Priority 1: celebrations

1. **"You've outgrown your plan": the gift month** (MUT-733 portal, MUT-706 phone).
   - *What happened:* a Solo or Business customer just hit their monthly limit for the first time (documents or scans). Instead of a wall, we congratulate them and give them the rest of the month free, once ever.
   - *Feeling:* pride and surprise ("my business is growing"), then relief.
   - *Deliver:* a hero scene (160 × 160) of something outgrowing its frame: e.g. the nuqta-plant or stack that rises past a line. Plus a **celebration motion ≤ 1.6 s** that plays once when the notice appears. It sits in the drawer's banner slot on the portal and on a half sheet over the issue screen on the phone (see `wireframes/mut-733.html` and `mut-706.html`, variation A). It may use a small, tasteful burst of nuqta confetti in the three colours.
   - *Also:* a quiet still for the moment after the gift is used up (the hard cap): the same object, settled, a door left open (the upgrade). Kind, not punitive.

2. **Plan upgraded** (MUT-734, after Confirm on an upgrade).
   - *Feeling:* a step up, done and settled.
   - *Deliver:* a done-pane scene (160 × 160) and a one-shot motion ≤ 1.2 s, for example the plan's shape gaining a level.

3. **The account is theirs: hand-over** (accountant channel, MUT-768 desk and MUT-769 /setup).
   - *What happened:* an accountant set up a client's account in the room, gave them a claim code, and the client has now claimed it with their own password.
   - *Feeling:* trust passed from one hand to another; for the client, "this is mine now"; for the accountant, "done, they're in".
   - *Deliver:* (a) a **welcome scene** for the client's /setup page before the code step ("your accountant set this up for you"): a key or a folder held out, not yet taken. (b) A **claimed** done scene and a one-shot motion ≤ 1.4 s: the key lands in the client's hand, or the folder's tab turns peach. (c) For the accountant's desk, a small **"Claimed" state** spot (120 × 96) used once per client.

4. **Pilot welcome** (MUT-755 portal, MUT-756 phone).
   - *What happened:* a pilot tester opens MTB3A for the first time, with Business free for 60 days through their accountant.
   - *Feeling:* invited, special, unhurried.
   - *Deliver:* three spot illustrations (120 × 96), one per Welcome step: (1) your free months have started, (2) scan your first receipt, (3) issue your first invoice. Plus a gentle entrance motion for the sheet ≤ 0.8 s.

5. **First scan, first invoice** (pilot milestones, MUT-758; useful for everyone later).
   - *Feeling:* a small "you did it", lighter than the gift month.
   - *Deliver:* two small milestone stills (120 × 96) in the family of `milestone-personal`, and one shared micro-celebration ≤ 1 s (the nuqta drops and a few dots spring out).

### Priority 2: waiting, nudges and calm news

6. **Activating** (MUT-768, after the accountant takes the client's card; the desk polls for up to 2 minutes).
   - *Feeling:* in progress, nothing wrong.
   - *Deliver:* a small wait loop (≤ 2 s loop) that ends in the "active" pose. It must not look like our page loader (`reference/brand/loader/`).

7. **The claim code reveal** (MUT-770, the accountant shows the code to the client in the room).
   - *Feeling:* a little ceremony, easy to read across a desk.
   - *Deliver:* a motion spec for the code appearing (digits settling in one by one, ≤ 0.8 s) and for "Copied". No art needed.

8. **Getting close to the limit: 80% and 90%** (MUT-733 / 706 usage lines).
   - *Feeling:* a friendly heads-up, not an alarm. At 90% the line turns butter.
   - *Deliver:* a motion spec for the meter bar filling and the tone change (≤ 0.6 s). No scene.

9. **Downgrade scheduled / move to Starter** (MUT-734).
   - *Feeling:* respected, no guilt, easy to undo.
   - *Deliver:* a quiet still (120 × 96) of a calendar with the nuqta on the change date, usable beside the "Scheduled · Undo" line; and a spec for the Undo toast.

10. **Pilot ending and ended** (MUT-753 panel).
    - *Feeling:* thanks, and your records are safe.
    - *Deliver:* one still (160 × 160) for "pilot ended": the same objects as the Welcome, packed and kept.

11. **Link expired / code locked** (MUT-769 /setup).
    - *Feeling:* calm; ask your accountant for a new one.
    - *Deliver:* two stills (160 × 160) in the family of `link-closed`: an expired link, and a code that's resting (a padlock asleep, not a red X).

### Priority 3: quiet details and mail

12. **Client balances, empty and in credit** (MUT-774, the ledger card on the phone and the balance column).
    - *Deliver:* an empty-ledger scene (160 × 160) for a client with no movements yet.

13. **The receipt's category filled in for you** (MUT-775).
    - *Deliver:* a micro-motion spec (≤ 0.4 s) for a field that was filled from the vendor's last time: a soft peach underline that fades.

14. **Mails** (follow `reference/mail-v2/`, PNG @2x plus RTL where needed):
    - `plan-change-scheduled`: the calendar spot from moment 9.
    - `customer-setup`: the welcome scene from moment 3, for the mail that sends the client their setup link.
    - `customer-setup-cancelled`: a closed link.
    - `accountant-unclaimed-digest`: a small stack of folders, some with peach tabs.
    - The client's reminders on days 3, 10, 30 and 53 reuse the `customer-setup` art.

No art is needed for the VAT lines before checkout (MUT-750a) or for the operator's sign-up history (MUT-737). Keep those plain.

## What to send back

- One SVG per scene, three colours only, named for our generator: `assets/illustrations/source/<name>.svg`. Names: `gift-month`, `gift-used`, `plan-upgraded`, `handover-welcome`, `handover-claimed`, `claimed-spot`, `pilot-welcome-1`, `pilot-welcome-2`, `pilot-welcome-3`, `milestone-first-scan`, `milestone-first-invoice`, `activating`, `change-scheduled`, `pilot-ended`, `link-expired`, `code-locked`, `ledger-empty`.
- For each motion: the key-frame SVGs, the spec as a short table (part, property, from, to, start, duration, easing) and an MP4 or GIF reference. Name them `motion-<moment>.*`.
- Mail headers: `mail-header-<mail>-2x.png` and `-rtl-2x.png` where the art has direction.
- One overview page with every moment, light and dark, LTR and RTL side by side, so we can check the set together.

## What's in the zip

- `wireframes/`: the approved screens (open `index.html`; variation A of each is chosen) and the accountant-channel wireframe.
- `plans/`: the plans behind each screen, for context on what happens when.
- `reference/DESIGN.md`: which component, colour role and type style each portal pattern uses.
- `reference/mutaba3a-theme.css`: the colour and motion tokens.
- `reference/illustrations/`: every existing scene SVG; match their style.
- `reference/mail-v2/`: the current mail header and chip art.
- `reference/brand/`: Brand v2 kit (wordmark, loader, splash).
- `reference/MUT-566-claude-design-brief.md`: the last brief we sent you, for the export conventions.
