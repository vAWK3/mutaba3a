import { describe, expect, it } from 'vitest';
import tokens from '../../../styles/brand/mutaba3a.tokens.json';
import { RING_COLORS, ringColorOf } from '../YouIsland';

type Palette = Record<string, { hex: string }>;
const LIGHT = tokens.color as Palette;
const DARK = tokens.colorDark as Palette;
/** The page surfaces a ring can sit on: canvas and surface, in each theme. */
const SURFACES = ['canvas', 'surface'];
/** WCAG 1.4.11: a graphic that identifies something needs 3:1 against what is next to it. */
const NON_TEXT_CONTRAST = 3;

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** MUT-426 (eng D2): the island's ring colour is a stable hash of the profile id over six brand colours. */
describe('ringColorOf', () => {
  const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

  it('is the same colour for the same id, every time', () => {
    for (const id of ids) expect(ringColorOf(id)).toEqual(ringColorOf(id));
  });

  it('always picks from the palette', () => {
    for (const id of ids) expect(RING_COLORS).toContain(ringColorOf(id));
  });

  it('spreads ids over more than one colour', () => {
    expect(new Set(ids.map(ringColorOf)).size).toBeGreaterThan(1);
  });

  it('names the six profile-ring tokens, one per brand ring primitive', () => {
    expect(RING_COLORS).toEqual([1, 2, 3, 4, 5, 6].map((n) => `var(--profile-ring-${n})`));
  });

  it.each([
    ['light', LIGHT],
    ['dark', DARK],
  ])('each ring primitive is legible as a ring on every %s surface', (_theme, palette) => {
    const failing = [1, 2, 3, 4, 5, 6].flatMap((n) =>
      SURFACES.filter((surface) => contrast(palette[`ring${n}`].hex, palette[surface].hex) < NON_TEXT_CONTRAST).map((surface) => `ring${n} on ${surface}`),
    );
    expect(failing).toEqual([]);
  });
});
