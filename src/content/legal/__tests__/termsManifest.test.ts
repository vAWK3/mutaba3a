import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { termsManifest } from '../termsManifest';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

describe('termsManifest (MUT-324 D11)', () => {
  it('lists each version once, newest first, with the sha256 of each language file', () => {
    const files = [
      { name: '2026-10-19.en.json', bytes: Buffer.from('old en') },
      { name: '2026-10-19.ar.json', bytes: Buffer.from('old ar') },
      { name: '2027-01-01.en.json', bytes: Buffer.from('new en') },
      { name: '2027-01-01.ar.json', bytes: Buffer.from('new ar') },
    ];
    expect(termsManifest(files)).toEqual({
      versions: [
        { version: '2027-01-01', sha256: { en: sha('new en'), ar: sha('new ar') } },
        { version: '2026-10-19', sha256: { en: sha('old en'), ar: sha('old ar') } },
      ],
    });
  });

  it('refuses a version missing a language, or a file that is not <date>.<en|ar>.json', () => {
    expect(() => termsManifest([{ name: '2026-10-19.en.json', bytes: Buffer.from('x') }])).toThrow(/2026-10-19.*ar/);
    expect(() => termsManifest([{ name: 'draft.en.json', bytes: Buffer.from('x') }])).toThrow(/draft\.en\.json/);
  });
});
