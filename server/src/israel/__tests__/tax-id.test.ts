import { describe, expect, it } from 'vitest';
import { normalizeTaxId, registryOf } from '../tax-id.js';

/** MUT-642: an Israeli VAT, company or ID number: 9 digits (shorter ones left-padded) with the check digit. */
describe('normalizeTaxId', () => {
  it.each([
    ['516123452', '516123452'],
    ['000000018', '000000018'],
    ['18', '000000018'],
    [' 51-612345-2 ', '516123452'],
  ] as const)('%j → %s', (input, out) => {
    expect(normalizeTaxId(input)).toBe(out);
  });

  it.each(['516123458', '123456789', '', 'abc', '1234567890'])('refuses %j', (input) => {
    expect(normalizeTaxId(input)).toBeNull();
  });
});

describe('registryOf', () => {
  it.each([
    ['516123452', 'company'],
    ['580000008', 'nonprofit'],
    ['000000018', null],
  ] as const)('%s → %s', (n, kind) => {
    expect(registryOf(n)).toBe(kind);
  });
});
