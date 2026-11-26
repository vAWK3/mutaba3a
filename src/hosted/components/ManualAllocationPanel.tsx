import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { useLanguage } from '../../lib/i18n/core';
import { copyToClipboard } from '../../lib/utils';
import type { IssuedDocumentPreview } from '../api/client';
import { formatDecimal } from '../format/DecimalAmount';

export type ManualAllocation = NonNullable<IssuedDocumentPreview['allocation']>;

/** DD/MM/YYYY, as the Tax Authority's form takes it. Not an amount: a calendar date's parts. */
function allocationDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * MUT-711 (ADR-273, wireframe A "Number first, then issue"): the invoice needs an allocation number and MTB3A can't
 * request it. The panel lists what the Tax Authority's page asks for, each with Copy (and Copy all), links to that page
 * and takes the 9-digit number. The invoice number is the next one, shown as a preview: nothing is reserved, and the
 * server refuses the issue if another document takes it first. Digits read left to right in either language (ADR-101).
 * MUT-736 (ADR-282): on Starter the panel is the same (Basel, 2026-11-26: no explanatory hint lines; `automaticOn` is
 * on the wire for a future design, unused here).
 */
export function ManualAllocationPanel(props: {
  allocation: ManualAllocation;
  value: string;
  onChange: (value: string) => void;
  invalid: boolean;
  inputId: string;
  onChangeAmount: () => void;
}) {
  const { t, language } = useLanguage();
  const [copied, setCopied] = useState<string | null>(null);
  const { allocation } = props;
  const net = formatDecimal(allocation.net, 'ILS', language);
  const rows: { key: string; label: string; shown: string; copy: string }[] = [
    { key: 'number', label: t('hosted.issue.allocation.invoiceNumber'), shown: String(allocation.nextNumber), copy: String(allocation.nextNumber) },
    { key: 'date', label: t('hosted.issue.allocation.date'), shown: allocationDate(allocation.documentDate), copy: allocationDate(allocation.documentDate) },
    { key: 'net', label: t('hosted.issue.allocation.net'), shown: net, copy: allocation.net },
    { key: 'taxId', label: t('hosted.issue.allocation.customerTaxId'), shown: allocation.customerTaxId, copy: allocation.customerTaxId },
  ];
  const copy = async (key: string, text: string) => setCopied((await copyToClipboard(text)) ? key : 'failed');
  const all = rows.map((r) => `${r.label}: ${r.copy}`).join('\n');

  return (
    <section className="hp-issue-allocation" aria-labelledby={`${props.inputId}-title`} data-testid="issue-allocation">
      <h3 id={`${props.inputId}-title`}>{t('hosted.issue.allocation.title')}</h3>
      <p className="hp-issue-allocation-why">{t('hosted.issue.allocation.why')}</p>
      <p className="hp-issue-allocation-label">{t('hosted.issue.allocation.details')}</p>
      <dl className="hp-issue-allocation-details">
        {rows.map((r) => (
          <div key={r.key} data-testid={`issue-allocation-${r.key}`}>
            <dt>{r.label}</dt>
            <dd>
              <bdi dir="ltr">{r.shown}</bdi>
            </dd>
            <Button type="button" variant="ghost" size="sm" aria-label={t('hosted.issue.allocation.copyOne', { field: r.label })} onClick={() => void copy(r.key, r.copy)}>
              {t('hosted.copyField.copy')}
            </Button>
          </div>
        ))}
      </dl>
      <div className="hp-issue-allocation-actions">
        <Button type="button" variant="secondary" size="sm" onClick={() => void copy('all', all)} data-testid="issue-allocation-copy-all">
          {t('hosted.issue.allocation.copyAll')}
        </Button>
        <a className="hp-link" href={allocation.requestUrl} target="_blank" rel="noopener noreferrer" data-testid="issue-allocation-link">
          {t('hosted.issue.allocation.open')} <span className="sr-only">{t('common.opensInNewTab')}</span>
        </a>
      </div>
      <p className="form-hint" role="status" aria-live="polite">
        {copied === 'failed' ? t('hosted.copyField.failed') : copied ? t('hosted.copyField.copied') : ''}
      </p>
      <div className="form-group">
        <label className="form-label" htmlFor={props.inputId}>
          {t('hosted.issue.allocation.label')}
        </label>
        <input
          id={props.inputId}
          className="form-input hp-issue-allocation-input"
          dir="ltr"
          inputMode="numeric"
          autoComplete="off"
          maxLength={20}
          placeholder="123456789"
          value={props.value}
          aria-invalid={props.invalid ? true : undefined}
          aria-describedby={`${props.inputId}-note`}
          onChange={(e) => props.onChange(e.target.value)}
          data-testid="issue-allocation-input"
        />
        <p className={props.invalid ? 'form-error' : 'form-hint'} id={`${props.inputId}-note`}>
          {props.invalid ? t('hosted.issue.allocation.invalid') : t('hosted.issue.allocation.hint', { number: String(allocation.nextNumber) })}
        </p>
      </div>
      <p className="hp-issue-allocation-way-out">
        {t('hosted.issue.allocation.orChange')}{' '}
        <button type="button" className="hp-link-button" onClick={props.onChangeAmount} data-testid="issue-allocation-change-amount">
          {t('hosted.issue.allocation.changeAmount')}
        </button>
      </p>
    </section>
  );
}
