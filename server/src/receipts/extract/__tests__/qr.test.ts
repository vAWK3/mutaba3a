import { describe, expect, it } from 'vitest';
import { extractReceipt } from '../extract.js';
import { QR_PARSERS, readQrFields, type QrParser } from '../qr.js';

/** MUT-557 (D6): the QR parser registry. */

const allocationQr: QrParser = (payload) => (payload.startsWith('IL:') ? { allocationNumber: payload.slice(3) } : null);

describe('readQrFields', () => {
  it('no parser is registered until real invoices show a format', () => {
    expect(QR_PARSERS).toEqual([]);
    expect(readQrFields(['IL:304512876'])).toEqual({});
  });
  it('a parser that knows the payload fills its fields as exact QR readings', () => {
    expect(readQrFields(['https://example.com', 'IL:304512876'], [allocationQr])).toEqual({ allocationNumber: { value: '304512876', source: 'qr', confidence: 1 } });
  });
  it('the earlier payload wins a field', () => {
    expect(readQrFields(['IL:111111111', 'IL:222222222'], [allocationQr]).allocationNumber?.value).toBe('111111111');
  });
  it('a receipt without QR payloads reads as before', () => {
    expect(extractReceipt({ lines: [], qr: [] }, { readerVersion: 'x' })).toEqual({ readerVersion: 'x' });
  });
});
