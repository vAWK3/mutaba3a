import { formatMoney, type Currency } from '../money.js';
import { EXPENSE_COLUMNS, INCOME_COLUMNS, PAYMENT_METHOD_LABELS, SHEET_NAMES, SOURCE_LABELS, SUMMARY_COLUMNS, SUMMARY_LABELS, VAT_TREATMENT_LABELS, headersOf, type Column, type Lang } from './columns.js';
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

/** Review (MUT-314): what a link's visitor never gets: who logged a row, and any id. */
const HIDDEN_FROM_LINKS: ReadonlySet<string> = new Set(['loggedBy', 'id']);

/** A table sheet from rows keyed by column, the link's hidden columns left out. */
function tableSheet(name: string, rows: PeriodRows, columns: readonly Column[], body: ReadonlyArray<Record<string, Cell>>): Sheet {
  const shown = columns.filter((c) => !(rows.forLink && HIDDEN_FROM_LINKS.has(c.key)));
  return {
    name,
    rtl: rows.lang === 'ar',
    table: true,
    widths: shown.map((c) => c.width),
    rows: [headersOf(shown, rows.lang), ...body.map((cells) => shown.map((c) => cells[c.key] ?? null))],
  };
}

function expenseSheet(rows: PeriodRows): Sheet {
  const { lang } = rows;
  const tz = rows.organization.timezone;
  const body = rows.expenses.map(({ ref, record: e, vendor, category, client, project, loggedBy, receipts }): Record<string, Cell> => ({
    ref,
    date: { serial: dateSerial(e.occurredOn), fmt: 'date' },
    vendor: text(vendor),
    description: text(e.title),
    category: text(category),
    client: text(client),
    project: text(project),
    currency: e.currency,
    amount: money(e.amountMinor, e.currency),
    net: e.netMinor !== null ? money(e.netMinor, e.currency) : null,
    vat: e.vatMinor !== null ? money(e.vatMinor, e.currency) : null,
    vatRate: e.vatRateBasisPoints !== null ? { n: (e.vatRateBasisPoints / 100).toFixed(2), fmt: 'decimal2' } : null,
    vatTreatment: words(VAT_TREATMENT_LABELS, e.vatTreatment, lang),
    notes: text(e.notes),
    receipts: { n: String(receipts.length), fmt: 'int' },
    receiptFiles: receipts.length ? receipts.map((r) => r.name).join('; ') : null,
    loggedBy: text(loggedBy),
    loggedAt: { serial: dateTimeSerial(e.createdAt, tz), fmt: 'datetime' },
    id: e.id,
  }));
  return tableSheet(SHEET_NAMES.expenses[lang], rows, EXPENSE_COLUMNS, body);
}

function incomeSheet(rows: PeriodRows): Sheet {
  const { lang } = rows;
  const tz = rows.organization.timezone;
  const body = rows.income.map(({ ref, record: p, client, project, loggedBy }): Record<string, Cell> => ({
    ref,
    date: { serial: dateSerial(p.receivedOn), fmt: 'date' },
    client: text(client),
    project: text(project),
    currency: p.currency,
    amount: money(p.amountMinor, p.currency),
    method: words(PAYMENT_METHOD_LABELS, p.method, lang),
    reference: text(p.reference),
    receiptNumber: text(p.receiptNumber),
    notes: text(p.notes),
    source: SOURCE_LABELS[p.origin][lang],
    loggedBy: text(loggedBy),
    loggedAt: { serial: dateTimeSerial(p.createdAt, tz), fmt: 'datetime' },
    id: p.id,
  }));
  return tableSheet(SHEET_NAMES.income[lang], rows, INCOME_COLUMNS, body);
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
