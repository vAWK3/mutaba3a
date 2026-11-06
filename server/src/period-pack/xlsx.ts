import { strToU8, zipSync } from 'fflate';
import type { IsoDate } from '../dates.js';

/**
 * MUT-314 (ADR-248, D10, D17): a minimal SpreadsheetML writer, enough for the period report and nothing more.
 *
 * - Text is an inline string (`t="inlineStr"`): no shared-strings table, and an inline string is never a formula, so a
 *   cell like `=1+1` stays text (D17). XML-illegal characters (C0 controls, lone surrogates) are stripped.
 * - Numbers are written as given (`n` is a decimal string from formatMoney, so a bigint amount never passes through a
 *   float here); Excel holds them as doubles, which is exact for every amount below 2^53 minor units.
 * - Dates are serial numbers (days since 1899-12-30) with a `yyyy-mm-dd` (or `yyyy-mm-dd hh:mm`) format.
 * - A `table` sheet has a bold, frozen header row and an autofilter; `rtl` turns the sheet right to left (Arabic).
 * Built in memory and zipped with fflate's zipSync: the row cap (PERIOD_PACK_MAX_ROWS) bounds it.
 */
export type NumberFormat = 'int' | 'money2' | 'money3' | 'decimal2';
export type Cell = null | string | { n: string; fmt: NumberFormat } | { serial: number; fmt: 'date' | 'datetime' };

export interface Sheet {
  name: string;
  rtl: boolean;
  /** Header row bold and frozen, with an autofilter over the rows. */
  table: boolean;
  /** Column widths in characters, first column first. */
  widths: readonly number[];
  rows: ReadonlyArray<ReadonlyArray<Cell>>;
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const MAX_CELL_TEXT = 32_767;

/** Style ids (cellXfs order in STYLES). */
const STYLE = { header: 1, money2: 2, money3: 3, date: 4, datetime: 5, int: 6, decimal2: 2 } as const;

const STYLES = `${XML_HEAD}<styleSheet xmlns="${NS}">
<numFmts count="4"><numFmt numFmtId="164" formatCode="0.00"/><numFmt numFmtId="165" formatCode="0.000"/><numFmt numFmtId="166" formatCode="yyyy-mm-dd"/><numFmt numFmtId="167" formatCode="yyyy-mm-dd hh:mm"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

// eslint-disable-next-line no-control-regex
const ILLEGAL_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function escapeXml(text: string): string {
  return text.replace(ILLEGAL_XML, '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

/** A money cell from formatMoney's decimal string: three decimals get `0.000`, any other `0.00`. */
export function moneyCell(formatted: string): Cell {
  const decimals = formatted.split('.')[1]?.length ?? 0;
  return { n: formatted, fmt: decimals === 3 ? 'money3' : 'money2' };
}

const EPOCH_DAY = Date.UTC(1899, 11, 30);

export function dateSerial(day: IsoDate): number {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(y, m - 1, d) - EPOCH_DAY) / 86_400_000);
}

/** The wall-clock moment in `timezone`, as a serial (days and the fraction of a day). */
export function dateTimeSerial(at: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const local = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return (local - EPOCH_DAY) / 86_400_000;
}

export function columnName(index: number): string {
  let n = index + 1;
  let name = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    name = String.fromCharCode(65 + r) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function cellXml(cell: Cell, ref: string, header: boolean): string {
  if (cell === null) return '';
  if (typeof cell === 'string') {
    const text = escapeXml(cell.slice(0, MAX_CELL_TEXT));
    return `<c r="${ref}" t="inlineStr"${header ? ` s="${STYLE.header}"` : ''}><is><t xml:space="preserve">${text}</t></is></c>`;
  }
  if ('n' in cell) return `<c r="${ref}" s="${STYLE[cell.fmt]}"><v>${cell.n}</v></c>`;
  return `<c r="${ref}" s="${STYLE[cell.fmt]}"><v>${cell.serial}</v></c>`;
}

function sheetXml(sheet: Sheet): string {
  const width = Math.max(1, sheet.widths.length, ...sheet.rows.map((r) => r.length));
  const last = `${columnName(width - 1)}${Math.max(1, sheet.rows.length)}`;
  const pane = sheet.table ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/>' : '';
  const view = `<sheetViews><sheetView workbookViewId="0"${sheet.rtl ? ' rightToLeft="1"' : ''}>${pane}</sheetView></sheetViews>`;
  const cols = sheet.widths.length ? `<cols>${sheet.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  const rows = sheet.rows
    .map((row, r) => `<row r="${r + 1}">${row.map((cell, c) => cellXml(cell, `${columnName(c)}${r + 1}`, sheet.table && r === 0)).join('')}</row>`)
    .join('');
  const filter = sheet.table ? `<autoFilter ref="A1:${last}"/>` : '';
  return `${XML_HEAD}<worksheet xmlns="${NS}" xmlns:r="${REL_NS}"><dimension ref="A1:${last}"/>${view}<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rows}</sheetData>${filter}</worksheet>`;
}

function quotedSheetName(name: string): string {
  return `'${name.replaceAll("'", "''")}'`;
}

export function writeXlsx(sheets: readonly Sheet[]): Uint8Array {
  const workbookSheets = sheets.map((s, i) => `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('');
  const filters = sheets
    .map((s, i) => {
      if (!s.table) return '';
      const width = Math.max(1, s.widths.length, ...s.rows.map((r) => r.length));
      const ref = `$A$1:$${columnName(width - 1)}$${Math.max(1, s.rows.length)}`;
      return `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${escapeXml(quotedSheetName(s.name))}!${ref}</definedName>`;
    })
    .join('');
  const workbook = `${XML_HEAD}<workbook xmlns="${NS}" xmlns:r="${REL_NS}"><bookViews><workbookView/></bookViews><sheets>${workbookSheets}</sheets>${filters ? `<definedNames>${filters}</definedNames>` : ''}</workbook>`;
  const workbookRels = `${XML_HEAD}<Relationships xmlns="${PKG_REL_NS}">${sheets
    .map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL_NS}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
    .join('')}<Relationship Id="rId${sheets.length + 1}" Type="${REL_NS}/styles" Target="styles.xml"/></Relationships>`;
  const contentTypes = `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets
    .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
    .join('')}</Types>`;
  const rootRels = `${XML_HEAD}<Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rootRels),
    'xl/workbook.xml': strToU8(workbook),
    'xl/_rels/workbook.xml.rels': strToU8(workbookRels),
    'xl/styles.xml': strToU8(STYLES),
  };
  sheets.forEach((s, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s))));
  return zipSync(files, { level: 6 });
}
