#!/usr/bin/env node
// Validates the MUT-345 illustration set against the brief's 5-file target.
// Usage: node scripts/validate_illustrations.mjs [--strict]
//   --strict  also fail on illustrations that haven't been authored yet.
//             Without it, missing files are pending, not a failure (the set
//             is built incrementally, same convention as validate_icon_set.mjs).

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ASSETS_DIR = path.join(REPO_ROOT, 'assets/illustrations/source');

// The 5-file target from mutaba3a-flutter's .claude/designs/mut-345-illustration-brief.md.
// `pair: true` means personal/firm variants are both required; otherwise one
// shared file covers every consuming surface.
// `tier` (MUT-350): 'minimal' for moments that fire constantly in daily use
// (fast/subtle so they don't compete for attention every time), 'grand' for
// rare/special moments (slow/big/elaborate is earned by scarcity). See the
// "Weight tiers" section of mutaba3a-flutter's mut-345-animation-spec.md for
// the full rule.
export const MOMENTS = [
  { name: 'empty-state', pair: false, tier: 'minimal' },
  { name: 'destructive-confirmation', pair: false, tier: 'minimal' },
  { name: 'onboarding', pair: false, tier: 'grand' },
  { name: 'milestone', pair: true, tier: 'grand' },
];

// Mirrors the `color` block in this repo's src/styles/brand/mutaba3a.tokens.json.
// Keep in sync if that file's palette ever changes (locked Brand v2 foundation
// work, MUT-102, so low churn risk).
export const APPROVED_PALETTE = new Set(
  [
    '#FCF6ED', '#FFFCF7', '#E6E2ED', '#F4F2FB', '#392F4B', '#564E68',
    '#795DBA', '#5E439E', '#FDF8F0', '#866EC5',
    '#E0D7FF', '#4D387E',
    '#BAEBD4', '#00513E', '#51B48D',
    '#FFCED5', '#742B35', '#D16B7A',
    '#FED4B9', '#723300', '#E89960',
    '#F6E8B3', '#67450A',
    '#BCABF1', '#F499A7', '#F5AB77',
  ].map((hex) => hex.toLowerCase()),
);

export function expectedFilenames(moment) {
  return moment.pair ? [`${moment.name}-personal.svg`, `${moment.name}-firm.svg`] : [`${moment.name}.svg`];
}

function extractHexColors(svgContent) {
  const matches = svgContent.match(/#[0-9a-fA-F]{3,8}\b/g);
  return matches ? matches.map((hex) => hex.toLowerCase()) : [];
}

// `fileExists`/`readFile` are injected so this runs against fixtures in tests
// without touching the real filesystem.
export function validateIllustrations({
  moments,
  assetsDir,
  strict = false,
  fileExists,
  readFile,
  approvedPalette = APPROVED_PALETTE,
}) {
  const missing = [];
  const offPalette = [];
  const ok = [];

  for (const moment of moments) {
    for (const filename of expectedFilenames(moment)) {
      const filePath = `${assetsDir}/${filename}`;
      if (!fileExists(filePath)) {
        missing.push(filename);
        continue;
      }
      const badColors = [...new Set(extractHexColors(readFile(filePath)))].filter(
        (hex) => !approvedPalette.has(hex),
      );
      if (badColors.length > 0) {
        offPalette.push({ file: filename, colors: badColors });
        continue;
      }
      ok.push(filename);
    }
  }

  const total = ok.length + missing.length + offPalette.length;
  const failures = offPalette.length + (strict ? missing.length : 0);
  return { total, ok, missing, offPalette, passed: failures === 0 };
}

function main() {
  const strict = process.argv.includes('--strict');
  const result = validateIllustrations({
    moments: MOMENTS,
    assetsDir: ASSETS_DIR,
    strict,
    fileExists: existsSync,
    readFile: (p) => readFileSync(p, 'utf8'),
  });

  console.log(`Illustrations: ${result.ok.length}/${result.total} ready${strict ? ' (strict)' : ''}`);
  if (result.missing.length > 0) {
    console.log(`  ${strict ? 'MISSING (fails --strict)' : 'pending'}: ${result.missing.join(', ')}`);
  }
  if (result.offPalette.length > 0) {
    console.log(
      `  OFF-PALETTE: ${result.offPalette.map((r) => `${r.file} (${r.colors.join(', ')})`).join('; ')}`,
    );
  }

  process.exit(result.passed ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
