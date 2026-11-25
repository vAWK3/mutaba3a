import { fontRuns, type PdfFontFamily } from '../../pdf/fonts.js';
import type { PdfViewModel } from './model.js';

/**
 * MUT-640: the pieces every style builds from. Malafat's rules (ADR-168 there): every node declares its direction,
 * every table its `rtl`; numbers, ids, dates and amounts are their own left-to-right node (a run inside an RTL sentence
 * can reorder digits); no letter-spacing on RTL; text is split into runs by glyph coverage.
 */
export type Node = Record<string, unknown>;

export interface Kit {
  vm: PdfViewModel;
  chain: readonly PdfFontFamily[];
  start: 'left' | 'right';
  end: 'left' | 'right';
  /** Text in the document's language (or anything a person typed): its own font runs, the document's direction. */
  text(value: string, style?: Node): Node;
  /** A number, id, date or amount: always a left-to-right node, aligned to `align`. */
  num(value: string, style?: Node): Node;
  /** The ink's horizontal rule. */
  rule(width?: number, margin?: [number, number, number, number], length?: number): Node;
  /** "label value" on one line, the value as its own LTR node. */
  pair(label: string, value: string, style?: Node): Node;
}

export function kit(vm: PdfViewModel, chain: readonly PdfFontFamily[]): Kit {
  const start = vm.rtl ? 'right' : 'left';
  const end = vm.rtl ? 'left' : 'right';
  const runs = (value: string) => fontRuns(value, chain).map((r) => ({ text: r.text, font: r.font }));
  const k: Kit = {
    vm,
    chain,
    start,
    end,
    text: (value, style = {}) => ({ text: runs(value), alignment: start, baseDirection: vm.rtl ? 'rtl' : 'ltr', color: vm.ink, ...style }),
    num: (value, style = {}) => ({ text: runs(value), alignment: end, baseDirection: 'ltr', color: vm.ink, ...style }),
    rule: (width = 1, margin = [0, 6, 0, 6], length = 515) => ({ canvas: [{ type: 'line', x1: 0, y1: 0, x2: length, y2: 0, lineWidth: width, lineColor: vm.ink }], margin }),
    pair: (label, value, style = {}) => ({
      columns: vm.rtl
        ? [{ ...k.num(value, { alignment: 'left' }), width: '*' }, { ...k.text(label), width: 'auto' }]
        : [{ ...k.text(label), width: 'auto' }, { ...k.num(value, { alignment: 'right' }), width: '*' }],
      columnGap: 12,
      ...style,
    }),
  };
  return k;
}

/** The lines table's body: header row, then one row per line; columns in logical order (`rtl` mirrors them). */
export function lineRows(k: Kit, opts: { withUnitPrice: boolean; header: Node; cell: Node }): Node[][] {
  const { vm } = k;
  const l = vm.labels;
  const head = [
    k.text(l.colIndex, opts.header),
    k.text(l.colDescription, opts.header),
    k.num(l.colQty, { ...opts.header, baseDirection: vm.rtl ? 'rtl' : 'ltr' }),
    ...(opts.withUnitPrice ? [k.num(l.colUnitPrice, { ...opts.header, baseDirection: vm.rtl ? 'rtl' : 'ltr' })] : []),
    k.num(l.colAmount, { ...opts.header, baseDirection: vm.rtl ? 'rtl' : 'ltr' }),
  ];
  const rows = vm.lines.map((line) => [
    k.num(line.index, { ...opts.cell, alignment: k.start }),
    { stack: [k.text(line.description, opts.cell), ...(line.exempt ? [k.text(l.vatExemptLine, { ...opts.cell, fontSize: 8 })] : [])] },
    k.num(line.quantity, opts.cell),
    ...(opts.withUnitPrice ? [k.num(line.unitPrice, opts.cell)] : []),
    k.num(line.amount, opts.cell),
  ]);
  return [head, ...rows];
}

/** pdfmake's page footer: the MTB3A line and "page x of y", each in the document's direction. */
export function footer(k: Kit, size = 8) {
  return (page: number, of: number): Node => ({
    columns: k.vm.rtl
      ? [k.text(k.vm.labels.page(page, of), { fontSize: size, alignment: 'left' }), k.text(k.vm.footer, { fontSize: size })]
      : [k.text(k.vm.footer, { fontSize: size }), k.text(k.vm.labels.page(page, of), { fontSize: size, alignment: 'right' })],
    margin: [40, 10, 40, 0],
  });
}

export function logoNode(k: Kit, fit: [number, number]): Node | null {
  if (!k.vm.logo) return null;
  const png = k.vm.logo.subarray(0, 4).toString('hex') === '89504e47';
  return { image: `data:image/${png ? 'png' : 'jpeg'};base64,${k.vm.logo.toString('base64')}`, fit };
}

/** MUT-662: the framed "not a tax invoice" line (in the ink colour, never wrapped away). */
function noticeBox(k: Kit): Node {
  return { margin: [0, 6, 0, 8], table: { widths: ['*'], body: [[k.text(k.vm.notice ?? '', { bold: true, fontSize: 10, alignment: 'center', margin: [6, 4, 6, 4] })]] }, layout: { hLineColor: () => k.vm.ink, vLineColor: () => k.vm.ink } };
}

/** The document-level parts every style shares: page, fonts, direction, the draft watermark. */
export function documentFrame(k: Kit, content: Node[], margins: [number, number, number, number], footerSize?: number): Node {
  return {
    pageSize: 'A4',
    pageMargins: margins,
    defaultStyle: { font: k.chain[0], fontSize: 10, baseDirection: k.vm.rtl ? 'rtl' : 'ltr', color: k.vm.ink, lineHeight: 1.25 },
    ...(k.vm.isDraft ? { watermark: { text: k.vm.mark, color: k.vm.ink, opacity: 0.08, bold: true, font: k.chain[0] } } : {}),
    info: { title: `${k.vm.title} ${k.vm.number}`, creator: 'MTB3A', producer: 'MTB3A' },
    footer: footer(k, footerSize),
    // MUT-662 (D16): a payment request's framed notice sits right under the header, in every style.
    content: k.vm.notice ? [...content.slice(0, 1), noticeBox(k), ...content.slice(1)] : content,
  };
}
