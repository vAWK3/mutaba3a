import { describe, it, expect } from 'vitest';
import {
  IconSetError,
  kebabToComponentName,
  parseSvg,
  generateComponent,
  generateBarrel,
  findIconSetProblems,
  ICON_PROPS_MODULE,
} from '../icon-set';

describe('kebabToComponentName', () => {
  it('converts a single-word filename to PascalCase + Icon', () => {
    expect(kebabToComponentName('add.svg')).toBe('AddIcon');
  });

  it('converts a hyphenated filename to PascalCase + Icon', () => {
    expect(kebabToComponentName('swap-horizontal.svg')).toBe('SwapHorizontalIcon');
  });

  it('handles three-part names', () => {
    expect(kebabToComponentName('theme-light.svg')).toBe('ThemeLightIcon');
  });
});

describe('parseSvg', () => {
  it('parses a root svg with simple path children', () => {
    const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path id="short-stroke" d="M5 13l3 3"/>
  <path id="long-stroke" d="M8 16l10-10"/>
</svg>`;
    const root = parseSvg(source, 'check.svg');
    expect(root.tag).toBe('svg');
    expect(root.attrs.viewBox).toBe('0 0 24 24');
    expect(root.children).toHaveLength(2);
    expect(root.children[0]).toEqual({ tag: 'path', attrs: { id: 'short-stroke', d: 'M5 13l3 3' }, children: [] });
  });

  it('parses nested grouped elements (badge.svg shape)', () => {
    const source = `<svg viewBox="0 0 24 24"><g id="card"><rect x="3" y="6" width="18" height="15" rx="3"></rect><path d="M8.5 17h7"></path></g><circle id="nuqta" cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"></circle></svg>`;
    const root = parseSvg(source, 'badge.svg');
    expect(root.children).toHaveLength(2);
    const group = root.children[0];
    expect(group.tag).toBe('g');
    expect(group.attrs.id).toBe('card');
    expect(group.children).toHaveLength(2);
    expect(group.children[0].tag).toBe('rect');
    expect(group.children[1].tag).toBe('path');
    const dot = root.children[1];
    expect(dot.tag).toBe('circle');
    expect(dot.attrs).toEqual({ id: 'nuqta', cx: '12', cy: '12', r: '2.2', fill: 'currentColor', stroke: 'none' });
  });

  it('throws IconSetError naming the file on an unrecognized element', () => {
    const source = `<svg viewBox="0 0 24 24"><use href="#x"/></svg>`;
    expect(() => parseSvg(source, 'weird.svg')).toThrow(IconSetError);
    expect(() => parseSvg(source, 'weird.svg')).toThrow(/weird\.svg/);
    expect(() => parseSvg(source, 'weird.svg')).toThrow(/use/);
  });

  it('throws IconSetError naming the file on an unrecognized attribute', () => {
    const source = `<svg viewBox="0 0 24 24"><path d="M0 0" onclick="evil()"/></svg>`;
    expect(() => parseSvg(source, 'weird.svg')).toThrow(IconSetError);
    expect(() => parseSvg(source, 'weird.svg')).toThrow(/onclick/);
  });

  it('throws IconSetError on an unclosed tag', () => {
    const source = `<svg viewBox="0 0 24 24"><g id="card"><rect x="1" y="1" width="2" height="2"/></svg>`;
    expect(() => parseSvg(source, 'broken.svg')).toThrow(IconSetError);
  });
});

