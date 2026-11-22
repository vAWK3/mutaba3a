import { useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Button } from '../../../components/ui/Button';
import { useLanguage } from '../../../lib/i18n/core';
import { ApiError, api, type Currency, type HostedProfile, type IssuedDocType, type IssuedDocument, type IssuedDocumentListItem } from '../../api/client';
import { useDocumentsDue } from '../../data/documentsDueQueries';
import { LEDGER_PERIODS, type LedgerPeriod } from '../../data/filters';
import { periodRange } from '../../data/statementQueries';
import { IssueDocumentDrawer, type IssueStart } from '../../components/IssueDocumentDrawer';
import { Skeleton } from '../../components/QueryView';
import { useToast } from '../../components/Toast';
import { SectionTabs } from '../../components/SectionTabs';
import { openPdf, useIssuedDocument, useIssuedDocuments } from '../../data/issuedQueries';
import { useIssuingSetup } from '../../data/issuingQueries';
import { formatDecimal } from '../../format/DecimalAmount';
import { profileKey, useWritableFor } from '../../session/me';
import { useAttemptKey } from '../../data/attemptKey';
import { DocIssuedArt, DocTypeIcon } from './docTypeIcons';
import { documentTabs } from './issuedTabs';
import { PageHeader, useBackTo } from './shared';

/**
 * MUT-570: issued documents in the portal. Documents gets two tabs where issuing is on for the profile: Issued (this
 * page) and Files (the attachments page). One primary action, Issue a document; each row opens the document's page.
 * Nothing about an issued document changes after it is issued: its page offers what comes next (a receipt for what's
 * still owed, a credit note, a similar document) and its PDF.
 */

const docTitle = (t: (key: string) => string, doc: Pick<IssuedDocument, 'docType' | 'number'>) => `${t(`hosted.issue.types.${doc.docType}`)} ${doc.number}`;
const customerName = (doc: IssuedDocument) => (typeof doc.customer.name === 'string' ? doc.customer.name : '');

