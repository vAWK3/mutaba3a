import { CreditNoteIcon, IssuedReceiptIcon, TaxInvoiceIcon, TaxInvoiceReceiptIcon } from '../../../components/icons/generated';
import { useDirection } from '../../../lib/i18n/core';
import { useTheme } from '../../../lib/theme';
import type { IssuedDocType } from '../../api/client';
import issuedDark from './art/invoicing-doc-issued-dark.svg';
import issuedDarkRtl from './art/invoicing-doc-issued-dark-rtl.svg';
import issuedLight from './art/invoicing-doc-issued-light.svg';
import issuedLightRtl from './art/invoicing-doc-issued-light-rtl.svg';

/** MUT-570: each document type's icon (Claude Design batch 2, the M icon family). The credit note's arrow mirrors in RTL. */
export function DocTypeIcon({ type }: { type: IssuedDocType }) {
  switch (type) {
    case 'TAX_INVOICE':
      return <TaxInvoiceIcon className="hp-doc-icon" />;
    case 'TAX_INVOICE_RECEIPT':
      return <TaxInvoiceReceiptIcon className="hp-doc-icon" />;
    case 'RECEIPT':
      return <IssuedReceiptIcon className="hp-doc-icon" />;
    case 'CREDIT_NOTE':
      return <CreditNoteIcon className="hp-doc-icon hp-doc-icon--mirror" />;
    // MUT-662: the tax invoice's sheet until Claude Design draws the payment request's own icon (follow-up).
    case 'PAYMENT_REQUEST':
      return <TaxInvoiceIcon className="hp-doc-icon" />;
  }
}

/** The "document issued" art (batch 2, its end frame); light/dark × LTR/RTL. Decorative. */
export function DocIssuedArt() {
  const { resolvedTheme } = useTheme();
  const rtl = useDirection() === 'rtl';
  const src = resolvedTheme === 'dark' ? (rtl ? issuedDarkRtl : issuedDark) : rtl ? issuedLightRtl : issuedLight;
  return <img className="hp-issued-moment-art" src={src} alt="" width={120} height={100} decoding="async" />;
}
