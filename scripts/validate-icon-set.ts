/**
 * `npm run icons:check` (MUT-336): fails if `src/components/icons/generated/`
 * is missing a source icon, stale against it (hand-edited or source changed
 * since the last `npm run icons:generate`), or carries a generated file with
 * no matching source. Logic lives in `scripts/icon-set.ts`.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findIconSetProblems } from './icon-set';

const ROOT = process.cwd();
const SOURCE_DIR = join(ROOT, 'assets/icons/source');
const OUT_DIR = join(ROOT, 'src/components/icons/generated');

function readDirAsRecord(dir: string, extension: string): Record<string, string> {
  if (!existsSync(dir)) return {};
  const files: Record<string, string> = {};
  for (const name of readdirSync(dir)) {
    if (name.endsWith(extension)) files[name] = readFileSync(join(dir, name), 'utf8');
  }
  return files;
}

function main() {
  const sourceFiles = readDirAsRecord(SOURCE_DIR, '.svg');
  const generatedFiles = {
    ...readDirAsRecord(OUT_DIR, '.tsx'),
    ...readDirAsRecord(OUT_DIR, '.ts'),
  };

  const { missingGenerated, staleGenerated, orphanedGenerated } = findIconSetProblems({ sourceFiles, generatedFiles });

  if (missingGenerated.length === 0 && staleGenerated.length === 0 && orphanedGenerated.length === 0) {
    console.log(`Icon set: ${Object.keys(sourceFiles).length} source icon(s), all generated and up to date.`);
    process.exit(0);
  }

  if (missingGenerated.length > 0) {
    console.error(`MISSING generated component(s), run \`npm run icons:generate\`: ${missingGenerated.join(', ')}`);
  }
  if (staleGenerated.length > 0) {
    console.error(
      `STALE generated component(s) (hand-edited, or source changed since the last generate), run \`npm run icons:generate\`: ${staleGenerated.join(', ')}`,
    );
  }
  if (orphanedGenerated.length > 0) {
    console.error(`ORPHANED generated component(s) with no matching source, delete them or restore the source: ${orphanedGenerated.join(', ')}`);
  }
  process.exit(1);
}

main();
