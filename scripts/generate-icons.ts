/**
 * `npm run icons:generate` (MUT-336): regenerates every React icon component
 * in `src/components/icons/generated/` from `assets/icons/source/*.svg`.
 * Logic lives in `scripts/icon-set.ts`; `scripts/__tests__/icon-set.test.ts`
 * exercises it. See `assets/icons/README.md` for the full add/update flow.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ICON_PROPS_MODULE, generateBarrel, generateComponent, kebabToComponentName, parseSvg } from './icon-set';

const ROOT = process.cwd();
const SOURCE_DIR = join(ROOT, 'assets/icons/source');
const OUT_DIR = join(ROOT, 'src/components/icons/generated');

function main() {
  const filenames = readdirSync(SOURCE_DIR)
    .filter((name) => name.endsWith('.svg'))
    .sort();
  if (filenames.length === 0) {
    console.error(`No source icons found in ${SOURCE_DIR}`);
    process.exit(1);
  }

  // Parse and generate everything in memory first: one bad source file fails
  // the whole run with nothing written, never a silent partial regenerate.
  const generated: { componentName: string; tsx: string }[] = [];
  for (const filename of filenames) {
    const svgContent = readFileSync(join(SOURCE_DIR, filename), 'utf8');
    const componentName = kebabToComponentName(filename);
    try {
      const node = parseSvg(svgContent, filename);
      generated.push({ componentName, tsx: generateComponent(componentName, node, filename) });
    } catch (error) {
      console.error(`icons:generate failed: ${(error as Error).message}`);
      process.exit(1);
    }
  }

  mkdirSync(OUT_DIR, { recursive: true });
  for (const entry of readdirSync(OUT_DIR)) {
    if (entry.endsWith('Icon.tsx')) rmSync(join(OUT_DIR, entry));
  }
  for (const { componentName, tsx } of generated) {
    writeFileSync(join(OUT_DIR, `${componentName}.tsx`), tsx);
  }
  writeFileSync(join(OUT_DIR, 'types.ts'), ICON_PROPS_MODULE);
  writeFileSync(join(OUT_DIR, 'index.ts'), generateBarrel(generated.map((g) => g.componentName)));

  console.log(`Generated ${generated.length} icon component(s) into src/components/icons/generated/.`);
}

if (!existsSync(SOURCE_DIR)) {
  console.error(`${SOURCE_DIR} does not exist.`);
  process.exit(1);
}
main();
