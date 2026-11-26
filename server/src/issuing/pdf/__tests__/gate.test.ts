import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { IssuedDocumentRecord } from '../../../repositories/ports.js';
import { composeDocument } from '../../compose.js';
import { INKS } from '../model.js';
import { renderIssuedDocumentPdf } from '../render.js';
import { devDocumentSigner, signatureDetailsOf } from '../sign/index.js';
import { checkSignedPdf } from '../sign/verify.js';
import { DOCUMENT_STYLES } from '../styles.js';
import { inspectPdf, pageText } from './pdf-inspection.js';
import { IL_PACK } from '../../../jurisdictions/il/index.js';

/**
 * MUT-640 AC1–AC5, the three-script gate (Malafat's pdf-fonts gate, ADR-168 there): every style × he/ar/en over a
 * corpus where each document quotes the other scripts. Zero `.notdef` glyphs, every word extractable, the first word of
 * an RTL line drawn rightmost, only the document's ink. The PDFs land in server/.pdf-e2e for a human look.
 */
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../.pdf-e2e');

type Lang = 'he' | 'ar' | 'en';
const CORPUS: Record<Lang, { customer: string; lines: [string, string]; words: string[]; firstAndLast?: [string, string] }> = {
  he: {
    customer: 'Acme Digital Ltd.',
    lines: ['פיתוח אפליקציית Flutter (iOS + Android) ספרינט 3', 'חיבור ל־API של שע״ם (Invoices v1)'],
    words: ['חשבונית', 'מקור', 'Acme', 'Digital', 'פיתוח', 'Flutter', 'ספרינט', 'Invoices', '1042', '29,146.00', '₪', 'ברמג׳יאת'],
    firstAndLast: ['פיתוח', 'ספרינט'],
  },
  ar: {
    customer: 'שירותי הגליל בע״מ',
    lines: ['تطوير تطبيق Flutter (iOS + Android) الدورة 3', 'الربط مع API سلطة الضرائب (Invoices v1)'],
    words: ['فاتورة', 'ضريبية', 'שירותי', 'הגליל', 'تطوير', 'Flutter', 'الدورة', 'سلطة', '1042', '29,146.00', '₪', 'חשבונית'],
    firstAndLast: ['تطوير', 'الدورة'],
  },
  en: {
    customer: 'مكتب الناصرة للمحاسبة',
    lines: ['Flutter app development (iOS + Android) Sprint 3', 'SHAAM API integration (Invoices v1)'],
    words: ['Tax', 'Invoice', 'Original', 'مكتب', 'الناصرة', 'Flutter', 'Sprint', 'SHAAM', '1042', '29,146.00', '₪', 'חשבונית'],
  },
};

function fixture(lang: Lang, style: string, ink: 'BLACK' | 'BLUE'): IssuedDocumentRecord {
  const c = CORPUS[lang];
  return {
    id: '00000000-0000-4000-8000-000000000001',
    organizationId: '00000000-0000-4000-8000-000000000002',
    docType: 'TAX_INVOICE',
    number: 1042,
    documentDate: '2026-11-22',
    issuedAt: new Date('2026-11-22T10:00:00Z'),
    currency: 'ILS',
    subtotalMinor: 2_570_000n,
    discountMinor: 100_000n,
    netMinor: 2_470_000n,
    vatRateBasisPoints: 1800,
    vatMinor: 444_600n,
    grossMinor: 2_914_600n,
    pricesIncludeVat: false,
    issuer: { legalName: lang === 'ar' ? 'شركة برمجيات م.ض.' : lang === 'en' ? 'Barmajiyat Ltd.' : 'ברמג׳יאת בע״מ', vatId: '123456789', dealerType: 'COMPANY', address: lang === 'en' ? '12 Hermon St' : 'רח׳ החרמון 12', city: 'Nazareth', phone: '04-6123456', email: 'office@example.com', website: null },
    customerId: '00000000-0000-4000-8000-000000000003',
    customer: { name: c.customer },
    language: lang,
    style,
    ink,
    notes: null,
    originalId: null,
    paymentDetails: null,
    allocationNumber: '246813579',
    allocationSource: 'API',
    receivableId: null,
    paymentId: null,
    creditId: null,
    refundId: null,
    coreVersion: '1.0.0',
    jurisdiction: 'IL',
    jurisdictionPackVersion: '1.0.0',
    createdByUserId: '00000000-0000-4000-8000-000000000004',
    requestKey: 'k',
    lines: [
      { index: 1, description: c.lines[0], kind: 'SERVICE', quantityMilli: 40_000n, unitPriceMinor: 45_000n, discountMinor: 0n, netMinor: 1_800_000n, pricesIncludeVat: false, vatRateBasisPoints: 1800, vatMinor: 324_000n },
      { index: 2, description: c.lines[1], kind: 'SERVICE', quantityMilli: 1_000n, unitPriceMinor: 770_000n, discountMinor: 0n, netMinor: 770_000n, pricesIncludeVat: false, vatRateBasisPoints: 1800, vatMinor: 120_600n },
    ],
  };
}

const norm = (s: string) => s.normalize('NFKC').replace(/\s+/g, '');

const signer = devDocumentSigner();

