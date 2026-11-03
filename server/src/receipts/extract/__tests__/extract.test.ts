import { describe, expect, it } from 'vitest';
import type { ReceiptSuggestion } from '../../../repositories/ports.js';
import { ReceiptSuggestionSchema } from '../../../schemas.js';
import { extractReceipt, isConfident, MIN_FIELD_CONFIDENCE, readReceipt } from '../extract.js';
import { isValidIsraeliRegistration } from '../fields.js';
import { foldForMatch, normalizeText } from '../normalize.js';
import { orderedRows } from '../rows.js';
import type { ExtractInput } from '../types.js';
import { receipt, REG_BAD_CHECK_DIGIT, REG_VALID_COMPANY, REG_VALID_DEALER } from './fixtures.js';

const READER = 'server-ocr-test-1';
const read = (input: ExtractInput | ReturnType<typeof receipt>): ReceiptSuggestion => extractReceipt(Array.isArray(input) ? { lines: input } : input, { readerVersion: READER });
const value = <K extends keyof ReceiptSuggestion>(s: ReceiptSuggestion, key: K) => (s[key] as { value: unknown } | undefined)?.value;

/** What a fixture must read as: `undefined` = must be absent. Fields not named are not checked. */
type Expect = Partial<Record<Exclude<keyof ReceiptSuggestion, 'readerVersion'>, string | number | undefined>>;
type Fixture = [name: string, lines: ReturnType<typeof receipt>, expected: Expect];

const HEBREW: Fixture[] = [
  [
    'supermarket: labelled total confirmed by cash − change, shekel sign, d/m/y date with a time',
    receipt(['שופרסל בע"מ', `ח.פ ${REG_VALID_COMPANY}`, 'תאריך: 28/10/2026 14:32', 'לחם 8.90', 'חלב 6.50', 'סה"כ ₪15.40', 'מזומן 20.00', 'עודף 4.60']),
    { totalMinor: '1540', currency: 'ILS', date: '2026-10-28', vendorName: 'שופרסל בע"מ', registrationNo: REG_VALID_COMPANY },
  ],
  [
    'VAT receipt: subtotal + VAT = to pay, rate in basis points, the pre-VAT line is not the total',
    receipt(['קפה גרג', 'סה"כ לפני מע"מ 100.00', 'מע"מ 18% 18.00', 'סה"כ לתשלום 118.00 ש"ח']),
    { totalMinor: '11800', vatMinor: '1800', vatRateBasisPoints: 1800, currency: 'ILS' },
  ],
  ['two-digit year with dots', receipt(['מאפיית אורן', '28.10.26', 'סה"כ 32.00']), { date: '2026-10-28', totalMinor: '3200' }],
  ['Hebrew month name', receipt(['חנות הספרים', '5 בנובמבר 2026', 'לתשלום 49.90']), { date: '2026-11-05', totalMinor: '4990' }],
  ['licensed dealer number with a valid check digit', receipt(['מוסך יוסי', `עוסק מורשה ${REG_VALID_DEALER}`, 'סה"כ 250.00']), { registrationNo: REG_VALID_DEALER }],
  ['a registration number whose check digit fails is left out', receipt(['מוסך יוסי', `ע.מ ${REG_BAD_CHECK_DIGIT}`, 'סה"כ 250.00']), { registrationNo: undefined, totalMinor: '25000' }],
  ['phone after its label', receipt(['פיצה רומא', 'טל: 03-1234567', 'סה"כ 64.00']), { phone: '03-1234567' }],
  [
    'right-to-left row: the label box on the right, the amount box on the left',
    receipt(['פלאפל הזהב', [{ text: '42.00', x: 20 }, { text: 'סה"כ', x: 300, script: 'hebr' }], 'NIS']),
    { totalMinor: '4200', currency: 'ILS' },
  ],
  [
    'an unsure total line is left out; the sure date stays',
    receipt(['קיוסק', 'תאריך 01/09/2026', { text: 'סה"כ 12.00', conf: 0.4 }]),
    { totalMinor: undefined, date: '2026-09-01' },
  ],
];

const ARABIC: Fixture[] = [
  [
    'Arabic-Indic digits in the date and the total, shekel in Arabic',
    receipt(['مخبز القدس', 'التاريخ: ٢٨/١٠/٢٠٢٦', 'المجموع ١٢٫٥٠ شيكل']),
    { date: '2026-10-28', totalMinor: '1250', currency: 'ILS', vendorName: 'مخبز القدس' },
  ],
  ['Persian digits, year first', receipt(['صيدلية النور', 'تاريخ ۲۰۲۶-۱۰-۰۵', 'الإجمالي ۴۵٫۰۰']), { date: '2026-10-05', totalMinor: '4500' }],
  ['dinars: three decimals and the د.أ marker', receipt(['سوبرماركت عمان', 'الإجمالي 12.500 د.أ']), { totalMinor: '12500', currency: 'JOD' }],
  ['month name without its hamza', receipt(['مطعم الياسمين', '28 اكتوبر 2026', 'المجموع 80.00']), { date: '2026-10-28' }],
  ['Levantine month name', receipt(['مكتبة الشروق', '3 تشرين الأول 2026', 'المجموع 15.00']), { date: '2026-10-03' }],
  [
    'right-to-left row with the amount box on the left',
    receipt(['مقهى الزيتون', [{ text: '15.00', x: 10 }, { text: 'الإجمالي', x: 280, script: 'arab' }]]),
    { totalMinor: '1500' },
  ],
  [
    'subtotal + VAT = total; the subtotal line is not the total',
    receipt(['شركة الأمل للتجارة', 'المجموع الفرعي 50.00', 'ضريبة القيمة المضافة 16% 8.00', 'الإجمالي 58.00']),
    { totalMinor: '5800', vatMinor: '800', vatRateBasisPoints: 1600, vendorName: 'شركة الأمل للتجارة' },
  ],
  [
    'no total label: cash − change gives it',
    receipt(['بقالة السلام', 'خبز 40.00', 'حليب 36.50', 'نقدا 100.00', 'الباقي 23.50']),
    { totalMinor: '7650' },
  ],
  ['dirhams (د.إ, one alef away from د.أ) are not a currency the app takes', receipt(['متجر دبي', 'المجموع 50.00 د.إ']), { currency: undefined, totalMinor: '5000' }],
  ['licensed dealer number in Arabic, and a phone', receipt(['كراج أبو علي', `مشتغل مرخص ${REG_VALID_DEALER}`, 'هاتف: 02-2981234', 'المجموع 300.00']), { registrationNo: REG_VALID_DEALER, phone: '02-2981234' }],
];

const ENGLISH: Fixture[] = [
  [
    'café: company suffix vendor, ISO date, dollar total',
    receipt(['ACME COFFEE LTD', 'Date: 2026-10-28', 'Latte 4.50', 'Total $4.50']),
    { vendorName: 'ACME COFFEE LTD', date: '2026-10-28', totalMinor: '450', currency: 'USD' },
  ],
  ['amount due in euros', receipt(['Bistro Verde', 'Amount due € 23.80']), { totalMinor: '2380', currency: 'EUR' }],
  [
    'subtotal, VAT and total add up',
    receipt(['Hardware Store', 'Subtotal 10.00', 'VAT 17% 1.70', 'Total 11.70', 'Card 11.70']),
    { totalMinor: '1170', vatMinor: '170', vatRateBasisPoints: 1700 },
  ],
  ['month-first English date', receipt(['Book Nook', 'Oct 28, 2026', 'Total 12.00']), { date: '2026-10-28' }],
  ['day-month-year English date', receipt(['Book Nook', '28 October 2026', 'Total 12.00']), { date: '2026-10-28' }],
  ['a day past 12 in the middle reads as month/day', receipt(['Deli', '10/28/2026', 'Total 7.25']), { date: '2026-10-28' }],
  ['email, lowercased', receipt(['Print Shop', 'Info@PrintShop.co.il', 'Total 30.00']), { email: 'info@printshop.co.il' }],
  ['items only: no label and no arithmetic, so no total', receipt(['Market', 'Apples 3.20', 'Bread 7.10']), { totalMinor: undefined }],
  ['an impossible date is left out', receipt(['Market', '31/02/2026', 'Total 5.00']), { date: undefined, totalMinor: '500' }],
  ['a currency the app does not support is left out', receipt(['Riyadh Mart', 'Total 40.00 SAR']), { currency: undefined, totalMinor: '4000' }],
];

