import { describe, it, expect } from 'vitest';
import { incomeFormSchema, minorToDecimal, parseIncomeAmount, settleLine, toCreateIncomeRequest, type IncomeFormValues } from '../incomeForm';

const base: IncomeFormValues = {
  kind: 'owed',
  amount: '1,200',
  currency: 'ILS',
  occurredOn: '2026-10-14',
  customerId: 'c1',
  projectId: '',
  title: 'Logo redesign',
  dueDate: '',
  method: 'CASH',
  notes: '',
};
const schema = (customerRule: 'optional' | 'linked-required' = 'optional') => incomeFormSchema({ today: '2026-10-14', customerRule });
const issues = (values: IncomeFormValues, rule?: 'optional' | 'linked-required') => {
  const result = schema(rule).safeParse(values);
  return result.success ? {} : Object.fromEntries(result.error.issues.map((i) => [i.path.join('.'), i.message]));
};

describe('parseIncomeAmount — lenient in, canonical out (MUT-133 R5)', () => {
  it('reads commas, a matching symbol and Arabic-Indic digits, and sends a canonical decimal', () => {
    expect(parseIncomeAmount('1,200', 'ILS')).toEqual({ kind: 'ok', minor: 120000, canonical: '1200.00' });
    expect(parseIncomeAmount('₪1,200', 'ILS')).toMatchObject({ kind: 'ok', canonical: '1200.00' });
    expect(parseIncomeAmount('١٬٢٠٠', 'ILS')).toMatchObject({ kind: 'ok', canonical: '1200.00' });
    expect(parseIncomeAmount('1.25', 'JOD')).toMatchObject({ kind: 'ok', canonical: '1.250' });
  });

  it('refuses a typed currency that is not the field\'s', () => {
    expect(parseIncomeAmount('$5', 'ILS')).toEqual({ kind: 'currencyMismatch', typed: 'USD' });
  });

  it('refuses too many decimals, zero, negatives and blanks', () => {
    expect(parseIncomeAmount('1.255', 'USD')).toEqual({ kind: 'invalid' });
    expect(parseIncomeAmount('0', 'USD')).toEqual({ kind: 'notPositive' });
    expect(parseIncomeAmount('-5', 'USD')).toEqual({ kind: 'notPositive' });
    expect(parseIncomeAmount('  ', 'USD')).toEqual({ kind: 'empty' });
  });

  it('formats minor units with exactly the currency\'s digits', () => {
    expect(minorToDecimal(5, 'USD')).toBe('0.05');
    expect(minorToDecimal(1250, 'JOD')).toBe('1.250');
    expect(minorToDecimal(120000, 'ILS')).toBe('1200.00');
  });
});

describe('incomeFormSchema', () => {
  it('needs a client for Owed', () => {
    expect(issues({ ...base, customerId: '' })).toEqual({ customerId: 'hosted.income.errors.clientRequiredOwed' });
  });

  it('lets Received stand alone where the rules allow it, and not where they do not', () => {
    expect(issues({ ...base, kind: 'received', customerId: '' })).toEqual({});
    expect(issues({ ...base, kind: 'received', customerId: '' }, 'linked-required')).toEqual({ customerId: 'hosted.income.errors.clientRequired' });
  });

  it('refuses a date after today in the profile\'s zone', () => {
    expect(issues({ ...base, occurredOn: '2026-10-15' })).toEqual({ occurredOn: 'hosted.income.errors.dateFuture' });
  });

  it('reports the amount problem as an i18n key', () => {
    expect(issues({ ...base, amount: '$5' })).toEqual({ amount: 'hosted.income.errors.currencyMismatch' });
    expect(issues({ ...base, amount: '' })).toEqual({ amount: 'hosted.income.errors.amountRequired' });
  });
});

describe('toCreateIncomeRequest', () => {
  it('sends Owed with its title and due date, never a method, and drops blanks', () => {
    expect(toCreateIncomeRequest({ ...base, dueDate: '2026-11-15', method: 'BANK' })).toEqual({
      kind: 'owed',
      amount: '1200.00',
      currency: 'ILS',
      occurredOn: '2026-10-14',
      customerId: 'c1',
      title: 'Logo redesign',
      dueDate: '2026-11-15',
    });
  });

  it('sends Received with its method, never the title or due date left over from Owed', () => {
    expect(toCreateIncomeRequest({ ...base, kind: 'received', customerId: '', dueDate: '2026-11-15', method: 'BANK', notes: ' cash at office ' })).toEqual({
      kind: 'received',
      amount: '1200.00',
      currency: 'ILS',
      occurredOn: '2026-10-14',
      method: 'BANK',
      notes: 'cash at office',
    });
  });
});

describe('settleLine (design 4A)', () => {
  it('says paid in full, what stays owed, or that it exceeds what is left', () => {
    expect(settleLine(parseIncomeAmount('5,000', 'ILS'), '5000.00', 'ILS')).toEqual({ tone: 'done', key: 'hosted.settle.paidInFull' });
    expect(settleLine(parseIncomeAmount('2000', 'ILS'), '5000.00', 'ILS')).toEqual({ tone: 'owed', key: 'hosted.settle.stillOwed', left: '3000.00' });
    expect(settleLine(parseIncomeAmount('6000', 'ILS'), '5000.00', 'ILS')).toEqual({ tone: 'over', key: 'hosted.settle.exceeds', outstanding: '5000.00' });
  });

  it('stays silent while the text is not yet an amount', () => {
    expect(settleLine(parseIncomeAmount('1,2x', 'ILS'), '5000.00', 'ILS')).toBeNull();
  });
});
