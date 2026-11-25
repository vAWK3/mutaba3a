import { useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { useLanguage } from '../../../lib/i18n/core';
import { ApiError, api, type Currency, type HostedProfile, type IssuedDocType, type IssuedDocument, type IssuedDocumentListItem } from '../../api/client';
import { useDocumentsDue } from '../../data/documentsDueQueries';
import { LEDGER_PERIODS, type LedgerPeriod } from '../../data/filters';
import { periodRange } from '../../data/statementQueries';
import { IssueDocumentDrawer, type IssueStart } from '../../components/IssueDocumentDrawer';
import { Skeleton } from '../../components/QueryView';
import { useToast } from '../../components/Toast';
import { SectionTabs } from '../../components/SectionTabs';
import { openPdf, useCancelPaymentRequest, useIssuedDocument, useIssuedDocuments } from '../../data/issuedQueries';
import { useIssuer } from '../../data/issuingQueries';
import { useIssuingSetup } from '../../data/issuingQueries';
import { formatDecimal } from '../../format/DecimalAmount';
import { profileKey, useWritableFor } from '../../session/me';
import { useAttemptKey } from '../../data/attemptKey';
import { parseAmountToMinor } from '../../../lib/utils';
import { minorDigitsToDecimal } from '../../lib/receiptSuggestion';
import { DocIssuedArt, DocTypeIcon } from './docTypeIcons';
import { documentTabs } from './issuedTabs';
import { PageHeader, useBackTo } from './shared';

/**
 * MUT-570: issued documents in the portal. Documents gets two tabs where issuing is on for the profile: Issued (this
 * page) and Files (the attachments page). One primary action, Issue a document; each row opens the document's page.
 * Nothing about an issued document changes after it is issued: its page offers what comes next (a receipt for what's
 * still owed, a credit note, a similar document) and its PDF.
 */

// MUT-662: the number as shown (PR-0007 for a payment request).
const docTitle = (t: (key: string) => string, doc: Pick<IssuedDocument, 'docType' | 'number' | 'displayNumber'>) => `${t(`hosted.issue.types.${doc.docType}`)} ${doc.displayNumber ?? doc.number}`;

/** MUT-662: how much of a request is covered, a whole percent, from the decimal strings (no floats). */
const minorOf = (amount: string) => BigInt(amount.replace('.', ''));
const coveredPercent = (covered: string, gross: string) => {
  const total = minorOf(gross);
  return total === 0n ? '0' : ((minorOf(covered) * 100n) / total).toString();
};

/** MUT-662: a payment request's status; tax documents read "Issued". */
const STATUS_BADGE = { UNPAID: 'unpaid', PARTLY_PAID: 'warning', PAID: 'paid', CANCELLED: 'neutral' } as const;
function DocStatus({ doc }: { doc: IssuedDocument }) {
  const { t } = useLanguage();
  const status = doc.paymentRequest?.status;
  if (!status) return <span className="hp-muted">{t('hosted.issue.paymentRequest.issued')}</span>;
  return (
    <Badge variant={STATUS_BADGE[status]} size="sm" data-testid="issued-status">
      {t(`hosted.issue.paymentRequest.status.${status}`)}
    </Badge>
  );
}
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
            {(['TAX_INVOICE', 'TAX_INVOICE_RECEIPT', 'RECEIPT', 'CREDIT_NOTE', 'PAYMENT_REQUEST'] as const).map((type) => (
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
              <th scope="col">{t('hosted.issue.colStatus')}</th>
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
                <td>
                  <DocStatus doc={doc} />
                </td>
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
  const issuer = useIssuer(profile.id);
  const cancel = useCancelPaymentRequest(profile.id);
  const cancelAttempt = useAttemptKey();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
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
  // MUT-643: a 305 or 320 whose Owed it owns may be credited up to what credit notes haven't covered yet, paid or not
  // (the drawer then asks what happened to the paid part). Any other original credits only what is still owed.
  const ownsOwed = owed.data?.origin === 'ISSUED_DOCUMENT' && owed.data.originId === d.id;
  const uncredited = ownsOwed ? minorDigitsToDecimal(String(parseAmountToMinor(d.gross, 'ILS') - parseAmountToMinor(owed.data!.credited, 'ILS')), 2) : owing ? outstanding! : '0.00';
  const canCredit = (d.docType === 'TAX_INVOICE' || d.docType === 'TAX_INVOICE_RECEIPT') && uncredited !== '0.00' && !uncredited.startsWith('-');
  // It starts at what is still owed while something is (as before MUT-643), else at all that credit notes haven't
  // covered; the amount may be raised up to that (the drawer then asks about the paid part). The whole document while
  // that is all of it; else one line for the amount, VAT included.
  const creditable = owing ? outstanding! : uncredited;
  const partly = creditable !== d.gross;
  const creditLines = partly
    ? [{ description: t('hosted.issue.creditLine', { document: docTitle(t, d) }), kind: 'SERVICE' as const, quantity: '1', unitPrice: creditable, discount: '', pricesIncludeVat: true, ...(d.lines.every((l) => l.vatRateBasisPoints === 0) ? { vatExempt: true } : {}) }]
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
        {d.paymentRequest && (
          <div>
            <dt>{t('hosted.issue.colStatus')}</dt>
            <dd>
              <DocStatus doc={d} />{' '}
              <span data-testid="payment-request-covered">{t('hosted.issue.paymentRequest.covered', { covered: formatDecimal(d.paymentRequest.covered, 'ILS', language), gross: formatDecimal(d.gross, 'ILS', language) })}</span>
            </dd>
          </div>
        )}
        {d.allocationNumber && (
          <div>
            <dt>{t('hosted.issue.allocationNumber')}</dt>
            <dd dir="ltr">{d.allocationNumber}</dd>
          </div>
        )}
      </dl>
      {d.paymentRequest && (
        <section className="hp-issued-request" aria-labelledby="hp-issued-request-title" data-testid="payment-request-block">
          <progress className="hp-issued-request-bar" max={100} value={coveredPercent(d.paymentRequest.covered, d.gross)} aria-label={t('hosted.issue.colStatus')} />
          <p className="hp-muted">{t('hosted.issue.paymentRequest.notTax')}</p>
          {d.paymentRequest.linked.length > 0 && (
            <>
              <h2 id="hp-issued-request-title">{t('hosted.issue.paymentRequest.linkedTitle')}</h2>
              <ul className="hp-issued-request-linked">
                {d.paymentRequest.linked.map((l) => (
                  <li key={l.id}>
                    <Link className="hp-link" to={`/p/${profile.id}/documents/issued/${l.id}`}>
                      {t(`hosted.issue.types.${l.docType}`)} {l.number}
                    </Link>{' '}
                    · {formatDecimal(l.gross, 'ILS', language)}
                  </li>
                ))}
              </ul>
            </>
          )}
          {d.paymentRequest.cancellation && (
            <p data-testid="payment-request-cancelled">
              {t('hosted.issue.paymentRequest.cancelledLine', { number: d.paymentRequest.cancellation.displayNumber, date: d.paymentRequest.cancellation.cancelledAt.slice(0, 10) })}
              {d.paymentRequest.cancellation.reason ? ` · ${d.paymentRequest.cancellation.reason}` : ''}
            </p>
          )}
        </section>
      )}
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
        {writable && canCredit && (
          <Button variant="secondary" data-testid="issued-credit" onClick={() => setDrawer({ docType: 'CREDIT_NOTE', customerId: d.customerId ?? undefined, originalId: d.id, lines: creditLines, pricesIncludeVat: partly ? true : d.pricesIncludeVat })}>
            {t('hosted.issue.creditNote')}
          </Button>
        )}
        {writable && d.paymentRequest && d.paymentRequest.status !== 'CANCELLED' && d.paymentRequest.status !== 'PAID' && owing && (
          <Button
            variant="secondary"
            data-testid="payment-request-pay"
            onClick={() => setDrawer({ docType: issuer.data?.dealerType === 'EXEMPT' ? 'RECEIPT' : 'TAX_INVOICE_RECEIPT', customerId: d.customerId ?? undefined, appliesToDocumentId: d.id, pricesIncludeVat: true, lines: [{ description: t('hosted.issue.receiptLine', { document: docTitle(t, d) }), kind: 'SERVICE', quantity: '1', unitPrice: outstanding!, discount: '' }] })}
          >
            {t('hosted.issue.recordPayment')}
          </Button>
        )}
        {writable && d.paymentRequest && d.paymentRequest.status !== 'CANCELLED' && (
          <Button variant="ghost" data-testid="payment-request-cancel" aria-expanded={cancelOpen} onClick={() => setCancelOpen(!cancelOpen)}>
            {t('hosted.issue.paymentRequest.cancel')}
          </Button>
        )}
        {writable && d.docType !== 'CREDIT_NOTE' && (
          <Button variant="ghost" onClick={() => setDrawer({ docType: d.docType, customerId: d.customerId ?? undefined, lines, pricesIncludeVat: d.pricesIncludeVat })}>
            {t('hosted.issue.similar')}
          </Button>
        )}
      </div>
      {cancelOpen && d.paymentRequest && (
        <section className="hp-issued-cancel" aria-labelledby="hp-issued-cancel-title" data-testid="payment-request-cancel-panel">
          <h2 id="hp-issued-cancel-title">{t('hosted.issue.paymentRequest.cancelTitle', { document: docTitle(t, d) })}</h2>
          {d.paymentRequest.linked.length > 0 ? (
            <p role="status" data-testid="payment-request-cancel-blocked">
              {t('hosted.issue.paymentRequest.cancelBlocked')}
            </p>
          ) : (
            <>
              <p className="hp-muted">{t('hosted.issue.paymentRequest.cancelBody')}</p>
              <Input label={t('hosted.issue.paymentRequest.reason')} id="hp-issued-cancel-reason" value={cancelReason} dir="auto" maxLength={300} onChange={(e) => setCancelReason(e.target.value)} />
              <div className="hp-issued-actions">
                <Button
                  variant="danger"
                  isLoading={cancel.isPending}
                  data-testid="payment-request-cancel-confirm"
                  onClick={() =>
                    cancel.mutate(
                      { documentId: d.id, reason: cancelReason.trim() || null, key: cancelAttempt.keyFor({ cancel: d.id }) },
                      {
                        onSuccess: (next) => {
                          cancelAttempt.succeeded();
                          setCancelOpen(false);
                          toast(t('hosted.issue.paymentRequest.cancelled', { number: docTitle(t, d), cancellation: next.paymentRequest?.cancellation?.displayNumber ?? '' }));
                        },
                        onError: (error) => toast(error instanceof ApiError && error.status === 409 ? t('hosted.issue.paymentRequest.cancelBlocked') : t('hosted.issue.failed')),
                      },
                    )
                  }
                >
                  {t('hosted.issue.paymentRequest.cancelConfirm')}
                </Button>
                <Button variant="ghost" onClick={() => setCancelOpen(false)}>
                  {t('common.close')}
                </Button>
              </div>
            </>
          )}
        </section>
      )}
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