function check(fixtures: Fixture[]) {
  it.each(fixtures)('%s', (_name, lines, expected) => {
    const s = read(lines);
    for (const [key, want] of Object.entries(expected)) expect([key, value(s, key as keyof ReceiptSuggestion)]).toEqual([key, want]);
    expect(ReceiptSuggestionSchema.parse(s)).toEqual(s);
    expect(s.readerVersion).toBe(READER);
    for (const field of Object.values(s)) if (typeof field === 'object') expect(field.confidence).toBeGreaterThanOrEqual(MIN_FIELD_CONFIDENCE);
  });
}

describe('extractReceipt (MUT-441)', () => {
  describe('Hebrew', () => check(HEBREW));
  describe('Arabic', () => check(ARABIC));
  describe('English', () => check(ENGLISH));

  it('marks every field it read from OCR lines as ocr', () => {
    const s = read(receipt(['ACME LTD', 'Date: 2026-10-28', 'Total $4.50']));
    expect(Object.values(s).filter((f) => typeof f === 'object').map((f) => f.source)).toEqual(expect.arrayContaining(['ocr']));
    expect(new Set(Object.values(s).filter((f) => typeof f === 'object').map((f) => f.source))).toEqual(new Set(['ocr']));
  });

  it("reads a PDF's text layer as pdf-text, at full confidence of the text, ignoring OCR lines", () => {
    const s = read({ pdfText: 'Bistro Verde LTD\nDate: 2026-10-28\nTotal € 23.80\n', lines: receipt(['Something else', 'Total 1.00']) });
    expect(s).toMatchObject({ totalMinor: { value: '2380', source: 'pdf-text' }, currency: { value: 'EUR', source: 'pdf-text' }, date: { value: '2026-10-28', source: 'pdf-text' } });
  });

  it('finds the PDF reordered lam-meem ligature label (MUT-253 spike quirk)', () => {
    expect(value(read({ pdfText: `كراج\nرقم املشتغل ${REG_VALID_DEALER}\nالمجموع 10.00` }), 'registrationNo')).toBe(REG_VALID_DEALER);
  });

  it('a labelled total the arithmetic confirms is surer than one it does not', () => {
    const confirmed = read(receipt(['Shop', 'Subtotal 10.00', 'VAT 17% 1.70', 'Total 11.70']));
    const alone = read(receipt(['Shop', 'Total 11.70']));
    expect(confirmed.totalMinor!.confidence).toBeGreaterThan(alone.totalMinor!.confidence);
  });

  it('a date after its label is surer than a bare one', () => {
    const labelled = read(receipt(['Shop', 'Date: 28/10/2026', 'Total 1.00']));
    const bare = read(receipt(['Shop', '28/10/2026', 'Total 1.00']));
    expect(labelled.date!.confidence).toBeGreaterThan(bare.date!.confidence);
  });

  it('three decimals with no currency named are not guessed into minor units', () => {
    expect(value(read(receipt(['Shop', 'Total 12.500'])), 'totalMinor')).toBeUndefined();
  });

  it('reads nothing from nothing', () => {
    expect(read({ lines: [] })).toEqual({ readerVersion: READER });
    expect(read({ pdfText: '   ' })).toEqual({ readerVersion: READER });
  });
});

/** MUT-441 task 8: where the benchmark's misses clustered on the synthetic set, as minimal receipts. */
describe('benchmark failure clusters', () => {
  it('reads the Arabic comma between digits as the decimal point (the recogniser prints ٫ as ،)', () => {
    const s = read(receipt(['سوبرماركت النور', 'المجموع الفرعي ٧٤،٧٤', 'ضريبة القيمة المضافة %16 ١١،٩٦', 'الإجمالي ٨٦،٧٠']));
    expect(value(s, 'totalMinor')).toBe('8670');
    expect(value(s, 'vatMinor')).toBe('1196');
  });

  it('never fills a bare integer as money when the receipt prints its amounts with decimals (a lost decimal point)', () => {
    const s = read(receipt(['مطعم', 'المجموع الفرعي 93.83', 'ضريبة القيمة المضافة %16 15001', 'المبلغ الإجمالي شيكل 108084', 'نقداً 130.00', 'الباقي 2116']));
    expect(value(s, 'totalMinor')).toBeUndefined();
    expect(value(s, 'vatMinor')).toBeUndefined();
  });

  it('still reads a bare integer total on a receipt that prints no decimals at all', () => {
    expect(value(read(receipt(['Shop', 'Total ₪ 120'])), 'totalMinor')).toBe('12000');
  });

  it('a total-labelled amount that another one equals plus the VAT is the subtotal, not the total (subtotal label misread)', () => {
    const s = read(receipt(['مقهى', { text: 'المجموع الفرمي 173.19', conf: 0.92 }, 'ضريبة القيمة المضافة 25.98', { text: 'الإجمالي 199.17', conf: 0.8 }]));
    expect(value(s, 'totalMinor')).toBe('19917');
    // The VAT's own label misread too: the VAT amount is still printed on the receipt.
    const unlabelled = read(receipt(['سوبرماركت', { text: 'المجموع القرعي 74.74', conf: 0.88 }, 'ضريية القيمة المضاقة %17 11.96', { text: 'الإجمالي 86.70', conf: 0.7 }]));
    expect(value(unlabelled, 'totalMinor')).toBe('8670');
  });

  it('a receipt whose every amount has three decimals and that names no currency is in dinars (the one three-decimal currency the API takes)', () => {
    const s = read(receipt(['سامح مول', 'المجموع الفرعي 226.474', 'ضريبة القيمة المضافة %16 36.236', 'المجموع دينان 262.710', 'نقداً 270.000', 'الباقي 7.290']));
    expect(value(s, 'currency')).toBe('JOD');
    expect(value(s, 'totalMinor')).toBe('262710');
  });

  it('three decimals are not enough when the receipt names a currency the API does not take, or prints two-decimal amounts too', () => {
    const kwd = read(receipt(['Shop', 'Subtotal 10.000', 'VAT 1.000', 'Total KWD 11.000']));
    expect(value(kwd, 'currency')).toBeUndefined();
    expect(value(kwd, 'totalMinor')).toBeUndefined();
    const mixed = read(receipt(['Shop', 'Coffee 2.50', 'Subtotal 10.000', 'VAT 1.000', 'Total 11.000']));
    expect(value(mixed, 'currency')).toBeUndefined();
  });
});

/**
 * MUT-504: what 16 real scans showed (2026-10-29 bench), as synthetic rows that reproduce each pattern. No real
 * receipt's text is here: the shapes are, with made-up shops and amounts.
 */
