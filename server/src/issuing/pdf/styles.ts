import type { PdfFontFamily } from '../../pdf/fonts.js';
import type { DocumentLanguage } from '../labels.js';
import { documentFrame, kit, lineRows, logoNode, type Kit, type Node } from './layout.js';
import type { PdfViewModel } from './model.js';

/**
 * MUT-640: the document styles a business chooses (Basel, 2026-11-22; canvas https://claude.ai/artifact/EevXQWU3AyFvJxugLTGrNC).
 * Each is a layout over the same view model: they differ in layout, typeface, size and information architecture,
 * never in colour (black or blue ink on white). A new style is one entry here plus its fixtures in the gate test.
 */
export const DOCUMENT_STYLES = ['PROFESSIONAL', 'MODERN', 'MINIMAL'] as const;
export type DocumentStyle = (typeof DOCUMENT_STYLES)[number];

interface StyleDefinition {
  fonts: Record<DocumentLanguage, readonly PdfFontFamily[]>;
  layout: (k: Kit) => Node;
}

const cell = (padding = 4) => ({ margin: [padding, padding, padding, padding] as [number, number, number, number] });

function parties(k: Kit, opts: { boxed: boolean; nameSize: number }): Node {
  const { vm } = k;
  const customer = vm.customer
    ? { stack: [k.text(vm.labels.billTo, { bold: true, fontSize: 9 }), k.text(vm.customer.name, { bold: true, fontSize: opts.nameSize }), ...(vm.customer.idLine ? [k.text(vm.customer.idLine)] : []), ...(vm.customer.address ? [k.text(vm.customer.address)] : [])] }
    : { text: '' };
  const meta = { stack: vm.meta.map((m) => k.pair(m.label, m.value, { margin: [0, 1, 0, 1] })) };
  const box = (n: Node) => (opts.boxed ? { table: { widths: ['*'], body: [[{ ...n, ...cell(8) }]] }, layout: { hLineColor: () => vm.ink, vLineColor: () => vm.ink, hLineWidth: () => 1, vLineWidth: () => 1 } } : n);
  const cols = [box(customer), box(meta)];
  return { columns: vm.rtl ? cols : cols, columnGap: 16, margin: [0, 8, 0, 8] };
}

/**
 * The business's details, at the start side: right-to-left text in pdfmake-rtl keeps to its start edge, so an
 * end-aligned RTL block drifts (D-PDF5: the logo takes the end side instead).
 */
function issuerBlock(k: Kit, nameSize: number): Node {
  const { vm } = k;
  return {
    stack: [
      k.text(vm.issuer.name, { bold: true, fontSize: nameSize }),
      ...(vm.issuer.idLine ? [k.text(vm.issuer.idLine)] : []),
      ...(vm.issuer.address ? [k.text(vm.issuer.address)] : []),
      ...vm.issuer.contact.map((c) => k.num(c, { alignment: k.start })),
    ],
  };
}

/** The original/copy/draft mark in a box that never wraps. */
function markBox(k: Kit, size: number): Node {
  return { width: 80, table: { widths: ['*'], body: [[k.text(k.vm.mark, { bold: true, fontSize: size, alignment: 'center', noWrap: true, margin: [4, 2, 4, 2] })]] }, layout: { hLineColor: () => k.vm.ink, vLineColor: () => k.vm.ink } };
}

function totalsBlock(k: Kit, opts: { boxed: boolean; grandSize: number; width: number }): Node {
  const { vm } = k;
  const rows = [
    ...vm.totals.map((t) => k.pair(t.label, t.value, { margin: [0, 2, 0, 2] })),
    { ...k.rule(opts.boxed ? 2 : 1.5, [0, 4, 0, 4], opts.width) },
    k.pair(vm.grand.label, vm.grand.value, { bold: true, fontSize: opts.grandSize }),
    ...(vm.pricesIncludeVat ? [k.text(vm.labels.vatIncluded, { fontSize: 8, margin: [0, 2, 0, 0] })] : []),
  ];
  const block = { width: opts.width, stack: rows };
  const spacer = { width: '*', text: '' };
  // The totals sit at the end side: right in English, left in Hebrew and Arabic.
  return { columns: vm.rtl ? [block, spacer] : [spacer, block], margin: [0, 10, 0, 10] };
}

