import { describe, it, expect } from 'vitest';
import { describePaymentAmount, minorToAmountInput } from '../paymentEntry';

// MUT-86: the payment drawer's live line and its field errors come from one
// classification of the typed amount against what may still be paid.
describe('describePaymentAmount', () => {
  const ALLOWED = 355000; // ₪3,550 left

  it('says paid in full when the amount is exactly what is left', () => {
    expect(describePaymentAmount('3550', 'ILS', ALLOWED)).toEqual({ kind: 'paidInFull', amountMinor: 355000 });
  });

  it('says what is still owed after a smaller amount', () => {
    expect(describePaymentAmount('1775', 'ILS', ALLOWED)).toEqual({
      kind: 'stillOwed',
      amountMinor: 177500,
      leftMinor: 177500,
    });
  });

  it('says over, carrying what is allowed, when the amount exceeds it', () => {
    expect(describePaymentAmount('3550.01', 'ILS', ALLOWED)).toEqual({ kind: 'over', allowedMinor: ALLOWED });
  });

  it('treats any positive amount as over when nothing is left', () => {
    expect(describePaymentAmount('1', 'ILS', 0)).toEqual({ kind: 'over', allowedMinor: 0 });
  });

  it('is empty for blank text', () => {
    expect(describePaymentAmount('', 'ILS', ALLOWED)).toEqual({ kind: 'empty' });
    expect(describePaymentAmount('   ', 'ILS', ALLOWED)).toEqual({ kind: 'empty' });
  });

  it.each(['1,2', 'abc', '12.345', '1.200,50'])('refuses to guess at "%s"', (raw) => {
    expect(describePaymentAmount(raw, 'ILS', ALLOWED)).toEqual({ kind: 'invalid' });
  });

  it.each(['0', '0.00', '-5'])('says "%s" is not a positive amount', (raw) => {
    expect(describePaymentAmount(raw, 'ILS', ALLOWED)).toEqual({ kind: 'notPositive' });
  });

  it('names the other currency when the typed symbol is not the entry currency', () => {
    expect(describePaymentAmount('$100', 'ILS', ALLOWED)).toEqual({ kind: 'currencyMismatch', typed: 'USD' });
  });

  it('reads the entry currency symbol or code', () => {
    expect(describePaymentAmount('₪100', 'ILS', ALLOWED)).toMatchObject({ kind: 'stillOwed', amountMinor: 10000 });
    expect(describePaymentAmount('100 NIS', 'ILS', ALLOWED)).toMatchObject({ kind: 'stillOwed', amountMinor: 10000 });
  });

  it('reads Arabic-Indic digits and separators (MUT-5)', () => {
    expect(describePaymentAmount('١٧٧٥', 'ILS', ALLOWED)).toMatchObject({ kind: 'stillOwed', leftMinor: 177500 });
    expect(describePaymentAmount('١٬٧٧٥٫٥٠', 'ILS', ALLOWED)).toMatchObject({ kind: 'stillOwed', amountMinor: 177550 });
    expect(describePaymentAmount('۳۵۵۰', 'ILS', ALLOWED)).toMatchObject({ kind: 'paidInFull' });
  });

  it('accepts grouped thousands', () => {
    expect(describePaymentAmount('3,550', 'ILS', ALLOWED)).toMatchObject({ kind: 'paidInFull' });
  });
});

describe('minorToAmountInput', () => {
  it('writes whole amounts without decimals or grouping', () => {
    expect(minorToAmountInput(355000, 'USD')).toBe('3550');
    expect(minorToAmountInput(100, 'USD')).toBe('1');
  });

  it('writes both decimals when there are cents', () => {
    expect(minorToAmountInput(88750, 'USD')).toBe('887.50');
    expect(minorToAmountInput(5, 'USD')).toBe('0.05');
  });

  it('writes three decimals for JOD (exponent 3)', () => {
    expect(minorToAmountInput(3550000, 'JOD')).toBe('3550');
    expect(minorToAmountInput(1500, 'JOD')).toBe('1.500');
    expect(minorToAmountInput(5, 'JOD')).toBe('0.005');
  });

  it('round-trips through describePaymentAmount', () => {
    for (const minor of [1, 5, 99, 100, 88750, 355000, 123456789]) {
      expect(describePaymentAmount(minorToAmountInput(minor, 'USD'), 'USD', minor)).toEqual({
        kind: 'paidInFull',
        amountMinor: minor,
      });
    }
  });
});