describe('real receipt patterns (MUT-504)', () => {
  it('reads a sure date on a row that also holds a junk box (a field takes its own box\'s confidence, not the row\'s worst)', () => {
    const s = read(receipt(['מכולת הגפן', [{ text: '11/12/25 12:50', x: 10, conf: 0.99 }, { text: 'ae Wt?', x: 250, conf: 0.2 }], 'סה"כ 9.90']));
    expect(value(s, 'date')).toBe('2025-12-11');
  });

  it('a labelled amount still needs its label to be read surely', () => {
    const s = read(receipt(['Shop', [{ text: '9.90', x: 10, conf: 0.99 }, { text: 'סה"כ', x: 300, conf: 0.3, script: 'hebr' }]]));
    expect(value(s, 'totalMinor')).toBeUndefined();
  });

  const tollBill = (issueConf: number) =>
    receipt([
      'חשבון לשירותי כביש אגרה',
      { text: 'תאריך הפקת החשבונית 20/08/2026', conf: issueConf },
      { text: 'תקופת החשבונית 20/07/26-19/08/26', conf: 0.9 },
      'תשלומים עבור נסיעות 63.60',
      'סה"כ סכומים ב-18% מצ"מ 63.60',
      'סה"כ מצ"מ 11.45',
      { text: 'תוקף כרטיס האשראי הוארך עד 01/06/2029', conf: 0.95 },
      { text: 'חשבונית קודמת שולמה בכרטיס ביום 21/07/2026', conf: 0.9 },
    ]);

  it('a toll bill: the issue date over a billing period, a card validity date and an older payment; subtotal + VAT is the total (מע"מ read as מצ"מ)', () => {
    const s = read(tollBill(0.7));
    expect(value(s, 'date')).toBe('2026-08-20');
    expect(value(s, 'totalMinor')).toBe('7505');
    expect(value(s, 'vatMinor')).toBe('1145');
  });

  it('leaves the date empty when its label is unsure and the unlabelled dates disagree', () => {
    expect(value(read(tollBill(0.4)), 'date')).toBeUndefined();
  });

  it('a date range is a period, never the receipt\'s date', () => {
    expect(value(read(receipt(['Utility Co', 'Period 01/09/2026-30/09/2026', 'Total 40.00'])), 'date')).toBeUndefined();
  });

  it('two unlabelled readings of the same day still agree', () => {
    expect(value(read(receipt(['מכולת', '11/12/2025 12:49', 'סה"כ 5.00', '11/12/25 12:50'])), 'date')).toBe('2025-12-11');
  });

  it('a till receipt whose to-pay label OCR lost: the largest amount, printed on three rows, is the total', () => {
    const s = read(
      receipt(['מחסני הגפן', 'ביצים 13.13', 'גבינה 19.90', 'לחם 15.90', 'סבון 12.90', [{ text: '61.83', x: 10 }, { text: ':0.0 תיז', x: 300, conf: 0.1, script: 'hebr' }], 'שראכרט 61.83', 'Bs ~ 0190 עשקה: 61.83']),
    );
    expect(value(s, 'totalMinor')).toBe('6183');
  });

  it('the largest amount read three times on one row (OCR joined the to-pay rows) is the total; one amount printed many times does not out-vote the arithmetic', () => {
    const s = read(receipt(['מחסני הגפן', 'לחם 21.90', 'גבינה 15.90', { text: '189.50 189.50 189.50 ny cit', conf: 0.95 }, 'חייב במע"מ 160.59', 'מע"מ 28.91', 'Bs ~ 0190 עסקה: 189.50']));
    expect(value(s, 'totalMinor')).toBe('18950');
    const voted = read(receipt(['Shop', 'Item 160.59', 'Fee 28.91', '189.50', '189.50', 'Card 189.50 ref']));
    expect(value(voted, 'totalMinor')).not.toBe('16059');
  });

  it('the largest amount, printed twice, that two other printed amounts add up to is the total (subtotal and VAT labels garbled)', () => {
    const s = read(receipt(['MAX', 'פלסטלינה 4.00', 'זיב מ"מ 464.24', '83.56 מע" %', 'שואי 547.80', 'ש"ת 547.80 0130']));
    expect(value(s, 'totalMinor')).toBe('54780');
  });

  it('an unsure total from an earlier rule does not keep out a sure one from a later rule', () => {
    const unsure = 0.5;
    const s = read(
      receipt([
        'MAX',
        { text: 'מדבקות 2.00', conf: unsure },
        { text: 'צבעים 4.00', conf: unsure },
        { text: 'מספריים 6.00', conf: unsure },
        { text: 'דבק 8.00', conf: unsure },
        'זיב מ"מ 464.24',
        '83.56 מע" %',
        'שואי 547.80',
        'ש"ת 547.80 0130',
      ]),
    );
    expect(value(s, 'totalMinor')).toBe('54780');
  });

  it('the subtotal plus another printed amount is a printed total whose label OCR lost (the VAT label lost too)', () => {
    const s = read(receipt(['חשבון לשירותי כביש אגרה', 'סה"כ סכומים ב-18% מצ"מ 97.92', 'סה ויל 17.63', 'ס"כ כולל מע" 115.55', 'חשבונית קודמת בסך 75.05 שולמה']));
    expect(value(s, 'totalMinor')).toBe('11555');
  });

  it('a VAT line OCR joined with the total line: the VAT is the smaller amount, subtotal + VAT the total', () => {
    const s = read(receipt(['חשבון לשירותי כביש אגרה', 'סה"כ סכומים ב-18% מצ"מ 27.76', 'סה"כ מע"מ 5.00 32.76']));
    expect(value(s, 'vatMinor')).toBe('500');
    expect(value(s, 'totalMinor')).toBe('3276');
  });

  it('a document that prints a billing period is a bill: only a labelled date is its date, never a trip\'s', () => {
    const s = read(receipt(['חשבון לשירותי כביש אגרה', 'תקופת החשבונית 20/05/26-19/07/26', '27.76 13:46:03 16/06/2026 36547601', 'סה"כ 27.76']));
    expect(value(s, 'date')).toBeUndefined();
  });

  it('a statement (total-labelled lines with three different amounts) has no single total', () => {
    const s = read(
      receipt(['קופת חולים', 'סה"כ חיוב כרטיס אשראי בתאריך 02/12/2025 118.29', 'סה"כ חיוב כרטיס אשראי בתאריך 02/01/2026 121.08', 'סה"כ חיוב כרטיס אשראי בתאריך 02/05/2026 154.08']),
    );
    expect(value(s, 'totalMinor')).toBeUndefined();
  });

  describe('pre-landing review: never a wrong total or date (MUT-504)', () => {
    it('a looser rule never replaces an unsure labelled total with a different amount', () => {
      const s = read(receipt(['Shop Ltd', 'Coffee 10.00', 'Cake 20.00', 'Sandwich 30.00', 'Salad 50.00', { text: 'Total 110.00', conf: 0.7 }]));
      expect(value(s, 'totalMinor')).toBeUndefined();
    });

    it('a discounted receipt never takes the pre-discount amount as its total', () => {
      expect(value(read(receipt(['Shop', 'Shirt 100.00', 'Subtotal 100.00', 'Discount -10.00', 'T0taI 90.00', 'Visa 90.00'])), 'totalMinor')).not.toBe('10000');
      expect(value(read(receipt(['Shop', 'Shirt 100.00', 'Subtotal 100.00', 'Discount -10.00', { text: 'Total 90.00', conf: 0.62 }])), 'totalMinor')).not.toBe('10000');
    });

    it('cash tendered, printed three times, is never the total', () => {
      expect(value(read(receipt(['Shop', 'Total', 'Item 187.50', 'Cash 200.00', 'Tendered 200.00', 'Paid 200.00'])), 'totalMinor')).toBeUndefined();
    });

    it('an amount printed twice on one row (quantity × price) is not "printed twice"', () => {
      const s = read({ pdfText: 'Shop\n1 x 120.00 120.00\n1 x 20.00 20.00\n1 x 100.00 100.00\nTotal 24000' });
      expect(value(s, 'totalMinor')).toBeUndefined();
    });

    it("a VAT row keeps its last amount: a rate whose % OCR dropped is not the VAT", () => {
      const s = read(receipt(['חנות', 'סכום ביניים 158.90', 'מע"מ 18.00 28.60', 'סה"כ 187.50']));
      expect(value(s, 'vatMinor')).toBe('2860');
    });

    it('a price after a day and a month abbreviation is not a two-digit year', () => {
      expect(value(read(receipt(['Shop', 'Total 10.00', '2 may 12.50'])), 'date')).toBeUndefined();
      expect(value(read(receipt(['Shop', '3 יונ 26.50', 'Total 26.50'])), 'date')).toBeUndefined();
    });

    it('two card slips with different amounts (a split payment) give no total', () => {
      expect(value(read(receipt(['מחסני הגפן', 'סכום עסקה 100.00', 'סכום עסקה 87.50'])), 'totalMinor')).toBeUndefined();
    });

    it('a due date is never the receipt\'s date, and two labelled dates that differ give none', () => {
      expect(value(read(receipt(['Shop', 'Due date 12/11/2026', 'Invoice date 12/10/2026', 'Total 5.00'])), 'date')).toBe('2026-10-12');
      expect(value(read(receipt(['Shop', 'Date 12/11/2026', 'Date 12/10/2026', 'Total 5.00'])), 'date')).toBeUndefined();
    });

    it("an exempt line (amounts at 0% VAT) is not the subtotal", () => {
      const s = read(receipt(['חשבון', 'סכומים ב-0% מע"מ 40.00', 'סה"כ מע"מ 7.20']));
      expect(value(s, 'totalMinor')).toBeUndefined();
    });

    it('a discount total is not a total, so an ordinary receipt is not taken for a statement', () => {
      expect(value(read(receipt(['חנות', 'סה"כ 120.00', 'סה"כ הנחה 20.00', 'סה"כ לתשלום 100.00', 'אשראי 100.00'])), 'totalMinor')).toBe('10000');
    });

    it('when the first name-like row is too long, no vendor is guessed from the rows under it', () => {
      expect(value(read(receipt(['TU KN FY )1997( בע"מ 9°N) 512475203( ודרך NCW ₪ הנסיעות נקלטות במערכות לאחר מספר ימים', 'רחוב הרצל 5', 'סה"כ 10.00'])), 'vendorName')).toBeUndefined();
    });

    it('a receipt with thousands of amounts reads in well under a second', () => {
      const lines = Array.from({ length: 3000 }, (_, i) => `Item ${i} ${(i + 1).toFixed(2)}`);
      const started = Date.now();
      read({ pdfText: ['Shop', ...lines, 'Total 99999.00'].join('\n') });
      expect(Date.now() - started).toBeLessThan(1000);
    });
  });

  it('an amount printed three times is not the total when a larger amount is printed', () => {
    expect(value(read(receipt(['Shop', 'Pen 5.90', 'Pen 5.90', 'Pen 5.90', 'Book 20.00'])), 'totalMinor')).toBeUndefined();
  });

  it('the card transaction amount (סכום עסקה) is the total', () => {
    expect(value(read(receipt(['מחסני הגפן', 'לחם 15.90', 'חלב 6.50', 'סכום עסקה: 22.40'])), 'totalMinor')).toBe('2240');
  });

  it.each([
    ['17-פבר-26', '2026-02-17'],
    ["5 נוב' 2026", '2026-11-05'],
    ['17-Feb-26', '2026-02-17'],
  ])('reads %s', (printed, want) => expect(value(read(receipt(['Shop', printed, 'Total 1.00'])), 'date')).toBe(want));

  it('folds the VAT misread מצ"מ back to מע"מ for matching, and leaves a company form (בע"מ) alone', () => {
    expect(foldForMatch('סה"כ מצ"מ 11.45')).toBe('סה"כ מע"מ 11.45');
    expect(foldForMatch('שופרסל בע"מ')).toBe('שופרסל בע"מ');
  });

  it('a long first row (two columns OCR joined) is not the vendor, even with a company form in it', () => {
    const s = read(receipt(['TU KN FY )1997( בע"מ 9°N) 512475203( ודרך NCW ₪ הנסיעות נקלטות במערכות לאחר מספר ימים', 'סה"כ 10.00']));
    expect(value(s, 'vendorName')).toBeUndefined();
  });
});

