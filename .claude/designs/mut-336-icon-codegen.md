# MUT-336 — Claude Design → Flutter + web icon codegen pipeline

## Problem

`assets/icons/source/*.svg` (61 files, landed by MUT-335, mirrored byte-identical
from mutaba3a-flutter) is hand-authored and multi-part (named sub-elements like
`id="nuqta"`, `id="short-stroke"`, `id="card"`/`id="ribbon"`) so MUT-337's future
animation runtime can target parts independently. Nothing yet turns that source
into usable platform code: the existing 16 React components in
`src/components/icons/` are hand-written one-offs with no connection to the
canonical set, and Flutter still uses ad hoc `Icons.*` Material glyphs. Every new
or changed icon currently means hand-editing two codebases by hand, per platform.

## Scope split (this ticket spans two repos)

This brief covers **mini-crm's half only**: the SVG → React codegen script, its
validator, and the docs for the end-to-end add/update flow. The Flutter half
(SVG → Dart widget codegen) is the same shape of problem against the same
source files, but belongs in its own mutaba3a-flutter worktree/session — it
isn't planned here, flagged as a handoff below.

**Out of scope (ticket-level, confirmed against MUT-336's description):**
MUT-337's animation runtime/wiring, and migrating existing call sites
(`src/components/icons/*`'s 16 hand-written components, or the dozen+ scattered
inline SVGs like `XIcon`/`MoreIcon`/`PlusIcon`) to the generated set. One pilot
icon is rendered on one screen to prove the pipeline (AC #3) — that is a single,
new, narrow usage, not a sweep.

## Proposed solution

### 1. `scripts/generate-icons.mjs`

Plain Node ESM script, no new dependency — matches this repo's existing
convention (`scripts/validate_illustrations.mjs`, `check-i18n-keys.ts`: hand-rolled
`fs`/regex, no AST or template-engine library anywhere in `scripts/`). The SVG
dialect in `assets/icons/source/*.svg` is a small, controlled subset (root
`<svg>` with a fixed attribute set; children are only `path`/`circle`/`rect`/`g`,
optionally nested one level, optionally carrying `id`) — a ~40-line recursive
tag tokenizer covers it without a real XML parser.

For each source file:
- Parse to a small element tree (`{tag, attrs, children}`).
- Convert the filename to a component name: `swap-horizontal.svg` →
  `SwapHorizontalIcon` (kebab → Pascal + `Icon` suffix, consistent with the
  existing hand-written names).
- Emit `src/components/icons/generated/<Name>Icon.tsx`, reusing the same
  shape as the hand-written components (`{size?, className?}` props, default
  `size = 16`, root `<svg>` carries `viewBox`/`stroke`/`strokeWidth` from the
  source) so the generated and hand-written components are drop-in
  interchangeable later (MUT-336 doesn't do that swap, but nothing about the
  shape should block it).
- **Named sub-elements become `data-part="<id>"`, not `id="<id>"`.** The
  source SVGs' `id`s are unique per *file*, not per *page* — two instances of
  the same generated icon on one screen would collide on a raw DOM `id`
  (invalid HTML, and it silently breaks `querySelector`-based lookups). MUT-337
  will need to select a part scoped to one icon instance (e.g.
  `rootRef.current.querySelector('[data-part="nuqta"]')`), which works
  regardless of how many instances are on the page. This is a codegen-contract
  decision, not an animation-runtime decision, so it belongs in this ticket
  even though MUT-337 is otherwise out of scope.
- A single shared `IconProps` type in `src/components/icons/generated/types.ts`
  (not 61 duplicated interfaces — DRY, matches the "small function, no
  duplication" rule).
- `src/components/icons/generated/index.ts` barrel, auto-generated, regenerated
  in full every run (not hand-maintained — avoids drift between the barrel and
  the files on disk).

`npm run icons:generate` wires it up (`package.json`).

**Correctness guards (found during review, not optional):**
- **Escape every attribute value on emit.** A source SVG's `d`/`id`/`fill` value
  landing verbatim inside a JSX string literal means one stray `"` or `\` in a
  hand-edited path breaks out of the string and produces invalid — or, worse,
  silently-wrong — generated TSX. Escape quotes/backslashes when building each
  attribute string; this is an authoring-mistake guard first, a hardening
  measure second (source SVGs are hand-authored/Claude-Design-authored, not
  user input, but "hand-authored" is exactly where a typo slips in).
- **Reject unrecognized elements/attributes, don't silently drop them.** The
  tokenizer only knows `svg`/`path`/`circle`/`rect`/`g` and a fixed attribute
  allowlist. An unexpected tag (`<use>`, `<image>`, anything else) or attribute
  must throw with the filename, not get silently omitted from the output —
  silent omission is how a partially-broken icon ships unnoticed.
- **Fail the whole run on any parse error**, non-zero exit — never skip the
  bad file and emit the other 60. This runs via `icons:check`/pre-commit-style
  gating, where a partial success reads as a pass.

### 2. `scripts/validate_icon_set.mjs`

Mirrors `validate_illustrations.mjs`'s existing convention exactly: pure,
exported functions taking injected `fileExists`/`readFile` (testable without
touching the real filesystem), a `main()` gated by
`import.meta.url === ...` for the CLI, `[--strict]` flag. (That file's own
comment already names this script as a sibling using "the same convention" —
it didn't exist yet; this ticket is what creates it.)

Checks:
- Every `assets/icons/source/*.svg` has a matching generated
  `src/components/icons/generated/*.tsx`.
- Regenerating in-memory produces byte-identical output to what's on disk (catches
  hand-edited-then-forgotten-to-regenerate drift — this is what makes AC #1's
  "without manual post-editing" enforceable rather than aspirational).

Wired into `npm run icons:check` (not into the default `npm run lint` — it's a
narrow, fast, additive check; the existing illustration validator follows the
same non-blocking-by-default pattern).

### 3. Docs: add/update flow (AC #2)

A short section in `assets/icons/README.md` (new) plus a
`.claude/PATTERNS.md` cross-reference: design/edit in the shared Claude Design
project → DesignSync pulls the canonical SVG into mutaba3a-flutter's
`assets/icons/source/` → the existing MUT-335 mirror step copies it into
mini-crm's `assets/icons/source/` (same mechanism already used for the initial
61) → `npm run icons:generate` (this repo) regenerates the React component →
the Flutter repo runs its own codegen step (its half, not built here) → both
platforms' generated code is committed.

### 4. Pilot (AC #3)

One generated icon rendered statically on one real screen, proving the
pipeline end-to-end without migrating anything else. Proposed default:
**Settings page**, which (per this repo's screen spec) doesn't currently use
any of `src/components/icons/*` for its own chrome — add
`<LanguageIcon />` (generated) next to the existing language setting, a brand
new usage rather than a replacement of an existing hand-written icon, so it
can't be read as the start of the excluded call-site migration. Flagging this
placement for confirmation before implementation.

## Reuse analysis (COMPONENT_REGISTRY check)

No existing component covers SVG-source codegen. The existing 16
`src/components/icons/*` components and their shared `{size, className}` shape
are reused as the target shape for generated output (not reinvented). No new
runtime dependency.

## Test plan (TDD)

- `scripts/generate-icons.test.mjs` (mirrors `validate_illustrations.test.mjs`'s
  injected-I/O style): given a fixture SVG with nested `<g id="card">` and a
  bare `<circle id="nuqta">`, asserts the emitted component string contains
  `data-part="card"` / `data-part="nuqta"` and never a raw `id=`; asserts
  kebab→Pascal naming for a hyphenated filename; asserts the barrel lists every
  input file.
- `scripts/validate_icon_set.test.mjs`: missing-generated-file case fails;
  stale-generated-file (edited by hand after last generate) case fails;
  clean case passes.
- `scripts/generate-icons.test.mjs` additions: a fixture `d`/`id` value
  containing `"` and `\` round-trips through the emitted TSX as valid,
  correctly-escaped source (protects against the authoring-mistake injection
  above); an unrecognized tag/attribute throws rather than being dropped; a
  malformed fixture fails the whole run (non-zero exit), not just that file.
- One RTL render test on the Settings page asserting the pilot icon renders
  (`container.querySelector('svg')` or by test-id) — proves AC #3, not a new
  Settings test suite.

## Impact / i18n / cost

No i18n strings. No runtime cost (build-time codegen only; generated output is
plain SVG, same render cost as the hand-written components it sits beside). No
infra changes.

## Flutter handoff (not built in this session)

Same problem, mirrored: a Dart script reading the same `assets/icons/source/*.svg`
→ generated Flutter widgets under `lib/.../icons/generated/`. The `data-part`
equivalent there is a `Key`/semantic label per sub-path (Flutter has no DOM-id
collision risk, but an unnamed index-based part reference is just as fragile
for MUT-337 to target later, so name them anyway). Needs its own worktree in
mutaba3a-flutter and its own plan — out of scope here.

## QA scenarios

Per this repo's release-qa convention: the icon-generation pipeline is a build
step, not user-visible UI, so it doesn't get a `qa/features` entry itself
(same exception MUT-334's epic description grants the icon-foundation
stories). The one user-visible surface — the Settings page pilot icon — is
covered by the RTL render test above; it's too small to warrant a dedicated
Playwright flow (no behavior changes, purely a static icon addition).