function closing(k: Kit, size = 9): Node[] {
  const { vm } = k;
  return [
    ...(vm.payment.length ? [{ stack: vm.payment.map((p) => k.pair(p.label, p.value, { fontSize: size })), margin: [0, 6, 0, 6] }] : []),
    ...(vm.notes ? [k.text(vm.labels.notes, { bold: true, fontSize: size }), k.text(vm.notes, { fontSize: size })] : []),
  ];
}

function linesTable(k: Kit, opts: { widths: (string | number)[]; withUnitPrice: boolean; grid: boolean; headerRule: number; padding: number }): Node {
  const { vm } = k;
  const body = lineRows(k, { withUnitPrice: opts.withUnitPrice, header: { bold: true, fontSize: 9 }, cell: {} });
  return {
    table: { headerRows: 1, widths: opts.widths, body },
    rtl: vm.rtl,
    layout: {
      hLineWidth: (i: number, node: { table: { body: unknown[] } }) => (i === 1 ? opts.headerRule : opts.grid || i === 0 || i === node.table.body.length ? 1 : 0.5),
      vLineWidth: () => (opts.grid ? 1 : 0),
      hLineColor: () => vm.ink,
      vLineColor: () => vm.ink,
      paddingTop: () => opts.padding,
      paddingBottom: () => opts.padding,
    },
    margin: [0, 6, 0, 0],
  };
}

const PROFESSIONAL: StyleDefinition = {
  fonts: { he: ['FrankRuhl', 'ThmanyahSerif'], en: ['FrankRuhl', 'ThmanyahSerif'], ar: ['ThmanyahSerif', 'FrankRuhl'] },
  layout: (k) => {
    const { vm } = k;
    const logo = logoNode(k, [120, 60]);
    const logoCol = { width: 130, stack: [logo ?? { text: '' }] };
    const head = { columns: vm.rtl ? [logoCol, { width: '*', ...issuerBlock(k, 15) }] : [{ width: '*', ...issuerBlock(k, 15) }, logoCol], columnGap: 20 };
    const titleRow = {
      columns: [
        { stack: [k.text(`${vm.title} ${vm.labels.no} `, { bold: true, fontSize: 20 }), ...(vm.legalTitle ? [k.text(vm.legalTitle, { fontSize: 11 })] : [])], width: '*' },
        markBox(k, 11),
      ].map((c) => c),
      columnGap: 12,
    };
    const number = k.num(vm.number, { bold: true, fontSize: 20, alignment: k.start });
    return documentFrame(k, [head, k.rule(3, [0, 10, 0, 10]), { ...titleRow, columns: vm.rtl ? [...titleRow.columns].reverse() : titleRow.columns }, number, parties(k, { boxed: true, nameSize: 12 }), linesTable(k, { widths: [18, '*', 40, 70, 75], withUnitPrice: true, grid: true, headerRule: 2, padding: 4 }), totalsBlock(k, { boxed: true, grandSize: 13, width: 230 }), ...closing(k)], [40, 44, 40, 50]);
  },
};

