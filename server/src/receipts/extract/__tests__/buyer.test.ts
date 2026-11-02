import { describe, expect, it } from 'vitest';
import { buyerOf, customerRows, learnedBuyerIds, normalizeIdentifier } from '../buyer.js';
import { orderedRows } from '../rows.js';
import { receipt, REG_VALID_COMPANY, REG_VALID_DEALER } from './fixtures.js';

/** MUT-514 (D6, D10): the bill-to block and the buyer's numbers. Synthetic rows only. */
const rowsOf = (lines: Parameters<typeof receipt>[0]) => orderedRows(receipt(lines));
const blockTexts = (lines: Parameters<typeof receipt>[0]) => {
  const rows = rowsOf(lines);
  const block = customerRows(rows);
  return rows.filter((r) => block.has(r)).map((r) => r.text);
};

describe('customerRows', () => {
  it('is the label row and the rows under it, up to a money row', () => {
    expect(blockTexts(['Shop', 'Bill to: Dana Levi', 'Law office', 'Tel 052-9876543', 'Item 10.00', 'Tel 03-5551234'])).toEqual(['Bill to: Dana Levi', 'Law office', 'Tel 052-9876543']);
  });

  it('ends at a table header, a total or a date label, and after five rows', () => {
    expect(blockTexts(['לכבוד דנה', 'תיאור כמות מחיר', '052-9876543'])).toEqual(['לכבוד דנה']);
    expect(blockTexts(['Customer: Dana', 'Total', '052-9876543'])).toEqual(['Customer: Dana']);
    expect(blockTexts(['Customer: Dana', 'Date: 01/10/2026', '052-9876543'])).toEqual(['Customer: Dana']);
    expect(blockTexts(['Customer: Dana', 'a', 'b', 'c', 'd', 'e', 'f'])).toEqual(['Customer: Dana', 'a', 'b', 'c', 'd', 'e']);
  });

  it("does not end at the buyer's own phone label (OV-8)", () => {
    expect(blockTexts(['לכבוד דנה', 'טל: 052-9876543', 'סה"כ 10.00'])).toEqual(['לכבוד דנה', 'טל: 052-9876543']);
  });

  it.each([['העתק לקוח'], ['Customer copy'], ['מספר לקוח: 13015'], ["מס' לקוח 13015"]])('%s is not a block label', (label) => {
    expect(blockTexts([label, `ח.פ ${REG_VALID_COMPANY}`])).toEqual([]);
  });

  it.each([['לכבוד'], ['לקוח:'], ['שם לקוח:'], ['Bill to'], ['Sold to'], ['To:'], ['السيد'], ['السيد/ة'], ['العميل'], ['رقم الهوية']])('%s starts a block', (label) => {
    expect(blockTexts([`${label} X`])).toEqual([`${label} X`]);
  });
});

describe('normalizeIdentifier', () => {
  it.each([
    ['052-987 6543', '0529876543'],
    ['+972-52-9876543', '0529876543'],
    ['00972529876543', '0529876543'],
    ['12345678', '012345678'],
    [REG_VALID_DEALER, REG_VALID_DEALER],
  ])('%s → %s', (raw, want) => expect(normalizeIdentifier(raw)).toBe(want));
});

describe('buyerOf', () => {
  it('holds every phone- and registration-shaped number in the block, and the seeded ids, digits only', () => {
    const rows = rowsOf(['Shop', `לכבוד ע.מ: ${REG_VALID_COMPANY}`, 'טל 052-9876543', 'סה"כ 10.00']);
    const buyer = buyerOf(rows, ['03-5551234']);
    expect([...buyer.identifiers].sort()).toEqual(['035551234', '0529876543', REG_VALID_COMPANY].sort());
    expect(buyer.has('052 9876543')).toBe(true);
    expect(buyer.ownIdentifiers).toEqual(expect.arrayContaining(['0529876543', REG_VALID_COMPANY]));
    expect(buyer.ownIdentifiers).not.toContain('035551234');
  });
});

describe('learnedBuyerIds', () => {
  it("is the union of the organization's block numbers, less any number a receipt read as the vendor's (R9)", () => {
    const learned = learnedBuyerIds([
      { buyer: ['0529876543', REG_VALID_COMPANY], vendor: ['035551234'] },
      { buyer: ['0529876543'], vendor: [] },
      // A chain's head-office number: one receipt's misfired block holds it, another reads it as the vendor's.
      { buyer: [REG_VALID_DEALER], vendor: [] },
      { buyer: [], vendor: [REG_VALID_DEALER] },
    ]);
    expect(learned.sort()).toEqual(['0529876543', REG_VALID_COMPANY].sort());
  });

  it('learns nothing from frequency: a number read as the vendor\'s on many receipts is never the buyer\'s', () => {
    expect(learnedBuyerIds(Array.from({ length: 5 }, () => ({ buyer: [], vendor: [REG_VALID_DEALER] })))).toEqual([]);
  });
});
