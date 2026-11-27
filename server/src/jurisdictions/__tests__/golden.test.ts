import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { composeDocument } from '../../issuing/compose.js';
import { packFor, registeredCountries } from '../registry.js';
import { PACK_FIXTURES } from './fixtures/index.js';

/**
 * MUT-741 (AC1), per pack since MUT-745: the behaviour-preserving proof. Fixed inputs in, a hash of what comes out, from
 * each pack's fixture. Israel's hashes were recorded on the commit BEFORE its rules moved behind the pack; every later
 * commit must reproduce them. If one changes, a document, number or statutory-file byte changed: fix the code, never the
 * hash (a deliberate rules change is a new pack version).
 */
const sha = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
const plain = (value: unknown): string => JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v));

describe.each(registeredCountries().filter((c) => PACK_FIXTURES[c]))('golden: the %s pack', (country) => {
  const pack = packFor(country);
  const golden = PACK_FIXTURES[country]!.golden;

  describe('composed documents', () => {
    it.each(golden.composed.map((c) => [c.name, c] as const))('%s', (_name, c) => {
      const composed = composeDocument({ pack, docType: c.docType, currency: golden.currency, documentDate: c.date, dealerType: c.dealer, documentDiscountMinor: golden.documentDiscountMinor, pricesIncludeVat: golden.pricesIncludeVat, lines: golden.lines, ...c.extra });
      expect(sha(plain(composed))).toBe(c.sha);
    });
  });

  const files = golden.files?.() ?? [];
  if (files.length > 0) {
    describe('statutory files', () => {
      it.each(files.map((f) => [f.name, f] as const))('%s', (_name, f) => {
        expect(f.actual).toEqual(f.expected);
      });
    });
  }
});
