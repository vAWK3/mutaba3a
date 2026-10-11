# Design Brief — Landing page + app views, Apple-design pass

- **Date:** 2026-10-11
- **Status:** approved by Basel 2026-10-11. Epic **MUT-74**, tickets MUT-75..MUT-92. Built ticket by ticket on `feature/mut-74-apple-design` (one worktree), each merged to main when done.
- **Since approval:** device sync is retired product-wide (MUT-73), so S1 drops the Sync row instead of regrouping it.
- **Reviewed against:** main `84f2622` (landing, Home, Clients, Settings) and `feature/mut-1-client-core` `88adf2e` (MUT-5 income drawer, payment drawer, expenses); hosted portal via the approved MUT-43 wireframe.
- **Lens:** Apple design principles (Purpose, Simplicity, Responsibility, Craft, Response, Wayfinding) — `/apple-design` skill
- **Scope order:** Landing: story → hero → structure → proof/screens → pricing & CTAs → header, motion, materials. App: Home → Clients → Client profile → Record work → Record payment → Expenses (optional) → Settings & profiles → Hosted portal.

---

## Findings on the current landing page (`src/pages/landing/`)

| # | Principle | Finding | Where |
|---|---|---|---|
| F1 | Purpose | Page sells "income, expenses, receivables" tracking plus forecasting/risk/timeline/retainers/invoices; product job since MUT-1/MUT-2 is "who owes me, across my businesses". Multi-profile never mentioned. | `HeroSection.tsx`, `CapabilitiesSection.tsx`, `ValuePropsSection.tsx` |
| F2 | Purpose | Screenshots are stale: old Home KPI cards (deleted MUT-8), Engagements in sidebar (deleted). | `public/assets/landing/*.png` |
| F3 | Simplicity | Privacy said six times (badge, value strip, trust badges, value-prop card, problem section, FAQ). Downloads offered three times. 10 sections, ~7,200px at 1440w. | `LandingPage.tsx` |
| F4 | Responsibility | No purchase flow exists; "Buy for Mac — $49" / "Buy Desktop App" link to the free GitHub download. | `FinalCTASection.tsx:36`, `PricingSection.tsx:126` |
| F5 | Responsibility | "Universal (Intel + Apple Silicon)" is false — mac build is arm64 only. | `DownloadSection.tsx`, `deploy.sh:455` |
| F6 | Responsibility | v0.0.65 has no Windows installers; Windows buttons resolve to a missing asset until v0.0.66 ships (release issue, not design). | `netlify.toml:13` |
| F7 | Responsibility | Currency claims disagree: value props list EUR, FAQ says USD and ILS. | `ValuePropsSection.tsx`, FAQ |
| F8 | Responsibility | Data-loss warning sits directly under the pricing cards. | `PricingSection.tsx` |
| F9 | Response | Zero `:active` press states on the page; buttons only hover-lift 2px; taps get no feedback. 12 `transition: all` rules. | landing CSS |
| F10 | Craft | In OS light mode (no `data-theme`), the Mac button hover sets `background: #fff` while text stays `--bg` (#F6F8FA) — label disappears. Light override only targets `[data-theme="light"]`, which the landing never sets. Found in CSS; not reproduced in browser. | `HeroSection.css:105` |
| F11 | Wayfinding | Header is only a language toggle: no name, no nav, no persistent CTA. Tab title is "متابعة" in English. | `LandingHeader.tsx` |
| F12 | Flexibility | Phone visitors are led with Mac/Windows downloads; in Arabic the language toggle overlaps the hero badge at 375w. | `HeroSection.css`, `LandingPage.css` |
| — | Verified true | "Zero tracking": no analytics SDK anywhere in `src/`. | — |

## Decisions

| # | Decision | Chosen over |
|---|---|---|
| L1 | Page leads with **both** the job ("who owes me") and privacy. | Job only; privacy only; multi-business |
| L2 | Hero headline is one two-beat line: **"Know who owes you. Keep it to yourself."** / AR **"اعرف من يدين لك. وأبقِ ذلك لك وحدك."** Subhead: "Every client, every job, every payment — owed and paid, in USD and ILS. Stored on your device. No account. No tracking." | Job headline + privacy eyebrow; privacy headline + job subhead |
| L3 | Pricing: **free during early access**, say the price will be announced before it changes. All "Buy" labels become "Download"; the three-column pricing table goes. | Free with no price talk; keep $49 and build checkout |
| L4 | Hero CTA: **one filled button matched to the visitor's device** (Mac → Download for Mac, labelled Apple Silicon; Windows → Download for Windows; phone/other → Open the web app) plus one text link to the other options. Intel Mac owners routed to the web app (browsers can't tell Intel from Apple Silicon reliably). | Web app first for everyone; two equal download buttons |
| L5 | Hero image is the **Clients list** (Owed now per currency, clients ranked by owed, overdue in red) — it literally answers the headline. | One client's profile; list + profile layered |
| L6 | Hero image is **built in HTML/CSS** from the app's tokens: theme-aware, flips to Arabic RTL, real text, owed totals count up once on load. Must be kept in step with `ClientsPage`. | Four screenshots (EN/AR × light/dark); screenshot in a Mac frame |
| L7 | Page structure: **chapters, one idea each** — 1 Hero · 2 "Every client on one page." (client profile) · 3 "Paid? Two taps." (Record payment drawer — copy must be verified true in the app pass) · 4 "Every business you run." (profiles, USD/ILS kept apart) · 5 Privacy band said once · 6 Get it (device-matched + "Free during early access.") · 7 FAQ (6) · footer. Removed: trust badges, value props, problem section, capabilities grid, proof gallery, pricing table, final CTA. | Minimal 4 sections; keep all 10 and rewrite |
| L8 | "Open the web app" lands **straight in sample data** on the Clients list, no dialogs; one quiet bar "You're looking at sample data · Start with your own ›" clears the `demo_` data. Replaces `/app?demo=1`. | Start empty with sample optional; keep demo flow and fix bugs |
| L9 | Header: **slim sticky frosted bar** (wordmark Mutaba3a · متابعة, language toggle, device-matched button that fades in only once the hero button scrolls out of view); scroll-edge fade, no hard border; no section links. | Bar with section links; keep floating toggle only |
| L10 | Motion: **restrained** — press-in on pointer-down (scale 0.97, 100ms) on every button; chapter images rise+fade once on entry (spring, damping 1.0, response 0.4); hero owed totals count up once (~600ms); `prefers-reduced-motion` → cross-fades only; nothing scroll-linked. | Scroll-linked pinned scenes; press feedback only |
| L11 | Type: **Source Serif 4 for English headlines, Thmanyah for Arabic headlines** (Basel supplies woff/otf). Body stays Inter / IBM Plex Sans Arabic. Negative tracking is never applied to Arabic. Open: confirm Thmanyah's licence permits web embedding. | One sans voice (Inter + Plex Arabic); serif in both via Noto Naskh; system fonts |
| L12 | FAQ trimmed to six (proposal, editable): Is it free? · Where is my data stored? · How do I back up or move devices? (absorbs the data-loss warning) · Can I track more than one business? · Which currencies? (verify EUR vs USD/ILS in code first) · Web app or desktop, and does it work offline/on my phone? Dropped: support the project, shutdown, commercial licence (contradicts free early access), invoices, separate web-vs-desktop. | Keep 12 |

