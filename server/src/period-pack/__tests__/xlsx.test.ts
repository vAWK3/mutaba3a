import ExcelJS from 'exceljs';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { dateSerial, dateTimeSerial, moneyCell, writeXlsx, type Sheet } from '../xlsx.js';

/**
 * MUT-314 test group 5 (the writer): a zip of well-formed SpreadsheetML parts; read back by exceljs (a test-only
 * reader) to the cells we wrote: numbers with their formats, dates, Arabic, Hebrew and emoji; RTL only when asked; a
 * formula-looking string stays text; control characters are stripped.
 */
const sheet = (over: Partial<Sheet> = {}): Sheet => ({
  name: 'Expenses',
  rtl: false,
  table: true,
  widths: [10, 12, 30, 12],
  rows: [
    ['Ref', 'Date', 'Description', 'Amount'],
    ['E0001', { serial: dateSerial('2026-10-05'), fmt: 'date' }, 'قهوة الصباح ☕️', moneyCell('12.50')],
    ['E0002', { serial: dateSerial('2026-10-31'), fmt: 'date' }, 'קפה בבוקר', moneyCell('12.500')],
    ['E0003', null, '=1+1', moneyCell('9999999999999.99')],
    ['E0004', null, 'bell\u0007 and \u0000nul', { n: '3', fmt: 'int' }],
  ],
  ...over,
});

async function load(bytes: Uint8Array) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  return wb;
}

describe('writeXlsx (MUT-314)', () => {
  it('is a zip whose parts are all well-formed XML', () => {
    const parts = unzipSync(writeXlsx([sheet(), sheet({ name: 'Summary', table: false })]));
    expect(Object.keys(parts).sort()).toEqual(
      ['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml'].sort(),
    );
    for (const [name, bytes] of Object.entries(parts)) {
      const xml = strFromU8(bytes);
      expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'), name).toBe(true);
      expect(xml, name).not.toMatch(/<f>|t="s"|sharedStrings/);
    }
  });

  it('reads back to the cells written: amounts as numbers with 2 or 3 decimals, dates, Arabic, Hebrew, emoji', async () => {
    const ws = (await load(writeXlsx([sheet()]))).getWorksheet('Expenses')!;
    expect(ws.getRow(1).values).toEqual([undefined, 'Ref', 'Date', 'Description', 'Amount']);
    expect(ws.getCell('C2').value).toBe('قهوة الصباح ☕️');
    expect(ws.getCell('C3').value).toBe('קפה בבוקר');
    expect(ws.getCell('D2').value).toBe(12.5);
    expect(ws.getCell('D2').numFmt).toBe('0.00');
    expect(ws.getCell('D3').numFmt).toBe('0.000');
    expect(ws.getCell('D4').value).toBe(9999999999999.99);
    expect(ws.getCell('B2').value).toEqual(new Date('2026-10-05T00:00:00Z'));
    expect(ws.getCell('B2').numFmt).toBe('yyyy-mm-dd');
    expect(ws.getCell('D5').value).toBe(3);
  });

  it('a formula-looking text stays text, and XML-illegal control characters are stripped', async () => {
    const ws = (await load(writeXlsx([sheet()]))).getWorksheet('Expenses')!;
    expect(ws.getCell('C4').value).toBe('=1+1');
    expect(ws.getCell('C4').formula).toBeUndefined();
    expect(ws.getCell('C5').value).toBe('bell and nul');
  });

  it('right to left only when asked; the header row frozen with an autofilter', async () => {
    const wb = await load(writeXlsx([sheet({ name: 'المصروفات', rtl: true }), sheet({ name: 'Summary', table: false })]));
    const ar = wb.getWorksheet('المصروفات')!;
    expect(ar.views[0]).toMatchObject({ rightToLeft: true, state: 'frozen', ySplit: 1 });
    expect(ar.autoFilter).toBe('A1:D5');
    expect(wb.getWorksheet('Summary')!.views[0]?.rightToLeft ?? false).toBe(false);
    expect(ar.getColumn(3).width).toBe(30);
  });

  it('a datetime serial is the wall-clock time in the profile’s timezone', () => {
    // 2026-10-05 09:30 UTC is 12:30 in Jerusalem (UTC+3 in October).
    const serial = dateTimeSerial(new Date('2026-10-05T09:30:00Z'), 'Asia/Jerusalem');
    expect(serial).toBeCloseTo(dateSerial('2026-10-05') + 12.5 / 24, 8);
    expect(dateSerial('1900-03-01')).toBe(61);
  });
});