describe('the confidence threshold (AC2)', () => {
  it('keeps a field exactly at the threshold and drops one just under it', () => {
    expect(isConfident(MIN_FIELD_CONFIDENCE)).toBe(true);
    expect(isConfident(MIN_FIELD_CONFIDENCE - 0.01)).toBe(false);
    expect(isConfident(1)).toBe(true);
  });

  it('the same total line is kept when the reader was sure and dropped when it was not', () => {
    const at = (conf: number) => read(receipt(['Shop', { text: 'Total 9.90', conf }]));
    expect(value(at(0.95), 'totalMinor')).toBe('990');
    expect(value(at(0.5), 'totalMinor')).toBeUndefined();
  });
});

describe('normalizeText', () => {
  it('folds Arabic-Indic and Persian digits, the Arabic decimal and thousands marks, bidi marks and tatweel', () => {
    expect(normalizeText('٠١٢٣٤٥٦٧٨٩ ۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789 0123456789');
    expect(normalizeText('١٬٢٣٤٫٥٠')).toBe('1,234.50');
    expect(normalizeText('‏المجمـــوع‎')).toBe('المجموع');
  });

  it('turns an Arabic comma between digits into the decimal point, and leaves a listing comma alone', () => {
    expect(normalizeText('٤٤،٠٦')).toBe('44.06');
    expect(normalizeText('17،750')).toBe('17.750');
    expect(normalizeText('1، 2')).toBe('1، 2');
  });
});

describe('orderedRows', () => {
  it('joins boxes on one row, right to left for a right-to-left row and left to right otherwise, rows top to bottom', () => {
    const rows = orderedRows(receipt([[{ text: '42.00', x: 20 }, { text: 'סה"כ', x: 300 }], [{ text: 'Total', x: 10 }, { text: '9.90', x: 300 }]]).reverse());
    expect(rows.map((r) => r.text)).toEqual(['סה"כ 42.00', 'Total 9.90']);
  });
});

describe('isValidIsraeliRegistration', () => {
  it.each([
    [REG_VALID_COMPANY, true],
    [REG_VALID_DEALER, true],
    ['000000018', true],
    [REG_BAD_CHECK_DIGIT, false],
    ['12345678', false],
    ['000000000', false],
  ])('%s → %s', (digits, valid) => expect(isValidIsraeliRegistration(digits)).toBe(valid));
});

/**
 * MUT-514: what 32 more real scans and three production Paz receipts showed (2026-10-29 to 11-02), as synthetic rows.
 * Each case is one pattern that filled a wrong field with confidence; an empty field is the safe answer. No real
 * receipt's text, number or name is here.
 */
describe('MUT-514: no confidently wrong fields', () => {
  const readWith = (lines: ReturnType<typeof receipt>, options: { receivedOn?: string; buyerIds?: readonly string[] }) => extractReceipt({ lines }, { readerVersion: READER, ...options });

  describe('VAT (V1–V4): filled only when something independent of it confirms it', () => {
    it.each([["לפנ'"], ['לפנ׳'], ['לפנ’']])('the OCR-misread "before VAT" row (%s, amount glued on) is the subtotal, and VAT is total − subtotal even when the VAT row is misread', (before) => {
      const s = read(receipt(['תחנת דלק הגליל', `סה"כ ${before} מע"מ149.47 ש"ח`, 'מע"מ להוצ רכב 26.98', 'סה"כ לתשלום 176.37']));
      expect(value(s, 'totalMinor')).toBe('17637');
      expect(value(s, 'vatMinor')).toBe('2690');
    });

    it('a Paz-shaped fuel receipt (production replica): the glued before-VAT row, a misread VAT row next to it, the to-pay row', () => {
      const s = read(receipt(['פז חברת נפט בע"מ', 'משאבה: 3', 'סה"כ לפנ\' מע"מ265.38 ש"ח', 'מע"מ להוצ רכב 47.71', 'סה"כ לתשלום 313.15']));
      expect(value(s, 'totalMinor')).toBe('31315');
      expect(value(s, 'vatMinor')).toBe('4777');
    });

    it('a fuel receipt with no total: subtotal + a misread VAT is never filled as the total, and the VAT stays empty', () => {
      const s = read(receipt(['תחנת דלק הגליל', 'סה"כ לפנ\' מע"מ149.47 ש"ח', 'מע"מ להוצ רכב 26.98']));
      expect(value(s, 'totalMinor')).toBeUndefined();
      expect(value(s, 'vatMinor')).toBeUndefined();
    });

    it('"Total to VAT" is the amount before VAT, and the VAT is what the total adds to it at the rate', () => {
      const s = read(receipt(['Center Shop', '334.75 :Total to VAT', '395.00 :Sum Total inc. Tax', 'Total 395 nis']));
      expect(value(s, 'vatMinor')).toBe('6025');
      expect(value(s, 'totalMinor')).toBe('39500');
    });

    it('the total printed on a VAT-labelled row is not the VAT', () => {
      const s = read(receipt(['חניון העיר', 'NIS123.60 (VAT)', 'חוייב ב : 123.60']));
      expect(value(s, 'vatMinor')).toBeUndefined();
    });

    it('a VAT over 20% of the total, or that no rate or subtraction confirms, is never filled', () => {
      expect(value(read(receipt(['Shop', 'VAT 30.00', 'Total ₪100.00'])), 'vatMinor')).toBeUndefined();
      expect(value(read(receipt(['Shop', 'Subtotal 70.00', 'VAT 30.00', 'Total 100.00'])), 'vatMinor')).toBeUndefined();
      // No rate printed and none known for dollars.
      expect(value(read(receipt(['Shop', 'VAT 15.00', 'Total $100.00'])), 'vatMinor')).toBeUndefined();
    });

    it("a read VAT the shekel's rate confirms on a labelled total is filled", () => {
      expect(value(read(receipt(['קפה הנמל', 'מע"מ 18.00', 'סה"כ ₪118.00'])), 'vatMinor')).toBe('1800');
    });

    it('one OCR digit in the VAT: total − subtotal at the rate gives it instead (V4)', () => {
      const s = read(receipt(['תחנת דלק', 'סה"כ לפני מע"מ 227.05', 'מע"מ 49.87', 'סה"כ לתשלום ₪267.92']));
      expect(value(s, 'vatMinor')).toBe('4087');
      expect(value(s, 'totalMinor')).toBe('26792');
    });

    it('a service charge is not VAT: total − subtotal that no rate gives stays empty (R2)', () => {
      const s = read(receipt(['Bistro', 'Subtotal ₪100.00', 'Service charge 12.00', 'Total ₪112.00']));
      expect(value(s, 'vatMinor')).toBeUndefined();
      expect(value(s, 'totalMinor')).toBe('11200');
    });

    it('a VAT row OCR joined with the subtotal row: its other amount plus the VAT is the labelled total, which confirms it', () => {
      const s = read(receipt(['مطعم الحارة', 'خبز 50.00', 'المجموع ضريبة القيمة المضافة الفرعي 150.42 24.07', 'المجموع 174.49', 'نقداً 180.00', 'الباقي 5.51']));
      expect(value(s, 'vatMinor')).toBe('2407');
      expect(value(s, 'totalMinor')).toBe('17449');
    });

    it('a 16% shekel VAT is taken only when the receipt prints 16% (OV-9)', () => {
      expect(value(read(receipt(['מוסך', 'סה"כ לפני מע"מ 100.00', 'סה"כ ₪116.00'])), 'vatMinor')).toBeUndefined();
      expect(value(read(receipt(['مكتبة', 'المجموع الفرعي 100.00', 'ضريبة القيمة المضافة 16% 16.00', 'الإجمالي 116.00 شيكل'])), 'vatMinor')).toBe('1600');
    });
  });

  describe('totals (T1–T3): tips, instalments, cash and change are never the total', () => {
    it('cash 100 / change 30 / total 70 gives 70, never the difference with the amount paid (T2)', () => {
      expect(value(read(receipt(['Cafe', 'Latte 15.00', 'Cake 55.00', 'סה"כ שולם 70.00 ₪', 'עודף -30.00', '100.00'])), 'totalMinor')).toBe('7000');
      expect(value(read(receipt(['Shop', 'Total 70.00', 'Cash 100.00', 'Change 30.00'])), 'totalMinor')).toBe('7000');
    });

    it('a tip line, even printed three times, is never the total (T3)', () => {
      expect(value(read(receipt(['Grill House', 'Kebab 271.00', 'תשר 41.00', 'סה"כ לתשלום 312.00'])), 'totalMinor')).toBe('31200');
      expect(value(read(receipt(['Grill House', 'Kebab 271.00', 'Salad 58.00', 'Wine 99.00', 'תשר 41.00', 'תשר 41.00', 'tip 41.00'])), 'totalMinor')).not.toBe('4100');
    });

    it('with every label lost, a tip two amounts differ by twice and a card total printed on three rows disagree: no total', () => {
      const s = read(receipt(['Grill', 'kb 271.00', 'sl 58.00', 'wn 99.00', 'x 41.00', 'y 41.00', 'z 41.00', 'pq 312.00', 'rs 312.00', 'Isracard 312.00']));
      expect(value(s, 'totalMinor')).toBeUndefined();
    });

    it('instalment parts are never the total; a single-payment count does not hide the card slip (OV-7)', () => {
      expect(value(read(receipt(['Store', 'תשלום ראשון 400.00', 'תשלום נוסף 400.00', 'תשלום נוסף 400.00'])), 'totalMinor')).toBeUndefined();
      expect(value(read(receipt(['Store', 'TV 1200.00', 'תשלומים: 3', 'תשלום ראשון 400.00', 'סכום עסקה 1200.00'])), 'totalMinor')).toBe('120000');
      expect(value(read(receipt(['מחסני הגפן', 'לחם 15.90', 'חלב 6.50', "מס' תשלומים: 1", 'סכום עסקה: 22.40'])), 'totalMinor')).toBe('2240');
    });

    it('a misread labelled total loses to a labelled balance the arithmetic confirms (T1)', () => {
      expect(value(read(receipt(['Toner House', 'Printer 1050.00', 'חיוב 1050.00', 'סה"כ ש"ח 4050.00', 'יתרה: 1239.00'])), 'totalMinor')).toBe('123900');
    });

    it('agorot rounding never flips a labelled total the rate confirms (OV-6)', () => {
      expect(value(read(receipt(['Shop', 'סה"כ לפני מע"מ 100.00', 'עיגול 0.40', 'סה"כ לתשלום ₪118.40', 'יתרה 118.00'])), 'totalMinor')).toBe('11840');
    });
  });

  describe('bill-to (B1, B2): the customer\'s details are never the vendor\'s', () => {
    const BUYER_PHONE = '052-9876543';

    it('a "לכבוד" block: its ע.מ and phone are not the vendor\'s', () => {
      const s = read(receipt(['טונר הבית', `לכבוד מספר לקוח: 13015 ע.מ.: ${REG_VALID_COMPANY}`, 'משרד עורכי דין', "רח' הגפן 10", `טל.: ${BUYER_PHONE}`, 'מדפסת 100.00', 'סה"כ 100.00']));
      expect(value(s, 'registrationNo')).toBeUndefined();
      expect(value(s, 'phone')).toBeUndefined();
    });

    it("the customer's phone printed again outside the block (טל' לקוח) is not the vendor's phone", () => {
      const s = read(receipt(['חנות מחשבים', `טלפון: ${BUYER_PHONE}`, 'מקלדת 699.00', 'סה"כ 699.00', '* שם לקוח: ישראל ישראלי', `* טל' לקוח: ${BUYER_PHONE}`]));
      expect(value(s, 'phone')).toBeUndefined();
    });

    it.each([['السيد/ة'], ['السيداة']])('an Arabic %s block: the mobile under it is not the vendor\'s', (label) => {
      const s = read(receipt(['شركة النور للتجارة', `${label} محمد علي`, `هاتف خلوي ${BUYER_PHONE.replace('-', '')}`, 'المجموع 100.00']));
      expect(value(s, 'phone')).toBeUndefined();
      expect(value(s, 'vendorName')).toBe('شركة النور للتجارة');
    });

    it("a number the organization's receipts showed as the buyer's (buyerIds) is never filled", () => {
      const lines = receipt(['Shop', `ח.פ: ${REG_VALID_COMPANY}`, `טל: ${BUYER_PHONE}`, 'סה"כ 10.00']);
      expect(value(readWith(lines, {}), 'registrationNo')).toBe(REG_VALID_COMPANY);
      const s = readWith(lines, { buyerIds: [REG_VALID_COMPANY, BUYER_PHONE.replace('-', '')] });
      expect(value(s, 'registrationNo')).toBeUndefined();
      expect(value(s, 'phone')).toBeUndefined();
    });

    it('"customer copy", "העתק לקוח" and "מספר לקוח" are not bill-to labels: the vendor\'s numbers under them stay (R9)', () => {
      const s = read(receipt(['Vendor House Ltd', 'העתק לקוח', `ח.פ ${REG_VALID_COMPANY}`, 'טל 03-5551234', 'סה"כ 10.00']));
      expect(value(s, 'registrationNo')).toBe(REG_VALID_COMPANY);
      expect(value(s, 'phone')).toBe('03-5551234');
      expect(value(read(receipt(['Vendor House Ltd', 'Customer copy', 'Tel 03-5551234', 'Total 10.00'])), 'phone')).toBe('03-5551234');
    });
  });

  describe('dates (D1, D2): impossible or glyph-damaged dates are left out', () => {
    it('with the upload day known, a date years before it is left out and one in the last two years is kept', () => {
      expect(value(readWith(receipt(['Shop', 'Date 29/07/2020', 'Total 1.00']), { receivedOn: '2026-10-29' }), 'date')).toBeUndefined();
      expect(value(readWith(receipt(['Shop', 'Date 01/12/2025', 'Total 1.00']), { receivedOn: '2026-10-29' }), 'date')).toBe('2025-12-01');
      expect(value(readWith(receipt(['Shop', 'Date 31/10/2026', 'Total 1.00']), { receivedOn: '2026-10-29' }), 'date')).toBeUndefined();
      expect(value(read(receipt(['Shop', 'Date 29/07/2020', 'Total 1.00'])), 'date')).toBe('2020-07-29');
    });

    it('a date whose first digit touches an OCR "1" glyph (!, l, I) is left out; a column bar (|) is not one', () => {
      expect(value(read(receipt(['Shop', '0006 !1-03-2026', 'Total 30.00'])), 'date')).toBeUndefined();
      expect(value(read(receipt(['Shop', 'l1/03/2026', 'Total 30.00'])), 'date')).toBeUndefined();
      expect(value(read(receipt(['Shop', '|11/03/2026', 'Total 30.00'])), 'date')).toBe('2026-03-11');
    });

    it('a left-out date still counts in "the dates differ": a bill with an older date is still a bill (OV-2)', () => {
      expect(value(readWith(receipt(['Shop', '12/10/2026', 'Previous visit 12/10/2020', 'Total 5.00']), { receivedOn: '2026-10-29' }), 'date')).toBeUndefined();
    });
  });

  describe('vendor details (O1, O2)', () => {
    it('a street-and-number line is never the vendor, and no row under it is guessed', () => {
      expect(value(read(receipt(['ע.מ 123456782', 'הגפן 22 רמת גן', 'מחסני הגפן', 'סה"כ 10.00'])), 'vendorName')).toBeUndefined();
      expect(value(read(receipt(["רח' הגפן 5", 'מחסני הגפן', 'סה"כ 10.00'])), 'vendorName')).toBeUndefined();
    });

    it('an "Authorized Dealer #" is a registration number, not a phone', () => {
      const s = read(receipt(['Office Corner', 'Authorized Dealer #: 034567891', 'Total 10.00']));
      expect(value(s, 'phone')).toBeUndefined();
      expect(value(s, 'registrationNo')).toBe('034567891');
    });
  });

  /** The pre-landing review (2026-11-03, a specialist and an adversarial reviewer): each reproduced break, as a row. */
  describe('pre-landing review: never a new wrong field (MUT-514)', () => {
    const BUYER_PHONE = '052-9876543';

    it('"total paid" beside change is the cash handed over when another total is printed, or when paid + change is not', () => {
      expect(value(read(receipt(['Cafe', 'Latte 15.40', 'Total 15.40', 'Total paid 20.00', 'Change 4.60'])), 'totalMinor')).toBe('1540');
      expect(value(read(receipt(['קיוסק', 'סה"כ 15.40', 'סה"כ שולם 20.00', 'מזומן 20.00', 'עודף 4.60'])), 'totalMinor')).toBe('1540');
      expect(value(read(receipt(['مقهى', 'المجموع 15.40', 'المجموع المدفوع 20.00', 'الباقي 4.60'])), 'totalMinor')).toBe('1540');
    });

    it('an exact subtotal + VAT beats a total an agorot rounding confirms; a JOD total is never half a dinar off', () => {
      expect(value(read(receipt(['חנות', 'סה"כ לפני מע"מ 100.00', 'מע"מ 18.00', 'סה"כ 118.00', 'לתשלום 118.40', '₪'])), 'totalMinor')).toBe('11800');
      expect(value(read(receipt(['متجر', 'المجموع قبل الضريبة 10.000', 'ضريبة 1.600', 'الإجمالي 11.600', 'المبلغ المستحق 12.000 د.أ'])), 'totalMinor')).toBe('11600');
    });

    it("a card's balance after paying the total, or the total plus 18%, is never taken for the total", () => {
      expect(value(read(receipt(['קפה', 'קפה 50.00', 'סה"כ 50.00', 'יתרה בכרטיס 59.00', '₪'])), 'totalMinor')).toBe('5000');
      expect(value(read(receipt(['Shop', 'Item A 50.00', 'Item B 50.00', 'Total 100.00', 'Balance 118.00', '₪'])), 'totalMinor')).toBe('10000');
    });

    it('a tip, delivery fee or service charge the size of the VAT is never total − subtotal\'s VAT', () => {
      expect(value(read(receipt(['Cafe Roma', 'Subtotal 100.00', 'Tip 18.00', 'Total 118.00 ₪'])), 'vatMinor')).toBeUndefined();
      expect(value(read(receipt(['Cafe Roma', 'Subtotal 100.00', 'Delivery 18.00', 'Total 118.00 ₪'])), 'vatMinor')).toBeUndefined();
      expect(value(read(receipt(['Cafe Roma', 'Subtotal 100.00', 'VAT 18% 15.25', 'Tip 18.00', 'Total 118.00 ₪'])), 'vatMinor')).toBeUndefined();
    });

    it("once a labelled phone or registration no. is the buyer's, nothing unlabelled after it is offered", () => {
      const s = read(receipt(['משרד עו"ד כהן', `לכבוד: חברת אלפא טל: ${BUYER_PHONE}`, 'תאריך 01/11/2026', 'איש קשר דנה 052-1234567', 'סה"כ 118.00']));
      expect(value(s, 'phone')).toBeUndefined();
      const learned = readWith(receipt(['Acme Ltd', `VAT no ${REG_VALID_DEALER}`, `Supplier ref: Reg no ${REG_VALID_COMPANY}`, 'Total 118.00']), { buyerIds: [REG_VALID_DEALER] });
      expect(value(learned, 'registrationNo')).toBeUndefined();
    });

    it('a bill-to block heading the receipt leaves the vendor empty, never the row under it', () => {
      expect(value(read(receipt(['לכבוד', 'חברת אלפא בע"מ', 'תאריך 01/11/2026', 'פרויקט שיפוץ', 'סה"כ 10.00'])), 'vendorName')).toBeUndefined();
      expect(value(read(receipt(['Bill to: Beta Corp', 'Item 10.00', 'Consulting services'])), 'vendorName')).toBeUndefined();
    });

    it("an exempt dealer's own ID (עוסק פטור ת.ז) stays theirs, and is never learned as the buyer's", () => {
      const r = readReceipt({ lines: receipt(['יוסי צלם', `עוסק פטור ת.ז ${REG_VALID_DEALER}`, 'טל 050-1234567', 'תאריך: 28/10/2026', 'צילום 500.00', 'סה"כ 500.00']) }, { readerVersion: READER });
      expect(value(r.suggestion, 'registrationNo')).toBe(REG_VALID_DEALER);
      expect(value(r.suggestion, 'phone')).toBe('050-1234567');
      expect(r.buyerIdentifiers).toEqual([]);
    });

    it("a customer-service footer and a walk-in customer are not bill-to blocks", () => {
      expect(value(read(receipt(['ACME LTD', 'Coffee 12.00', 'Total 12.00', 'Customer service', '03-5551234'])), 'phone')).toBe('03-5551234');
      expect(value(read(receipt(['קפה הנמל', 'לקוח: מזדמן', 'טל 03-5551234', 'סה"כ 12.00'])), 'phone')).toBe('03-5551234');
    });

    it("a number taught by a misfired block is still reported as the vendor's, so the memory can unlearn it (R9)", () => {
      const r = readReceipt({ lines: receipt(['ACME LTD', 'Tel 03-5551234', 'Coffee 12.00', 'Total 12.00']) }, { readerVersion: READER, buyerIds: ['035551234'] });
      expect(value(r.suggestion, 'phone')).toBeUndefined();
      expect(r.vendorIdentifiers).toEqual(['035551234']);
    });

    it('a shop name with a number in it heads the receipt and is read (Studio 54 Bar)', () => {
      expect(value(read(receipt(['Studio 54 Bar', 'Total 10.00'])), 'vendorName')).toBe('Studio 54 Bar');
      expect(value(read(receipt(['מאפיית 24 שעות', 'סה"כ 10.00'])), 'vendorName')).toBe('מאפיית 24 שעות');
    });

    it('a total that says the tip is not in it is still the total', () => {
      expect(value(read(receipt(['Bistro', 'Total (tip not included) 50.00'])), 'totalMinor')).toBe('5000');
      const s = read(receipt(['Bistro', 'Pasta 42.37', 'VAT 7.63', 'Total before tip ₪50.00']));
      expect(value(s, 'totalMinor')).toBe('5000');
      expect(value(s, 'vatMinor')).toBe('763');
    });

    it("a split payment's card slips don't make the VAT implausible (its share is of the largest labelled total)", () => {
      expect(value(read(receipt(['מחסני הגפן', 'סכום עסקה 50.00', 'סכום עסקה 68.00', 'סה"כ לפני מע"מ 100.00', 'מע"מ 18% 18.00', 'לתשלום 118.00'])), 'vatMinor')).toBe('1800');
    });

    it('a page count (עמוד 1 מתוך 2) is not an instalment', () => {
      expect(value(read(receipt(['Shop', 'סה"כ 50.00 עמוד 1 מתוך 2'])), 'totalMinor')).toBe('5000');
    });
  });
});

describe('MUT-540: card slips, comma decimals and labels above their amount', () => {
  const total = (rows: Parameters<typeof receipt>[0]) => value(read(receipt(rows)), 'totalMinor');
  const texts = (rows: Parameters<typeof receipt>[0]) => orderedRows(receipt(rows)).map((r) => r.text);

  describe('E1 (D11): a comma before two digits is a decimal point, on labelled and amount-only rows only', () => {
    it('reads "184,36" under a card-slip label, and a comma decimal on a total row', () => {
      expect(total(['תחנת דלק', '03/02/26 09:14', 'סכום עסקה', '184,36'])).toBe('18436');
      expect(total(['Shop', 'סה"כ לתשלום 63,25 ש"ח'])).toBe('6325');
    });

    it('never turns a fuel quantity or a price per litre into the total, even on a "סה"כ" or "המחיר" row (review)', () => {
      expect(total(['תחנת דלק', 'המחיר לליטר 7,31', 'סכום עסקה 184,36'])).toBe('18436');
      expect(total(['תחנת דלק', 'ליטרים: 35,12', 'המחיר לליטר: 7,31', 'סכום עסקה :', '184,36'])).toBe('18436');
      expect(total(['תחנת דלק', 'סה"כ ליטרים 35,12', 'סכום עסקה 184,36'])).toBe('18436');
      expect(total(['תחנת דלק', 'סה"כ ליטרים 35,12'])).toBeUndefined();
    });

    it('leaves a thousands group alone, and a comma on a litres or price-per-litre row stays a comma', () => {
      expect(total(['Shop', 'Total 1,234.00'])).toBe('123400');
      expect(texts(['תחנת דלק', 'כמות: 35,12 ליטרים', '7,31 ש"ח לליטר', 'סכום עסקה', '184,36'])).toEqual(['תחנת דלק', 'כמות: 35,12 ליטרים', '7,31 ש"ח לליטר', 'סכום עסקה 184.36']);
    });
  });

  describe('E2: a thermal yod read as a geresh inside a word', () => {
    it("folds ע'סקה to עיסקה, and the plene card-slip spellings are card slips", () => {
      expect(foldForMatch("סכום ע'סקה")).toBe('סכום עיסקה');
      expect(total(['תחנת דלק', '03/02/26 09:14', "סכום ע'סקה :", '184,36'])).toBe('18436');
      expect(total(['תחנת דלק', 'סכום עיסקה :', '227.90'])).toBe('22790');
      expect(total(['בית מרקחת', 'סכום העסקה', '63.25'])).toBe('6325');
    });

    it("keeps the geresh of an abbreviation OCR glued to the next word (מס'עוסק, טל'נייד), so its labels still match", () => {
      for (const glued of ["מס'עוסק מורשה", "טל'נייד", "רח'הרצל", "יח'2"]) expect(foldForMatch(glued)).toBe(glued);
      expect(value(read(receipt(['ACME', `מס'עוסק מורשה ${REG_VALID_DEALER}`, 'סה"כ 10.00'])), 'registrationNo')).toBe(REG_VALID_DEALER);
    });

    it("keeps a geresh after the loanword and transliteration letters (ג'ינס, צ'יפס, ח'ליל, ד'אוד) and at a word's end", () => {
      for (const word of ["ג'ינס", "צ'יפס", "ז'קט", "ת'ומס", "ח'ליל", "ד'אוד", "ט'אהר", "ר'אמי", "מס' שובר"]) expect(foldForMatch(word)).toBe(word);
    });
  });

  describe('a corporation number (תאגיד מס., an amuta or company) is a registration number', () => {
    it("reads it, also with the yod after ג read as a geresh", () => {
      expect(value(read(receipt(['בית מרקחת', `תאגיד מס. ${REG_VALID_COMPANY}`, 'לתשלום 63.25'])), 'registrationNo')).toBe(REG_VALID_COMPANY);
      expect(value(read(receipt(['בית מרקחת', `תאג'ד מס. ${REG_VALID_COMPANY}`, 'לתשלום 63.25'])), 'registrationNo')).toBe(REG_VALID_COMPANY);
    });

    it('a water corporation\'s name ("תאגיד המים") is no registration label (review)', () => {
      expect(value(read(receipt(['מי אביבים תאגיד המים', 'חשבון תקופתי', 'סה"כ לתשלום 120.00'])), 'vendorName')).toBe('מי אביבים תאגיד המים');
      expect(value(read(receipt(['תאגיד מי רעננה 09-7654321', 'סה"כ 10.00'])), 'registrationNo')).toBeUndefined();
      expect(value(read(receipt(['תאגיד המים והביוב', `מספר צרכן ${REG_VALID_DEALER}`, 'סה"כ 10.00'])), 'registrationNo')).toBeUndefined();
    });
  });

  describe('E3 (D12): a label row joins the row under it when that row holds exactly one amount', () => {
    it('joins a slip label and its amount; not a label with its own amount, an item row, a far amount or a VAT table', () => {
      expect(texts(['סכום עסקה :', '184.36'])).toEqual(['סכום עסקה : 184.36']);
      // OCR specks around a thermal label: a bare digit beside it is no amount of its own, a stray comma before the amount none either.
      expect(texts(["5 סכום ע'סקה + -", ', 184,36'])).toEqual(["5 סכום ע'סקה + - , 184.36"]);
      expect(total(['תחנת דלק', "5 סכום ע'סקה + -", ', 184,36'])).toBe('18436');
      expect(texts(['Total 50.00', '12.00'])).toEqual(['Total 50.00', '12.00']);
      expect(texts(['סה"כ', 'Coffee 12.00'])).toEqual(['סה"כ', 'Coffee 12.00']);
      expect(texts(['סה"כ', '', '', '184.36'])).toEqual(['סה"כ', '184.36']);
      expect(texts(['מע"מ לפני מע"מ סה"כ', '18% 156.24 28.12 184.36'])).toEqual(['מע"מ לפני מע"מ סה"כ', '18% 156.24 28.12 184.36']);
    });

    it('joins only a total, card-slip, subtotal or VAT label: an item name above its price stays apart', () => {
      expect(texts(['Coffee', '12.00'])).toEqual(['Coffee', '12.00']);
    });

    it('never joins when the amounts ride higher than their labels (a tilted or curled photo): each would take the next one (review)', () => {
      // Each amount box sits 16 px above its label box: too little overlap to share a row, so amount rows interleave.
      const rows = [
        { text: 'מכולת השכונה', x: 150, y: 0 },
        { text: 'סה"כ לפני מע"מ', x: 250, y: 30 }, { text: '100.00', x: 10, y: 14 },
        { text: 'מע"מ 18%', x: 250, y: 60 }, { text: '18.00', x: 10, y: 44 },
        { text: 'סה"כ לתשלום', x: 250, y: 90 }, { text: '118.00', x: 10, y: 74 },
        { text: 'מזומן', x: 250, y: 120 }, { text: '200.00', x: 10, y: 104 },
        { text: 'עודף', x: 250, y: 150 }, { text: '82.00', x: 10, y: 134 },
      ];
      const lines = rows.map(({ text, x, y }) => ({ text, conf: 0.95, box: [x, 20 + y, x + 12 * text.length, 44 + y] as [number, number, number, number] }));
      expect(value(read(lines), 'totalMinor')).not.toBe('20000');
    });

    it('joins two label-over-amount pairs in a row, and a tall label box over its amount (bench: a thermal slip)', () => {
      expect(texts(['סה"כ :', '100.00', 'מע"מ :', '18.00'])).toEqual(['סה"כ : 100.00', 'מע"מ : 18.00']);
      // The label box 71 px tall, its amount's box starting 48 px under its top (the two overlap too little to share a row).
      const lines = [
        { text: "5 סכום ע'סקה + -", conf: 0.75, box: [298, 2670, 730, 2741] as [number, number, number, number] },
        { text: '184,36', conf: 0.96, box: [476, 2718, 625, 2772] as [number, number, number, number] },
      ];
      expect(orderedRows(lines).map((r) => r.text)).toEqual(["5 סכום ע'סקה + - 184.36"]);
    });

    it('never joins under a label row that already has an amount, whole or garbled (review)', () => {
      expect(texts(['סה"כ לתשלום 250', '38.14'])).toEqual(['סה"כ לתשלום 250', '38.14']);
      expect(texts(['סכום עסקה : 3OO.OO', '100.00'])).toEqual(['סכום עסקה : 3OO.OO', '100.00']);
      expect(texts(['סה"כ 1,250', '3.50'])).toEqual(['סה"כ 1,250', '3.50']);
    });
  });

  describe('E4 (D6/D8): a card slip printed once is the total when nothing on the receipt says the payment was split', () => {
    it('takes the lone slip', () => {
      expect(total(['תחנת דלק', '03/02/26 09:14', 'סכום עסקה 184.36'])).toBe('18436');
    });

    it('never takes it beside cash, change, a second slip, a voucher or gift card; another labelled total wins', () => {
      expect(total(['תחנת דלק', 'סכום עסקה 120.40', 'מזומן 100.00'])).not.toBe('12040');
      expect(total(['תחנת דלק', 'סכום עסקה 120.40', 'עודף 4.60'])).not.toBe('12040');
      expect(total(['Store', 'סכום עסקה 120.40', 'סכום עסקה 100.00'])).not.toBe('12040');
      expect(total(['Store', 'סכום עסקה 120.40', 'תו קנייה 100.00'])).not.toBe('12040');
      expect(total(['Store', 'סכום עסקה 120.40', 'Gift card 100.00'])).not.toBe('12040');
      expect(total(['Store', 'סכום עסקה 120.40', 'סה"כ לתשלום 184.36'])).toBe('18436');
    });

    it("is as sure as the slip label's box and the amount's box, not an unsure speck beside them", () => {
      expect(total(['תחנת דלק', [{ text: '184.36', x: 10, conf: 0.95 }, { text: '~', x: 150, conf: 0.3 }, { text: 'סכום עסקה', x: 250, conf: 0.9 }]])).toBe('18436');
    });

    it("a slip number (מס' שובר) is not a voucher payment", () => {
      expect(total(['תחנת דלק', "מס' שובר : 12345678", 'סכום עסקה 184.36'])).toBe('18436');
    });

    it('never takes it beside any other tender: a voucher, credit note, cheque, Bit, points, a second card (review)', () => {
      for (const tender of ['תו קניה 100.00', 'שובר זיכוי 100.00', "צ'ק 100.00", 'המחאה 100.00', 'ביט 100.00', 'מימוש נקודות 100.00', 'BuyMe 100.00', 'אשראי 100.00', 'شيك 100.00']) {
        expect(total(['סופר', 'סכום עסקה 120.40', tender]), tender).not.toBe('12040');
      }
    });

    it("a tender line equal to the slip is the same payment, not a split; a card's credit type has no amount", () => {
      expect(total(['סופר', 'אשראי: רגיל', 'סכום עסקה 120.40', 'אשראי 120.40'])).toBe('12040');
    });

    it('never takes a deposit or a part payment that leaves a balance (review)', () => {
      expect(total(['מוסך', 'סכום עסקה 500.00', 'יתרה 1500.00'])).not.toBe('50000');
      expect(total(['מוסך', 'מקדמה', 'סכום עסקה 500.00'])).not.toBe('50000');
    });

    it('never takes a refund or cancellation slip (review)', () => {
      for (const kind of ['עסקת זיכוי', 'ביטול עסקה', 'החזר כספי', 'Refund']) expect(total(['חנות בגדים', kind, 'סכום עסקה 249.90']), kind).toBeUndefined();
    });

    it('can be switched off, so the bench can measure the rule alone', () => {
      const s = extractReceipt({ lines: receipt(['תחנת דלק', 'סכום עסקה 184.36']) }, { readerVersion: READER, loneCardSlip: false });
      expect(value(s, 'totalMinor')).toBeUndefined();
    });
  });
});
