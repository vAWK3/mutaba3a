#!/usr/bin/env node
/**
 * MUT-646: builds the "letterhead ready" moment from Claude Design's stills (batch 1, MOTION-SPEC.md §2).
 *
 *   node scripts/animate-letterhead-ready.mjs <batch-svg-dir>
 *
 * Each still is the moment's last frame (1200 ms). This writes the same SVG with its motion as CSS keyframes inside
 * it, so the portal shows it with a plain <img> (no script, no inline markup) and the browser plays it once. Under
 * prefers-reduced-motion the keyframes are left out and the still is what shows. Each part's own transform is read
 * from the drawing, so a keyframe never moves it away from where Claude Design put it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SPRING = 'cubic-bezier(0.32, 0.72, 0, 1)';
const OUT = new URL('../src/hosted/pages/invoicing/art/', import.meta.url).pathname;
const VARIANTS = ['light', 'dark', 'light-rtl', 'dark-rtl'];

const attrOf = (svg, id, attr) => new RegExp(`id="${id}"[^>]*?\\b${attr}="([^"]*)"`).exec(svg)?.[1];
const translateOf = (svg, id) => {
  const m = /translate\(([-\d.]+)[ ,]+([-\d.]+)\)/.exec(attrOf(svg, id, 'transform') ?? '');
  return m ? `translate(${m[1]}px, ${m[2]}px)` : '';
};

function motion(svg) {
  const rules = [];
  const rule = (selector, name, from, to, start, end) => {
    rules.push(`@keyframes ${name} { from { ${from} } to { ${to} } }`);
    rules.push(`${selector} { animation: ${name} ${end - start}ms ${SPRING} ${start}ms both; }`);
  };
  for (let i = 0; i < 5; i++) {
    const n = i + 1;
    const [start, end] = [120 * i, 120 * i + 240];
    rule(`#region-${n}`, `region${n}`, 'opacity: 0.4', 'opacity: 1', start, end);
    rule(`#badge-${n} [opacity="0"]`, `badge${n}`, 'opacity: 1', 'opacity: 0', start, end);
    const at = translateOf(svg, `tick-${n}`);
    rule(`#tick-${n}`, `tick${n}`, `opacity: 0; transform: ${at} scale(0.6)`, `opacity: 1; transform: ${at} scale(1)`, start, end);
  }
  const shadow = attrOf(svg, 'shadow', 'opacity') ?? '0.2';
  rule('#sheet', 'sheet', 'transform: translate(0px, 0px)', `transform: ${translateOf(svg, 'sheet') || 'translate(0px, -4px)'}`, 720, 1000);
  rule('#shadow', 'shadow', 'opacity: 0', `opacity: ${shadow}`, 720, 1000);
  const check = translateOf(svg, 'ready-check');
  rule('#ready-check', 'check', `opacity: 0; transform: ${check} scale(0.6)`, `opacity: 1; transform: ${check} scale(1)`, 900, 1200);
  return `<style>@media (prefers-reduced-motion: no-preference) { ${rules.join(' ')} }</style>`;
}

const src = process.argv[2];
if (!src) {
  console.error('usage: node scripts/animate-letterhead-ready.mjs <batch-svg-dir>');
  process.exit(1);
}
for (const variant of VARIANTS) {
  const still = readFileSync(join(src, `invoicing-letterhead-ready-${variant}.svg`), 'utf8');
  const animated = still.replace(/(<svg[^>]*>)/, `$1${motion(still)}`);
  writeFileSync(join(OUT, `invoicing-letterhead-ready-${variant}.svg`), animated);
  console.log(`wrote invoicing-letterhead-ready-${variant}.svg`);
}
