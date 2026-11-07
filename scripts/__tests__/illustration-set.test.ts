// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  IllustrationSetError,
  SCENE_PALETTE,
  generateSceneBarrel,
  generateSceneComponent,
  sceneComponentName,
  sceneFromSvg,
} from '../illustration-set';

/**
 * MUT-561: the portal's first illustration renderer. The scenes in `assets/illustrations/source/` (MUT-345, Claude
 * Design) become React components with their three art colours turned into the brand's tokens, so dark mode follows
 * the theme with no second drawing (the Flutter generator's rule, `tool/illustration_set.dart`).
 */

const SCENE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160">
  <g id="box">
    <rect x="30" y="70" width="100" height="70" rx="16" fill="#F4F2FB" stroke="#795DBA" stroke-width="3"/>
  </g>
  <path id="dash" d="M1 1" fill="none" stroke="#795DBA" stroke-dasharray="2 6"/>
  <rect x="2" y="2" width="8" height="8" fill="#E89960" transform="rotate(20 26 74)"/>
  <circle id="nuqta" cx="80" cy="45" r="7" fill="#E89960"/>
</svg>`;

describe('sceneComponentName', () => {
  it('names a scene file as a component', () => {
    expect(sceneComponentName('empty-state.svg')).toBe('EmptyStateScene');
    expect(sceneComponentName('accountant-empty.svg')).toBe('AccountantEmptyScene');
  });
});

describe('sceneFromSvg', () => {
  it('maps exactly the three art colours to the brand tokens', () => {
    expect(Object.keys(SCENE_PALETTE).sort()).toEqual(['#795dba', '#e89960', '#f4f2fb']);
    expect(SCENE_PALETTE['#f4f2fb']).toBe('var(--m-field-bg)');
    expect(SCENE_PALETTE['#795dba']).toBe('var(--m-primary)');
    expect(SCENE_PALETTE['#e89960']).toBe('var(--m-peach-strong)');
  });

  it('rewrites every fill and stroke to its token, case-insensitively, and keeps none', () => {
    const tsx = generateSceneComponent('EmptyStateScene', sceneFromSvg(SCENE, 'empty-state.svg'), 'empty-state.svg');
    expect(tsx).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(tsx).toContain('fill={"var(--m-field-bg)"}');
    expect(tsx).toContain('stroke={"var(--m-primary)"}');
    expect(tsx).toContain('fill={"var(--m-peach-strong)"}');
    expect(tsx).toContain('fill={"none"}');
  });

  it('keeps dashes, rotations and named parts (as data-part, never a page-wide id)', () => {
    const tsx = generateSceneComponent('EmptyStateScene', sceneFromSvg(SCENE, 'empty-state.svg'), 'empty-state.svg');
    expect(tsx).toContain('strokeDasharray={"2 6"}');
    expect(tsx).toContain('transform={"rotate(20 26 74)"}');
    expect(tsx).toContain('data-part="nuqta"');
    expect(tsx).toContain('data-part="box"');
    expect(tsx).not.toMatch(/\sid=/);
  });

  it('is decorative: aria-hidden and unfocusable, sized by a prop', () => {
    const tsx = generateSceneComponent('EmptyStateScene', sceneFromSvg(SCENE, 'empty-state.svg'), 'empty-state.svg');
    expect(tsx).toContain('aria-hidden="true"');
    expect(tsx).toContain('focusable="false"');
    expect(tsx).toContain('width={size}');
    expect(tsx).toContain('viewBox={"0 0 160 160"}');
  });

  it('fails on a colour outside the three, naming the file', () => {
    const off = SCENE.replace('#E89960"/>\n</svg>', '#FF0000"/>\n</svg>');
    expect(() => sceneFromSvg(off, 'bad.svg')).toThrow(IllustrationSetError);
    expect(() => sceneFromSvg(off, 'bad.svg')).toThrow(/bad\.svg.*#ff0000/i);
  });

  it('fails on anything outside the dialect: other elements, opacity, a transform that is not a rotation', () => {
    expect(() => sceneFromSvg('<svg viewBox="0 0 160 160"><text>x</text></svg>', 'a.svg')).toThrow(/a\.svg/);
    expect(() => sceneFromSvg('<svg viewBox="0 0 160 160"><circle cx="1" cy="1" r="1" opacity="0.5"/></svg>', 'b.svg')).toThrow(/opacity/);
    expect(() => sceneFromSvg('<svg viewBox="0 0 160 160"><circle cx="1" cy="1" r="1" transform="scale(-1 1)"/></svg>', 'c.svg')).toThrow(/rotate/);
  });
});

describe('generateSceneBarrel', () => {
  it('registers every scene by its file name, sorted', () => {
    const barrel = generateSceneBarrel(['onboarding.svg', 'empty-state.svg']);
    expect(barrel).toContain("import { EmptyStateScene } from './EmptyStateScene';");
    expect(barrel.indexOf("'empty-state': EmptyStateScene")).toBeLessThan(barrel.indexOf("onboarding: OnboardingScene"));
    expect(barrel).toContain('export type SceneArtName = keyof typeof SCENE_ART;');
  });
});

describe('the generated set', () => {
  const sourceDir = join(process.cwd(), 'assets/illustrations/source');
  const outDir = join(process.cwd(), 'src/components/illustrations/generated');

  it('matches the sources with no hand edits (rerun npm run illustrations:generate)', () => {
    const sources = readdirSync(sourceDir).filter((name) => name.endsWith('.svg')).sort();
    for (const file of sources) {
      const name = sceneComponentName(file);
      const fresh = generateSceneComponent(name, sceneFromSvg(readFileSync(join(sourceDir, file), 'utf8'), file), file);
      expect(readFileSync(join(outDir, `${name}.tsx`), 'utf8'), file).toBe(fresh);
    }
    expect(readFileSync(join(outDir, 'index.ts'), 'utf8')).toBe(generateSceneBarrel(sources));
  });
});
