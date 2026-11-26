import { useLanguage } from '../../../lib/i18n/core';
import type { Currency, InvoiceSplitRow } from '../../api/client';
import { formatDecimal } from '../../format/DecimalAmount';

/**
 * MUT-660 (wireframe screen 6): Reports' income split on an invoicing profile. Per currency, never summed across
 * currencies: Invoice income (it has its document, or is due one), Not for invoice (marked, or a No document client)
 * and All income, their sum, which is the period's received. Rows that are all zero are left out.
 */
export function InvoiceSplitCard({ rows }: { rows: readonly InvoiceSplitRow[] }) {
  const { t, language } = useLanguage();
  const shown = rows.filter((r) => r.all !== '0.00');
  if (shown.length === 0) return null;
  const money = (value: string, currency: string) => <bdi className="hp-num">{formatDecimal(value, currency as Currency, language)}</bdi>;
  return (
    <section className="hp-report-section hp-split" aria-labelledby="hp-split-title" data-testid="invoice-split">
      <h2 id="hp-split-title">
        {t('hosted.reports.invoiceSplit.title')}
      </h2>
      <div className="hp-split-grid">
        {shown.map((r) => (
          <dl key={r.currency} className="hp-split-currency" aria-label={r.currency}>
            <div>
              <dt>
                {t('hosted.reports.invoiceSplit.invoice')}
              </dt>
              <dd>{money(r.invoiceIncome, r.currency)}</dd>
            </div>
            <div>
              <dt>
                {t('hosted.reports.invoiceSplit.notForInvoice')}
              </dt>
              <dd>{money(r.notForInvoice, r.currency)}</dd>
            </div>
            <div className="hp-split-sum">
              <dt>{t('hosted.reports.invoiceSplit.all')}</dt>
              <dd>{money(r.all, r.currency)}</dd>
            </div>
          </dl>
        ))}
      </div>
    </section>
  );
}
