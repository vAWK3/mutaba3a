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
    expect(merged).toEqual({ ...server, readerVersion: 'phone-1.0', currency: phone.currency, vendorName: phone.vendorName });
    expect(merged.totalMinor).toEqual(server.totalMinor);
    expect(added).toEqual(['currency', 'vendorName']);
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
