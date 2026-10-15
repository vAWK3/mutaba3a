// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import tokensJson from '../../../styles/brand/mutaba3a.tokens.json';
import { repoPath } from '../../../test/css/brandCss';
import { BLOOM_DURATION, BLOOM_PIECES, BLOOM_ROTATION, BLOOM_VIEWBOX, type BloomPieceClass } from '../bloomLoaderData';

/**
 * MUT-206 D4: the web loader's SMIL strings equal the Lottie file, the kit's
 * source of truth (MUT-203). Keyframe times, every path's control points,
 * every easing, the turn, and which fill each piece gets. Drift fails here.
 */

type Vec = [number, number];
interface ShapeKey {
  t: number;
  s?: [{ v: Vec[]; i: Vec[]; o: Vec[]; c: boolean }];
  o?: { x: number | number[]; y: number | number[] };
  i?: { x: number | number[]; y: number | number[] };
}
interface RotationKey {
  t: number;
  s?: [number];
  o?: { x: number[]; y: number[] };
  i?: { x: number[]; y: number[] };
}
interface Layer {
  nm: 'tr' | 'tl' | 'bl' | 'br';
  ks: { r: { k: RotationKey[] }; a: { k: number[] }; p: { k: number[] } };
  shapes: [{ it: [{ ks: { k: ShapeKey[] } }, { c: { k: number[] } }] }];
}
interface Lottie {
  fr: number;
  op: number;
  w: number;
  layers: Layer[];
}

const readLottie = (file: string) => JSON.parse(readFileSync(repoPath(`docs/brand/loader/${file}`), 'utf8')) as Lottie;
const LIGHT = readLottie('mutaba3a-loader.json');
const DARK = readLottie('mutaba3a-loader-dark.json');

const TOKEN_FOR: Record<BloomPieceClass, keyof typeof tokensJson.color> = {
  dot: 'markDot',
  lavender: 'markLavender',
  rose: 'markRose',
  peach: 'markPeach',
};

const numbers = (text: string) => [...text.matchAll(/-?\d*\.?\d+/g)].map((m) => Number(m[0]));
const scalar = (value: number | number[]) => (Array.isArray(value) ? value[0] : value);
const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1]];

/** A closed Lottie bezier as the absolute numbers of `M v0 C (v0+o0) (v1+i1) v1 … Z`. */
function lottiePathNumbers({ v, i, o }: { v: Vec[]; i: Vec[]; o: Vec[] }): number[] {
  const out: number[] = [...v[0]];
  for (let k = 0; k < v.length; k++) {
    const next = (k + 1) % v.length;
    out.push(...add(v[k], o[k]), ...add(v[next], i[next]), ...v[next]);
  }
  return out;
}

/** SMIL keySplines for a keyframe list: each segment eases out of key k with k's `o`, into k+1 with k's `i`. */
function lottieSplines(keys: (ShapeKey | RotationKey)[]): number[][] {
  return keys.slice(0, -1).map((key) => [scalar(key.o!.x), scalar(key.o!.y), scalar(key.i!.x), scalar(key.i!.y)]);
}

function expectClose(actual: number[], expected: number[], tolerance: number, what: string) {
  expect(actual.length, `${what}: count`).toBe(expected.length);
  actual.forEach((value, index) => expect(Math.abs(value - expected[index]), `${what}[${index}] ${value} vs ${expected[index]}`).toBeLessThanOrEqual(tolerance));
}

const shapeKeys = (layer: Layer) => layer.shapes[0].it[0].ks.k;
const fillHex = (layer: Layer) =>
  `#${layer.shapes[0].it[1].c.k
    .slice(0, 3)
    .map((channel) => Math.round(channel * 255).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;

describe('bloom loader data vs the Lottie source (MUT-206 D4)', () => {
  const loopFrames = LIGHT.op;

  it('loops over the file’s duration in the delivered box', () => {
    expect(BLOOM_DURATION).toBe(`${loopFrames / LIGHT.fr}s`);
    expect(BLOOM_VIEWBOX).toBe(`-10 -10 ${LIGHT.w} ${LIGHT.w}`);
  });

  it('has the four pieces in the JSON’s layer order', () => {
    expect(BLOOM_PIECES.map((piece) => piece.layer)).toEqual(LIGHT.layers.map((layer) => layer.nm));
    expect(DARK.layers.map((layer) => layer.nm)).toEqual(LIGHT.layers.map((layer) => layer.nm));
  });

  it.each(BLOOM_PIECES.map((piece, index) => [piece.layer, piece, index] as const))('%s: keyTimes = t / %s', (_layer, piece, index) => {
    const keys = shapeKeys(LIGHT.layers[index]);
    expectClose(numbers(piece.keyTimes), keys.map((key) => key.t / loopFrames), 5e-5, 'keyTimes');
  });

  it.each(BLOOM_PIECES.map((piece, index) => [piece.layer, piece, index] as const))('%s: every keyframe path is the Lottie bezier', (_layer, piece, index) => {
    const keys = shapeKeys(LIGHT.layers[index]);
    expect(piece.values).toHaveLength(keys.length);
    keys.forEach((key, k) => expectClose(numbers(piece.values[k]), lottiePathNumbers(key.s![0]), 0.006, `values[${k}]`));
  });

  it.each(BLOOM_PIECES.map((piece, index) => [piece.layer, piece, index] as const))('%s: keySplines are the Lottie easing handles', (_layer, piece, index) => {
    const splines = piece.keySplines.split(';').map(numbers);
    const expected = lottieSplines(shapeKeys(LIGHT.layers[index]));
    expect(splines).toHaveLength(expected.length);
    splines.forEach((spline, k) => expectClose(spline, expected[k], 1e-9, `keySplines[${k}]`));
  });

  it('loops seamlessly: every piece ends on the frame it starts on (the mark)', () => {
    for (const piece of BLOOM_PIECES) expect(piece.values[piece.values.length - 1], piece.cls).toBe(piece.values[0]);
  });

  it('the dark file moves exactly like the light one', () => {
    LIGHT.layers.forEach((layer, index) => expect(shapeKeys(DARK.layers[index])).toEqual(shapeKeys(layer)));
  });

  it('turns once about the mark’s centre, with the Lottie rotation keys', () => {
    const rotations = LIGHT.layers.map((layer) => layer.ks.r.k);
    for (const keys of rotations) expect(keys).toEqual(rotations[0]);
    const keys = rotations[0];
    const [cx, cy] = LIGHT.layers[0].ks.a.k;

    expectClose(numbers(BLOOM_ROTATION.keyTimes), keys.map((key) => key.t / loopFrames), 5e-5, 'rotation keyTimes');
    expect(BLOOM_ROTATION.values.split(';')).toEqual(keys.map((key) => `${key.s![0]} ${cx} ${cy}`));
    BLOOM_ROTATION.keySplines
      .split(';')
      .map(numbers)
      .forEach((spline, k) => expectClose(spline, lottieSplines(keys)[k], 1e-9, `rotation keySplines[${k}]`));
  });

  it('each piece’s class names the token that equals its JSON fill, light and dark', () => {
    BLOOM_PIECES.forEach((piece, index) => {
      expect(fillHex(LIGHT.layers[index]), `${piece.cls} light`).toBe(tokensJson.color[TOKEN_FOR[piece.cls]].hex);
      expect(fillHex(DARK.layers[index]), `${piece.cls} dark`).toBe(tokensJson.colorDark[TOKEN_FOR[piece.cls]].hex);
    });
  });
});