### Craft fixes that need no decision (apply during build)

- Light-mode hover bug on the Mac button (F10) — styles key off `prefers-color-scheme`, not only `[data-theme]`.
- Replace all `transition: all` with explicit `transform`/`opacity`/`background-color`.
- `<title>` follows the active language.
- Mac button says "Apple Silicon"; remove "Universal".
- Language toggle no longer overlaps content at 375w in Arabic.

## Landing → app handoff findings (from walking `/app?demo=1`)

| # | Finding |
|---|---|
| F13 | Landing "try the web app" links to `/app?demo=1`, an internal sales/screenshot tool (`src/demo/index.ts`). Visitors get the Welcome profile-setup dialog stacked on top of the Activate Demo Mode dialog. |
| F14 | After activating demo, the selected profile is "Default Profile" while demo data lives in three other profiles, so Clients shows "No clients found". |
| F15 | First-visit chrome stacks up: DEMO MODE bar, "Switched on for your existing data" banner, floating FX-rate widget, "Get the native Mac app" bottom bar. |

## App decisions

| # | Decision | Chosen over |
|---|---|---|
| A1 | **Nothing floats over content.** FX rate becomes a quiet top-bar readout (`$1=₪3.06 ▾`) opening a popover with refresh + source; theme toggle moves to the sidebar footer beside Settings; the Mac-app bar shows only on a Mac in a browser, once, gone for good when dismissed. MUT-12's "Switched on" banner unchanged. Demo bar replaced by L8's sample-data bar. | FX widget starts minimised; leave the frame |
| H1 | **Home → Needs attention rows get an inline "Record payment"** button opening the existing payment drawer in place (remaining amount + today prefilled). Row click still opens the client. On save: row slides out, Owed now updates in the same frame, brief Undo (deletes the just-created payment record). Always visible, not hover-only. | Hover-only action; rows stay links |
| H2 | **Home's and Clients' Owed now always match.** The Clients list gains muted bottom rows, only when non-zero: "No client · N entries" and "Archived clients · N". Its strip sums them too. ADR-036 §5 stands for Home; this changes the MUT-7 Clients list (ADR-035 ordering unaffected for real clients). Needs an ADR. | Explain the gap on Home; leave silent difference |

