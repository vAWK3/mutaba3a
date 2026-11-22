import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import type { UniformFile } from '../export.js';
import { uniformFileReport } from '../report.js';
import { uniformFileZip } from '../zip.js';

/** MUT-569: the download (D7): the OPENFRMT folder with INI.TXT and BKMVDATA.zip, plus the printable report (§2.6 b, appendix 4). */

const file: UniformFile = {
  folder: 'OPENFRMT/51515151.26/11221830',
  ini: Buffer.from('A000\r\n', 'latin1'),
  bkmv: Buffer.from('A100\r\nZ900\r\n', 'latin1'),
  totalRecords: 5,
  recordCounts: [
    { code: 'A100', count: 1 },
    { code: 'C100', count: 2 },
    { code: 'D110', count: 1 },
    { code: 'Z900', count: 1 },
  ],
  byType: [{ docType: 'TAX_INVOICE', count: 2, grossMinor: 123456n }],
};

const meta = {
  businessName: 'סטודיו לדוגמה <בע״מ>',
  vatId: '515151515',
  range: { from: '2026-01-01', to: '2026-12-31' },
  producedAt: new Date('2026-11-22T16:30:00Z'),
  software: { name: 'MTB3A', registrationNumber: '00000000', version: '1.0.0' },
};

describe('uniformFileReport', () => {
  it('lists each record type count and each document type with its count and total, in Arabic', () => {
    const html = uniformFileReport(file, meta, 'ar');
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('OPENFRMT\\51515151.26\\11221830');
    expect(html).toMatch(/C100<\/td>\s*<td[^>]*>[^<]*<\/td>\s*<td[^>]*>2</);
    expect(html).toContain('305');
    expect(html).toContain('فاتورة ضريبية');
    expect(html).toContain('1,234.56');
    expect(html).toContain('22/11/2026 18:30');
  });

  it('escapes the business name and reads left to right in English', () => {
    const html = uniformFileReport(file, meta, 'en');
    expect(html).toContain('dir="ltr"');
    expect(html).toContain('&lt;בע״מ&gt;');
    expect(html).not.toContain('<בע״מ>');
    expect(html).toContain('Tax invoice');
  });

  it('says so when no documents fall in the range', () => {
    const html = uniformFileReport({ ...file, byType: [{ docType: 'TAX_INVOICE', count: 0, grossMinor: 0n }] }, meta, 'en');
    expect(html).toContain('No documents in these dates');
    expect(html).toMatch(/305<\/td><td>Tax invoice<\/td><td class="n">0</);
  });
});

describe('uniformFileZip', () => {
  it('holds INI.TXT and BKMVDATA.zip (with BKMVDATA.TXT) in the folder, and the report', () => {
    const entries = unzipSync(uniformFileZip(file, '<html></html>'));
    expect(Object.keys(entries).sort()).toEqual([
      'OPENFRMT/51515151.26/11221830/BKMVDATA.zip',
      'OPENFRMT/51515151.26/11221830/INI.TXT',
      'report.html',
    ]);
    expect(Buffer.from(entries['OPENFRMT/51515151.26/11221830/INI.TXT']!)).toEqual(file.ini);
    const inner = unzipSync(entries['OPENFRMT/51515151.26/11221830/BKMVDATA.zip']!);
    expect(Object.keys(inner)).toEqual(['BKMVDATA.TXT']);
    expect(Buffer.from(inner['BKMVDATA.TXT']!)).toEqual(file.bkmv);
    expect(strFromU8(entries['report.html']!)).toBe('<html></html>');
  });
});
