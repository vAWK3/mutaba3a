import { describe, expect, it } from 'vitest';
import type { ReceiptSuggestion } from '../../../repositories/ports.js';
import { fillAbsent } from '../merge.js';

/** MUT-441 AC3 and R7: a field already in the suggestion is never changed; only absent fields are filled. */
const server: ReceiptSuggestion = {
  readerVersion: 'server-ocr-paddle-1',
  date: { value: '2026-10-21', source: 'ocr', confidence: 0.9 },
  totalMinor: { value: '1500', source: 'ocr', confidence: 0.88 },
};

describe('fillAbsent', () => {
  it('with nothing stored, takes the incoming suggestion whole', () => {
    expect(fillAbsent(null, server)).toEqual({ merged: server, added: ['date', 'totalMinor'] });
  });

  it('never changes a present field, adds the absent ones, and takes the reader version of the one that added', () => {
    const phone: ReceiptSuggestion = {
      readerVersion: 'phone-1.0',
      totalMinor: { value: '1600', source: 'ocr', confidence: 0.99 },
      currency: { value: 'ILS', source: 'qr', confidence: 1 },
      vendorName: { value: 'Cafe', source: 'vendor', confidence: 0.95 },
    };
    const { merged, added } = fillAbsent(server, phone);
    // The stored total has no currency, so the incoming money group (its currency included) is not taken.
    expect(merged).toEqual({ ...server, readerVersion: 'phone-1.0', vendorName: phone.vendorName });
    expect(merged.totalMinor).toEqual(server.totalMinor);
    expect(added).toEqual(['vendorName']);
  });

  it('adds nothing when every incoming field is already present: the stored suggestion and its reader version stay', () => {
    const same: ReceiptSuggestion = { readerVersion: 'phone-2.0', date: { value: '2026-10-01', source: 'ocr', confidence: 1 } };
    expect(fillAbsent(server, same)).toEqual({ merged: server, added: [] });
  });

  it('an empty incoming suggestion adds nothing, even over nothing stored', () => {
    expect(fillAbsent(server, { readerVersion: 'x' })).toEqual({ merged: server, added: [] });
    expect(fillAbsent(null, { readerVersion: 'x' })).toEqual({ merged: { readerVersion: 'x' }, added: [] });
  });

  it('treats a field set to undefined as absent on either side', () => {
    const stored: ReceiptSuggestion = { readerVersion: 'a', date: undefined };
    const { merged, added } = fillAbsent(stored, { readerVersion: 'b', date: server.date });
    expect(merged).toEqual({ readerVersion: 'b', date: server.date });
    expect(added).toEqual(['date']);
    expect(Object.keys(fillAbsent(server, { readerVersion: 'c', phone: undefined }).merged)).not.toContain('phone');
  });

  it('does not mutate either argument', () => {
    const stored = structuredClone(server);
    const incoming: ReceiptSuggestion = { readerVersion: 'p', email: { value: 'a@b.co', source: 'ocr', confidence: 0.9 } };
    fillAbsent(stored, incoming);
    expect(stored).toEqual(server);
    expect(incoming).toEqual({ readerVersion: 'p', email: { value: 'a@b.co', source: 'ocr', confidence: 0.9 } });
  });
});

/**
 * MUT-441 review: totalMinor and vatMinor are minor units of the currency they were read in (two decimals when no
 * currency was read), so {currency, totalMinor, vatMinor, vatRateBasisPoints} merge as one group, never field by field.
 */
describe('fillAbsent money group', () => {
  const total = (value: string) => ({ value, source: 'ocr' as const, confidence: 0.9 });
  const jod = { value: 'JOD', source: 'ocr' as const, confidence: 0.9 };
  const ils = { value: 'ILS', source: 'ocr' as const, confidence: 0.9 };

  it('a stored total without currency does not take an incoming currency (phone 2-decimal total + server JOD)', () => {
    const phone: ReceiptSuggestion = { readerVersion: 'phone-1', totalMinor: total('1500') };
    const read: ReceiptSuggestion = { readerVersion: 'server-1', currency: jod, totalMinor: total('15000'), vatMinor: total('2000') };
    const { merged, added } = fillAbsent(phone, read);
    expect(merged).toEqual(phone);
    expect(added).toEqual([]);
  });

  it('a stored currency without amounts takes no incoming amounts read in another currency', () => {
    const stored: ReceiptSuggestion = { readerVersion: 'phone-1', currency: jod };
    const read: ReceiptSuggestion = { readerVersion: 'server-1', totalMinor: total('1500'), vatRateBasisPoints: { value: 1600, source: 'ocr', confidence: 0.8 } };
    const { merged, added } = fillAbsent(stored, read);
    expect(merged).toEqual(stored);
    expect(added).toEqual([]);
  });

  it('the same currency fills the absent members of the group', () => {
    const stored: ReceiptSuggestion = { readerVersion: 'phone-1', currency: jod, totalMinor: total('15000') };
    const read: ReceiptSuggestion = { readerVersion: 'server-1', currency: { ...jod, confidence: 0.5 }, totalMinor: total('99000'), vatMinor: total('2000') };
    const { merged, added } = fillAbsent(stored, read);
    expect(merged).toEqual({ readerVersion: 'server-1', currency: jod, totalMinor: total('15000'), vatMinor: total('2000') });
    expect(added).toEqual(['vatMinor']);
  });

  it('differing currencies take nothing from the incoming group, but other fields still fill', () => {
    const stored: ReceiptSuggestion = { readerVersion: 'phone-1', currency: ils, totalMinor: total('1500') };
    const read: ReceiptSuggestion = { readerVersion: 'server-1', currency: jod, vatMinor: total('200'), vendorName: { value: 'Cafe', source: 'vendor', confidence: 0.9 } };
    const { merged, added } = fillAbsent(stored, read);
    expect(merged).toEqual({ ...stored, readerVersion: 'server-1', vendorName: read.vendorName });
    expect(added).toEqual(['vendorName']);
  });

  it('with no stored group, takes the incoming group whole', () => {
    const stored: ReceiptSuggestion = { readerVersion: 'phone-1', date: { value: '2026-10-21', source: 'ocr', confidence: 1 } };
    const read: ReceiptSuggestion = { readerVersion: 'server-1', totalMinor: total('1500'), vatMinor: total('200') };
    const { merged, added } = fillAbsent(stored, read);
    expect(merged).toEqual({ ...stored, readerVersion: 'server-1', totalMinor: read.totalMinor, vatMinor: read.vatMinor });
    expect(added).toEqual(['totalMinor', 'vatMinor']);
  });
});
