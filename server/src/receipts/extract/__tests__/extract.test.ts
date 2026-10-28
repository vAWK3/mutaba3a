import { describe, expect, it } from 'vitest';
import type { ReceiptSuggestion } from '../../../repositories/ports.js';
import { ReceiptSuggestionSchema } from '../../../schemas.js';
import { extractReceipt, isConfident, MIN_FIELD_CONFIDENCE } from '../extract.js';
import { isValidIsraeliRegistration } from '../fields.js';
import { normalizeText } from '../normalize.js';
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
