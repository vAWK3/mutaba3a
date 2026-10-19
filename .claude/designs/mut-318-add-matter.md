# MUT-318 — Add a matter from the portal's matter picker, signed in or out

**Tracker:** Jira · barmajiyat · MUT-318 (Story, epic MUT-284), relates MUT-286, MUT-65.
**Approved by Basel (2026-10-19, intake):** hint with no Add row when no client is chosen; a new matter takes the drawer's
currency; changing the client clears a matter of another client, in scope.
**Design review (2026-10-19, /plan-design-review):** decisions 1A, 2A, 3A, 4A, 5A below. Wireframe:
`.claude/designs/mut-318-add-matter-wireframe.html` (real theme tokens, six states, EN/AR, light/dark).

## Problem

Hosted matters (projects) come only from the phone app or Malafat. The portal cannot create one, signed in or out, so
signed out nobody can ever have a matter. MUT-286 gave the client picker "Add client: «name»"; this does the same for
matters.

## Acceptance criteria

1. Signed out: add a client, then a matter, then save Owed income. All of it stays on this device and no network request is made.
2. Signed in, on a profile the person owns with no writer of record: the same flow creates the matter on the server.
3. Malafat-fed profiles and writer-null firms never show the Add row.
4. No client chosen: no Add row; typing a name no matter has shows "Choose a client first to add a matter", and a screen
   reader hears it (5A).
5. Changing the client clears a picked matter that belongs to another client, silently (3A); picking a matter with no
   client fills the client (2A).
6. With no client chosen, each matter in the list shows its client (1A).
7. Arabic first and English, RTL; «قضية» is the matter everywhere in the field, label included (4A).

## Solution

```
IncomeCaptureDrawer ─┬─ useClientProjectCascade (moved to src/lib/forms/, shared with the local app)
ExpenseDrawer ───────┘      │ customerId|clientId ↔ projectId, over the all-clients matter directory
        │
        └─ ProjectPicker ──┬─ useProjectDirectory (existing, filtered by client)
             canCreate      ├─ useCustomerDirectory (existing; client chips when unfiltered, 1A)
             customerId     └─ useCreateProject ── api.createProject ── POST /v1/projects
             currency                               (attempt-scoped Idempotency-Key)
```

- **Gate.** `projects` is one of the three profile-dependent rows (`server/src/auth/writability.ts`), with exactly the
  rule `customers` has: a session writes them only where the profile has no writer of record. The portal's gate for
  clients is `canAddClient(profile) = owned && writerOfRecord === null`; matters use the same function. No second
  predicate: one rule, one name. (Its doc comment is widened to say it covers matters too.)
- **`ProjectPicker`** gains `canCreate` and `currency`. A typed name no matter in the list has (case-insensitive, trimmed)
  gets an `isNew` option labelled by `createLabel` "Add matter", only when `canCreate && customerId && currency`. Picking it
  calls `useCreateProject` with `{ customerId, name, currency }`, then picks the new matter. On failure: the name stays in
  the box, the value is cleared (`onChange('')`), and a toast says "Couldn't add the matter. Try again." — ClientPicker's
  behaviour, line for line.
- **No client chosen** (`canCreate && !customerId`, a typed name that matches no matter): no Add row; the hint "Choose a
  client first to add a matter" shows under the field. **5A:** EntityTypeahead gains an optional `describedBy` prop that
  sets `aria-describedby` on its input; ProjectPicker renders an always-mounted `.form-hint` paragraph with that id and
  `aria-live="polite"`, empty unless the hint applies, so it is read on focus and announced when it appears.
- **1A — whose matter.** With no client chosen, each option carries its client's name as `secondary` (EntityTypeahead's
  existing muted chip), from `useCustomerDirectory`. With a client chosen the list is that client's and has no chips.
- **2A — cascade.** `src/hooks/useClientProjectCascade.ts` moves to `src/lib/forms/useClientProjectCascade.ts` (the portal's
  lint bans `src/hooks/`; the hook is form-only, no Dexie), with its test. It gains an `ownerOf(project)` option (default
  `p.clientId`, hosted passes `p.customerId`) and a generic project type; the local drawers' imports follow, behaviour
  unchanged. Both hosted drawers call it with the all-clients directory (`useProjectDirectory(profileId)`):
  client changed to another → a matter of another client is cleared; matter picked with no client → client filled
  (cascade-flash on the client input, A3; a static tint under reduced motion); clearing a filled client keeps the matter. This replaces
  the brief's ProjectPicker-internal clear.
