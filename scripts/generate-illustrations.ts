/**
 * `npm run illustrations:generate` (MUT-561): regenerates every scene component in
 * `src/components/illustrations/generated/` from `assets/illustrations/source/*.svg`. Logic lives in
 * `scripts/illustration-set.ts`; `scripts/__tests__/illustration-set.test.ts` exercises it and fails on drift.
 * A new scene from Claude Design: drop its SVG in the source folder, add it to `MOMENTS` in
 * `scripts/validate_illustrations.mjs`, and rerun this. `Scene` stops showing its placeholder on its own.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCENE_PROPS_MODULE, generateSceneBarrel, generateSceneComponent, sceneComponentName, sceneFromSvg } from './illustration-set';

const ROOT = process.cwd();
const SOURCE_DIR = join(ROOT, 'assets/illustrations/source');
const OUT_DIR = join(ROOT, 'src/components/illustrations/generated');

function main() {
  const filenames = readdirSync(SOURCE_DIR)
    .filter((name) => name.endsWith('.svg'))
    .sort();
  if (filenames.length === 0) {
    console.error(`No source scenes found in ${SOURCE_DIR}`);
    process.exit(1);
  }

  // Everything in memory first: one bad source fails the run with nothing written.
  const generated: { componentName: string; tsx: string }[] = [];
  for (const filename of filenames) {
    const componentName = sceneComponentName(filename);
    try {
      const node = sceneFromSvg(readFileSync(join(SOURCE_DIR, filename), 'utf8'), filename);
      generated.push({ componentName, tsx: generateSceneComponent(componentName, node, filename) });
    } catch (error) {
      console.error(`illustrations:generate failed: ${(error as Error).message}`);
      process.exit(1);
    }
  }

  mkdirSync(OUT_DIR, { recursive: true });
  for (const entry of readdirSync(OUT_DIR)) {
    if (entry.endsWith('Scene.tsx')) rmSync(join(OUT_DIR, entry));
  }
  for (const { componentName, tsx } of generated) writeFileSync(join(OUT_DIR, `${componentName}.tsx`), tsx);
  writeFileSync(join(OUT_DIR, 'types.ts'), SCENE_PROPS_MODULE);
  writeFileSync(join(OUT_DIR, 'index.ts'), generateSceneBarrel(filenames));

  console.log(`Generated ${generated.length} scene component(s) into src/components/illustrations/generated/.`);
}

if (!existsSync(SOURCE_DIR)) {
  console.error(`${SOURCE_DIR} does not exist.`);
  process.exit(1);
}
main();