| C1 | **Clients open in a split view on wide windows**: list narrows to a column, profile opens beside it (Mail pattern); ↑/↓ walks clients and the profile follows; URL stays `/clients/:id`. Narrow windows and phones keep the full-page profile. | Full page that preserves place on Back; leave as is |
| C2 | **Client-level "Record payment"** next to Owed now: enter what arrived → drawer previews entries it settles, oldest first, checkboxes to change, running "left over"; save writes one payment record per entry with the same date; per currency (₪ settles only ₪ entries); amount above what's owed in that currency is blocked (MUT-6 D1, no credit concept). No schema change. MUT-6's per-row buttons stay. | Per-row only; header only replacing row buttons |
| R1 | **After save, show where it landed.** Visible row → soft highlight fading over ~1.5s and the changed Owed now ticks to its new value. Not visible (filtered, other page, other profile) → short message "Saved to <client> · Show" that navigates there with the row highlighted. No message when the row is visible. Applies to income and payments. | Always a message; stay silent |
| R2 | **Drawers move on springs** in the shared `Drawer`: open (damping 1.0, response 0.3), exit along the same edge on Cancel/Escape/Save, drag 1:1 with rubber-band, flick uses momentum projection to close or snap back, interruptible from the current position, RTL edge mirrored, reduced motion → 150ms cross-fade. Adds the `motion` library (new dependency → DECISIONS entry). | CSS exit only; leave |

| P1 | **Record payment drawer leads with the answer**: title "Record payment · ₪3,550 left"; one large prefilled amount; live line under it ("Paid in full" / "₪1,775 still owed"); Date shows "Today ›"; Notes behind "+ Add note"; one primary button Record payment. Removed: Mark Fully Paid (duplicate outcome that also dropped Notes — `PartialPaymentDrawer.tsx:57`), 25/50/100% chips, the Amount/Received/Remaining box, and Payment history when empty. Verified "Paid? Two taps." is true (open → Record payment). | Keep layout, fix craft; leave |
| E1 | **Expenses Needs attention: one row per recurring rule** — "Server hosting · $80 monthly · Aug, Sep, Oct not marked · $240"; one Mark paid button opens a small drawer with the months checked (all by default); Skip / Snooze / Edit rule move to ⋯. Rows, not cards. | One compact row per month; leave the 4-button cards |

| S1 | **Settings becomes five grouped sections, one home per action**: General (language, appearance, default currency) · Businesses (profiles) · Features (optional areas) · Your data (one Back up with "Last: <date>", one Restore, Sync, Export receipts, Check data) · About (version, updates, desktop app, support). Merge "Export Data/Export JSON" + "Export Backup" and "Import Data" + "Import Backup". "Delete all data…" alone at the very bottom, set apart, typed confirmation. One scroll area (today the column scrolls in its own box and Data Tools renders outside it). | Category list + panes; keep order and dedupe |
| S2 | **"All businesses" lens returns for the owed screens only** (Home, Clients). Owed now per currency, never summed across currencies; each row carries business tag(s) — a client shared across businesses shows each tag; Add income from this view asks which business. Expenses, documents, retainers stay per business. Overrides the unrecorded "strict mode" in `useActiveProfile.ts:76,82` (disabled in commit 70b5093 "added vendors page", no ADR) → needs an ADR. Gives landing chapter 4 its "together" shot. | Keep strict and say so; hint line on Home |
| S3 | **Backups: automatic on desktop, nudge on web.** Desktop: daily automatic backup to a visible folder, keep last 30, Settings shows "Backed up automatically · today 09:12 · Show folder". Web: record each backup's date; after 30+ days with changes, one quiet sidebar-footer line "Last backup 34 days ago · Back up" — no dialog. | Nudge everywhere; date only |

