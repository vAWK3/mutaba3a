# Icon set (MUT-335 / MUT-336)

`source/*.svg` is the canonical, multi-part icon set designed in the shared
"Mutaba3a Icons" Claude Design project (MUT-335), mirrored byte-identical into
this repo so the codegen below doesn't need to read across repos. The style
sheet and the full table of every icon (name, multi-part?, RTL-mirrored?) live
in `mutaba3a-flutter/mutaba3a/.claude/designs/mut-335-icon-inventory.md` — this
repo's copy is a pointer (`.claude/designs/mut-335-icon-inventory.md`).

## Adding or updating one icon

1. **Design** in the shared Claude Design project (DesignSync pulls the result
   into mutaba3a-flutter's `assets/icons/source/`, the canonical copy).
2. **Mirror** it here: copy the same file into this repo's `assets/icons/source/`
   (the mechanism MUT-335 used for the initial 61 — byte-identical, no edits).
3. **Regenerate**: `npm run icons:generate`. This rewrites every file under
   `src/components/icons/generated/`, including the barrel (`index.ts`) and the
   shared `types.ts` — never hand-edit anything in that directory, the next
   regenerate overwrites it.
4. **Regenerate Flutter's half** (its own codegen step, in that repo — not
   built by MUT-336's web half).
5. `npm run icons:check` fails if a source and its generated output have
   drifted (missing, stale, or orphaned) — run it before committing.

## Why `data-part`, not `id`

A source SVG's named sub-elements (`id="nuqta"`, `id="short-stroke"`, …) exist
so MUT-337's future animation runtime can target one part of an icon. The
generator emits them as `data-part="<name>"` instead of a raw `id` — two
instances of the same icon on one page would otherwise collide on a DOM `id`
(invalid HTML, and it silently breaks `querySelector`-based lookups). Select a
part scoped to one icon instance, e.g.
`rootRef.current.querySelector('[data-part="nuqta"]')`.

## Scripts

- `scripts/icon-set.ts` — pure logic (SVG parsing, naming, codegen, drift
  detection); `scripts/__tests__/icon-set.test.ts` tests it directly.
- `scripts/generate-icons.ts` — `npm run icons:generate`. Fails the whole run,
  writing nothing, on any source file that doesn't parse (unrecognized
  element/attribute, unclosed tag) — a partial regenerate would look like a
  pass.
- `scripts/validate-icon-set.ts` — `npm run icons:check`. Reports missing,
  stale, or orphaned generated components.
