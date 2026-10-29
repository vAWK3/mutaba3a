import { describe, expect, it } from 'vitest';
import type { ReceiptSuggestion } from '../../../repositories/ports.js';
import { ReceiptSuggestionSchema } from '../../../schemas.js';
import { extractReceipt, isConfident, MIN_FIELD_CONFIDENCE } from '../extract.js';
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