describe('generateComponent', () => {
  const simpleRoot = parseSvg(
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4.5v15m7.5-7.5h-15"/></svg>`,
    'add.svg',
  );

  it('emits a component importing the shared IconProps type', () => {
    const tsx = generateComponent('AddIcon', simpleRoot, 'add.svg');
    expect(tsx).toContain("import type { IconProps } from './types';");
    expect(tsx).toContain('export function AddIcon({ size = 16, className }: IconProps)');
  });

  it('carries size/className onto the root svg and drops xmlns', () => {
    const tsx = generateComponent('AddIcon', simpleRoot, 'add.svg');
    expect(tsx).toContain('width={size}');
    expect(tsx).toContain('height={size}');
    expect(tsx).toContain('className={className}');
    expect(tsx).not.toContain('xmlns');
  });

  it('converts stroke-width to a numeric strokeWidth prop', () => {
    const tsx = generateComponent('AddIcon', simpleRoot, 'add.svg');
    expect(tsx).toContain('strokeWidth={2}');
  });

  it('turns a named sub-element id into data-part, never a raw id attribute', () => {
    const root = parseSvg(
      `<svg viewBox="0 0 24 24"><path id="short-stroke" d="M5 13l3 3"/><path id="long-stroke" d="M8 16l10-10"/></svg>`,
      'check.svg',
    );
    const tsx = generateComponent('CheckIcon', root, 'check.svg');
    expect(tsx).toContain('data-part="short-stroke"');
    expect(tsx).toContain('data-part="long-stroke"');
    expect(tsx).not.toMatch(/\bid="/);
    expect(tsx).not.toMatch(/\bid=\{/);
  });

  it('preserves nested groups', () => {
    const root = parseSvg(
      `<svg viewBox="0 0 24 24"><g id="card"><rect x="3" y="6" width="18" height="15" rx="3"/></g></svg>`,
      'badge.svg',
    );
    const tsx = generateComponent('BadgeIcon', root, 'badge.svg');
    expect(tsx).toContain('data-part="card"');
    expect(tsx).toMatch(/<g data-part="card">[\s\S]*<rect/);
  });

  it('escapes a double quote in an attribute value as a safe JS expression, not a broken JSX literal', () => {
    const root = parseSvg(`<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>`, 'fixture.svg');
    // Simulate a hand-authored value containing a quote by injecting it post-parse,
    // the same shape a malformed source file would produce.
    root.children[0].attrs.d = 'M0 0 "weird" \\ backslash';
    const tsx = generateComponent('FixtureIcon', root, 'fixture.svg');
    expect(tsx).toContain(`d={${JSON.stringify('M0 0 "weird" \\ backslash')}}`);
    expect(tsx).not.toContain('d="M0 0 "weird"');
  });
});

describe('generateBarrel', () => {
  it('emits one sorted export line per component name', () => {
    const barrel = generateBarrel(['CheckIcon', 'AddIcon', 'BadgeIcon']);
    expect(barrel.split('\n').filter(Boolean)).toEqual([
      "export { AddIcon } from './AddIcon';",
      "export { BadgeIcon } from './BadgeIcon';",
      "export { CheckIcon } from './CheckIcon';",
    ]);
  });
});

describe('ICON_PROPS_MODULE', () => {
  it('declares the shared IconProps interface', () => {
    expect(ICON_PROPS_MODULE).toContain('export interface IconProps');
    expect(ICON_PROPS_MODULE).toContain('size?: number');
    expect(ICON_PROPS_MODULE).toContain('className?: string');
  });
});

describe('findIconSetProblems', () => {
  const addSvg = `<svg viewBox="0 0 24 24"><path d="M12 4.5v15m7.5-7.5h-15"/></svg>`;

  function freshAddTsx() {
    return generateComponent('AddIcon', parseSvg(addSvg, 'add.svg'), 'add.svg');
  }

  it('reports nothing when every source has a current generated file', () => {
    const result = findIconSetProblems({
      sourceFiles: { 'add.svg': addSvg },
      generatedFiles: { 'AddIcon.tsx': freshAddTsx() },
    });
    expect(result).toEqual({ missingGenerated: [], staleGenerated: [], orphanedGenerated: [] });
  });

  it('flags a source icon with no generated file as missing', () => {
    const result = findIconSetProblems({ sourceFiles: { 'add.svg': addSvg }, generatedFiles: {} });
    expect(result.missingGenerated).toEqual(['AddIcon']);
  });

  it('flags a generated file that no longer matches a freshly regenerated version as stale', () => {
    const result = findIconSetProblems({
      sourceFiles: { 'add.svg': addSvg },
      generatedFiles: { 'AddIcon.tsx': freshAddTsx().replace('M12 4.5v15m7.5-7.5h-15', 'M0 0') },
    });
    expect(result.staleGenerated).toEqual(['AddIcon']);
  });

  it('flags a generated file with no matching source as orphaned', () => {
    const result = findIconSetProblems({
      sourceFiles: {},
      generatedFiles: { 'GoneIcon.tsx': 'stale content' },
    });
    expect(result.orphanedGenerated).toEqual(['GoneIcon']);
  });

  it('ignores index.ts and types.ts when looking for orphans', () => {
    const result = findIconSetProblems({
      sourceFiles: { 'add.svg': addSvg },
      generatedFiles: { 'AddIcon.tsx': freshAddTsx(), 'index.ts': '...', 'types.ts': '...' },
    });
    expect(result.orphanedGenerated).toEqual([]);
  });
});
