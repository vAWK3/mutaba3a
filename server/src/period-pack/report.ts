import { formatMoney, type Currency } from '../money.js';
import { EXPENSE_COLUMNS, INCOME_COLUMNS, PAYMENT_METHOD_LABELS, SHEET_NAMES, SOURCE_LABELS, SUMMARY_COLUMNS, SUMMARY_LABELS, VAT_TREATMENT_LABELS, headersOf, type Lang } from './columns.js';
import type { PeriodRows } from './rows.js';
import { dateSerial, dateTimeSerial, moneyCell, writeXlsx, type Cell, type Sheet } from './xlsx.js';

/**
 * MUT-314 (ADR-248): the Excel report, one XLSX with Expenses, Income and Summary, in the downloader's language
 * (right to left for Arabic). Always both sheets, whatever the client's filter (D21). Amounts in major units with their
 * currency (formatMoney, bigint-exact), never summed across currencies (ADR-004).
 */
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const money = (minor: bigint, currency: string): Cell => moneyCell(formatMoney({ minor, currency: currency as Currency }));
const text = (value: string | null | undefined): Cell => (value ? value : null);
const words = (map: Readonly<Record<string, Readonly<Record<Lang, string>>>>, key: string | null, lang: Lang): Cell => (key ? (map[key]?.[lang] ?? key) : null);

function expenseSheet(rows: PeriodRows): Sheet {
  const { lang } = rows;
  const tz = rows.organization.timezone;
  const body = rows.expenses.map(({ ref, record: e, vendor, category, client, project, loggedBy, receipts }): Cell[] => [
    ref,
    { serial: dateSerial(e.occurredOn), fmt: 'date' },
    text(vendor),
    text(e.title),
    text(category),
    text(client),
    text(project),
    e.currency,
    money(e.amountMinor, e.currency),
    e.netMinor !== null ? money(e.netMinor, e.currency) : null,
    e.vatMinor !== null ? money(e.vatMinor, e.currency) : null,
    e.vatRateBasisPoints !== null ? { n: (e.vatRateBasisPoints / 100).toFixed(2), fmt: 'decimal2' } : null,
    words(VAT_TREATMENT_LABELS, e.vatTreatment, lang),
    text(e.notes),
    { n: String(receipts.length), fmt: 'int' },
    receipts.length ? receipts.map((r) => r.name).join('; ') : null,
    text(loggedBy),
    { serial: dateTimeSerial(e.createdAt, tz), fmt: 'datetime' },
    e.id,
  ]);
  return { name: SHEET_NAMES.expenses[lang], rtl: lang === 'ar', table: true, widths: EXPENSE_COLUMNS.map((c) => c.width), rows: [headersOf(EXPENSE_COLUMNS, lang), ...body] };
}

function incomeSheet(rows: PeriodRows): Sheet {
  const { lang } = rows;
  const tz = rows.organization.timezone;
  const body = rows.income.map(({ ref, record: p, client, project, loggedBy }): Cell[] => [
    ref,
    { serial: dateSerial(p.receivedOn), fmt: 'date' },
    text(client),
    text(project),
    p.currency,
    money(p.amountMinor, p.currency),
    words(PAYMENT_METHOD_LABELS, p.method, lang),
    text(p.reference),
    text(p.receiptNumber),
    text(p.notes),
    SOURCE_LABELS[p.origin][lang],
    text(loggedBy),
    { serial: dateTimeSerial(p.createdAt, tz), fmt: 'datetime' },
    p.id,
  ]);
  return { name: SHEET_NAMES.income[lang], rtl: lang === 'ar', table: true, widths: INCOME_COLUMNS.map((c) => c.width), rows: [headersOf(INCOME_COLUMNS, lang), ...body] };
}

interface CurrencyTotals {
  expenses: number;
  gross: bigint;
  vat: bigint;
  income: number;
  incomeTotal: bigint;
}

/** Per currency: expense count, gross, net (gross less recorded VAT), VAT; income count and total. */
export function totalsByCurrency(rows: Pick<PeriodRows, 'expenses' | 'income'>): Array<[string, CurrencyTotals]> {
  const totals = new Map<string, CurrencyTotals>();
  const of = (currency: string) => totals.get(currency) ?? totals.set(currency, { expenses: 0, gross: 0n, vat: 0n, income: 0, incomeTotal: 0n }).get(currency)!;
  for (const { record: e } of rows.expenses) {
    const t = of(e.currency);
    t.expenses += 1;
    t.gross += e.amountMinor;
    t.vat += e.vatMinor ?? 0n;
  }
  for (const { record: p } of rows.income) {
    const t = of(p.currency);
    t.income += 1;
    t.incomeTotal += p.amountMinor;
  }
  return [...totals.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

function summarySheet(rows: PeriodRows, profileName: string): Sheet {
  const { lang, range } = rows;
  const label = (key: keyof typeof SUMMARY_LABELS) => SUMMARY_LABELS[key][lang];
  const meta: Cell[][] = [
    [label('profile'), profileName],
    [label('from'), range.from ? { serial: dateSerial(range.from), fmt: 'date' } : label('firstRecord')],
    [label('to'), { serial: dateSerial(range.to), fmt: 'date' }],
    [label('generatedAt'), { serial: dateTimeSerial(rows.asOf, rows.organization.timezone), fmt: 'datetime' }],
    [],
  ];
  const table = totalsByCurrency(rows).map(([currency, t]): Cell[] => [
    currency,
    { n: String(t.expenses), fmt: 'int' },
    money(t.gross, currency),
    money(t.gross - t.vat, currency),
    money(t.vat, currency),
    { n: String(t.income), fmt: 'int' },
    money(t.incomeTotal, currency),
  ]);
  return { name: SHEET_NAMES.summary[lang], rtl: lang === 'ar', table: false, widths: SUMMARY_COLUMNS.map((c) => c.width), rows: [...meta, headersOf(SUMMARY_COLUMNS, lang), ...table] };
}

export function buildReport(rows: PeriodRows): Uint8Array {
  return writeXlsx([expenseSheet(rows), incomeSheet(rows), summarySheet(rows, rows.organization.name)]);
}