export function IssuedDocumentsPage({ profile, customerId }: { profile: HostedProfile; customerId?: string }) {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const setup = useIssuingSetup(profile.id);
  // MUT-664: on a client's Documents tab, filters by type, currency and period, and what is settled on each.
  const [docType, setDocType] = useState<IssuedDocType | ''>('');
  const [currency, setCurrency] = useState<Currency | ''>('');
  const [period, setPeriod] = useState<LedgerPeriod>('all');
  const filter = customerId ? { customerId, ...(docType ? { docType } : {}), ...(currency ? { currency } : {}), ...periodRange(period) } : {};
  const documents = useIssuedDocuments(profile.id, filter, !!setup.data);
  const due = useDocumentsDue(profile.id, 'to-issue', 0, !!customerId && !!setup.data);
  const dueHere = customerId ? (due.data?.groups.find((g) => g.customerId === customerId)?.items.length ?? 0) : 0;
  const writable = useWritableFor(profile) && profile.owned === true;
  const [drawer, setDrawer] = useState<IssueStart | null>(null);
  if (setup.error instanceof ApiError && setup.error.status === 404) return null;

  return (
    <section className="hp-issued" aria-labelledby="hp-issued-title">
      {!customerId && <IssuedHeader />}
      {!customerId && <SectionTabs {...documentTabs(profile.id, t)} />}
      <div className="hp-issued-head">
        <h2 id="hp-issued-title">{t('hosted.issue.listTitle')}</h2>
        {dueHere > 0 && (
          <Link className="hp-link" to={`/p/${profile.id}/documents/to-issue`} data-testid="client-docs-due">
            {t('hosted.client.documentsTab.toIssue', { count: String(dueHere) })}
          </Link>
        )}
        {writable && (
          <Button onClick={() => setDrawer(customerId ? { customerId } : {})} data-testid="issue-open">
            {customerId ? t('hosted.issue.forThisClient') : t('hosted.issue.open')}
          </Button>
        )}
      </div>
      {customerId && (
        <div className="hp-ledger-controls" data-testid="client-docs-filters">
          <select aria-label={t('hosted.client.documentsTab.type')} value={docType} onChange={(e) => setDocType(e.target.value as IssuedDocType | '')}>
            <option value="">{t('hosted.client.documentsTab.allTypes')}</option>
            {(['TAX_INVOICE', 'TAX_INVOICE_RECEIPT', 'RECEIPT', 'CREDIT_NOTE'] as const).map((type) => (
              <option key={type} value={type}>
                {t(`hosted.issue.types.${type}`)}
              </option>
            ))}
          </select>
          <select aria-label={t('hosted.client.documentsTab.currency')} value={currency} onChange={(e) => setCurrency(e.target.value as Currency | '')}>
            <option value="">{t('hosted.client.documentsTab.allCurrencies')}</option>
            {(['ILS', 'USD', 'EUR', 'JOD'] as const).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select aria-label={t('hosted.ledger.period')} value={period} onChange={(e) => setPeriod(e.target.value as LedgerPeriod)}>
            {LEDGER_PERIODS.map((p) => (
              <option key={p} value={p}>
                {t(`hosted.ledger.periods.${p}`)}
              </option>
            ))}
          </select>
        </div>
      )}
      {!documents.data ? (
        <Skeleton />
      ) : documents.data.items.length === 0 ? (
        <p className="hp-muted" data-testid="issued-empty">
          {t('hosted.issue.empty')}
        </p>
      ) : (
        <table className="hp-issued-table">
          <thead>
            <tr>
              <th scope="col">{t('hosted.issue.colDocument')}</th>
              {!customerId && <th scope="col">{t('hosted.issue.colClient')}</th>}
              <th scope="col">{t('hosted.issue.colDate')}</th>
              <th scope="col" className="hp-num">
                {t('hosted.issue.colAmount')}
              </th>
              {customerId && <th scope="col">{t('hosted.client.documentsTab.status')}</th>}
            </tr>
          </thead>
          <tbody>
            {documents.data.items.map((doc) => (
              <tr key={doc.id}>
                <td>
                  <Link className="hp-link hp-issued-doc" to={`/p/${profile.id}/documents/issued/${doc.id}`}>
                    <DocTypeIcon type={doc.docType} />
                    {docTitle(t, doc)}
                  </Link>
                </td>
                {!customerId && <td dir="auto">{customerName(doc)}</td>}
                <td>{doc.documentDate}</td>
                <td className="hp-num">{formatDecimal(doc.gross, doc.currency as Currency, language)}</td>
                {customerId && <td data-testid="client-doc-status">{settlementText(t, doc, language)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {drawer && (
        <IssueDocumentDrawer
          profile={profile}
          start={drawer}
          onClose={() => setDrawer(null)}
          onIssued={(doc) => {
            setDrawer(null);
            void navigate({ to: `/p/${profile.id}/documents/issued/${doc.id}`, search: { issued: true } });
          }}
        />
      )}
    </section>
  );
}

/** D22: "Partly paid · 1,500 of 6,000 ₪"; a credit note has no settlement. */
function settlementText(t: (key: string, vars?: Record<string, string>) => string, doc: IssuedDocumentListItem, language: Parameters<typeof formatDecimal>[2]): string {
  if (!doc.settlement) return '';
  const label = t(`hosted.client.documentsTab.settlement.${doc.settlement}`);
  if (doc.settlement !== 'PARTLY_PAID' || !doc.settled) return label;
  const currency = doc.currency as Currency;
  return `${label} · ${t('hosted.client.documentsTab.settledOf', { settled: formatDecimal(doc.settled, currency, language), gross: formatDecimal(doc.gross, currency, language) })}`;
}

/** The Documents page's own header, as Files has it (one level in under Clients, MUT-424). */
function IssuedHeader() {
  const { t } = useLanguage();
  return <PageHeader title={t('hosted.documents.title')} back={useBackTo('clients')} />;
}

/** One issued document: the PDF, what's still owed, and what can follow it. It never changes. */
export function IssuedDocumentPage({ profile, documentId, justIssued }: { profile: HostedProfile; documentId: string; justIssued: boolean }) {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const doc = useIssuedDocument(profile.id, documentId);
  const receivableId = doc.data?.receivableId ?? null;
  const owed = useQuery({
    queryKey: profileKey(profile.id, 'receivable', receivableId ?? ''),
    queryFn: () => api.receivable(profile.id, receivableId!),
    enabled: !!receivableId,
  });
  const writable = useWritableFor(profile) && profile.owned === true;
  const [drawer, setDrawer] = useState<IssueStart | null>(null);
  const [busy, setBusy] = useState(false);
  const attempt = useAttemptKey();
  const toast = useToast();
  if (doc.error) return <p className="hp-muted" role="alert">{t('hosted.issue.notFound')}</p>;
  if (!doc.data) return <Skeleton />;
  const d = doc.data;
  const outstanding = owed.data?.outstanding ?? null;
  const owing = outstanding !== null && outstanding !== '0.00';
  // Each line keeps its own VAT basis: whether its price included VAT, and whether it was exempt (review fix).
  const lines = d.lines.map((l) => ({
    description: l.description,
    kind: (l.kind === 'GOODS' ? 'GOODS' : 'SERVICE') as 'GOODS' | 'SERVICE',
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    discount: l.discount === '0.00' ? '' : l.discount,
    pricesIncludeVat: l.pricesIncludeVat,
    ...(l.vatRateBasisPoints === 0 ? { vatExempt: true } : {}),
  }));
  // A credit note credits only what is still owed: after a part payment, one line for that amount, VAT included.
  const partlyPaid = owing && outstanding !== d.gross;
  const creditLines = partlyPaid
    ? [{ description: t('hosted.issue.creditLine', { document: docTitle(t, d) }), kind: 'SERVICE' as const, quantity: '1', unitPrice: outstanding!, discount: '', pricesIncludeVat: true, ...(d.lines.every((l) => l.vatRateBasisPoints === 0) ? { vatExempt: true } : {}) }]
    : lines;
  const pdf = async (produce: boolean) => {
    setBusy(true);
    try {
      const filename = `${docTitle(t, d)}.pdf`;
      openPdf(produce ? await api.producePdf(profile.id, d.id, attempt.keyFor({ document: d.id })) : await api.viewPdf(profile.id, d.id), filename);
      if (produce) attempt.succeeded();
    } catch {
      toast(t('hosted.issue.pdfFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="hp-issued-doc-page" aria-labelledby="hp-issued-doc-title">
      <Link className="hp-link hp-sharing-back" to={`/p/${profile.id}/documents/issued`}>
        <span className="hp-sharing-back-arrow" aria-hidden="true">
          ‹
        </span>{' '}
        {t('hosted.issue.backToList')}
      </Link>
      {justIssued && (
        <div className="hp-issued-moment" role="status" data-testid="issued-moment">
          <DocIssuedArt />
          <strong>{t('hosted.issue.issuedTitle', { document: docTitle(t, d) })}</strong>
          <span>{t('hosted.issue.issuedBody')}</span>
        </div>
      )}
      <h1 id="hp-issued-doc-title" className="hp-sharing-title" data-testid="issued-doc-title">
        <DocTypeIcon type={d.docType} /> {docTitle(t, d)}
      </h1>
      <dl className="hp-issued-facts">
        <div>
          <dt>{t('hosted.issue.colClient')}</dt>
          <dd dir="auto">{customerName(d) || '—'}</dd>
        </div>
        <div>
          <dt>{t('hosted.issue.colDate')}</dt>
          <dd>{d.documentDate}</dd>
        </div>
        <div>
          <dt>{t('hosted.issue.gross')}</dt>
          <dd>{formatDecimal(d.gross, 'ILS', language)}</dd>
        </div>
        {outstanding !== null && (
          <div>
            <dt>{t('hosted.issue.outstanding')}</dt>
            <dd data-testid="issued-outstanding">{formatDecimal(outstanding, 'ILS', language)}</dd>
          </div>
        )}
        {d.allocationNumber && (
          <div>
            <dt>{t('hosted.issue.allocationNumber')}</dt>
            <dd dir="ltr">{d.allocationNumber}</dd>
          </div>
        )}
      </dl>
      <div className="hp-issued-actions">
        <Button onClick={() => void pdf(true)} disabled={busy} data-testid="issued-download">
          {t('hosted.issue.downloadPdf')}
        </Button>
        <Button variant="secondary" onClick={() => void pdf(false)} disabled={busy}>
          {t('hosted.issue.viewPdf')}
        </Button>
        {writable && d.docType === 'TAX_INVOICE' && owing && (
          <Button variant="secondary" data-testid="issued-receipt" onClick={() => setDrawer({ docType: 'RECEIPT', customerId: d.customerId ?? undefined, appliesToDocumentId: d.id, lines: [{ description: t('hosted.issue.receiptLine', { document: docTitle(t, d) }), kind: 'SERVICE', quantity: '1', unitPrice: outstanding!, discount: '' }] })}>
            {t('hosted.issue.recordPayment')}
          </Button>
        )}
        {writable && d.docType === 'TAX_INVOICE' && owing && (
          <Button variant="secondary" data-testid="issued-credit" onClick={() => setDrawer({ docType: 'CREDIT_NOTE', customerId: d.customerId ?? undefined, originalId: d.id, lines: creditLines, pricesIncludeVat: partlyPaid ? true : d.pricesIncludeVat })}>
            {t('hosted.issue.creditNote')}
          </Button>
        )}
        {writable && d.docType !== 'CREDIT_NOTE' && (
          <Button variant="ghost" onClick={() => setDrawer({ docType: d.docType, customerId: d.customerId ?? undefined, lines, pricesIncludeVat: d.pricesIncludeVat })}>
            {t('hosted.issue.similar')}
          </Button>
        )}
      </div>
      <p className="hp-muted">{t('hosted.issue.finalNote')}</p>
      {drawer && (
        <IssueDocumentDrawer
          profile={profile}
          start={drawer}
          onClose={() => setDrawer(null)}
          onIssued={(next) => {
            setDrawer(null);
            void navigate({ to: `/p/${profile.id}/documents/issued/${next.id}`, search: { issued: true } });
          }}
        />
      )}
    </article>
  );
}