| HP1 | **Hosted portal inherits the shared decisions only**: L11 type pairing, L10 press feedback, R2 spring drawers, R1 after-save (expenses; hosted income is read-only). MUT-43's states S1–S13, wording and sign-in layout unchanged. | Stay exactly as approved |

### App craft fixes that need no decision

- Income drawer currency defaults to **the currency this client last used**, falling back to the profile default (MUT-5 branch defaulted a shekel-only client to USD).
- Drawer header is clipped under the top demo bar (z-index 201); any top bar (incl. L8's sample bar) must sit below drawers or push them down.
- "Record Payment₪3,550": label and amount need a space, or drop the amount since the Amount column already shows it.
- All Time filter shows sentinel dates "01/01/2000 – 31/12/2100"; hide the range for All Time.
- Payments table repeats italic "Recorded on the entry" on every row; show notes only when there are notes.
- Expenses total shows one currency with the rest behind ⓘ; show non-zero currencies side by side, like Owed now.
- Expense amounts carry a minus sign ("-₪250") in a list that is all expenses; drop it.
- Payment drawer quick chips format "₪887.5" (moot once P1 removes the chips).
- Two profiles carry a "Default" badge at once (Default Profile and Advanced Tech Solutions after demo seeding) — only one can be default.
- About says "Mutaba3a - Mini CRM" — internal name.

## App findings parked for the app-flow pass

- Clients: demo "Last payment" Oct 19, 2026 is in the future (today 2026-10-11) — demo seed ignores ADR-038 future-date rule; "1 weeks ago" pluralisation.
- Client profile: ~2s blank "Loading..." before content (dev server — verify in a production build before acting); "Record Payment₪3,550" has no space between label and amount; FX widget floats over table rows; All Time shows "01/01/2000 – 31/12/2100".

## Tickets (epic MUT-74, created 2026-10-11)

| Key | Ticket | Decisions | Needs ADR |
|---|---|---|---|
| MUT-75 | Landing rewrite: story, chapters, FAQ, honest pricing | L1–L3, L7, L12, F4, F5, F7, F8 | — |
| MUT-76 | Landing hero: HTML Clients visual + device-matched CTA | L4–L6 | — |
| MUT-77 | Landing header, motion, type (Thmanyah files + licence first) | L9–L11, F9–F12 | — |
| MUT-78 | Sample-data handoff replaces `/app?demo=1` for visitors | L8, F13–F15 | — |
| MUT-79 | App frame: no floating surfaces | A1 | — |
| MUT-80 | Shared Drawer springs, exit, drag (adds `motion`) | R2 | yes (dependency) |
| MUT-81 | After-save "show where it landed" | R1 | — |
| MUT-82 | Home inline Record payment with Undo | H1 | — |
| MUT-83 | Owed now always matches (No client / Archived rows) | H2 | yes |
| MUT-84 | Clients split view | C1 | yes (navigation) |
| MUT-85 | Client-level lump-sum Record payment | C2 | yes (allocation rule) |
| MUT-86 | Record payment drawer leads with the answer | P1 | — |
| MUT-87 | Expenses: one attention row per recurring rule | E1 | — |
| MUT-88 | Settings in five groups | S1 | — |
| MUT-89 | "All businesses" lens for owed screens | S2 | yes (overrides strict mode) |
| MUT-90 | Backups: auto on desktop, nudge on web | S3 | yes |
| MUT-91 | Hosted portal inherits shared decisions | HP1 | — |
| MUT-92 | Craft-fix bundle (landing + app lists above) | — | — |
| — | Release, not design: cut v0.0.66 so Windows installers exist (F6) | — | — |

Build order (revised at approval): MUT-5 (`feature/mut-1-client-core`) is not merged yet and rewrites the income and payment drawers, so the landing tickets go first because they touch none of that. Order: MUT-75 → MUT-76 → MUT-78 → MUT-79 → MUT-80 → MUT-81 → MUT-83 → MUT-84 → MUT-89 → MUT-88 → MUT-90 → MUT-87, then after MUT-5 lands MUT-86 → MUT-82 → MUT-85 → MUT-92, then MUT-91. MUT-77 waits for the Thmanyah files and licence.