const MODERN: StyleDefinition = {
  fonts: { he: ['PlexHebrew', 'ThmanyahSans'], en: ['PlexLatin', 'PlexHebrew', 'ThmanyahSans'], ar: ['ThmanyahSans', 'PlexHebrew'] },
  layout: (k) => {
    const { vm } = k;
    const logo = logoNode(k, [96, 48]);
    const logoCol = { width: '*', stack: [logo ?? { text: '' }] };
    const top = { columns: vm.rtl ? [markBox(k, 9), logoCol] : [logoCol, markBox(k, 9)] };
    const strip = {
      columns: [...vm.meta, vm.grand].map((m) => ({ stack: [k.text(m.label, { fontSize: 8 }), k.num(m.value, { bold: true, fontSize: 12, alignment: k.start })] })),
      columnGap: 12,
      margin: [0, 6, 0, 10],
    };
    return documentFrame(
      k,
      [
        top,
        k.text(vm.title, { bold: true, fontSize: 28, margin: [0, 14, 0, 0] }),
        k.num(`${vm.labels.no} ${vm.number}`, { fontSize: 18, alignment: k.start }),
        ...(vm.legalTitle ? [k.text(vm.legalTitle, { fontSize: 10 })] : []),
        k.rule(2, [0, 10, 0, 6]),
        { ...strip, columns: vm.rtl ? [...strip.columns].reverse() : strip.columns },
        { columns: vm.rtl ? [vm.customer ? partiesStack(k, vm.labels.billTo, vm.customer) : { text: '' }, partiesStack(k, vm.labels.from, { name: vm.issuer.name, idLine: vm.issuer.idLine, address: vm.issuer.address })] : [partiesStack(k, vm.labels.from, { name: vm.issuer.name, idLine: vm.issuer.idLine, address: vm.issuer.address }), vm.customer ? partiesStack(k, vm.labels.billTo, vm.customer) : { text: '' }], columnGap: 24 },
        linesTable(k, { widths: [16, '*', 40, 70, 75], withUnitPrice: true, grid: false, headerRule: 2, padding: 7 }),
        totalsBlock(k, { boxed: false, grandSize: 18, width: 250 }),
        ...closing(k),
      ],
      [40, 40, 40, 50],
    );
  },
};

function partiesStack(k: Kit, heading: string, party: { name: string; idLine: string | null; address: string | null }): Node {
  return { stack: [k.text(heading, { fontSize: 8, bold: true }), k.text(party.name, { bold: true, fontSize: 12 }), ...(party.idLine ? [k.text(party.idLine)] : []), ...(party.address ? [k.text(party.address)] : [])], margin: [0, 4, 0, 8] };
}

const MINIMAL: StyleDefinition = {
  fonts: { he: ['Assistant', 'ThmanyahSans'], en: ['Assistant', 'ThmanyahSans'], ar: ['ThmanyahSans', 'Assistant'] },
  layout: (k) => {
    const { vm } = k;
    const logo = logoNode(k, [72, 36]);
    const title = { stack: [k.text(`${vm.title}`, { bold: true, fontSize: 15 }), k.num(vm.number, { fontSize: 15, alignment: k.start }), k.text(vm.legalTitle ? `${vm.mark} · ${vm.legalTitle}` : vm.mark, { fontSize: 8 })] };
    const issuerLine = [vm.issuer.name, vm.issuer.idLine, vm.issuer.address, ...vm.issuer.contact].filter(Boolean).join(' · ');
    return documentFrame(
      k,
      [
        { columns: vm.rtl ? [logo ?? { text: '' }, title].reverse() : [title, logo ?? { text: '' }] },
        parties(k, { boxed: false, nameSize: 11 }),
        linesTable(k, { widths: [14, '*', 36, 64, 70], withUnitPrice: true, grid: false, headerRule: 0.75, padding: 6 }),
        totalsBlock(k, { boxed: false, grandSize: 14, width: 220 }),
        ...closing(k, 8),
        k.text(issuerLine, { fontSize: 8, margin: [0, 24, 0, 0] }),
      ],
      [56, 56, 56, 50],
      7,
    );
  },
};

const STYLES: Record<DocumentStyle, StyleDefinition> = { PROFESSIONAL, MODERN, MINIMAL };

/** The style a document was issued in; an unknown key (a style added later, then rolled back) prints as Professional. */
export function styleOf(key: string): DocumentStyle {
  return (DOCUMENT_STYLES as readonly string[]).includes(key) ? (key as DocumentStyle) : 'PROFESSIONAL';
}

export function layoutDocument(vm: PdfViewModel, style: DocumentStyle): Node {
  const definition = STYLES[style];
  return definition.layout(kit(vm, definition.fonts[vm.language]));
}
