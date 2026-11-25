import { describe, expect, it } from 'vitest';
import { alpha, amount, encodeLine, isoDate, numeric, quantity, toFileText } from '../format.js';
import { LAYOUTS, renderRecord } from '../layout.js';

/** MUT-569: the uniform file's field rules (spec 1.31 §2.3–2.4) and its one character set, ISO-8859-8 (§2.4 ח). */

describe('record layouts', () => {
  const SPEC_LENGTHS = { A000: 466, INI_SUMMARY: 19, A100: 95, C100: 444, D110: 339, D120: 222, Z900: 110 } as const;

  it.each(Object.entries(SPEC_LENGTHS))('%s adds up to the spec length %i', (code, length) => {
    const layout = LAYOUTS[code as keyof typeof LAYOUTS];
    expect(layout.reduce((sum, f) => sum + f.width, 0)).toBe(length);
  });

  it('places fields where the spec tables say', () => {
    const start = (code: keyof typeof LAYOUTS, field: number) => {
      const layout = LAYOUTS[code];
      return layout.slice(0, layout.findIndex((f) => f.field === field)).reduce((s, f) => s + f.width, 0) + 1;
    };
    expect(start('A000', 1004)).toBe(34);
    expect(start('A000', 1034)).toBe(420);
    expect(start('C100', 1219)).toBe(288);
    expect(start('C100', 1230)).toBe(401);
    expect(start('C100', 1233)).toBe(416);
    expect(start('D110', 1264)).toBe(224);
    expect(start('D110', 1268)).toBe(286);
    expect(start('D110', 1272)).toBe(297);
    expect(start('D120', 1312)).toBe(104);
    expect(start('D120', 1322)).toBe(148);
    expect(start('Z900', 1155)).toBe(46);
  });

  it('renders a record at its exact width, missing fields blank by kind', () => {
    const line = renderRecord('A100', { 1100: 'A100', 1101: 1, 1102: '123456789', 1103: '100000000000001', 1104: '&OF1.31&' });
    expect(line).toHaveLength(95);
    expect(line.slice(0, 45)).toBe('A100000000001123456789100000000000001&OF1.31&');
    expect(line.slice(45)).toBe(' '.repeat(50));
  });

  it('refuses a value that does not fit a numeric field', () => {
    expect(() => renderRecord('A100', { 1101: 1_000_000_000 })).toThrow(/1101/);
  });
});

describe('field formats', () => {
  it('pads alphanumeric fields with spaces on the left-to-right end and cuts long text', () => {
    expect(alpha('AB', 5)).toBe('AB   ');
    expect(alpha('ABCDEFG', 5)).toBe('ABCDE');
    expect(alpha(null, 3)).toBe('   ');
  });

  it('pads numeric fields with zeros on the left', () => {
    expect(numeric(1234, 9)).toBe('000001234');
    expect(numeric('515151515', 9)).toBe('515151515');
    expect(numeric(null, 4)).toBe('0000');
  });

  it('writes amounts with a sign and two implied decimals', () => {
    expect(amount(123456n, 15)).toBe('+00000000123456');
    expect(amount(-500n, 15)).toBe('-00000000000500');
    expect(amount(0n, 12)).toBe('+00000000000');
  });

  it('writes quantities with four implied decimals', () => {
    expect(quantity(2_500n, 17)).toBe('+0000000000025000');
    expect(quantity(1_000n, 17)).toBe('+0000000000010000');
  });

  it('writes dates as YYYYMMDD', () => {
    expect(isoDate('2026-11-22')).toBe('20261122');
  });
});

describe('file text (ISO-8859-8)', () => {
  it('keeps ASCII and Hebrew letters', () => {
    expect(toFileText('חשבונית 1042 ABC')).toBe('חשבונית 1042 ABC');
  });

  it('replaces Hebrew punctuation, dashes, quotes and spaces with their ASCII forms', () => {
    expect(toFileText('בע״מ – ‘x’ “y” z')).toBe('בע"מ - \'x\' "y" z');
    expect(toFileText('גרש׳')).toBe("גרש'");
  });

  it('drops Hebrew points and direction marks', () => {
    expect(toFileText('שָׁלוֹם‏')).toBe('שלום');
  });

  it('writes Arabic in Hebrew letters, with final forms at the end of a word', () => {
    expect(toFileText('محمد عبد الله')).toBe('מחמד עבד אללה');
    expect(toFileText('سلام')).toBe('סלאם');
    expect(toFileText('جميل')).toBe("ג'מיל");
    expect(toFileText('خالد')).toBe("ח'אלד");
    expect(toFileText('حسن')).toBe('חסן');
  });

  it('turns Arabic-Indic digits and punctuation into ASCII', () => {
    expect(toFileText('فاتورة ١٢٣، شكرا؟')).toBe('פאתורה 123, שכרא?');
  });

  it('writes anything else as a question mark, and line breaks as spaces', () => {
    expect(toFileText('café 🙂\nok')).toBe('cafe ? ok');
  });

  it('encodes a line as single bytes: Hebrew in 0xE0–0xFA', () => {
    const bytes = encodeLine('אב ת');
    expect([...bytes]).toEqual([0xe0, 0xe1, 0x20, 0xfa]);
  });

  it('refuses a character outside the set (a guard: every field goes through toFileText)', () => {
    expect(() => encodeLine('é')).toThrow();
  });
});