- **3A — silent clear**, as in the local app. No toast, no forced disclosure.
- **`useCreateProject`** in new `src/hosted/data/projectQueries.ts`, shaped like `useCreateCustomer`: attempt key,
  invalidates `directory/projects` (every client filter, which includes the cascade's all-clients list) and `summary`.
- **`api.createProject(profileId, body, idempotencyKey)`** — `POST /v1/projects`. Local mode already serves it
  (`projectRoutes` is in `PORTAL_ROUTES`); the coverage test's list gains it as call 51.

### Information hierarchy (matter field)

```
Matter (optional)                ← label: «القضية (اختياري)» (4A)
┌──────────────────────────────┐
│ typed text                   │  ← input (aria-describedby → hint)
└──────────────────────────────┘
┌──────────────────────────────┐  ← list: matches first …
│ Lease renewal 2025  [Client] │     [Client] chip only with no client chosen (1A)
├──────────────────────────────┤
│ Add matter: Lease dispute    │  ← … Add row last, divided (.is-new), only with a client
└──────────────────────────────┘
Choose a client first to add a matter.   ← polite hint, only with no client + no match (5A)
```

### Interaction states

| Feature | Loading | Empty | Error | Success | Partial |
|---|---|---|---|---|---|
| Matter list | Directory not loaded: no list opens (existing) | No matters and nothing typed: no list; typed new name: Add row (client chosen) or hint (no client) | Directory load fails: no list, field still typable (existing) | Matches listed, chips when unfiltered | Matches + Add row |
| Add matter | Input `readOnly` + `aria-busy`, focus kept; Enter waits, then submits (A1) | — | Name stays unpicked, value `''`, alert toast "Couldn't add the matter. Try again." | New matter picked, its name in the box, `create-success` border pulse (A2), no toast | Created but refetch pending: name shown from the response |
| Cascade | — | — | Matter not yet in the all-clients list (just created): not cleared; save then gets PROJECT_CUSTOMER_MISMATCH, already mapped (`projectCustomerMismatch`) | Client filled with cascade-flash / matter cleared silently | — |

### Journey (signed out, first matter)

| Step | User does | User feels | Plan specifies |
|---|---|---|---|
| 1 | Opens + Add income, Owed, types 900 | in control, fast | existing fast path |
| 2 | Types a new client, picks Add client | relieved it's not a dead end | MUT-286 |
| 3 | Opens More details, types a matter name | expects the same help | Add matter row, same look as Add client |
| 4 | Picks Add matter | confident: it's picked, no detour | silent success, name in box |
| 5 | Saves; later reopens the client | trusts the record | matter on the client, survives reload |
| 5-year | Many clients, repeat matter names | not confused | client chips (1A) |

## API contract and errors

`POST /v1/projects` `{ customerId, name, currency }` + `Idempotency-Key` → 201 `Project`. Errors the picker can meet:
422 `VALIDATION_FAILED` (`CUSTOMER_NOT_FOUND`, `CUSTOMER_ARCHIVED`, name length), 403 `READ_ONLY_PROFILE` (never with the
gate), network. All end in the same toast; the drawer stays open with the name unpicked.

## Reuse

EntityTypeahead (isNew row, `secondary` chip, async onSelect), useClientProjectCascade (moved, not copied), useAttemptKey,
canAddClient, useCustomerDirectory, Toast, `.form-hint`, the ClientPicker failure pattern. New: one optional prop
(`describedBy`) on EntityTypeahead. No new component.

## Impact

Hosted portal, plus a file move for the local app's cascade hook (imports only). No server change, no schema change, no
new route. Local mode gains matters with zero backend work.

## i18n

New keys `hosted.matters.add` «إضافة قضية» / "Add matter", `hosted.matters.addFailed` «تعذّرت إضافة القضية. حاول مجدداً.» /
"Couldn't add the matter. Try again.", `hosted.matters.needsClient` «اختر عميلاً أولاً لإضافة قضية.» / "Choose a client
first to add a matter." Changed (4A): `hosted.income.matter` → «القضية (اختياري)», `hosted.income.matterPlaceholder` →
«اختر قضية». English unchanged.

## Cost / infra

None.

## NOT in scope

- Moving the income drawer's matter field out of "More details": MUT-133's fast-path layout (design 1A there), not debt.
- Telling the person when a matter is cleared (3A chose silence, as the local app).
- Editing, archiving or VAT treatment of matters; a matters page.
- The phone app.

## What already exists

EntityTypeahead and its CSS (`.is-new`, `.entity-typeahead-secondary`, 44px rows, ellipsis, RTL), the cascade hook and
its tests, ClientPicker's create/failure contract, `.form-hint`, the Toast (alert + quiet info), the brand kit
(`docs/brand/README.md`; no DESIGN.md).

## QA scenarios

| id | steps | outcome |
|---|---|---|
| `portal.local.matter-owed` | Signed out, Receivables → + Add income, Owed, 900, Add client «Ramallah Bakery», More details, type matter «Menu design», Add matter, save, reload | Matter picked, entry listed under the client and the matter after a reload; no request after the first-visit check |
| `portal.income.add-matter` | Own profile: + Add income, More details, type a matter with no client → hint; pick a client, Add matter «Lease dispute», save; Malafat-fed profile: expense drawer, client picked, type a matter | Hint with no Add row; then POST /v1/projects `{customerId, name, currency: ILS}` with an Idempotency-Key, the income carries the new projectId; on the Malafat-fed profile no Add matter row |
| `portal.income.matter-fills-client` | Own profile with two clients' "Retainer": + Add income, More details, open Matter with no client, pick "Retainer · Nablus Textiles"; then change Client to another | Rows show client chips; Client fills with Nablus Textiles; changing Client empties Matter |

## Apple design review (2026-10-19, /apple-design)

Lens: response, causality, completion feedback (WWDC *Designing Fluid Interfaces*, *Audio-Haptic*). No gesture-driven
motion here, so springs, velocity handoff and projection do not apply; the dropdown is already anchored to its input and
the hint is inline validation. Three decisions, each Basel's:

- **A1 — keep focus while saving (both pickers).** ClientPicker passed `isPending` into `disabled`, and a focused input that
  becomes disabled loses focus (HTML focus fixup): a keyboard user dropped to `<body>` and EntityTypeahead's "Enter held
  while saving submits once saved" could never fire (`activeElement === input`). Now EntityTypeahead sets `readOnly` while a
  pick is saving (focus and caret kept, racing edits blocked, no dim flicker on a ~5 ms local save) beside its existing
  `aria-busy`; ClientPicker and ProjectPicker no longer disable on `isPending`. Supersedes "Input disabled" in the states
  table.
- **A2 — completion cue on create (both pickers).** Success and failure both leave the typed name in the box; once the
  failure toast goes they look the same. EntityTypeahead plays its existing, so far unused `create-success` keyframe (200 ms
  border pulse in `--success`) on the frame a create resolves picked. Under `prefers-reduced-motion: reduce`, a static
  border tint for the same 200 ms instead of the animation.
- **A3 — cascade cue (both apps).** The plan's "cascade-flash" was never wired: the local cascade fills the client silently.
  The shared hook now reports each auto-fill; the client typeahead plays the existing `cascade-flash` (500 ms accent wash)
  once, in the hosted and the local drawers. Reduced motion: a static 500 ms tint. Both keyframes gain a reduced-motion
  rule they lacked.

Mechanism (both cues): an optional EntityTypeahead prop that, when its value changes, restarts the animation class on the
input by DOM class toggle in an effect (no React state, so no set-state-in-effect); the create cue is internal to
EntityTypeahead (fires when an async pick resolves picked).

## Implementation Tasks

Synthesized from this review's findings. Each task derives from a specific finding above.

- [ ] **T1 (P1, human: ~1h / CC: ~10min)** — ProjectPicker — client chips when unfiltered (1A)
  - Surfaced by: Pass 1 — same-named matters across clients indistinguishable
  - Files: src/hosted/components/ProjectPicker.tsx, its test
  - Verify: ProjectPicker.test.tsx "shows each matter's client with no client chosen"
- [ ] **T2 (P1, human: ~3h / CC: ~25min)** — cascade — move useClientProjectCascade to src/lib/forms, add `ownerOf`, use in both hosted drawers (2A, 3A)
  - Surfaced by: Pass 2 — picking a matter first leaves Owed failing 'client required'
  - Files: src/lib/forms/useClientProjectCascade.ts (+test), src/components/drawers/{Income,Expense}Drawer.tsx, src/hosted/components/{IncomeCaptureDrawer,ExpenseDrawer}.tsx
  - Verify: moved hook test green; hosted drawer tests for fill + clear
- [ ] **T3 (P1, human: ~15min / CC: ~3min)** — i18n — income matter label/placeholder to «قضية» (4A)
  - Surfaced by: Pass 5 — «ملف» means profile elsewhere
  - Files: src/hosted/i18n/ar.json
  - Verify: grep; release-QA spec in Arabic reads «القضية»
- [ ] **T4 (P1, human: ~1h / CC: ~10min)** — EntityTypeahead + ProjectPicker — `describedBy` + polite hint (5A)
  - Surfaced by: Pass 6 — hint never reaches a screen reader
  - Files: src/components/ui/EntityTypeahead.tsx, src/hosted/components/ProjectPicker.tsx
  - Verify: test asserts aria-describedby points at the hint and the hint text appears
- [ ] **T5 (P1, human: ~1h / CC: ~10min)** — EntityTypeahead + both pickers — readOnly while saving, no disabled (A1)
  - Surfaced by: Apple review A1 — focus dropped mid-save, Enter-held submit dead
  - Files: src/components/ui/EntityTypeahead.tsx, src/hosted/components/{Client,Project}Picker.tsx
  - Verify: test: focus stays on the input through a slow create; Enter held during it submits the form after
- [ ] **T6 (P2, human: ~1h / CC: ~10min)** — EntityTypeahead — create-success pulse + reduced-motion rule (A2)
  - Files: src/components/ui/EntityTypeahead.{tsx,css}
  - Verify: test: class present after a resolved create, absent after a failed one
- [ ] **T7 (P2, human: ~1.5h / CC: ~15min)** — cascade hook + client typeaheads — cascade-flash on auto-fill, both apps (A3)
  - Files: src/lib/forms/useClientProjectCascade.ts, src/components/ui/EntityTypeahead.{tsx,css}, local ClientTypeahead, hosted ClientPicker, the four drawers
  - Verify: hook test reports the auto-fill; typeahead test restarts the class on a new flash value

## Design Review Completion Summary

```
  +====================================================================+
  |         DESIGN PLAN REVIEW — COMPLETION SUMMARY                    |
  +====================================================================+
  | System Audit         | no DESIGN.md (brand kit); UI: 1 row, hint, cascade |
  | Step 0               | 6/10; all 7 passes + mockups requested      |
  | Pass 1  (Info Arch)  | 7/10 → 9/10 after fixes                     |
  | Pass 2  (States)     | 6/10 → 9/10 after fixes                     |
  | Pass 3  (Journey)    | 8/10 → 8/10 after fixes                     |
  | Pass 4  (AI Slop)    | 9/10 → 9/10 after fixes                     |
  | Pass 5  (Design Sys) | 7/10 → 9/10 after fixes                     |
  | Pass 6  (Responsive) | 6/10 → 9/10 after fixes                     |
  | Pass 7  (Decisions)  | 0 new, 0 deferred                           |
  +--------------------------------------------------------------------+
  | NOT in scope         | written (4 items)                           |
  | What already exists  | written                                     |
  | TODOS.md updates     | 0 items proposed                            |
  | Approved Mockups     | 0 generated (no OpenAI key); HTML wireframe instead |
  | Decisions made       | 5 added to plan                             |
  | Decisions deferred   | 0                                           |
  | Overall design score | 6/10 → 8/10                                 |
  +====================================================================+
```

Pass 3 stays at 8: the matter field behind "More details" is out of scope. Plan is design-complete. Run /design-review
after implementation for visual QA.

### Unresolved Decisions

None.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | — | Independent 2nd opinion | 0 | skipped (D2) | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 0 | — | — |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | clean | score: 6/10 → 8/10, 5 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** design outside voices skipped by the user (D2); mockup designer unavailable (no OpenAI API key).
- **VERDICT:** DESIGN CLEARED — eng review required.

NO UNRESOLVED DECISIONS