describe.each(DOCUMENT_STYLES)('%s style', (style) => {
  // MUT-641: the gate runs on the signed file too, the one that actually leaves the system.
  it.each([
    ['he', false],
    ['ar', false],
    ['en', false],
    ['he', true],
    ['ar', true],
    ['en', true],
  ] as const)('%s (signed: %s): no missing glyphs, every word extractable, RTL order, ink only (AC1, AC3)', async (lang, signed) => {
    const doc = fixture(lang, style, 'BLACK');
    const rendered = await renderIssuedDocumentPdf(doc, { mark: 'ORIGINAL', originalNumber: null, logo: null });
    const bytes = signed ? await signer.sign(rendered, signatureDetailsOf(doc, new Date())) : rendered;
    if (signed) expect(checkSignedPdf(bytes).problems).toEqual([]);
    mkdirSync(OUT, { recursive: true });
    writeFileSync(path.join(OUT, `${style.toLowerCase()}-${lang}${signed ? '-signed' : ''}.pdf`), bytes);
    const pdf = await inspectPdf(bytes);
    expect(pdf.notdefGlyphs).toEqual([]);
    const text = norm(pdf.pages.map(pageText).join(''));
    const missing = CORPUS[lang].words.filter((w) => !text.includes(norm(w)));
    expect(missing).toEqual([]);
    const pair = CORPUS[lang].firstAndLast;
    if (pair) {
      const items = pdf.pages[0]!;
      const x = (w: string) => items.find((i) => norm(i.str).includes(norm(w)))!.x;
      expect(x(pair[0])).toBeGreaterThan(x(pair[1]));
    }
    expect(pdf.colours.filter((c) => c !== INKS.BLACK && c !== '#ffffff')).toEqual([]);
  });

  it('prints in blue ink only, with no other colour (AC3)', async () => {
    const bytes = await renderIssuedDocumentPdf(fixture('he', style, 'BLUE'), { mark: 'COPY', originalNumber: null, logo: null });
    writeFileSync(path.join(OUT, `${style.toLowerCase()}-he-blue.pdf`), bytes);
    const pdf = await inspectPdf(bytes);
    expect(pdf.colours.filter((c) => c !== INKS.BLUE.toLowerCase() && c !== '#ffffff')).toEqual([]);
    expect(norm(pageText(pdf.pages[0]!))).toContain(norm('העתק'));
  });
});

describe('the document keeps its own style (AC5)', () => {
  it('a document issued in Modern prints Modern, whatever the profile uses now', async () => {
    const modern = await inspectPdf(await renderIssuedDocumentPdf(fixture('en', 'MODERN', 'BLACK'), { mark: 'COPY', originalNumber: null, logo: null }));
    const professional = await inspectPdf(await renderIssuedDocumentPdf(fixture('en', 'PROFESSIONAL', 'BLACK'), { mark: 'COPY', originalNumber: null, logo: null }));
    const fontsOf = (p: typeof modern) => p.pages[0]!.length;
    expect(fontsOf(modern)).not.toBe(fontsOf(professional));
  });

  it('an unknown style prints as Professional', async () => {
    const bytes = await renderIssuedDocumentPdf(fixture('he', 'RETIRED_STYLE', 'BLACK'), { mark: 'COPY', originalNumber: null, logo: null });
    expect((await inspectPdf(bytes)).notdefGlyphs).toEqual([]);
  });
});

describe('logo and draft (AC4)', () => {
  // A 1×1 PNG: enough to prove the image is placed and the layout holds.
  const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63606060f80f00010401005fe5c34b0000000049454e44ae426082', 'hex');

  it.each(DOCUMENT_STYLES)('%s lays out with a logo and without one', async (style) => {
    for (const logo of [PNG, null]) {
      const pdf = await inspectPdf(await renderIssuedDocumentPdf(fixture('he', style, 'BLACK'), { mark: 'ORIGINAL', originalNumber: null, logo }));
      expect(pdf.pageCount).toBe(1);
      expect(pdf.notdefGlyphs).toEqual([]);
    }
  });

  it('a preview carries the draft mark', async () => {
    const pdf = await inspectPdf(await renderIssuedDocumentPdf(fixture('he', 'MINIMAL', 'BLACK'), { mark: 'DRAFT', originalNumber: null, logo: null }));
    expect(norm(pdf.pages.map(pageText).join(''))).toContain(norm('טיוטה'));
  });
});

describe('totals in the document\'s terms (review fixes 3, 4)', () => {
  it('an all-inclusive document with an exempt line shows the typed discount and the taxable and exempt amounts apart', async () => {
    const composed = composeDocument({ pack: IL_PACK,
      docType: 'TAX_INVOICE',
      currency: 'ILS',
      documentDate: '2026-11-22',
      dealerType: 'COMPANY',
      pricesIncludeVat: true,
      documentDiscountMinor: 11_800n,
      lines: [
        { description: 'Sprint', kind: 'SERVICE', quantityMilli: 1_000n, unitPriceMinor: 118_000n, discountMinor: 0n },
        { description: 'Fee', kind: 'SERVICE', quantityMilli: 1_000n, unitPriceMinor: 5_000n, discountMinor: 0n, vatExempt: true },
      ],
    });
    const doc = {
      ...fixture('he', 'PROFESSIONAL', 'BLACK'),
      ...composed,
      lines: composed.lines.map((l) => ({ index: l.index, description: l.description, kind: l.kind, quantityMilli: l.quantityMilli, unitPriceMinor: l.unitPriceMinor, discountMinor: l.discountMinor, netMinor: l.netMinor, pricesIncludeVat: l.pricesIncludeVat, vatRateBasisPoints: l.vatRateBasisPoints, vatMinor: l.vatMinor })),
    };
    const text = norm(pageText((await inspectPdf(await renderIssuedDocumentPdf(doc, { mark: 'ORIGINAL', originalNumber: null, logo: null }))).pages[0]!));
    expect(text).toContain(norm('1,230.00'));
    expect(text).toContain(norm('−118.00'));
    expect(text).toContain(norm('חייב'));
    expect(text).toContain(norm('פטור'));
    expect(text).toContain(norm(`${(Number(composed.grossMinor) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`));
  });
});
