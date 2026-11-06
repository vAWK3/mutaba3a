import { describe, expect, it } from 'vitest';
import { csvDocument, guardFormula } from '../csv.js';

/** MUT-314 test group 7: index.csv's encoding: BOM first, RFC 4180 quoting, CRLF, the formula guard on text only (D17). */
describe('csvDocument (MUT-314)', () => {
  it('starts with the UTF-8 BOM and ends every line with CRLF', () => {
    const doc = csvDocument([['File', 'Ref'], [{ text: 'receipts/E0001-1.pdf' }, { text: 'E0001' }]]);
    expect(doc.charCodeAt(0)).toBe(0xfeff);
    expect(doc.slice(1)).toBe('File,Ref\r\nreceipts/E0001-1.pdf,E0001\r\n');
  });

  it('quotes commas, quotes and line breaks; keeps Arabic, Hebrew and emoji', () => {
    const doc = csvDocument([[{ text: 'a,b' }, { text: 'say "hi"' }, { text: 'two\nlines' }, { text: 'قهوة الصباح' }, { text: 'קפה' }, { text: '☕️' }]]);
    expect(doc.slice(1)).toBe('"a,b","say ""hi""","two\nlines",قهوة الصباح,קפה,☕️\r\n');
  });

  it('guards text that a spreadsheet would run, never an amount', () => {
    const doc = csvDocument([[{ text: '=1+1' }, { text: '+SUM(A1)' }, { text: '-cmd' }, { text: '@x' }, { raw: '-12.50' }]]);
    expect(doc.slice(1)).toBe("'=1+1,'+SUM(A1),'-cmd,'@x,-12.50\r\n");
  });

  it('guardFormula leaves plain text alone and catches a leading tab or carriage return', () => {
    expect(guardFormula('Paper')).toBe('Paper');
    expect(guardFormula('\t=1')).toBe("'\t=1");
    expect(guardFormula('\r=1')).toBe("'\r=1");
  });
});
